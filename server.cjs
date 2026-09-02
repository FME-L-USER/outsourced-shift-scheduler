'use strict';

const express    = require('express');
const { Pool }   = require('pg');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const path       = require('path');
const nodeCrypto = require('crypto');

const app  = express();
app.use(express.json({ limit: '10mb' }));

// ── HTTP 安全標頭 ─────────────────────────────────────────
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});

// ── 登入速率限制 ──────────────────────────────────────────
// 以「IP + 帳號」為單位限制 10 次／15 分鐘：防止單一帳號被暴力破解。
// 另設每 IP 500 次／15 分鐘的總量上限：公司內部數百名人員共用同一對外 IP，
// 若僅以 IP 計數，交接班等尖峰時段多人同時登入會誤擋（第 N 人起一律 429，
// 前端會誤判為密碼錯誤並累積至本機鎖定），故總量上限須明顯放寬。
const loginRateMap = new Map();
const RATE_WINDOW_MS = 15 * 60 * 1000;
function hitRate(key, limit) {
  const now = Date.now();
  const entry = loginRateMap.get(key) ?? { count: 0, resetAt: now + RATE_WINDOW_MS };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + RATE_WINDOW_MS; }
  entry.count++;
  loginRateMap.set(key, entry);
  return entry.count <= limit;
}
function checkLoginRate(ip, username) {
  // 兩個計數器都要遞增，不可用 && 短路
  const ipOk = hitRate(`ip:${ip}`, 500);
  const userOk = username
    ? hitRate(`u:${ip}|${String(username).trim().toLowerCase()}`, 10)
    : true;
  return ipOk && userOk;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, e] of loginRateMap) { if (now > e.resetAt) loginRateMap.delete(k); }
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
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login         TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS allowed_warehouses TEXT[] NOT NULL DEFAULT '{}'`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS vendors           TEXT[] NOT NULL DEFAULT '{}'`);
  // 權限申請時由申請者填寫的身分說明（AD 不回傳姓名，需申請者自述）
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS request_note  TEXT`);
  // id 原為 VARCHAR(20)，但「委外人員升級廠商幹部」產生的帳號 id 形如
  // worker_upgraded_imp_1785741320010_236（37 字元），寫入時會超長拋錯，
  // 導致帳號無法建立、登入時回 500。放寬長度限制（僅在需要時才 ALTER）。
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'sms' AND table_name = 'users'
          AND column_name = 'id' AND character_maximum_length < 64
      ) THEN
        ALTER TABLE sms.users ALTER COLUMN id TYPE VARCHAR(64);
      END IF;
    END $$;
  `);
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
  // 大肚倉/岡山倉員工帳號與清冊種子資料（role=area，可使用所有分頁功能）
  await seedAreaEmployees();
  // 大溪倉員工（role=area 日翊，2026 更新名單）
  await seedDaxiAreaEmployees();
  // 各倉別廠商配置（冪等，只新增不刪除）
  await seedWarehouseVendors();
  // 課別／組別正規化（以使用者提供之正式清單為準）
  await seedDeptGroups();
}

// ── 課別／組別正式清單 ────────────────────────────────────────────
// 來源：使用者提供之「倉別 / 課別 / 組別」對照表，為權威資料。
// 未列於此表的組別會被移除；已指派到該組別的員工資料不會被刪除，僅在啟動時列出提醒。
const DEPT_GROUPS = {
  '大溪倉': {
    '大溪理貨一課': ['日班-理貨一組','日班-理貨二組','中班-理貨一組',
                     '日班-驗收組','夜班-驗收組','中班-驗收組','日班-EC廠退組'],
    '大溪理貨二課': ['日班-店訂組','日班-退貨組','中班-分揀組','日班-加工組','日班-POP組'],
    '倉儲管理課':   ['日班-庫存組','日班-廠退組','日班-收發組','清潔組','中班-庫存組'],
    '運務課':       ['運務組'],
    '營運推進課':   ['日班-單據組'],
  },
  '大肚倉': {
    '大肚理貨課':   ['日班-理貨組','中班-理貨組','清潔組','日班-出貨組'],
    '大肚運務課':   ['運務組'],
  },
  '岡山倉': {
    '岡山營運課':   ['日班-理貨組','中班-理貨組','夜班-理貨組','日班-出貨組'],
  },
};

// 課別更名對照（舊名 → 新名），同時遷移員工清冊的 dept 欄位
const DEPT_RENAMES = { '營運指導課': '營運推進課' };

async function seedDeptGroups() {
  const { rows } = await pool.query("SELECT data FROM app_state WHERE id='main'");
  const state = rows[0]?.data;
  if (!state || !Array.isArray(state.warehouses)) return;

  let changed = false;

  const warehouses = state.warehouses.map(w => {
    const want = DEPT_GROUPS[w.name];
    if (!want) return w;
    return {
      ...w,
      departments: (w.departments ?? []).map(d => {
        const name = DEPT_RENAMES[d.name] ?? d.name;
        const groups = want[name];
        if (!groups) return d; // 不在清單內的課別保持原樣，不擅自刪除
        if (name !== d.name || JSON.stringify(d.groups ?? []) !== JSON.stringify(groups)) changed = true;
        return { ...d, name, groups: [...groups] };
      }),
    };
  });

  // 員工清冊的課別名稱同步更名，避免與倉別設定脫鉤
  let employees = state.employees;
  if (Array.isArray(employees)) {
    const next = employees.map(e =>
      DEPT_RENAMES[e.dept] ? { ...e, dept: DEPT_RENAMES[e.dept] } : e);
    if (next.some((e, i) => e !== employees[i])) { employees = next; changed = true; }
  }

  if (!changed) return;
  await pool.query(
    `UPDATE app_state SET data = data || $1::jsonb, updated_at = NOW() WHERE id='main'`,
    [JSON.stringify({ warehouses, employees })]
  );

  // 提醒：清單外的組別已從下拉選單移除，但仍有員工掛在上面
  const valid = new Map();
  for (const w of warehouses)
    for (const d of (w.departments ?? [])) valid.set(`${w.name}|${d.name}`, new Set(d.groups ?? []));
  const stranded = new Map();
  for (const e of (employees ?? [])) {
    if (!e.group) continue;
    const set = valid.get(`${e.warehouse}|${e.dept}`);
    if (set && !set.has(e.group)) {
      const k = `${e.warehouse} / ${e.dept} / ${e.group}`;
      stranded.set(k, (stranded.get(k) ?? 0) + 1);
    }
  }
  console.log('[seed] 已更新課別／組別清單');
  for (const [k, n] of stranded) console.warn(`[seed] ⚠ 組別已移除但仍有 ${n} 位人員：${k}`);
}

// ── 各課別廠商配置 ────────────────────────────────────────────────
// 來源：使用者提供之「課別 / 組別 / 廠商」對照表（權威資料）。
// 系統資料模型中廠商掛在「課別」層，故此處為該課各組別廠商的聯集。
const DEPT_VENDORS = {
  '大溪理貨一課': ['芊通', '高順', '海納', '建豐', '勁速', '金鑫', '品豐', '全勤', '日翊', '閱川', '智遠'],
  '大溪理貨二課': ['芊通', '高順', '海納', '建豐', '勁速', '全勤', '日翊', '閱川', '智遠'],
  '倉儲管理課':   ['高順', '建豐', '勁速', '金鑫', '品豐', '日翊', '閱川', '智遠'],
  '運務課':       ['芊通', '高順', '建豐', '勁速', '品豐', '智遠'],
  '營運推進課':   ['日翊'],
  '大肚理貨課':   ['承奕', '華煬通', '三彥', '萬宜', '信邦'],
  '大肚運務課':   ['承奕', '華煬通', '三彥', '萬宜'],
  '岡山營運課':   ['承杺', '芊通', '頂富'],
};

// 廠商代碼（員工編號前綴用）
const VENDOR_CODES = {
  '承杺': 'CS', '芊通': 'CT', '承奕': 'CY', '頂富': 'DF', '華煬通': 'HT',
  '三彥': 'SY', '萬宜': 'WY', '信邦': 'XB', '高順': 'GS', '海納': 'HN',
  '建豐': 'JF', '勁速': 'JS', '金鑫': 'JX', '品豐': 'PF', '全勤': 'QQ',
  '日翊': 'RY', '閱川': 'YC', '智遠': 'ZY',
};

