'use strict';

const express    = require('express');
const { Pool }   = require('pg');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const path       = require('path');

const app  = express();
app.use(express.json());

// ── 環境變數 ──────────────────────────────────────────────
const DATABASE_URL           = process.env.DATABASE_URL;
const JWT_SECRET             = process.env.JWT_SECRET;
const ADMIN_INITIAL_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD || 'Admin@2024!';
const PORT                   = process.env.PORT || 8080;

if (!JWT_SECRET)   { console.error('FATAL: JWT_SECRET env var is required'); process.exit(1); }
if (!DATABASE_URL) { console.error('FATAL: DATABASE_URL env var is required'); process.exit(1); }

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

// ── DB init ───────────────────────────────────────────────
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      username      VARCHAR(100) UNIQUE NOT NULL,
      password_hash VARCHAR(255),
      role          VARCHAR(20)  NOT NULL DEFAULT 'member',
      page_perms    TEXT[]       NOT NULL DEFAULT '{}',
      fn_perms      TEXT[]       NOT NULL DEFAULT '{}',
      approved      BOOLEAN      NOT NULL DEFAULT false,
      created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      last_login    TIMESTAMPTZ
    )
  `);

  // 確保 reyi 帳號存在（本地帳號，密碼由 ADMIN_INITIAL_PASSWORD 控制）
  const { rowCount } = await pool.query('SELECT id FROM users WHERE username = $1', ['reyi']);
  if (rowCount === 0) {
    const hash = await bcrypt.hash(ADMIN_INITIAL_PASSWORD, 12);
    await pool.query(
      `INSERT INTO users (username, password_hash, role, approved) VALUES ($1, $2, 'admin', true)`,
      ['reyi', hash]
    );
    console.log('建立初始管理員帳號：reyi');
  }
}

// ── EIP AD 驗證 ───────────────────────────────────────────
// ⚠️ 若回應格式不符，請調整 parseAdResult 函式後重新部署
async function verifyAD(username, password) {
  try {
    const res = await fetch('https://eip.fme.com.tw/FMEIP/AasApi/CheckUserId', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ UserId: username, Password: password }),
      signal:  AbortSignal.timeout(8000),
    });

    // 若純 HTTP 狀態碼代表結果
    if (res.status === 401 || res.status === 403) return false;
    if (!res.ok) {
      console.warn(`EIP API 回應非預期狀態碼: ${res.status}`);
      return false;
    }

    const text = await res.text();
    console.log(`EIP API 原始回應 [${username}]:`, text.slice(0, 200)); // 首次部署時確認格式

    // 嘗試 JSON 解析
    try {
      const data = JSON.parse(text);
      // 相容多種 .NET / 自訂 API 回應格式
      if (typeof data === 'boolean') return data;
      if (data === 'true' || data === '1')  return true;
      if (data === 'false' || data === '0') return false;
      if (data.IsSuccess   !== undefined) return Boolean(data.IsSuccess);
      if (data.isSuccess   !== undefined) return Boolean(data.isSuccess);
      if (data.Result      !== undefined) return Boolean(data.Result);
      if (data.result      !== undefined) return Boolean(data.result);
      if (data.Success     !== undefined) return Boolean(data.Success);
      if (data.success     !== undefined) return Boolean(data.success);
      if (data.IsValid     !== undefined) return Boolean(data.IsValid);
      if (data.status === 'ok' || data.status === 'success') return true;
      if (data.code === 0 || data.code === 200) return true;
      // 若都沒有，視 HTTP 200 為成功
      return res.ok;
    } catch {
      // 非 JSON：純文字
      const t = text.trim().toLowerCase();
      if (t === 'true' || t === '1' || t === 'ok' || t === 'success') return true;
      if (t === 'false' || t === '0') return false;
      return res.ok; // HTTP 200 視為成功
    }
  } catch (err) {
    console.error('EIP API 呼叫失敗:', err.message);
    return false;
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

// ── POST /api/auth/login ──────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) return res.status(400).json({ error: '請輸入帳號與密碼' });

  const uname = username.trim().toLowerCase();

  // 1. AD 驗證（主要）
  const adOk = await verifyAD(uname, password);

  if (adOk) {
    const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [uname]);
    let user = rows[0];

    if (!user) {
      // 首次 AD 登入：自動建立帳號
      const isGrace = uname === 'grace';
      const { rows: created } = await pool.query(
        `INSERT INTO users (username, role, approved, page_perms, fn_perms)
         VALUES ($1, $2, $3, '{}', '{}') RETURNING *`,
        [uname, isGrace ? 'admin' : 'member', isGrace]
      );
      user = created[0];
      console.log(`自動建立帳號: ${uname}，角色: ${user.role}，已核准: ${user.approved}`);
    } else if (uname === 'grace' && (user.role !== 'admin' || !user.approved)) {
      // grace 永遠確保 admin + approved
      await pool.query(`UPDATE users SET role='admin', approved=true WHERE id=$1`, [user.id]);
      user.role    = 'admin';
      user.approved = true;
    }

    if (!user.approved) {
      return res.status(403).json({ error: '此帳號審核中，請等候管理員核准後再登入。' });
    }

    await pool.query('UPDATE users SET last_login=NOW() WHERE id=$1', [user.id]);
    return res.json({ token: issueToken(user), user: safeUser(user) });
  }

  // 2. 本地帳號驗證（備用：reyi 及管理員建立的本地帳號）
  const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [uname]);
  const user = rows[0];

  if (!user?.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
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
  const id = Number(req.params.id);
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
  const { rows } = await pool.query('SELECT username FROM users WHERE id=$1', [req.params.id]);
  if (rows[0]?.username === 'grace') {
    return res.status(400).json({ error: 'grace 帳號不可刪除' });
  }
  await pool.query('DELETE FROM users WHERE id=$1', [req.params.id]);
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
