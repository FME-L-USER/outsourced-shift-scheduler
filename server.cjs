'use strict';

const express    = require('express');
const { Pool }   = require('pg');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const path       = require('path');

const app  = express();
app.use(express.json());

// ── HTTP 安全標頭 ─────────────────────────────────────────
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});

// ── 登入速率限制（每 IP，15 分鐘內最多 20 次）────────────
const loginRateMap = new Map();
function checkLoginRate(ip) {
  const now = Date.now();
  const entry = loginRateMap.get(ip) ?? { count: 0, resetAt: now + 15 * 60 * 1000 };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 15 * 60 * 1000; }
  entry.count++;
  loginRateMap.set(ip, entry);
  return entry.count <= 20;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, e] of loginRateMap) { if (now > e.resetAt) loginRateMap.delete(ip); }
}, 5 * 60 * 1000);

// ── 環境變數 ──────────────────────────────────────────────
const DATABASE_URL           = process.env.DATABASE_URL;
const JWT_SECRET             = process.env.JWT_SECRET;
const ADMIN_INITIAL_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD;
const PORT                   = process.env.PORT || 8080;

if (!JWT_SECRET)            { console.error('FATAL: JWT_SECRET env var is required'); process.exit(1); }
if (!DATABASE_URL)          { console.error('FATAL: DATABASE_URL env var is required'); process.exit(1); }
if (!ADMIN_INITIAL_PASSWORD){ console.error('FATAL: ADMIN_INITIAL_PASSWORD env var is required'); process.exit(1); }

// Cloud SQL Unix socket 不需要 SSL；TCP 連線則啟用憑證驗證
const sslConfig = DATABASE_URL.includes('/cloudsql/') ? false : { rejectUnauthorized: true };
const pool = new Pool({ connectionString: DATABASE_URL, ssl: sslConfig, options: '-c search_path=sms,public' });

// ── DB init ───────────────────────────────────────────────
async function initDB() {
  await pool.query('CREATE SCHEMA IF NOT EXISTS sms');
  await pool.query('SET search_path TO sms');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            VARCHAR(20)  PRIMARY KEY,
      username      VARCHAR(100) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL DEFAULT '',
      role          VARCHAR(20)  NOT NULL DEFAULT 'worker',
      display_name  VARCHAR(50)  NOT NULL DEFAULT '',
      page_perms    TEXT[]       NOT NULL DEFAULT '{}',
      fn_perms      TEXT[]       NOT NULL DEFAULT '{}',
      approved      BOOLEAN      NOT NULL DEFAULT false,
      created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      last_login    TIMESTAMPTZ
    )
  `);
  // migration：若表已存在但缺欄位則補上（ADD COLUMN IF NOT EXISTS 為冪等操作）
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255) NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role          VARCHAR(20)  NOT NULL DEFAULT 'worker'`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name  VARCHAR(50)  NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS page_perms    TEXT[]       NOT NULL DEFAULT '{}'`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS fn_perms      TEXT[]       NOT NULL DEFAULT '{}'`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS approved      BOOLEAN      NOT NULL DEFAULT false`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login    TIMESTAMPTZ`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      id         VARCHAR(50) PRIMARY KEY,
      data       JSONB       NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // 確保 reyi 帳號存在（本地帳號，密碼由 ADMIN_INITIAL_PASSWORD 控制）
  const { rowCount } = await pool.query('SELECT id FROM users WHERE username = $1', ['reyi']);
  if (rowCount === 0) {
    const hash = await bcrypt.hash(ADMIN_INITIAL_PASSWORD, 12);
    await pool.query(
      `INSERT INTO users (id, username, password_hash, role, approved, display_name)
       VALUES ($1, $2, $3, 'admin', true, $4)`,
      ['reyi', 'reyi', hash, 'reyi']
    );
    console.log('建立初始管理員帳號：reyi');
  }

  // 大溪倉員工帳號與清冊種子資料（冪等，重複執行不會重複建立）
  await seedDaxiEmployees();
}

