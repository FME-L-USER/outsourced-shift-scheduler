'use strict';
/**
 * 大溪倉員工帳號與清冊批次建立腳本
 * 執行：node seed-daxi-employees.cjs
 *
 * 功能：
 * 1. 在 sms.users 預建帳號（AD auth only，approved=true，role=worker）
 * 2. 將員工加入 app_state.employees（dept 對應倉別+課別，下次登入後前端自動讀取）
 *
 * 冪等：重複執行不會重複建立，已存在的帳號與員工會被跳過。
 */

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('FATAL: DATABASE_URL is required');
  process.exit(1);
}

const sslConfig = DATABASE_URL.includes('/cloudsql/') ? false : { rejectUnauthorized: true };
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: sslConfig,
  options: '-c search_path=sms,public',
});

// ── 員工資料 ──────────────────────────────────────────────────────────────────
const EMPLOYEES = [
  // 大溪倉、倉儲管理課
  { username: 'cami700220', name: '李淑惠', dept: '倉儲管理課' },
  { username: 'judy',       name: '林麗雲', dept: '倉儲管理課' },
  { username: 'beyi',       name: '洪淑娥', dept: '倉儲管理課' },
  { username: 'papa0130',   name: '洪逸樺', dept: '倉儲管理課' },
  { username: 'lin',        name: '張秋梅', dept: '倉儲管理課' },
  { username: 'adychang',   name: '張綾娟', dept: '倉儲管理課' },
  { username: 'wandychen',  name: '陳怡如', dept: '倉儲管理課' },
  { username: 'choeuyi',    name: '陳明憶', dept: '倉儲管理課' },
  { username: 'lulu5566',   name: '曾郁茹', dept: '倉儲管理課' },
  { username: 'angieliau',  name: '廖亞仙', dept: '倉儲管理課' },
  { username: 'soda0968',   name: '蔡欣如', dept: '倉儲管理課' },
  { username: 'lynn110501', name: '鄭伊伶', dept: '倉儲管理課' },
  { username: 'huei',       name: '蕭嘉慧', dept: '倉儲管理課' },
  { username: 'antin',      name: '鮑玉婷', dept: '倉儲管理課' },
  { username: 'ebba',       name: '鍾惠玲', dept: '倉儲管理課' },

  // 大溪倉、大溪理貨一課
  { username: 'una800607',   name: '王敏瑜', dept: '大溪理貨一課' },
  { username: 'd57633',      name: '王歆語', dept: '大溪理貨一課' },
  { username: 'a033825385',  name: '王語喬', dept: '大溪理貨一課' },
  { username: 'x6706889',    name: '呂芷軒', dept: '大溪理貨一課' },
  { username: 'kiki1123',    name: '呂嘉綾', dept: '大溪理貨一課' },
  { username: 'lee0929',     name: '李育瑄', dept: '大溪理貨一課' },
  { username: 'wei',         name: '李薇',   dept: '大溪理貨一課' },
  { username: 'huj102001',   name: '林昀安', dept: '大溪理貨一課' },
  { username: 'an05566',     name: '林明霞', dept: '大溪理貨一課' },
  { username: 'a3731703',    name: '林羅響', dept: '大溪理貨一課' },
  { username: 'cpu1020',     name: '邱品惠', dept: '大溪理貨一課' },
  { username: 't48568',      name: '邱綉婷', dept: '大溪理貨一課' },
  { username: 'car55688',    name: '徐輔懋', dept: '大溪理貨一課' },
  { username: 'king',        name: '高政華', dept: '大溪理貨一課' },
  { username: 'yan',         name: '張雁婷', dept: '大溪理貨一課' },
  { username: 'ry10806005',  name: '許佑豪', dept: '大溪理貨一課' },
  { username: 'mingli1125',  name: '彭明莉', dept: '大溪理貨一課' },
  { username: 'lv6868',      name: '温惠君', dept: '大溪理貨一課' },
  { username: 'qaz1346',     name: '黃邱鴻', dept: '大溪理貨一課' },
  { username: 'd10813023',   name: '黃俊誠', dept: '大溪理貨一課' },
  { username: 'zmliu',       name: '劉姿旻', dept: '大溪理貨一課' },
  { username: 'ooxx0105',    name: '蔡晏如', dept: '大溪理貨一課' },
  { username: 'mini0228',    name: '賴韋妏', dept: '大溪理貨一課' },
  { username: 'luo',         name: '駱佩妏', dept: '大溪理貨一課' },
  { username: 'm5426',       name: '駱眉綺', dept: '大溪理貨一課' },

  // 大溪倉、大溪理貨二課
  { username: 'yu0314',    name: '方心妤', dept: '大溪理貨二課' },
  { username: 'bigcavan',  name: '全雅慈', dept: '大溪理貨二課' },
  { username: 'jiu120914', name: '江映慈', dept: '大溪理貨二課' },
  { username: 'kelly1009', name: '呂羿螢', dept: '大溪理貨二課' },
  { username: 'the1053',   name: '林玠含', dept: '大溪理貨二課' },
  { username: 'beverly',   name: '林育瑩', dept: '大溪理貨二課' },
  { username: 'avon',      name: '林雅芳', dept: '大溪理貨二課' },
  { username: 'yilu1983',  name: '陳怡茹', dept: '大溪理貨二課' },
  { username: 'yung',      name: '陳詩永', dept: '大溪理貨二課' },
  { username: 'cschen',    name: '陳嘉興', dept: '大溪理貨二課' },
  { username: 'winnie2023',name: '黃安笛', dept: '大溪理貨二課' },
  { username: 'liwen1212', name: '董麗雯', dept: '大溪理貨二課' },
  { username: 'jz13',      name: '劉俊助', dept: '大溪理貨二課' },
  { username: 'ning',      name: '鄭亦甯', dept: '大溪理貨二課' },
  { username: 'zheng1212', name: '鄭喻云', dept: '大溪理貨二課' },
  { username: 'hw289',     name: '鄭惠雯', dept: '大溪理貨二課' },
  { username: 'jiarong84', name: '謝佳蓉', dept: '大溪理貨二課' },
  { username: 'upin0122',  name: '鍾玉屏', dept: '大溪理貨二課' },
];