async function seedWarehouseVendors() {
  const { rows } = await pool.query("SELECT data FROM app_state WHERE id='main'");
  const state = rows[0]?.data;
  if (!state || !Array.isArray(state.warehouses)) return; // 尚未初始化，待管理員首次登入後再寫入

  let changed = false;

  // 1. 全域廠商清單：補上缺少的廠商（只新增，不刪除既有設定）
  const vendors = Array.isArray(state.vendors) ? [...state.vendors] : [];
  const haveNames = new Set(vendors.map(v => v.name));
  for (const [name, code] of Object.entries(VENDOR_CODES)) {
    if (haveNames.has(name)) continue;
    vendors.push({ id: 'vd_' + code.toLowerCase(), code, name });
    changed = true;
  }

  // 2. 各課別依對照表配置廠商（以對照表為準，覆蓋既有設定）
  const warehouses = state.warehouses.map(w => ({
    ...w,
    departments: (w.departments ?? []).map(d => {
      // 課別可能同時在本次啟動被更名，兩個名稱都查
      const want = DEPT_VENDORS[d.name] ?? DEPT_VENDORS[DEPT_RENAMES[d.name]];
      if (!want) return d; // 不在對照表內的課別保持原樣
      if (JSON.stringify(d.vendors ?? []) === JSON.stringify(want)) return d;
      changed = true;
      return { ...d, vendors: [...want] };
    }),
  }));

  if (!changed) return;
  await pool.query(
    `UPDATE app_state SET data = data || $1::jsonb, updated_at = NOW() WHERE id='main'`,
    [JSON.stringify({ vendors, warehouses })]
  );
  console.log('[seed] 已更新各倉別廠商配置');
}

// ── 大溪倉人員名單（2026 更新版，role=area 日翊）──────────────────────────────
// 來源：倉庫人員名單.xlsx。wh='可視全倉' 者為主管，開放全部倉別。
// 同一人可跨多個課別（清冊會各建一筆），帳號則以 username 去重。
const DAXI_AREA_EMPLOYEES = [
  { u: 'una800607', n: '王敏瑜', wh: '大溪倉', d: '大溪理貨一課' },
  { u: 'd57633', n: '王歆語', wh: '大溪倉', d: '大溪理貨一課' },
  { u: 'a033825385', n: '王語喬', wh: '大溪倉', d: '大溪理貨一課' },
  { u: 'x6706889', n: '呂芷軒', wh: '大溪倉', d: '大溪理貨一課' },
  { u: 'kiki1123', n: '呂嘉綾', wh: '大溪倉', d: '大溪理貨一課' },
  { u: 'lee0929', n: '李育瑄', wh: '大溪倉', d: '大溪理貨一課' },
  { u: 'wei', n: '李薇', wh: '大溪倉', d: '大溪理貨一課' },
  { u: 'huj102001', n: '林昀安', wh: '大溪倉', d: '大溪理貨一課' },
  { u: 'an05566', n: '林明霞', wh: '大溪倉', d: '大溪理貨一課' },
  { u: 'a3731703', n: '林羅響', wh: '大溪倉', d: '大溪理貨一課' },
  { u: 'cpu1020', n: '邱品惠', wh: '大溪倉', d: '大溪理貨一課' },
  { u: 't48568', n: '邱綉婷', wh: '大溪倉', d: '大溪理貨一課' },
  { u: 'car55688', n: '徐輔懋', wh: '大溪倉', d: '大溪理貨一課' },
  { u: 'king', n: '高政華', wh: '大溪倉', d: '大溪理貨一課' },
  { u: 'yan', n: '張雁婷', wh: '大溪倉', d: '大溪理貨一課' },
  { u: 'ry10806005', n: '許佑豪', wh: '大溪倉', d: '大溪理貨一課' },
  { u: 'mingli1125', n: '彭明莉', wh: '大溪倉', d: '大溪理貨一課' },
  { u: 'lv6868', n: '温惠君', wh: '大溪倉', d: '大溪理貨一課' },
  { u: 'qaz1346', n: '黃邱鴻', wh: '大溪倉', d: '大溪理貨一課' },
  { u: 'd10813023', n: '黃俊誠', wh: '大溪倉', d: '大溪理貨一課' },
  { u: 'kun1201', n: '楊裔堃', wh: '大溪倉', d: '大溪理貨一課' },
  { u: 'zmliu', n: '劉姿旻', wh: '大溪倉', d: '大溪理貨一課' },
  { u: 'ooxx0105', n: '蔡晏如', wh: '大溪倉', d: '大溪理貨一課' },
  { u: 'mini0228', n: '賴韋妏', wh: '大溪倉', d: '大溪理貨一課' },
  { u: 'luo', n: '駱佩妏', wh: '大溪倉', d: '大溪理貨一課' },
  { u: 'm5426', n: '駱眉綺', wh: '大溪倉', d: '大溪理貨一課' },
  { u: 'yu0314', n: '方心妤', wh: '大溪倉', d: '大溪理貨二課' },
  { u: 'bigcavan', n: '全雅慈', wh: '大溪倉', d: '大溪理貨二課' },
  { u: 'jiu120914', n: '江映慈', wh: '大溪倉', d: '大溪理貨二課' },
  { u: 'kelly1009', n: '呂羿螢', wh: '大溪倉', d: '大溪理貨二課' },
  { u: 'the1053', n: '林玠含', wh: '大溪倉', d: '大溪理貨二課' },
  { u: 'avon', n: '林雅芳', wh: '大溪倉', d: '大溪理貨二課' },
  { u: 'yilu1983', n: '陳怡茹', wh: '大溪倉', d: '大溪理貨二課' },
  { u: 'yung', n: '陳詩永', wh: '大溪倉', d: '大溪理貨二課' },
  { u: 'cschen', n: '陳嘉興', wh: '大溪倉', d: '大溪理貨二課' },
  { u: 'winnie2023', n: '黃安笛', wh: '大溪倉', d: '大溪理貨二課' },
  { u: 'kun1201', n: '楊裔堃', wh: '大溪倉', d: '大溪理貨二課' },
  { u: 'liwen1212', n: '董麗雯', wh: '大溪倉', d: '大溪理貨二課' },
  { u: 'jz13', n: '劉俊助', wh: '大溪倉', d: '大溪理貨二課' },
  { u: 'ning', n: '鄭亦甯', wh: '大溪倉', d: '大溪理貨二課' },
  { u: 'zheng1212', n: '鄭喻云', wh: '大溪倉', d: '大溪理貨二課' },
  { u: 'hw289', n: '鄭惠雯', wh: '大溪倉', d: '大溪理貨二課' },
  { u: 'jiarong84', n: '謝佳蓉', wh: '大溪倉', d: '大溪理貨二課' },
  { u: 'upin0122', n: '鍾玉屏', wh: '大溪倉', d: '大溪理貨二課' },
  { u: 'cami700220', n: '李淑惠', wh: '大溪倉', d: '倉儲管理課' },
  { u: 'judy', n: '林麗雲', wh: '大溪倉', d: '倉儲管理課' },
  { u: 'beyi', n: '洪淑娥', wh: '大溪倉', d: '倉儲管理課' },
  { u: 'papa0130', n: '洪逸樺', wh: '大溪倉', d: '倉儲管理課' },
  { u: 'lin', n: '張秋梅', wh: '大溪倉', d: '倉儲管理課' },
  { u: 'adychang', n: '張綾娟', wh: '大溪倉', d: '倉儲管理課' },
  { u: 'wandychen', n: '陳怡如', wh: '大溪倉', d: '倉儲管理課' },
  { u: 'choeuyi', n: '陳明憶', wh: '大溪倉', d: '倉儲管理課' },
  { u: 'lulu5566', n: '曾郁茹', wh: '大溪倉', d: '倉儲管理課' },
  { u: 'kun1201', n: '楊裔堃', wh: '大溪倉', d: '倉儲管理課' },
  { u: 'angieliau', n: '廖亞仙', wh: '大溪倉', d: '倉儲管理課' },
  { u: 'soda0968', n: '蔡欣如', wh: '大溪倉', d: '倉儲管理課' },
  { u: 'lynn110501', n: '鄭伊伶', wh: '大溪倉', d: '倉儲管理課' },
  { u: 'huei', n: '蕭嘉慧', wh: '大溪倉', d: '倉儲管理課' },
  { u: 'antin', n: '鮑玉婷', wh: '大溪倉', d: '倉儲管理課' },
  { u: 'ebba', n: '鍾惠玲', wh: '大溪倉', d: '倉儲管理課' },
  { u: 'vcd5240', n: '江衍成', wh: '大溪倉', d: '運務課' },
  { u: 'elinor3514', n: '吳巧婷', wh: '大溪倉', d: '運務課' },
  { u: 'duck1027', n: '李淑芬', wh: '大溪倉', d: '運務課' },
  { u: 'sonialin', n: '林佩菁', wh: '大溪倉', d: '運務課' },
  { u: 'jia0818', n: '姜佳玟', wh: '大溪倉', d: '運務課' },
  { u: 'reyi159357', n: '梁景棠', wh: '大溪倉', d: '運務課' },
  { u: 'scott07', n: '許聖堯', wh: '大溪倉', d: '運務課' },
  { u: 'ning1225', n: '陳彥寧', wh: '大溪倉', d: '運務課' },
  { u: 'fang', n: '陳桂芳', wh: '大溪倉', d: '運務課' },
  { u: 'julie1020', n: '黃馨儀', wh: '大溪倉', d: '運務課' },
  { u: 'kun1201', n: '楊裔堃', wh: '大溪倉', d: '運務課' },
  { u: 'akane1527', n: '蔡孟純', wh: '大溪倉', d: '運務課' },
  { u: 'chinhon', n: '蔡承翰', wh: '大溪倉', d: '運務課' },
  { u: 'feather', n: '盧嬿羽', wh: '大溪倉', d: '運務課' },
  { u: 'iwsweet168', n: '簡志富', wh: '大溪倉', d: '運務課' },
  { u: 'jerry16899', n: '黃則翰', wh: '可視全倉', d: '主管' },
  { u: 'bin.liu', n: '劉宏斌', wh: '可視全倉', d: '主管' },
  { u: 'kun1201', n: '楊裔堃', wh: '可視全倉', d: '主管' },
  { u: 'mgmg.wang', n: '王筱鎂', wh: '可視全倉', d: '主管' },
  { u: 'vincent', n: '黃文呈', wh: '可視全倉', d: '主管' },
];

