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
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS login_count        INTEGER NOT NULL DEFAULT 0`);
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

  // 每次容器啟動（＝每次部署）先把當下的 app_state 原封不動另存一份快照。
  // 部署是資料最容易出事的時間點，有了時間戳快照就能指定時間點還原，
  // 不必再靠匯出的 Excel 回補。只保留最近 30 份，避免無限成長。
  // 單格異動軌跡：誰、什麼時候、把哪一位員工的哪一天、從什麼改成什麼。
  // 排班爭議只靠推論永遠說不清楚，這張表就是唯一的事實來源。
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schedule_audit (
      id         BIGSERIAL   PRIMARY KEY,
      at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      username   TEXT,
      role       TEXT,
      ip         TEXT,
      emp_id     TEXT,
      emp_no     TEXT,
      emp_name   TEXT,
      dk         TEXT,
      before_val TEXT,
      after_val  TEXT
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS schedule_audit_emp_idx ON schedule_audit (emp_no, at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS schedule_audit_at_idx  ON schedule_audit (at DESC)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state_backup (
      id         SERIAL      PRIMARY KEY,
      data       JSONB       NOT NULL,
      note       TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  try {
    const { rows: snap } = await pool.query("SELECT data FROM app_state WHERE id='main'");
    if (snap[0]?.data) {
      await pool.query('INSERT INTO app_state_backup (data, note) VALUES ($1, $2)',
        [snap[0].data, '啟動備份 ' + new Date().toISOString()]);
      await pruneBackups();
      console.log('啟動備份完成：app_state 已另存快照');
    }
  } catch (e) {
    console.error('啟動備份失敗（不影響服務啟動）:', e.message);
  }
  await ensureDailyBackup();   // 啟動時順便補做昨天的每日備份（若尚未做）

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
  // 一次性校正：把員編前後的空白清掉。帶空白的員編會讓清冊匯入比對失敗，
  // 同一個人被當成新人重建（新 id、班表重來），既有排休變成孤兒資料。
  await normalizeEmpIds();
}

// ── 一次性遷移標記 ────────────────────────────────────────────────
// 這些 seed 是為了「一次性校正既有資料」而寫，不是每次啟動都該套用的設定。
// 若每次啟動都覆寫，管理員在畫面上做的調整（例如把運務組拆成日/中/夜班）
// 會在下次容器重啟時被打回原狀。故套用後記錄標記，之後一律跳過。
async function normalizeEmpIds() {
  try {
    const { rows } = await pool.query("SELECT data->'employees' AS emps FROM app_state WHERE id='main'");
    const emps = rows[0]?.emps;
    if (!Array.isArray(emps) || emps.length === 0) return;
    let fixed = 0;
    const next = emps.map(e => {
      const t = String(e?.empId ?? '').trim();
      if (e && e.empId !== t) { fixed++; return { ...e, empId: t }; }
      return e;
    });
    if (fixed === 0) return;
    await pool.query(
      `UPDATE app_state SET data = jsonb_set(data, '{employees}', $1::jsonb), updated_at = NOW() WHERE id='main'`,
      [JSON.stringify(next)]
    );
    console.log(`員編正規化：修正 ${fixed} 筆前後空白`);
  } catch (e) {
    console.error('員編正規化失敗:', e.message);
  }
}

const clientIp = req =>
  (req.headers['x-forwarded-for']?.split(',')[0] ?? req.socket?.remoteAddress ?? '').trim() || null;

// ── 備份 ──────────────────────────────────────────────────────────
// 保留策略分開計算：啟動備份（每次部署）留 10 份，每日備份留 60 天。
// 兩者混在一起用同一個上限時，密集部署的那幾天會把每日備份擠掉。
async function pruneBackups() {
  await pool.query(`DELETE FROM app_state_backup
     WHERE note LIKE '啟動備份%' AND id NOT IN (
       SELECT id FROM app_state_backup WHERE note LIKE '啟動備份%'
       ORDER BY created_at DESC LIMIT 10)`);
  await pool.query(`DELETE FROM app_state_backup
     WHERE note LIKE 'daily-%' AND id NOT IN (
       SELECT id FROM app_state_backup WHERE note LIKE 'daily-%'
       ORDER BY created_at DESC LIMIT 60)`);
}

// 台灣時間（UTC+8）的 YYYY-MM-DD 與小時
const twNow = () => new Date(Date.now() + 8 * 3600 * 1000);
const twDateStr = d => d.toISOString().slice(0, 10);

// 每日固定時間（台灣時間，預設 23:00）保存當日資料。
// 時間點可用環境變數 BACKUP_HOUR 調整，不需改程式。
// Cloud Run 在沒人使用時容器會休眠，單靠定時器不保證該時刻醒著，
// 故改為「到點就做，沒做到的隔天補做」：只要當日該時刻已過而該日尚無
// 備份，下一次檢查（定時器或有人操作時）就立刻補上。半夜無人異動，
// 補做的內容與到點當下實質相同。
const BACKUP_HOUR = Math.min(23, Math.max(0, Number(process.env.BACKUP_HOUR ?? 23) || 0));
let lastDailyCheck = 0;
async function ensureDailyBackup() {
  try {
    const now = twNow();
    // 該時刻之前屬於「前一天」的備份週期
    const target = new Date(now.getTime() - BACKUP_HOUR * 3600 * 1000);
    const key = 'daily-' + twDateStr(target);
    const { rowCount } = await pool.query(
      'SELECT 1 FROM app_state_backup WHERE note = $1 LIMIT 1', [key]);
    if (rowCount > 0) return;
    const { rows } = await pool.query("SELECT data FROM app_state WHERE id='main'");
    if (!rows[0]?.data) return;
    await pool.query('INSERT INTO app_state_backup (data, note) VALUES ($1, $2)', [rows[0].data, key]);
    await pruneBackups();
    console.log(`每日備份完成：${key}`);
  } catch (e) {
    console.error('每日備份失敗:', e.message);
  }
}
// 容器醒著時每 10 分鐘檢查一次；休眠期間漏掉的由上面的補做機制補上
setInterval(() => { ensureDailyBackup(); }, 10 * 60 * 1000).unref?.();
// 有人操作時也順便檢查（最多每 10 分鐘一次），涵蓋整夜休眠後的第一個請求
function dailyBackupTick() {
  if (Date.now() - lastDailyCheck < 10 * 60 * 1000) return;
  lastDailyCheck = Date.now();
  ensureDailyBackup();
}

// ── 班表逐格寫入（交由資料庫合併）────────────────────────────────
// 不可以「讀出整份班表 → 在記憶體疊上異動 → 整份寫回」：兩人同時存檔時，
// 後寫的人用的是他讀取當下的舊版本，會把這中間別人存進去的格子抹掉。
// 各端每 2 秒自動存檔一次，多人同時排班撞上的機率很高，症狀是零星的
// 「排好了過一下又不見」。改為每位員工一句 UPDATE，由資料庫在同一個
// 敘述內完成合併，不存在讀取與寫入之間的時間差。
async function mergeScheduleCells(sched, meta) {
  // 整份 schedule 不存在時，jsonb_set 到 {schedule,<empId>} 不會生效，先補空物件
  await pool.query(
    `UPDATE app_state SET data = jsonb_set(data, '{schedule}', COALESCE(data->'schedule', '{}'::jsonb))
      WHERE id='main'`
  );
  // 先取得異動前的值，供軌跡記錄使用（只取本次涉及的員工）
  let before = {};
  if (meta) {
    try {
      const ids = Object.keys(sched ?? {});
      if (ids.length > 0) {
        const { rows } = await pool.query(
          `SELECT COALESCE(data->'schedule', '{}'::jsonb) AS sc FROM app_state WHERE id='main'`);
        const sc = rows[0]?.sc ?? {};
        for (const id of ids) before[id] = sc[id] ?? {};
      }
    } catch (e) { console.warn('取得異動前班表失敗（不影響存檔）:', e.message); }
  }
  for (const [empId, days] of Object.entries(sched ?? {})) {
    if (!days || Object.keys(days).length === 0) continue;
    await pool.query(
      `UPDATE app_state
          SET data = jsonb_set(data, ARRAY['schedule', $1],
                COALESCE(data->'schedule'->$1, '{}'::jsonb) || $2::jsonb),
              updated_at = NOW()
        WHERE id='main'`,
      [String(empId), JSON.stringify(days)]
    );
  }
  if (meta) await writeScheduleAudit(sched, before, meta);
}

/** 寫入單格異動軌跡。記錄失敗絕不影響存檔本身。 */
async function writeScheduleAudit(sched, before, meta) {
  try {
    const rows = [];
    for (const [empId, days] of Object.entries(sched ?? {})) {
      const emp = meta.empById?.get(empId);
      for (const [dk, after] of Object.entries(days ?? {})) {
        const prev = before?.[empId]?.[dk] ?? null;
        if (prev === after) continue;   // 值沒變就不記，避免自動存檔灌爆
        rows.push([meta.username ?? null, meta.role ?? null, meta.ip ?? null,
                   String(empId), emp?.empId ?? null, emp?.name ?? null,
                   String(dk), prev, after ?? null]);
      }
    }
    if (rows.length === 0) return;
    const vals = rows.map((_, i) => {
      const b = i * 9;
      return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9})`;
    }).join(',');
    await pool.query(
      `INSERT INTO schedule_audit (username, role, ip, emp_id, emp_no, emp_name, dk, before_val, after_val)
       VALUES ${vals}`, rows.flat());
    // 保留 90 天
    await pool.query(`DELETE FROM schedule_audit WHERE at < NOW() - INTERVAL '90 days'`);
  } catch (e) {
    console.warn('寫入班表異動軌跡失敗（不影響存檔）:', e.message);
  }
}