// ── 大溪倉員工種子資料 ────────────────────────────────────────────────────────
const DAXI_EMPLOYEES = [
  // 大溪倉、倉儲管理課
  { u: 'cami700220', n: '李淑惠', d: '倉儲管理課' },
  { u: 'judy',       n: '林麗雲', d: '倉儲管理課' },
  { u: 'beyi',       n: '洪淑娥', d: '倉儲管理課' },
  { u: 'papa0130',   n: '洪逸樺', d: '倉儲管理課' },
  { u: 'lin',        n: '張秋梅', d: '倉儲管理課' },
  { u: 'adychang',   n: '張綾娟', d: '倉儲管理課' },
  { u: 'wandychen',  n: '陳怡如', d: '倉儲管理課' },
  { u: 'choeuyi',    n: '陳明憶', d: '倉儲管理課' },
  { u: 'lulu5566',   n: '曾郁茹', d: '倉儲管理課' },
  { u: 'angieliau',  n: '廖亞仙', d: '倉儲管理課' },
  { u: 'soda0968',   n: '蔡欣如', d: '倉儲管理課' },
  { u: 'lynn110501', n: '鄭伊伶', d: '倉儲管理課' },
  { u: 'huei',       n: '蕭嘉慧', d: '倉儲管理課' },
  { u: 'antin',      n: '鮑玉婷', d: '倉儲管理課' },
  { u: 'ebba',       n: '鍾惠玲', d: '倉儲管理課' },
  // 大溪倉、大溪理貨一課
  { u: 'una800607',  n: '王敏瑜', d: '大溪理貨一課' },
  { u: 'd57633',     n: '王歆語', d: '大溪理貨一課' },
  { u: 'a033825385', n: '王語喬', d: '大溪理貨一課' },
  { u: 'x6706889',   n: '呂芷軒', d: '大溪理貨一課' },
  { u: 'kiki1123',   n: '呂嘉綾', d: '大溪理貨一課' },
  { u: 'lee0929',    n: '李育瑄', d: '大溪理貨一課' },
  { u: 'wei',        n: '李薇',   d: '大溪理貨一課' },
  { u: 'huj102001',  n: '林昀安', d: '大溪理貨一課' },
  { u: 'an05566',    n: '林明霞', d: '大溪理貨一課' },
  { u: 'a3731703',   n: '林羅響', d: '大溪理貨一課' },
  { u: 'cpu1020',    n: '邱品惠', d: '大溪理貨一課' },
  { u: 't48568',     n: '邱綉婷', d: '大溪理貨一課' },
  { u: 'car55688',   n: '徐輔懋', d: '大溪理貨一課' },
  { u: 'king',       n: '高政華', d: '大溪理貨一課' },
  { u: 'yan',        n: '張雁婷', d: '大溪理貨一課' },
  { u: 'ry10806005', n: '許佑豪', d: '大溪理貨一課' },
  { u: 'mingli1125', n: '彭明莉', d: '大溪理貨一課' },
  { u: 'lv6868',     n: '温惠君', d: '大溪理貨一課' },
  { u: 'qaz1346',    n: '黃邱鴻', d: '大溪理貨一課' },
  { u: 'd10813023',  n: '黃俊誠', d: '大溪理貨一課' },
  { u: 'zmliu',      n: '劉姿旻', d: '大溪理貨一課' },
  { u: 'ooxx0105',   n: '蔡晏如', d: '大溪理貨一課' },
  { u: 'mini0228',   n: '賴韋妏', d: '大溪理貨一課' },
  { u: 'luo',        n: '駱佩妏', d: '大溪理貨一課' },
  { u: 'm5426',      n: '駱眉綺', d: '大溪理貨一課' },
  // 大溪倉、大溪理貨二課
  { u: 'yu0314',     n: '方心妤', d: '大溪理貨二課' },
  { u: 'bigcavan',   n: '全雅慈', d: '大溪理貨二課' },
  { u: 'jiu120914',  n: '江映慈', d: '大溪理貨二課' },
  { u: 'kelly1009',  n: '呂羿螢', d: '大溪理貨二課' },
  { u: 'the1053',    n: '林玠含', d: '大溪理貨二課' },
  { u: 'beverly',    n: '林育瑩', d: '大溪理貨二課' },
  { u: 'avon',       n: '林雅芳', d: '大溪理貨二課' },
  { u: 'yilu1983',   n: '陳怡茹', d: '大溪理貨二課' },
  { u: 'yung',       n: '陳詩永', d: '大溪理貨二課' },
  { u: 'cschen',     n: '陳嘉興', d: '大溪理貨二課' },
  { u: 'winnie2023', n: '黃安笛', d: '大溪理貨二課' },
  { u: 'liwen1212',  n: '董麗雯', d: '大溪理貨二課' },
  { u: 'jz13',       n: '劉俊助', d: '大溪理貨二課' },
  { u: 'ning',       n: '鄭亦甯', d: '大溪理貨二課' },
  { u: 'zheng1212',  n: '鄭喻云', d: '大溪理貨二課' },
  { u: 'hw289',      n: '鄭惠雯', d: '大溪理貨二課' },
  { u: 'jiarong84',  n: '謝佳蓉', d: '大溪理貨二課' },
  { u: 'upin0122',   n: '鍾玉屏', d: '大溪理貨二課' },
];