async function seedDaxiAreaEmployees() {
  const { rows: existingUsers } = await pool.query('SELECT username FROM users');
  const existingUsernames = new Set(existingUsers.map(r => r.username));

  // 1. 建立帳號（role=area）；已存在者不動，避免覆蓋管理員手動調整過的角色
  const uniqueUsers = [...new Map(DAXI_AREA_EMPLOYEES.map(e => [e.u, e])).values()];
  let created = 0;
  for (const e of uniqueUsers) {
    if (existingUsernames.has(e.u)) continue;
    await pool.query(
      `INSERT INTO users (id, username, password_hash, role, approved, display_name, page_perms, fn_perms)
       VALUES ($1, $2, 'ad_auth_only', 'area', true, $3, '{}', '{}')
       ON CONFLICT (username) DO NOTHING`,
      [e.u, e.u, e.n]
    );
    created++;
  }
  if (created > 0) console.log(`大溪倉員工帳號：新建 ${created} 筆`);

  // 名單內既有的 AD 帳號若仍是最低權限(worker)，升級為 area：
  // 這些人本就在正式名單上，不應被後續的權限申請關卡擋在門外。
  // 僅處理 AD 帳號（password_hash='ad_auth_only'）且僅由 worker 升，不動管理員。
  const listedUsernames = uniqueUsers.map(e => e.u);
  const { rowCount: upgraded } = await pool.query(
    `UPDATE users SET role = 'area', approved = true
      WHERE username = ANY($1) AND role = 'worker' AND password_hash = 'ad_auth_only'`,
    [listedUsernames]
  );
  if (upgraded > 0) console.log(`大溪倉員工帳號：${upgraded} 筆由 worker 升級為 area`);

  // 2. 倉別：主管開放全倉，其餘僅大溪倉（wh1）；僅更新尚未設定者，不覆蓋手動調整
  const supers = [...new Set(DAXI_AREA_EMPLOYEES.filter(e => e.wh === '可視全倉').map(e => e.u))];
  const normals = [...new Set(DAXI_AREA_EMPLOYEES.filter(e => e.wh !== '可視全倉').map(e => e.u))]
    .filter(u => !supers.includes(u));
  if (supers.length)  await pool.query(`UPDATE users SET allowed_warehouses = '{wh1,wh2,wh3}' WHERE username = ANY($1) AND allowed_warehouses = '{}'`, [supers]);
  if (normals.length) await pool.query(`UPDATE users SET allowed_warehouses = '{wh1}' WHERE username = ANY($1) AND allowed_warehouses = '{}'`, [normals]);

  // 3. 人員清冊：依「帳號＋課別」為單位，新增缺少者並同步課別名稱
  const { rows } = await pool.query("SELECT data FROM app_state WHERE id='main'");
  const state = rows[0]?.data;
  if (!state) return; // app_state 尚未初始化，待管理員首次登入後再寫入

  const existing = Array.isArray(state.employees) ? state.employees : [];
  const byId = new Map(existing.map(e => [e.id, e]));
  let added = 0, updated = 0;
  for (const e of DAXI_AREA_EMPLOYEES) {
    if (e.wh === '可視全倉') continue; // 主管不列入各課別清冊
    const id = `emp_${e.u}_${e.d.replace(/[^a-z0-9]/gi, '')}`;
    const cur = byId.get(id);
    if (!cur) {
      byId.set(id, { id, empId: e.u, name: e.n, vendor: '', dept: e.d, group: '', status: '在職' });
      added++;
    } else if (cur.dept !== e.d || cur.name !== e.n) {
      byId.set(id, { ...cur, name: e.n, dept: e.d });
      updated++;
    }
  }
  if (added === 0 && updated === 0) return;

  const merged = [...byId.values()];
  await pool.query(
    `UPDATE app_state SET data = jsonb_set(data, '{employees}', $1::jsonb), updated_at = NOW() WHERE id='main'`,
    [JSON.stringify(merged)]
  );
  console.log(`大溪倉人員清冊：新增 ${added} 筆、更新 ${updated} 筆`);
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
  // 設定大溪倉權限（wh1），僅對尚未指派倉別的帳號更新
  const daxiUsernames = DAXI_EMPLOYEES.map(e => e.u);
  await pool.query(
    `UPDATE users SET allowed_warehouses = '{wh1}' WHERE username = ANY($1) AND allowed_warehouses = '{}'`,
    [daxiUsernames]
  );

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

// ── 大肚倉/岡山倉 Area 員工種子資料 ──────────────────────────────────────────
// role=area：可使用所有分頁功能（班表管理、點名表、人員清冊、報表、班別設定等）
// 注意：同一帳號出現在多課別時，清冊建多筆，帳號建一筆（ON CONFLICT DO NOTHING）
const AREA_EMPLOYEES = [
  // 大肚倉、大肚理貨課
  { u: 'ef322202',   n: '李依芳', d: '大肚理貨課', wh: '大肚倉' },
  { u: 'seven0826',  n: '卓亭宜', d: '大肚理貨課', wh: '大肚倉' },
  { u: 'lan0916',    n: '周春蘭', d: '大肚理貨課', wh: '大肚倉' },
  { u: 'kunyi',      n: '林坤易', d: '大肚理貨課', wh: '大肚倉' },
  { u: 'luu1204',    n: '林芸羽', d: '大肚理貨課', wh: '大肚倉' },
  { u: 'ting0424',   n: '林宴停', d: '大肚理貨課', wh: '大肚倉' },
  { u: 'emma',       n: '張惠真', d: '大肚理貨課', wh: '大肚倉' },
  { u: 'bei57617',   n: '陳芊貝', d: '大肚理貨課', wh: '大肚倉' },
  { u: 'jar147258',  n: '陳宜蓁', d: '大肚理貨課', wh: '大肚倉' },
  { u: 'jessica',    n: '陳美英', d: '大肚理貨課', wh: '大肚倉' },
  { u: 'green8',     n: '温哲凱', d: '大肚理貨課', wh: '大肚倉' },
  { u: 'funnyjesus', n: '游世萱', d: '大肚理貨課', wh: '大肚倉' },
  { u: 'david0403',  n: '黃冠龍', d: '大肚理貨課', wh: '大肚倉' },
  { u: 'boom517',    n: '廖玲平', d: '大肚理貨課', wh: '大肚倉' },
  { u: 'ru850513',   n: '潘如瑩', d: '大肚理貨課', wh: '大肚倉' },
  { u: 'reyisummer', n: '蕭俐芸', d: '大肚理貨課', wh: '大肚倉' },
  { u: 'sakula',     n: '謝佳蓁', d: '大肚理貨課', wh: '大肚倉' },
  { u: 'usacoca',    n: '謝尚蓁', d: '大肚理貨課', wh: '大肚倉' },
  { u: 'c830627',    n: '蘇柏任', d: '大肚理貨課', wh: '大肚倉' },
  // 大肚倉、大肚運務課
  { u: 'alanwn',     n: '王世輝', d: '大肚運務課', wh: '大肚倉' },
  { u: '5000xp',     n: '余武謙', d: '大肚運務課', wh: '大肚倉' },
  { u: 'zongyue27',  n: '呂宗岳', d: '大肚運務課', wh: '大肚倉' },
  { u: 'luckyx67',   n: '陳育棋', d: '大肚運務課', wh: '大肚倉' },
  { u: 'reyi1002',   n: '彭惠美', d: '大肚運務課', wh: '大肚倉' },
  { u: 'graciaywl',  n: '廖弈雯', d: '大肚運務課', wh: '大肚倉' },
  { u: 'liou0707',   n: '劉芷榕', d: '大肚運務課', wh: '大肚倉' },
  { u: 'lyx01912',   n: '賴宜欣', d: '大肚運務課', wh: '大肚倉' },
  // 岡山倉、岡山營運課
  { u: 'nina2628',     n: '何凰薇', d: '岡山營運課', wh: '岡山倉' },
  { u: 'njwu09',       n: '吳念臻', d: '岡山營運課', wh: '岡山倉' },
  { u: 'shiyaolin9',   n: '林士堯', d: '岡山營運課', wh: '岡山倉' },
  { u: 'd8r999123',    n: '張文仁', d: '岡山營運課', wh: '岡山倉' },
  { u: 'yingyun',      n: '張孆芸', d: '岡山營運課', wh: '岡山倉' },
  { u: 'yimin',        n: '郭依旻', d: '岡山營運課', wh: '岡山倉' },
  { u: 'vivn',         n: '陳家淇', d: '岡山營運課', wh: '岡山倉' },
  { u: 'vincent',      n: '黃文呈', d: '岡山營運課', wh: '岡山倉' },  // 清冊多一筆，帳號不重建
  { u: 'l098316816',   n: '楊凱汎', d: '岡山營運課', wh: '岡山倉' },
  { u: 'amber1253',    n: '葉宇涵', d: '岡山營運課', wh: '岡山倉' },
  { u: 'orzyaloco',    n: '葉濡溢', d: '岡山營運課', wh: '岡山倉' },
  { u: 'hsuan',        n: '蔡昀暄', d: '岡山營運課', wh: '岡山倉' },
  { u: 'leo0961',      n: '鄧勝献', d: '岡山營運課', wh: '岡山倉' },
  { u: 'allthebest',   n: '賴建廷', d: '岡山營運課', wh: '岡山倉' },
];

async function seedAreaEmployees() {
  // 取得已建立帳號集合，避免重複
  const { rows: existingUsers } = await pool.query('SELECT username FROM users');
  const existingUsernames = new Set(existingUsers.map(r => r.username));

  // 1. 建立 users（role=area，ON CONFLICT DO NOTHING 保護現有帳號）
  const uniqueUsers = [...new Map(AREA_EMPLOYEES.map(e => [e.u, e])).values()];
  let usersCreated = 0;
  for (const e of uniqueUsers) {
    if (existingUsernames.has(e.u)) continue; // 已存在（含 grace admin）跳過
    await pool.query(
      `INSERT INTO users (id, username, password_hash, role, approved, display_name, page_perms, fn_perms)
       VALUES ($1, $2, 'ad_auth_only', 'area', true, $3, '{}', '{}')
       ON CONFLICT (username) DO NOTHING`,
      [e.u, e.u, e.n]
    );
    usersCreated++;
  }
  if (usersCreated > 0) console.log(`大肚/岡山員工帳號：新建 ${usersCreated} 筆`);

  // 設定各帳號的倉別限制（冪等：僅更新尚未設定者）
  const wh2Users = [...new Set(AREA_EMPLOYEES.filter(e => e.wh === '大肚倉').map(e => e.u))];
  const wh3Users = [...new Set(AREA_EMPLOYEES.filter(e => e.wh === '岡山倉').map(e => e.u))];
  // 同時在兩倉的帳號取交集
  const bothUsers = wh2Users.filter(u => wh3Users.includes(u));
  const onlyWh2   = wh2Users.filter(u => !wh3Users.includes(u));
  const onlyWh3   = wh3Users.filter(u => !wh2Users.includes(u));
  if (onlyWh2.length)   await pool.query(`UPDATE users SET allowed_warehouses = '{wh2}' WHERE username = ANY($1) AND allowed_warehouses = '{}'`, [onlyWh2]);
  if (onlyWh3.length)   await pool.query(`UPDATE users SET allowed_warehouses = '{wh3}' WHERE username = ANY($1) AND allowed_warehouses = '{}'`, [onlyWh3]);
  if (bothUsers.length) await pool.query(`UPDATE users SET allowed_warehouses = '{wh2,wh3}' WHERE username = ANY($1) AND allowed_warehouses = '{}'`, [bothUsers]);

  // 2. 更新 app_state.employees（每個倉別+課別的員工清冊）
  const { rows } = await pool.query("SELECT data FROM app_state WHERE id='main'");
  const state = rows[0]?.data;
  if (!state) return;

  const existing    = Array.isArray(state.employees) ? state.employees : [];
  const existingIds = new Set(existing.map(e => e.id));

  const toAdd = [];
  for (const e of AREA_EMPLOYEES) {
    const empId = `emp_${e.u}_${e.d.replace(/[^a-z0-9]/gi, '')}`;
    if (!existingIds.has(empId)) {
      toAdd.push({ id: empId, empId: e.u, name: e.n, vendor: '', dept: e.d, group: '', status: '在職' });
    }
  }

  if (toAdd.length === 0) return;
  const merged = [...existing, ...toAdd];
  await pool.query(
    `INSERT INTO app_state (id, data, updated_at) VALUES ('main', $1, NOW())
     ON CONFLICT (id) DO UPDATE SET data = $1, updated_at = NOW()`,
    [{ ...state, employees: merged }]
  );
  console.log(`大肚/岡山員工清冊：新增 ${toAdd.length} 筆`);
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
    { id: user.id, username: user.username, role: user.role, page_perms: user.page_perms, fn_perms: user.fn_perms, allowedWarehouses: user.allowed_warehouses || [], vendors: user.vendors || [], employeeId: user.employeeId },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

function safeUser(u) {
  return {
    id:                u.id,
    username:          u.username,
    name:              u.display_name || u.username || '',
    display_name:      u.display_name      || '',
    role:              u.role,
    page_perms:        u.page_perms        || [],
    fn_perms:          u.fn_perms          || [],
    allowedWarehouses: u.allowed_warehouses || [],
    vendors:           u.vendors           || [],
    approved:          u.approved,
    last_login:        u.last_login,
    request_note:      u.request_note || '',
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
  if (!checkLoginRate(ip, req.body?.USER_ID)) return res.status(429).json({ error: '登入嘗試次數過多，請 15 分鐘後再試' });

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
      // 首次 AD 登入且不在任何名單內：自動建立「權限申請」紀錄（approved=false）
      // AD 驗證已通過，身分可信，故直接受理申請，不另設未驗證的申請端點
      const isGrace = uname === 'grace';
      const { rows: created } = await pool.query(
        `INSERT INTO users (id, username, password_hash, role, approved, display_name, page_perms, fn_perms)
         VALUES ($1, $2, 'ad_auth_only', $3, $4, $5, '{}', '{}') RETURNING *`,
        [uname, uname, isGrace ? 'admin' : 'worker', isGrace, uname]
      );
      user = created[0];
      console.log(`AD 首次登入: ${uname}，角色: ${user.role}，已核准: ${user.approved}`);
    } else {
      // 既有帳號的資料補正：grace 固定為管理員；
      // 已具日翊/管理員角色者，AD 驗證成功即視為核准（相容舊資料）。
      // 注意：不可無條件核准，否則權限申請關卡形同虛設。
      const sets = [];
      if (uname === 'grace' && user.role !== 'admin') { sets.push(`role='admin'`); user.role = 'admin'; }
      if (!user.approved && (user.role === 'admin' || user.role === 'area')) {
        sets.push(`approved=true`); user.approved = true;
      }
      if (sets.length) await pool.query(`UPDATE users SET ${sets.join(',')} WHERE id=$1`, [user.id]);
    }

    // 權限申請關卡：尚未取得日翊/管理員角色者不得進入系統
    if (!user.approved || (user.role !== 'admin' && user.role !== 'area')) {
      return res.status(403).json({
        code: 'need_access_request',
        username: user.username,
        error: '您的帳號尚未開通使用權限，已為您送出申請，請等候管理員核准。',
      });
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
  const { role, approved, page_perms, fn_perms, allowed_warehouses, vendors } = req.body ?? {};

  const { rows: existing } = await pool.query('SELECT username FROM users WHERE id=$1', [id]);
  if (!existing[0]) return res.status(404).json({ error: '找不到此帳號' });
  if (existing[0].username === 'grace' && role && role !== 'admin') {
    return res.status(400).json({ error: 'grace 帳號不可降級' });
  }

  const sets = [], vals = [];
  if (role               !== undefined) { vals.push(role);               sets.push(`role=$${vals.length}`); }
  if (approved           !== undefined) { vals.push(approved);           sets.push(`approved=$${vals.length}`); }
  if (page_perms         !== undefined) { vals.push(page_perms);         sets.push(`page_perms=$${vals.length}`); }
  if (fn_perms           !== undefined) { vals.push(fn_perms);           sets.push(`fn_perms=$${vals.length}`); }
  if (allowed_warehouses !== undefined) { vals.push(allowed_warehouses); sets.push(`allowed_warehouses=$${vals.length}`); }
  if (vendors           !== undefined) { vals.push(vendors);            sets.push(`vendors=$${vals.length}`); }
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
  try {
    const { rows } = await pool.query("SELECT data FROM app_state WHERE id='main'");
    res.json(rows[0]?.data ?? null);
  } catch (e) {
    console.error('GET /api/state DB error:', e.message);
    res.status(503).json({ error: 'db_unavailable' });
  }
});

// ── GET /api/schedule （所有登入角色可讀，供 worker/vendor 取得班表）─
app.get('/api/schedule', requireAuth, async (req, res) => {
  const { rows } = await pool.query("SELECT data FROM app_state WHERE id='main'");
  const data = rows[0]?.data ?? {};
  res.json({
    schedule:        data.schedule        ?? {},
    scheduleRange:   data.scheduleRange   ?? {},
    openHolidays:    data.openHolidays    ?? [],
    shiftCodeRows:   data.shiftCodeRows   ?? [],
    shiftCodeHeaders:data.shiftCodeHeaders ?? [],
    employees:       (data.employees ?? []).map(e => ({
      id: e.id, empId: e.empId, name: e.name, vendor: e.vendor,
      shiftType: e.shiftType, group: e.group, dept: e.dept,
      warehouse: e.warehouse, section: e.section, status: e.status,
    })),
    vendors:     data.vendors     ?? [],
    warehouses:  data.warehouses  ?? [],
    systemLocked: data.systemLocked ?? false,
    deptLocks:    data.deptLocks ?? {},
    deptRanges:   data.deptRanges ?? {},
    vendorHolidayOpen: data.vendorHolidayOpen ?? false,
  });
});

// ── PUT /api/state ────────────────────────────────────────
// 以 merge 方式更新，保留 attendData / extras（由 PUT /api/attendance 管理）
// vendor/worker 角色只允許寫入 schedule 欄位，其餘欄位由 admin/area 管理
app.put('/api/state', requireAuth, async (req, res) => {
  const role = req.user?.role;
  if (role !== 'admin' && role !== 'area' && role !== 'vendor' && role !== 'worker')
    return res.status(403).json({ error: '無存取權限' });
  const incoming = req.body;
  // 移除 attendData / extras，避免覆蓋 vendor 透過 /api/attendance 存入的出勤紀錄
  const { attendData: _a, extras: _e, ...rest } = incoming;
  // vendor/worker 僅允許寫入 schedule（班表），避免覆蓋系統設定
  if (role === 'vendor' || role === 'worker') {
    const { schedule } = rest;
    if (!schedule || Object.keys(schedule).length === 0) return res.json({ ok: true });
    try {
      const { rows: curRows } = await pool.query("SELECT data FROM app_state WHERE id='main'");
      const curData = curRows[0]?.data ?? {};
      const employees = curData.employees ?? [];

      // 範圍限制：vendor 只能寫自己廠商員工的班表，worker 只能寫自己
      let allowedIds;
      if (role === 'vendor') {
        const allowedVendors = req.user.vendors ?? [];
        if (allowedVendors.length === 0) return res.status(403).json({ error: '無廠商歸屬' });
        allowedIds = new Set(employees.filter(e => allowedVendors.includes(e.vendor)).map(e => e.id));
      } else {
        allowedIds = new Set([req.user.employeeId]);
      }

      // 逐員工、逐日 merge（避免整包快照覆蓋其他人剛存入的異動，造成資料遺失）
      const curSchedule = curData.schedule ?? {};
      const mergedSchedule = { ...curSchedule };
      for (const [empId, days] of Object.entries(schedule)) {
        if (!allowedIds.has(empId)) continue; // 過濾越權寫入（防止繞過前端直接改別人班表）
        if (days && Object.keys(days).length > 0)
          mergedSchedule[empId] = { ...(curSchedule[empId] ?? {}), ...days };
      }

      await pool.query(
        `INSERT INTO app_state (id, data, updated_at) VALUES ('main', $1::jsonb, NOW())
         ON CONFLICT (id) DO UPDATE
           SET data = jsonb_set(app_state.data, '{schedule}', $1::jsonb->'schedule'),
               updated_at = NOW()`,
        [JSON.stringify({ schedule: mergedSchedule })]
      );
      return res.json({ ok: true });
    } catch (e) {
      console.error('PUT /api/state (vendor/worker) DB error:', e.message);
      return res.status(503).json({ error: 'db_unavailable' });
    }
  }
  // 防呆：employees/vendors/warehouses 若為空陣列，從 payload 中移除（不以空值覆蓋 DB）
  // 避免前端種子資料或載入失敗時的空狀態覆蓋 DB 真實資料
  if (Array.isArray(rest.employees)  && rest.employees.length  === 0) delete rest.employees;
  if (Array.isArray(rest.vendors)    && rest.vendors.length    === 0) delete rest.vendors;
  if (Array.isArray(rest.warehouses) && rest.warehouses.length === 0) delete rest.warehouses;
  if (Object.keys(rest).length === 0) return res.json({ ok: true });
  // schedule：逐員工、逐日 merge（避免 admin/area 多裝置同時存檔時，後存者的舊快照蓋掉先存者剛異動的其他員工資料）
  if (rest.schedule && Object.keys(rest.schedule).length > 0) {
    try {
      const { rows: curRows } = await pool.query("SELECT data FROM app_state WHERE id='main'");
      const curSchedule = curRows[0]?.data?.schedule ?? {};
      const mergedSchedule = { ...curSchedule };
      for (const [empId, days] of Object.entries(rest.schedule)) {
        if (days && Object.keys(days).length > 0)
          mergedSchedule[empId] = { ...(curSchedule[empId] ?? {}), ...days };
      }
      rest.schedule = mergedSchedule;
    } catch (e) {
      console.error('PUT /api/state schedule merge 讀取失敗:', e.message);
    }
  }
  try {
    await pool.query(
      `INSERT INTO app_state (id, data, updated_at) VALUES ('main', $1::jsonb, NOW())
       ON CONFLICT (id) DO UPDATE
         SET data = app_state.data || $1::jsonb,
             updated_at = NOW()`,
      [JSON.stringify(rest)]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('PUT /api/state DB error:', e.message);
    res.status(503).json({ error: 'db_unavailable' });
  }
});

// ── POST /api/auth/vendor-register （admin only）─────────
// 管理員核准廠商帳號或升級委外幹部時，將帳號寫入 DB
app.post('/api/auth/vendor-register', requireAuth, requireAdmin, async (req, res) => {
  const { id, username, password_hash, name, vendors, allowed_warehouses } = req.body ?? {};
  if (!username || !password_hash) return res.status(400).json({ error: '缺少必要欄位' });
  try {
    await pool.query(
      `INSERT INTO users (id, username, password_hash, role, display_name, vendors, allowed_warehouses, approved, created_at)
       VALUES ($1, $2, $3, 'vendor', $4, $5, $6, true, NOW())
       ON CONFLICT (username) DO UPDATE
         SET password_hash=$3, role='vendor', display_name=$4,
             vendors=$5, allowed_warehouses=$6, approved=true`,
      [id || username, username, password_hash, name || username,
       vendors || [], allowed_warehouses || []]
    );
    const { rows } = await pool.query('SELECT * FROM users WHERE username=$1', [username]);
    res.json({ ok: true, user: safeUser(rows[0]) });
  } catch (e) {
    console.error('vendor-register error:', e.message);
    res.status(500).json({ error: '伺服器錯誤' });
  }
});

// ── POST /api/auth/vendor-login ──────────────────────────
// 廠商幹部登入：支援兩種模式
//   password     — 明文密碼，server 以 PBKDF2 驗證（DB 帳號直接登入）
//   passwordHash — 前端已雜湊的完整字串，直接比對（舊模式向後相容）
const verifyPbkdf2 = (plain, stored) => new Promise((resolve, reject) => {
  if (!stored || !stored.startsWith('pbkdf2:')) return resolve(false);
  const [, saltHex, hashHex] = stored.split(':');
  const salt = Buffer.from(saltHex, 'hex');
  nodeCrypto.pbkdf2(plain, salt, 200000, 32, 'sha256', (err, derived) => {
    if (err) return reject(err);
    resolve(derived.toString('hex') === hashHex);
  });
});

const hashPbkdf2 = (plain) => new Promise((resolve, reject) => {
  const salt = nodeCrypto.randomBytes(16);
  nodeCrypto.pbkdf2(plain, salt, 200000, 32, 'sha256', (err, derived) => {
    if (err) return reject(err);
    resolve(`pbkdf2:${salt.toString('hex')}:${derived.toString('hex')}`);
  });
});

app.post('/api/auth/vendor-login', async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0] ?? req.socket.remoteAddress ?? 'unknown';
  if (!checkLoginRate(ip, req.body?.username)) return res.status(429).json({ error: '登入嘗試次數過多，請 15 分鐘後再試' });
  const { username, password, passwordHash } = req.body ?? {};
  if (!username || (!password && !passwordHash))
    return res.status(400).json({ error: '缺少帳號或密碼' });
  try {
    const { rows } = await pool.query(
      `SELECT * FROM users WHERE username=$1 AND role='vendor' AND approved=true`, [username]
    );
    let user = rows[0];
    if (!user) {
      // 帳號不在 users 表：嘗試從 app_state 找（升級流程未成功寫入 DB 的情況）
      const { rows: stateRows } = await pool.query("SELECT data FROM app_state WHERE id='main'");
      const stateUsers = stateRows[0]?.data?.users ?? [];
      const su = stateUsers.find(u => String(u.username ?? '').trim() === String(username).trim() && u.role === 'vendor');
      if (!su) return res.status(401).json({ error: '帳號不存在' });
      // 找到後自動補建 DB 記錄
      const defaultHash = await hashPbkdf2(username);
      await pool.query(
        `INSERT INTO users (id, username, password_hash, role, display_name, vendors, allowed_warehouses, approved, created_at)
         VALUES ($1, $2, $3, 'vendor', $4, $5, $6, true, NOW())
         ON CONFLICT (username) DO UPDATE
           SET password_hash=$3, role='vendor', display_name=$4,
               vendors=$5, allowed_warehouses=$6, approved=true`,
        [su.id || su.username, su.username, defaultHash, su.name || su.username,
         su.vendors || [], su.allowedWarehouses || []]
      );
      const { rows: newRows } = await pool.query('SELECT * FROM users WHERE username=$1', [username]);
      user = newRows[0];
      if (!user) return res.status(500).json({ error: '帳號建立失敗' });
    }
    const stored = user.password_hash;
    let ok = false;
    let firstLogin = false;
    if (!stored || !stored.startsWith('pbkdf2:')) {
      // 無密碼設定（帳號升級但未設密碼）：允許用帳號名稱當首次登入密碼
      ok = (password && password === user.username);
      firstLogin = true;
    } else if (password) {
      ok = await verifyPbkdf2(password, stored);
    } else {
      ok = (stored === passwordHash);
    }
    if (!ok) return res.status(401).json({ error: '密碼錯誤' });
    if (firstLogin && password) {
      const newHash = await hashPbkdf2(password);
      await pool.query('UPDATE users SET password_hash=$1, last_login=NOW() WHERE id=$2', [newHash, user.id]);
    } else {
      await pool.query('UPDATE users SET last_login=NOW() WHERE id=$1', [user.id]);
    }
    return res.json({ token: issueToken(user), user: safeUser(user), mustChangePassword: firstLogin });
  } catch (e) {
    console.error('vendor-login error:', e.message);
    return res.status(500).json({ error: '伺服器錯誤' });
  }
});

// ── GET /api/attendance （admin / area / vendor / worker 可讀）─────
app.get('/api/attendance', requireAuth, async (req, res) => {
  const role = req.user?.role;
  if (!['admin','area','vendor','worker'].includes(role))
    return res.status(403).json({ error: '無存取權限' });
  const { rows } = await pool.query("SELECT data FROM app_state WHERE id='main'");
  const data = rows[0]?.data ?? {};
  // worker 只能看到自己的紀錄
  if (role === 'worker') {
    const empId = req.user.employeeId;
    const filtered = {};
    for (const [date, dayMap] of Object.entries(data.attendData ?? {})) {
      if (dayMap?.[empId]) filtered[date] = { [empId]: dayMap[empId] };
    }
    return res.json({ attendData: filtered, extras: {} });
  }
  res.json({ attendData: data.attendData ?? {}, extras: data.extras ?? {} });
});

// ── PUT /api/attendance （admin / area / vendor / worker 可寫）─────
app.put('/api/attendance', requireAuth, async (req, res) => {
  const role = req.user?.role;
  if (!['admin','area','vendor','worker'].includes(role))
    return res.status(403).json({ error: '無存取權限' });

  let { attendData, extras } = req.body ?? {};
  attendData = attendData ?? {};
  extras     = extras     ?? {};

  // worker scope：只允許寫入自己的紀錄，不可新增/修改臨時人員
  if (role === 'worker') {
    const empId = req.user.employeeId;
    const filteredAttend = {};
    for (const [date, dayMap] of Object.entries(attendData)) {
      if (dayMap?.[empId]) filteredAttend[date] = { [empId]: dayMap[empId] };
    }
    attendData = filteredAttend;
    extras = {};
  }

  // vendor scope：只允許寫入自己廠商員工的資料
  if (role === 'vendor') {
    const allowedVendors = req.user.vendors ?? [];
    if (allowedVendors.length === 0) return res.status(403).json({ error: '無廠商歸屬' });

    // 從 DB 取得所有員工，篩出屬於此 vendor 的 ID 集合
    const { rows: stateRows } = await pool.query("SELECT data FROM app_state WHERE id='main'");
    const employees = stateRows[0]?.data?.employees ?? [];
    const allowedIds = new Set(
      employees.filter(e => allowedVendors.includes(e.vendor)).map(e => e.id)
    );

    // 過濾 attendData：每個日期只保留 allowedIds 的 key
    const filteredAttend = {};
    for (const [date, dayMap] of Object.entries(attendData)) {
      const filtered = {};
      for (const [empId, val] of Object.entries(dayMap)) {
        if (allowedIds.has(empId)) filtered[empId] = val;
      }
      if (Object.keys(filtered).length > 0) filteredAttend[date] = filtered;
    }

    // 過濾 extras：每個日期只保留屬於此 vendor 的臨時人員
    const filteredExtras = {};
    for (const [date, list] of Object.entries(extras)) {
      const filtered = (list ?? []).filter(e => allowedVendors.includes(e.vendor));
      if (filtered.length > 0) filteredExtras[date] = filtered;
    }

    attendData = filteredAttend;
    extras     = filteredExtras;
  }

  // 讀取現有資料，做員工層級 merge（避免不同廠商寫同一天時互蓋）
  const { rows: curRows } = await pool.query("SELECT data FROM app_state WHERE id='main'");
  const curAttend = curRows[0]?.data?.attendData ?? {};
  const curExtras = curRows[0]?.data?.extras     ?? {};

  // 空 attendData → 不覆蓋 DB（避免桌機初始化時把空物件寫進 DB，導致其他裝置 init 被清空）
  if (Object.keys(attendData).length === 0 && Object.keys(extras).length === 0)
    return res.json({ ok: true });

  const mergedAttend = { ...curAttend };
  for (const [date, dayMap] of Object.entries(attendData)) {
    if (Object.keys(dayMap).length > 0)
      mergedAttend[date] = { ...(curAttend[date] ?? {}), ...dayMap };
  }

  const mergedExtras = { ...curExtras };
  if (role === 'vendor') {
    const allowedVendorSet = new Set(req.user.vendors ?? []);
    for (const [date, list] of Object.entries(extras)) {
      const others = (curExtras[date] ?? []).filter(e => !allowedVendorSet.has(e.vendor));
      mergedExtras[date] = [...others, ...list];
    }
  } else {
    for (const [date, list] of Object.entries(extras)) {
      mergedExtras[date] = list;
    }
  }

  await pool.query(
    `INSERT INTO app_state (id, data, updated_at) VALUES ('main', $1::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE
       SET data = app_state.data
             || jsonb_build_object('attendData', $1::jsonb->'attendData',
                                   'extras',     $1::jsonb->'extras'),
           updated_at = NOW()`,
    [JSON.stringify({ attendData: mergedAttend, extras: mergedExtras })]
  );
  res.json({ ok: true });
});

// ── GET /api/health ───────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// ── POST /api/auth/worker-login ──────────────────────────
// 委外人員登入：從 app_state 讀取 workerPwds 驗證
//   首次登入（無存 hash）→ 密碼必須等於員編
//   已設密碼 → PBKDF2 驗證
app.post('/api/auth/worker-login', async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0] ?? req.socket.remoteAddress ?? 'unknown';
  if (!checkLoginRate(ip, req.body?.empId)) return res.status(429).json({ error: '登入嘗試次數過多，請 15 分鐘後再試' });
  const { empId, password } = req.body ?? {};
  if (!empId || !password)
    return res.status(400).json({ error: '缺少員編或密碼' });
  try {
    const { rows } = await pool.query("SELECT data FROM app_state WHERE id='main'");
    const data = rows[0]?.data ?? {};
    const employees  = data.employees  ?? [];
    const workerPwds = data.workerPwds ?? {};

    const emp = employees.find(e => String(e.empId ?? '').trim() === String(empId).trim());
    if (!emp) return res.status(401).json({ error: '員工編號不存在' });

    const stored = workerPwds[emp.empId];
    let ok = false;
    if (stored) {
      ok = await verifyPbkdf2(password, stored);
    } else {
      // 首次登入：密碼必須等於員編
      ok = (password === String(emp.empId).trim());
    }
    if (!ok) return res.status(401).json({ error: '密碼錯誤' });
    const token = issueToken({
      id: 'worker_' + emp.id,
      username: emp.empId,
      role: 'worker',
      page_perms: [],
      fn_perms: [],
      allowed_warehouses: [],
      vendors: emp.vendor ? [emp.vendor] : [],
      employeeId: emp.id,
    });
    res.json({
      ok: true,
      token,
      firstLogin: !stored,
      emp: { id: emp.id, empId: emp.empId, name: emp.name, vendor: emp.vendor ?? '' },
    });
  } catch (e) {
    console.error('worker-login error:', e.message);
    return res.status(500).json({ error: '伺服器錯誤' });
  }
});