async function seedAlreadyApplied(key) {
  const { rows } = await pool.query("SELECT data->'_seedApplied'->>$1 AS v FROM app_state WHERE id='main'", [key]);
  return rows[0]?.v === 'true';
}
async function markSeedApplied(key) {
  await pool.query(
    `UPDATE app_state
        SET data = jsonb_set(data, '{_seedApplied}',
              COALESCE(data->'_seedApplied', '{}'::jsonb) || $1::jsonb),
            updated_at = NOW()
      WHERE id='main'`,
    [JSON.stringify({ [key]: true })]
  );
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
    '大肚運務課':   ['運務組-日班','運務組-中班','運務組-夜班'],
  },
  '岡山倉': {
    '岡山營運課':   ['日班-理貨組','中班-理貨組','夜班-理貨組','日班-出貨組'],
  },
};

// 課別更名對照（舊名 → 新名），同時遷移員工清冊的 dept 欄位
const DEPT_RENAMES = { '營運指導課': '營運推進課' };

async function seedDeptGroups() {
  if (await seedAlreadyApplied('deptGroups')) return;   // 已校正過，不再覆寫管理員的調整
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

  await markSeedApplied('deptGroups');
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
  if (await seedAlreadyApplied('warehouseVendors')) return;   // 已校正過，不再覆寫
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

  await markSeedApplied('warehouseVendors');
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
  // 一次性資料校正：套用過就不再執行，否則每次容器啟動都會把已刪除的人員加回來
  if (await seedAlreadyApplied('daxiAreaEmployees')) return;
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
  await markSeedApplied('daxiAreaEmployees');
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
  // 一次性資料校正：套用過就不再執行，否則每次容器啟動都會把已刪除的人員加回來
  if (await seedAlreadyApplied('daxiEmployees')) return;
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
  await markSeedApplied('daxiEmployees');
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
  // 一次性資料校正：套用過就不再執行，否則每次容器啟動都會把已刪除的人員加回來
  if (await seedAlreadyApplied('areaEmployees')) return;
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
  await markSeedApplied('areaEmployees');
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
    loginCount:        u.login_count ?? 0,
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

    await pool.query('UPDATE users SET last_login=NOW(), login_count=login_count+1 WHERE id=$1', [user.id]);
    const { rows: fresh } = await pool.query('SELECT * FROM users WHERE id=$1', [user.id]);
    return res.json({ token: issueToken(user), user: safeUser(fresh[0] ?? user) });
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

  await pool.query('UPDATE users SET last_login=NOW(), login_count=login_count+1 WHERE id=$1', [user.id]);
  const { rows: fresh } = await pool.query('SELECT * FROM users WHERE id=$1', [user.id]);
  return res.json({ token: issueToken(user), user: safeUser(fresh[0] ?? user) });
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
// ── GET /api/backups（管理員）──────────────────────────────
// 只列出有哪些備份與各自的資料量，不回傳備份內容本身。
// 還原屬於高風險操作，一律不開放 API，必要時由維運人員在資料庫執行。
app.get('/api/backups', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT note, created_at,
              jsonb_array_length(COALESCE(data->'employees','[]'::jsonb)) AS employees,
              (SELECT COUNT(*) FROM jsonb_object_keys(COALESCE(data->'schedule','{}'::jsonb))) AS schedule_rows
         FROM app_state_backup ORDER BY created_at DESC LIMIT 100`);
    res.json({ ok: true, backups: rows });
  } catch (e) {
    console.error('backups list error:', e.message);
    res.status(500).json({ error: '伺服器錯誤' });
  }
});

// 最近一次每日快照的時間，供畫面顯示「已完成資料快照備份」
app.get('/api/backups/latest', requireAuth, requireManagerOrAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT note, created_at FROM app_state_backup
        WHERE note LIKE 'daily-%' ORDER BY created_at DESC LIMIT 1`);
    res.json({ ok: true, latest: rows[0] ?? null, hour: BACKUP_HOUR });
  } catch (e) {
    console.error('backups latest error:', e.message);
    res.status(500).json({ error: '伺服器錯誤' });
  }
});