async function run() {
  const client = await pool.connect();
  try {
    await client.query('SET search_path TO sms');

    let usersCreated = 0, usersExisted = 0;
    let empAdded = 0, empExisted = 0;

    // ── Step 1：批次建立 sms.users ───────────────────────────────────────────
    console.log('Step 1: 建立帳號...');
    for (const e of EMPLOYEES) {
      const { rowCount } = await client.query(
        'SELECT id FROM users WHERE username = $1', [e.username]
      );
      if (rowCount > 0) {
        usersExisted++;
        process.stdout.write('.');
      } else {
        await client.query(
          `INSERT INTO users (id, username, password_hash, role, approved, display_name, page_perms, fn_perms)
           VALUES ($1, $2, 'ad_auth_only', 'worker', true, $3, '{}', '{}')`,
          [e.username, e.username, e.name]
        );
        usersCreated++;
        process.stdout.write('+');
      }
    }
    console.log(`\n帳號：新建 ${usersCreated}，已存在 ${usersExisted}`);

    // ── Step 2：更新 app_state.employees ────────────────────────────────────
    console.log('\nStep 2: 更新員工清冊...');

    // 讀取現有 app_state
    const { rows } = await client.query("SELECT data FROM app_state WHERE id='main'");
    const state = rows[0]?.data ?? {};
    const existingEmps = Array.isArray(state.employees) ? state.employees : [];
    const existingIds  = new Set(existingEmps.map(e => e.id));
    const existingEmpIds = new Set(existingEmps.map(e => (e.empId || '').toLowerCase()));

    const newEmps = [];
    for (const e of EMPLOYEES) {
      const empId = `emp_${e.username}`;
      if (existingIds.has(empId) || existingEmpIds.has(e.username)) {
        empExisted++;
        process.stdout.write('.');
      } else {
        newEmps.push({
          id:     empId,
          empId:  e.username,
          name:   e.name,
          vendor: '',
          dept:   e.dept,
          group:  '',
          status: '在職',
        });
        empAdded++;
        process.stdout.write('+');
      }
    }

    if (newEmps.length > 0) {
      const merged = [...existingEmps, ...newEmps];
      const newState = { ...state, employees: merged };
      await client.query(
        `INSERT INTO app_state (id, data, updated_at) VALUES ('main', $1, NOW())
         ON CONFLICT (id) DO UPDATE SET data = $1, updated_at = NOW()`,
        [newState]
      );
    }
    console.log(`\n員工清冊：新增 ${empAdded}，已存在 ${empExisted}`);

    console.log('\n✅ 完成！');
    console.log('說明：');
    console.log('  - 帳號已預建（AD 登入時自動驗證，不需設密碼）');
    console.log('  - 員工已加入清冊（倉別：大溪倉，課別：對應課別）');
    console.log('  - 下次管理員登入後，前端會從伺服器載入最新員工清冊');

  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => {
  console.error('執行失敗:', err.message);
  process.exit(1);
});