// ── PUT /api/auth/worker-password ────────────────────────
// 委外人員設定/變更密碼：真正寫入伺服器 workerPwds，避免只存在
// 瀏覽器本機（Teams 等內嵌瀏覽器可能不保留本機資料，每次都被
// 當成「首次登入」）
app.put('/api/auth/worker-password', requireAuth, async (req, res) => {
  if (req.user?.role !== 'worker') return res.status(403).json({ error: '無存取權限' });
  const { passwordHash } = req.body ?? {};
  if (!passwordHash || !passwordHash.startsWith('pbkdf2:')) return res.status(400).json({ error: '密碼格式錯誤' });
  const empId = req.user.username;
  try {
    const newHash = passwordHash;
    await pool.query(
      `INSERT INTO app_state (id, data, updated_at) VALUES ('main', $1::jsonb, NOW())
       ON CONFLICT (id) DO UPDATE
         SET data = jsonb_set(app_state.data, '{workerPwds}',
               COALESCE(app_state.data->'workerPwds', '{}'::jsonb) || $1::jsonb->'workerPwds'),
             updated_at = NOW()`,
      [JSON.stringify({ workerPwds: { [empId]: newHash } })]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('worker-password error:', e.message);
    res.status(500).json({ error: '伺服器錯誤' });
  }
});

// ── POST /api/auth/vendor-apply （公開）───────────────────
// 廠商幹部帳號申請：申請者尚未登入，故為公開端點。
// 一律建立 approved=false，需管理員核准後才能登入。
// ── POST /api/attendance/temp（公開）─────────────────────────
// 臨時人力自助簽到／手機控管。臨時人力沒有帳號，故此端點不需 JWT，
// 但僅允許 upsert 當日 extras 中「自己那一筆」，並做下列限制：
//   1. 每 IP 15 分鐘 120 次（獨立計數器，不與登入共用，避免灌爆此端點時
//      連帶用光登入配額，導致全公司（同一對外 IP）無法登入）
//   2. 日期必須在伺服器日期 ±1 天內（避免竄改歷史出勤）
//   3. 只接受白名單欄位，字串長度設上限
//   4. 單日 extras 筆數上限，避免被灌爆
const TEMP_ALLOWED_FIELDS = new Set([
  'name', 'vendor', 'group', 'warehouse', 'note', 'present', 'signedIn', 'signedOut',
  'phoneSubmitted', 'phoneNotSubmitted',
  ...['morning', 'noon', 'afternoon', 'ot'].flatMap(k => [`${k}Taken`, `${k}Returned`]),
]);
// 時間戳欄位（xxxAt）一律隨對應布林欄位一起接受
const isTempField = k => TEMP_ALLOWED_FIELDS.has(k) ||
  (k.endsWith('At') && TEMP_ALLOWED_FIELDS.has(k.slice(0, -2)));
const MAX_TEMP_PER_DAY = 300;

// 臨時人力手機櫃：固定使用鐵櫃二，75 格。
// 與長期人員不同，臨時人力每天不同人，故櫃號逐日配發、不跨日保留。
// 由伺服器在建檔交易內配號並回傳，臨時人力才知道自己該放幾號格。
const TEMP_LOCKER_CAB = '二';
const TEMP_LOCKER_CAPACITY = 75;

// 姓名比對用正規化：去掉半形／全形空白與零寬字元，避免「林 舒瑩」對不到「林舒瑩」
function normNameSrv(v) {
  return String(v ?? '').replace(/[\s　​﻿]/g, '');
}

function pickTempLocker(dayEntries) {
  const used = new Set(dayEntries
    .filter(e => e.locker?.cab === TEMP_LOCKER_CAB)
    .map(e => e.locker.slot));
  for (let n = 1; n <= TEMP_LOCKER_CAPACITY; n++) if (!used.has(n)) return { cab: TEMP_LOCKER_CAB, slot: n };
  return null;   // 已滿
}

function sanitizeTempPatch(patch) {
  const out = {};
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (!isTempField(k)) continue;
    if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string') out[k] = v.slice(0, 60);
  }
  return out;
}