// ── GET /api/audit/schedule（管理員或日翊）────────────────────
// 單格異動軌跡查詢：可用員工編號、日期、操作者過濾。
// 用途是釐清「這格是誰、什麼時候改的」，不提供任何修改功能。
app.get('/api/audit/schedule', requireAuth, requireManagerOrAdmin, async (req, res) => {
  const { empNo, dk, username, limit } = req.query ?? {};
  const where = [];
  const args = [];
  if (empNo)   { args.push(String(empNo).trim()); where.push(`emp_no = $${args.length}`); }
  if (dk)      { args.push(String(dk).trim());    where.push(`dk = $${args.length}`); }
  if (username){ args.push(String(username).trim()); where.push(`username = $${args.length}`); }
  args.push(Math.min(500, Math.max(1, Number(limit) || 200)));
  try {
    const { rows } = await pool.query(
      `SELECT at, username, role, ip, emp_no, emp_name, dk, before_val, after_val
         FROM schedule_audit
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY at DESC LIMIT $${args.length}`, args);
    res.json({ ok: true, rows });
  } catch (e) {
    console.error('audit query error:', e.message);
    res.status(500).json({ error: '伺服器錯誤' });
  }
});

// ── 資料健檢與合併（僅管理員）──────────────────────────────
// 背景：早期清冊匯入以未正規化的員編比對，同一個人會被當成新人重建。
// 舊記錄底下的排休仍留在資料庫，只是畫面上看不到（清冊已改指向新記錄）。
// 這裡提供「先檢查、再合併」的工具，把舊記錄的休／例／國救回現用記錄。
const normEmpKey = v => String(v ?? '').trim().toUpperCase();

/** 產出健檢報告；不做任何異動 */
async function buildHealthReport() {
  const { rows } = await pool.query("SELECT data FROM app_state WHERE id='main'");
  const data = rows[0]?.data ?? {};
  const employees = data.employees ?? [];
  const schedule  = data.schedule  ?? {};
  const cellCount = id => Object.keys(schedule[id] ?? {}).length;

  // 依正規化員編分群，找出重複
  const byKey = new Map();
  for (const e of employees) {
    const k = normEmpKey(e.empId);
    if (!k) continue;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(e);
  }

  const duplicates = [];
  for (const [key, list] of byKey) {
    if (list.length < 2) continue;
    // 保留「現用」那一筆：清冊中最後出現的記錄即為最近一次匯入的結果
    const keep = list[list.length - 1];
    const drops = list.slice(0, -1);
    const restore = [];      // 會被救回的格子
    for (const d of drops) {
      const oldRow = schedule[d.id] ?? {};
      const newRow = schedule[keep.id] ?? {};
      for (const [dk, v] of Object.entries(oldRow)) {
        // 舊記錄有休／例／國，而現用記錄是 V 或空白 → 視為被重建洗掉的排休
        if (v === 'V' || v == null) continue;
        const cur = newRow[dk];
        if (cur === v) continue;
        if (cur == null || cur === 'V') restore.push({ from: d.id, dk, before: cur ?? null, after: v });
      }
    }
    duplicates.push({
      empNo: keep.empId, name: keep.name, key,
      keep:  { id: keep.id, cells: cellCount(keep.id) },
      drops: drops.map(d => ({ id: d.id, name: d.name, empId: d.empId, cells: cellCount(d.id) })),
      restoreCount: restore.length,
      restoreSample: restore.slice(0, 12),
    });
  }

  // 真正的孤兒：班表存在但清冊已無此內部 id
  const empIds = new Set(employees.map(e => e.id));
  const orphans = Object.keys(schedule)
    .filter(id => !empIds.has(id))
    .map(id => {
      const row = schedule[id] ?? {};
      const dks = Object.keys(row);
      const nonV = dks.filter(dk => row[dk] && row[dk] !== 'V');
      return { id, cells: dks.length, nonV: nonV.length, sample: nonV.slice(0, 8) };
    });

  return {
    employees: employees.length,
    scheduleRows: Object.keys(schedule).length,
    duplicates,
    orphans,
    totalRestore: duplicates.reduce((a, d) => a + d.restoreCount, 0),
  };
}