async function seedDaxiEmployees() {
  // 1. 批次建立 users（ON CONFLICT DO NOTHING，冪等）
  for (const e of DAXI_EMPLOYEES) {
    await pool.query(
      `INSERT INTO users (id, username, password_hash, role, approved, display_name, page_perms, fn_perms)
       VALUES ($1, $2, 'ad_auth_only', 'worker', true, $3, '{}', '{}')
       ON CONFLICT (username) DO NOTHING`,
      [e.u, e.u, e.n]
    );
  }

  // 2. 將員工加入 app_state.employees（僅新增不存在的）
  const { rows } = await pool.query("SELECT data FROM app_state WHERE id='main'");
  const state = rows[0]?.data;
  if (!state) return; // app_state 尚未初始化，等管理員首次登入後再寫入

  const existing   = Array.isArray(state.employees) ? state.employees : [];
  const existingUs = new Set(existing.map(e => (e.empId || '').toLowerCase()));
  const toAdd = DAXI_EMPLOYEES
    .filter(e => !existingUs.has(e.u))
    .map(e => ({ id: `emp_${e.u}`, empId: e.u, name: e.n, vendor: '', dept: e.d, group: '', status: '在職' }));

  if (toAdd.length === 0) return;

  const merged = [...existing, ...toAdd];
  await pool.query(
    `INSERT INTO app_state (id, data, updated_at) VALUES ('main', $1, NOW())
     ON CONFLICT (id) DO UPDATE SET data = $1, updated_at = NOW()`,
    [{ ...state, employees: merged }]
  );
  console.log(`大溪倉員工清冊：新增 ${toAdd.length} 筆`);
}

// ── EIP AD 驗證 ───────────────────────────────────────────
// API 規格：POST { USER_ID, PSW } → { MSG: "000 登入成功" }
// 代碼：000=成功 / 100=帳密錯誤 / 200=AD錯誤 / 998=DB異常 / 999=其他錯誤
const AD_ERROR_MSG = {
  '100': '帳號或密碼錯誤',
  '200': 'AD 認證錯誤',
  '998': '系統暫時無法使用，請稍後再試',
  '999': '系統發生錯誤，請聯絡管理員',
};

async function verifyAD(username, password) {
  try {
    const res = await fetch('https://eip.fme.com.tw/FMEIP/AasApi/CheckUserId', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ USER_ID: username, PSW: password }),
      signal:  AbortSignal.timeout(8000),
    });
    if (!res.ok) { console.warn(`EIP 非預期狀態碼: ${res.status}`); return { ok: false, msg: '系統發生錯誤，請聯絡管理員' }; }
    const data = await res.json();
    const code = String(data.MSG ?? '').split(' ')[0];
    if (code === '000') return { ok: true };
    return { ok: false, msg: AD_ERROR_MSG[code] ?? '系統發生錯誤，請聯絡管理員' };
  } catch (err) {
    console.error('EIP API 呼叫失敗:', err.message);
    return { ok: false, msg: '無法連線至 AD 驗證伺服器，請稍後再試' };
  }
}