app.post('/api/attendance/temp', async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0] ?? req.socket.remoteAddress ?? 'unknown';
  if (!hitRate(`temp:${ip}`, 120)) return res.status(429).json({ error: '操作過於頻繁，請稍後再試' });

  const { date, id, patch } = req.body ?? {};
  const dateStr = String(date ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return res.status(400).json({ error: 'date 格式錯誤' });
  const diffDays = Math.abs(Date.now() - Date.parse(`${dateStr}T00:00:00Z`)) / 86400000;
  if (!(diffDays < 2)) return res.status(400).json({ error: '僅能填寫當日資料' });

  const entryId = String(id ?? '');
  if (!/^temp_[A-Za-z0-9_-]{6,60}$/.test(entryId)) return res.status(400).json({ error: 'id 格式錯誤' });

  const clean = sanitizeTempPatch(patch);
  if (Object.keys(clean).length === 0) return res.status(400).json({ error: '無可更新欄位' });

  // 交班尖峰會有多人同時簽到，讀改寫必須在交易內鎖住該列，
  // 否則後寫入者會以自己讀到的舊 extras 覆蓋掉別人剛存的紀錄。
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query("SELECT data FROM app_state WHERE id='main' FOR UPDATE");
    const data = rows[0]?.data;
    if (!data) {
      await client.query('ROLLBACK');
      return res.status(503).json({ error: '系統尚未初始化，請聯繫管理員' });
    }

    const extras = { ...(data.extras ?? {}) };
    const day = [...(extras[dateStr] ?? [])];

    // 先找這位臨時人力先前已綁定的那一筆（自建的 id，或勾稽到派工表後標記的 _claimId）
    let idx = day.findIndex(e => e.id === entryId || e._claimId === entryId);

    // 首次填表：以姓名勾稽當日「派工表匯入（報名狀態＝成功）」名單，
    // 勾稽到就沿用該筆，避免同一人在名單上出現兩列。
    if (idx < 0 && clean.name) {
      const want = normNameSrv(clean.name);
      idx = day.findIndex(e => e._isImport && !e._claimId && normNameSrv(e.name) === want);
      if (idx >= 0) {
        day[idx] = { ...day[idx], _claimId: entryId, locker: day[idx].locker ?? pickTempLocker(day) };
      }
    }

    if (idx >= 0) {
      day[idx] = { ...day[idx], ...clean };
    } else {
      if (day.length >= MAX_TEMP_PER_DAY) {
        await client.query('ROLLBACK');
        return res.status(429).json({ error: '本日臨時人力筆數已達上限' });
      }
      if (!clean.name) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: '姓名為必填' });
      }
      // 姓名不在當日派工表名單上：仍讓他簽到（人已在現場），但標記供幹部查核
      // locker 一律由伺服器決定（不在白名單內，前端無法自行指定）
      const locker = pickTempLocker(day);
      day.push({ id: entryId, present: true, lateEarly: '正常', timeNote: '', absType: '',
                 _isTemp: true, _unlisted: true, ...clean, locker });
    }
    extras[dateStr] = day;

    await client.query(
      `UPDATE app_state SET data = jsonb_set(data, '{extras}', $1::jsonb), updated_at = NOW() WHERE id='main'`,
      [JSON.stringify(extras)]
    );
    await client.query('COMMIT');
    res.json({ ok: true, entry: day[idx >= 0 ? idx : day.length - 1] });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[temp attendance]', err.message);
    res.status(500).json({ error: '儲存失敗' });
  } finally {
    client.release();
  }
});