app.get('/api/maintenance/health', requireAuth, requireAdmin, async (_req, res) => {
  try {
    res.json({ ok: true, report: await buildHealthReport() });
  } catch (e) {
    console.error('health report error:', e.message);
    res.status(500).json({ error: '伺服器錯誤' });
  }
});

// 執行合併：把重複記錄的休／例／國寫回現用記錄，並移除重複的清冊記錄。
// 執行前先備份，且只處理報告中列出的項目。
app.post('/api/maintenance/merge-duplicates', requireAuth, requireAdmin, async (req, res) => {
  try {
    const full = await buildHealthReport();
    // 只合併呼叫端明確指定的員編。未指定時不做任何事：這個操作會動到正式資料，
    // 必須由使用者在報告上逐筆確認，不接受「全部照做」的隱含授權。
    const picked = Array.isArray(req.body?.keys) ? req.body.keys.map(k => normEmpKey(k)) : null;
    if (!picked || picked.length === 0)
      return res.status(400).json({ error: '請先選擇要合併的人員' });
    const report = { ...full, duplicates: full.duplicates.filter(d => picked.includes(d.key)) };
    if (report.duplicates.length === 0)
      return res.json({ ok: true, merged: 0, removed: 0, message: '沒有需要合併的重複記錄' });

    const { rows } = await pool.query("SELECT data FROM app_state WHERE id='main'");
    const data = rows[0]?.data ?? {};
    await pool.query('INSERT INTO app_state_backup (data, note) VALUES ($1, $2)',
      [data, '合併前備份 ' + new Date().toISOString()]);

    const employees = data.employees ?? [];
    const schedule  = { ...(data.schedule ?? {}) };
    const tomb = { ...(data._deletedEmployees ?? {}) };
    const now = Date.now();
    let merged = 0, removed = 0;
    const audit = [];

    for (const d of report.duplicates) {
      const target = { ...(schedule[d.keep.id] ?? {}) };
      for (const drop of d.drops) {
        const oldRow = schedule[drop.id] ?? {};
        for (const [dk, v] of Object.entries(oldRow)) {
          if (!v || v === 'V') continue;
          const cur = target[dk];
          if (cur != null && cur !== 'V') continue;   // 現用記錄已有非 V 值，尊重現值
          audit.push([req.user?.username ?? null, req.user?.role ?? null, clientIp(req),
                      String(d.keep.id), d.empNo ?? null, d.name ?? null,
                      String(dk), cur ?? null, v]);
          target[dk] = v;
          merged++;
        }
        delete schedule[drop.id];
        tomb[drop.id] = now;      // 加墓碑，避免其他裝置的舊名單把重複記錄加回來
        removed++;
      }
      schedule[d.keep.id] = target;
    }

    const dropIds = new Set(report.duplicates.flatMap(d => d.drops.map(x => x.id)));
    const nextEmployees = employees.filter(e => !dropIds.has(e.id));

    await pool.query(
      `UPDATE app_state SET data = data || $1::jsonb, updated_at = NOW() WHERE id='main'`,
      [JSON.stringify({ employees: nextEmployees, schedule, _deletedEmployees: tomb })]
    );

    if (audit.length > 0) {
      const vals = audit.map((_, i) => {
        const b = i * 9;
        return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9})`;
      }).join(',');
      await pool.query(
        `INSERT INTO schedule_audit (username, role, ip, emp_id, emp_no, emp_name, dk, before_val, after_val)
         VALUES ${vals}`, audit.flat());
    }
    console.log(`資料合併：救回 ${merged} 格、移除 ${removed} 筆重複記錄（by ${req.user?.username}）`);
    res.json({ ok: true, merged, removed });
  } catch (e) {
    console.error('merge duplicates error:', e.message);
    res.status(500).json({ error: '伺服器錯誤' });
  }
});

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
    deptSegments: data.deptSegments ?? {},
    dailyDemand:  data.dailyDemand ?? {},
    // 每期日期區間：委外幹部／人員的班表也要依同一週期分頁，
    // 未回傳時他們會退回「以月份檢視」，看到的期間與日翊端對不上。
    periodRange:  data.periodRange ?? null,
    vendorHolidayOpen: data.vendorHolidayOpen ?? false,
    vendorRestOpen:    data.vendorRestOpen ?? false,
    workerRestOpen:    data.workerRestOpen ?? false,
  });
});

// ── PUT /api/state ────────────────────────────────────────
// 以 merge 方式更新，保留 attendData / extras（由 PUT /api/attendance 管理）
// vendor/worker 角色只允許寫入 schedule 欄位，其餘欄位由 admin/area 管理
app.put('/api/state', requireAuth, async (req, res) => {
  dailyBackupTick();   // 整夜休眠後的第一個請求會在此補做前一日備份
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
        // 廠商名稱以正規化後比對：清冊或帳號設定若夾帶半形／全形空白，
        // 用字串全等會比不到，該幹部排的班會被無聲過濾掉（畫面看得到卻存不進去）。
        const allowedSet = new Set(allowedVendors.map(normNameSrv));
        allowedIds = new Set(employees.filter(e => allowedSet.has(normNameSrv(e.vendor))).map(e => e.id));
      } else {
        allowedIds = new Set([req.user.employeeId]);
      }

      // 逐員工、逐日 merge（避免整包快照覆蓋其他人剛存入的異動，造成資料遺失）。
      // 實際寫入交給 mergeScheduleCells 由資料庫合併，這裡只負責挑出可接受的格子。
      const acceptedByEmp = {};
      // 課別鎖定與開放排班區間：原本只在前端把關，已登入的委外人員／幹部在管理員
      // 改為鎖定後，未重新整理前仍可繼續排班並成功寫入。改由伺服器最終認定。
      const deptLocks    = curData.deptLocks    ?? {};
      const deptRanges   = curData.deptRanges   ?? {};
      const deptSegments = curData.deptSegments ?? {};
      const empById = new Map(employees.map(e => [e.id, e]));
      const lockMode = v => (v === true ? 'full' : (v === false || v == null) ? 'none' : v);
      // 一個課別可有多段區間，每段各自帶鎖定模式與適用組別；
      // 沒有新格式時，由舊的單一區間推導成「一段、適用全部組別」。
      const segsOf = dept => {
        if (!dept) return [];
        const segs = deptSegments[dept];
        if (Array.isArray(segs) && segs.length > 0) return segs;
        const r = deptRanges[dept];
        if (r?.start && r?.end) return [{ start: r.start, end: r.end, lock: lockMode(deptLocks[dept]), groups: [] }];
        return [];
      };
      const toTs = str => { const [a, b, c] = String(str).split('-').map(Number); return new Date(a, b - 1, c).getTime(); };
      // 委外身分可否編輯：需有任一段同時符合組別、日期，且該段未鎖定委外
      const cellAllowed = (emp, dk) => segsOf(emp?.dept).some(sg => {
        if (sg.groups?.length && !sg.groups.includes(emp?.group)) return false;
        if (!sg.start || !sg.end) return false;
        const t = toTs(dk);
        if (t < toTs(sg.start) || t > toTs(sg.end)) return false;
        const m = lockMode(sg.lock);
        return m !== 'full' && m !== 'partial';
      });

      const skipped = [];
      let lockedCells = 0;
      for (const [empId, days] of Object.entries(schedule)) {
        // 過濾越權寫入（防止繞過前端直接改別人班表）。
        // 被擋下的筆數要回報，否則權限或廠商設定有誤時，會變成「按了沒反應也沒錯誤」。
        if (!allowedIds.has(empId)) { skipped.push(empId); continue; }
        if (!days || Object.keys(days).length === 0) continue;
        const emp = empById.get(empId);
        const accepted = {};
        for (const [dk, v] of Object.entries(days)) {
          if (cellAllowed(emp, dk)) accepted[dk] = v;
          else lockedCells++;
        }
        if (Object.keys(accepted).length > 0) acceptedByEmp[empId] = accepted;
      }
      if (lockedCells > 0)
        console.warn(`PUT /api/state 鎖定/區間外拒絕：user=${req.user?.username} role=${role} 拒絕 ${lockedCells} 格`);
      if (skipped.length > 0)
        console.warn(`PUT /api/state 越權過濾：user=${req.user?.username} role=${role} 略過 ${skipped.length} 位人員`);

      await mergeScheduleCells(acceptedByEmp, {
        username: req.user?.username, role, ip: clientIp(req), empById,
      });
      return res.json({ ok: true, skipped: skipped.length, locked: lockedCells });
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
  // 管理員專屬的全域設定：日翊(area)的前端不提供修改介面，但 PUT /api/state
  // 對 admin/area 是同一條分支，故在此無條件剔除，避免繞過介面直接寫入。
  if (role === 'area') {
    delete rest.periodRange;        // 每期日期區間
    delete rest.openHolidays;       // 開放排班國定假日
    delete rest.vendorHolidayOpen;  // 委外幹部排「國」開關
    delete rest.vendorRestOpen;     // 委外幹部排休開關
    delete rest.workerRestOpen;     // 委外人員排休開關
    delete rest.vendorCompanyNames; // 廠商公司抬頭
    delete rest.unlockPwd;          // 快速解鎖密碼（僅管理員可設定）
    delete rest.vendors;            // 廠商主檔
  }
  // 空的 schedule 一律移除，絕對不可寫入。
  // 最後的寫入是 `data = app_state.data || $1::jsonb`，jsonb 的 || 是「整個 key 取代」，
  // 送 {} 會把整份班表清空。前端只送異動格子時，沒有異動就會送出 {}，故在此把關。
  if (rest.schedule && Object.keys(rest.schedule).length === 0) delete rest.schedule;
  if (Object.keys(rest).length === 0) return res.json({ ok: true });
  // schedule：逐員工、逐日 merge（避免 admin/area 多裝置同時存檔時，後存者的舊快照蓋掉先存者剛異動的其他員工資料）
  // workerPwds：逐員編 merge。委外人員是自己透過 PUT /api/auth/worker-password 設定密碼的，
  // 管理員端的 workerPwds 快照永遠較舊；若整份覆蓋會把剛設好的密碼洗掉，
  // 該員下次登入就會被當成首次登入而再次要求設定密碼。
  if ((rest.schedule && Object.keys(rest.schedule).length > 0) ||
      (rest.workerPwds && Object.keys(rest.workerPwds).length >= 0) ||
      (Array.isArray(rest.employees) && rest.employees.length > 0) ||
      (Array.isArray(rest.warehouses) && rest.warehouses.length > 0) ||
      rest.deptLocks || rest.deptRanges || rest.deptSegments ||
      rest.attendData || rest.extras || rest.dailyDemand || rest.shiftTypesByWh) {
    try {
      const { rows: curRows } = await pool.query("SELECT data FROM app_state WHERE id='main'");
      const cur = curRows[0]?.data ?? {};
      if (rest.schedule && Object.keys(rest.schedule).length > 0) {
        // 由資料庫逐格合併後，班表就不再隨這次的整包寫入送出，
        // 避免讀取與寫入之間別人剛存的格子被蓋掉（見 mergeScheduleCells）
        await mergeScheduleCells(rest.schedule, {
          username: req.user?.username, role, ip: clientIp(req),
          empById: new Map((cur.employees ?? []).map(e => [e.id, e])),
        });
        delete rest.schedule;
      }
      if (rest.workerPwds) {
        // 伺服器現值優先：本人剛設定的密碼不可被他人的舊快照覆蓋
        rest.workerPwds = { ...rest.workerPwds, ...(cur.workerPwds ?? {}) };
      }
      // warehouses：日翊(area)僅能異動自己 allowed_warehouses 內的倉別，其餘沿用伺服器現值，
      // 且不得新增或刪除倉別。前端已做收斂，但伺服器端原本未區分 admin/area，
      // 故在此把關；同時可避免日翊的舊快照覆蓋其他倉別的設定。
      if (Array.isArray(rest.warehouses) && role === 'area') {
        const allowed = new Set(req.user?.allowed_warehouses ?? []);
        const incomingById = new Map(rest.warehouses.map(w => [w.id, w]));
        rest.warehouses = (cur.warehouses ?? []).map(w =>
          (allowed.has(w.id) && incomingById.has(w.id)) ? incomingById.get(w.id) : w);
      }
      // deptLocks / deptRanges：以「倉別」為界合併。
      // 這兩份設定是以「課別名稱」為 key 的單一物件，整份覆蓋時，日翊(area)只看得到
      // 自己倉別的課，送出的快照卻是整份 —— 大溪的日翊存檔就會把大肚剛設好的區間洗掉。
      // 作法：只採用「來源可管轄倉別」底下課別的 key（含該範圍內的刪除，維持「清除」語意），
      // 其餘 key 一律沿用伺服器現值。admin 可管轄全部倉別，行為不變。
      if (role === 'area' && (rest.deptLocks || rest.deptRanges || rest.deptSegments)) {
        const allowedWh = new Set(req.user?.allowed_warehouses ?? []);
        const scopedDepts = new Set();
        for (const w of (cur.warehouses ?? [])) {
          if (!allowedWh.has(w.id)) continue;
          for (const d of (w.departments ?? [])) scopedDepts.add(d.name);
        }
        for (const key of ['deptLocks', 'deptRanges', 'deptSegments']) {
          if (!rest[key]) continue;
          const merged = {};
          // 管轄範圍外：一律以伺服器現值為準
          for (const [k, v] of Object.entries(cur[key] ?? {}))
            if (!scopedDepts.has(k)) merged[k] = v;
          // 管轄範圍內：以來源為準（來源沒有的 key 即為刪除）
          for (const [k, v] of Object.entries(rest[key]))
            if (scopedDepts.has(k)) merged[k] = v;
          rest[key] = merged;
        }
      }
      // employees：逐筆合併欄位。多位日翊同時登入時，每個瀏覽器每 2 秒送出自己的
      // employees 快照；若整份覆蓋，別人剛設定的欄位（例如 shiftTypeId 班別指派）
      // 會被尚未同步到該設定的舊快照洗掉。
      // 作法：以送出的清單為準（保留刪除語意），但同一筆人員中「現值有、來源沒有」
      // 的欄位予以保留；來源明確帶值的欄位仍會覆蓋，故正常編輯不受影響。
      //
      // 刪除語意另外需要「墓碑」保護：人員清冊是整份名單送出的，A 刪掉某人後，
      // 另一台還開著舊名單的瀏覽器只要存檔一次就會把人加回來。故在此記錄已刪除的
      // 內部 id，往後任何名單再帶著它都直接濾掉。
      // 重新新增或重新匯入同一位員工時會產生新的 id，不受墓碑影響。
      if (Array.isArray(rest.employees) && rest.employees.length > 0) {
        const curEmps = cur.employees ?? [];
        const curById = new Map(curEmps.map(e => [e.id, e]));
        const incomingIds = new Set(rest.employees.map(e => e.id));
        const tomb = { ...(cur._deletedEmployees ?? {}) };
        const now = Date.now();

        // 這次沒送出、但資料庫現有的人 → 視為刪除
        const removed = curEmps.filter(e => !incomingIds.has(e.id)).map(e => e.id);
        // 安全閥：一次少掉太多人多半是名單載入不全，不當成刪除（避免整批誤刪）
        const MAX_DELETE_PER_SAVE = 30;
        if (removed.length > MAX_DELETE_PER_SAVE) {
          console.warn(`PUT /api/state 一次移除 ${removed.length} 位人員，超過上限 ${MAX_DELETE_PER_SAVE}，` +
                       `視為名單不完整，保留現有資料（user=${req.user?.username}）`);
          const keep = curEmps.filter(e => !incomingIds.has(e.id));
          rest.employees = [...rest.employees, ...keep];
        } else {
          for (const id of removed) tomb[id] = now;
          if (removed.length > 0)
            console.log(`PUT /api/state 移除 ${removed.length} 位人員並記錄墓碑（user=${req.user?.username}）`);
        }

        // 墓碑保留 90 天後清除，避免無限成長
        const cutoff = now - 90 * 86400000;
        for (const [id, ts] of Object.entries(tomb)) if (ts < cutoff) delete tomb[id];

        const blocked = rest.employees.filter(e => tomb[e.id]).length;
        if (blocked > 0)
          console.warn(`PUT /api/state 擋下 ${blocked} 位已刪除人員的復活（user=${req.user?.username}）`);

        rest.employees = rest.employees
          .filter(e => !tomb[e.id])
          .map(e => { const prev = curById.get(e.id); return prev ? { ...prev, ...e } : e; });
        rest._deletedEmployees = tomb;
      }

      // ── 以下欄位原本是「最後存檔的人整份覆蓋」，改為逐筆合併 ──
      // 這些資料多人同時維護（不同倉、不同課別、不同日期），整份覆蓋會讓
      // 後存檔者把別人剛改好的內容一起帶回舊值。

      // 點名表：日期 → 員工，兩層合併。同一天不同廠商各自回報不會互蓋。
      if (rest.attendData && typeof rest.attendData === 'object') {
        const curAttend = cur.attendData ?? {};
        const merged = { ...curAttend };
        for (const [date, dayMap] of Object.entries(rest.attendData)) {
          if (dayMap && Object.keys(dayMap).length > 0)
            merged[date] = { ...(curAttend[date] ?? {}), ...dayMap };
        }
        rest.attendData = merged;
      }

      // 臨時人力：逐日期取代（當日名單本來就是整份維護），其餘日期保留
      if (rest.extras && typeof rest.extras === 'object') {
        const curExtras = cur.extras ?? {};
        const merged = { ...curExtras };
        for (const [date, list] of Object.entries(rest.extras))
          if (Array.isArray(list)) merged[date] = list;
        rest.extras = merged;
      }

      // 需求人數：鍵為「課別|組別|日期」，逐鍵合併，各組別互不影響
      if (rest.dailyDemand && typeof rest.dailyDemand === 'object')
        rest.dailyDemand = { ...(cur.dailyDemand ?? {}), ...rest.dailyDemand };

      // 班別設定：以倉別為鍵，逐倉合併。大溪調整班別不會蓋掉大肚的設定。
      if (rest.shiftTypesByWh && typeof rest.shiftTypesByWh === 'object')
        rest.shiftTypesByWh = { ...(cur.shiftTypesByWh ?? {}), ...rest.shiftTypesByWh };

      // 作業區、國定假日清單、班別代號對照表是整份維護的清單，沒有可供比對的
      // 單筆識別，無法逐筆合併；但送出空清單一律視為「尚未載入」而不予採用，
      // 避免初始化中的裝置把既有設定清空。
      for (const k of ['workAreas', 'openHolidays', 'shiftCodeRows', 'shiftCodeHeaders']) {
        if (Array.isArray(rest[k]) && rest[k].length === 0 && Array.isArray(cur[k]) && cur[k].length > 0)
          delete rest[k];
      }

      // 期別區間、顯示區間是全系統唯一的設定，沒有可供合併的「筆」，
      // 只需防止尚未載入完成的裝置用空值把既有設定清掉。
      for (const k of ['periodRange', 'scheduleRange']) {
        const v = rest[k];
        const empty = v == null || (typeof v === 'object' && Object.keys(v).length === 0);
        if (empty && cur[k] != null) delete rest[k];
      }
    } catch (e) {
      // 絕對不可以吞掉後繼續寫入。底下的寫入是 `data = 舊資料 || 新資料`，
      // jsonb 的 || 是「整個 key 直接取代」，少了上面的合併就會變成：
      //   workerPwds → 被送上來的（可能是空的）快照整份取代 → 委外密碼全部消失
      //   schedule   → 被「只含本次異動格子」那包整份取代 → 班表倒退
      // 讀取最容易失敗的時機正是部署當下（新容器冷啟動、DB 連線池未暖），
      // 故改為直接回 503，讓前端保留未存檔內容並稍後重試。
      console.error('PUT /api/state merge 讀取失敗，放棄本次寫入以免覆蓋:', e.message);
      return res.status(503).json({ error: 'db_unavailable' });
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
      await pool.query('UPDATE users SET password_hash=$1, last_login=NOW(), login_count=login_count+1 WHERE id=$2', [newHash, user.id]);
    } else {
      await pool.query('UPDATE users SET last_login=NOW(), login_count=login_count+1 WHERE id=$1', [user.id]);
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

  // 空 attendData → 不覆蓋 DB（避免桌機初始化時把空物件寫進 DB，導致其他裝置 init 被清空）
  if (Object.keys(attendData).length === 0 && Object.keys(extras).length === 0)
    return res.json({ ok: true });

  // 逐日期、逐員工合併，且合併由資料庫在同一句 UPDATE 內完成。
  // 先讀出整份再寫回會有時間差：兩個廠商同時回報時，後寫的那份是依據
  // 他讀取當下的舊資料算出來的，會把對方剛寫入的內容抹掉。
  try {
    await pool.query(
      `UPDATE app_state SET data = jsonb_set(jsonb_set(data,
              '{attendData}', COALESCE(data->'attendData', '{}'::jsonb)),
              '{extras}',     COALESCE(data->'extras',     '{}'::jsonb))
        WHERE id='main'`);

    for (const [date, dayMap] of Object.entries(attendData)) {
      if (!dayMap || Object.keys(dayMap).length === 0) continue;
      await pool.query(
        `UPDATE app_state
            SET data = jsonb_set(data, ARRAY['attendData', $1],
                  COALESCE(data->'attendData'->$1, '{}'::jsonb) || $2::jsonb),
                updated_at = NOW()
          WHERE id='main'`,
        [String(date), JSON.stringify(dayMap)]
      );
    }

    // 臨時人力是清單，沒有逐筆識別；廠商只能換掉自己那幾筆，其餘保留。
    // 這段仍需先讀當日清單，但範圍縮到「單一日期」，衝突面遠小於整份覆蓋。
    if (Object.keys(extras).length > 0) {
      const { rows: exRows } = await pool.query("SELECT data->'extras' AS ex FROM app_state WHERE id='main'");
      const curExtras = exRows[0]?.ex ?? {};
      const allowedVendorSet = role === 'vendor' ? new Set(req.user.vendors ?? []) : null;
      for (const [date, list] of Object.entries(extras)) {
        const next = allowedVendorSet
          ? [...(curExtras[date] ?? []).filter(e => !allowedVendorSet.has(e.vendor)), ...(list ?? [])]
          : (list ?? []);
        await pool.query(
          `UPDATE app_state
              SET data = jsonb_set(data, ARRAY['extras', $1], $2::jsonb), updated_at = NOW()
            WHERE id='main'`,
          [String(date), JSON.stringify(next)]
        );
      }
    }
  } catch (e) {
    console.error('PUT /api/attendance DB error:', e.message);
    return res.status(503).json({ error: 'db_unavailable' });
  }
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

    // 員編一律以「去空白＋大寫」比對。清冊的員編大小寫可能與員工輸入的不一致
    // （匯入時保留檔案原樣，不擅自改寫資料），若登入區分大小寫，帳密就是員編的
    // 情況下會直接登入不了。
    const normEmp = v => String(v ?? '').trim().toUpperCase();
    const inputKey = normEmp(empId);
    const emp = employees.find(e => normEmp(e.empId) === inputKey);
    if (!emp) return res.status(401).json({ error: '員工編號不存在' });

    // 依日翊決定：委外人員一律「帳號＝密碼＝員工編號」，不再自訂密碼。
    // 現場多為輪替人力與共用裝置，自訂密碼造成大量忘記密碼與登入不了的狀況；
    // 委外端只看得到自己的班表，故接受此風險。app_state.workerPwds 不再參與驗證。
    const pwdKey = String(emp.empId ?? '').trim();
    if (normEmp(password) !== normEmp(pwdKey)) {
      console.warn(`worker-login 失敗：empId=${pwdKey} 密碼與員編不符`);
      return res.status(401).json({ error: '密碼錯誤' });
    }
    // 委外人員多半不存在於 users 表（清冊人員直接以員編登入），原本的 UPDATE 匹配不到任何列，
    // 導致登入次數永遠是 0。改為 upsert：第一次登入時建立一列僅供統計用的紀錄
    //（password_hash 留空，密碼仍存於 app_state.workerPwds；approved 不影響其登入）。
    // 已升級為委外幹部者 role 為 vendor，此處不覆蓋其角色與權限。
    await pool.query(
      `INSERT INTO users (id, username, role, display_name, login_count, last_login, approved)
       VALUES ($1, $2, 'worker', $3, 1, NOW(), true)
       ON CONFLICT (username) DO UPDATE
         SET login_count = users.login_count + 1,
             last_login  = NOW(),
             display_name = COALESCE(NULLIF(users.display_name, ''), EXCLUDED.display_name)`,
      ['worker_' + String(emp.id).slice(0, 53), String(emp.empId).trim(), String(emp.name ?? '').slice(0, 50)]
    ).catch(e => console.warn('worker 登入計數失敗:', e.message));
    const token = issueToken({
      id: 'worker_' + emp.id,
      username: pwdKey,   // 後續設定密碼會以此為索引，必須與查密碼時同一把鑰匙
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
      firstLogin: false,   // 委外人員不再需要設定密碼
      emp: { id: emp.id, empId: emp.empId, name: emp.name, vendor: emp.vendor ?? '' },
    });
  } catch (e) {
    console.error('worker-login error:', e.message);
    return res.status(500).json({ error: '伺服器錯誤' });
  }
});

// ── PUT /api/auth/worker-password ────────────────────────
// 委外人員已改為「帳號＝密碼＝員工編號」，不再提供自訂密碼。
// 保留路由只為讓尚未更新程式的舊分頁得到明確回應，不再寫入任何密碼。
app.put('/api/auth/worker-password', requireAuth, async (_req, res) => {
  res.status(410).json({ error: '委外人員已改為帳號密碼皆為員工編號，不需設定密碼' });
});

// ── PUT /api/auth/vendor-password ────────────────────────
// 委外幹部自行變更密碼（首次登入強制改密碼亦走此路徑）。
// 廠商帳號登入是以 DB 的 password_hash 驗證，只改本機會導致新密碼無效、
// 舊密碼仍可登入，故必須寫回資料庫。僅能改自己的密碼。
app.put('/api/auth/vendor-password', requireAuth, async (req, res) => {
  if (req.user?.role !== 'vendor') return res.status(403).json({ error: '無存取權限' });
  const { passwordHash } = req.body ?? {};
  if (!passwordHash || !String(passwordHash).startsWith('pbkdf2:')) {
    return res.status(400).json({ error: '密碼格式錯誤' });
  }
  try {
    const { rowCount } = await pool.query(
      'UPDATE users SET password_hash=$1 WHERE username=$2 AND role=$3',
      [String(passwordHash), req.user.username, 'vendor']
    );
    if (rowCount === 0) return res.status(404).json({ error: '找不到此帳號' });
    res.json({ ok: true });
  } catch (e) {
    console.error('vendor-password error:', e.message);
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
        [String(emp.empId ?? '').trim()]
      );
      return res.json({ ok: true, username: key, name: emp.name, defaultPassword: key });
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