// ── JWT 工具 ──────────────────────────────────────────────
function issueToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, page_perms: user.page_perms, fn_perms: user.fn_perms },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

function safeUser(u) {
  return {
    id:         u.id,
    username:   u.username,
    role:       u.role,
    page_perms: u.page_perms  || [],
    fn_perms:   u.fn_perms    || [],
    approved:   u.approved,
    last_login: u.last_login,
  };
}

// ── Auth middleware ───────────────────────────────────────
function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token 無效或已過期' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: '需要管理員權限' });
  next();
}

function requireManagerOrAdmin(req, res, next) {
  const role = req.user?.role;
  if (role !== 'admin' && role !== 'area') return res.status(403).json({ error: '需要管理員或區域主管權限' });
  next();
}

// ── POST /api/auth/login ──────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0] ?? req.socket.remoteAddress ?? 'unknown';
  if (!checkLoginRate(ip)) return res.status(429).json({ error: '登入嘗試次數過多，請 15 分鐘後再試' });

  const { USER_ID, PSW } = req.body ?? {};
  if (!USER_ID || !PSW) return res.status(400).json({ error: '請輸入帳號及密碼' });
  if (USER_ID.length > 15) return res.status(400).json({ error: '帳號長度不可超過 15 字元' });
  if (PSW.length > 30)     return res.status(400).json({ error: '密碼長度不可超過 30 字元' });

  const uname = USER_ID.trim().toLowerCase();

  // 1. AD 驗證（主要）
  const adResult = await verifyAD(uname, PSW);

  if (adResult.ok) {
    const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [uname]);
    let user = rows[0];

    if (!user) {
      // 首次 AD 登入：自動建立帳號
      // role 預設 worker（CHECK constraint 允許的最低權限），由管理員審核後調整
      // password_hash 使用 sentinel 'ad_auth_only'，AD 使用者不走本地密碼驗證
      // display_name 使用 username 作為 fallback（AD API 無回傳顯示名稱）
      const isGrace = uname === 'grace';
      const { rows: created } = await pool.query(
        `INSERT INTO users (id, username, password_hash, role, approved, display_name, page_perms, fn_perms)
         VALUES ($1, $2, 'ad_auth_only', $3, true, $4, '{}', '{}') RETURNING *`,
        [uname, uname, isGrace ? 'admin' : 'worker', uname]
      );
      user = created[0];
      console.log(`自動建立帳號: ${uname}，角色: ${user.role}，已核准: ${user.approved}`);
    } else {
      // 既有帳號：AD 驗證成功即視為核准，補正 approved=true
      const sets = [];
      if (uname === 'grace' && user.role !== 'admin') { sets.push(`role='admin'`); user.role = 'admin'; }
      if (!user.approved) { sets.push(`approved=true`); user.approved = true; }
      if (sets.length) await pool.query(`UPDATE users SET ${sets.join(',')} WHERE id=$1`, [user.id]);
    }

    if (!user.approved) {
      return res.status(403).json({ error: '此帳號審核中，請等候管理員核准後再登入。' });
    }

    await pool.query('UPDATE users SET last_login=NOW() WHERE id=$1', [user.id]);
    return res.json({ token: issueToken(user), user: safeUser(user) });
  }

  // 2. 本地帳號驗證（備用：reyi 及管理員建立的本地帳號）
  // AD 回傳明確錯誤（帳密錯 / AD錯）時不再嘗試本地帳號，直接回報
  if (adResult.msg && adResult.msg !== '無法連線至 AD 驗證伺服器，請稍後再試') {
    return res.status(401).json({ error: adResult.msg });
  }
  const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [uname]);
  const user = rows[0];

  if (!user?.password_hash || user.password_hash === 'ad_auth_only' || !(await bcrypt.compare(PSW, user.password_hash))) {
    return res.status(401).json({ error: '帳號或密碼錯誤' });
  }
  if (!user.approved) {
    return res.status(403).json({ error: '此帳號審核中，請等候管理員核准後再登入。' });
  }

  await pool.query('UPDATE users SET last_login=NOW() WHERE id=$1', [user.id]);
  return res.json({ token: issueToken(user), user: safeUser(user) });
});