app.post('/api/auth/vendor-apply', async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0] ?? req.socket.remoteAddress ?? 'unknown';
  if (!checkLoginRate(ip, req.body?.username)) {
    return res.status(429).json({ error: '嘗試次數過多，請 15 分鐘後再試' });
  }
  const { id, username, password_hash, name, vendors, allowed_warehouses } = req.body ?? {};
  const uname = String(username ?? '').trim();
  if (!uname || uname.length > 50) return res.status(400).json({ error: '帳號格式錯誤' });
  if (!password_hash || !String(password_hash).startsWith('pbkdf2:')) {
    return res.status(400).json({ error: '密碼格式錯誤' });
  }
  if (!String(name ?? '').trim()) return res.status(400).json({ error: '請填寫姓名／負責人' });

  try {
    const { rows: dup } = await pool.query('SELECT username FROM users WHERE username=$1', [uname]);
    if (dup.length > 0) return res.status(409).json({ error: '此帳號名稱已被使用，請更換' });

    await pool.query(
      `INSERT INTO users (id, username, password_hash, role, display_name, vendors, allowed_warehouses, approved, created_at)
       VALUES ($1, $2, $3, 'vendor', $4, $5, $6, false, NOW())`,
      [
        String(id || uname).slice(0, 64),
        uname,
        String(password_hash),
        String(name).trim().slice(0, 50),
        Array.isArray(vendors) ? vendors.slice(0, 10) : [],
        Array.isArray(allowed_warehouses) ? allowed_warehouses.slice(0, 10) : [],
      ]
    );
    return res.json({ ok: true });
  } catch (e) {
    console.error('vendor-apply error:', e.message);
    return res.status(500).json({ error: '伺服器錯誤' });
  }
});

// ── POST /api/auth/access-request ─────────────────────────
// 權限申請補件：AD 不回傳姓名，故由申請者自行填寫姓名與所屬單位，供管理員審核判斷。
// 需重新驗證 AD 帳密，避免任何人替他人送出或竄改申請內容。
app.post('/api/auth/access-request', async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0] ?? req.socket.remoteAddress ?? 'unknown';
  if (!checkLoginRate(ip, req.body?.USER_ID)) return res.status(429).json({ error: '嘗試次數過多，請 15 分鐘後再試' });

  const { USER_ID, PSW, name, warehouse, note } = req.body ?? {};
  if (!USER_ID || !PSW) return res.status(400).json({ error: '請輸入帳號及密碼' });
  if (!String(name ?? '').trim()) return res.status(400).json({ error: '請填寫姓名' });

  const ad = await verifyAD(String(USER_ID).trim(), PSW);
  if (!ad.ok) return res.status(401).json({ error: ad.msg || 'AD 驗證失敗' });

  const uname = String(USER_ID).trim().toLowerCase();
  const parts = [`單位：${String(warehouse ?? '').trim() || '未填'}`];
  if (String(note ?? '').trim()) parts.push(`備註：${String(note).trim()}`);
  const requestNote = parts.join('｜').slice(0, 500);

  try {
    const { rowCount } = await pool.query(
      `UPDATE users SET display_name = $2, request_note = $3
        WHERE username = $1 AND approved = false`,
      [uname, String(name).trim().slice(0, 50), requestNote]
    );
    if (rowCount === 0) return res.status(409).json({ error: '此帳號已完成審核，請直接登入' });
    return res.json({ ok: true });
  } catch (e) {
    console.error('access-request error:', e.message);
    return res.status(500).json({ error: '伺服器錯誤' });
  }
});