// ── GET /api/auth/me ──────────────────────────────────────
app.get('/api/auth/me', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM users WHERE id=$1', [req.user.id]);
  const user = rows[0];
  if (!user || !user.approved) return res.status(401).json({ error: 'Unauthorized' });
  res.json(safeUser(user));
});

// ── GET /api/users (admin) ────────────────────────────────
app.get('/api/users', requireAuth, requireAdmin, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM users ORDER BY created_at DESC');
  res.json(rows.map(safeUser));
});

// ── PUT /api/users/:id (admin) ────────────────────────────
app.put('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = String(req.params.id).trim();
  if (!id) return res.status(400).json({ error: '無效的使用者 ID' });
  const { role, approved, page_perms, fn_perms } = req.body ?? {};

  const { rows: existing } = await pool.query('SELECT username FROM users WHERE id=$1', [id]);
  if (!existing[0]) return res.status(404).json({ error: '找不到此帳號' });
  if (existing[0].username === 'grace' && role && role !== 'admin') {
    return res.status(400).json({ error: 'grace 帳號不可降級' });
  }

  const sets = [], vals = [];
  if (role       !== undefined) { vals.push(role);       sets.push(`role=$${vals.length}`); }
  if (approved   !== undefined) { vals.push(approved);   sets.push(`approved=$${vals.length}`); }
  if (page_perms !== undefined) { vals.push(page_perms); sets.push(`page_perms=$${vals.length}`); }
  if (fn_perms   !== undefined) { vals.push(fn_perms);   sets.push(`fn_perms=$${vals.length}`); }
  if (!sets.length) return res.status(400).json({ error: '無可更新欄位' });

  vals.push(id);
  const { rows: updated } = await pool.query(
    `UPDATE users SET ${sets.join(',')} WHERE id=$${vals.length} RETURNING *`, vals
  );
  res.json(safeUser(updated[0]));
});

// ── DELETE /api/users/:id (admin) ─────────────────────────
app.delete('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = String(req.params.id).trim();
  if (!id) return res.status(400).json({ error: '無效的使用者 ID' });
  const { rows } = await pool.query('SELECT username FROM users WHERE id=$1', [id]);
  if (rows[0]?.username === 'grace') {
    return res.status(400).json({ error: 'grace 帳號不可刪除' });
  }
  await pool.query('DELETE FROM users WHERE id=$1', [id]);
  res.json({ ok: true });
});

// ── GET /api/state ────────────────────────────────────────
app.get('/api/state', requireAuth, requireManagerOrAdmin, async (req, res) => {
  const { rows } = await pool.query("SELECT data FROM app_state WHERE id='main'");
  res.json(rows[0]?.data ?? null);
});

// ── PUT /api/state ────────────────────────────────────────
app.put('/api/state', requireAuth, requireManagerOrAdmin, async (req, res) => {
  await pool.query(
    `INSERT INTO app_state (id, data, updated_at) VALUES ('main',$1,NOW())
     ON CONFLICT (id) DO UPDATE SET data=$1, updated_at=NOW()`,
    [req.body]
  );
  res.json({ ok: true });
});

// ── GET /api/health ───────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// ── Static SPA ────────────────────────────────────────────
const DIST = path.join(__dirname, 'dist');
app.use(express.static(DIST));
app.get('*', (_req, res) => res.sendFile(path.join(DIST, 'index.html')));

// ── Start ─────────────────────────────────────────────────
initDB()
  .then(() => app.listen(PORT, () => console.log(`伺服器啟動，監聽 :${PORT}`)))
  .catch(err => { console.error('啟動失敗:', err); process.exit(1); });