// ── POST /api/auth/reset-password （admin / area）──────────
// 日翊協助忘記密碼者還原為預設密碼（帳號／員工編號），對方下次登入須設定新密碼。
// 不接受指定密碼：避免協助者知悉他人最終密碼，也沿用系統既有的首次登入規則。
app.post('/api/auth/reset-password', requireAuth, requireManagerOrAdmin, async (req, res) => {
  const { kind, target } = req.body ?? {};
  const key = String(target ?? '').trim();
  if (!key) return res.status(400).json({ error: '缺少帳號或員工編號' });

  try {
    if (kind === 'vendor') {
      // 清空 password_hash → 登入時走首次登入流程（密碼＝帳號）並要求改密碼
      const { rows } = await pool.query(
        `UPDATE users SET password_hash = '' WHERE username = $1 AND role = 'vendor' RETURNING username`,
        [key]
      );
      if (rows.length === 0) return res.status(404).json({ error: '找不到此廠商幹部帳號' });
      return res.json({ ok: true, username: rows[0].username, defaultPassword: rows[0].username });
    }

    if (kind === 'worker') {
      const { rows } = await pool.query("SELECT data FROM app_state WHERE id='main'");
      const data = rows[0]?.data ?? {};
      const emp = (data.employees ?? []).find(e => String(e.empId ?? '').trim() === key);
      if (!emp) return res.status(404).json({ error: '找不到此員工編號' });
      // 移除已設定的密碼 → 回到首次登入狀態（密碼＝員工編號）
      await pool.query(
        `UPDATE app_state
            SET data = jsonb_set(data, '{workerPwds}',
                  COALESCE(data->'workerPwds', '{}'::jsonb) - $1),
                updated_at = NOW()
          WHERE id = 'main'`,
        [emp.empId]
      );
      return res.json({ ok: true, username: emp.empId, name: emp.name, defaultPassword: emp.empId });
    }

    return res.status(400).json({ error: '不支援的重設類型' });
  } catch (e) {
    console.error('reset-password error:', e.message);
    return res.status(500).json({ error: '伺服器錯誤' });
  }
});

// ── GET /api/workers (公開，供委外人員登入驗證用) ─────────
// 回傳 id / empId / name / vendor，不含排班/薪資等敏感資料
app.get('/api/workers', async (_req, res) => {
  try {
    const { rows } = await pool.query("SELECT data FROM app_state WHERE id='main'");
    const employees = rows[0]?.data?.employees ?? [];
    const list = employees
      .filter(e => e.empId && e.name)
      .map(e => ({ id: e.id, empId: String(e.empId).trim(), name: e.name, vendor: e.vendor ?? '' }));
    res.json(list);
  } catch (e) {
    console.error('GET /api/workers error:', e.message);
    res.json([]);
  }
});

// ── Static SPA ────────────────────────────────────────────
const DIST = path.join(__dirname, 'dist');
app.use(express.static(DIST));
app.get('*', (_req, res) => res.sendFile(path.join(DIST, 'index.html')));

// ── Start ─────────────────────────────────────────────────
initDB()
  .then(() => app.listen(PORT, () => console.log(`伺服器啟動，監聽 :${PORT}`)))
  .catch(err => { console.error('啟動失敗:', err); process.exit(1); });
