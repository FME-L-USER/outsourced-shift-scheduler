/**
 * 企業級委外人力排班作業平台 (Shift Management System)
 * Single-file React application
 * Dependencies: react, react-dom, xlsx (SheetJS), file-saver
 */

import React, {
  useState, useEffect, useCallback, useRef, createContext, useContext, useMemo
} from 'react';

// ── 全域設計語系注入 ──────────────────────────────────────────
(function injectDesignTokens() {
  if (document.getElementById('sms-tokens')) return;
  // viewport meta — prevent iOS from auto-zooming
  if (!document.querySelector('meta[name="viewport"]')) {
    const vp = document.createElement('meta');
    vp.name = 'viewport';
    vp.content = 'width=device-width, initial-scale=1, maximum-scale=1';
    document.head.appendChild(vp);
  }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700&display=swap';
  document.head.appendChild(link);
  const style = document.createElement('style');
  style.id = 'sms-tokens';
  style.textContent = `
    :root {
      --sms-bg:           #FFFFFF;
      --sms-surface:      #FFFFFF;
      --sms-surface-2:    #F5F2EC;
      --sms-teal:         #1a2f5e;
      --sms-teal-dark:    #1e3870;
      --sms-teal-light:   #dbeafe;
      --sms-teal-50:      #eff6ff;
      --sms-coral:        #E05252;
      --sms-coral-bg:     #FEF2F2;
      --sms-coral-border: #FECACA;
      --sms-amber:        #B45309;
      --sms-amber-bg:     #FFFBEB;
      --sms-amber-border: #FDE68A;
      --sms-border:       #DDD9D0;
      --sms-border-dark:  #C8C4BA;
      --sms-sidebar:      #1a2f5e;
      --sms-sidebar-hover:#1e3870;
      --sms-sidebar-active:#2563eb;
      --sms-text:         #1C2B3A;
      --sms-text-muted:   #6B7280;
      --sms-radius-sm:    6px;
      --sms-radius:       10px;
      --sms-radius-lg:    14px;
    }
    html, body, #root {
      font-family: 'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif;
      font-size: 14px;
      background: var(--sms-bg);
    }
    .sms-input {
      background: var(--sms-surface) !important;
      border: 1px solid var(--sms-border) !important;
      border-radius: var(--sms-radius-sm) !important;
      font-family: inherit !important;
      font-size: 14px !important;
      transition: border-color .15s, box-shadow .15s;
    }
    .sms-input:focus {
      outline: none;
      border-color: var(--sms-teal) !important;
      box-shadow: 0 0 0 3px rgba(15,118,110,.12) !important;
    }
    .sms-btn-primary {
      background: var(--sms-teal) !important;
      color: #fff !important;
      border-radius: var(--sms-radius-sm) !important;
      font-family: inherit !important;
      font-size: 14px !important;
      font-weight: 500 !important;
      transition: background .15s;
    }
    .sms-btn-primary:hover { background: var(--sms-teal-dark) !important; }
    .sms-card {
      background: var(--sms-surface);
      border: 1px solid var(--sms-border);
      border-radius: var(--sms-radius-lg);
    }
    /* ── Mobile: prevent iOS input zoom (font-size must be ≥16px on focus) ── */
    @media (max-width: 767px) {
      input, select, textarea {
        font-size: 16px !important;
      }
      /* larger touch targets */
      button { min-height: 36px; }
      /* prevent horizontal overflow */
      body { overflow-x: hidden; }
    }
    /* ── Scrollable filter bar on mobile ── */
    .sms-filter-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none;
    }
    .sms-filter-bar::-webkit-scrollbar { display: none; }
  `;
  document.head.appendChild(style);
})();
import { createPortal } from 'react-dom';
import * as XLSX from 'xlsx-js-style';
import { saveAs } from 'file-saver';

/** Modal wrapper：用 portal 掛到 body，避免被捲動容器裁切 */
function Modal({ children, onClose }) {
  return createPortal(
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      {children}
    </div>,
    document.body
  );
}

// ─────────────────────────────────────────────
// CONSTANTS & SEED DATA
// ─────────────────────────────────────────────

const ROLES   = { ADMIN: 'admin', AREA: 'area', VENDOR: 'vendor', WORKER: 'worker', TEMP: 'temp' };
// 臨時人力自助簽到僅開放給手機控管實際使用的倉別
const TEMP_WAREHOUSE = '大肚倉';
const JWT_KEY = 'sms_jwt';

// 代碼一律用黑字：彩色文字在淺色底上對比不足，現場列印或光線不佳時難以辨識
const SHIFT_CODES = {
  V:  { label: 'V',  color: 'bg-green-100 text-slate-900',   meaning: '上班' },
  例: { label: '例', color: 'bg-yellow-100 text-slate-900',  meaning: '例休' },
  休: { label: '休', color: 'bg-orange-100 text-slate-900',  meaning: '休假' },
  國: { label: '國', color: 'bg-blue-100 text-slate-900',    meaning: '國定假日' },
  '': { label: '',   color: 'bg-white text-slate-400',       meaning: '空白' },
};

const SHIFT_CYCLE = ['V', '國', '例', '休'];

/** 廠商代碼對照表 */
const VENDOR_MAP = {
  CS: '承杺',
  CT: '芊通',
  CY: '承奕',
  DF: '頂富',
  HT: '華煬通',
  SY: '三彥',
  WY: '萬宜',
  XB: '信邦',
  GS: '高順',
  HN: '海納',
  JF: '建豐',
  JS: '勁速',
  JX: '金鑫',
  PF: '品豐',
  QQ: '全勤',
  RY: '日翊',
  YC: '閱川',
  ZY: '智遠',
};

// 廠商全名對應（匯出報表標題用，可依實際名稱修改）
const VENDOR_COMPANY_NAMES = {
  '承杺': '承杺管理顧問有限公司',
  '芊通': '芊通管理顧問有限公司',
  '承奕': '承奕管理顧問有限公司',
  '頂富': '頂富管理顧問有限公司',
  '華煬通': '華煬通管理顧問有限公司',
  '三彥': '三彥管理顧問有限公司',
  '萬宜': '萬宜管理顧問有限公司',
  '信邦': '信邦管理顧問有限公司',
  '高順': '高順管理顧問有限公司',
  '海納': '海納管理顧問有限公司',
  '建豐': '建豐管理顧問有限公司',
  '勁速': '勁速管理顧問有限公司',
  '金鑫': '金鑫管理顧問有限公司',
  '品豐': '品豐管理顧問有限公司',
  '全勤': '全勤管理顧問有限公司',
  '日翊': '日翊管理顧問有限公司',
  '閱川': '閱川管理顧問有限公司',
  '智遠': '智遠管理顧問有限公司',
};

/** 作業區種子清單。每位人員可指派一個作業區；空字串＝未設定。
 *  清單可於系統設定增修，此處僅為初次啟用時的預設值。 */
// 點名表／手機控管／出勤回報與統計的廠商顯示順序（現場慣用排列，非字典序）。
// 不在清單內的廠商排在後面，並維持原本出現的順序。
const VENDOR_ORDER = ['萬宜', '承奕', '華煬通', '三彥', '信邦'];
const vendorRank = v => {
  const i = VENDOR_ORDER.indexOf(normName(v));
  return i === -1 ? VENDOR_ORDER.length : i;
};
/** 依 VENDOR_ORDER 排序廠商名稱；同順位者保留傳入順序（穩定排序） */
function sortVendorNames(names) {
  return [...names].sort((a, b) => vendorRank(a) - vendorRank(b));
}

const CELL_SEP = '|';   // 員工 id 與日期鍵都不會出現此字元
/** 由「已改動格子」清單組出只含這些格子的班表 payload。
 *  值為 undefined（該格已被清掉或人員已刪除）時送空字串，代表空白班別。 */
function buildDirtySchedule(cells, schedule) {
  const out = {};
  for (const key of cells) {
    const i = key.indexOf(CELL_SEP);
    if (i < 0) continue;
    const empId = key.slice(0, i), dk = key.slice(i + 1);
    (out[empId] ??= {})[dk] = schedule?.[empId]?.[dk] ?? '';
  }
  return out;
}

const REST_QUOTA = 8;   // 開放委外排休時，每期休＋例合計上限（幹部與人員共用同一額度值）
const SEED_WORK_AREAS = ['O2O', '團預購', '收發', '廠退', '外場', '小白單'];

/** 廠商種子資料（從 VENDOR_MAP 展開） */
const SEED_VENDORS = Object.entries(VENDOR_MAP).map(([code, name]) => ({
  id: 'vd_' + code.toLowerCase(),
  code,
  name,
}));

// ─────────────────────────────────────────────
// ROC NATIONAL HOLIDAYS (中華民國國定假日)
// ─────────────────────────────────────────────
// Format: { year (CE), month, day, name }
const NATIONAL_HOLIDAYS = [
  // 114年 (2025)
  { year: 2025, month: 1,  day: 1,  name: '元旦' },
  { year: 2025, month: 1,  day: 27, name: '小年夜' },
  { year: 2025, month: 1,  day: 28, name: '農曆除夕' },
  { year: 2025, month: 1,  day: 29, name: '春節' },
  { year: 2025, month: 1,  day: 30, name: '春節' },
  { year: 2025, month: 1,  day: 31, name: '春節' },
  { year: 2025, month: 2,  day: 28, name: '二二八和平紀念日' },
  { year: 2025, month: 4,  day: 4,  name: '兒童節' },
  { year: 2025, month: 5,  day: 1,  name: '勞動節' },
  { year: 2025, month: 5,  day: 31, name: '端午節' },
  { year: 2025, month: 9,  day: 28, name: '教師節' },
  { year: 2025, month: 10, day: 6,  name: '中秋節' },
  { year: 2025, month: 10, day: 10, name: '國慶日' },
  { year: 2025, month: 10, day: 25, name: '光復節' },
  { year: 2025, month: 12, day: 25, name: '行憲紀念日' },
  // 115年 (2026)
  { year: 2026, month: 1,  day: 1,  name: '元旦' },
  { year: 2026, month: 2,  day: 15, name: '小年夜' },
  { year: 2026, month: 2,  day: 16, name: '農曆除夕' },
  { year: 2026, month: 2,  day: 17, name: '春節' },
  { year: 2026, month: 2,  day: 18, name: '春節' },
  { year: 2026, month: 2,  day: 19, name: '春節' },
  { year: 2026, month: 2,  day: 28, name: '二二八和平紀念日' },
  { year: 2026, month: 4,  day: 3,  name: '兒童節' },
  { year: 2026, month: 4,  day: 5,  name: '清明節' },
  { year: 2026, month: 5,  day: 1,  name: '勞動節' },
  { year: 2026, month: 6,  day: 19, name: '端午節' },
  { year: 2026, month: 9,  day: 25, name: '中秋節' },
  { year: 2026, month: 9,  day: 28, name: '教師節' },
  { year: 2026, month: 10, day: 10, name: '國慶日' },
  { year: 2026, month: 10, day: 25, name: '光復節' },
  { year: 2026, month: 12, day: 25, name: '行憲紀念日' },
];

// ─────────────────────────────────────────────
// PERMISSION DEFINITIONS
// ─────────────────────────────────────────────

const PAGE_PERMISSIONS = [
  { key: 'dashboard',  label: '儀表板',    features: [] },
  { key: 'schedule',   label: '班表管理',  features: [
    { key: 'editSchedule', label: '編輯班表' },
    { key: 'exportReport', label: '匯出報表' },
  ]},
  { key: 'employees',  label: '人員清冊',  features: [
    { key: 'addEmployee',    label: '新增人員' },
    { key: 'editEmployee',   label: '編輯人員' },
    { key: 'deleteEmployee', label: '刪除人員' },
    { key: 'importRoster',   label: '匯入清冊' },
    { key: 'clearAll',       label: '清除全部' },
  ]},
  { key: 'reports',    label: '報表匯出',  features: [
    { key: 'exportExcel', label: '匯出Excel' },
  ]},
  { key: 'shiftcodes', label: '班別代號表', features: [
    { key: 'editCodes',   label: '新增/刪除' },
    { key: 'exportCodes', label: '匯出' },
  ]},
  { key: 'settings',   label: '系統設定',  features: [
    { key: 'lockSchedule',    label: '排班鎖定' },
    { key: 'manageWarehouse', label: '倉別管理' },
  ]},
  { key: 'accounts',   label: '帳號管理',  features: [
    { key: 'addAccount',    label: '新增帳號' },
    { key: 'editAccount',   label: '編輯帳號' },
    { key: 'deleteAccount', label: '刪除帳號' },
  ]},
  { key: 'attendance', label: '點名表', features: [
    { key: 'editAttendance',   label: '編輯點名' },
    { key: 'exportAttendance', label: '匯出點名' },
  ]},
  { key: 'phoneControl', label: '手機控管', features: [
    { key: 'assignLocker', label: '分配櫃號' },
  ]},
];

function getDefaultPermissions(role) {
  const isAdmin  = role === ROLES.ADMIN;
  const isArea   = role === ROLES.AREA;
  const perms = {};
  PAGE_PERMISSIONS.forEach(page => {
    const isWorker = role === ROLES.WORKER;
    const pageVisible =
      isAdmin ? true :
      isArea  ? page.key !== 'accounts' :   // 系統設定預設開放（頁內僅限本倉可設定的項目）
      isWorker ? page.key === 'schedule' :
      // 廠商幹部：預設僅開放班表管理與報表匯出，其餘（點名表、手機控管、
      // 人員清冊等）一律關閉，需由管理員個別開啟
      ['schedule','reports'].includes(page.key);

    perms[page.key] = { view: pageVisible };
    page.features.forEach(f => {
      const on = pageVisible && (
        isAdmin ? true :
        isArea  ? !['deleteEmployee','clearAll','addAccount','editAccount','deleteAccount'].includes(f.key) :
        role === ROLES.WORKER ? f.key === 'editSchedule' :
        // 報表匯出頁若不含匯出功能等同無用，故與頁面一併開放
        ['editSchedule','exportExcel'].includes(f.key)
      );
      perms[page.key][f.key] = on;
    });
  });
  return perms;
}

/**
 * 倉別種子資料（三層：倉別 → 課別 → 組別）
 * 來源：倉別代號.xlsx
 * 結構：{ id, name, departments: [{ id, code, name, vendors[], groups: string[] }] }
 * 各課廠商＝該課所有組別實際進駐廠商的聯集（來源：課別/組別/廠商對照表）。
 */
const DEPT_VENDORS = {
  daxi1:    ['芊通','高順','海納','建豐','勁速','金鑫','品豐','全勤','日翊','閱川','智遠'],
  daxi2:    ['芊通','高順','海納','建豐','勁速','全勤','日翊','閱川','智遠'],
  cangchu:  ['高順','建豐','勁速','金鑫','品豐','日翊','閱川','智遠'],
  yunwu:    ['芊通','高順','建豐','勁速','品豐','智遠'],
  yingyun:  ['日翊'],
  dadu1:    ['承奕','華煬通','三彥','萬宜','信邦'],
  dadu2:    ['承奕','華煬通','三彥','萬宜'],
  gangshan: ['承杺','芊通','頂富'],
};
const SEED_WAREHOUSES = [
  {
    id: 'wh1', name: '大溪倉',
    departments: [
      {
        id: 'dept_wh1_1', code: 'L027', name: '大溪理貨一課', vendors: [...DEPT_VENDORS.daxi1],
        groups: ['日班-理貨一組','日班-理貨二組','中班-理貨一組',
                 '日班-驗收組','夜班-驗收組','中班-驗收組','日班-EC廠退組'],
      },
      {
        id: 'dept_wh1_2', code: 'L022', name: '大溪理貨二課', vendors: [...DEPT_VENDORS.daxi2],
        groups: ['日班-店訂組','日班-退貨組','中班-分揀組','日班-加工組','日班-POP組'],
      },
      {
        id: 'dept_wh1_3', code: 'L021', name: '倉儲管理課', vendors: [...DEPT_VENDORS.cangchu],
        groups: ['日班-庫存組','日班-廠退組','日班-收發組','清潔組','中班-庫存組'],
      },
      {
        id: 'dept_wh1_4', code: 'L025', name: '運務課', vendors: [...DEPT_VENDORS.yunwu],
        groups: ['運務組'],
      },
      {
        id: 'dept_wh1_5', code: 'L012', name: '營運推進課', vendors: [...DEPT_VENDORS.yingyun],
        groups: ['日班-單據組'],
      },
    ],
  },
  {
    id: 'wh2', name: '大肚倉',
    departments: [
      {
        id: 'dept_wh2_1', code: 'L035', name: '大肚理貨課', vendors: [...DEPT_VENDORS.dadu1],
        groups: ['日班-理貨組','中班-理貨組','清潔組','日班-出貨組'],
      },
      {
        id: 'dept_wh2_2', code: 'L037', name: '大肚運務課', vendors: [...DEPT_VENDORS.dadu2],
        groups: ['運務組-日班','運務組-中班','運務組-夜班'],
      },
    ],
  },
  {
    id: 'wh3', name: '岡山倉',
    departments: [
      {
        id: 'dept_wh3_1', code: 'L007', name: '岡山營運課', vendors: [...DEPT_VENDORS.gangshan],
        groups: ['日班-理貨組','中班-理貨組','夜班-理貨組','日班-出貨組'],
      },
    ],
  },
];

/** 初始帳號種子資料
 *  ⚠️  密碼欄位請第一次登入後立即至帳號管理修改
 *  seed 密碼故意設為空字串，第一次登入前管理員需由後台建立正式帳號
 */
const mkUser = (id, username, password, role, name, vendors, system = false) => ({
  id, username, password, role, name, vendors, system,
  allowedWarehouses: [],
  approved: true, loginCount: 0,
  permissions: getDefaultPermissions(role),
});
const SEED_USERS = [
  // 預設密碼僅供首次登入；系統會強制要求立即修改
  { ...mkUser('u0', 'admin',  'Admin@2024!', ROLES.ADMIN,  '系統管理員',    SEED_VENDORS.map(v=>v.name), true),  mustChangePassword: true },
  { ...mkUser('u2', 'area01', 'Area@2024!',  ROLES.AREA,   '當區幹部A',     SEED_VENDORS.map(v=>v.name)),        mustChangePassword: true },
  { ...mkUser('u3', 'cs',     'Cs@2024!',    ROLES.VENDOR, 'CS 承杺幹部',   ['承杺']),                           mustChangePassword: true },
  { ...mkUser('u4', 'ct',     'Ct@2024!',    ROLES.VENDOR, 'CT 芊通幹部',   ['芊通']),                           mustChangePassword: true },
  { ...mkUser('u5', 'cy',     'Cy@2024!',    ROLES.VENDOR, 'CY 承奕幹部',   ['承奕']),                           mustChangePassword: true },
  { ...mkUser('u6', 'df',     'Df@2024!',    ROLES.VENDOR, 'DF 頂富幹部',   ['頂富']),                           mustChangePassword: true },
  { ...mkUser('u7', 'ht',     'Ht@2024!',    ROLES.VENDOR, 'HT 華煬通幹部', ['華煬通']),                         mustChangePassword: true },
  { ...mkUser('u8', 'sy',     'Sy@2024!',    ROLES.VENDOR, 'SY 三彥幹部',   ['三彥']),                           mustChangePassword: true },
  { ...mkUser('u9', 'wy',     'Wy@2024!',    ROLES.VENDOR, 'WY 萬宜幹部',   ['萬宜']),                           mustChangePassword: true },
  { ...mkUser('u10','xb',     'Xb@2024!',    ROLES.VENDOR, 'XB 信邦幹部',   ['信邦']),                           mustChangePassword: true },
];

/** 初始員工種子資料 */
const SEED_EMPLOYEES = [
  { id: 'e1', empId: 'CS001', name: '範例員工A', vendor: '承杺',  dept: '', group: '', status: '在職' },
  { id: 'e2', empId: 'CT001', name: '範例員工B', vendor: '芊通',  dept: '', group: '', status: '在職' },
  { id: 'e3', empId: 'CY001', name: '範例員工C', vendor: '承奕',  dept: '', group: '', status: '在職' },
  { id: 'e4', empId: 'DF001', name: '範例員工D', vendor: '頂富',  dept: '', group: '', status: '在職' },
  { id: 'e5', empId: 'HT001', name: '範例員工E', vendor: '華煬通', dept: '', group: '', status: '在職' },
  { id: 'e6', empId: 'SY001', name: '範例員工F', vendor: '三彥',  dept: '', group: '', status: '在職' },
  { id: 'e7', empId: 'WY001', name: '範例員工G', vendor: '萬宜',  dept: '', group: '', status: '在職' },
  { id: 'e8', empId: 'XB001', name: '範例員工H', vendor: '信邦',  dept: '', group: '', status: '在職' },
];

const getDaysInMonth = (year, month) => new Date(year, month, 0).getDate();
const dateKey = (year, month, day) => `${year}-${month}-${day}`;
const parseLocal = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); };

// 依開放排班區間推算「包含今天」的週期偏移量（0 = 設定的區間本身，負數 = 往前的週期）
// 設定的區間常是未來期（例如今天 9/1、區間 9/7~10/4），登入時應自動顯示今天所在的那一期
// 開放排班區間一律以「課別」為準（全域設定已取消）。
// 該課別未設定 → 回傳空物件，代表尚未開放，任何人都不可編輯。
function resolveRange(deptRanges, deptName) {
  const r = deptName ? deptRanges?.[deptName] : null;
  return (r?.start && r?.end) ? r : {};
}

// 各課別區間的聯集，作為系統層級的參考範圍：
// 僅用於報表檢視與國定假日篩選，「可否編輯」一律看員工所屬課別的區間。
function unionDeptRange(deptRanges) {
  const rs = Object.values(deptRanges ?? {}).filter(r => r?.start && r?.end);
  if (rs.length === 0) return {};
  return {
    start: rs.reduce((a, r) => (r.start < a ? r.start : a), rs[0].start),
    end:   rs.reduce((a, r) => (r.end   > a ? r.end   : a), rs[0].end),
  };
}

// ── 排班區間（多段）─────────────────────────────────────────
// 一個課別可以有多段區間，每段各自帶鎖定模式與適用組別，例如：
//   大肚理貨課
//     ├─ 9/5～10/4   部分鎖定   適用：日班-出貨組
//     └─ 10/5～11/1  解除鎖定   適用：日班-出貨組
// 未被任何一段涵蓋的日期＝尚未開放，任何角色都不可編輯。
// 舊資料（deptRanges / deptLocks，每課單一區間）會自動視為「一段、適用全部組別」，
// 不需要重建設定。
/** 取得某課別的區間段落；沒有新格式時，由舊的單一區間推導 */
function segmentsOf(deptSegments, deptRanges, deptLocks, deptName) {
  if (!deptName) return [];
  const segs = deptSegments?.[deptName];
  if (Array.isArray(segs) && segs.length > 0) return segs;
  const r = deptRanges?.[deptName];
  if (r?.start && r?.end) {
    return [{ id: 'legacy', start: r.start, end: r.end,
              lock: normalizeLockMode(deptLocks?.[deptName]), groups: [] }];
  }
  return [];
}

/** 該段是否適用此組別（groups 為空＝適用該課全部組別） */
function segCoversGroup(seg, group) {
  return !seg.groups?.length || seg.groups.includes(group);
}

/** 該段是否涵蓋此日期（dk 為班表鍵，不補零；段落起訖為 yyyy-mm-dd） */
function segCoversDate(seg, dk) {
  if (!seg.start || !seg.end) return false;
  const [y, m, d] = dk.split('-').map(Number);
  const t = new Date(y, m - 1, d).getTime();
  return t >= parseLocal(seg.start).getTime() && t <= parseLocal(seg.end).getTime();
}

/** 指定角色能否編輯某員工的某一天：只要有任一段允許即可 */
function canEditBySegments(segs, group, dk, role) {
  return segs.some(s => segCoversGroup(s, group) && segCoversDate(s, dk) && lockAllowsEdit(s.lock, role));
}

/** 該組別「看得到排班」的整體範圍（不論鎖定模式），用於灰底與連續天數的界線 */
function visibleRangeOfGroup(segs, group) {
  const rs = segs.filter(s => segCoversGroup(s, group) && s.start && s.end);
  if (rs.length === 0) return {};
  return {
    start: rs.reduce((a, r) => (r.start < a ? r.start : a), rs[0].start),
    end:   rs.reduce((a, r) => (r.end   > a ? r.end   : a), rs[0].end),
  };
}

/** 全系統所有段落的聯集，供報表檢視與國定假日篩選使用 */
function unionAllSegments(deptSegments, deptRanges) {
  const all = [
    ...Object.values(deptSegments ?? {}).flat(),
    ...Object.values(deptRanges ?? {}),
  ].filter(r => r?.start && r?.end);
  if (all.length === 0) return {};
  return {
    start: all.reduce((a, r) => (r.start < a ? r.start : a), all[0].start),
    end:   all.reduce((a, r) => (r.end   > a ? r.end   : a), all[0].end),
  };
}

function todayPeriodOffset(scheduleRange) {
  if (!scheduleRange?.start || !scheduleRange?.end) return 0;
  const s = parseLocal(scheduleRange.start);
  const e = parseLocal(scheduleRange.end);
  const periodLen = Math.round((e - s) / 86400000) + 1;
  if (!Number.isFinite(periodLen) || periodLen <= 0) return 0;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.floor(Math.round((today - s) / 86400000) / periodLen);
}

const buildDefaultSchedule = (employees, year, month) => {
  const days = getDaysInMonth(year, month);
  const schedule = {};
  employees.forEach(emp => {
    schedule[emp.id] = {};
    for (let d = 1; d <= days; d++) schedule[emp.id][dateKey(year, month, d)] = 'V';
  });
  return schedule;
};

// ─────────────────────────────────────────────
// CONTEXT
// ─────────────────────────────────────────────

const AppContext = createContext(null);
const useApp = () => useContext(AppContext);

// ─────────────────────────────────────────────
// TOAST COMPONENT
// ─────────────────────────────────────────────

const ToastContext = createContext(null);

// AppProvider 位於 ToastProvider 外層，無法呼叫 useToast，
// 故由 ToastProvider 掛上一個模組層的橋接函式供其使用。
let globalToast = null;
function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const push = useCallback((message, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }, []);

  const remove = useCallback(id => setToasts(prev => prev.filter(t => t.id !== id)), []);

  const typeStyle = {
    success: 'bg-green-600',
    error:   'bg-red-600',
    warn:    'bg-yellow-500',
    info:    'bg-blue-600',
  };

  useEffect(() => { globalToast = push; return () => { globalToast = null; }; }, [push]);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-72">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`flex items-start gap-2 px-4 py-3 rounded-lg shadow-lg text-white text-sm
                        animate-slideIn ${typeStyle[t.type] ?? typeStyle.info}`}
          >
            <span className="flex-1">{t.message}</span>
            <button onClick={() => remove(t.id)} className="ml-2 opacity-70 hover:opacity-100 text-lg leading-none">&times;</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const useToast = () => useContext(ToastContext);

// ─────────────────────────────────────────────
// LOCAL STORAGE HELPERS
// ─────────────────────────────────────────────

const LS = {
  get: (key, fallback) => {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch { return fallback; }
  },
  set: (key, value, onQuotaError) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      if (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
        if (onQuotaError) onQuotaError();
        else console.warn('localStorage 已滿，資料可能未儲存：', key);
      }
    }
  },
};

// 密碼雜湊工具（PBKDF2 + 隨機 salt，Web Crypto API）
// 格式：pbkdf2:<saltHex>:<hashHex>
// 向後相容 sha256:... 及明文（比對後自動升級為 pbkdf2）
const hashPwd = async (plain) => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMat = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(plain), { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' }, keyMat, 256
  );
  const toHex = arr => Array.from(arr).map(b => b.toString(16).padStart(2,'0')).join('');
  return `pbkdf2:${toHex(salt)}:${toHex(new Uint8Array(bits))}`;
};
const _sha256Hash = async (plain) => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(plain));
  return 'sha256:' + Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
};
const verifyPwd = async (input, stored) => {
  if (!stored) return false;
  if (stored.startsWith('pbkdf2:')) {
    const [, saltHex, hashHex] = stored.split(':');
    const salt = new Uint8Array(saltHex.match(/.{2}/g).map(h => parseInt(h, 16)));
    const keyMat = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(input), { name: 'PBKDF2' }, false, ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' }, keyMat, 256
    );
    const candidate = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2,'0')).join('');
    return candidate === hashHex;
  }
  if (stored.startsWith('sha256:')) return (await _sha256Hash(input)) === stored;
  return input === stored; // 舊明文：比對後在外層自動升級
};

// ─────────────────────────────────────────────
// SHARED EMPLOYEE FILTER HELPER
// filterEmployees(list, warehouses, selectedWarehouse, selectedDept, selectedGroup)
// Applies warehouse → dept (vendor) → group cascading filter.
// ─────────────────────────────────────────────

// ── 手機控管鐵櫃設定（目前僅大肚倉使用）──────────────────────────
// 每個鐵櫃 75 格；鐵櫃一由兩個組別共用，須依 order 先後填格位。
const LOCKER_CAPACITY = 75;
// 鐵櫃二為臨時人力專用：每日配發、隔日釋出，由伺服器在建檔時自動配號
const TEMP_LOCKER_CAB = '二';
const LOCKER_CABINETS = [
  { id: '一', groups: ['日班-理貨組'] },
  { id: '三', groups: ['中班-理貨組', '運務組'] },   // 共用，依此順序填格
  { id: '四', groups: ['日班-出貨組'] },
];
// 組別 → 鐵櫃編號
const LOCKER_GROUP_CABINET = Object.fromEntries(
  LOCKER_CABINETS.flatMap(c => c.groups.map(g => [g, c.id])));

const lockerLabel = a => (a ? `鐵櫃 ${a.cab}：${a.slot}號格` : '');

// 手機繳交狀態互斥對照：已繳交與未交不可同時成立
const PHONE_OPPOSITE = { phoneSubmitted: 'phoneNotSubmitted', phoneNotSubmitted: 'phoneSubmitted' };

/**
 * 配置櫃號。既有配置一律保留（櫃號固定綁定人員），只補未配置者，
 * 並回收離職／調離該組人員空出的格位。
 * @returns {{ assign, assigned, released, overflow }}
 */
function assignLockers(employees, prevAssign) {
  const assign = {};
  const overflow = [];
  let assigned = 0;

  // 仍在該鐵櫃編制內的人員，依組別順序 → 員工編號排列
  const rank = new Map();
  LOCKER_CABINETS.forEach(c => c.groups.forEach((g, i) => rank.set(g, i)));

  for (const cab of LOCKER_CABINETS) {
    const members = employees
      .filter(e => cab.groups.includes(e.group))
      .sort((a, b) =>
        (rank.get(a.group) - rank.get(b.group)) ||
        String(a.empId ?? '').localeCompare(String(b.empId ?? '')));

    // 保留既有格位（僅限本櫃且未被佔用者）
    const taken = new Set();
    const keep = new Map();
    for (const e of members) {
      const prev = prevAssign?.[e.id];
      if (prev && prev.cab === cab.id && prev.slot >= 1 && prev.slot <= LOCKER_CAPACITY
          && !taken.has(prev.slot)) {
        taken.add(prev.slot);
        keep.set(e.id, prev.slot);
      }
    }

    // 未配置者依序取用最小的空格
    let next = 1;
    for (const e of members) {
      if (keep.has(e.id)) { assign[e.id] = { cab: cab.id, slot: keep.get(e.id) }; continue; }
      while (next <= LOCKER_CAPACITY && taken.has(next)) next++;
      if (next > LOCKER_CAPACITY) { overflow.push(e); continue; }
      taken.add(next);
      assign[e.id] = { cab: cab.id, slot: next };
      assigned++;
    }
  }

  const released = Object.keys(prevAssign ?? {}).filter(id => !assign[id]).length;
  return { assign, assigned, released, overflow };
}

// 當日是否已有實際出勤動作（簽到／簽退／手機控管／點名）。
// 注意須讀原始 attendData，不可用 getRecord——後者會依班表補上預設值，
// 導致每個人看起來都「有紀錄」。
const PHONE_SLOT_KEYS = ['morning', 'noon', 'afternoon', 'ot'];
function hasAttendActivity(rec) {
  if (!rec) return false;
  if (rec.signedIn || rec.signedOut || rec.phoneSubmitted || rec.phoneNotSubmitted || rec.present) return true;
  return PHONE_SLOT_KEYS.some(k => rec[`${k}Taken`] || rec[`${k}Returned`]);
}

// 班別清單依倉別分開儲存，但員工只存 shiftTypeId、未記錄來源倉別。
// 若指派時選的是「全部倉別」或其他倉別，之後切換倉別就會查不到而顯示未指派
// （資料仍在，只是查錯清單）。故先查當前倉別，找不到再跨所有倉別搜尋一次。
function findShiftType(shiftTypesByWh, whKey, id) {
  if (!id) return null;
  const here = (shiftTypesByWh?.[whKey] ?? SHIFT_TYPE_DEFAULTS).find(t => t.id === id);
  if (here) return here;
  for (const list of Object.values(shiftTypesByWh ?? {})) {
    const hit = Array.isArray(list) ? list.find(t => t.id === id) : null;
    if (hit) return hit;
  }
  return SHIFT_TYPE_DEFAULTS.find(t => t.id === id) ?? null;
}

// 該課別在倉別設定中登錄的組別。回傳 null 代表查無此課別（無從判定，不視為異常）。
// 用於辨識「組別不在系統清單中」的人員——這種資料看起來正常，
// 但用組別篩選時會被靜默濾掉，必須明確標示出來。
function validGroupsOfDept(warehouses, deptName) {
  if (!deptName) return null;
  for (const w of warehouses ?? []) {
    const d = (w.departments ?? []).find(x => x.name === deptName);
    if (d) return new Set(d.groups ?? []);
  }
  return null;
}
function isUnknownGroup(warehouses, emp) {
  if (!emp?.group) return false;
  const valid = validGroupsOfDept(warehouses, emp.dept);
  return !!valid && !valid.has(emp.group);
}

// 臨時人員（extras）只帶「組別 + 廠商」，沒有倉別/課別欄位，
// 故倉別與課別必須由組別回推：找出哪個倉、哪個課的 groups 含這個組別。
function deptOfGroup(warehouses, groupName) {
  if (!groupName) return null;
  for (const w of warehouses ?? [])
    for (const d of (w.departments ?? []))
      if ((d.groups ?? []).includes(groupName)) return { whId: w.id, whName: w.name, deptName: d.name };
  return null;
}
// 依上方篩選列（倉別／課別／組別／廠商）篩選當日臨時人員。
// 組別已不存在於任何課（例如拆分前的舊「運務組」）時，一旦有倉別或課別條件即不顯示，
// 避免大肚理貨課的畫面上跑出運務課的臨時人力。
function filterExtrasByScope(list, warehouses, selectedWarehouse, selectedDeptName, selectedGroup, selectedVendor) {
  return (list ?? []).filter(e => {
    if (selectedVendor && e.vendor !== selectedVendor) return false;
    if (selectedGroup) return !e.group || e.group === selectedGroup;
    if (selectedDeptName || selectedWarehouse) {
      const owner = deptOfGroup(warehouses, e.group);
      if (!owner) return false;
      if (selectedDeptName  && owner.deptName !== selectedDeptName) return false;
      if (selectedWarehouse && owner.whId     !== selectedWarehouse) return false;
    }
    return true;
  });
}

// 名稱比對用正規化：去掉半形/全形空白、零寬字元，避免「三彥 」被當成新廠商
function normName(v) {
  return (v ?? '').toString().replace(/[\s　​﻿]/g, '');
}

// 依作業區篩選；'__none__' 代表尚未指派作業區者
function filterByWorkArea(list, area) {
  if (!area) return list;
  if (area === '__none__') return list.filter(e => !e.workArea);
  return list.filter(e => e.workArea === area);
}

function filterByScope(list, warehouses, selectedWarehouse, selectedDept, selectedGroup, selectedWorkArea) {
  if (selectedDept) {
    const wh   = warehouses.find(w => w.id === selectedWarehouse);
    const dept = wh?.departments?.find(d => d.id === selectedDept);
    if (dept) {
      list = list.filter(e => {
        // 優先以 e.dept（課別名稱）比對，無 dept 欄位則退回廠商比對
        if (e.dept) return e.dept === dept.name;
        return dept.vendors?.includes(e.vendor) ?? false;
      });
    }
    if (selectedGroup) list = list.filter(e => e.group === selectedGroup);
  } else if (selectedWarehouse) {
    const wh = warehouses.find(w => w.id === selectedWarehouse);
    if (wh && (wh.departments ?? []).length > 0) {
      const deptNames = new Set((wh.departments ?? []).map(d => d.name));
      const whVendors = new Set((wh.departments ?? []).flatMap(d => d.vendors));
      list = list.filter(e => {
        if (e.dept) return deptNames.has(e.dept);
        return whVendors.has(e.vendor);
      });
    }
    // 倉庫未設定課別時不過濾（顯示全部員工）
  }
  return filterByWorkArea(list, selectedWorkArea);
}

// ─────────────────────────────────────────────
// AUTH SCREEN
// ─────────────────────────────────────────────

// ── 強制改密碼精靈（首次登入或管理員要求）──
function ForcePwdChange({ user, onDone }) {
  const [form, setForm] = useState({ pwd: '', confirm: '' });
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async e => {
    e.preventDefault();
    setErr('');
    if (form.pwd.length < 8)               { setErr('密碼至少需 8 個字元'); return; }
    if (!/[A-Za-z]/.test(form.pwd))        { setErr('密碼需包含至少一個英文字母'); return; }
    if (!/[0-9]/.test(form.pwd))           { setErr('密碼需包含至少一個數字'); return; }
    if (form.pwd !== form.confirm)          { setErr('兩次密碼不一致'); return; }
    setBusy(true);
    const hashed = await hashPwd(form.pwd);
    // 必須等 onDone 回報伺服器是否真的收到。以前不等結果就放行，寫入失敗時
    // 密碼只留在本機，畫面卻顯示成功，之後新密碼一律「密碼錯誤」，只有員編能登入。
    const ok = await onDone({ ...user, password: hashed, mustChangePassword: false });
    if (ok === false) {
      setBusy(false);
      setErr('密碼未能儲存到伺服器，請確認網路後再試一次（尚未生效，請勿關閉本頁）');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="bg-white rounded-xl shadow-sm w-full max-w-sm p-8 border border-[#DDD9D0]">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-teal-50 rounded-xl mb-3">
            <svg className="w-7 h-7 text-teal-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
            </svg>
          </div>
          <h2 className="text-xl font-bold text-slate-800">請設定新密碼</h2>
          <p className="text-sm text-slate-500 mt-1">首次登入必須修改預設密碼後才能繼續使用</p>
        </div>
        {err && <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{err}</div>}
        <form onSubmit={handleSubmit} className="space-y-4">
          {[
            { label: '新密碼',    key: 'pwd',     ph: '至少 8 碼，含英文及數字' },
            { label: '確認新密碼', key: 'confirm', ph: '再次輸入新密碼' },
          ].map(f => (
            <div key={f.key}>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{f.label}</label>
              <div className="relative">
                <input type={show ? 'text' : 'password'} value={form[f.key]} placeholder={f.ph}
                  onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                  className="w-full px-4 py-2.5 bg-white border border-[#DDD9D0] rounded-xl text-sm pr-10
                             focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition" />
                {f.key === 'pwd' && (
                  <button type="button" onClick={() => setShow(p => !p)}
                    className="absolute inset-y-0 right-3 flex items-center text-slate-400 hover:text-slate-600">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      {show
                        ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M3 3l18 18"/>
                        : <><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></>
                      }
                    </svg>
                  </button>
                )}
              </div>
            </div>
          ))}
          <div className="text-xs text-slate-400 bg-[#F5F2EC] rounded-lg p-3">
            密碼規則：至少 8 個字元，需包含英文字母與數字
          </div>
          <button type="submit" disabled={busy}
            className="w-full py-3 bg-[#1a2f5e] hover:bg-[#1e3870] disabled:opacity-50 text-white font-semibold rounded-xl transition-colors text-sm shadow-sm">
            {busy ? '儲存中…' : '儲存新密碼並進入系統'}
          </button>
        </form>
      </div>
    </div>
  );
}

function LoginScreen({ users, onLogin, onRegister, vendors, employees, workerPwds = {}, warehouses = [] }) {
  // identity: null | 'riyi' | 'vendor_mgr' | 'worker' | 'register'
  const [identity, setIdentity] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState('');
  const [accessNotice, setAccessNotice] = useState(''); // 權限申請中的提示（非錯誤）
  const [accessForm, setAccessForm] = useState(null);   // 權限申請補件表單（AD 不回傳姓名）
  const [accessBusy, setAccessBusy] = useState(false);
  const [lockUntil, setLockUntil] = useState(0);

  // 鎖定倒數：鎖定期間每秒更新顯示，到期自動解鎖
  useEffect(() => {
    if (lockUntil <= 0) return;
    const tick = () => {
      const rem = lockUntil - Date.now();
      if (rem <= 0) {
        setLockUntil(0);
        setError('');
      } else {
        const m = Math.floor(rem / 60000);
        const s = Math.ceil((rem % 60000) / 1000);
        setError(`登入失敗次數過多，帳號已鎖定，請 ${m > 0 ? `${m} 分 ` : ''}${s} 秒後再試`);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lockUntil]);



  // 申請表單狀態
  const [regForm, setRegForm] = useState({ username: '', password: '', confirm: '', name: '', warehouse: '', vendor: '' });
  const [regError, setRegError] = useState('');
  const [regDone, setRegDone] = useState(false);

  const vendorNames = vendors?.map(v => v.name) ?? [];

  const IDENTITY_OPTIONS = [
    { value: 'riyi',       label: '日翊' },
    { value: 'vendor_mgr', label: '廠商幹部' },
    { value: 'worker',     label: '委外人員' },
    { value: 'temp',       label: `臨時人力（${TEMP_WAREHOUSE}）` },
  ];

  const IDENTITY_INFO = {
    riyi:       { text: '使用公司 AD 帳號（Windows 登入帳號）及密碼登入', color: 'bg-teal-50 border-blue-100 text-blue-700' },
    vendor_mgr: { text: '須請日翊申請，或由委外人員升級廠商幹部', color: 'bg-teal-50 border-teal-100 text-emerald-700' },
    worker:     { text: '帳號與密碼皆為員工編號，不需另外設定密碼', color: 'bg-amber-50 border-amber-100 text-amber-700' },
    temp:       { text: `${TEMP_WAREHOUSE}當日臨時支援人力，免帳號密碼；填寫廠商、班別與姓名即可簽到`, color: 'bg-violet-50 border-violet-100 text-violet-700' },
  };

  const switchIdentity = v => { setIdentity(v); setUsername(''); setPassword(''); setError(''); };

  // ── 臨時人力：免帳密，填寫廠商／班別／姓名即可進入簽到畫面 ──
  const [tempForm, setTempForm] = useState({ vendor: '', group: '', name: '' });
  // 手機控管目前僅大肚倉使用，故臨時人力的廠商與班別只列出大肚倉的選項
  const tempWh = useMemo(() => warehouses.find(w => w.name === TEMP_WAREHOUSE), [warehouses]);
  const tempGroupOptions = useMemo(() => {
    const set = new Set();
    (tempWh?.departments ?? []).forEach(d => (d.groups ?? []).forEach(g => set.add(g)));
    return [...set];
  }, [tempWh]);
  const tempVendorOptions = useMemo(() => {
    const set = new Set();
    (tempWh?.departments ?? []).forEach(d => (d.vendors ?? []).forEach(v => set.add(v)));
    return [...set];
  }, [tempWh]);

  const submitTemp = () => {
    const name = tempForm.name.trim();
    if (!tempForm.vendor) { setError('請選擇廠商'); return; }
    if (!tempForm.group)  { setError('請選擇班別'); return; }
    if (!name)            { setError('請輸入姓名'); return; }
    setError('');
    // 臨時人力無帳號，以本機產生的識別碼對應當日 extras 中的那一筆
    const key = 'sms_temp_id';
    let id = localStorage.getItem(key);
    if (!id || !/^temp_[A-Za-z0-9_-]{6,60}$/.test(id)) {
      id = 'temp_' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
      localStorage.setItem(key, id);
    }
    onLogin({
      id, role: ROLES.TEMP, name,
      vendor: tempForm.vendor, group: tempForm.group, warehouse: TEMP_WAREHOUSE,
      permissions: {}, vendors: [], allowedWarehouses: [],
    });
  };

  // 登入失敗鎖定：以 sessionStorage 記錄各帳號失敗次數
  const getLockData  = (u) => { try { return JSON.parse(localStorage.getItem('_sms_lock_' + u) || '{"count":0,"until":0}'); } catch { return {count:0,until:0}; } };
  const setLockData  = (u, d) => localStorage.setItem('_sms_lock_' + u, JSON.stringify(d));
  const clearLock    = (u) => localStorage.removeItem('_sms_lock_' + u);
  const recordFail   = (u) => {
    const d = getLockData(u);
    const newCount = d.count + 1;
    const until = newCount >= 5 ? Date.now() + 15 * 60 * 1000 : 0;
    setLockData(u, { count: newCount, until });
    return { count: newCount, locked: newCount >= 5 };
  };

  const submitAccessRequest = async () => {
    if (!accessForm?.name.trim()) { setError('請填寫姓名'); return; }
    setAccessBusy(true);
    setError('');
    try {
      const r = await fetch('/api/auth/access-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          USER_ID: username.trim(), PSW: password,
          name: accessForm.name, warehouse: accessForm.warehouse, note: accessForm.note,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        setAccessForm(null);
        setAccessNotice('您的權限申請已送出，請等候管理員核准。');
      } else {
        setError(d.error ?? '申請送出失敗，請稍後再試');
      }
    } catch {
      setError('伺服器連線失敗，請稍後再試');
    } finally {
      setAccessBusy(false);
    }
  };

  const handleSubmit = async e => {
    e.preventDefault();
    setError('');


    const uKey = username.trim().toLowerCase();

    // 鎖定檢查
    const lockData = getLockData(uKey);
    if (lockData.until > Date.now()) {
      setLockUntil(lockData.until);
            return;
    }

    // 委外人員：首次用員編登入，之後用自訂密碼
    if (identity === 'worker') {
      // 先嘗試從伺服器取最新員工清單（跨裝置支援），失敗則 fallback 到本地
      let empList = employees ?? [];
      try {
        const res = await fetch('/api/workers');
        if (res.ok) {
          const serverList = await res.json();
          if (Array.isArray(serverList) && serverList.length > 0) empList = serverList;
        }
      } catch (_) { /* 離線或網路異常，使用本地清單 */ }
      const emp = empList.find(em => em.empId?.trim() === username.trim());
      if (!emp) {
        const r = recordFail(uKey);
        setError(r.locked ? '登入失敗次數過多，帳號已鎖定 15 分鐘' : `員工編號不存在（已失敗 ${r.count}/5 次）`);
                return;
      }
      // 一律先向伺服器驗證：workerPwds 只存在 app_state，委外人員的裝置永遠讀不到，
      // 若先用本機判斷，會把每次登入都當成首次登入（重複要求設定新密碼），
      // 且任何人只要知道員編就能從新裝置登入。本機驗證僅在連不上伺服器時作為備援。
      let serverDown = false;
      try {
        const wr = await fetch('/api/auth/worker-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ empId: emp.empId, password }),
        });
        if (wr.ok) {
          const wd = await wr.json();
          clearLock(uKey);
          onLogin({
            id: 'worker_' + wd.emp.id,
            username: wd.emp.empId,
            password,
            name: wd.emp.name,
            role: ROLES.WORKER,
            vendors: wd.emp.vendor ? [wd.emp.vendor] : [],
            empId: wd.emp.empId,
            employeeId: wd.emp.id,
            approved: true,
            mustChangePassword: wd.firstLogin,
          }, wd.token);
          return;
        }
        if (wr.status === 429) { setError('登入嘗試次數過多，請 15 分鐘後再試'); return; }
        if (wr.status === 401) {
          const r = recordFail(uKey);
          setError(r.locked ? '登入失敗次數過多，帳號已鎖定 15 分鐘' : `員工編號或密碼錯誤（已失敗 ${r.count}/5 次）`);
          return;
        }
        serverDown = true;   // 5xx 等：視同連不上，走本機備援
      } catch (_) { serverDown = true; }

      if (!serverDown) {
        setError('登入失敗，請稍後再試');
        return;
      }
      // ── 以下為連不上伺服器時的本機備援 ──
      // 委外人員一律「帳號＝密碼＝員工編號」，不再有自訂密碼
      const pwdOk = String(password).trim() === String(emp.empId ?? '').trim();
      if (!pwdOk) {
        const r = recordFail(uKey);
        setError(r.locked ? '登入失敗次數過多，帳號已鎖定 15 分鐘' : `密碼錯誤（已失敗 ${r.count}/5 次）`);
                return;
      }
      clearLock(uKey);
      // 備援模式下伺服器連不上，取不到 JWT，僅供離線查看
      const workerToken = undefined;
      onLogin({
        id: 'worker_' + emp.id,
        username: emp.empId,
        password: emp.empId,
        name: emp.name,
        role: ROLES.WORKER,
        vendors: emp.vendor ? [emp.vendor] : [],
        empId: emp.empId,
        employeeId: emp.id,
        approved: true,
        mustChangePassword: false,
      }, workerToken);
      return;
    }

    if (identity === 'riyi') {
      // 日翊：透過後端 API 驗證（AD 優先，本地帳號備用）
      try {
        const r = await fetch('/api/auth/login', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ USER_ID: username.trim(), PSW: password }),
        });
        const data = await r.json().catch(() => ({}));
        if (r.ok && data.token) {
          clearLock(uKey);
          const apiRole = data.user.role === 'admin' ? ROLES.ADMIN
                        : data.user.role === 'vendor' ? ROLES.VENDOR
                        : ROLES.AREA;
          const apiVendors = apiRole === ROLES.VENDOR
            ? (data.user.vendors ?? [])
            : vendors.map(v => v.name);
          onLogin({
            id: `api_${data.user.id}`, username: data.user.username, name: data.user.username,
            role: apiRole, vendors: apiVendors,
            permissions: buildPermsFromPagePerms(apiRole, data.user.page_perms, data.user.allowedWarehouses),
            allowedWarehouses: data.user.allowedWarehouses || [],
            approved: true, _apiAuth: true,
          }, data.token);
          return;
        }
        if (r.status === 403) {
          // 尚未開通權限：AD 驗證已通過、申請已受理，以提示樣式呈現而非錯誤
          if (data.code === 'need_access_request') {
            setError('');
            setAccessNotice('');
            // AD 不回傳姓名，請申請者補填身分資訊供管理員審核判斷
            setAccessForm({ name: '', warehouse: '', note: '' });
            return;
          }
          setError(data.error ?? '此帳號審核中，請等候管理員核准後再登入。');
          return;
        }
        const rf = recordFail(uKey);
        setError(rf.locked
          ? '登入失敗次數過多，帳號已鎖定 15 分鐘'
          : (data.error ?? `帳號或密碼錯誤（已失敗 ${rf.count}/5 次）`));
                return;
      } catch {
        setError('伺服器連線失敗，請稍後再試');
                return;
      }
    }

    // 廠商幹部：本地帳號驗證；若本地找不到則直接向後端驗證（DB 帳號）
    const candidate = users.find(u => u.username === username && u.role === ROLES.VENDOR);
    if (!candidate) {
      // 嘗試透過後端以明文密碼驗證（帳號僅存在 DB，未同步到本地 state）
      try {
        const dr = await fetch('/api/auth/vendor-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });
        if (dr.ok) {
          const dd = await dr.json();
          clearLock(uKey);
          const apiRole = ROLES.VENDOR;
          onLogin({
            id: `api_${dd.user.id}`, username: dd.user.username,
            name: dd.user.name || dd.user.username,
            role: apiRole, vendors: dd.user.vendors ?? [],
            permissions: getDefaultPermissions(apiRole),
            allowedWarehouses: dd.user.allowedWarehouses || [],
            approved: true, _apiAuth: true, mustChangePassword: !!dd.mustChangePassword,
          }, dd.token);
          return;
        }
      } catch (_) {}
      const r = recordFail(uKey);
      setError(r.locked ? '登入失敗次數過多，帳號已鎖定 15 分鐘' : `帳號或密碼錯誤（已失敗 ${r.count}/5 次）`);
            return;
    }
    const ok = await verifyPwd(password, candidate.password);
    if (!ok) {
      // 本地 hash 驗證失敗（可能密碼存在 DB、或 sync 後 hash 不完整）→ 再嘗試後端
      try {
        const dr = await fetch('/api/auth/vendor-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });
        if (dr.ok) {
          const dd = await dr.json();
          clearLock(uKey);
          onLogin({
            id: `api_${dd.user.id}`, username: dd.user.username,
            name: dd.user.name || dd.user.username,
            role: ROLES.VENDOR, vendors: dd.user.vendors ?? [],
            permissions: getDefaultPermissions(ROLES.VENDOR),
            allowedWarehouses: dd.user.allowedWarehouses || [],
            approved: true, _apiAuth: true, mustChangePassword: !!dd.mustChangePassword,
          }, dd.token);
          return;
        }
      } catch (_) {}
      const r = recordFail(uKey);
      setError(r.locked ? '登入失敗次數過多，帳號已鎖定 15 分鐘' : `帳號或密碼錯誤（已失敗 ${r.count}/5 次）`);
            return;
    }
    if (candidate.approved === false) { setError('此帳號審核中，請等候管理員核准後再登入。'); return; }
    clearLock(uKey);
    // 確保密碼已升級為 pbkdf2
    let finalCandidate = candidate;
    if (!candidate.password.startsWith('pbkdf2:')) {
      const hashed = await hashPwd(password);
      finalCandidate = { ...candidate, password: hashed };
    }
    // 嘗試取得 server-side JWT（讓廠商幹部能直接存取 /api/attendance）
    try {
      const vr = await fetch('/api/auth/vendor-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: finalCandidate.username, passwordHash: finalCandidate.password }),
      });
      if (vr.ok) {
        const vd = await vr.json();
        // 伺服器 vendors 非空時採用，否則保留本地設定（避免 DB 空陣列覆蓋正確的廠商清單）
        const resolvedVendors = (vd.user?.vendors?.length > 0) ? vd.user.vendors : (finalCandidate.vendors ?? []);
        // 是否需要改密碼以伺服器為準：本機 users 的 mustChangePassword 是舊種子資料，
        // 密碼改在資料庫時本機旗標不會被清掉，會導致每次登入都被要求重設。
        onLogin({ ...finalCandidate, name: vd.user?.name || finalCandidate.name, vendors: resolvedVendors,
                  mustChangePassword: !!vd.mustChangePassword }, vd.token);
        return;
      }
    } catch (_) {}
    // API 不可用時 fallback 至本地登入（無 JWT）
    onLogin(finalCandidate);
  };

  const handleRegister = async e => {
    e.preventDefault();
    setRegError('');
    // 頻率限制：每 60 秒只能申請一次
    const lastReg = sessionStorage.getItem('last_reg_ts');
    if (lastReg && Date.now() - Number(lastReg) < 60000) {
      setRegError('操作過於頻繁，請稍候再試。'); return;
    }
    if (!regForm.username || !regForm.password || !regForm.name || !regForm.warehouse || !regForm.vendor) {
      setRegError('所有欄位皆為必填'); return;
    }
    if (regForm.password !== regForm.confirm) {
      setRegError('兩次密碼不一致'); return;
    }
    if (regForm.password.length < 8)         { setRegError('密碼至少需 8 個字元'); return; }
    if (!/[A-Za-z]/.test(regForm.password)) { setRegError('密碼需包含至少一個英文字母'); return; }
    if (!/[0-9]/.test(regForm.password))    { setRegError('密碼需包含至少一個數字'); return; }
    if (users.find(u => u.username === regForm.username)) {
      setRegError('此帳號名稱已被使用，請更換'); return;
    }
    const hashedPwd = await hashPwd(regForm.password);
    sessionStorage.setItem('last_reg_ts', String(Date.now()));
    const newId = crypto.randomUUID();
    const payload = {
      id: newId,
      username: regForm.username,
      password: hashedPwd,
      name: regForm.name,
      role: ROLES.VENDOR,
      vendors: [regForm.vendor],
      allowedWarehouses: regForm.warehouse ? [regForm.warehouse] : [],
      approved: false,
    };
    // 必須寫入伺服器：申請者尚未登入，本機狀態不會被自動存檔，
    // 管理員登入時本機清單會被伺服器資料覆蓋，申請將直接遺失
    try {
      const r = await fetch('/api/auth/vendor-apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: newId,
          username: regForm.username,
          password_hash: hashedPwd,
          name: regForm.name,
          vendors: [regForm.vendor],
          allowed_warehouses: regForm.warehouse ? [regForm.warehouse] : [],
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setRegError(d.error ?? '申請送出失敗，請稍後再試');
        return;
      }
    } catch {
      setRegError('伺服器連線失敗，請稍後再試');
      return;
    }
    onRegister(payload);
    setRegDone(true);
  };

  // ── 申請廠商帳號畫面 ──
  if (identity === 'register') {
    if (regDone) return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAF7F2]">
        <div className="bg-white rounded-xl shadow p-8 w-full max-w-sm text-center">
          <div className="text-5xl mb-4">✅</div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">申請已送出</h2>
          <p className="text-sm text-slate-500 mb-6">請等候管理員審核後即可登入，謝謝。</p>
          <button onClick={() => { setIdentity(''); setRegDone(false); setRegForm({ username:'', password:'', confirm:'', name:'', vendor:'' }); }}
            className="w-full py-2.5 bg-[#1a2f5e] hover:bg-[#1e3870] text-white font-semibold rounded-lg transition-colors">
            返回登入
          </button>
        </div>
      </div>
    );
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAF7F2]">
        <form onSubmit={handleRegister} className="bg-white rounded-xl shadow p-8 w-full max-w-sm">
          <div className="flex items-center gap-3 mb-6">
            <button type="button" onClick={() => setIdentity('')} className="text-slate-400 hover:text-slate-600 text-xl">‹</button>
            <div>
              <h1 className="text-xl font-bold text-slate-800">📝 申請廠商帳號</h1>
              <p className="text-xs text-red-600 font-medium">送出後等候管理員審核</p>
            </div>
          </div>
          {regError && <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{regError}</div>}
          {[
            { label: '帳號', key: 'username', type: 'text', placeholder: '請設定登入帳號' },
            { label: '密碼', key: 'password', type: 'password', placeholder: '請設定密碼' },
            { label: '確認密碼', key: 'confirm', type: 'password', placeholder: '再次輸入密碼' },
            { label: '姓名 / 負責人', key: 'name', type: 'text', placeholder: '請輸入姓名' },
          ].map(f => (
            <div key={f.key} className="mb-3">
              <label className="block text-sm font-medium text-slate-700 mb-1">{f.label}</label>
              <input type={f.type} value={regForm[f.key]} placeholder={f.placeholder}
                onChange={e => setRegForm(p => ({ ...p, [f.key]: e.target.value }))}
                className="w-full px-3 py-2 border border-[#DDD9D0] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
            </div>
          ))}
          <div className="mb-3">
            <label className="block text-sm font-medium text-slate-700 mb-1">所屬倉別</label>
            <select value={regForm.warehouse}
              onChange={e => setRegForm(p => ({ ...p, warehouse: e.target.value, vendor: '' }))}
              className="w-full px-3 py-2 border border-[#DDD9D0] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
              <option value="">── 請選擇倉別 ──</option>
              {warehouses.filter(w => (w.departments ?? []).some(d => (d.vendors ?? []).length > 0)).map(w => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>
          <div className="mb-5">
            <label className="block text-sm font-medium text-slate-700 mb-1">所屬廠商</label>
            <select value={regForm.vendor} onChange={e => setRegForm(p => ({ ...p, vendor: e.target.value }))}
              disabled={!regForm.warehouse}
              className="w-full px-3 py-2 border border-[#DDD9D0] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-50 disabled:cursor-not-allowed">
              <option value="">{regForm.warehouse ? '── 請選擇廠商 ──' : '── 請先選擇倉別 ──'}</option>
              {regForm.warehouse && [
                ...new Set(
                  (warehouses.find(w => w.id === regForm.warehouse)?.departments ?? [])
                    .flatMap(d => d.vendors ?? [])
                )
              ].map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <button type="submit" className="w-full py-2.5 bg-[#1a2f5e] hover:bg-[#1e3870] text-white font-semibold rounded-lg transition-colors">
            送出申請
          </button>
          <button type="button" onClick={() => setIdentity('')} className="w-full mt-3 py-2 text-sm text-slate-500 hover:text-slate-700">
            ← 返回入口選擇
          </button>
        </form>
      </div>
    );
  }

  // ── 主登入畫面（下拉身份選擇） ──
  const info = identity ? IDENTITY_INFO[identity] : null;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4">

      {/* Logo + 標題 */}
      <div className="text-center mb-7">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-xl shadow-md mb-4">
          <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-9 h-9">
            <path d="M20 6L34 13.5V18L20 25.5L6 18V13.5L20 6Z" fill="#3B82F6" opacity="0.25"/>
            <path d="M20 12L34 19.5V24L20 31.5L6 24V19.5L20 12Z" fill="#3B82F6" opacity="0.5"/>
            <path d="M20 18L34 25.5V30L20 37.5L6 30V25.5L20 18Z" fill="#3B82F6"/>
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-slate-800">委外人力排班作業平台</h1>
        <p className="text-sm text-slate-500 mt-1">歡迎回來，請選擇身分後登入</p>
      </div>

      {/* 卡片 */}
      <div className="bg-white rounded-xl shadow-sm w-full max-w-sm p-6">

        <form onSubmit={handleSubmit}>

          {/* 身份下拉 */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-700 mb-1.5">登入身份</label>
            <div className="relative">
              <select
                value={identity}
                onChange={e => switchIdentity(e.target.value)}
                className="w-full appearance-none px-4 py-2.5 bg-white border border-[#DDD9D0] rounded-xl text-sm
                           focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition
                           text-slate-700 cursor-pointer">
                <option value="">請選擇登入身份</option>
                {IDENTITY_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
          </div>

          {/* 說明橫幅 */}
          {info && (
            <div className={`flex items-center gap-2 border text-xs rounded-lg px-3 py-2 mb-4 ${info.color}`}>
              <svg className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 1.5a8.5 8.5 0 100 17 8.5 8.5 0 000-17zM8.5 7a1.5 1.5 0 113 0v.5a1.5 1.5 0 01-3 0V7zm1.5 3a1 1 0 100 2 1 1 0 000-2z" clipRule="evenodd"/>
              </svg>
              <span>{info.text}</span>
            </div>
          )}

          {error && (
            <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
              {error}
            </div>
          )}
          {accessNotice && (
            <div className="mb-4 px-3 py-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg text-sm">
              <div className="font-semibold mb-1">⏳ 權限申請已送出</div>
              <p>{accessNotice}</p>
              <p className="text-xs text-amber-700 mt-1.5">
                核准後即可直接以此 AD 帳號登入，無需重新申請。
              </p>
            </div>
          )}
          {accessForm && (
            <div className="mb-4 px-3 py-3 bg-amber-50 border border-amber-200 rounded-lg text-sm">
              <div className="font-semibold text-amber-800 mb-1">🔐 此帳號尚未開通權限</div>
              <p className="text-xs text-amber-700 mb-3">
                AD 驗證已通過。請填寫以下資訊送出申請，管理員核准後即可使用。
              </p>
              <div className="space-y-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">姓名 <span className="text-red-500">*</span></label>
                  <input value={accessForm.name} autoFocus
                    onChange={e => setAccessForm(p => ({ ...p, name: e.target.value }))}
                    placeholder="請輸入您的姓名"
                    className="w-full px-3 py-2 bg-white border border-[#DDD9D0] rounded-lg text-sm
                               focus:outline-none focus:ring-2 focus:ring-amber-400" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">所屬單位</label>
                  <select value={accessForm.warehouse}
                    onChange={e => setAccessForm(p => ({ ...p, warehouse: e.target.value }))}
                    className="w-full px-3 py-2 bg-white border border-[#DDD9D0] rounded-lg text-sm
                               focus:outline-none focus:ring-2 focus:ring-amber-400">
                    <option value="">請選擇</option>
                    {warehouses.map(w => <option key={w.id} value={w.name}>{w.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">備註（選填）</label>
                  <input value={accessForm.note}
                    onChange={e => setAccessForm(p => ({ ...p, note: e.target.value }))}
                    placeholder="例如：課別、職務"
                    className="w-full px-3 py-2 bg-white border border-[#DDD9D0] rounded-lg text-sm
                               focus:outline-none focus:ring-2 focus:ring-amber-400" />
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button type="button" onClick={submitAccessRequest} disabled={accessBusy}
                  className="flex-1 py-2 bg-amber-600 text-white rounded-lg text-sm font-semibold
                             hover:bg-amber-700 disabled:opacity-50">
                  {accessBusy ? '送出中…' : '送出權限申請'}
                </button>
                <button type="button" onClick={() => setAccessForm(null)} disabled={accessBusy}
                  className="px-4 py-2 border border-[#DDD9D0] rounded-lg text-sm hover:bg-[#F5F2EC]">
                  取消
                </button>
              </div>
            </div>
          )}

          {/* 畫面 1：臨時人力填表（選廠商／班別／姓名） */}
          {identity === 'temp' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">廠商 <span className="text-red-500">*</span></label>
                <select value={tempForm.vendor} onChange={e => setTempForm(p => ({ ...p, vendor: e.target.value }))}
                  className="w-full px-4 py-2.5 bg-white border border-[#DDD9D0] rounded-xl text-sm
                             focus:outline-none focus:ring-2 focus:ring-violet-400">
                  <option value="">請選擇廠商</option>
                  {tempVendorOptions.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
                {tempVendorOptions.length === 0 && (
                  <p className="text-xs text-red-600 mt-1">
                    {TEMP_WAREHOUSE}尚未設定廠商，請聯繫管理員
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">班別 <span className="text-red-500">*</span></label>
                <select value={tempForm.group} onChange={e => setTempForm(p => ({ ...p, group: e.target.value }))}
                  className="w-full px-4 py-2.5 bg-white border border-[#DDD9D0] rounded-xl text-sm
                             focus:outline-none focus:ring-2 focus:ring-violet-400">
                  <option value="">請選擇班別</option>
                  {tempGroupOptions.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">姓名 <span className="text-red-500">*</span></label>
                <input value={tempForm.name} autoFocus
                  onChange={e => setTempForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="請輸入您的姓名"
                  className="w-full px-4 py-2.5 bg-white border border-[#DDD9D0] rounded-xl text-sm
                             focus:outline-none focus:ring-2 focus:ring-violet-400" />
              </div>
              <button type="button" onClick={submitTemp}
                className="w-full py-3 bg-violet-600 hover:bg-violet-700 text-white font-semibold
                           rounded-xl transition-colors text-sm shadow-sm">
                下一步：簽到 / 手機控管
              </button>
            </div>
          )}

          {/* 帳號 / 密碼（選擇身份後才顯示） */}
          {identity && identity !== 'temp' && (
            <>
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-700 mb-1.5">帳號</label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                    <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
                    </svg>
                  </span>
                  <input type="text" value={username} onChange={e => setUsername(e.target.value)}
                    required autoFocus
                    placeholder={identity === 'worker' ? '員工編號' : identity === 'riyi' ? '公司 AD 帳號' : '帳號'}
                    className="w-full pl-9 pr-4 py-2.5 bg-white border border-[#DDD9D0] rounded-xl text-sm
                               focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition" />
                </div>
              </div>

              <div className="mb-5">
                <label className="block text-sm font-medium text-slate-700 mb-1.5">密碼</label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                    <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
                    </svg>
                  </span>
                  <input type={showPwd ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                    required
                    placeholder={identity === 'worker' ? '員工編號' : identity === 'riyi' ? 'AD 密碼' : '密碼'}
                    className="w-full pl-9 pr-10 py-2.5 bg-white border border-[#DDD9D0] rounded-xl text-sm
                               focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition" />
                  <button type="button" onClick={() => setShowPwd(p => !p)}
                    className="absolute inset-y-0 right-3 flex items-center text-slate-400 hover:text-slate-600">
                    {showPwd
                      ? <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 4.411m0 0L21 21"/></svg>
                      : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                    }
                  </button>
                </div>
              </div>

              <button type="submit"
                disabled={lockUntil > Date.now()}
                className="w-full py-3 bg-[#1a2f5e] hover:bg-[#1e3870] disabled:bg-slate-400 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors text-sm shadow-sm">
                {lockUntil > Date.now() ? '帳號鎖定中...' : '登入系統'}
              </button>
            </>
          )}

          {/* 廠商幹部：申請帳號連結 */}
          {identity === 'vendor_mgr' && (
            <div className="mt-4 pt-4 border-t border-slate-100 text-center">
              <span className="text-sm text-slate-400">還沒有帳號？</span>
              <button type="button"
                onClick={() => { setRegForm({ username:'', password:'', confirm:'', name:'', vendor:'' }); setIdentity('register'); }}
                className="ml-1 text-sm text-teal-700 hover:text-blue-700 font-medium">
                申請廠商幹部帳號
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// NAVIGATION
// ─────────────────────────────────────────────

// 解析登入者對應的人員清冊資料：
// 委外人員以 employeeId 對應；委外幹部若由委外人員升級而來，帳號即為員工編號，
// 但經後端 API 登入時不會帶回 employeeId，故再以帳號比對員工編號。
function resolveSelfEmployee(user, employees) {
  if (!user || !Array.isArray(employees)) return null;
  const byId = user.employeeId
    ? employees.find(e => e.id === user.employeeId)
    : null;
  if (byId) return byId;
  const uname = String(user.username ?? '').trim();
  if (!uname) return null;
  return employees.find(e => String(e.empId ?? '').trim() === uname) ?? null;
}

// 系統鎖定三段式：none 全部可異動｜partial 廠商幹部與委外人員不可異動｜full 全部不可異動
// 相容舊資料：布林 true → full、false/未設定 → none
const LOCK_MODES = [
  { key: 'none',    label: '解除鎖定', desc: '全部可異動',                 icon: '🔓' },
  { key: 'partial', label: '部分鎖定', desc: '廠商幹部、委外人員不可異動', icon: '🔐' },
  { key: 'full',    label: '全部鎖定', desc: '全部不可異動',               icon: '🔒' },
];
function normalizeLockMode(v) {
  if (v === true) return 'full';
  if (v === false || v == null) return 'none';
  return LOCK_MODES.some(m => m.key === v) ? v : 'none';
}
// 依鎖定模式判斷該角色能否編輯班表
function lockAllowsEdit(lockValue, role) {
  const mode = normalizeLockMode(lockValue);
  if (mode === 'full') return false;
  if (mode === 'partial') return role !== ROLES.VENDOR && role !== ROLES.WORKER;
  return true;
}

const NAV_ITEMS = [
  { key: 'dashboard',    label: '儀表板',       icon: '📊', roles: [ROLES.ADMIN, ROLES.AREA, ROLES.VENDOR] },
  { key: 'schedule',     label: '班表管理',     icon: '📅', roles: [ROLES.ADMIN, ROLES.AREA, ROLES.VENDOR, ROLES.WORKER] },
  { key: 'attendance',   label: '點名表',       icon: '📋', roles: [ROLES.ADMIN, ROLES.AREA, ROLES.VENDOR] },
  { key: 'phoneControl', label: '手機控管',     icon: '📱', roles: [ROLES.ADMIN, ROLES.AREA, ROLES.VENDOR] },
  { key: 'selfCheck',    label: '簽到/手機',    icon: '📱', roles: [ROLES.WORKER, ROLES.VENDOR], needsSelfEmp: true },
  { key: 'employees',    label: '人員清冊',     icon: '👥', roles: [ROLES.ADMIN, ROLES.AREA, ROLES.VENDOR] },
  { key: 'shiftsetup',   label: '人員班別設定', icon: '⏰', roles: [ROLES.ADMIN, ROLES.AREA] },
  // 廠商幹部可否看到由權限決定（預設關閉）；roles 未列入時權限勾選會失效
  { key: 'reports',      label: '報表匯出',     icon: '📋', roles: [ROLES.ADMIN, ROLES.AREA, ROLES.VENDOR] },
  { key: 'shiftcodes',   label: '班別代號表',   icon: '📖', roles: [ROLES.ADMIN, ROLES.AREA, ROLES.VENDOR] },
  // 日翊可獲授權進入，但頁內僅開放「各課別鎖定與開放區間」；
  // 倉別／課別／廠商維護等破壞性與全域設定仍限管理員
  { key: 'settings',     label: '系統設定',     icon: '⚙️', roles: [ROLES.ADMIN, ROLES.AREA] },
  { key: 'accounts',     label: '帳號與權限',   icon: '🔑', roles: [ROLES.ADMIN] },
];

function SaveButton({ onSave, collapsed, mobile = false }) {
  const [status, setStatus] = useState('idle'); // idle | saving | ok | err
  const timerRef = useRef(null);
  const handle = () => {
    if (status === 'saving') return;
    setStatus('saving');
    onSave((ok) => {
      setStatus(ok ? 'ok' : 'err');
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setStatus('idle'), 2000);
    });
  };
  const label = status === 'saving' ? '存檔中…' : status === 'ok' ? '已存檔 ✓' : status === 'err' ? '存檔失敗' : '存檔';
  const color = status === 'ok' ? 'text-emerald-300' : status === 'err' ? 'text-red-400' : 'text-slate-400 hover:text-emerald-300';
  if (mobile) {
    return (
      <button onClick={handle} className={`flex items-center gap-2 transition-colors ${color}`}>
        <span>💾</span><span>{label}</span>
      </button>
    );
  }
  return (
    <button onClick={handle}
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors mb-1 ${color}`}>
      <span>💾</span>
      {!collapsed && label}
    </button>
  );
}

// 日翊員工帳號可由管理員逐一設定「可看哪些分頁」，設定值存於 DB 的 page_perms。
// 空陣列＝未設定，沿用角色預設，避免既有帳號在此功能上線後突然失去所有分頁。
// 日翊員工帳號的預設分頁權限：預設全選，
// 但「手機控管」為大肚倉專屬作業，非大肚倉的員工預設不勾選。
// 未指派倉別者視同不限制（一併給予）。
const DADU_WH_ID = 'wh2';
function defaultStaffPageKeys(allowedWarehouses) {
  const wh = Array.isArray(allowedWarehouses) ? allowedWarehouses : [];
  const canDadu = wh.length === 0 || wh.includes(DADU_WH_ID);
  return NAV_ITEMS
    .filter(n => n.roles.includes(ROLES.AREA))
    .filter(n => canDadu || n.key !== 'phoneControl')
    .map(n => n.key);
}

function buildPermsFromPagePerms(role, pagePerms, allowedWarehouses) {
  const base = getDefaultPermissions(role);
  if (role === ROLES.ADMIN) return base; // 管理員永遠全開
  // 未設定（空陣列）＝採用預設值，而非關閉全部。
  // 預設值須依角色決定：廠商幹部若套用日翊的預設分頁，會看到不該看的頁面。
  const roleDefaultKeys = role === ROLES.AREA
    ? defaultStaffPageKeys(allowedWarehouses)
    : NAV_ITEMS.filter(n => n.roles.includes(role) && base[n.key]?.view).map(n => n.key);
  const effective = (Array.isArray(pagePerms) && pagePerms.length > 0)
    ? pagePerms
    : roleDefaultKeys;
  const allowed = new Set(effective);
  const perms = { ...base };
  NAV_ITEMS.forEach(n => {
    if (!n.roles.includes(role)) return;
    const on = allowed.has(n.key);
    perms[n.key] = { ...(base[n.key] ?? {}), view: on };
    if (!on) {
      PAGE_PERMISSIONS.find(pp => pp.key === n.key)
        ?.features.forEach(f => { perms[n.key][f.key] = false; });
    }
  });
  return perms;
}

// 可供日翊員工帳號設定的分頁（即 area 角色在選單中看得到的項目）
const STAFF_PAGE_OPTIONS = () => NAV_ITEMS.filter(n => n.roles.includes(ROLES.AREA));

function Sidebar({ currentPage, onNavigate, currentUser, onLogout, onSave, collapsed, onToggle }) {
  const { employees: navEmployees } = useApp();
  const userPerms = currentUser.permissions ?? getDefaultPermissions(currentUser.role);
  const items = NAV_ITEMS.filter(n =>
    n.roles.includes(currentUser.role) &&
    (currentUser.role === ROLES.ADMIN || userPerms[n.key]?.view !== false) &&
    // 簽到/手機控管僅在登入者本身也是清冊內人員時才顯示
    (!n.needsSelfEmp || !!resolveSelfEmployee(currentUser, navEmployees))
  );

  return (
    <aside className={`flex flex-col text-white transition-all duration-300
                       ${collapsed ? 'w-14' : 'w-44'} shrink-0 h-screen sticky top-0`}
           style={{background:'var(--sms-sidebar)'}}>
      {/* 標題列：標題／副標＋收合鈕 */}
      <div className="flex items-center gap-1.5 px-2.5 pt-3 pb-2.5">
        {!collapsed && (
          <div className="min-w-0">
            <div className="font-bold text-sm leading-tight truncate">班表管理系統</div>
            <div className="text-[10px] text-white/50 truncate">委外人力排班</div>
          </div>
        )}
        <button onClick={onToggle} title={collapsed ? '展開選單' : '收合選單'}
          className="ml-auto shrink-0 w-6 h-6 rounded-full bg-white/10 hover:bg-white/20
                     flex items-center justify-center text-xs transition-colors">
          {collapsed ? '»' : '«'}
        </button>
      </div>

      {/* 選單：選中為白色膠囊、其餘 hover 時淡色膠囊 */}
      <nav className="flex-1 px-2 pb-2 overflow-y-auto space-y-0.5">
        {items.map(item => {
          const active = currentPage === item.key;
          return (
            <button key={item.key}
              onClick={() => onNavigate(item.key)}
              title={collapsed ? item.label : undefined}
              className={`w-full flex items-center gap-2 rounded-full transition-colors
                          ${collapsed ? 'justify-center px-0 py-2' : 'px-3 py-2'}
                          ${active
                            ? 'bg-white font-bold shadow-sm'
                            : 'text-white/80 hover:bg-white/10 hover:text-white'}`}
              style={active ? { color: 'var(--sms-sidebar)' } : undefined}>
              <span className="text-base leading-none shrink-0">{item.icon}</span>
              {!collapsed && <span className="truncate text-[13px]">{item.label}</span>}
            </button>
          );
        })}
      </nav>

      {/* 使用者資訊與登出 */}
      <div className="px-2 pb-2.5 pt-2 border-t border-white/10">
        {!collapsed && (
          <div className="px-2 mb-1.5 text-[11px] truncate">
            <div className="font-semibold text-white/90 truncate">{currentUser.name}</div>
            <div className="text-white/45">
              {currentUser.role === ROLES.ADMIN ? '管理員' : currentUser.role === ROLES.AREA ? '日翊' : currentUser.role === ROLES.WORKER ? '委外人員' : '委外幹部'}
            </div>
          </div>
        )}
        {onSave && <SaveButton onSave={onSave} collapsed={collapsed} />}
        <button onClick={onLogout} title={collapsed ? '登出' : undefined}
          className={`w-full flex items-center gap-2 rounded-full py-2 text-[13px] text-white/70
                      hover:bg-white/10 hover:text-red-300 transition-colors
                      ${collapsed ? 'justify-center px-0' : 'px-3'}`}>
          <span className="text-sm leading-none">🚪</span>
          {!collapsed && '登出'}
        </button>
      </div>
    </aside>
  );
}

// ─────────────────────────────────────────────
// WAREHOUSE / DEPT SELECTOR BAR
// ─────────────────────────────────────────────

/** 開啟資料健檢面板（右側滑出）。以事件傳遞，讓設定頁與篩選列都能叫出同一個面板 */
const openHealthDrawer = () => window.dispatchEvent(new CustomEvent('vsp-open-health'));

/** 資料健檢與合併：右側滑出面板，先檢查、確認後才合併 */
function HealthDrawer() {
  const { toast } = useToast();
  const { currentUser } = useApp();
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState(() => new Set());   // 勾選要合併的員編
  const [pickedOrphans, setPickedOrphans] = useState(() => new Set());   // 勾選要歸戶的孤兒資料列
  const isAdmin = currentUser?.role === ROLES.ADMIN;

  const [err, setErr] = useState('');

  // 任何非預期的回應都要明確報錯。伺服器若尚未更新，這些網址會被當成一般網頁
  // 請求而回傳首頁（HTTP 200 但內容是 HTML），若不處理就會卡在「處理中…」。
  const call = async (path, method = 'GET', body) => {
    const token = localStorage.getItem(JWT_KEY);
    if (!token) { setErr('尚未登入或登入已逾時，請重新登入'); return null; }
    try {
      const r = await fetch(path, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const ct = r.headers.get('content-type') ?? '';
      if (!ct.includes('application/json')) {
        setErr('伺服器尚未提供此功能（系統可能還沒更新到最新版本），請通知系統管理員。');
        return null;
      }
      const d = await r.json().catch(() => null);
      if (!r.ok || !d) { setErr(d?.error || `執行失敗（HTTP ${r.status}）`); return null; }
      return d;
    } catch (e) {
      setErr('連線失敗，請檢查網路後再試：' + e.message);
      return null;
    }
  };

  const check = useCallback(async () => {
    setBusy(true);
    setErr('');
    try {
      const d = await call('/api/maintenance/health');
      if (d?.report) { setReport(d.report); setPicked(new Set()); setPickedOrphans(new Set()); }
    } finally {
      setBusy(false);   // 無論成功或失敗都要解除忙碌狀態
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    const h = () => { setOpen(true); check(); };
    window.addEventListener('vsp-open-health', h);
    return () => window.removeEventListener('vsp-open-health', h);
  }, [isAdmin, check]);

  useEffect(() => {
    if (!open) return;
    const esc = e => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open]);

  const chosen = (report?.duplicates ?? []).filter(d => picked.has(d.key));

  const merge = async () => {
    if (chosen.length === 0) return;
    const dropCount = chosen.reduce((a, d) => a + d.drops.length, 0);
    const restore   = chosen.reduce((a, d) => a + d.restoreCount, 0);
    const names     = chosen.map(d => `${d.empNo} ${d.name ?? ''}`.trim()).join('、');
    if (!window.confirm(
      '將合併以下 ' + chosen.length + ' 位人員的重複記錄：\n' + names + '\n\n' +
      '． 救回 ' + restore + ' 格被洗掉的休／例／國\n' +
      '． 移除 ' + dropCount + ' 筆重複的清冊記錄\n\n' +
      '執行前會自動備份，且不會覆蓋現有的排班。確定執行？')) return;
    setBusy(true);
    setErr('');
    let d = null;
    try {
      d = await call('/api/maintenance/merge-duplicates', 'POST',
        { keys: chosen.map(x => x.key) });
    } finally { setBusy(false); }
    if (d?.ok) {
      toast(`合併完成：救回 ${d.merged} 格、移除 ${d.removed} 筆重複記錄`, 'success');
      check();
    }
  };

  const orphanList = (report?.orphans ?? []).filter(o => o.matched && o.restore > 0);
  const chosenOrphans = orphanList.filter(o => pickedOrphans.has(o.id));

  const adopt = async () => {
    if (chosenOrphans.length === 0) return;
    const restore = chosenOrphans.reduce((a, o) => a + o.restore, 0);
    const names = chosenOrphans.map(o => `${o.empNo} ${o.name ?? ''}`.trim()).join('、');
    if (!window.confirm(
      '將把以下 ' + chosenOrphans.length + ' 列失聯的班表資料歸戶：\n' + names + '\n\n' +
      '． 救回 ' + restore + ' 格被洗掉的休／例／國\n\n' +
      '執行前會自動備份，且不會覆蓋現有的排班。確定執行？')) return;
    setBusy(true);
    setErr('');
    let d = null;
    try {
      d = await call('/api/maintenance/adopt-orphans', 'POST',
        { ids: chosenOrphans.map(o => o.id) });
    } finally { setBusy(false); }
    if (d?.ok) {
      toast(`歸戶完成：救回 ${d.merged} 格、清除 ${d.removed} 列失聯資料`, 'success');
      check();
    }
  };

  if (!isAdmin || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end"
         onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="absolute inset-0 bg-black/30" />
      <aside className="relative bg-white h-full w-full max-w-[640px] shadow-2xl flex flex-col border-l border-[#DDD9D0]">
        <header className="flex items-center justify-between px-5 py-3 border-b border-[#DDD9D0] shrink-0">
          <div>
            <h3 className="font-bold text-slate-800">🩺 資料健檢與合併</h3>
            <p className="text-xs text-slate-500 mt-0.5">找出重複的人員記錄，把舊記錄底下的排休救回現用記錄</p>
          </div>
          <button onClick={() => setOpen(false)}
            className="text-slate-400 hover:text-slate-600 text-xl leading-none px-2">✕</button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 text-sm">
          <p className="text-xs text-slate-500 mb-4 leading-relaxed">
            早期清冊匯入以未正規化的員編比對，同一個人可能被當成新人重建，舊記錄底下的休／例／國
            會留在資料庫但畫面上看不到。健檢<strong>只讀取不異動</strong>；合併只在現用記錄該格是
            「V 或空白」時才寫入舊值，<strong>不會覆蓋現有排班</strong>，且執行前自動備份。
            <br /><strong className="text-amber-700">請逐筆確認後再勾選</strong>：若某格的休假是<strong>後來主動取消</strong>的，
            資料上與「被系統洗掉」無法分辨，合併會把它還原回去。姓名不一致者會標紅，那可能根本不是同一個人。
          </p>

          <div className="flex flex-wrap items-center gap-2 mb-4">
            <button onClick={check} disabled={busy}
              className="px-3 py-1.5 border border-[#DDD9D0] rounded-lg text-sm text-slate-600 hover:bg-[#F5F2EC] disabled:opacity-40">
              {busy ? '處理中…' : '重新健檢'}
            </button>
            {report && report.duplicates.length > 0 && (
              <>
                <button onClick={merge} disabled={busy || chosen.length === 0}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-40">
                  合併勾選的 {chosen.length} 位
                </button>
                <button onClick={() => setPicked(new Set(report.duplicates.map(d => d.key)))}
                  className="px-3 py-1.5 border border-[#DDD9D0] rounded-lg text-sm text-slate-600 hover:bg-[#F5F2EC]">
                  全選
                </button>
                {chosen.length > 0 && (
                  <button onClick={() => setPicked(new Set())}
                    className="px-3 py-1.5 border border-[#DDD9D0] rounded-lg text-sm text-slate-500 hover:bg-[#F5F2EC]">
                    清除選取
                  </button>
                )}
              </>
            )}
          </div>

          {err && (
            <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 text-red-700 rounded-lg text-xs leading-relaxed">
              {err}
            </div>
          )}

          {!report && !err && <p className="text-slate-400 text-xs">健檢中…</p>}

          {report && (
            <div className="text-xs text-slate-600 space-y-4">
              <div className="grid grid-cols-2 gap-2">
                {[
                  ['清冊人數', report.employees, ''],
                  ['班表資料列', report.scheduleRows, ''],
                  ['重複人員', report.duplicates.length, report.duplicates.length ? 'text-red-600' : 'text-teal-700'],
                  ['可救回格數', report.totalRestore, report.totalRestore ? 'text-red-600' : 'text-teal-700'],
                  ['失聯資料列', report.orphans.length, report.orphans.length ? 'text-amber-600' : 'text-teal-700'],
                  ['失聯可救回格數', report.orphanRestore ?? 0, report.orphanRestore ? 'text-red-600' : 'text-teal-700'],
                ].map(([t, v, c]) => (
                  <div key={t} className="border border-[#DDD9D0] rounded-lg px-3 py-2">
                    <div className="text-[11px] text-slate-400">{t}</div>
                    <div className={`text-lg font-bold ${c || 'text-slate-700'}`}>{v}</div>
                  </div>
                ))}
              </div>

              {report.duplicates.length === 0 && report.orphans.length === 0 && (
                <p className="text-teal-700">✅ 未發現重複或孤兒資料。</p>
              )}

              {report.duplicates.length > 0 && (
                <div>
                  <h4 className="font-bold text-slate-700 mb-1">重複的人員記錄</h4>
                  <p className="text-[11px] text-slate-500 leading-relaxed mb-2">
                    「可救回」為 <b>0</b> 的，代表只是清冊裡有兩筆記錄、沒有任何排班資料需要救回；
                    合併它們只是清理重複，不會改變任何班表。<strong>優先處理可救回大於 0 的。</strong>
                  </p>
                  <div className="border border-[#DDD9D0] rounded-lg overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-[#F5F2EC] text-slate-500">
                      <tr>
                        <th className="px-2 py-1.5 w-8"></th>
                        <th className="px-2 py-1.5 text-left">員工編號</th>
                        <th className="px-2 py-1.5 text-left">姓名</th>
                        <th className="px-2 py-1.5 text-right">重複</th>
                        <th className="px-2 py-1.5 text-right">可救回</th>
                        <th className="px-2 py-1.5 text-left">範例（日期：舊值）</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.duplicates.map(d => {
                        // 同一組員編底下姓名不一致，極可能是員編打錯或號碼重複配發，
                        // 合併會把兩個不同的人混在一起，故特別標示出來。
                        const nameMismatch = d.drops.some(x => (x.name ?? '') !== (d.name ?? ''));
                        return (
                        <tr key={d.key} className={`border-t border-[#EFEBE3] align-top ${picked.has(d.key) ? 'bg-blue-50/60' : ''}`}>
                          <td className="px-2 py-1.5">
                            <input type="checkbox" checked={picked.has(d.key)}
                              onChange={e => setPicked(prev => {
                                const n = new Set(prev);
                                if (e.target.checked) n.add(d.key); else n.delete(d.key);
                                return n;
                              })} />
                          </td>
                          <td className="px-2 py-1.5 font-mono whitespace-nowrap">{d.empNo}</td>
                          <td className="px-2 py-1.5 whitespace-nowrap">
                            {d.name}
                            {nameMismatch && (
                              <div className="text-[11px] text-red-600 font-semibold mt-0.5"
                                   title="兩筆記錄的姓名不同，可能不是同一個人">
                                ⚠ 舊記錄為「{d.drops.map(x => x.name).filter(Boolean).join('、')}」
                              </div>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-right">{d.drops.length}</td>
                          <td className="px-2 py-1.5 text-right font-semibold text-red-600">{d.restoreCount}</td>
                          <td className="px-2 py-1.5 text-slate-500">
                            {d.restoreSample.map(x => `${x.dk}:${x.after}`).join('、') || '—'}
                          </td>
                        </tr>
                      );})}
                    </tbody>
                  </table>
                  </div>
                </div>
              )}

              {report.orphans.length > 0 && (
                <div className="pt-2 border-t border-[#EFEBE3]">
                  <h4 className="font-bold text-slate-700 mb-1">失聯的班表資料</h4>
                  <p className="text-[11px] text-slate-500 leading-relaxed mb-2">
                    這些班表在現行清冊中已找不到對應人員（多半是舊記錄被刪除所致）。
                    系統改以<strong>歷史備份的清冊</strong>反查原本屬於誰，再對應到現行清冊中同員編的人。
                    查得到對象且有內容可救回的才會列在下方；<strong>查不到對象的不會顯示，也不會被動到</strong>。
                  </p>

                  {orphanList.length === 0 ? (
                    <p className="text-slate-500">
                      共 {report.orphans.length} 列失聯資料，但都查不到可對應的人員或沒有可救回的內容，工具不會處理。
                    </p>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <button onClick={adopt} disabled={busy || chosenOrphans.length === 0}
                          className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-40">
                          歸戶勾選的 {chosenOrphans.length} 列
                        </button>
                        <button onClick={() => setPickedOrphans(new Set(orphanList.map(o => o.id)))}
                          className="px-3 py-1.5 border border-[#DDD9D0] rounded-lg text-sm text-slate-600 hover:bg-[#F5F2EC]">
                          全選
                        </button>
                        {chosenOrphans.length > 0 && (
                          <button onClick={() => setPickedOrphans(new Set())}
                            className="px-3 py-1.5 border border-[#DDD9D0] rounded-lg text-sm text-slate-500 hover:bg-[#F5F2EC]">
                            清除選取
                          </button>
                        )}
                      </div>

                      <div className="border border-[#DDD9D0] rounded-lg overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-[#F5F2EC] text-slate-500">
                            <tr>
                              <th className="px-2 py-1.5 w-8"></th>
                              <th className="px-2 py-1.5 text-left">員工編號</th>
                              <th className="px-2 py-1.5 text-left">姓名（備份／現行）</th>
                              <th className="px-2 py-1.5 text-right">可救回</th>
                              <th className="px-2 py-1.5 text-left">範例（日期：舊值）</th>
                            </tr>
                          </thead>
                          <tbody>
                            {orphanList.map(o => {
                              const mismatch = (o.name ?? '') !== (o.targetName ?? '');
                              return (
                                <tr key={o.id} className={`border-t border-[#EFEBE3] align-top ${pickedOrphans.has(o.id) ? 'bg-blue-50/60' : ''}`}>
                                  <td className="px-2 py-1.5">
                                    <input type="checkbox" checked={pickedOrphans.has(o.id)}
                                      onChange={e => setPickedOrphans(prev => {
                                        const n = new Set(prev);
                                        if (e.target.checked) n.add(o.id); else n.delete(o.id);
                                        return n;
                                      })} />
                                  </td>
                                  <td className="px-2 py-1.5 font-mono whitespace-nowrap">{o.empNo}</td>
                                  <td className="px-2 py-1.5 whitespace-nowrap">
                                    {o.name}
                                    {mismatch
                                      ? <div className="text-[11px] text-red-600 font-semibold mt-0.5"
                                             title="備份中的姓名與現行清冊不同，可能不是同一個人">
                                          ⚠ 現行為「{o.targetName}」
                                        </div>
                                      : <span className="text-slate-400"> → {o.targetName}</span>}
                                  </td>
                                  <td className="px-2 py-1.5 text-right font-semibold text-red-600">{o.restore}</td>
                                  <td className="px-2 py-1.5 text-slate-500">
                                    {o.restoreSample.map(x => `${x.dk}:${x.after}`).join('、') || '—'}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {report.orphans.length > orphanList.length && (
                        <p className="text-[11px] text-slate-400 mt-2">
                          另有 {report.orphans.length - orphanList.length} 列查不到對應人員或沒有可救回的內容，未列出。
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>,
    document.body
  );
}

/** 每日快照狀態：讓多機使用的主管一眼看到資料已備份到哪個時間點 */
function SnapshotBadge() {
  const { currentUser } = useApp();
  const [info, setInfo] = useState(null);
  const canSee = currentUser?.role === ROLES.ADMIN || currentUser?.role === ROLES.AREA;

  useEffect(() => {
    if (!canSee) return;
    let alive = true;
    const load = () => {
      const token = localStorage.getItem(JWT_KEY);
      if (!token) return;
      fetch('/api/backups/latest', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => (r.ok ? r.json() : null))
        .then(d => { if (alive && d) setInfo(d); })
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 30 * 60 * 1000);   // 半小時更新一次即可
    return () => { alive = false; clearInterval(t); };
  }, [canSee]);

  if (!canSee || !info?.latest) return null;
  const at = new Date(info.latest.created_at);
  const pad = n => String(n).padStart(2, '0');
  const when = `${at.getMonth() + 1}/${at.getDate()} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
  // 超過 36 小時沒有新快照代表排程異常，改以警示色提醒
  const stale = Date.now() - at.getTime() > 36 * 3600 * 1000;
  return (
    <span title={`每日 ${String(info.hour ?? 23).padStart(2, '0')}:00 自動保存當日資料，保留 60 天`}
      className={`hidden md:inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border whitespace-nowrap
        ${stale ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-teal-50 border-teal-200 text-teal-700'}`}>
      {stale ? '🟠' : '🟢'} 資料快照備份 {when}
    </span>
  );
}

function WarehouseDeptBar() {
  const {
    warehouses, employees, currentUser,
    selectedWarehouse, setSelectedWarehouse,
    selectedDept,      setSelectedDept,
    selectedGroup,     setSelectedGroup,
    selectedWorkArea,  setSelectedWorkArea,
    workAreas,         setWorkAreas,
    selectedVendor,    setSelectedVendor,
  } = useApp();

  // 倉別可見範圍：ADMIN/VENDOR 看全部；AREA 只看 allowedWarehouses（空陣列 = 尚未指派，不顯示）
  const isAdmin = currentUser?.role === ROLES.ADMIN;
  const isVendor = currentUser?.role === ROLES.VENDOR;
  const allowedWh = currentUser?.allowedWarehouses ?? [];
  const visibleWarehouses = (isAdmin || isVendor)
    ? warehouses
    : allowedWh.length > 0
      ? warehouses.filter(w => allowedWh.includes(w.id))
      : [];

  const whObj   = visibleWarehouses.find(w => w.id === selectedWarehouse) ?? null;
  const depts   = whObj?.departments ?? [];
  const deptObj = depts.find(d => d.id === selectedDept) ?? null;
  const groups  = deptObj?.groups ?? [];

  const handleWhChange = (whId) => {
    setSelectedWarehouse(whId || null);
    setSelectedDept(null);
    setSelectedGroup(null);
    setSelectedVendor(null);
  };

  const handleDeptChange = (deptId) => {
    setSelectedDept(deptId || null);
    setSelectedGroup(null);
    setSelectedVendor(null);
  };

  const handleGroupChange = (g) => {
    setSelectedGroup(g || null);
  };

  const handleVendorChange = (v) => {
    setSelectedVendor(v || null);
  };

  // 廠商別選項：優先從課別的廠商清單；否則從當前倉別的所有員工推導
  const vendorOptions = (() => {
    if (deptObj?.vendors?.length > 0) return deptObj.vendors;
    if (selectedWarehouse) {
      const wh = warehouses.find(w => w.id === selectedWarehouse);
      if (wh) {
        const whVendors = new Set((wh.departments ?? []).flatMap(d => d.vendors ?? []));
        if (whVendors.size > 0) return [...whVendors].sort();
      }
    }
    const allV = new Set(employees.map(e => e.vendor).filter(Boolean));
    return [...allV].sort();
  })();

  const hasFilter = selectedWarehouse || selectedDept || selectedGroup || selectedVendor || selectedWorkArea;
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);

  const filterLabel = [
    selectedWarehouse ? visibleWarehouses.find(w=>w.id===selectedWarehouse)?.name : null,
    selectedDept ? deptObj?.name : null,
    selectedGroup || null,
    selectedWorkArea === '__none__' ? '未設定作業區' : (selectedWorkArea || null),
    selectedVendor || null,
  ].filter(Boolean).join(' › ') || '全部';

  const selects = (
    <div className="flex items-center gap-2 flex-wrap text-sm">
      <span className="text-slate-500 font-medium whitespace-nowrap">🏭 倉別：</span>
      <select value={selectedWarehouse ?? ''} onChange={e => handleWhChange(e.target.value)}
        className="border border-[#DDD9D0] rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
        <option value="">全部倉別</option>
        {visibleWarehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
      </select>
      <span className="text-slate-400">›</span>
      <span className="text-slate-500 font-medium whitespace-nowrap">課別：</span>
      <select value={selectedDept ?? ''} onChange={e => handleDeptChange(e.target.value)}
        disabled={!selectedWarehouse}
        className="border border-[#DDD9D0] rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-40">
        <option value="">全部課別</option>
        {depts.map(d => <option key={d.id} value={d.id}>{d.code ? `${d.code} ${d.name}` : d.name}</option>)}
      </select>
      <span className="text-slate-400">›</span>
      <span className="text-slate-500 font-medium whitespace-nowrap">組別：</span>
      <select value={selectedGroup ?? ''} onChange={e => handleGroupChange(e.target.value)}
        disabled={!selectedDept || groups.length === 0}
        className="border border-[#DDD9D0] rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-40">
        <option value="">全部組別</option>
        {groups.map(g => <option key={g} value={g}>{g}</option>)}
      </select>
      <span className="text-slate-400">›</span>
      <span className="text-slate-500 font-medium whitespace-nowrap">作業區：</span>
      <select value={selectedWorkArea ?? ''} onChange={e => setSelectedWorkArea(e.target.value || null)}
        className="border border-[#DDD9D0] rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
        <option value="">全部作業區</option>
        {workAreas.map(a => <option key={a} value={a}>{a}</option>)}
        <option value="__none__">未設定</option>
      </select>
      <span className="text-slate-400">›</span>
      <span className="text-slate-500 font-medium whitespace-nowrap">廠商：</span>
      <select value={selectedVendor ?? ''} onChange={e => handleVendorChange(e.target.value)}
        className="border border-[#DDD9D0] rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
        <option value="">全部廠商</option>
        {vendorOptions.map(v => <option key={v} value={v}>{v}</option>)}
      </select>
      {hasFilter && (
        <button onClick={() => { setSelectedWarehouse(null); setSelectedDept(null); setSelectedGroup(null); setSelectedVendor(null); setSelectedWorkArea(null); setMobileFilterOpen(false); }}
          className="px-2 py-0.5 text-xs text-slate-500 border border-[#DDD9D0] rounded-full hover:bg-slate-100">
          清除篩選
        </button>
      )}
    </div>
  );

  return (
    <div className="bg-white border-b border-[#DDD9D0] shrink-0">
      {/* Desktop */}
      <div className="hidden md:flex items-center gap-2 px-4 py-2 flex-wrap text-sm">
        {selects}
        <span className="ml-auto flex items-center gap-2">
          <SnapshotBadge />
          {currentUser?.role === ROLES.ADMIN && (
            <button onClick={openHealthDrawer} title="資料健檢與合併"
              className="hidden md:inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border
                         border-[#DDD9D0] text-slate-500 hover:bg-[#F5F2EC] whitespace-nowrap">
              🩺 資料健檢
            </button>
          )}
        </span>
      </div>
      {/* Mobile: 摺疊列 */}
      <div className="md:hidden">
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <span className="text-base font-semibold text-slate-700 truncate flex-1 min-w-0">🏭 {filterLabel}</span>
          <button onClick={() => setMobileFilterOpen(v => !v)}
            className={`shrink-0 text-base font-semibold px-4 py-2 rounded-lg whitespace-nowrap
                        transition-colors shadow-sm
                        ${mobileFilterOpen
                          ? 'bg-slate-600 text-white hover:bg-slate-700'
                          : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
            {mobileFilterOpen ? '收起 ▲' : '篩選 ▼'}
          </button>
        </div>
        {mobileFilterOpen && (
          <div className="px-4 pb-3 flex flex-col gap-2 text-sm border-t border-slate-100">
            <div className="flex items-center gap-2">
              <span className="text-slate-500 w-12 shrink-0">倉別</span>
              <select value={selectedWarehouse ?? ''} onChange={e => handleWhChange(e.target.value)}
                className="flex-1 border border-[#DDD9D0] rounded-lg px-2 py-1.5 text-sm">
                <option value="">全部倉別</option>
                {visibleWarehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-500 w-12 shrink-0">課別</span>
              <select value={selectedDept ?? ''} onChange={e => handleDeptChange(e.target.value)}
                disabled={!selectedWarehouse}
                className="flex-1 border border-[#DDD9D0] rounded-lg px-2 py-1.5 text-sm disabled:opacity-40">
                <option value="">全部課別</option>
                {depts.map(d => <option key={d.id} value={d.id}>{d.code ? `${d.code} ${d.name}` : d.name}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-500 w-12 shrink-0">組別</span>
              <select value={selectedGroup ?? ''} onChange={e => handleGroupChange(e.target.value)}
                disabled={!selectedDept || groups.length === 0}
                className="flex-1 border border-[#DDD9D0] rounded-lg px-2 py-1.5 text-sm disabled:opacity-40">
                <option value="">全部組別</option>
                {groups.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-500 w-12 shrink-0">作業區</span>
              <select value={selectedWorkArea ?? ''} onChange={e => setSelectedWorkArea(e.target.value || null)}
                className="flex-1 border border-[#DDD9D0] rounded-lg px-2 py-1.5 text-sm">
                <option value="">全部作業區</option>
                {workAreas.map(a => <option key={a} value={a}>{a}</option>)}
                <option value="__none__">未設定</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-500 w-12 shrink-0">廠商</span>
              <select value={selectedVendor ?? ''} onChange={e => handleVendorChange(e.target.value)}
                className="flex-1 border border-[#DDD9D0] rounded-lg px-2 py-1.5 text-sm">
                <option value="">全部廠商</option>
                {vendorOptions.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            {hasFilter && (
              <button onClick={() => { setSelectedWarehouse(null); setSelectedDept(null); setSelectedGroup(null); setSelectedVendor(null); setSelectedWorkArea(null); setMobileFilterOpen(false); }}
                className="self-start px-3 py-1 text-xs text-slate-500 border border-[#DDD9D0] rounded-full hover:bg-slate-100">
                清除篩選
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MobileNav({ currentPage, onNavigate, currentUser, onLogout, onSave, open, onClose }) {
  const { employees: navEmployees } = useApp();  // hook 須在提早 return 之前呼叫
  if (!open) return null;
  const userPerms = currentUser.permissions ?? getDefaultPermissions(currentUser.role);
  const items = NAV_ITEMS.filter(n =>
    n.roles.includes(currentUser.role) &&
    (currentUser.role === ROLES.ADMIN || userPerms[n.key]?.view !== false) &&
    // 簽到/手機控管僅在登入者本身也是清冊內人員時才顯示
    (!n.needsSelfEmp || !!resolveSelfEmployee(currentUser, navEmployees))
  );
  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <aside className="fixed left-0 top-0 h-full w-72 text-white z-50 flex flex-col"
             style={{background:'var(--sms-sidebar)'}}>
        <div className="flex items-center justify-between px-4 py-4 border-b border-[#1C4A46]">
          <div className="flex items-center gap-2">
            <span className="text-xl">🗓️</span>
            <span className="font-bold text-sm">委外人力排班作業平台</span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">✕</button>
        </div>
        {/* 與桌機版一致：選中為白色膠囊 */}
        <nav className="flex-1 px-3 py-3 overflow-y-auto space-y-1.5">
          {items.map(item => {
            const active = currentPage === item.key;
            return (
              <button key={item.key}
                onClick={() => { onNavigate(item.key); onClose(); }}
                className={`w-full flex items-center gap-3 px-4 py-3 text-sm rounded-full transition-colors
                            ${active ? 'bg-white font-bold shadow-sm' : 'text-white/80 active:bg-white/10'}`}
                style={active ? { color: 'var(--sms-sidebar)' } : undefined}>
                <span className="text-lg leading-none w-6 text-center">{item.icon}</span>
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="p-4 border-t border-[#1C4A46] text-sm text-slate-300">
          <div className="font-medium text-slate-200 mb-1">{currentUser.name}</div>
          <div className="text-xs text-slate-400 mb-3">
            {currentUser.role === ROLES.ADMIN ? '管理員' : currentUser.role === ROLES.AREA ? '日翊' : currentUser.role === ROLES.WORKER ? '委外人員' : '委外幹部'}
          </div>
          <div className="flex items-center gap-3">
            {onSave && <SaveButton onSave={onSave} mobile />}
            <button onClick={onLogout} className="flex items-center gap-2 text-red-400 hover:text-red-300 transition-colors">
              <span>🚪</span><span>登出</span>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

// ─────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────

function Dashboard() {
  const {
    employees, schedule, currentUser, selectedYear, selectedMonth,
    warehouses, selectedWarehouse, selectedDept, selectedGroup, selectedWorkArea,
    attendData, extras,
  } = useApp();

  const today = new Date();
  const [dashYear,  setDashYear]  = useState(today.getFullYear());
  const [dashMonth, setDashMonth] = useState(today.getMonth() + 1);
  const [dashDay,   setDashDay]   = useState(today.getDate());

  const daysInDashMonth = getDaysInMonth(dashYear, dashMonth);
  // 若當月天數變少導致 day 超出範圍，自動修正
  const safeDay = Math.min(dashDay, daysInDashMonth);

  const days = getDaysInMonth(selectedYear, selectedMonth);
  const isToday = dashYear === today.getFullYear() && dashMonth === today.getMonth() + 1 && safeDay === today.getDate();

  const visibleEmployees = useMemo(() => {
    let list = currentUser.role === ROLES.VENDOR
      ? employees.filter(e => currentUser.vendors.includes(e.vendor) && e.status !== '離職')
      : employees.filter(e => e.vendor && e.vendor.trim() !== '' && e.status !== '離職');
    return filterByScope(list, warehouses, selectedWarehouse, selectedDept, selectedGroup, selectedWorkArea);
  }, [employees, currentUser, warehouses, selectedWarehouse, selectedDept, selectedGroup, selectedWorkArea]);

  // 儀表板用：不過濾 vendor 角色，讓各廠商長期人員都能算到
  const dashEmployees = useMemo(() => {
    const list = employees.filter(e => e.vendor && e.vendor.trim() !== '' && e.status !== '離職');
    return filterByScope(list, warehouses, selectedWarehouse, selectedDept, selectedGroup, selectedWorkArea);
  }, [employees, warehouses, selectedWarehouse, selectedDept, selectedGroup, selectedWorkArea]);

  // 前周同星期日期
  const prevWeekDate = useMemo(() => {
    const d = new Date(dashYear, dashMonth - 1, safeDay);
    d.setDate(d.getDate() - 7);
    return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
  }, [dashYear, dashMonth, safeDay]);

  // 組別欄位定義：從員工資料動態產生，依實際組別名稱顯示
  const GROUP_COLS = useMemo(() => {
    const seen = new Set();
    dashEmployees.forEach(e => { if (e.group) seen.add(e.group); });
    // 排序：日班優先、中班次之、其他依字典序
    const sorted = [...seen].sort((a, b) => {
      const order = v => v.includes('日班') ? 0 : v.includes('中班') ? 1 : 2;
      return order(a) - order(b) || a.localeCompare(b, 'zh-TW');
    });
    return sorted.map(g => ({ label: g, match: empGroup => empGroup === g }));
  }, [dashEmployees]);

  // 所選日期出勤統計（各廠商）含前周差 + 組別細分
  const vendorStats = useMemo(() => {
    const dk   = dateKey(dashYear, dashMonth, safeDay);
    const dkPW = dateKey(prevWeekDate.year, prevWeekDate.month, prevWeekDate.day);
    const attendDkPad = `${dashYear}-${String(dashMonth).padStart(2,'0')}-${String(safeDay).padStart(2,'0')}`;
    const map = {};
    dashEmployees.forEach(emp => {
      if (!map[emp.vendor]) {
        map[emp.vendor] = { roster: 0, working: 0, prevWorking: 0, groups: {}, groupPresent: {}, longPresent: 0 };
        GROUP_COLS.forEach(gc => { map[emp.vendor].groups[gc.label] = 0; map[emp.vendor].groupPresent[gc.label] = 0; });
      }
      map[emp.vendor].roster++;
      const code = schedule[emp.id]?.[dk] ?? 'V';
      const isWorking = !['休','例','國'].includes(code);
      if (isWorking) {
        map[emp.vendor].working++;
        const g = emp.group ?? '';
        GROUP_COLS.forEach(gc => {
          if (gc.match(g)) map[emp.vendor].groups[gc.label]++;
        });
      }
      const codePW = schedule[emp.id]?.[dkPW] ?? 'V';
      if (codePW === 'V') map[emp.vendor].prevWorking++;
    });
    // 長期到班：以 dashEmployees 為基準建立 id→vendor/group 查找表，確保型別一致
    const dashEmpVendor = {};
    const dashEmpGroup  = {};
    dashEmployees.forEach(e => {
      const k = String(e.id);
      dashEmpVendor[k] = e.vendor;
      dashEmpGroup[k]  = e.group ?? '';
    });
    const dayAttend = attendData[attendDkPad] ?? {};
    Object.entries(dayAttend).forEach(([empId, rec]) => {
      if (!rec?.present) return;
      const v = dashEmpVendor[empId];
      if (!v || !map[v]) return;
      map[v].longPresent++;
      const g = dashEmpGroup[empId];
      GROUP_COLS.forEach(gc => {
        if (gc.match(g)) map[v].groupPresent[gc.label]++;
      });
    });
    // 臨時到班：extras 依廠商計算，依倉別/課別/組別篩選（用 dashEmployees 中出現的廠商作為倉別依據）
    const scopeVendors = new Set(dashEmployees.map(e => e.vendor));
    const dayExtras = (extras[attendDkPad] ?? []).filter(e => {
      const vendorOk = !selectedWarehouse || scopeVendors.has(e.vendor);
      const groupOk  = !selectedGroup || !e.group || e.group === selectedGroup;
      return vendorOk && groupOk;
    });
    dayExtras.forEach(e => {
      const v = e.vendor || '未分配';
      if (!map[v]) {
        map[v] = { roster: 0, working: 0, prevWorking: 0, groups: {}, longPresent: 0 };
        GROUP_COLS.forEach(gc => { map[v].groups[gc.label] = 0; });
      }
      if (!map[v].tempPresent)  map[v].tempPresent  = 0;
      if (!map[v].tempExpected) map[v].tempExpected = 0;
      map[v].tempExpected++;
      if (e.present) map[v].tempPresent++;
    });
    return Object.entries(map).map(([vendor, s]) => ({
      vendor,
      roster:       s.roster,
      working:      s.working,
      prevWorking:  s.prevWorking,
      diff:         s.working - s.prevWorking,
      groups:       s.groups,
      groupPresent: s.groupPresent,
      longPresent:  s.longPresent  ?? 0,
      tempPresent:  s.tempPresent  ?? 0,
      tempExpected: s.tempExpected ?? 0,
    }));
  }, [dashEmployees, employees, schedule, dashYear, dashMonth, safeDay, prevWeekDate, GROUP_COLS, attendData, extras, selectedGroup, selectedWorkArea, selectedWarehouse]);

  const selectedDayWorking = vendorStats.reduce((acc, s) => acc + s.working, 0);

  // 點名表實到人數（來源：attendData，限當前範圍在職員工）
  const attendDk = `${dashYear}-${String(dashMonth).padStart(2,'0')}-${String(safeDay).padStart(2,'0')}`;
  const actualPresent = useMemo(() => {
    const dayData = attendData[attendDk] ?? {};
    const scopeIds = new Set(dashEmployees.map(e => e.id));
    return Object.entries(dayData).filter(([id, r]) => scopeIds.has(id) && r.present).length;
  }, [attendData, attendDk, dashEmployees]);

  // ── derived ──
  const totalPrevWorking = vendorStats.reduce((a, s) => a + s.prevWorking, 0);
  const weekDiff         = selectedDayWorking - totalPrevWorking;
  const totalTempPresent = vendorStats.reduce((a, s) => a + s.tempPresent, 0);
  const rosterTotal      = visibleEmployees.length;
  const schedPct         = rosterTotal > 0 ? Math.round(selectedDayWorking / rosterTotal * 100) : 0;
  const hasAttendData    = Object.keys(attendData[attendDk] ?? {}).length > 0;

  // ── canvas refs ──
  const donutRef = useRef(null);
  const barRef   = useRef(null);

  // ── vendor colour map ──
  const VENDOR_COLORS_MAP = useMemo(() => {
    const P = ['#3b82f6','#10b981','#f59e0b','#8b5cf6','#ef4444','#06b6d4','#f97316','#ec4899'];
    const m = {};
    vendorStats.forEach((s, i) => { m[s.vendor] = P[i % P.length]; });
    return m;
  }, [vendorStats]);

  // ── draw donut ──
  useEffect(() => {
    const cv = donutRef.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1, S = 174;
    cv.width = S * dpr; cv.height = S * dpr;
    cv.style.width = `${S}px`; cv.style.height = `${S}px`;
    const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
    const cxD = S/2, cyD = S/2, rD = 80, riD = 56;
    const totD = vendorStats.reduce((a, s) => a + s.roster, 0);
    if (!totD) return;
    const gapD = 0.016; let aD = -Math.PI / 2;
    vendorStats.forEach(s => {
      if (!s.roster) return;
      const span = (s.roster / totD) * Math.PI * 2 - gapD;
      ctx.beginPath();
      ctx.moveTo(cxD + riD * Math.cos(aD + gapD/2), cyD + riD * Math.sin(aD + gapD/2));
      ctx.arc(cxD, cyD, rD, aD + gapD/2, aD + gapD/2 + span);
      ctx.arc(cxD, cyD, riD, aD + gapD/2 + span, aD + gapD/2, true);
      ctx.closePath();
      ctx.fillStyle = VENDOR_COLORS_MAP[s.vendor] || '#94a3b8';
      ctx.fill();
      aD += (s.roster / totD) * Math.PI * 2;
    });
    ctx.beginPath(); ctx.arc(cxD, cyD, riD - 1, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff'; ctx.fill();
  }, [vendorStats, VENDOR_COLORS_MAP]);

  // ── draw attendance rate bar chart ──
  useEffect(() => {
    const cv = barRef.current;
    if (!cv || vendorStats.length === 0) return;
    function drawBar() {
      const W = Math.max((cv.parentElement?.clientWidth || 400) - 36, 200);
      const ROW_H = 44;
      const pL = 80, pR = 50, pT = 16, pB = 16;
      const n = vendorStats.length;
      const H = pT + pB + n * ROW_H;
      const dpr = window.devicePixelRatio || 1;
      cv.width = W * dpr; cv.height = H * dpr;
      cv.style.width = `${W}px`; cv.style.height = `${H}px`;
      const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, W, H);
      const cW = W - pL - pR;
      // grid lines at 25/50/75/100
      [0, 25, 50, 75, 100].forEach(v => {
        const x = pL + (v / 100) * cW;
        ctx.beginPath(); ctx.moveTo(x, pT); ctx.lineTo(x, H - pB);
        ctx.strokeStyle = v === 0 ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.06)';
        ctx.lineWidth = 1; ctx.stroke();
        if (v > 0) {
          ctx.fillStyle = '#94a3b8'; ctx.font = '9.5px system-ui'; ctx.textAlign = 'center';
          ctx.fillText(v + '%', x, pT - 4);
        }
      });
      const bH = 14, gap = 4;
      vendorStats.forEach((s, i) => {
        const cy = pT + i * ROW_H + ROW_H / 2;
        // vendor label
        ctx.fillStyle = '#334155'; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'right';
        ctx.fillText(s.vendor, pL - 8, cy + 4);
        // long-term rate bar (teal)
        const longRate = s.working > 0 ? s.longPresent / s.working : 0;
        const longW = longRate * cW;
        if (longW > 0) {
          ctx.fillStyle = '#0d9488';
          roundRect(ctx, pL, cy - bH - gap/2, longW, bH, 3); ctx.fill();
        }
        // temp rate bar (orange)
        const tempRate = s.tempExpected > 0 ? s.tempPresent / s.tempExpected : 0;
        const tempW = tempRate * cW;
        if (tempW > 0) {
          ctx.fillStyle = '#f97316';
          roundRect(ctx, pL, cy + gap/2, tempW, bH, 3); ctx.fill();
        }
        // labels
        ctx.font = 'bold 10px system-ui'; ctx.textAlign = 'left';
        if (s.working > 0) {
          ctx.fillStyle = '#0d9488';
          ctx.fillText(Math.round(longRate * 100) + '%', pL + longW + 4, cy - gap/2 - 2);
        }
        if (s.tempExpected > 0) {
          ctx.fillStyle = '#f97316';
          ctx.fillText(Math.round(tempRate * 100) + '%', pL + tempW + 4, cy + gap/2 + bH - 2);
        }
        // row divider
        if (i < n - 1) {
          ctx.beginPath(); ctx.moveTo(pL, cy + ROW_H/2); ctx.lineTo(W - pR + 30, cy + ROW_H/2);
          ctx.strokeStyle = 'rgba(0,0,0,0.04)'; ctx.lineWidth = 1; ctx.stroke();
        }
      });
    }
    function roundRect(ctx, x, y, w, h, r) {
      if (w <= 0) { ctx.rect(x, y, 0, h); return; }
      r = Math.min(r, w/2, h/2);
      ctx.beginPath();
      ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    }
    drawBar();
    const obs = new ResizeObserver(() => drawBar());
    if (cv.parentElement) obs.observe(cv.parentElement);
    return () => obs.disconnect();
  }, [vendorStats, hasAttendData]);

  return (
    <div className="p-4 md:p-6 space-y-4">

      {/* ── Date selector ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h2 className="text-lg font-bold text-slate-800">儀表板</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-slate-500">查詢日期：</span>
          <select value={dashYear} onChange={e => setDashYear(+e.target.value)}
            className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white text-slate-700">
            {[2024,2025,2026,2027].map(y => <option key={y} value={y}>{y}年</option>)}
          </select>
          <select value={dashMonth} onChange={e => setDashMonth(+e.target.value)}
            className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white text-slate-700">
            {Array.from({length:12},(_,i)=>i+1).map(m => <option key={m} value={m}>{m}月</option>)}
          </select>
          <select value={safeDay} onChange={e => setDashDay(+e.target.value)}
            className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white text-slate-700">
            {Array.from({length:daysInDashMonth},(_,i)=>i+1).map(d => <option key={d} value={d}>{d}日</option>)}
          </select>
          {!isToday && (
            <button onClick={() => { setDashYear(today.getFullYear()); setDashMonth(today.getMonth()+1); setDashDay(today.getDate()); }}
              className="px-2.5 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg text-xs hover:bg-blue-100 transition-colors">
              回今日
            </button>
          )}
          {isToday && <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full font-medium">今日</span>}
        </div>
      </div>

      {/* ── KPI row ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">

        {/* KPI 1: 在職 */}
        <div className="relative bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="absolute inset-y-0 left-0 w-[3px] bg-blue-500" />
          <div className="pl-5 pr-4 pt-4 pb-4">
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center mb-2.5">
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none"><path d="M10 10a4 4 0 100-8 4 4 0 000 8zm-7 8a7 7 0 0114 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
            </div>
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">長期在職總人數</div>
            <div className="text-4xl font-bold text-slate-800 tracking-tight tabular-nums mb-2 leading-none">{rosterTotal}</div>
            <div className="flex items-center justify-between gap-1">
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-green-50 text-green-700">在職中</span>
              <span className="text-[11px] text-slate-400">{vendorStats.length} 廠商</span>
            </div>
          </div>
        </div>

        {/* KPI 2: 排班 */}
        <div className="relative bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="absolute inset-y-0 left-0 w-[3px] bg-cyan-500" />
          <div className="pl-5 pr-4 pt-4 pb-4">
            <div className="w-8 h-8 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center mb-2.5">
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none"><rect x="2" y="4" width="16" height="13" rx="2" stroke="currentColor" strokeWidth="1.6"/><path d="M6 4V2m8 2V2M2 9h16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
            </div>
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">今日應出勤（排班）</div>
            <div className="text-4xl font-bold text-slate-800 tracking-tight tabular-nums mb-2 leading-none">{selectedDayWorking}</div>
            <div className="flex items-center justify-between gap-1">
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${weekDiff >= 0 ? 'bg-blue-50 text-blue-700' : 'bg-red-50 text-red-600'}`}>
                {weekDiff >= 0 ? '↑' : '↓'} {Math.abs(weekDiff)} 較上週
              </span>
              <span className="text-[11px] text-slate-400">佔在職 {schedPct}%</span>
            </div>
            <div className="mt-2 h-1 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-cyan-500 rounded-full" style={{width:`${schedPct}%`}} />
            </div>
          </div>
        </div>

        {/* KPI 3: 長期到班 */}
        <div className="relative bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="absolute inset-y-0 left-0 w-[3px] bg-teal-400" />
          <div className="pl-5 pr-4 pt-4 pb-4">
            <div className="w-8 h-8 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center mb-2.5">
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none"><path d="M10 5v5l3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/><circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.6"/></svg>
            </div>
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">今日實際到班（長期）</div>
            {hasAttendData
              ? <div className="text-4xl font-bold text-slate-800 tracking-tight tabular-nums mb-2 leading-none">{actualPresent}</div>
              : <div className="text-2xl font-semibold text-slate-300 mb-2 leading-none">— —</div>
            }
            <div className="flex items-center justify-between gap-1">
              {hasAttendData
                ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-green-50 text-green-700">✓ 已點名</span>
                : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-600">⚠ 點名未填</span>
              }
              <span className="text-[11px] text-slate-400">排班 {selectedDayWorking} 人</span>
            </div>
          </div>
        </div>

        {/* KPI 4: 臨時到班 */}
        <div className="relative bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="absolute inset-y-0 left-0 w-[3px] bg-amber-400" />
          <div className="pl-5 pr-4 pt-4 pb-4">
            <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center mb-2.5">
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.6"/><path d="M10 6v4h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
            </div>
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">今日實際到班（臨時）</div>
            {hasAttendData
              ? <div className="text-4xl font-bold text-slate-800 tracking-tight tabular-nums mb-2 leading-none">{totalTempPresent}</div>
              : <div className="text-2xl font-semibold text-slate-300 mb-2 leading-none">— —</div>
            }
            <div className="flex items-center justify-between gap-1">
              {hasAttendData
                ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-green-50 text-green-700">✓ 已點名</span>
                : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-600">⚠ 點名未填</span>
              }
              <span className="text-[11px] text-slate-400">臨時人力統計</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Charts row ── */}
      <div className="grid grid-cols-1 md:grid-cols-[288px_1fr] gap-3.5">

        {/* Donut chart — 各廠商在職 */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
          <div className="px-5 pt-4 pb-0">
            <div className="text-sm font-bold text-slate-800">各廠商在職人力分布</div>
            <div className="text-xs text-slate-400 mt-0.5">今日在職 {rosterTotal} 人</div>
          </div>
          <div className="px-5 pb-5 pt-3 flex flex-col items-center">
            <div className="relative w-[174px] h-[174px] flex-shrink-0">
              <canvas ref={donutRef} />
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-[30px] font-bold text-slate-800 leading-none tracking-tight tabular-nums">{rosterTotal}</span>
                <span className="text-[10px] text-slate-400 uppercase tracking-wide mt-1">總人數</span>
              </div>
            </div>
            <div className="w-full mt-3 space-y-1.5">
              {vendorStats.map(s => (
                <div key={s.vendor} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{background: VENDOR_COLORS_MAP[s.vendor]}} />
                    <span className="text-slate-500 truncate">{s.vendor}</span>
                  </div>
                  <div>
                    <span className="font-semibold text-slate-700 tabular-nums">{s.roster}</span>
                    <span className="text-slate-400 ml-1">{rosterTotal > 0 ? (s.roster/rosterTotal*100).toFixed(1) : 0}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Vendor attendance rate chart ── */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
          <div className="px-5 pt-4 pb-0">
            <div className="text-sm font-bold text-slate-800">各廠商到班率（{dashMonth}/{safeDay}{isToday ? ' · 今日' : ''}）</div>
            <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-3">
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm" style={{background:'#0d9488'}} /> 長期到班率</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm" style={{background:'#f97316'}} /> 臨時到班率</span>
            </div>
          </div>
          <div className="px-5 pb-4 pt-3">
            {!hasAttendData && (
              <div className="flex items-center justify-center h-20 text-xs text-slate-400">尚未填寫點名</div>
            )}
            {hasAttendData && <canvas ref={barRef} style={{width:'100%',display:'block'}} />}
          </div>
        </div>

      </div>

      {/* ── Vendor detail table ── */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 pt-4 pb-3">
          <div className="text-sm font-bold text-slate-800">各廠商人力明細</div>
          <div className="text-xs text-slate-400 mt-0.5">
            {dashYear}/{dashMonth}/{safeDay}{isToday ? '（今日）' : ''}　　前周同日：{prevWeekDate.month}/{prevWeekDate.day}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse font-bold" style={{minWidth: 560, fontVariantNumeric: 'tabular-nums'}}>
            <thead>
              {/* 群組標題列 */}
              <tr className="bg-slate-50 border-t border-slate-200">
                <th rowSpan={2} className="text-left px-3 py-2 text-[10.5px] font-bold uppercase tracking-wider text-slate-400 border-b-2 border-slate-200">廠商</th>
                <th colSpan={1 + GROUP_COLS.length + 2} className="text-center px-3 py-1.5 text-[10.5px] font-bold tracking-wider text-teal-700 bg-teal-50 border border-teal-200">長期人員</th>
                <th colSpan={3} className="text-center px-3 py-1.5 text-[10.5px] font-bold tracking-wider text-orange-600 bg-orange-50 border border-orange-200">臨時人員</th>
                <th rowSpan={2} className="text-center px-3 py-2 text-[10.5px] font-bold uppercase tracking-wider text-slate-600 border-b-2 border-slate-200">總出勤人數</th>
                <th rowSpan={2} className="text-center px-3 py-2 text-[10.5px] font-bold uppercase tracking-wider text-slate-400 border-b-2 border-slate-200">前周差</th>
              </tr>
              {/* 欄位標題列 */}
              <tr className="bg-slate-50 border-b-2 border-slate-200">
                <th className="text-center px-3 py-2 text-[10.5px] font-bold uppercase tracking-wider text-blue-500 bg-teal-50/40">應到</th>
                {GROUP_COLS.map(gc => (
                  <th key={gc.label} className="text-center px-3 py-2 text-[10.5px] font-bold uppercase tracking-wider text-slate-400 bg-teal-50/40">{gc.label}</th>
                ))}
                <th className="text-center px-3 py-2 text-[10.5px] font-bold uppercase tracking-wider text-teal-600 bg-teal-50/40">到班（長）</th>
                <th className="text-center px-3 py-2 text-[10.5px] font-bold uppercase tracking-wider text-teal-600 bg-teal-50/40">到班率（長）</th>
                <th className="text-center px-3 py-2 text-[10.5px] font-bold uppercase tracking-wider text-orange-400 bg-orange-50/40">應到（臨）</th>
                <th className="text-center px-3 py-2 text-[10.5px] font-bold uppercase tracking-wider text-orange-500 bg-orange-50/40">到班（臨）</th>
                <th className="text-center px-3 py-2 text-[10.5px] font-bold uppercase tracking-wider text-orange-500 bg-orange-50/40">到班率（臨）</th>
              </tr>
            </thead>
            <tbody>
              {vendorStats.map((s, i) => {
                const diffColor = s.diff > 0 ? 'text-green-700 font-semibold' : s.diff < 0 ? 'text-red-500 font-semibold' : 'text-slate-300';
                const diffLabel = s.diff > 0 ? `+${s.diff}` : s.diff < 0 ? `${s.diff}` : '—';
                return (
                  <tr key={s.vendor}
                    className={`hover:bg-blue-50/40 transition-colors ${i > 0 ? 'border-t border-slate-100' : ''} ${i % 2 === 1 ? 'bg-slate-50/50' : ''}`}>
                    <td className="px-3 py-2.5 text-sm font-medium text-slate-700">
                      <span className="inline-block w-2 h-2 rounded-full mr-2 align-middle" style={{background: VENDOR_COLORS_MAP[s.vendor]}} />
                      {s.vendor}
                    </td>
                    <td className="px-3 py-2.5 text-center text-sm font-bold text-blue-600">{s.working}</td>
                    {GROUP_COLS.map(gc => {
                      const cnt = s.groupPresent?.[gc.label] ?? 0;
                      return (
                        <td key={gc.label} className="px-3 py-2.5 text-center text-sm">
                          {cnt > 0 ? <span className="text-slate-700">{cnt}</span> : <span className="text-slate-300">—</span>}
                        </td>
                      );
                    })}
                    {/* 長期：到班（長） */}
                    <td className="px-3 py-2.5 text-center text-sm bg-teal-50/20">
                      {hasAttendData
                        ? (s.longPresent > 0 ? <span className="font-semibold text-teal-600">{s.longPresent}</span> : <span className="text-slate-300">—</span>)
                        : <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-600">未填</span>
                      }
                    </td>
                    {/* 長期：到班率（長） */}
                    <td className="px-3 py-2.5 text-center text-sm bg-teal-50/20">
                      {hasAttendData
                        ? (s.working > 0
                            ? <span className="font-semibold text-teal-600">{Math.round(s.longPresent / s.working * 100)}%</span>
                            : <span className="text-slate-300">—</span>)
                        : <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-600">未填</span>
                      }
                    </td>
                    {/* 臨時：應到（臨） */}
                    <td className="px-3 py-2.5 text-center text-sm bg-orange-50/20">
                      {hasAttendData
                        ? (s.tempExpected > 0 ? <span className="text-orange-400">{s.tempExpected}</span> : <span className="text-slate-300">—</span>)
                        : <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-600">未填</span>
                      }
                    </td>
                    {/* 臨時：到班（臨） */}
                    <td className="px-3 py-2.5 text-center text-sm bg-orange-50/20">
                      {hasAttendData
                        ? (s.tempPresent > 0 ? <span className="font-semibold text-orange-500">{s.tempPresent}</span> : <span className="text-slate-300">—</span>)
                        : <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-600">未填</span>
                      }
                    </td>
                    {/* 臨時：到班率（臨） */}
                    <td className="px-3 py-2.5 text-center text-sm bg-orange-50/20">
                      {hasAttendData
                        ? (s.tempExpected > 0
                            ? <span className="font-semibold text-orange-500">{Math.round(s.tempPresent / s.tempExpected * 100)}%</span>
                            : <span className="text-slate-300">—</span>)
                        : <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-600">未填</span>
                      }
                    </td>
                    {/* 總出勤人數 */}
                    <td className="px-3 py-2.5 text-center text-sm">
                      {hasAttendData
                        ? <span className="font-bold text-slate-700">{s.longPresent + s.tempPresent}</span>
                        : <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-600">未填</span>
                      }
                    </td>
                    {/* 前周差 */}
                    <td className={`px-3 py-2.5 text-center text-sm ${diffColor}`}>{diffLabel}</td>
                  </tr>
                );
              })}
              {/* 合計列 */}
              {vendorStats.length > 0 && (() => {
                const total = {
                  roster:      vendorStats.reduce((a, s) => a + s.roster,      0),
                  working:     vendorStats.reduce((a, s) => a + s.working,     0),
                  diff:        vendorStats.reduce((a, s) => a + s.diff,        0),
                  longPresent:  vendorStats.reduce((a, s) => a + s.longPresent,  0),
                  tempPresent:  vendorStats.reduce((a, s) => a + s.tempPresent,  0),
                  tempExpected: vendorStats.reduce((a, s) => a + s.tempExpected, 0),
                };
                const tDiffColor = total.diff > 0 ? 'text-green-700' : total.diff < 0 ? 'text-red-500' : 'text-slate-300';
                const tDiffLabel = total.diff > 0 ? `+${total.diff}` : total.diff < 0 ? `${total.diff}` : '—';
                return (
                  <tr className="border-t-2 border-slate-200 bg-slate-50">
                    <td className="px-3 py-2.5 text-xs font-bold text-slate-500 uppercase tracking-wide">合計</td>
                    <td className="px-3 py-2.5 text-center text-sm font-bold text-blue-600">{total.working}</td>
                    {GROUP_COLS.map(gc => {
                      const cnt = vendorStats.reduce((a, s) => a + (s.groupPresent?.[gc.label] ?? 0), 0);
                      return (
                        <td key={gc.label} className="px-3 py-2.5 text-center text-sm font-bold">
                          {cnt > 0 ? <span className="text-slate-600">{cnt}</span> : <span className="text-slate-300">—</span>}
                        </td>
                      );
                    })}
                    {/* 長期：到班（長） */}
                    <td className="px-3 py-2.5 text-center text-sm font-bold bg-teal-50/20">
                      {hasAttendData
                        ? (total.longPresent > 0 ? <span className="text-teal-600">{total.longPresent}</span> : <span className="text-slate-300">—</span>)
                        : <span className="text-slate-300">—</span>
                      }
                    </td>
                    {/* 長期：到班率（長） */}
                    <td className="px-3 py-2.5 text-center text-sm font-bold bg-teal-50/20">
                      {hasAttendData
                        ? (total.working > 0
                            ? <span className="text-teal-600">{Math.round(total.longPresent / total.working * 100)}%</span>
                            : <span className="text-slate-300">—</span>)
                        : <span className="text-slate-300">—</span>
                      }
                    </td>
                    {/* 臨時：應到（臨） */}
                    <td className="px-3 py-2.5 text-center text-sm font-bold bg-orange-50/20">
                      {hasAttendData
                        ? (total.tempExpected > 0 ? <span className="text-orange-400">{total.tempExpected}</span> : <span className="text-slate-300">—</span>)
                        : <span className="text-slate-300">—</span>
                      }
                    </td>
                    {/* 臨時：到班（臨） */}
                    <td className="px-3 py-2.5 text-center text-sm font-bold bg-orange-50/20">
                      {hasAttendData
                        ? (total.tempPresent > 0 ? <span className="text-orange-500">{total.tempPresent}</span> : <span className="text-slate-300">—</span>)
                        : <span className="text-slate-300">—</span>
                      }
                    </td>
                    {/* 臨時：到班率（臨） */}
                    <td className="px-3 py-2.5 text-center text-sm font-bold bg-orange-50/20">
                      {hasAttendData
                        ? (total.tempExpected > 0
                            ? <span className="text-orange-500">{Math.round(total.tempPresent / total.tempExpected * 100)}%</span>
                            : <span className="text-slate-300">—</span>)
                        : <span className="text-slate-300">—</span>
                      }
                    </td>
                    {/* 總出勤人數 */}
                    <td className="px-3 py-2.5 text-center text-sm font-bold">
                      {hasAttendData
                        ? <span className="text-slate-700">{total.longPresent + total.tempPresent}</span>
                        : <span className="text-slate-300">—</span>
                      }
                    </td>
                    {/* 前周差 */}
                    <td className={`px-3 py-2.5 text-center text-sm font-bold ${tDiffColor}`}>{tDiffLabel}</td>
                  </tr>
                );
              })()}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}

// ─────────────────────────────────────────────
// SCHEDULE TABLE
// ─────────────────────────────────────────────

/** 可點擊排序的表頭：點第一次遞增、第二次遞減、第三次回到預設排序 */
function SortHeader({ label, col, sort, onSort, align = 'center', tone = 'dark' }) {
  const active = sort.col === col;
  const icon = !active ? '↕' : sort.dir === 1 ? '↑' : '↓';
  const light = tone === 'light';
  return (
    <button type="button" onClick={() => onSort(col)}
      title={active ? (sort.dir === 1 ? '遞增（再按一次改遞減）' : '遞減（再按一次恢復預設）') : '點擊排序'}
      className={`w-full flex items-center gap-1 select-none transition-colors
                  ${light ? 'hover:text-blue-600' : 'hover:text-yellow-200'}
                  ${align === 'left' ? 'justify-start' : 'justify-center'}`}>
      <span>{label}</span>
      <span className={active
        ? (light ? 'text-blue-600 font-bold' : 'text-yellow-300 font-bold')
        : (light ? 'text-slate-300' : 'text-slate-400')}>{icon}</span>
    </button>
  );
}

/** 快速解鎖對話框：日翊／管理員輸入密碼後，臨時略過課別鎖定與開放區間 */
function UnlockDialog({ hasPwd, onVerify, onOk, onClose }) {
  const [pwd, setPwd] = useState('');
  const [minutes, setMinutes] = useState(5);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    const ok = await onVerify(pwd);
    setBusy(false);
    if (ok) onOk(minutes);
    else setErr('密碼錯誤');
  };

  return (
    <Modal onClose={onClose}>
      {/* 需自備不透明底色：Modal 只提供半透明遮罩，少了這層會直接透出底下的班表 */}
      <div className="bg-white rounded-xl shadow-xl border border-[#DDD9D0] p-5 w-[340px]">
        <h3 className="font-bold text-slate-800 mb-1">🔓 快速解鎖</h3>
        <p className="text-xs text-slate-500 mb-4">
          解鎖後可暫時編輯此課別的班表，不受鎖定與開放排班區間限制。
          <br />僅影響您這台電腦這次操作，不會變更任何人的設定。
        </p>

        {!hasPwd ? (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
            尚未設定解鎖密碼，請先至「系統設定 → 快速解鎖密碼」設定。
          </p>
        ) : (
          <>
            <label className="block text-xs font-medium text-slate-600 mb-1">解鎖密碼</label>
            <input type="password" value={pwd} autoFocus
              onChange={e => { setPwd(e.target.value); setErr(''); }}
              onKeyDown={e => { if (e.key === 'Enter') submit(); }}
              className="w-full border border-[#DDD9D0] rounded-lg px-3 py-2 text-sm mb-2" />
            {err && <p className="text-xs text-red-600 mb-2">{err}</p>}

            <label className="block text-xs font-medium text-slate-600 mb-1">解鎖時間</label>
            <div className="flex gap-1 mb-4">
              {[5, 10].map(m => (
                <button key={m} onClick={() => setMinutes(m)}
                  className={`flex-1 px-2 py-1.5 text-xs rounded-lg border transition-colors
                    ${minutes === m ? 'bg-slate-700 text-white border-transparent'
                                    : 'bg-white border-[#DDD9D0] text-slate-600 hover:bg-[#F5F2EC]'}`}>
                  {m} 分鐘
                </button>
              ))}
            </div>
          </>
        )}

        <div className="flex gap-2">
          <button onClick={onClose}
            className="flex-1 px-3 py-2 text-sm border border-[#DDD9D0] rounded-lg text-slate-600 hover:bg-[#F5F2EC]">
            取消
          </button>
          {hasPwd && (
            <button onClick={submit} disabled={busy || !pwd}
              className="flex-1 px-3 py-2 text-sm bg-slate-700 text-white rounded-lg hover:bg-slate-800 disabled:opacity-40">
              {busy ? '驗證中…' : '解鎖'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function ScheduleTable() {
  const {
    employees, schedule, setSchedule, currentUser,
    selectedYear, selectedMonth, setSelectedYear, setSelectedMonth,
    deptLocks, deptRanges, deptSegments, dailyDemand, setDailyDemand, unlockPwd,
    periodRange, openHolidays, vendorHolidayOpen, vendorRestOpen, workerRestOpen,
    warehouses, selectedWarehouse, selectedDept, selectedGroup, selectedWorkArea,
    selectedVendor,
  } = useApp();
  const toast = useToast();

  // 班別設定與代號表從 context 取得（跨裝置同步）
  const { shiftTypesByWh, shiftCodeRows, shiftCodeHeaders } = useApp();
  const isWorker = currentUser.role === ROLES.WORKER;
  // 匯入／批次修正／存檔／匯出等管理工具僅限日翊（管理員、當區幹部）；
  // 委外幹部與委外人員只保留唯讀操作（搜尋、顯示記號、列印報表）與點格子編輯班表
  const isManager = currentUser.role === ROLES.ADMIN || currentUser.role === ROLES.AREA;
  const shiftTypes = shiftTypesByWh[selectedWarehouse ?? 'default'] ?? [];

  // 假日名稱 → 代號表欄位名稱對照
  const HOLIDAY_COL_MAP = {
    '元旦':           '元旦',
    '小年夜':         '小年夜',
    '農曆除夕':       '除夕',
    '二二八和平紀念日': '228紀念日',
    '兒童節':         '兒童節',
    '清明節':         '清明節',
    '勞動節':         '勞動節',
    '端午節':         '端午',
    '中秋節':         '中秋',
    '國慶日':         '雙十',
    '教師節':         '教師節',
    '光復節':         '光復節',
    '行憲紀念日':     '行憲紀念日',
  };
  // 春節多日：依同年月中第幾個「春節」映射到初一/初二/初三
  const LUNAR_NEW_YEAR_COLS = ['初ㄧ', '初二', '初三'];

  // 取得某日期的假日代號表欄名
  const getHolidayColName = useCallback((year, month, day) => {
    const h = NATIONAL_HOLIDAYS.find(h => h.year === year && h.month === month && h.day === day);
    if (!h) return null;
    if (h.name === '春節') {
      const springDays = NATIONAL_HOLIDAYS
        .filter(x => x.year === year && x.name === '春節')
        .sort((a, b) => a.month !== b.month ? a.month - b.month : a.day - b.day);
      const idx = springDays.findIndex(x => x.month === month && x.day === day);
      return LUNAR_NEW_YEAR_COLS[idx] ?? '初ㄧ';
    }
    return HOLIDAY_COL_MAP[h.name] ?? null;
  }, []);

  // 「國」但當天非實際國定假日（補休調整到其他日期）時，該歸屬哪個假日：
  // 以「目前排班週期」為範圍（不可用月份，週期常跨月，否則跨月那天會配到週期外的假日），
  // 將這些補休日與週期內的實際假日做最短距離一對一貪婪配對，避免重複誤判成同一個假日
  // 注意：不可用 useCallback —— 相依陣列會在渲染當下就存取 dayHeaders（宣告於本函式之後），
  //       會觸發 TDZ（Cannot access before initialization）
  const getAmbiguousHolidayMap = (empId) => {
    // 存代號表「欄位名稱」而非假日名稱：兩者不一定同名
    //（中秋節→中秋、國慶日→雙十、農曆除夕→除夕…，須經 HOLIDAY_COL_MAP 轉換）
    const periodHolidays = dayHeaders
      .map(h => ({
        dk: h.dk,
        col: getHolidayColName(h.year, h.month, h.day),
        ts: new Date(h.year, h.month - 1, h.day).getTime(),
      }))
      .filter(h => h.col);
    const result = new Map();
    if (periodHolidays.length === 0) return result;

    const remainingDays = dayHeaders
      .filter(h => schedule[empId]?.[h.dk] === '國' && !getHolidayColName(h.year, h.month, h.day))
      .map(h => ({ dk: h.dk, ts: new Date(h.year, h.month - 1, h.day).getTime() }));
    // 一對一配對時優先使用「當天尚未被標記為國」的假日：假日當天若已標國，
    // 該天會走精準對應用掉此假日，不應再被其他補休日搶走
    const remainingHols = periodHolidays.filter(h => schedule[empId]?.[h.dk] !== '國');
    while (remainingDays.length > 0 && remainingHols.length > 0) {
      let best = null;
      remainingDays.forEach(d => {
        remainingHols.forEach(h => {
          const dist = Math.abs(h.ts - d.ts);
          if (!best || dist < best.dist) best = { d, h, dist };
        });
      });
      result.set(best.d.dk, best.h.col);
      remainingDays.splice(remainingDays.indexOf(best.d), 1);
      remainingHols.splice(remainingHols.indexOf(best.h), 1);
    }
    // 補休日多於可一對一配對的假日時（例如假日當天都已標國、或補休天數本就較多），
    // 剩下的退而求其次：用週期內全部假日中距離最近者（允許重複），至少不留下未轉換的「國」
    remainingDays.forEach(d => {
      const nearest = periodHolidays.reduce((b, h) =>
        Math.abs(h.ts - d.ts) < Math.abs(b.ts - d.ts) ? h : b);
      result.set(d.dk, nearest.col);
    });
    return result;
  };

  // 連續上班天數檢核（法規：不可連續上班 7 天）
  // 須跨越週期邊界：前一週期末段接本週期開頭、本週期末段接下一週期，
  // 因此往前後各多掃 7 天的實際班表資料。
  // 週期內未填視為上班(V)（與畫面顯示一致）；週期外只採計「確實排定為 V」的日子，
  // 避免尚未排班的空白日被誤判成連續上班。
  const MAX_WORK_RUN = 7;   // 姓名標紅（違規）
  const WARN_WORK_RUN = 6;  // 格子標粉紅底（警示）
  // 回傳 max：與本週期相接的最長連續上班天數
  //     warn：本週期內、屬於「連續上班達 WARN_WORK_RUN 天」區段的日期
  // 兩者皆採同一份跨週期計算，避免格子與姓名的判斷不一致
  const getWorkRunInfo = (empId) => {
    const row = schedule[empId];
    if (!row || dayHeaders.length === 0) return { max: 0, warn: new Set() };
    const first = dayHeaders[0];
    const last = dayHeaders[dayHeaders.length - 1];
    const inPeriod = new Set(dayHeaders.map(h => h.dk));
    // 往前多看 7 天，讓上一期延續過來的連續上班也能被抓到；
    // 但「不往未來延伸」——下一期的班多半是匯入時的預設 V，尚未實際排定，
    // 若一併計入會產生假警示。下一期的檢核等排到那一期時自然會做。
    const cur = new Date(first.year, first.month - 1, first.day);
    cur.setDate(cur.getDate() - MAX_WORK_RUN);
    const stop = new Date(last.year, last.month - 1, last.day);

    // 該課開放區間結束日之後的日子在畫面上呈灰底、視為尚未開放，同樣不納入計算
    const openEnd = (() => {
      const emp = employees.find(e => e.id === empId);
      const r = visibleRangeOfGroup(segmentsOf(deptSegments, deptRanges, deptLocks, emp?.dept), emp?.group);
      return r.end ? parseLocal(r.end).getTime() : Infinity;
    })();

    let max = 0;
    const warn = new Set();
    let run = [];
    let touches = false;
    const flush = () => {
      if (touches) {
        max = Math.max(max, run.length);
        if (run.length >= WARN_WORK_RUN) {
          run.forEach(k => { if (inPeriod.has(k)) warn.add(k); });
        }
      }
      run = []; touches = false;
    };
    while (cur <= stop) {
      if (cur.getTime() > openEnd) break;   // 尚未開放排班的日子不計
      const dk = dateKey(cur.getFullYear(), cur.getMonth() + 1, cur.getDate());
      const within = inPeriod.has(dk);
      const isWork = within ? ((row[dk] ?? 'V') === 'V') : (row[dk] === 'V');
      if (isWork) { run.push(dk); if (within) touches = true; }
      else flush();
      cur.setDate(cur.getDate() + 1);
    }
    flush();
    return { max, warn };
  };

  // 依員工班別、班表代號、日期 → 代號表實際代號
  // month/year 明確傳入，避免 range mode 跨月時用錯 selectedMonth
  const getDisplayCode = useCallback((emp, rawCode, day, month = selectedMonth, year = selectedYear) => {
    if (!emp.shiftTypeId) return rawCode;
    const st = findShiftType(shiftTypesByWh, selectedWarehouse ?? 'default', emp.shiftTypeId);
    if (!st) return rawCode;
    const timeStr = `${st.startTime.slice(0,2)}:${st.startTime.slice(2)}`;
    const row = shiftCodeRows.find(r => String(r[0]).trim() === timeStr);
    if (!row) return rawCode;

    if (rawCode === 'V' || rawCode === '') {
      return row[1] ? String(row[1]) : rawCode;
    }
    if (rawCode === '例' || rawCode === '休') {
      return row[2] ? String(row[2]) : rawCode;
    }
    if (rawCode === '國' && day != null) {
      // 精確比對當天是否為假日
      const colName = getHolidayColName(year, month, day);
      if (colName) {
        const colIdx = shiftCodeHeaders.findIndex(h => String(h).trim() === colName);
        if (colIdx !== -1 && row[colIdx + 1] != null) return String(row[colIdx + 1]);
      }
      // Fallback：非假日當天的「國」（補休調整），用同月貪婪配對決定歸屬哪個假日
      const assignedCol = getAmbiguousHolidayMap(emp.id).get(dateKey(year, month, day));
      if (assignedCol) {
        const colIdx = shiftCodeHeaders.findIndex(h => String(h).trim() === assignedCol);
        if (colIdx !== -1 && row[colIdx + 1] != null) return String(row[colIdx + 1]);
      }
      return rawCode;
    }
    return rawCode;
  }, [shiftTypes, shiftCodeRows, shiftCodeHeaders, getHolidayColName, getAmbiguousHolidayMap, openHolidays, selectedYear, selectedMonth]);

  // 「國」→ 假日短名（不依班別，只依日期與 openHolidays）
  const getHolidayLabel = useCallback((day, month = selectedMonth, year = selectedYear) => {
    const key = `${year}-${month}-${day}`;
    if (!openHolidays.includes(key)) return null;
    const h = NATIONAL_HOLIDAYS.find(x => x.year === year && x.month === month && x.day === day);
    if (!h) return null;
    if (h.name === '春節') {
      const springDays = NATIONAL_HOLIDAYS
        .filter(x => x.year === year && x.name === '春節')
        .sort((a, b) => a.month !== b.month ? a.month - b.month : a.day - b.day);
      const idx = springDays.findIndex(x => x.month === month && x.day === day);
      return getHolidayShort(h, idx);
    }
    return getHolidayShort(h, 0);
  }, [openHolidays, selectedYear, selectedMonth]);

  const days = getDaysInMonth(selectedYear, selectedMonth);
  const [showConverted, setShowConverted] = useState(false);
  const [nameSearch, setNameSearch] = useState('');
  const [checkedEmpIds, setCheckedEmpIds] = useState(new Set());
  const importFileRef = useRef();

  // 功能按鈕收合狀態：手機預設收合以節省畫面，桌機預設展開
  const [toolsOpen, setToolsOpen] = useState(() =>
    typeof window === 'undefined' ? true : window.innerWidth >= 768);

  // rangeMode 下的視圖平移（天數偏移）
  const [viewOffset, setViewOffset] = useState(0);
  // 待該課別的開放區間就緒後，切到包含今天的週期
  // 已選課別若有自訂開放區間，畫面與公告一律以該課別為準
  const selectedDeptName = useMemo(() => {
    if (!selectedDept) return null;
    const wh = warehouses.find(w => w.id === selectedWarehouse);
    return wh?.departments?.find(d => d.id === selectedDept)?.name ?? null;
  }, [warehouses, selectedWarehouse, selectedDept]);
  // 橫幅顯示的區間：該課全部段落的聯集（各組別可能不同，此處僅供概覽）
  const activeRange = useMemo(
    () => visibleRangeOfGroup(segmentsOf(deptSegments, deptRanges, deptLocks, selectedDeptName), undefined),
    [deptSegments, deptRanges, deptLocks, selectedDeptName]);
  // 班表顯示哪些日子由「每期日期區間」決定，與可否編輯無關
  const viewPeriod = periodRange;

  const rangeKeyRef = useRef(null);
  useEffect(() => {
    if (!viewPeriod.start || !viewPeriod.end) return;
    // 每期區間改變時重新定位到今天所在的那一期
    const key = `${viewPeriod.start}~${viewPeriod.end}`;
    if (rangeKeyRef.current === key) return;
    rangeKeyRef.current = key;
    setViewOffset(todayPeriodOffset(viewPeriod));
  }, [viewPeriod]);
  // 今日所在欄位以紅框標示，方便在長班表中快速定位
  // 今日整欄的紅框以行內樣式套用：格子本身已有 border-r border-slate-100，
  // 用 Tailwind 的 border-red-500 會因產生順序不同而不一定勝出
  const TODAY_LINE = '2px solid #ef4444';
  const todayDk = (() => {
    const d = new Date();
    return dateKey(d.getFullYear(), d.getMonth() + 1, d.getDate());
  })();

  const rangeMode = !!(viewPeriod.start && viewPeriod.end);
  const viewRange = useMemo(() => {
    if (!rangeMode) return null;
    const s = parseLocal(viewPeriod.start);
    const e = parseLocal(viewPeriod.end);
    const len = Math.round((e - s) / 86400000); // 首尾天數差（不含尾）
    const shift = viewOffset * (len + 1); // +1：含頭含尾的完整天數，避免下一期與前一期重疊
    const vs = new Date(s); vs.setDate(vs.getDate() + shift);
    const ve = new Date(e); ve.setDate(ve.getDate() + shift);
    const fmt = d => `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
    return { start: fmt(vs), end: fmt(ve), len };
  }, [rangeMode, viewPeriod, viewOffset]);

  const toggleCheck = (empId) =>
    setCheckedEmpIds(prev => {
      const next = new Set(prev);
      next.has(empId) ? next.delete(empId) : next.add(empId);
      return next;
    });

  const toggleCheckAll = () => {
    const allIds = visibleEmployees.map(e => e.id);
    const allChecked = allIds.every(id => checkedEmpIds.has(id));
    setCheckedEmpIds(allChecked ? new Set() : new Set(allIds));
  };

  const resetChecked = () => {
    if (checkedEmpIds.size === 0) return;
    // 這是系統中唯一會一次覆蓋整段區間的操作，誤按等同抹掉這些人的排休，
    // 故明確告知影響範圍後才執行。
    const first = dayHeaders[0]?.dk, last = dayHeaders[dayHeaders.length - 1]?.dk;
    if (!window.confirm(
      `將把 ${checkedEmpIds.size} 位人員在 ${first} ～ ${last} 的班表全部重設為「V（上班）」，\n` +
      `已排的休假、例假、國定假日都會被覆蓋。確定執行？`)) return;
    setSchedule(prev => {
      const next = { ...prev };
      checkedEmpIds.forEach(empId => {
        const row = { ...next[empId] };
        dayHeaders.forEach(({ dk }) => { row[dk] = 'V'; });
        next[empId] = row;
      });
      return next;
    });
    setCheckedEmpIds(new Set());
    toast(`已重置 ${checkedEmpIds.size} 位人員的班表`, 'success');
  };

  // 表頭排序：col 為 null 時使用預設排序（廠商→班別→姓名），dir 1=遞增 -1=遞減
  const [sort, setSort] = useState({ col: null, dir: 1 });
  const toggleSort = (col) => setSort(prev =>
    prev.col !== col ? { col, dir: 1 }
    : prev.dir === 1 ? { col, dir: -1 }
    : { col: null, dir: 1 });   // 第三次點回到預設排序

  const visibleEmployees = useMemo(() => {
    // 委外人員只能看自己
    if (currentUser.role === ROLES.WORKER) {
      return employees.filter(e => e.id === currentUser.employeeId);
    }
    let list = currentUser.role === ROLES.VENDOR
      ? employees.filter(e => currentUser.vendors.includes(e.vendor))
      : employees.filter(e => e.vendor && e.vendor.trim() !== '');
    list = filterByScope(list, warehouses, selectedWarehouse, selectedDept, selectedGroup, selectedWorkArea);
    if (selectedVendor) list = list.filter(e => e.vendor === selectedVendor);
    if (nameSearch.trim()) {
      const q = nameSearch.trim().toLowerCase();
      list = list.filter(e =>
        (e.name ?? '').toLowerCase().includes(q) ||
        (e.empId ?? '').toLowerCase().includes(q)
      );
    }
    // 預設排序：廠商（現場慣用順序）→ 班別上班時間由早到晚 → 姓名
    // 沒設定班別的人排在該廠商最後（startTime 視為最大值）
    const startOf = (e) => {
      if (!e.shiftTypeId) return 9999;
      const st = findShiftType(shiftTypesByWh, selectedWarehouse ?? 'default', e.shiftTypeId);
      const n = Number(st?.startTime);
      return Number.isFinite(n) ? n : 9999;
    };
    const byDefault = (a, b) =>
      vendorRank(a.vendor) - vendorRank(b.vendor) ||
      (a.vendor ?? '').localeCompare(b.vendor ?? '', 'zh-Hant') ||
      startOf(a) - startOf(b) ||
      (a.name ?? '').localeCompare(b.name ?? '', 'zh-Hant');
    // 點表頭排序時，以該欄為主鍵，其餘沿用預設順序當次鍵（結果穩定、不會跳動）
    const primary = {
      name:   (a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'zh-Hant'),
      vendor: (a, b) => vendorRank(a.vendor) - vendorRank(b.vendor) ||
                        (a.vendor ?? '').localeCompare(b.vendor ?? '', 'zh-Hant'),
      shift:  (a, b) => startOf(a) - startOf(b),
    };
    if (!sort.col) return [...list].sort(byDefault);
    const cmp = primary[sort.col];
    return [...list].sort((a, b) => (cmp(a, b) * sort.dir) || byDefault(a, b));
  }, [employees, currentUser, warehouses, selectedWarehouse, selectedDept, selectedGroup, selectedWorkArea, selectedVendor, nameSearch, shiftTypesByWh, sort]);

  /** 計算當週某代碼出現次數（週一～週日） */
  const getWeeklyCode = useCallback((empId, dk, code) => {
    const [y, m, d] = dk.split('-').map(Number);
    const base = new Date(y, m - 1, d);
    // getDay(): 0=日,1=一,...,6=六 → 轉為週一=0,...,週日=6
    const dowMon = (base.getDay() + 6) % 7;
    let count = 0;
    for (let offset = -dowMon; offset <= 6 - dowMon; offset++) {
      const cur = new Date(y, m - 1, d + offset);
      const k = dateKey(cur.getFullYear(), cur.getMonth() + 1, cur.getDate());
      if (schedule[empId]?.[k] === code) count++;
    }
    return count;
  }, [schedule]);

  /** 委外幹部：計算當週例假數 */
  const getWeeklyLeaves = useCallback((empId, dk) => getWeeklyCode(empId, dk, '例'), [getWeeklyCode]);

  /** 計算當週休假日數（'休'） */
  const getWeeklyRest = useCallback((empId, dk) => getWeeklyCode(empId, dk, '休'), [getWeeklyCode]);

  /** 本期已使用的休假日數（休＋例合計），excludeDk 為正在點選的當天，不計入。
   *  dayHeaders 宣告在本函式之後，故透過 ref 取用（本函式只在點擊事件中呼叫，
   *  此時 ref 必然已填入當次 render 的值）。 */
  const dayHeadersRef = useRef([]);
  const getPeriodRestUsed = useCallback((empId, excludeDk) => {
    const row = schedule[empId] ?? {};
    return dayHeadersRef.current.reduce((n, h) => {
      if (h.dk === excludeDk) return n;
      return (row[h.dk] === '休' || row[h.dk] === '例') ? n + 1 : n;
    }, 0);
  }, [schedule]);

  // 鎖定與開放區間以「課別 → 多段區間」為單位：同一課的不同組別、不同期間
  // 可以有各自的鎖定模式（例如上一期部分鎖定、新的一期開放委外自行排休）。
  // 未被任何一段涵蓋的日期＝尚未開放，任何角色都不可編輯。
  // 快速解鎖：日翊／管理員輸入密碼後，暫時略過鎖定與區間限制（僅影響本機這次操作）
  // 各廠商明細預設收合，需要時再展開，避免統計列佔掉太多畫面
  const [showVendorRows, setShowVendorRows] = useState(false);
  const [unlockUntil, setUnlockUntil] = useState(0);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const canUnlock = currentUser?.role === ROLES.ADMIN || currentUser?.role === ROLES.AREA;
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (unlockUntil <= Date.now()) return;
    const id = setInterval(() => forceTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [unlockUntil]);
  const unlocked = canUnlock && unlockUntil > Date.now();
  const unlockLeft = unlocked ? Math.ceil((unlockUntil - Date.now()) / 60000) : 0;

  const isEditable = useCallback((dk, emp) => {
    if (unlocked) return true;   // 解鎖期間不受課別鎖定與開放區間限制
    const segs = segmentsOf(deptSegments, deptRanges, deptLocks, emp?.dept);
    if (segs.length === 0) return false;
    return canEditBySegments(segs, emp?.group, dk, currentUser?.role);
  }, [unlocked, deptSegments, deptRanges, deptLocks, currentUser]);

  // 需求人數以「課別｜組別｜日期」為單位記錄——各組別各自一份，互不影響。
  // 只有同時選定課別與組別時才可編輯；選「全部組別」時顯示該範圍各組的合計（唯讀）。
  const demandKey = useCallback((dept, group, dk) => [dept, group, dk].join('|'), []);
  // 需求人數僅日翊／管理員可編輯：委外端的寫入會被伺服器忽略，不能讓他們以為改得動
  const canEditDemand = !!(selectedDeptName && selectedGroup) &&
    (currentUser?.role === ROLES.ADMIN || currentUser?.role === ROLES.AREA);

  // 目前篩選範圍涵蓋哪些「課別＋組別」，用於未選組別時加總
  const scopePairs = useMemo(() => {
    const wh = warehouses.find(w => w.id === selectedWarehouse);
    const depts = selectedDeptName
      ? (wh?.departments ?? []).filter(d => d.name === selectedDeptName)
      : (wh ? (wh.departments ?? []) : warehouses.flatMap(w => w.departments ?? []));
    const pairs = [];
    for (const d of depts) {
      for (const g of (d.groups ?? [])) {
        if (selectedGroup && g !== selectedGroup) continue;
        pairs.push([d.name, g]);
      }
    }
    return pairs;
  }, [warehouses, selectedWarehouse, selectedDeptName, selectedGroup]);

  const demandOf = useCallback((dk) => {
    if (canEditDemand) return dailyDemand[demandKey(selectedDeptName, selectedGroup, dk)] ?? '';
    // 未選到單一組別：顯示範圍內各組別的合計
    let sum = 0, any = false;
    for (const [dept, group] of scopePairs) {
      const v = dailyDemand[demandKey(dept, group, dk)];
      if (v !== undefined && v !== '') { sum += Number(v); any = true; }
    }
    return any ? String(sum) : '';
  }, [canEditDemand, dailyDemand, demandKey, selectedDeptName, selectedGroup, scopePairs]);

  const setDemand = useCallback((dk, raw) => {
    if (!canEditDemand) return;
    const v = String(raw).replace(/[^0-9]/g, '').slice(0, 4);
    setDailyDemand(prev => {
      const next = { ...prev };
      const k = demandKey(selectedDeptName, selectedGroup, dk);
      if (v === '') delete next[k];
      else next[k] = v;
      return next;
    });
  }, [canEditDemand, demandKey, selectedDeptName, selectedGroup, setDailyDemand]);

  // 連續輸入時用鍵盤在日期間移動，不必逐格點選
  const onDemandKey = useCallback((e) => {
    const move = e.key === 'Enter' || e.key === 'ArrowRight' ? (e.shiftKey ? -1 : 1)
               : e.key === 'ArrowLeft' ? -1 : 0;
    if (move === 0) return;
    e.preventDefault();
    const all = [...document.querySelectorAll('input[data-demand-dk]')];
    const i = all.indexOf(e.currentTarget);
    const next = all[i + move];
    if (next) { next.focus(); next.select?.(); next.scrollIntoView({ block: 'nearest', inline: 'center' }); }
  }, []);

  const handleCellClick = useCallback((empId, dk) => {
    const clickEmp = employees.find(e => e.id === empId);
    if (!isEditable(dk, clickEmp)) {
      // 區分兩種不可編輯的原因，否則使用者不知道該找誰處理
      const segs = segmentsOf(deptSegments, deptRanges, deptLocks, clickEmp?.dept)
        .filter(x => segCoversGroup(x, clickEmp?.group));
      toast(segs.length === 0
        ? `${clickEmp?.dept ?? '此課別'}${clickEmp?.group ? '／' + clickEmp.group : ''} 尚未設定開放排班區間，目前僅供查看。`
        : segs.some(x => segCoversDate(x, dk))
          ? '此日期已鎖定，無法修改。'
          : '此日期不在開放排班區間內，無法修改。', 'warn');
      return;
    }

    // M2：VENDOR 只能修改自己廠商的員工
    if (currentUser.role === ROLES.VENDOR) {
      const emp = employees.find(e => e.id === empId);
      if (!emp || !currentUser.vendors.includes(emp.vendor)) {
        toast('無權限修改此員工的班表。', 'error');
        return;
      }
    }

    // WORKER 嚴格限制在該課別的開放區間內（不隨 viewRange 放寬）
    const wEmp = employees.find(e => e.id === empId);
    const wRange = visibleRangeOfGroup(segmentsOf(deptSegments, deptRanges, deptLocks, wEmp?.dept), wEmp?.group);
    if (currentUser.role === ROLES.WORKER && wRange.start && wRange.end) {
      const [y, m, d] = dk.split('-').map(Number);
      const date = new Date(y, m - 1, d);
      const rs = parseLocal(wRange.start);
      const re = parseLocal(wRange.end);
      if (date < rs || date > re) {
        toast('此日期超出開放排班區間，無法修改。', 'warn');
        return;
      }
    }

    // M3：WORKER 只能修改自己那一列
    if (currentUser.role === ROLES.WORKER) {
      if (empId !== currentUser.employeeId) {
        toast('您只能修改自己的班表。', 'error');
        return;
      }
    }

    const current = schedule[empId]?.[dk] ?? '';
    // 可選代碼依角色決定：
    //   委外人員／委外幹部（含幫自己與幫他人排）一律只能在 V ↔ 休 之間切換，不可排「例」；
    //   「國」僅在系統設定開啟「委外幹部國定假日排班權限」時供委外幹部選用。
    //   最終排定仍由日翊員工負責，故 admin/area 維持完整循環。
    const isOutsourced = currentUser.role === ROLES.WORKER || currentUser.role === ROLES.VENDOR;
    let next;
    if (isOutsourced) {
      const allowed = ['V', '休'];
      if (currentUser.role === ROLES.VENDOR && vendorHolidayOpen) allowed.push('國');
      const i = allowed.indexOf(current);          // 目前是「例」等不可選代碼時 i=-1 → 回到 V
      next = allowed[(i + 1) % allowed.length];
    } else {
      const idx = SHIFT_CYCLE.indexOf(current);
      next = SHIFT_CYCLE[(idx + 1) % SHIFT_CYCLE.length];
    }

    // 「國」可排在本期內的任何一天（國定假日當天出勤、假挪到其他日是常態），
    // 但總數不得超過「本期已勾選的國定假日天數」。此規則與「一鍵轉換國」一致。
    if (next === '國') {
      const periodDks = dayHeadersRef.current.map(h => h.dk);
      const inPeriod = new Set(periodDks);
      const quota = openHolidays.filter(k => inPeriod.has(k)).length;
      if (quota === 0) {
        toast('本期沒有已勾選的國定假日，請先至「系統設定 → 開放排班國定假日」勾選。', 'warn');
        next = isOutsourced ? 'V' : SHIFT_CYCLE[(SHIFT_CYCLE.indexOf('國') + 1) % SHIFT_CYCLE.length];
      } else {
        const row = schedule[empId] ?? {};
        // 正在點的這一格不計入（它現在還不是「國」）
        const used = periodDks.filter(k => k !== dk && row[k] === '國').length;
        if (used >= quota) {
          toast(`國定假日天數已達上限（本期 ${quota} 天），請先取消其他「國」再排。`, 'error');
          return;
        }
      }
    }

    // 一週一例：僅日翊員工可排「例」，超額時自動改為「休」
    if (next === '例') {
      const existingLeaves = getWeeklyLeaves(empId, dk);
      const alreadyLeave = schedule[empId]?.[dk] === '例';
      if (!alreadyLeave && existingLeaves >= 1) {
        next = '休';
        toast('本週已有例休，自動改排休假（休）。', 'info');
      }
    }

    // 防呆：委外人員／委外幹部的休假上限
    //   預設兩者都是「每週一天」；系統設定各自有一個開關，
    //   開啟後該身分改為以「本期」為單位、休＋例合計 REST_QUOTA 天。
    if ((currentUser.role === ROLES.WORKER || currentUser.role === ROLES.VENDOR) && next === '休') {
      const alreadyRest = schedule[empId]?.[dk] === '休';
      const byPeriod = currentUser.role === ROLES.VENDOR ? vendorRestOpen : workerRestOpen;
      if (byPeriod) {
        const used = getPeriodRestUsed(empId, dk);
        if (!alreadyRest && used >= REST_QUOTA) {
          toast(`本期休假已達上限（${REST_QUOTA} 天，含例休）。`, 'error');
          return;
        }
      } else {
        const weeklyRest = getWeeklyRest(empId, dk);
        if (!alreadyRest && weeklyRest >= 1) {
          toast('每週只能選一天休假日，本週已達上限。', 'error');
          return;
        }
      }
    }

    setSchedule(prev => ({
      ...prev,
      [empId]: { ...prev[empId], [dk]: next },
    }));
  }, [schedule, employees, isEditable, currentUser, openHolidays, vendorHolidayOpen, vendorRestOpen, workerRestOpen, getWeeklyLeaves, getWeeklyRest, getPeriodRestUsed, setSchedule, toast]);

  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const years  = [2024, 2025, 2026, 2027];

  const exportScheduleRaw = () => {
    try {
      const colLabel = h => `${h.month}/${h.day}(${h.wd})`;
      const header = ['員工編號', '姓名', '廠商', ...dayHeaders.map(colLabel)];
      const rows = visibleEmployees.map(emp => {
        const dayCells = dayHeaders.map(({ dk }) => schedule[emp.id]?.[dk] ?? 'V');
        return [emp.empId ?? '', emp.name, emp.vendor ?? '', ...dayCells];
      });
      const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
      ws['!cols'] = [{ wch: 10 }, { wch: 12 }, { wch: 12 }, ...dayHeaders.map(() => ({ wch: 6 }))];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '班表');
      const label = rangeMode
        ? `${viewPeriod.start}~${viewPeriod.end}`
        : `${selectedYear}年${selectedMonth}月`;
      XLSX.writeFile(wb, `班表存檔_${label}.xlsx`);
      toast('班表存檔成功', 'success');
    } catch (err) {
      toast('存檔失敗：' + err.message, 'error');
    }
  };

  const exportConverted = () => {
    try {
      const colLabel = h => rangeMode ? `${h.month}/${h.day}(${h.wd})` : `${h.day}(${h.wd})`;
      const header = ['員工編號', '姓名', '廠商', ...dayHeaders.map(colLabel), '出勤天', '休假天'];
      const rows = visibleEmployees.map(emp => {
        let workDays = 0;
        let leaveDays = 0;
        const dayCells = dayHeaders.map(({ dk, day, month, year }) => {
          const raw = schedule[emp.id]?.[dk] ?? 'V';
          const holidayLabel = raw === '國' ? getHolidayLabel(day, month, year) : null;
          const sc = getDisplayCode(emp, raw, day, month, year);
          const display = (sc !== raw ? sc : null) ?? holidayLabel ?? raw;
          if (raw === 'V') workDays++;
          else if (raw === '休' || raw === '例' || raw === '國') leaveDays++;
          return display;
        });
        return [emp.empId ?? '', emp.name, emp.vendor ?? '', ...dayCells, workDays, leaveDays];
      });
      const aoa = [header, ...rows];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [{ wch: 10 }, { wch: 12 }, { wch: 12 }, ...dayHeaders.map(() => ({ wch: 5 })), { wch: 6 }, { wch: 6 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '班表');
      const label = rangeMode
        ? `${viewPeriod.start}~${viewPeriod.end}`
        : `${selectedYear}年${selectedMonth}月`;
      XLSX.writeFile(wb, `班表_代碼轉換_${label}.xlsx`);
      toast('代碼轉換匯出成功', 'success');
    } catch (err) {
      toast('匯出失敗：' + err.message, 'error');
    }
  };

  const handleImportSchedule = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        const headerRow = aoa[0] || [];

        // 自動偵測格式：
        // 格式A（系統匯出）: 員工編號/姓名/廠商/日期… → 員編col0，日期"7/13(一)"，資料row1起
        // 格式B（外部Excel）: 廠商/樓層/員編/姓名/日期… → 員編col2，日期"7/13"，資料row2起
        // 格式C（點名表）: 作業區/姓名/廠商/日期… → 用姓名+廠商對應，月在row0/日在row1，資料從第一個非空列起
        const h0 = String(headerRow[0]).trim();
        const isFormatA = h0 === '員工編號';
        const isFormatC = h0.includes('作業區') || headerRow[1] === '姓名';

        const baseYear  = rangeMode ? parseInt(viewPeriod.start.split('-')[0]) : selectedYear;
        const baseMonth = rangeMode ? parseInt(viewPeriod.start.split('-')[1]) : selectedMonth;
        const getYear   = (month) => (month < baseMonth - 6 ? baseYear + 1 : baseYear);

        const mapVal = (v) => {
          const s = String(v ?? '').trim();
          if (s === 'V') return 'V';
          if (s === '例' || s === '(例)') return '例';
          if (s === '休' || s === '(休)') return '休';
          if (s === '國') return '國';
          if (s === '' || s === '-') return null;
          if (/^\d+$/.test(s)) return 'V';
          return null;
        };

        // 建立查找表：empId → emp（格式A/B）；name+vendor → emp（格式C）
        const empMap = {}, nameMap = {};
        employees.forEach(emp => {
          if (emp.empId) empMap[emp.empId] = emp;
          const key = `${emp.name}|${emp.vendor ?? ''}`;
          nameMap[key] = emp;
          nameMap[emp.name] = emp; // 僅姓名也可匹配
        });

        let dateCols = [], empIdCol = 2, dataStart = 2;

        if (isFormatC) {
          // 格式C：月份在row0 col3+，日期在row1 col3+
          // 修正 Excel 跨欄標題問題：月份提早一格，導致讀到如 8/31（應為 7/31）
          // 規則：月份遞增但日期未重置回 1~7，視為仍是上個月
          const row1 = aoa[1] || [];
          let prevMo = null;
          for (let c = 3; c < headerRow.length; c++) {
            const mo = parseInt(String(headerRow[c]).trim());
            const dy = parseInt(String(row1[c] ?? '').trim());
            if (!isNaN(mo) && !isNaN(dy) && mo >= 1 && mo <= 12 && dy >= 1 && dy <= 31) {
              const effectiveMo = (prevMo !== null && mo === prevMo + 1 && dy > 7) ? prevMo : mo;
              dateCols.push({ col: c, month: effectiveMo, day: dy });
              prevMo = effectiveMo;
            }
          }
          // 資料從第一個姓名非空的列起（跳過空白列）
          dataStart = aoa.findIndex((row, i) => i >= 3 && String(row[1] ?? '').trim() !== '');
          if (dataStart < 0) dataStart = 4;
        } else {
          empIdCol  = isFormatA ? 0 : 2;
          dataStart = isFormatA ? 1 : 2;
          for (let c = isFormatA ? 3 : 4; c < headerRow.length; c++) {
            const h = String(headerRow[c]).trim();
            const m = h.match(/^(\d{1,2})\/(\d{1,2})/);
            if (m) dateCols.push({ col: c, month: parseInt(m[1]), day: parseInt(m[2]) });
          }
        }

        if (dateCols.length === 0) { toast('找不到日期欄位', 'error'); return; }

        // 開放排班日期區間限制（與手動點格子編輯的 isEditable 規則一致）
        const rangeStart = activeRange.start ? parseLocal(activeRange.start) : null;
        const rangeEnd   = activeRange.end   ? parseLocal(activeRange.end)   : null;
        const inRange = (month, day) => {
          if (!rangeStart || !rangeEnd) return true;
          const d = new Date(getYear(month), month - 1, day);
          return d >= rangeStart && d <= rangeEnd;
        };

        const updates = {};
        let updatedCells = 0;
        let skippedOutOfRange = 0;
        const unmatchedIds = [];
        for (let r = dataStart; r < aoa.length; r++) {
          const row = aoa[r];
          let emp = null, identifier = '';
          if (isFormatC) {
            const name   = String(row[1] ?? '').trim();
            const vendor = String(row[2] ?? '').trim();
            if (!name) continue;
            emp = nameMap[`${name}|${vendor}`] ?? nameMap[name] ?? null;
            identifier = vendor ? `${name}（${vendor}）` : name;
          } else {
            const empId = String(row[empIdCol] ?? '').trim();
            if (!empId) continue;
            emp = empMap[empId] ?? null;
            identifier = empId;
          }
          if (!emp) { unmatchedIds.push(identifier); continue; }
          if (!updates[emp.id]) updates[emp.id] = {};
          const weekExCount = {};
          for (const { col, month, day } of dateCols) {
            if (!inRange(month, day)) { skippedOutOfRange++; continue; }
            let val = mapVal(row[col]);
            if (val === '例') {
              const d = new Date(getYear(month), month - 1, day);
              const dow = (d.getDay() + 6) % 7; // 0=Mon
              const mon = new Date(d); mon.setDate(day - dow);
              const wk = `${mon.getFullYear()}-${mon.getMonth()+1}-${mon.getDate()}`;
              const cnt = weekExCount[wk] ?? 0;
              if (cnt >= 1) val = '休';
              weekExCount[wk] = cnt + 1;
            }
            if (val !== null) {
              updates[emp.id][dateKey(getYear(month), month, day)] = val;
              updatedCells++;
            }
          }
        }

        const skippedEmps = unmatchedIds.length;
        const unmatchedDetail = skippedEmps > 0
          ? `（未匹配：${unmatchedIds.slice(0, 10).join('、')}${unmatchedIds.length > 10 ? `…等${unmatchedIds.length}筆` : ''}）`
          : '';

        // 若整份檔案的日期都不在開放排班區間內，直接視為匯入失敗
        if (skippedOutOfRange > 0 && updatedCells === 0) {
          toast(`匯入失敗：檔案日期不在開放排班區間內（${activeRange.start}～${activeRange.end}）`, 'error');
          return;
        }
        if (Object.keys(updates).length === 0) {
          toast(`找不到符合員工編號的資料${unmatchedDetail}`, 'error');
          return;
        }
        setSchedule(prev => {
          const next = { ...prev };
          Object.entries(updates).forEach(([id, days]) => { next[id] = { ...next[id], ...days }; });
          return next;
        });
        toast(`匯入完成：${Object.keys(updates).length} 位員工、${updatedCells} 格班表已更新${skippedOutOfRange > 0 ? `，${skippedOutOfRange} 格超出開放排班區間已略過` : ''}${skippedEmps > 0 ? `，${skippedEmps} 筆員編未匹配${unmatchedDetail}` : ''}`, 'success');
      } catch (err) {
        toast('匯入失敗：' + err.message, 'error');
      }
    };
    reader.readAsBinaryString(file);
  };

  // 一週一例修正：掃描現有班表，每週超過一天「例」的降格為「休」
  const handleFixWeeklyEx = useCallback(() => {
    let fixedCount = 0;
    const updates = {};
    visibleEmployees.forEach(emp => {
      const empSchedule = schedule[emp.id];
      if (!empSchedule) return;
      // 收集所有例/休日，依日期排序
      const offDays = Object.entries(empSchedule)
        .filter(([, code]) => code === '例' || code === '休')
        .map(([dk, code]) => {
          const [y, m, d] = dk.split('-').map(Number);
          return { dk, code, ts: new Date(y, m - 1, d).getTime() };
        })
        .sort((a, b) => a.ts - b.ts);
      // 依週（週一為起點）分組
      const weekMap = {};
      offDays.forEach(({ dk, code, ts }) => {
        const date = new Date(ts);
        const dow = (date.getDay() + 6) % 7; // Mon=0, Sun=6
        const mon = new Date(ts);
        mon.setDate(date.getDate() - dow);
        const wk = `${mon.getFullYear()}-${mon.getMonth()+1}-${mon.getDate()}`;
        if (!weekMap[wk]) weekMap[wk] = [];
        weekMap[wk].push({ dk, code });
      });
      const ns = { ...empSchedule };
      let empFixed = false;
      Object.values(weekMap).forEach(days => {
        const exDays  = days.filter(d => d.code === '例');
        const restDays = days.filter(d => d.code === '休');
        if (exDays.length > 1) {
          // 週內超過1個例 → 保留第1個，其餘改休
          exDays.slice(1).forEach(({ dk }) => { ns[dk] = '休'; fixedCount++; empFixed = true; });
        } else if (exDays.length === 0 && restDays.length > 0) {
          // 週內無例但有休 → 最後一個休（週日位置）改為例
          const last = restDays[restDays.length - 1];
          ns[last.dk] = '例'; fixedCount++; empFixed = true;
        }
      });
      if (empFixed) updates[emp.id] = ns;
    });
    if (fixedCount === 0) { toast('無需修正，所有員工每週已有一天例假。', 'info'); return; }
    setSchedule(prev => {
      const next = { ...prev };
      Object.entries(updates).forEach(([id, days]) => { next[id] = days; });
      return next;
    });
    toast(`已修正 ${fixedCount} 個格位：每週指定一天例假，其餘休息改為休假。`, 'success');
  }, [visibleEmployees, schedule, setSchedule, toast]);

  // 一鍵轉換「國」：校正排班週期內的國定假日標記
  // 規則：每週正常為 1例+1休，超出 2 天的部分視為多排；優先轉「休」保留「例」（法定例假）；
  //      與週期內的國定假日一對一配對，每人最終恰好保有「國定假日天數」天「國」——
  //      不足者補標、超過者改回「休」，因此可重複執行且結果一致
  // 注意：不可用 useCallback —— 相依陣列會在渲染當下就存取 dayHeaders，
  // 而 dayHeaders 於本函式之後才宣告，會觸發 TDZ（Cannot access before initialization）
  const handleConvertHolidays = () => {
    const rangeKeys = new Set(dayHeaders.map(h => h.dk));
    const inRange = (y, m, d) => rangeKeys.has(dateKey(y, m, d));
    // 以系統設定的「開放排班國定假日」為準；未設定則取週期內所有國定假日
    let hols = openHolidays
      .map(k => k.split('-').map(Number))
      .filter(([y, m, d]) => inRange(y, m, d))
      .map(([y, m, d]) => new Date(y, m - 1, d).getTime());
    if (hols.length === 0) {
      hols = NATIONAL_HOLIDAYS
        .filter(h => inRange(h.year, h.month, h.day))
        .map(h => new Date(h.year, h.month - 1, h.day).getTime());
    }
    if (hols.length === 0) { toast('目前排班週期內沒有國定假日，無需轉換。', 'info'); return; }
    const minDist = ts => Math.min(...hols.map(t => Math.abs(t - ts)));

    let converted = 0, affected = 0;
    const updates = {};
    // 記錄未轉換者的原因，讓使用者知道是「不需要轉」還是「轉不了」
    const skipped = { noSchedule: [], full: [], noSurplus: [], partial: [] };
    visibleEmployees.forEach(emp => {
      const empSchedule = schedule[emp.id];
      if (!empSchedule) { skipped.noSchedule.push(emp.name); return; }
      // 週期內已排定的「國」一律不異動，僅計入額度；已排滿就跳過此人
      const existingGuo = dayHeaders.filter(h => empSchedule[h.dk] === '國');
      const quota = hols.length - existingGuo.length;
      if (quota <= 0) { skipped.full.push(emp.name); return; }
      // 取週期內的休/例/國（既有的「國」納入每週休假日計算，避免重複多排）
      const offDays = dayHeaders
        .map(h => ({
          dk: h.dk,
          code: empSchedule[h.dk],
          ts: new Date(h.year, h.month - 1, h.day).getTime(),
        }))
        .filter(x => x.code === '休' || x.code === '例' || x.code === '國');
      // 依週分組（週一為起點）
      const weekMap = {};
      offDays.forEach(o => {
        const date = new Date(o.ts);
        const dow = (date.getDay() + 6) % 7;
        const mon = new Date(o.ts); mon.setDate(date.getDate() - dow);
        const wk = `${mon.getFullYear()}-${mon.getMonth() + 1}-${mon.getDate()}`;
        if (!weekMap[wk]) weekMap[wk] = [];
        weekMap[wk].push(o);
      });
      // 每週超出 2 天（1例+1休）的部分視為多排；已排定的「國」也算休假日並佔用該週的超出額度
      // 候選只取「休」：例假為法定須保留、已排定的「國」不異動
      const candidates = [];
      Object.values(weekMap).forEach(days => {
        const surplus = days.length - 2;
        const alreadyGuo = days.filter(x => x.code === '國').length;
        const canConvert = surplus - alreadyGuo;
        if (canConvert <= 0) return;
        candidates.push(...days
          .filter(x => x.code === '休')
          .sort((a, b) => minDist(a.ts) - minDist(b.ts))
          .slice(0, canConvert));
      });
      if (candidates.length === 0) { skipped.noSurplus.push(emp.name); return; }
      // 與「尚未被既有國用掉」的國定假日一對一貪婪配對，且不超過剩餘額度
      const usedHolTs = new Set(existingGuo.map(h => new Date(h.year, h.month - 1, h.day).getTime()));
      const remainCand = [...candidates];
      const remainHol = hols.filter(ts => !usedHolTs.has(ts));
      const picked = [];
      while (remainCand.length > 0 && remainHol.length > 0 && picked.length < quota) {
        let best = null;
        remainCand.forEach(c => remainHol.forEach(h => {
          const dist = Math.abs(h - c.ts);
          if (!best || dist < best.dist) best = { c, h, dist };
        }));
        picked.push(best.c);
        remainCand.splice(remainCand.indexOf(best.c), 1);
        remainHol.splice(remainHol.indexOf(best.h), 1);
      }
      if (picked.length === 0) { skipped.noSurplus.push(emp.name); return; }
      if (picked.length < quota) skipped.partial.push(`${emp.name}(${picked.length}/${quota})`);
      const ns = { ...empSchedule };
      picked.forEach(({ dk }) => { ns[dk] = '國'; converted++; });
      updates[emp.id] = ns;
      affected++;
    });

    // 組出未轉換原因說明（僅列前 8 位，避免訊息過長）
    const cut = arr => arr.slice(0, 8).join('、') + (arr.length > 8 ? `…共 ${arr.length} 人` : '');
    const reasons = [];
    if (skipped.noSurplus.length)
      reasons.push(`每週休假未超過 2 天、無多排的「休」可轉：${cut(skipped.noSurplus)}`);
    if (skipped.full.length)
      reasons.push(`「國」已排滿 ${hols.length} 天：${cut(skipped.full)}`);
    if (skipped.partial.length)
      reasons.push(`可轉天數不足額度：${cut(skipped.partial)}`);
    if (skipped.noSchedule.length)
      reasons.push(`查無班表資料：${cut(skipped.noSchedule)}`);

    if (converted === 0) {
      toast(`未轉換任何一天。原因：${reasons.join('；') || '目前畫面沒有可處理的人員'}`, 'info');
      return;
    }
    setSchedule(prev => {
      const next = { ...prev };
      Object.entries(updates).forEach(([id, days]) => { next[id] = days; });
      return next;
    });
    toast(`已補排 ${converted} 格「國」（${affected} 位人員，每人上限 ${hols.length} 天）；原已排定的「國」未異動`
      + (reasons.length ? `。未轉換者：${reasons.join('；')}` : ''), 'success');
  };

  // 下載匯入班表範本（Format C：作業區/姓名/廠商 + 月/日/星期 三列表頭）
  const handleDownloadTemplate = () => {
    try {
      const WD = ['日','一','二','三','四','五','六'];
      // 取得目前視圖的日期區間
      let dates = [];
      if (rangeMode && viewRange) {
        const cur = parseLocal(viewRange.start);
        const end = parseLocal(viewRange.end);
        while (cur <= end) {
          dates.push({ y: cur.getFullYear(), m: cur.getMonth()+1, d: cur.getDate(), wd: WD[cur.getDay()] });
          cur.setDate(cur.getDate()+1);
        }
      } else {
        const daysCount = getDaysInMonth(selectedYear, selectedMonth);
        for (let i = 1; i <= daysCount; i++) {
          const dt = new Date(selectedYear, selectedMonth-1, i);
          dates.push({ y: selectedYear, m: selectedMonth, d: i, wd: WD[dt.getDay()] });
        }
      }
      const row1 = ['作業區(非必填)', '*姓名', '*廠商', ...dates.map(dt => dt.m)];
      const row2 = ['', '', '', ...dates.map(dt => dt.d)];
      const row3 = ['', '', '', ...dates.map(dt => dt.wd)];
      const aoa  = [row1, row2, row3];

      const ws = XLSX.utils.aoa_to_sheet(aoa);
      // 欄寬
      ws['!cols'] = [{ wch: 14 }, { wch: 12 }, { wch: 14 }, ...dates.map(() => ({ wch: 4 }))];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '總表');

      const label = rangeMode && viewRange
        ? `${viewRange.start.replace(/-/g,'')}-${viewRange.end.replace(/-/g,'')}`
        : `${selectedYear}${String(selectedMonth).padStart(2,'0')}`;
      XLSX.writeFile(wb, `匯入班表範本_${label}.xlsx`);
      toast('範本已下載', 'success');
    } catch (err) {
      toast('下載範本失敗：' + err.message, 'error');
    }
  };

  // Weekday headers — range mode spans across months, uses viewRange for navigation
  const dayHeaders = useMemo(() => {
    if (rangeMode && viewRange) {
      const start = parseLocal(viewRange.start);
      const end   = parseLocal(viewRange.end);
      const result = [];
      const cur = new Date(start);
      while (cur <= end) {
        const y  = cur.getFullYear(), m = cur.getMonth() + 1, d = cur.getDate();
        const wd = ['日','一','二','三','四','五','六'][cur.getDay()];
        result.push({
          day: d, month: m, year: y,
          dk: dateKey(y, m, d),
          wd, isWeekend: cur.getDay() === 0 || cur.getDay() === 6,
          isMonthStart: d === 1,
        });
        cur.setDate(cur.getDate() + 1);
      }
      return result;
    }
    return Array.from({ length: days }, (_, i) => {
      const d = new Date(selectedYear, selectedMonth - 1, i + 1);
      const wd = ['日','一','二','三','四','五','六'][d.getDay()];
      return {
        day: i + 1, month: selectedMonth, year: selectedYear,
        dk: dateKey(selectedYear, selectedMonth, i + 1),
        wd, isWeekend: d.getDay() === 0 || d.getDay() === 6,
        isMonthStart: i === 0,
      };
    });
  }, [days, selectedYear, selectedMonth, rangeMode, viewRange]);
  dayHeadersRef.current = dayHeaders;


  // 列印班表報表（依目前週期/月份，景印格式）
  const handlePrintReport = useCallback(() => {
    const periodLabel = rangeMode && viewRange
      ? `${viewRange.start} ～ ${viewRange.end}`
      : `${selectedYear} 年 ${selectedMonth} 月`;

    const scopeParts = [];
    if (selectedWarehouse) {
      const wh = warehouses.find(w => w.id === selectedWarehouse);
      if (wh) scopeParts.push(wh.name);
    }
    if (selectedDept) scopeParts.push(selectedDept);
    if (selectedGroup) scopeParts.push(selectedGroup);
    const scopeLabel = scopeParts.length > 0 ? scopeParts.join(' › ') : '全部';

    const today = new Date();
    const printDate = `${today.getFullYear()}/${today.getMonth()+1}/${today.getDate()}`;

    const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

    const CODE_BG  = { V: '#dcfce7', 例: '#fef9c3', 休: '#ffedd5', 國: '#dbeafe' };
    const CODE_FG  = { V: '#166534', 例: '#854d0e', 休: '#9a3412', 國: '#1e40af' };
    const WARN_BG  = '#fce7f3'; const WARN_FG = '#9d174d';

    // Group by vendor
    const vendorOrder = [];
    const vendorMap = {};
    visibleEmployees.forEach(emp => {
      const v = emp.vendor ?? '（未設定廠商）';
      if (!vendorMap[v]) { vendorMap[v] = []; vendorOrder.push(v); }
      vendorMap[v].push(emp);
    });

    const colLabel = h => rangeMode ? `${h.month}/${h.day}<br>(${h.wd})` : `${h.day}<br>(${h.wd})`;

    const buildRows = (emps) => emps.map(emp => {
      let workDays = 0, leaveDays = 0;
      const warnSet = new Set();
      let run = [];
      for (const { dk } of dayHeaders) {
        if ((schedule[emp.id]?.[dk] ?? 'V') === 'V') { run.push(dk); }
        else { if (run.length >= 6) run.forEach(k => warnSet.add(k)); run = []; }
      }
      if (run.length >= 6) run.forEach(k => warnSet.add(k));

      const cells = dayHeaders.map(({ dk, day, month, year, isWeekend, isMonthStart }) => {
        const code = schedule[emp.id]?.[dk] ?? 'V';
        if (code === 'V') workDays++;
        else if (code === '休' || code === '例' || code === '國') leaveDays++;
        const holidayLabel = code === '國' ? getHolidayLabel(day, month, year) : null;
        const displayCode = showConverted
          ? (() => {
              const sc = getDisplayCode(emp, code, day, month, year);
              return (sc !== code ? sc : null) ?? holidayLabel ?? code;
            })()
          : (SHIFT_CODES[code]?.label || code); // 「國」固定顯示「國」
        const isWarn = warnSet.has(dk);
        const bg = isWarn ? WARN_BG : (CODE_BG[code] ?? '#ffffff');
        const fg = isWarn ? WARN_FG : (CODE_FG[code] ?? '#6b7280');
        const dimFilter = isWeekend ? 'filter:brightness(0.93);' : '';
        const borderL = rangeMode && isMonthStart && month !== dayHeaders[0]?.month ? 'border-left:2px solid #60a5fa;' : '';
        return `<td style="background:${bg};color:${fg};text-align:center;padding:2px 1px;font-size:10px;border:1px solid #e2e8f0;${dimFilter}${borderL}">${esc(displayCode) || '·'}</td>`;
      });
      return { name: emp.name, empId: emp.empId ?? '', cells, workDays, leaveDays };
    });

    let bodyHtml = '';
    vendorOrder.forEach(vendor => {
      const emps = vendorMap[vendor];
      const rows = buildRows(emps);
      bodyHtml += `<tr><td colspan="${2 + dayHeaders.length + 2}" style="background:#1e40af;color:#fff;font-size:11px;font-weight:bold;padding:3px 6px;">${esc(vendor)}（${emps.length} 人）</td></tr>`;
      rows.forEach((r, ri) => {
        const rowBg = ri % 2 === 0 ? '#ffffff' : '#f8fafc';
        bodyHtml += `<tr style="background:${rowBg}">
          <td style="padding:2px 5px;font-size:10px;border:1px solid #e2e8f0;white-space:nowrap;">${esc(r.name)}</td>
          <td style="padding:2px 5px;font-size:9px;color:#64748b;border:1px solid #e2e8f0;white-space:nowrap;">${esc(r.empId)}</td>
          ${r.cells.join('')}
          <td style="text-align:center;padding:2px 4px;font-size:10px;font-weight:600;color:#1d4ed8;border:1px solid #e2e8f0;">${r.workDays}</td>
          <td style="text-align:center;padding:2px 4px;font-size:10px;font-weight:600;color:#ea580c;border:1px solid #e2e8f0;">${r.leaveDays}</td>
        </tr>`;
      });
    });

    const colHeadersHtml = dayHeaders.map(h => {
      const wkStyle = h.isWeekend ? 'background:#fef2f2;color:#dc2626;' : '';
      return `<th style="text-align:center;padding:2px 1px;font-size:9px;min-width:20px;border:1px solid #334155;${wkStyle}">${colLabel(h)}</th>`;
    }).join('');

    const legendItems = [
      { code: 'V',  bg: CODE_BG.V,  fg: CODE_FG.V,  label: '上班' },
      { code: '例', bg: CODE_BG.例, fg: CODE_FG.例, label: '例休' },
      { code: '休', bg: CODE_BG.休, fg: CODE_FG.休, label: '休假' },
      { code: '國', bg: CODE_BG.國, fg: CODE_FG.國, label: '國定假日' },
      { code: 'V',  bg: WARN_BG,   fg: WARN_FG,    label: '連上6天(警示)' },
    ];
    const legendHtml = legendItems.map(({ code, bg, fg, label }) =>
      `<span style="display:inline-flex;align-items:center;gap:3px;margin-right:12px;font-size:10px;">
        <span style="display:inline-block;width:15px;height:15px;background:${bg};color:${fg};border:1px solid #cbd5e1;text-align:center;line-height:15px;font-size:9px;font-weight:bold;">${code}</span>${label}
      </span>`
    ).join('');

    const html = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<title>班表報表 ${periodLabel}</title>
<style>
  @page { size: A3 landscape; margin: 1cm; }
  * { box-sizing: border-box; }
  body { font-family: 'Microsoft JhengHei', 'PingFang TC', Arial, sans-serif; margin: 0; padding: 6px; font-size: 11px; color: #1e293b; }
  h1 { font-size: 15px; margin: 0 0 4px; color: #0f172a; }
  .meta { display: flex; gap: 16px; align-items: baseline; font-size: 11px; color: #475569; margin-bottom: 6px; flex-wrap: wrap; }
  .legend { margin-bottom: 8px; padding: 4px 8px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; }
  table { border-collapse: collapse; width: 100%; table-layout: auto; }
  thead th { background: #1e293b; color: #fff; padding: 3px 2px; font-size: 10px; border: 1px solid #334155; }
  .footer { margin-top: 6px; font-size: 9px; color: #94a3b8; }
  @media print {
    @page { size: A3 landscape; margin: 1cm; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
<h1>班表報表</h1>
<div class="meta">
  <span>📅 週期：<strong>${esc(periodLabel)}</strong></span>
  <span>🏢 範圍：${esc(scopeLabel)}</span>
  <span style="margin-left:auto;font-size:10px;color:#94a3b8;">列印日期：${printDate}</span>
</div>
<div class="legend">${legendHtml}</div>
<table>
  <thead>
    <tr>
      <th style="text-align:left;padding:3px 5px;min-width:60px;">姓名</th>
      <th style="text-align:left;padding:3px 5px;min-width:50px;font-size:9px;">員編</th>
      ${colHeadersHtml}
      <th style="min-width:28px;">出勤</th>
      <th style="min-width:28px;">休假</th>
    </tr>
  </thead>
  <tbody>${bodyHtml}</tbody>
</table>
<div class="footer">共 ${visibleEmployees.length} 位員工 · 共 ${dayHeaders.length} 天${showConverted ? '（已轉換代碼）' : ''}</div>
</body>
</html>`;

    const win = window.open('', '_blank');
    if (!win) { toast('無法開啟列印視窗，請允許彈出視窗後再試', 'error'); return; }
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 400);
  }, [visibleEmployees, schedule, dayHeaders, selectedYear, selectedMonth, selectedWarehouse, selectedDept, selectedGroup, selectedWorkArea, warehouses, rangeMode, viewRange, showConverted, getDisplayCode, getHolidayLabel, toast]);

  return (
    <div className="p-6 space-y-4">
      {/* 公告需同時交代兩件事：目前檢視的是哪一期、以及該課現在能不能編輯 */}
      {rangeMode && (() => {
        // 「可否編輯」取決於各課的開放區間與鎖定狀態，與目前檢視第幾期無關
        const probeDk = dayHeaders[0]?.dk;
        const canEditAny = !!probeDk && visibleEmployees.some(emp => isEditable(probeDk, emp));
        const tone = unlocked
          ? 'bg-blue-50 border-blue-400 text-blue-800'
          : canEditAny
          ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
          : 'bg-amber-50 border-amber-300 text-amber-800';
        const openTxt = selectedDeptName
          ? (activeRange.start ? `${activeRange.start} ~ ${activeRange.end}` : '尚未設定')
          : '依各課別設定';
        return (
          <div className={`rounded-lg px-3 py-2 flex items-center gap-2 flex-wrap border ${tone}`}>
            <span className="text-base font-bold">
              📢 本期：{viewRange?.start} ~ {viewRange?.end}
              {viewOffset !== 0 && <span className="ml-1 text-sm font-medium">（{viewOffset > 0 ? `+${viewOffset}` : viewOffset} 期）</span>}
            </span>
            <span className="text-sm font-medium">
              ｜{selectedDeptName ? `${selectedDeptName} ` : ''}開放排班：{openTxt}
            </span>
            <span className="text-sm font-medium">
              {unlocked ? `（已快速解鎖，剩餘 ${unlockLeft} 分鐘）`
                : canEditAny ? '（可編輯班表）' : '（僅供查看，不可編輯）'}
            </span>
            {/* 快速解鎖：僅日翊／管理員可用，臨時略過鎖定與開放區間 */}
            {canUnlock && (unlocked
              ? <button onClick={() => setUnlockUntil(0)}
                  className="px-3 py-1 text-xs font-semibold bg-blue-600 text-white rounded-md hover:bg-blue-700">
                  🔒 重新鎖定
                </button>
              : !canEditAny && (
                <button onClick={() => setUnlockOpen(true)}
                  title="輸入解鎖密碼後可臨時編輯此課別班表"
                  className="px-3 py-1 text-xs font-semibold bg-slate-700 text-white rounded-md hover:bg-slate-800">
                  🔓 快速解鎖
                </button>
              ))}
            {viewOffset !== todayPeriodOffset(viewPeriod) && (
              <button onClick={() => setViewOffset(todayPeriodOffset(viewPeriod))}
                className="ml-auto px-3 py-1 text-xs font-semibold bg-amber-600 text-white
                           rounded-md hover:bg-amber-700">
                回到本期
              </button>
            )}
          </div>
        );
      })()}

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-bold text-slate-800">班表管理</h2>
          {!isWorker && <input value={nameSearch} onChange={e => setNameSearch(e.target.value)}
            placeholder="搜尋姓名／員工編號…"
            className="border border-[#DDD9D0] rounded-lg px-2 py-1.5 text-sm flex-1 sm:w-44 min-w-0" />}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {rangeMode ? (
            <div className="flex items-center gap-1">
              <button onClick={() => setViewOffset(v => v - 1)}
                className="px-2 py-1.5 bg-white border border-[#DDD9D0] rounded-lg text-sm hover:bg-slate-100 font-bold"
                title="上一個週期">◀</button>
              <span className={`px-3 py-1.5 border rounded-lg text-sm font-medium
                ${viewOffset === 0 ? 'bg-teal-50 border-teal-200 text-blue-700' : 'bg-amber-50 border-amber-300 text-amber-700'}`}>
                📅 {viewRange?.start} ~ {viewRange?.end}
                {viewOffset !== 0 && <span className="ml-1 text-xs opacity-70">（{viewOffset > 0 ? `+${viewOffset}` : viewOffset} 期）</span>}
              </span>
              <button onClick={() => setViewOffset(v => v + 1)}
                className="px-2 py-1.5 bg-white border border-[#DDD9D0] rounded-lg text-sm hover:bg-slate-100 font-bold"
                title="下一個週期">▶</button>
              {viewOffset !== todayPeriodOffset(viewPeriod) && (
                <button onClick={() => setViewOffset(todayPeriodOffset(viewPeriod))}
                  className="px-2 py-1.5 bg-blue-100 border border-blue-300 text-blue-700 rounded-lg text-xs hover:bg-blue-200">
                  回目前
                </button>
              )}
            </div>
          ) : (
            <>
              <select value={selectedYear} onChange={e => setSelectedYear(+e.target.value)}
                className="border border-[#DDD9D0] rounded-lg px-2 py-1.5 text-sm">
                {years.map(y => <option key={y} value={y}>{y}年</option>)}
              </select>
              <select value={selectedMonth} onChange={e => setSelectedMonth(+e.target.value)}
                className="border border-[#DDD9D0] rounded-lg px-2 py-1.5 text-sm">
                {months.map(m => <option key={m} value={m}>{m}月</option>)}
              </select>
            </>
          )}
          {isManager && checkedEmpIds.size > 0 && (
            <button onClick={resetChecked}
              className="px-3 py-1.5 bg-red-500 text-white rounded-lg text-sm hover:bg-red-600 flex items-center gap-1">
              🔄 重排已選（{checkedEmpIds.size}人）
            </button>
          )}
          {/* 功能按鈕收合鈕：手機預設收合，桌機預設展開 */}
          <button onClick={() => setToolsOpen(v => !v)}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold flex items-center gap-1
                        border transition-colors shadow-sm
                        ${toolsOpen
                          ? 'bg-slate-600 text-white border-slate-600 hover:bg-slate-700'
                          : 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'}`}>
            🛠️ 功能 {toolsOpen ? '▲' : '▼'}
          </button>
          {toolsOpen && <>
          <button onClick={() => setShowConverted(v => !v)}
            className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-1 border transition-colors
              ${showConverted
                ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'
                : 'bg-white text-slate-600 border-[#DDD9D0] hover:bg-[#F5F2EC]'}`}>
            {showConverted ? '🔤 顯示代號中' : '🔡 顯示記號'}
          </button>
          {isManager && <button onClick={handleDownloadTemplate}
            className="px-3 py-1.5 bg-[#1e3870] text-white rounded-lg text-sm hover:bg-[#1a2f5e] flex items-center gap-1">
            📋 下載匯入範本
          </button>}
          {isManager && <button onClick={() => importFileRef.current.click()}
            className="px-3 py-1.5 bg-sky-600 text-white rounded-lg text-sm hover:bg-sky-700 flex items-center gap-1">
            📥 匯入班表
          </button>}
          {isManager && <button onClick={handleFixWeeklyEx}
            className="px-3 py-1.5 bg-amber-600 text-white rounded-lg text-sm hover:bg-amber-700 flex items-center gap-1">
            🔧 修正一週一例
          </button>}
          {isManager && <button onClick={handleConvertHolidays}
            title="將每週超出 2 天的休假改標為國定假日（保留例假），每人最多轉換週期內的國定假日天數"
            className="px-3 py-1.5 bg-teal-600 text-white rounded-lg text-sm hover:bg-teal-700 flex items-center gap-1">
            🎌 一鍵轉換國
          </button>}
          {isManager && <button onClick={exportConverted}
            className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700 flex items-center gap-1">
            📊 代碼轉換匯出
          </button>}
          <button onClick={handlePrintReport}
            className="px-3 py-1.5 bg-violet-600 text-white rounded-lg text-sm hover:bg-violet-700 flex items-center gap-1">
            🖨️ 列印報表
          </button>
          </>}
          {/* 檔案輸入須恆常掛載，否則收合後 importFileRef 會失效 */}
          <input ref={importFileRef} type="file" accept=".xlsx,.xls" onChange={handleImportSchedule} className="hidden" />
          {(() => {
            // 依目前顯示人員所屬課別，提示哪些課已鎖定
            const locked = [...new Set(visibleEmployees
              .map(e => e.dept)
              .filter(d => d && normalizeLockMode(deptLocks[d]) !== 'none'))];
            if (locked.length === 0) return null;
            const anyFull = locked.some(d => normalizeLockMode(deptLocks[d]) === 'full');
            const canEditAny = locked.some(d => lockAllowsEdit(deptLocks[d], currentUser.role));
            return (
              <span title={`已鎖定課別：${locked.join('、')}`}
                className={`px-2 py-1 text-xs rounded-full font-medium
                  ${anyFull ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}>
                🔒 {locked.length === 1 ? `${locked[0]} 已鎖定` : `${locked.length} 個課別已鎖定`}
                {canEditAny && '（廠商／委外不可異動）'}
              </span>
            );
          })()}
        </div>
      </div>

      {/* Legend */}
      <div className="flex gap-3 text-xs flex-wrap">
        {Object.entries(SHIFT_CODES).filter(([k]) => k).map(([code, info]) => (
          <span key={code} className="px-2 py-0.5 rounded bg-slate-100 text-slate-900 border border-slate-200">
            {info.label || code} = {info.meaning}
          </span>
        ))}
        <span className="text-slate-400">（點擊格子切換班別）</span>
        <span className="text-slate-400 ml-2">｜下方廠商列顯示「建議／目前」，建議＝當日需求人數 × 該廠商駐廠比例</span>
      </div>

      {/* 尚未設定每期日期區間時退回年／月檢視，並提醒管理員設定 */}
      {!rangeMode && (
        <div className="rounded-lg px-3 py-2 flex items-center gap-2 flex-wrap border
                        bg-amber-50 border-amber-300 text-amber-800">
          <span className="text-base font-bold">📅 尚未設定每期日期區間</span>
          <span className="text-sm font-medium">（目前以月份檢視）</span>
          <span className="ml-auto text-xs text-amber-700">
            請至「系統設定 → 每期日期區間」設定排班週期
          </span>
        </div>
      )}
      {/* 快速解鎖：輸入密碼後臨時開啟編輯（僅本機、限時） */}
      {unlockOpen && (
        <UnlockDialog
          hasPwd={!!unlockPwd}
          onClose={() => setUnlockOpen(false)}
          onVerify={async (pwd) => {
            if (!unlockPwd) return false;
            return await verifyPwd(pwd, unlockPwd);
          }}
          onOk={(minutes) => {
            setUnlockUntil(Date.now() + minutes * 60000);
            setUnlockOpen(false);
            toast(`已解鎖 ${minutes} 分鐘，期間可編輯此課別班表`, 'warn');
          }}
        />
      )}

      {/* Table */}
      <div className="border border-[#DDD9D0] rounded-xl" style={{ overflow: 'clip' }}>
        <div className="overflow-auto pb-4" style={{ maxHeight: 'calc(100vh - 220px)' }}>
          <table className="border-collapse text-xs" style={{ minWidth: `${160 + days * 44}px` }}>
            <thead className="sticky top-0 z-20">
              <tr className="bg-slate-700 text-white">
                <th className="sticky left-0 z-20 bg-slate-700 px-2 py-2 w-8 min-w-[32px] text-center"
                  style={{ width: 32 }}>
                  <input type="checkbox"
                    className="w-3.5 h-3.5 cursor-pointer"
                    checked={visibleEmployees.length > 0 && visibleEmployees.every(e => checkedEmpIds.has(e.id))}
                    onChange={toggleCheckAll} />
                </th>
                <th className="sticky left-8 z-20 bg-slate-700 text-left px-2 py-2 w-36 min-w-[140px]">
                  <SortHeader label="人員姓名" col="name" sort={sort} onSort={toggleSort} align="left" />
                </th>
                <th className="hidden sm:table-cell px-2 py-2 w-16 min-w-[64px]">
                  <SortHeader label="廠商" col="vendor" sort={sort} onSort={toggleSort} />
                </th>
                <th className="hidden sm:table-cell px-2 py-2 w-20 min-w-[80px]">
                  <SortHeader label="班別" col="shift" sort={sort} onSort={toggleSort} />
                </th>
                {dayHeaders.map(({ dk, day, month, isWeekend, isMonthStart, wd }, colIdx) => {
                  const weekBand = Math.floor(colIdx / 7) % 2 === 1;
                  return (
                  <th key={dk}
                    className={`px-1 py-1 w-14 min-w-[54px] text-center
                                ${weekBand ? 'bg-[#F5F2EC]0' : ''}
                                ${rangeMode && isMonthStart && month !== dayHeaders[0].month && dk !== todayDk ? 'border-l-2 border-blue-400' : ''}`}
                    style={dk === todayDk
                      ? { borderTop: TODAY_LINE, borderLeft: TODAY_LINE, borderRight: TODAY_LINE }
                      : undefined}>
                    <div className="text-[15px] font-bold leading-tight whitespace-nowrap">{month}/{day}</div>
                    <div className={`text-[13px] ${isWeekend ? 'text-yellow-300' : weekBand ? 'text-slate-200' : 'text-slate-300'}`}>{wd}</div>
                  </th>
                  );
                })}
                <th className="px-2 py-2 w-16 min-w-[64px]">出勤天</th>
                <th className="px-2 py-2 w-16 min-w-[64px]">休假天</th>
              </tr>
            </thead>
            <tbody>
              {visibleEmployees.map((emp, rowIdx) => {
                let workDays = 0;
                let leaveDays = 0;
                // 連續6天上班警示（僅對當區幹部/管理員顯示，廠商不顯示）
                const runInfo = getWorkRunInfo(emp.id);
                const warnDks = currentUser.role === ROLES.VENDOR ? new Set() : runInfo.warn;
                // 該課開放區間結束日之後＝尚未開放排班。班表把空白顯示為 V，
                // 若照常著色會讓人誤以為已排班，故一律灰底且不顯示假的 V。
                const empOpenEnd = (() => {
                  const r = visibleRangeOfGroup(segmentsOf(deptSegments, deptRanges, deptLocks, emp.dept), emp.group);
                  return r.end ? parseLocal(r.end) : null;
                })();
                return (
                  <tr key={emp.id}
                    className={`${checkedEmpIds.has(emp.id) ? 'bg-red-50' : rowIdx % 2 === 0 ? 'bg-white' : 'bg-[#F5F2EC]'}`}>
                    <td className="sticky left-0 z-10 px-2 py-2 text-center border-r border-slate-200 bg-inherit"
                      style={{ width: 32 }}>
                      <input type="checkbox"
                        className="w-3.5 h-3.5 cursor-pointer"
                        checked={checkedEmpIds.has(emp.id)}
                        onChange={() => toggleCheck(emp.id)} />
                    </td>
                    <td className="sticky left-8 z-10 px-2 py-2 font-semibold text-slate-900
                                   border-r border-slate-200 bg-inherit">
                      {(() => {
                        const runLen = runInfo.max;
                        const overRun = runLen >= MAX_WORK_RUN;
                        return (
                          <div className={`truncate max-w-[130px] text-base font-semibold text-slate-900 ${overRun ? '!text-red-600 font-bold' : ''}`}
                            title={overRun ? `⚠️ 連續上班 ${runLen} 天（含前後週期），不可連續上班 ${MAX_WORK_RUN} 天` : undefined}>
                            {emp.name}
                          </div>
                        );
                      })()}
                      <div className="text-[13px] text-slate-600 truncate max-w-[130px]">{emp.empId}</div>
                    </td>
                    <td className="hidden sm:table-cell px-2 py-2 text-slate-800 font-semibold border-r border-slate-100 text-center whitespace-nowrap">
                      {emp.vendor}
                    </td>
                    <td className="hidden sm:table-cell px-2 py-2 border-r border-slate-100 text-center">
                      {(() => {
                        const st = findShiftType(shiftTypesByWh, selectedWarehouse ?? 'default', emp.shiftTypeId);
                        return st
                          ? <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-700 whitespace-nowrap">{st.name}</span>
                          : <span className="text-slate-300 text-xs">—</span>;
                      })()}
                    </td>
                    {dayHeaders.map(({ dk, day, month, year, isWeekend, isMonthStart }, colIdx) => {
                      const rawCell = schedule[emp.id]?.[dk];
                      // 尚未開放的未來日期：無明確排班者不顯示內容，有排班者以灰字呈現
                      const notOpenYet = !!empOpenEnd
                        && new Date(year, month - 1, day) > empOpenEnd;
                      const code = rawCell ?? 'V';
                      if (!notOpenYet || rawCell !== undefined) {
                        if (code === 'V') workDays++;
                        else if (code === '休' || code === '例' || code === '國') leaveDays++;
                      }
                      const holidayLabel = code === '國' ? getHolidayLabel(day, month, year) : null;
                      const displayCode = showConverted
                        ? (() => {
                            const sc = getDisplayCode(emp, code, day, month, year);
                            // 代號表有查到特定代碼時優先顯示，否則顯示假日短名
                            return (sc !== code ? sc : null) ?? holidayLabel ?? code;
                          })()
                        : (SHIFT_CODES[code]?.label || code); // 「國」固定顯示「國」，假日名稱只在 tooltip 呈現
                      const info = SHIFT_CODES[code] ?? SHIFT_CODES[''];
                      const locked = !isEditable(dk, emp);
                      const weekBand = Math.floor(colIdx / 7) % 2 === 1;
                      return (
                        <td key={dk}
                          onClick={() => handleCellClick(emp.id, dk)}
                          title={notOpenYet
                            ? '此日期尚未開放排班'
                            : holidayLabel ? `國定假日：${holidayLabel}`
                            : displayCode !== code ? `班別代號：${displayCode}` : undefined}
                          className={`text-center py-2 border-r border-slate-100 cursor-pointer
                                      select-none transition-colors font-bold text-base
                                      ${notOpenYet
                                        ? 'bg-slate-100 text-slate-400'
                                        : warnDks.has(dk) ? 'bg-pink-200 text-slate-900' : info.color}
                                      ${rangeMode && isMonthStart && month !== dayHeaders[0].month && dk !== todayDk ? 'border-l-2 border-blue-400' : ''}
                                      ${locked ? 'cursor-not-allowed opacity-60' : 'hover:opacity-75'}`}
                          style={{
                            ...(weekBand ? { filter: 'brightness(0.93)' } : {}),
                            ...(dk === todayDk ? { borderLeft: TODAY_LINE, borderRight: TODAY_LINE } : {}),
                          }}>
                          {notOpenYet && rawCell === undefined
                            ? <span className="text-slate-300">·</span>
                            : (displayCode || <span className="text-slate-300">·</span>)}
                        </td>
                      );
                    })}
                    <td className="px-2 py-1.5 text-center font-bold text-base text-blue-700">
                      {workDays}
                    </td>
                    <td className="px-2 py-1.5 text-center font-bold text-base text-orange-600">
                      {leaveDays}
                    </td>
                  </tr>
                );
              })}
              {/* ── 底部統計列 ── */}
              {visibleEmployees.length > 0 && (() => {
                const isWork = (e, dk) => (schedule[e.id]?.[dk] ?? 'V') === 'V';
                const workCount = (dk) => visibleEmployees.filter(e => isWork(e, dk)).length;
                // 差異數＝出勤人數 − 需求人數；未填需求時不顯示
                const diffOf = (dk) => {
                  const d = demandOf(dk);
                  if (d === '') return null;
                  return workCount(dk) - Number(d);
                };
                // 各廠商駐廠人數（A）與全區總駐廠人數（B），用於分攤當日需求
                const headcountOf = (v) => visibleEmployees.filter(e => e.vendor === v).length;
                const totalHead = visibleEmployees.length;
                // 建議排班人數＝當日需求（C）× 該廠商駐廠比例（A ÷ B）
                const suggestOf = (v, dk) => {
                  const d = demandOf(dk);
                  if (d === '' || totalHead === 0) return null;
                  return Math.round(Number(d) * headcountOf(v) / totalHead);
                };
                const assignedOf = (v, dk) => visibleEmployees.filter(e => e.vendor === v && isWork(e, dk)).length;
                // 目前檢視範圍內實際出現的廠商，依現場慣用順序排列
                const vendorsInView = sortVendorNames([...new Set(visibleEmployees.map(e => e.vendor).filter(Boolean))]);
                const summaryRows = [
                  { key: '總人數', label: '總人數', bgRow: 'bg-slate-100', bgLabel: 'bg-slate-100', color: 'text-slate-700',
                    fn: () => visibleEmployees.length },
                  { key: '需求人數', label: '需求人數', bgRow: 'bg-blue-50', bgLabel: 'bg-blue-50', color: 'text-blue-700',
                    editable: true },
                  { key: '出勤人數', label: '出勤人數', bgRow: 'bg-green-50', bgLabel: 'bg-green-50', color: 'text-green-700',
                    fn: (dk) => workCount(dk) },
                  { key: '差異數', label: '差異數', bgRow: 'bg-amber-50', bgLabel: 'bg-amber-50', color: 'text-amber-700',
                    diffRow: true },
                  { key: '__toggle', label: '各廠商（建議／目前）', toggleRow: true,
                    bgRow: 'bg-slate-50', bgLabel: 'bg-slate-50', color: 'text-slate-500' },
                  ...(showVendorRows ? vendorsInView : []).map((v, i) => ({
                    key: 'v_' + v, label: v, vendorRow: true, vendor: v,
                    bgRow: i % 2 === 0 ? 'bg-white' : 'bg-[#F8FAFC]',
                    bgLabel: i % 2 === 0 ? 'bg-white' : 'bg-[#F8FAFC]',
                    color: 'text-slate-600',
                  })),
                ];
                return summaryRows.map(({ key, label, bgRow, bgLabel, color, fn, editable, vendorRow, diffRow, vendor, toggleRow }, si) => {
                  const isLastStatRow = si === summaryRows.length - 1;
                  return (
                  <tr key={key} className={`${bgRow} ${si === 0 ? 'border-t-2 border-slate-400' : 'border-t border-slate-200'} font-medium text-xs`}>
                    <td className={`sticky left-0 z-10 ${bgLabel}`} style={{ width: 32 }} />
                    <td className={`sticky left-8 z-10 px-2 py-1.5 font-bold ${bgLabel} ${color} whitespace-nowrap`}>
                      {toggleRow
                        ? <button onClick={() => setShowVendorRows(o => !o)}
                            className="flex items-center gap-1 hover:text-blue-600 transition-colors">
                            <span className="text-[10px]">{showVendorRows ? '▼' : '▶'}</span>
                            <span className="font-medium">{label}</span>
                            <span className="text-[10px] font-normal text-slate-400">{vendorsInView.length} 家</span>
                          </button>
                        : vendorRow
                        ? <span className="pl-3 font-medium">└ {label}
                            <span className="ml-1 text-[10px] font-normal text-slate-400">（建議／目前）</span>
                          </span>
                        : label}
                    </td>
                    <td className="hidden sm:table-cell" />
                    <td className="hidden sm:table-cell" />
                    {dayHeaders.map(({ dk }) => (
                      <td key={dk}
                        className={`px-1 py-1.5 text-center font-semibold ${color}`}
                        style={dk === todayDk
                          ? { borderLeft: TODAY_LINE, borderRight: TODAY_LINE,
                              ...(isLastStatRow ? { borderBottom: TODAY_LINE } : {}) }
                          : undefined}>
                        {toggleRow
                          ? null
                          : vendorRow
                          ? (() => {
                              const asg = assignedOf(vendor, dk);
                              const sug = suggestOf(vendor, dk);
                              if (sug === null) return <span>{asg}</span>;
                              // 目前人數：低於建議＝紅字（出工不足）、高於＝藍字（超派）、剛好＝綠字
                              const tone = asg < sug ? 'text-red-600' : asg > sug ? 'text-blue-600' : 'text-green-600';
                              return (
                                <span title={`${vendor}：建議 ${sug} 人，目前已排 ${asg} 人（當日需求 × 駐廠比例 ${headcountOf(vendor)}/${totalHead}）`}>
                                  <span className="text-slate-400">{sug}</span>
                                  <span className="text-slate-300">/</span>
                                  <span className={`font-bold ${tone}`}>{asg}</span>
                                </span>
                              );
                            })()
                          : diffRow
                          ? (() => {
                              const d = diffOf(dk);
                              if (d === null) return <span className="text-slate-300">—</span>;
                              // 負數＝人力不足，紅色；正數＝超出需求，綠色
                              return <span className={d < 0 ? 'text-red-600' : d > 0 ? 'text-teal-700' : 'text-slate-500'}>
                                {d > 0 ? `+${d}` : d}
                              </span>;
                            })()
                          : editable && !canEditDemand
                          ? <span className="text-blue-400"
                              title="各組別合計（需選定單一組別才能編輯）">
                              {demandOf(dk) || '—'}
                            </span>
                          : editable
                          ? <input
                              type="text" inputMode="numeric"
                              data-demand-dk={dk}
                              value={demandOf(dk)}
                              onChange={e => setDemand(dk, e.target.value)}
                              onKeyDown={onDemandKey}
                              onFocus={e => e.target.select()}
                              placeholder="—"
                              title="當日需求人數（Enter 或 → 跳下一天，Shift+Enter 或 ← 回上一天）"
                              className="w-10 text-center bg-transparent border border-transparent rounded
                                         hover:border-blue-300 focus:border-blue-500 focus:bg-white focus:outline-none
                                         text-blue-700 font-semibold placeholder:text-blue-300 placeholder:font-normal" />
                          : fn(dk)}
                      </td>
                    ))}
                    <td className="px-2 py-1.5" />
                    <td className="px-2 py-1.5" />
                  </tr>
                  );
                });
              })()}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// EMPLOYEE ROSTER
// ─────────────────────────────────────────────

/** 模糊比對欄位名稱 */
const FIELD_ALIASES = {
  empId:  ['員編', '員工代號', '工號', 'empid', 'employee_id', 'emp_id', 'id'],
  name:   ['姓名', '名稱', '人員姓名', 'name', '員工姓名'],
  vendor: ['廠商', '廠商別', '廠商名稱', 'vendor', '所屬廠商'],
  group:  ['組別', '班組', 'group', '群組'],
  status: ['狀態', '在職狀態', 'status'],
};

function fuzzyMatch(headers) {
  const map = {};
  headers.forEach((h, i) => {
    const lh = (h ?? '').toString().toLowerCase().trim();
    Object.entries(FIELD_ALIASES).forEach(([field, aliases]) => {
      if (!map[field] && aliases.some(a => lh.includes(a.toLowerCase()))) {
        map[field] = i;
      }
    });
  });
  return map;
}

function EmployeeRoster() {
  const { employees, setEmployees, currentUser, setSchedule, selectedYear, selectedMonth,
    warehouses, setWarehouses, vendors, setVendors, workAreas,
    selectedWarehouse, selectedDept, selectedGroup, selectedWorkArea, saveNow, triggerForceSave } = useApp();
  const toast = useToast();
  const fileRef = useRef();

  const [search, setSearch] = useState('');
  const [filterVendor, setFilterVendor] = useState('全部');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newEmp, setNewEmp] = useState({ empId: '', name: '', vendor: '', group: '', status: '在職' });
  const [editTarget, setEditTarget] = useState(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 100;
  // 表頭排序：col 為 null 時使用預設排序
  const [sort, setSort] = useState({ col: null, dir: 1 });
  const toggleSort = (col) => { setPage(1); setSort(prev =>
    prev.col !== col ? { col, dir: 1 }
    : prev.dir === 1 ? { col, dir: -1 }
    : { col: null, dir: 1 }); };

  const visible = useMemo(() => {
    let list = currentUser.role === ROLES.VENDOR
      ? employees.filter(e => currentUser.vendors.includes(e.vendor))
      : employees.filter(e => e.vendor && e.vendor.trim() !== '');
    list = filterByScope(list, warehouses, selectedWarehouse, selectedDept, selectedGroup, selectedWorkArea);
    if (filterVendor !== '全部') list = list.filter(e => e.vendor === filterVendor);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(e => e.name.toLowerCase().includes(q) || e.empId.toLowerCase().includes(q));
    }
    // 預設：廠商（現場慣用順序）→ 員編；點表頭可改以該欄排序
    const byDefault = (a, b) =>
      vendorRank(a.vendor) - vendorRank(b.vendor) ||
      (a.vendor ?? '').localeCompare(b.vendor ?? '', 'zh-Hant') ||
      (a.empId ?? '').localeCompare(b.empId ?? '', 'zh-Hant');
    if (!sort.col) return [...list].sort(byDefault);
    const val = (e) => sort.col === 'vendor' ? null : (e[sort.col] ?? '');
    return [...list].sort((a, b) => {
      const c = sort.col === 'vendor'
        ? (vendorRank(a.vendor) - vendorRank(b.vendor) ||
           (a.vendor ?? '').localeCompare(b.vendor ?? '', 'zh-Hant'))
        : String(val(a)).localeCompare(String(val(b)), 'zh-Hant');
      return (c * sort.dir) || byDefault(a, b);
    });
  }, [employees, currentUser, warehouses, selectedWarehouse, selectedDept, selectedGroup, selectedWorkArea, filterVendor, search, sort]);

  // 篩選條件變動時重置到第1頁
  useEffect(() => { setPage(1); }, [selectedWarehouse, selectedDept, selectedGroup, selectedWorkArea, filterVendor, search]);

  const totalPages  = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const pagedVisible = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const vendorOptions = useMemo(() =>
    ['全部', ...new Set(employees.map(e => e.vendor))], [employees]);

  const handleAdd = (form) => {
    const data = form ?? newEmp;
    if (!data.empId || !data.name || !data.vendor) {
      toast('員編、姓名、廠商為必填', 'error'); return;
    }
    const emp = { ...data, id: 'e' + Date.now() };
    // 不預填整月的 V：空白格子本來就顯示 V，寫滿只會多出一份可被誤覆蓋的資料
    setEmployees(prev => [...prev, emp]);
    toast('已新增人員：' + emp.name, 'success');
    setShowAddModal(false);
    setNewEmp({ empId: '', name: '', vendor: '', group: '', status: '在職' });
  };

  const handleDelete = (id) => {
    setEmployees(prev => prev.filter(e => e.id !== id));
    setSchedule(prev => { const n = { ...prev }; delete n[id]; return n; });
    toast('人員已移除', 'info');
  };

  const handleExportRoster = () => {
    try {
      const header = ['員工編號', '姓名', '廠商', '課別', '組別', '職位', '狀態'];
      const rows = visible.map(e => [
        e.empId ?? '', e.name ?? '', e.vendor ?? '',
        e.dept ?? '', e.group ?? '', e.position ?? '', e.status ?? '在職',
      ]);
      const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
      ws['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 8 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '人員清冊');
      const today = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `人員清冊_${today}.xlsx`);
      toast('清冊匯出成功', 'success');
    } catch (err) {
      toast('匯出失敗：' + err.message, 'error');
    }
  };

  const handleImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast('檔案過大，上限 10 MB', 'error'); e.target.value = ''; return; }
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, { type: 'binary', cellFormula: false, cellHTML: false });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
        if (rows.length < 2) { toast('檔案無有效資料', 'error'); return; }
        if (rows.length > 12000) { toast('資料筆數超過上限（12,000 列）', 'error'); return; }

        // ── 固定欄位索引（委外人員在離職名冊格式）──
        // A=0 部門  B=1 課別  C=2 組別  D=3 廠商別  (E=4 DC別，略)
        // F=5 員工編號  G=6 姓名  H=7 性別  I=8 職位
        // J=9 到職日  K=10 離職日（空值=在職）
        const COL_DEPT   = 0;
        const COL_COURSE = 1;
        const COL_GROUP  = 2;
        const COL_VENDOR = 3;
        const COL_EMPID  = 5;
        const COL_NAME   = 6;
        const COL_POS    = 8;

        // ── 動態找「離職日」欄（預設 K=10，掃描表頭確認實際位置）──
        let COL_LEAVE = 10; // K 欄
        for (let ri = 0; ri < Math.min(rows.length, 15); ri++) {
          const idx = (rows[ri] ?? []).findIndex(h => h && h.toString().includes('離職日'));
          if (idx >= 0) { COL_LEAVE = idx; break; }
        }

        // ── 找資料起始列：員工編號欄符合「2碼英文+5碼以上數字」格式的第一列 ──
        let dataStartIdx = -1;
        for (let i = 0; i < rows.length; i++) {
          const cell = (rows[i]?.[COL_EMPID] ?? '').toString().trim();
          if (/^[A-Z]{2}\d{5,}$/.test(cell)) { dataStartIdx = i; break; }
        }
        if (dataStartIdx < 0) { toast('找不到有效資料列，請確認格式', 'error'); return; }

        // 工具：取「代碼 名稱」後半段（如「L035 大肚理貨課」→「大肚理貨課」）
        const parseCodeName = (raw) => {
          if (!raw) return '';
          const s = raw.toString().trim();
          const sp = s.indexOf(' ');
          return sp > 0 ? s.slice(sp + 1).trim() : s;
        };

        // 工具：判斷離職日欄位是否「有填日期」
        // 離職日為空 = 在職；有值才算離職
        // 特別排除純數字小數（在職年資如 6.44 被誤判的情形）
        const hasLeaveDate = (val) => {
          if (val === null || val === undefined || val === '') return false;
          // SheetJS 解析的 Excel 日期有時是 Date 物件
          if (val instanceof Date) return true;
          const s = val.toString().trim();
          if (s === '') return false;
          // 排除純小數（在職年資，如 "6.44"、"7.21"）
          if (/^\d+\.\d+$/.test(s)) return false;
          // 排除純整數但很小的值（非日期序號）
          if (/^\d{1,2}$/.test(s)) return false;
          return true;
        };

        // 既有主檔的「正規化名稱 → 原始寫法」對照，用於吸收空白差異
        const vendorCanon = new Map(vendors.map(v => [normName(v.name), v.name]));
        const deptCanon = new Map(
          warehouses.flatMap(w => (w.departments ?? []).map(d => [normName(d.name), d.name])));
        const canonVendor = v => (v ? (vendorCanon.get(normName(v)) ?? v.trim()) : '');
        const canonDept   = d => (d ? (deptCanon.get(normName(d))   ?? d.trim()) : '');

        let added = 0, updated = 0, skippedTemp = 0, skippedLeave = 0;
        // 員編正規化後比對。主檔的員編若帶有看不見的空白（早期匯入留下），
        // 用原始字串當鍵會對不上檔案裡去空白後的員編，同一個人就會被當成
        // 新人重建：產生新的內部 id、班表重來，昨天排的休全部變成孤兒資料。
        const normEmpId = v => String(v ?? '').trim().toUpperCase();
        const existingMap = new Map(employees.map(e => [normEmpId(e.empId), e]));
        const newEmps = [];
        const updatedEmps = [];   // 同員工編號 → 更新基本資料、保留 shiftTypeId
        const seenInFile = new Set();
        const baseTs = Date.now();

        for (let i = dataStartIdx; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.every(c => c === null || c === undefined || c === '')) continue;

          const empId    = (row[COL_EMPID]  ?? '').toString().trim();
          const name     = (row[COL_NAME]   ?? '').toString().trim();
          const position = (row[COL_POS]    ?? '').toString().trim();
          const leaveVal =  row[COL_LEAVE];
          const vendorRaw= (row[COL_VENDOR] ?? '').toString().trim();
          const groupRaw = (row[COL_GROUP]  ?? '').toString().trim();
          const deptRaw  = (row[COL_COURSE] ?? '').toString().trim();

          if (!name) continue;

          // 過濾：僅排除「委外臨時人員」
          if (position === '委外臨時人員') { skippedTemp++; continue; }

          // 過濾：離職日欄位有填日期（非空、非年資小數）
          if (hasLeaveDate(leaveVal)) { skippedLeave++; continue; }

          // 去空白後與既有主檔比對，命中則沿用主檔寫法，避免產生「三彥 」這類重複項
          const vendor = canonVendor(parseCodeName(vendorRaw));
          const group  = parseCodeName(groupRaw);
          const dept   = canonDept(parseCodeName(deptRaw));

          const empKey = normEmpId(empId);
          if (empKey && existingMap.has(empKey) && !seenInFile.has(empKey)) {
            // 同員工編號：更新基本資料，保留 shiftTypeId 與既有班表
            const old = existingMap.get(empKey);
            updatedEmps.push({ ...old, empId, name, vendor, dept, group, status: '在職' });
            seenInFile.add(empKey);
            updated++;
          } else if (!seenInFile.has(empKey)) {
            const emp = {
              id:     `imp_${baseTs}_${i}`,
              empId,
              name,
              vendor,
              dept,
              group,
              status: '在職',
            };
            newEmps.push(emp);
            if (empKey) { existingMap.set(empKey, emp); seenInFile.add(empKey); }
            added++;
          }
        }

        setEmployees(prev => {
          // 不預先寫入整月的 V：畫面上沒有資料的格子本來就顯示 V，
          // 主動寫滿反而會在比對失誤時覆蓋掉既有排休。

          // 合併：更新既有員工資料、附加新員工
          const updatedMap = new Map(updatedEmps.map(e => [e.id, e]));
          const merged = prev.map(e => updatedMap.get(e.id) ?? e);
          return [...merged, ...newEmps];
        });

        // ── 同步廠商設定：本次匯入若出現某課別尚未登錄的廠商，自動補進去 ──
        // 課別的廠商清單決定了篩選下拉選項，未登錄會導致該批人員篩選不到。
        const imported = [...updatedEmps, ...newEmps];
        const pairs = new Map();   // 課別名稱 → Set(廠商名稱)
        for (const e of imported) {
          if (!e.dept || !e.vendor) continue;
          if (!pairs.has(e.dept)) pairs.set(e.dept, new Set());
          pairs.get(e.dept).add(e.vendor);
        }

        const addedByDept = new Map();   // 課別 → [補上的廠商]
        const nextWarehouses = warehouses.map(w => ({
          ...w,
          departments: (w.departments ?? []).map(d => {
            const want = pairs.get(d.name);
            if (!want) return d;
            const have = new Set((d.vendors ?? []).map(normName));
            const miss = [...want].filter(v => !have.has(normName(v)));
            if (miss.length === 0) return d;
            addedByDept.set(d.name, miss);
            return { ...d, vendors: [...(d.vendors ?? []), ...miss] };
          }),
        }));

        // 廠商主檔也一併補上，否則廠商別維護與報表全名對照會缺項
        const haveVendor = new Set(vendors.map(v => normName(v.name)));
        const newVendorNames = [...new Set(
          [...addedByDept.values()].flat().filter(v => !haveVendor.has(normName(v))))];

        let syncMsg = '';
        if (addedByDept.size > 0) {
          setWarehouses(nextWarehouses);
          if (newVendorNames.length > 0) {
            setVendors(prev => [...prev,
              ...newVendorNames.map((name, k) => ({ id: `vd_${baseTs}_${k}`, code: '', name }))]);
          }
          syncMsg = '；並自動補上廠商設定 — ' +
            [...addedByDept].map(([d, vs]) => `${d}：${vs.join('、')}`).join('；');
        }

        // 組別不在該課別清單中的人員：資料照常匯入，但需明確告知，
        // 否則這些人在用組別篩選時會安靜地消失而查不出原因
        const unknownGroups = new Map();   // 「課別／組別」→ 人數
        for (const e of imported) {
          if (!isUnknownGroup(warehouses, e)) continue;
          const k = `${e.dept}／${e.group}`;
          unknownGroups.set(k, (unknownGroups.get(k) ?? 0) + 1);
        }
        const groupMsg = unknownGroups.size > 0
          ? `；⚠ 下列組別不在系統清單中（可正常排班，但無法用組別篩選）：`
            + [...unknownGroups].map(([k, n]) => `${k}（${n} 人）`).join('、')
          : '';

        const skipMsg = [
          skippedTemp  ? `臨時人員 ${skippedTemp} 筆` : '',
          skippedLeave ? `已離職 ${skippedLeave} 筆` : '',
        ].filter(Boolean).join('、');

        // React re-render 後（100ms）再存，保證 saveNow 讀到最新 employees
        setTimeout(() => saveNow((ok) => {
          if (!ok) toast('資料同步失敗，請手動按存檔鍵', 'error');
        }), 100);
        toast(`匯入完成：新增 ${added} 筆、更新 ${updated} 筆${skipMsg ? `，略過（${skipMsg}）` : ''}${syncMsg}${groupMsg}`,
          unknownGroups.size > 0 ? 'warn' : 'success');
      } catch (err) {
        toast('檔案解析失敗：' + err.message, 'error');
      }
    };
    reader.readAsArrayBuffer(file);   // ArrayBuffer 效能遠優於 binary，支援萬筆大檔
    e.target.value = '';
  };

  const vendorNameOptions = useMemo(() => [...new Set(vendors.map(v => v.name))], [vendors]);
  const deptOptions = useMemo(() =>
    [...new Set(warehouses.flatMap(w => (w.departments ?? []).map(d => d.name)).filter(Boolean))],
    [warehouses]);
  const groupOptions = useMemo(() =>
    [...new Set(warehouses.flatMap(w => (w.departments ?? []).flatMap(d => d.groups ?? [])).filter(Boolean))],
    [warehouses]);

  const EmpModal = ({ emp, onSave, onClose, title }) => {
    const [form, setForm] = useState(emp);
    const selectFields = [
      { key: 'vendor', label: '廠商', options: vendorNameOptions },
      { key: 'dept',   label: '課別', options: deptOptions },
      { key: 'group',  label: '組別', options: groupOptions },
    ];
    return (
      <Modal onClose={onClose}>
        <div className="bg-white rounded-xl shadow w-full max-w-md p-6">
          <h3 className="font-bold text-lg text-slate-800 mb-4">{title}</h3>
          {[
            { key: 'empId',  label: '員編' },
            { key: 'name',   label: '姓名' },
          ].map(f => (
            <div key={f.key} className="mb-3">
              <label className="block text-sm font-medium text-slate-700 mb-1">{f.label}</label>
              <input value={form[f.key] ?? ''} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                className="w-full border border-[#DDD9D0] rounded-lg px-3 py-1.5 text-sm" />
            </div>
          ))}
          {selectFields.map(f => {
            const current = form[f.key] ?? '';
            const options = current && !f.options.includes(current) ? [current, ...f.options] : f.options;
            return (
              <div key={f.key} className="mb-3">
                <label className="block text-sm font-medium text-slate-700 mb-1">{f.label}</label>
                <select value={current} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                  className="w-full border border-[#DDD9D0] rounded-lg px-3 py-1.5 text-sm">
                  <option value="">請選擇{f.label}</option>
                  {options.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            );
          })}
          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-700 mb-1">狀態</label>
            <select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}
              className="w-full border border-[#DDD9D0] rounded-lg px-3 py-1.5 text-sm">
              <option>在職</option><option>已離職</option><option>臨時人員</option>
            </select>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={onClose} className="px-4 py-2 border border-[#DDD9D0] rounded-lg text-sm hover:bg-[#F5F2EC]">取消</button>
            <button onClick={() => onSave(form)} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">儲存</button>
          </div>
        </div>
      </Modal>
    );
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-slate-800">人員清冊</h2>
        <div className="flex gap-2 flex-wrap">
          {currentUser.role !== ROLES.VENDOR && (
            <>
              <button onClick={() => fileRef.current.click()}
                className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700">
                📥 匯入 Excel
              </button>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleImport} className="hidden" />
              <button onClick={handleExportRoster}
                className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700">
                📤 匯出清冊
              </button>
            </>
          )}
          <button onClick={() => setShowAddModal(true)}
            className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
            ➕ 新增人員
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="搜尋姓名 / 員編..." className="border border-[#DDD9D0] rounded-lg px-3 py-1.5 text-sm w-52" />
        <select value={filterVendor} onChange={e => setFilterVendor(e.target.value)}
          className="border border-[#DDD9D0] rounded-lg px-2 py-1.5 text-sm">
          {vendorOptions.map(v => <option key={v}>{v}</option>)}
        </select>
        <span className="text-sm text-slate-500 self-center">共 {visible.length} 筆</span>
        {visible.length > PAGE_SIZE && (
          <span className="text-xs text-slate-400 self-center">（每頁 {PAGE_SIZE} 筆）</span>
        )}
      </div>

      {/* Table */}
      <div className="border border-[#DDD9D0] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-100">
              <tr>
                {[['員編','empId'],['姓名','name'],['廠商','vendor'],['課別','dept'],
                  ['組別','group'],['作業區','workArea'],['狀態','status'],['操作',null]].map(([h, col]) => (
                  <th key={h} className="px-4 py-3 text-left font-semibold text-slate-600 whitespace-nowrap">
                    {col
                      ? <SortHeader label={h} col={col} sort={sort} onSort={toggleSort} align="left" tone="light" />
                      : h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pagedVisible.length === 0 && (
                <tr><td colSpan={8} className="text-center py-8 text-slate-400">無人員資料</td></tr>
              )}
              {pagedVisible.map(emp => (
                <tr key={emp.id} className="hover:bg-[#F5F2EC]">
                  <td className="px-4 py-2.5 font-mono text-slate-600 whitespace-nowrap">{emp.empId}</td>
                  <td className="px-4 py-2.5 font-medium text-slate-800 whitespace-nowrap">{emp.name}</td>
                  <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{emp.vendor}</td>
                  <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">
                    {emp.dept
                      ? <span className="px-2 py-0.5 bg-purple-50 text-purple-700 border border-purple-200 rounded-full text-xs">{emp.dept}</span>
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">
                    {emp.group
                      ? <span
                          title={isUnknownGroup(warehouses, emp)
                            ? `「${emp.group}」不在「${emp.dept}」的組別清單中，將無法用組別篩選到此人員`
                            : undefined}
                          className={`px-2 py-0.5 border rounded-full text-xs ${
                            isUnknownGroup(warehouses, emp)
                              ? 'bg-red-50 text-red-700 border-red-300 font-semibold'
                              : 'bg-green-50 text-green-700 border-green-200'}`}>
                          {isUnknownGroup(warehouses, emp) && '⚠ '}{emp.group}
                        </span>
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    {/* 直接於清單指派，省去逐一開啟編輯視窗 */}
                    <select value={emp.workArea ?? ''}
                      onChange={e => setEmployees(prev => prev.map(x =>
                        x.id === emp.id ? { ...x, workArea: e.target.value } : x))}
                      className={`border rounded-lg px-2 py-1 text-xs
                        ${emp.workArea
                          ? 'border-[#DDD9D0] text-slate-700'
                          : 'border-[#DDD9D0] text-slate-400'}`}>
                      <option value="">未設定</option>
                      {workAreas.map(a => <option key={a} value={a}>{a}</option>)}
                      {/* 指派值已從清單移除時仍需顯示，否則會靜默變成未設定 */}
                      {emp.workArea && !workAreas.includes(emp.workArea) &&
                        <option value={emp.workArea}>{emp.workArea}（已停用）</option>}
                    </select>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium
                      ${emp.status === '在職' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {emp.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex gap-2">
                      <button onClick={() => setEditTarget(emp)}
                        className="text-teal-700 hover:text-blue-800 text-xs">編輯</button>
                      <button onClick={() => handleDelete(emp.id)}
                        className="text-red-500 hover:text-red-700 text-xs">移除</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 分頁控制 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-1">
          <button onClick={() => setPage(1)} disabled={page === 1}
            className="px-2 py-1 text-xs border border-[#DDD9D0] rounded-lg disabled:opacity-40 hover:bg-[#F5F2EC]">
            ««
          </button>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            className="px-2 py-1 text-xs border border-[#DDD9D0] rounded-lg disabled:opacity-40 hover:bg-[#F5F2EC]">
            ‹
          </button>
          <span className="text-sm text-slate-600 px-2">
            第 <span className="font-semibold">{page}</span> / {totalPages} 頁
            <span className="ml-2 text-slate-400">
              （第 {(page-1)*PAGE_SIZE+1}～{Math.min(page*PAGE_SIZE, visible.length)} 筆）
            </span>
          </span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            className="px-2 py-1 text-xs border border-[#DDD9D0] rounded-lg disabled:opacity-40 hover:bg-[#F5F2EC]">
            ›
          </button>
          <button onClick={() => setPage(totalPages)} disabled={page === totalPages}
            className="px-2 py-1 text-xs border border-[#DDD9D0] rounded-lg disabled:opacity-40 hover:bg-[#F5F2EC]">
            »»
          </button>
        </div>
      )}

      {showAddModal && (
        <EmpModal
          emp={newEmp} title="新增人員" onClose={() => setShowAddModal(false)}
          onSave={form => handleAdd(form)}
        />
      )}
      {editTarget && (
        <EmpModal
          emp={editTarget} title="編輯人員"
          onClose={() => setEditTarget(null)}
          onSave={form => {
            setEmployees(prev => prev.map(e => e.id === form.id ? form : e));
            toast('已更新：' + form.name, 'success');
            setEditTarget(null);
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// REPORTS
// ─────────────────────────────────────────────


/** 可複選的下拉篩選（未勾選任何項目＝全部） */
function MultiSelect({ label, options, selected, onChange, width = 'w-40' }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = e => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const toggle = (v) => onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]);
  const summary = selected.length === 0 ? `全部${label}`
    : selected.length === 1 ? selected[0]
    : `${selected[0]} 等 ${selected.length} 項`;

  return (
    <div className={`relative ${width}`} ref={boxRef}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center gap-1 border rounded-lg px-2.5 py-1.5 text-sm bg-white
          ${selected.length > 0 ? 'border-blue-400 text-blue-700 font-medium' : 'border-[#DDD9D0] text-slate-600'}`}>
        <span className="truncate flex-1 text-left">{summary}</span>
        <span className="text-xs text-slate-400">▾</span>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-[180px] max-h-64 overflow-auto bg-white
                        border border-[#DDD9D0] rounded-lg shadow-lg py-1">
          <div className="flex gap-1 px-2 py-1 border-b border-slate-100">
            <button onClick={() => onChange(options.map(o => o.value ?? o))}
              className="flex-1 text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200">全選</button>
            <button onClick={() => onChange([])}
              className="flex-1 text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200">清除</button>
          </div>
          {options.length === 0 && <p className="px-3 py-2 text-xs text-slate-400">無可選項目</p>}
          {options.map(o => {
            const v = o.value ?? o, t = o.label ?? o;
            return (
              <label key={v} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-[#F5F2EC] cursor-pointer">
                <input type="checkbox" checked={selected.includes(v)} onChange={() => toggle(v)}
                  className="w-3.5 h-3.5 accent-blue-600" />
                <span className="truncate">{t}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 月報表／日報表共用的「報表篩選」：倉別沿用上方篩選列，其餘四項各自獨立可複選 */
function useReportScope() {
  const { employees, warehouses, workAreas, selectedWarehouse } = useApp();
  const [fDepts,   setFDepts]   = useState([]);
  const [fGroups,  setFGroups]  = useState([]);
  const [fAreas,   setFAreas]   = useState([]);
  const [fVendors, setFVendors] = useState([]);

  const baseList = useMemo(() => {
    const wh = warehouses.find(w => w.id === selectedWarehouse);
    const deptNames = wh ? new Set((wh.departments ?? []).map(d => d.name)) : null;
    return employees.filter(e =>
      e.status !== '離職' && e.vendor && e.vendor.trim() !== '' &&
      (!deptNames || deptNames.has(e.dept)));
  }, [employees, warehouses, selectedWarehouse]);

  const options = useMemo(() => {
    const wh = warehouses.find(w => w.id === selectedWarehouse);
    const depts = wh ? (wh.departments ?? []).map(d => d.name)
                     : [...new Set(warehouses.flatMap(w => (w.departments ?? []).map(d => d.name)))];
    const src = wh ? (wh.departments ?? []) : warehouses.flatMap(w => w.departments ?? []);
    const groups = [...new Set(src
      .filter(d => fDepts.length === 0 || fDepts.includes(d.name))
      .flatMap(d => d.groups ?? []))];
    const vendors = sortVendorNames([...new Set(baseList.map(e => e.vendor))]);
    const areas = [...(workAreas ?? []), '（未設定）'];
    return { depts, groups, vendors, areas };
  }, [warehouses, selectedWarehouse, fDepts, baseList, workAreas]);

  const scoped = useMemo(() => baseList.filter(e =>
    (fDepts.length   === 0 || fDepts.includes(e.dept)) &&
    (fGroups.length  === 0 || fGroups.includes(e.group)) &&
    (fVendors.length === 0 || fVendors.includes(e.vendor)) &&
    (fAreas.length   === 0 || fAreas.includes(e.workArea || '（未設定）'))
  ), [baseList, fDepts, fGroups, fVendors, fAreas]);


  const scopeLabel = () => {
    const wh = warehouses.find(w => w.id === selectedWarehouse);
    const part = (label, arr) => arr.length === 0 ? null
      : arr.length <= 2 ? `${label}：${arr.join('、')}` : `${label}：${arr.length} 項`;
    return [wh?.name ?? '全部倉別',
      part('課別', fDepts), part('組別', fGroups),
      part('作業區', fAreas), part('廠商', fVendors)].filter(Boolean).join('／');
  };

  const bar = (
    <div className="flex flex-wrap items-center gap-2 mb-4 p-3 bg-[#F5F2EC] rounded-lg">
      <span className="text-xs font-semibold text-slate-500 shrink-0">報表篩選</span>
      <MultiSelect label="課別"   options={options.depts}   selected={fDepts}   onChange={setFDepts}   width="w-44" />
      <MultiSelect label="組別"   options={options.groups}  selected={fGroups}  onChange={setFGroups}  width="w-40" />
      <MultiSelect label="作業區" options={options.areas}   selected={fAreas}   onChange={setFAreas}   width="w-36" />
      <MultiSelect label="廠商"   options={options.vendors} selected={fVendors} onChange={setFVendors} width="w-40" />
      {(fDepts.length || fGroups.length || fAreas.length || fVendors.length) > 0 && (
        <button onClick={() => { setFDepts([]); setFGroups([]); setFAreas([]); setFVendors([]); }}
          className="px-2.5 py-1.5 text-xs text-slate-500 border border-[#DDD9D0] rounded-lg bg-white hover:bg-slate-50">
          清除報表篩選
        </button>
      )}
      <span className="ml-auto text-xs text-slate-400">
        倉別沿用上方篩選列；此處條件不影響其他分頁
      </span>
    </div>
  );

  return { scoped, scopeLabel, bar, filters: { fDepts, fGroups, fAreas, fVendors } };
}

// ─────────────────────────────────────────────
// 日報表：單日出勤概況（應到／實到／未到／到班率），可與前一日或上週同日比較
// ─────────────────────────────────────────────
function DailySummary() {
  const { schedule, attendData, extras, currentUser } = useApp();
  const toast = useToast();
  const { scoped, scopeLabel, bar } = useReportScope();

  const canView = currentUser?.role === ROLES.ADMIN || currentUser?.role === ROLES.AREA;

  const today = new Date();
  const pad = n => String(n).padStart(2, '0');
  const [date, setDate] = useState(`${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`);
  // 預設比上週同日：同為星期幾，貨量與人力結構才可比（比前一日常跨到假日、失真）
  const [cmp, setCmp] = useState('lastWeek');   // 'lastWeek' | 'prevDay'

  const shiftDate = (iso, days) => {
    const [y, m, d] = iso.split('-').map(Number);
    const t = new Date(y, m - 1, d); t.setDate(t.getDate() + days);
    return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
  };
  const cmpDate = shiftDate(date, cmp === 'prevDay' ? -1 : -7);
  const wdOf = iso => { const [y, m, d] = iso.split('-').map(Number); return ['日','一','二','三','四','五','六'][new Date(y, m - 1, d).getDay()]; };
  const dkOf = iso => { const [y, m, d] = iso.split('-').map(Number); return dateKey(y, m, d); };

  /** 統計某一天：依廠商彙總長期與臨時人力的應到／實到 */
  const tally = useCallback((iso) => {
    const dk = dkOf(iso);
    const rec = attendData[iso] ?? {};
    const map = {};
    const bucket = v => (map[v] ??= { due: 0, act: 0, tempDue: 0, tempAct: 0, absTypes: {}, absNames: [] });
    for (const e of scoped) {
      if ((schedule[e.id] ?? {})[dk] !== 'V') continue;   // 當日未排班（非 V）不計入應到
      const b = bucket(e.vendor || '未分配');
      b.due++;
      const r = rec[e.id];
      if (r?.present) b.act++;
      else if (r) {
        const t = r.absType || '缺勤';
        b.absTypes[t] = (b.absTypes[t] ?? 0) + 1;
        b.absNames.push(`${e.name}（${t}）`);
      }
    }
    for (const x of (extras[iso] ?? [])) {
      const b = bucket(x.vendor || '未分配');
      b.tempDue++;
      if (x.present) b.tempAct++;
    }
    return map;
  }, [scoped, schedule, attendData, extras]);

  const rows = useMemo(() => {
    const c = tally(date), p = tally(cmpDate);
    const names = sortVendorNames([...new Set([...Object.keys(c), ...Object.keys(p)])]);
    const empty = { due: 0, act: 0, tempDue: 0, tempAct: 0, absTypes: {}, absNames: [] };
    return names.map(v => {
      const a = c[v] ?? empty, b = p[v] ?? empty;
      return {
        vendor: v, ...a,
        absent: a.due - a.act,
        rate: a.due ? Math.round(a.act / a.due * 100) : null,
        tempRate: a.tempDue ? Math.round(a.tempAct / a.tempDue * 100) : null,
        prevAct: b.act, diffAct: a.act - b.act,
        absLabel: Object.entries(a.absTypes).map(([t, n]) => `${t}*${n}`).join('、'),
      };
    }).filter(r => r.due > 0 || r.tempDue > 0 || r.prevAct > 0);
  }, [tally, date, cmpDate]);

  const total = useMemo(() => rows.reduce((t, r) => ({
    due: t.due + r.due, act: t.act + r.act, tempDue: t.tempDue + r.tempDue,
    tempAct: t.tempAct + r.tempAct, prevAct: t.prevAct + r.prevAct,
  }), { due: 0, act: 0, tempDue: 0, tempAct: 0, prevAct: 0 }), [rows]);

  const diffCls = d => d > 0 ? 'text-teal-700' : d < 0 ? 'text-red-600' : 'text-slate-400';
  const fmtDiff = d => d > 0 ? `+${d}` : String(d);
  const rateCls = r => r == null ? 'text-slate-400' : r >= 95 ? 'text-teal-700' : r >= 85 ? 'text-amber-600' : 'text-red-600';

  const exportExcel = () => {
    if (rows.length === 0) { toast('該日沒有資料可匯出', 'warn'); return; }
    const cmpLabel = cmp === 'prevDay' ? '前一日' : '上週同日';
    const aoa = [
      ['日報表（單日出勤概況）'],
      ['出勤日期', `${date}（${wdOf(date)}）`],
      ['比較對象', `${cmpLabel}　${cmpDate}（${wdOf(cmpDate)}）`],
      ['統計範圍', scopeLabel()],
      ['產出時間', new Date().toLocaleString('zh-TW')],
      [],
      ['廠商', '應到（長期）', '實到（長期）', '未到', '到班率（長期）',
       `${cmpLabel}實到`, '實到增減', '應到（臨時）', '實到（臨時）', '到班率（臨時）', '缺勤明細', '未到人員'],
    ];
    rows.forEach(r => aoa.push([
      r.vendor, r.due, r.act, r.absent, r.rate == null ? '—' : `${r.rate}%`,
      r.prevAct, r.diffAct, r.tempDue, r.tempAct,
      r.tempRate == null ? '—' : `${r.tempRate}%`,
      r.absLabel || '（無缺勤）', r.absNames.join('、'),
    ]));
    aoa.push(['合計', total.due, total.act, total.due - total.act,
      total.due ? `${Math.round(total.act / total.due * 100)}%` : '—',
      total.prevAct, total.act - total.prevAct, total.tempDue, total.tempAct,
      total.tempDue ? `${Math.round(total.tempAct / total.tempDue * 100)}%` : '—', '', '']);

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 13 },
                   { wch: 13 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 13 }, { wch: 18 }, { wch: 40 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '日報表');
    XLSX.writeFile(wb, `日報表_${date}.xlsx`);
    toast('日報表已匯出', 'success');
  };

  if (!canView) return null;

  return (
    <div className="bg-white border border-[#DDD9D0] rounded-xl p-5">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <h3 className="font-semibold text-slate-700">日報表</h3>
        <span className="text-xs text-slate-400">單日出勤概況與前期比較</span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button onClick={() => setDate(shiftDate(date, -1))}
            className="px-2 py-1.5 bg-white border border-[#DDD9D0] rounded-lg text-sm hover:bg-slate-100 font-bold">◀</button>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="border border-[#DDD9D0] rounded-lg px-3 py-1.5 text-sm" />
          <button onClick={() => setDate(shiftDate(date, 1))}
            className="px-2 py-1.5 bg-white border border-[#DDD9D0] rounded-lg text-sm hover:bg-slate-100 font-bold">▶</button>

          <div className="flex rounded-lg border border-[#DDD9D0] overflow-hidden text-sm">
            {[['lastWeek', '比上週同日'], ['prevDay', '比前一日']].map(([k, label]) => (
              <button key={k} onClick={() => setCmp(k)}
                className={`px-3 py-1.5 transition-colors
                  ${cmp === k ? 'bg-[#1a2f5e] text-white font-semibold' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                {label}
              </button>
            ))}
          </div>

          <button onClick={exportExcel}
            className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700">
            📊 匯出 Excel
          </button>
        </div>
      </div>

      {bar}

      <p className="text-xs text-slate-500 mb-3">
        出勤日期 <b className="text-slate-700">{date}（{wdOf(date)}）</b>
        　比較對象 <b className="text-slate-700">{cmpDate}（{wdOf(cmpDate)}）</b>
        　統計範圍 <b className="text-slate-700">{scopeLabel()}</b>
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-slate-100">
            <tr>
              {['廠商', '應到（長期）', '實到（長期）', '未到', '到班率（長期）',
                cmp === 'prevDay' ? '前一日實到' : '上週同日實到', '實到增減',
                '臨時應到', '臨時實到', '到班率（臨時）', '缺勤明細'].map(h => (
                <th key={h} className="px-3 py-2.5 text-left font-semibold text-slate-600 text-xs whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr><td colSpan={11} className="px-3 py-6 text-center text-slate-400 text-sm">該日沒有排班或出勤資料</td></tr>
            )}
            {rows.map(r => (
              <tr key={r.vendor} className="hover:bg-[#F5F2EC]">
                <td className="px-3 py-2 font-medium text-slate-800 whitespace-nowrap">{r.vendor}</td>
                <td className="px-3 py-2 text-slate-700">{r.due}</td>
                <td className="px-3 py-2 font-bold text-slate-800">{r.act}</td>
                <td className={`px-3 py-2 ${r.absent > 0 ? 'text-red-600 font-semibold' : 'text-slate-400'}`}>{r.absent}</td>
                <td className={`px-3 py-2 font-semibold ${rateCls(r.rate)}`}>{r.rate == null ? '—' : `${r.rate}%`}</td>
                <td className="px-3 py-2 text-slate-500">{r.prevAct}</td>
                <td className={`px-3 py-2 text-xs ${diffCls(r.diffAct)}`}>{fmtDiff(r.diffAct)}</td>
                <td className="px-3 py-2 text-slate-500">{r.tempDue || '—'}</td>
                <td className="px-3 py-2 text-slate-700">{r.tempAct || '—'}</td>
                <td className={`px-3 py-2 font-semibold ${rateCls(r.tempRate)}`}>
                  {r.tempRate == null ? '—' : `${r.tempRate}%`}
                </td>
                <td className="px-3 py-2 text-xs text-slate-500 max-w-[220px] truncate" title={r.absNames.join('、')}>
                  {r.absLabel || '—'}
                </td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="bg-slate-50 font-semibold">
                <td className="px-3 py-2 text-slate-700">合計</td>
                <td className="px-3 py-2 text-slate-700">{total.due}</td>
                <td className="px-3 py-2 text-slate-900">{total.act}</td>
                <td className={`px-3 py-2 ${total.due - total.act > 0 ? 'text-red-600' : 'text-slate-400'}`}>{total.due - total.act}</td>
                <td className={`px-3 py-2 ${rateCls(total.due ? Math.round(total.act / total.due * 100) : null)}`}>
                  {total.due ? `${Math.round(total.act / total.due * 100)}%` : '—'}
                </td>
                <td className="px-3 py-2 text-slate-500">{total.prevAct}</td>
                <td className={`px-3 py-2 text-xs ${diffCls(total.act - total.prevAct)}`}>{fmtDiff(total.act - total.prevAct)}</td>
                <td className="px-3 py-2 text-slate-500">{total.tempDue}</td>
                <td className="px-3 py-2 text-slate-700">{total.tempAct}</td>
                <td className={`px-3 py-2 ${rateCls(total.tempDue ? Math.round(total.tempAct / total.tempDue * 100) : null)}`}>
                  {total.tempDue ? `${Math.round(total.tempAct / total.tempDue * 100)}%` : '—'}
                </td>
                <td className="px-3 py-2"></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="text-[11px] text-slate-400 mt-2">
        應到＝當日班表為「V」的人數；實到＝點名表已勾選到班的人數；未到含請假與未點名。臨時人力來自點名表的派工匯入與手動新增。
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────
// 月報表：以「月份」或「排班週期」統計排班人數，並與前一期比較
// ─────────────────────────────────────────────
/** 產出指定起訖日的日期鍵陣列（與班表相同的 dateKey 格式，不補零） */
function dkRange(start, end) {
  const out = [];
  const cur = new Date(start);
  while (cur <= end) {
    out.push(dateKey(cur.getFullYear(), cur.getMonth() + 1, cur.getDate()));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

function MonthlySummary() {
  const { schedule, periodRange, currentUser, attendData, extras, warehouses,
    shiftTypesByWh, selectedWarehouse } = useApp();
  const toast = useToast();
  const { scoped, scopeLabel, bar, filters } = useReportScope();

  // 月報表僅供日翊員工與管理員檢視，委外幹部不開放
  const canView = currentUser?.role === ROLES.ADMIN || currentUser?.role === ROLES.AREA;

  const today = new Date();
  const [mode, setMode] = useState('month');            // 'month' | 'period'
  const [ym, setYm] = useState(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`);
  const [periodOffset, setPeriodOffset] = useState(0);  // 相對於系統設定的基準期

  const hasPeriod = !!(periodRange?.start && periodRange?.end);
  // 預設落在「今天所屬的那一期」，與班表管理的行為一致
  const didInitPeriod = useRef(false);
  useEffect(() => {
    if (didInitPeriod.current || !hasPeriod) return;
    didInitPeriod.current = true;
    const off = todayPeriodOffset(periodRange);
    if (off !== 0) setPeriodOffset(off);
  }, [hasPeriod, periodRange]);

  /** 依模式算出「本期」與「前一期」的起訖 */
  const spans = useMemo(() => {
    if (mode === 'month') {
      const [y, m] = ym.split('-').map(Number);
      const cur  = { start: new Date(y, m - 1, 1), end: new Date(y, m, 0) };
      const prev = { start: new Date(y, m - 2, 1), end: new Date(y, m - 1, 0) };
      const lab = d => `${d.getFullYear()}/${d.getMonth() + 1}`;
      return { cur, prev, curLabel: lab(cur.start), prevLabel: lab(prev.start), unit: '月' };
    }
    if (!hasPeriod) return null;
    const s = parseLocal(periodRange.start);
    const e = parseLocal(periodRange.end);
    const len = Math.round((e - s) / 86400000) + 1;     // 含頭含尾天數
    const shift = (n) => {
      const a = new Date(s); a.setDate(a.getDate() + n * len);
      const b = new Date(e); b.setDate(b.getDate() + n * len);
      return { start: a, end: b };
    };
    const cur = shift(periodOffset), prev = shift(periodOffset - 1);
    const lab = r => `${r.start.getMonth() + 1}/${r.start.getDate()}～${r.end.getMonth() + 1}/${r.end.getDate()}`;
    return { cur, prev, curLabel: lab(cur), prevLabel: lab(prev), unit: '期' };
  }, [mode, ym, hasPeriod, periodRange, periodOffset]);

  /** 統計一個區間：依廠商彙總排班人數與天數 */
  /** 某人的名目工時（依指派班別的上下班時間，跨夜自動加 24 小時） */
  const hoursOf = useCallback((emp) => {
    const st = findShiftType(shiftTypesByWh, selectedWarehouse ?? 'default', emp.shiftTypeId);
    if (!st?.startTime || !st?.endTime) return 0;
    const toMin = t => Number(String(t).slice(0, 2)) * 60 + Number(String(t).slice(2));
    let d = toMin(st.endTime) - toMin(st.startTime);
    if (d <= 0) d += 24 * 60;
    return d / 60;
  }, [shiftTypesByWh, selectedWarehouse]);

  /** 統計一個區間：人次、工時、到班率、人員異動 */
  const tally = useCallback((span) => {
    const dks = dkRange(span.start, span.end);
    const isoOf = dk => { const [y, m, d] = dk.split('-').map(Number);
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; };
    const map = {};
    for (const e of scoped) {
      const row = schedule[e.id] ?? {};
      const v = e.vendor || '未分配';
      const hrs = hoursOf(e);
      let work = 0, off = 0, nat = 0, act = 0, absent = 0, unchecked = 0, any = false;
      for (const dk of dks) {
        const c = row[dk];
        if (c === undefined) continue;
        any = true;
        if (c === 'V') {
          work++;
          const rec = attendData[isoOf(dk)]?.[e.id];
          if (!rec) unchecked++;          // 尚未點名，不計入到班也不計入缺工
          else if (rec.present) act++;
          else absent++;
        } else if (c === '休' || c === '例') off++;
        else if (c === '國') { nat++; off++; }
      }
      if (!any) continue;                 // 該區間完全沒排班的人不列入（廠商也不列出）
      map[v] ??= { people: 0, ids: new Set(), workDays: 0, hours: 0,
                   offDays: 0, natDays: 0, act: 0, absent: 0, unchecked: 0, tempDue: 0, tempAct: 0 };
      const m = map[v];
      m.people++; m.ids.add(e.id);
      m.workDays += work; m.hours += work * hrs;
      m.offDays += off; m.natDays += nat;
      m.act += act; m.absent += absent; m.unchecked += unchecked;
    }
    // 臨時人力：資料在 extras（只有廠商與組別），倉別／課別由組別回推後再套用報表篩選
    const wh = warehouses.find(w => w.id === selectedWarehouse);
    const whDepts = wh ? new Set((wh.departments ?? []).map(d => d.name)) : null;
    const isoSet = new Set(dks.map(isoOf));
    for (const [iso, list] of Object.entries(extras ?? {})) {
      if (!isoSet.has(iso)) continue;
      for (const x of (list ?? [])) {
        const owner = deptOfGroup(warehouses, x.group);
        if (whDepts && !(owner && whDepts.has(owner.deptName))) continue;
        if (filters.fDepts.length  && !(owner && filters.fDepts.includes(owner.deptName))) continue;
        if (filters.fGroups.length && !filters.fGroups.includes(x.group)) continue;
        if (filters.fVendors.length && !filters.fVendors.includes(x.vendor)) continue;
        const v = x.vendor || '未分配';
        map[v] ??= { people: 0, ids: new Set(), workDays: 0, hours: 0,
                     offDays: 0, natDays: 0, act: 0, absent: 0, unchecked: 0, tempDue: 0, tempAct: 0 };
        map[v].tempDue++;
        if (x.present) map[v].tempAct++;
      }
    }
    return map;
  }, [scoped, schedule, attendData, hoursOf, extras, warehouses, selectedWarehouse, filters]);

  const EMPTY = { people: 0, ids: new Set(), workDays: 0, hours: 0,
                  offDays: 0, natDays: 0, act: 0, absent: 0, unchecked: 0, tempDue: 0, tempAct: 0 };

  const rows = useMemo(() => {
    if (!spans) return [];
    const c = tally(spans.cur), p = tally(spans.prev);
    const names = sortVendorNames([...new Set([...Object.keys(c), ...Object.keys(p)])]);
    return names.map(v => {
      const a = c[v] ?? EMPTY, b = p[v] ?? EMPTY;
      // 人員異動：本期有排班但上期沒有＝新進；上期有本期沒有＝離開
      const joined = [...a.ids].filter(id => !b.ids.has(id)).length;
      const left   = [...b.ids].filter(id => !a.ids.has(id)).length;
      const checked = a.act + a.absent;   // 已點名的人次（未點名不計入分母）
      return {
        vendor: v,
        people: a.people, prevPeople: b.people, diffPeople: a.people - b.people,
        workDays: a.workDays, prevWorkDays: b.workDays, diffWorkDays: a.workDays - b.workDays,
        hours: a.hours, prevHours: b.hours, diffHours: a.hours - b.hours,
        offDays: a.offDays, natDays: a.natDays,
        act: a.act, absent: a.absent, unchecked: a.unchecked,
        fulfil: checked > 0 ? Math.round(a.act / checked * 100) : null,   // 長期到班率
        tempDue: a.tempDue, tempAct: a.tempAct,
        prevTempDue: b.tempDue, prevTempAct: b.tempAct,
        diffTempDue: a.tempDue - b.tempDue,
        tempFulfil: a.tempDue > 0 ? Math.round(a.tempAct / a.tempDue * 100) : null,
        joined, left,
        turnover: b.people > 0 ? Math.round(left / b.people * 100) : null, // 流失率
        avgWork: a.people ? (a.workDays / a.people) : 0,
      };
    });
  }, [spans, tally]);

  const total = useMemo(() => rows.reduce((t, r) => ({
    people: t.people + r.people, prevPeople: t.prevPeople + r.prevPeople,
    workDays: t.workDays + r.workDays, prevWorkDays: t.prevWorkDays + r.prevWorkDays,
    hours: t.hours + r.hours, prevHours: t.prevHours + r.prevHours,
    offDays: t.offDays + r.offDays, natDays: t.natDays + r.natDays,
    act: t.act + r.act, absent: t.absent + r.absent, unchecked: t.unchecked + r.unchecked,
    tempDue: t.tempDue + r.tempDue, tempAct: t.tempAct + r.tempAct,
    prevTempDue: t.prevTempDue + r.prevTempDue, prevTempAct: t.prevTempAct + r.prevTempAct,
    joined: t.joined + r.joined, left: t.left + r.left,
  }), { people: 0, prevPeople: 0, workDays: 0, prevWorkDays: 0, hours: 0, prevHours: 0,
        offDays: 0, natDays: 0, act: 0, absent: 0, unchecked: 0, tempDue: 0, tempAct: 0,
        prevTempDue: 0, prevTempAct: 0, joined: 0, left: 0 }), [rows]);

  const totalFulfil = (total.act + total.absent) > 0
    ? Math.round(total.act / (total.act + total.absent) * 100) : null;
  const totalTurnover = total.prevPeople > 0 ? Math.round(total.left / total.prevPeople * 100) : null;
  const totalTempFulfil = total.tempDue > 0 ? Math.round(total.tempAct / total.tempDue * 100) : null;

  const pct = (diff, prev) => prev === 0 ? (diff === 0 ? '—' : '新增') : `${diff >= 0 ? '+' : ''}${Math.round(diff / prev * 100)}%`;
  const diffCls = d => d > 0 ? 'text-teal-700' : d < 0 ? 'text-red-600' : 'text-slate-400';
  const fmtDiff = d => d > 0 ? `+${d}` : String(d);
  const fmtHr = h => h >= 1000 ? Math.round(h).toLocaleString() : h.toFixed(0);
  // 增減欄位：沒有變化就不顯示數字，避免整排 0 +0% 干擾閱讀
  const DeltaCell = ({ d, base }) => d === 0
    ? <span className="text-slate-300">—</span>
    : <span className={diffCls(d)}>{fmtDiff(d)}<span className="ml-1 opacity-70">({pct(d, base)})</span></span>;
  // 達成率／流失率的健康度配色，讓主管一眼看出哪一家該追
  const fulfilCls = r => r == null ? 'text-slate-400' : r >= 95 ? 'text-teal-700' : r >= 85 ? 'text-amber-600' : 'text-red-600';
  const turnoverCls = r => r == null ? 'text-slate-400' : r <= 5 ? 'text-teal-700' : r <= 15 ? 'text-amber-600' : 'text-red-600';


  const exportExcel = () => {
    if (rows.length === 0) { toast('目前條件下沒有資料可匯出', 'warn'); return; }
    const fmtD = d => `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
    const aoa = [
      ['月報表（人力需求與供應商績效）'],
      ['統計方式', mode === 'month' ? '依月份' : '依排班週期'],
      ['本期', `${fmtD(spans.cur.start)} ~ ${fmtD(spans.cur.end)}`],
      [`前一${spans.unit}`, `${fmtD(spans.prev.start)} ~ ${fmtD(spans.prev.end)}`],
      ['統計範圍', scopeLabel()],
      ['產出時間', new Date().toLocaleString('zh-TW')],
      [],
      ['【總體】'],
      ['總排班人次', total.workDays, `前一${spans.unit}`, total.prevWorkDays,
       '增減', total.workDays - total.prevWorkDays, '增減率', pct(total.workDays - total.prevWorkDays, total.prevWorkDays)],
      ['在廠人數（長期）', total.people, `前一${spans.unit}`, total.prevPeople,
       '新進', total.joined, '離開', total.left],
      ['到班率（長期）', totalFulfil == null ? '—' : `${totalFulfil}%`,
       '實到人次', total.act, '缺工人次', total.absent, '未點名人次', total.unchecked],
      ['到班率（臨時）', totalTempFulfil == null ? '—' : `${totalTempFulfil}%`,
       '實到人次', total.tempAct, '應到人次', total.tempDue],
      ['人員流失率', totalTurnover == null ? '—' : `${totalTurnover}%`],
      [],
      ['【各人力商】'],
      ['廠商', '在廠人數（長期）', `前一${spans.unit}人數`, '人數增減', '人數增減率',
       '排班人次', `前一${spans.unit}人次`, '人次增減', '人次增減率',
       '到班率（長期）', '實到人次', '缺工人次', '未點名人次',
       '臨時應到人次', '臨時實到人次', '到班率（臨時）',
       '新進', '離開', '流失率', '人均出勤天數'],
    ];
    rows.forEach(r => aoa.push([
      r.vendor, r.people, r.prevPeople, r.diffPeople, pct(r.diffPeople, r.prevPeople),
      r.workDays, r.prevWorkDays, r.diffWorkDays, pct(r.diffWorkDays, r.prevWorkDays),
      r.fulfil == null ? '—' : `${r.fulfil}%`, r.act, r.absent, r.unchecked,
      r.tempDue, r.tempAct, r.tempFulfil == null ? '—' : `${r.tempFulfil}%`,
      r.joined, r.left, r.turnover == null ? '—' : `${r.turnover}%`,
      Number(r.avgWork.toFixed(1)),
    ]));
    aoa.push(['合計', total.people, total.prevPeople, total.people - total.prevPeople,
      pct(total.people - total.prevPeople, total.prevPeople),
      total.workDays, total.prevWorkDays, total.workDays - total.prevWorkDays,
      pct(total.workDays - total.prevWorkDays, total.prevWorkDays),
      totalFulfil == null ? '—' : `${totalFulfil}%`, total.act, total.absent, total.unchecked,
      total.tempDue, total.tempAct, totalTempFulfil == null ? '—' : `${totalTempFulfil}%`,
      total.joined, total.left, totalTurnover == null ? '—' : `${totalTurnover}%`,
      total.people ? Number((total.workDays / total.people).toFixed(1)) : 0]);

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 12 }, ...Array(19).fill({ wch: 13 })];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '月報表');
    const tag = mode === 'month' ? ym : `${fmtD(spans.cur.start)}-${fmtD(spans.cur.end)}`.replace(/\//g, '');
    XLSX.writeFile(wb, `月報表_${tag}.xlsx`);
    toast('月報表已匯出', 'success');
  };

  if (!canView) return null;

  return (
    <div className="bg-white border border-[#DDD9D0] rounded-xl p-5">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <h3 className="font-semibold text-slate-700">月報表</h3>
        <span className="text-xs text-slate-400">排班人數統計與前期比較</span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* 統計方式 */}
          <div className="flex rounded-lg border border-[#DDD9D0] overflow-hidden text-sm">
            {[['month', '依月份'], ['period', '依排班週期']].map(([k, label]) => (
              <button key={k} onClick={() => setMode(k)}
                disabled={k === 'period' && !hasPeriod}
                title={k === 'period' && !hasPeriod ? '請先於系統設定設定「每期日期區間」' : undefined}
                className={`px-3 py-1.5 transition-colors
                  ${mode === k ? 'bg-[#1a2f5e] text-white font-semibold' : 'bg-white text-slate-600 hover:bg-slate-50'}
                  ${k === 'period' && !hasPeriod ? 'opacity-40 cursor-not-allowed' : ''}`}>
                {label}
              </button>
            ))}
          </div>

          {mode === 'month' ? (
            <input type="month" value={ym} onChange={e => setYm(e.target.value)}
              className="border border-[#DDD9D0] rounded-lg px-3 py-1.5 text-sm" />
          ) : (
            <div className="flex items-center gap-1">
              <button onClick={() => setPeriodOffset(v => v - 1)}
                className="px-2 py-1.5 bg-white border border-[#DDD9D0] rounded-lg text-sm hover:bg-slate-100 font-bold">◀</button>
              <span className={`px-3 py-1.5 border rounded-lg text-sm font-medium whitespace-nowrap
                ${periodOffset === 0 ? 'bg-teal-50 border-teal-200 text-blue-700' : 'bg-amber-50 border-amber-300 text-amber-700'}`}>
                📅 {spans ? spans.curLabel : '—'}
                {periodOffset !== 0 && <span className="ml-1 text-xs opacity-70">（{periodOffset > 0 ? `+${periodOffset}` : periodOffset} 期）</span>}
              </span>
              <button onClick={() => setPeriodOffset(v => v + 1)}
                className="px-2 py-1.5 bg-white border border-[#DDD9D0] rounded-lg text-sm hover:bg-slate-100 font-bold">▶</button>
            </div>
          )}

          <button onClick={exportExcel}
            className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700">
            📊 匯出 Excel
          </button>
        </div>
      </div>

      {bar}

      {!spans ? (
        <p className="text-sm text-amber-600">尚未設定「每期日期區間」，請先於系統設定完成後再使用週期統計。</p>
      ) : (
        <>
          <p className="text-xs text-slate-500 mb-3">
            本期 <b className="text-slate-700">{spans.curLabel}</b>
            　比較對象 <b className="text-slate-700">{spans.prevLabel}</b>
            　統計範圍 <b className="text-slate-700">{scopeLabel()}</b>
          </p>
          {/* 總體指標：先看整體變化幅度，再往下追各人力商 */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            {[
              { t: '總排班人次', v: total.workDays.toLocaleString(), unit: '人次',
                d: total.workDays - total.prevWorkDays, base: total.prevWorkDays,
                f: `前一${spans.unit} ${total.prevWorkDays.toLocaleString()}`, tone: 'blue' },
              { t: '在廠人數（長期）', v: total.people, unit: '人',
                d: total.people - total.prevPeople, base: total.prevPeople,
                f: `新進 ${total.joined}　離開 ${total.left}`, tone: 'green' },
              { t: '到班率（長期）', v: totalFulfil == null ? '—' : `${totalFulfil}%`, unit: '',
                d: null, base: null,
                f: `實到 ${total.act} / 應到 ${total.act + total.absent}${total.unchecked > 0 ? `　未點名 ${total.unchecked}` : ''}`,
                tone: totalFulfil == null ? 'slate' : totalFulfil >= 95 ? 'green' : totalFulfil >= 85 ? 'amber' : 'red' },
              { t: '到班率（臨時）', v: totalTempFulfil == null ? '—' : `${totalTempFulfil}%`, unit: '',
                d: null, base: null,
                f: `實到 ${total.tempAct} / 應到 ${total.tempDue}`,
                tone: totalTempFulfil == null ? 'slate' : totalTempFulfil >= 95 ? 'green' : totalTempFulfil >= 85 ? 'amber' : 'red' },
            ].map(k => {
              const bar = { blue: 'border-blue-500', cyan: 'border-cyan-500', green: 'border-emerald-500',
                            amber: 'border-amber-500', red: 'border-red-500', slate: 'border-slate-300' }[k.tone];
              return (
                <div key={k.t} className={`border border-[#DDD9D0] border-l-4 ${bar} rounded-xl px-3 py-2.5 bg-white`}>
                  <div className="text-[11px] text-slate-400">{k.t}</div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-extrabold text-slate-800 leading-tight">{k.v}</span>
                    {k.unit && <span className="text-[11px] text-slate-400">{k.unit}</span>}
                    {k.d != null && (
                      <span className={`ml-auto text-xs font-bold ${diffCls(k.d)}`}>
                        {fmtDiff(k.d)}
                        <span className="ml-1 font-normal">{pct(k.d, k.base)}</span>
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">{k.f}</div>
                </div>
              );
            })}
          </div>

          {totalTurnover != null && (
            <p className="text-xs text-slate-500 mb-3">
              人員流失率 <b className={turnoverCls(totalTurnover)}>{totalTurnover}%</b>
              （上一{spans.unit} {total.prevPeople} 人中有 {total.left} 人本期未再排班）
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              {/* 兩層表頭：長期（綠底）與臨時（黃底）分區，避免欄位一長排難以對照 */}
              <thead>
                <tr>
                  <th rowSpan={2} className="px-3 py-2 text-left font-semibold text-slate-600 text-xs
                                             bg-slate-100 border-b border-slate-200 whitespace-nowrap">廠商</th>
                  <th colSpan={5} className="px-3 py-1.5 text-center font-bold text-emerald-800 text-xs
                                             bg-emerald-100 border-b border-emerald-200">長期人力</th>
                  <th colSpan={4} className="px-3 py-1.5 text-center font-bold text-amber-800 text-xs
                                             bg-amber-100 border-b border-amber-200">臨時人力</th>
                  <th colSpan={3} className="px-3 py-1.5 text-center font-bold text-slate-500 text-xs
                                             bg-slate-100 border-b border-slate-200">人員異動</th>
                </tr>
                <tr>
                  {[['目前在廠人數', 'g'], [`前一${spans.unit}人次`, 'g'], [`本${spans.unit}人次`, 'g'],
                    ['人次差', 'g'], ['到班率（長期）', 'g'],
                    [`前一${spans.unit}人次`, 'a'], [`本${spans.unit}人次`, 'a'],
                    ['人次差', 'a'], ['到班率（臨時）', 'a'],
                    ['新進', 's'], ['離開', 's'], ['流失率', 's']].map(([h, tone], i) => (
                    <th key={h + i}
                      className={`px-3 py-2 text-left font-semibold text-xs whitespace-nowrap border-b border-slate-200
                        ${tone === 'g' ? 'bg-emerald-50 text-emerald-900'
                        : tone === 'a' ? 'bg-amber-50 text-amber-900'
                        : 'bg-slate-100 text-slate-600'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.length === 0 && (
                  <tr><td colSpan={13} className="px-3 py-6 text-center text-slate-400 text-sm">此區間內沒有排班資料</td></tr>
                )}
                {rows.map(r => (
                  <tr key={r.vendor} className="hover:bg-[#F5F2EC]">
                    <td className="px-3 py-2 font-medium text-slate-800 whitespace-nowrap">{r.vendor}</td>

                    {/* 長期 */}
                    <td className="px-3 py-2 font-bold text-slate-800 bg-emerald-50/40">
                      {r.people}
                      {r.diffPeople !== 0 && (
                        <span className={`ml-1 text-[11px] font-normal ${diffCls(r.diffPeople)}`}>{fmtDiff(r.diffPeople)}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-500 bg-emerald-50/40">{r.prevWorkDays.toLocaleString()}</td>
                    <td className="px-3 py-2 text-slate-800 font-semibold bg-emerald-50/40">{r.workDays.toLocaleString()}</td>
                    <td className="px-3 py-2 text-xs bg-emerald-50/40"><DeltaCell d={r.diffWorkDays} base={r.prevWorkDays} /></td>
                    <td className={`px-3 py-2 font-bold bg-emerald-50/40 ${fulfilCls(r.fulfil)}`}
                      title={`實到 ${r.act} / 應到 ${r.act + r.absent} 人次${r.unchecked > 0 ? `；未點名 ${r.unchecked} 人次未列入` : ''}`}>
                      {r.fulfil == null ? '—' : `${r.fulfil}%`}
                    </td>

                    {/* 臨時 */}
                    <td className="px-3 py-2 text-slate-500 bg-amber-50/40">{r.prevTempDue || '—'}</td>
                    <td className="px-3 py-2 text-slate-800 font-semibold bg-amber-50/40">{r.tempDue || '—'}</td>
                    <td className="px-3 py-2 text-xs bg-amber-50/40"><DeltaCell d={r.diffTempDue} base={r.prevTempDue} /></td>
                    <td className={`px-3 py-2 font-bold bg-amber-50/40 ${fulfilCls(r.tempFulfil)}`}
                      title={`實到 ${r.tempAct} / 派工 ${r.tempDue} 人次`}>
                      {r.tempFulfil == null ? '—' : `${r.tempFulfil}%`}
                    </td>

                    {/* 異動 */}
                    <td className="px-3 py-2 text-teal-700">{r.joined || '—'}</td>
                    <td className={r.left > 0 ? 'px-3 py-2 text-red-600' : 'px-3 py-2 text-slate-400'}>{r.left || '—'}</td>
                    <td className={`px-3 py-2 font-semibold ${turnoverCls(r.turnover)}`}>
                      {r.turnover == null ? '—' : `${r.turnover}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
              {rows.length > 0 && (
                <tfoot>
                  <tr className="bg-slate-50 font-semibold border-t-2 border-slate-300">
                    <td className="px-3 py-2 text-slate-700">合計</td>
                    <td className="px-3 py-2 text-slate-900">
                      {total.people}
                      {total.people - total.prevPeople !== 0 && (
                        <span className={`ml-1 text-[11px] font-normal ${diffCls(total.people - total.prevPeople)}`}>
                          {fmtDiff(total.people - total.prevPeople)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-500">{total.prevWorkDays.toLocaleString()}</td>
                    <td className="px-3 py-2 text-slate-800">{total.workDays.toLocaleString()}</td>
                    <td className="px-3 py-2 text-xs"><DeltaCell d={total.workDays - total.prevWorkDays} base={total.prevWorkDays} /></td>
                    <td className={`px-3 py-2 ${fulfilCls(totalFulfil)}`}>{totalFulfil == null ? '—' : `${totalFulfil}%`}</td>
                    <td className="px-3 py-2 text-slate-500">{total.prevTempDue || '—'}</td>
                    <td className="px-3 py-2 text-slate-800">{total.tempDue || '—'}</td>
                    <td className="px-3 py-2 text-xs"><DeltaCell d={total.tempDue - total.prevTempDue} base={total.prevTempDue} /></td>
                    <td className={`px-3 py-2 ${fulfilCls(totalTempFulfil)}`}>{totalTempFulfil == null ? '—' : `${totalTempFulfil}%`}</td>
                    <td className="px-3 py-2 text-teal-700">{total.joined}</td>
                    <td className={total.left > 0 ? 'px-3 py-2 text-red-600' : 'px-3 py-2 text-slate-400'}>{total.left}</td>
                    <td className={`px-3 py-2 ${turnoverCls(totalTurnover)}`}>{totalTurnover == null ? '—' : `${totalTurnover}%`}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">
            在廠人數／排班人次僅計長期人力；排班人次＝班表「V」的格數。
            到班率（長期）＝實到人次 ÷ 已點名的應到人次（未點名不列入分母）；
            到班率（臨時）＝點名表派工名單中已到班的人次 ÷ 該期間派工人次；
            新進／離開＝與前一{spans.unit}比較有無排班紀錄；流失率＝離開人數 ÷ 前一{spans.unit}人數。
            倉別沿用上方篩選列，其餘條件以本區塊的「報表篩選」為準。
          </p>
        </>
      )}
    </div>
  );
}

function Reports() {
  const { employees, schedule, selectedYear, selectedMonth, setSelectedYear, setSelectedMonth,
    warehouses, selectedWarehouse, selectedDept, selectedGroup, selectedWorkArea,
    vendorCompanyNames, currentUser, deptRanges, deptSegments } = useApp();
  const toast = useToast();

  const [viewOffset, setViewOffset] = useState(0);
  // 全域區間已取消，報表檢視改用各課別區間的聯集（涵蓋所有課別）
  const reportRange = useMemo(() => unionAllSegments(deptSegments, deptRanges), [deptSegments, deptRanges]);
  const didInitOffset = useRef(false);
  useEffect(() => {
    if (didInitOffset.current || !reportRange.start || !reportRange.end) return;
    didInitOffset.current = true;
    const off = todayPeriodOffset(reportRange);
    if (off !== 0) setViewOffset(off);
  }, [reportRange]);
  const rangeMode = !!(reportRange.start && reportRange.end);
  const viewRange = useMemo(() => {
    if (!rangeMode) return null;
    const s = parseLocal(reportRange.start);
    const e = parseLocal(reportRange.end);
    const len = Math.round((e - s) / 86400000); // 首尾天數差（不含尾）
    const shift = viewOffset * (len + 1); // +1：含頭含尾的完整天數，避免下一期與前一期重疊
    const vs = new Date(s); vs.setDate(vs.getDate() + shift);
    const ve = new Date(e); ve.setDate(ve.getDate() + shift);
    const fmt = d => `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
    return { start: fmt(vs), end: fmt(ve), len };
  }, [rangeMode, reportRange, viewOffset]);

  // 依目前選擇週期建立日期陣列
  const reportDates = useMemo(() => {
    const WD = ['日','一','二','三','四','五','六'];
    if (rangeMode && viewRange) {
      const result = [];
      const cur = parseLocal(viewRange.start);
      const end = parseLocal(viewRange.end);
      while (cur <= end) {
        result.push({ year: cur.getFullYear(), month: cur.getMonth()+1, day: cur.getDate(), wd: WD[cur.getDay()] });
        cur.setDate(cur.getDate() + 1);
      }
      return result;
    }
    const dc = getDaysInMonth(selectedYear, selectedMonth);
    return Array.from({ length: dc }, (_, i) => {
      const d = new Date(selectedYear, selectedMonth-1, i+1);
      return { year: selectedYear, month: selectedMonth, day: i+1, wd: WD[d.getDay()] };
    });
  }, [rangeMode, viewRange, selectedYear, selectedMonth]);

  const years = useMemo(() => Array.from({length:5}, (_,i) => new Date().getFullYear() - 2 + i), []);
  const months = Array.from({length:12}, (_,i) => i+1);

  const scopedEmployees = useMemo(() => {
    let list = currentUser.role === ROLES.VENDOR
      ? employees.filter(e => currentUser.vendors.includes(e.vendor))
      : employees.filter(e => e.vendor && e.vendor.trim() !== '');
    return filterByScope(list, warehouses, selectedWarehouse, selectedDept, selectedGroup, selectedWorkArea);
  }, [employees, currentUser, warehouses, selectedWarehouse, selectedDept, selectedGroup, selectedWorkArea]);

  const buildVendorSheet = (vendor) => {
    const emps       = scopedEmployees.filter(e => e.vendor === vendor);
    const daysCount  = reportDates.length;
    const startD     = reportDates[0];
    const endD       = reportDates[daysCount - 1];
    const rocYearS   = startD.year - 1911;
    const rocYearE   = endD.year   - 1911;
    const tableTitle = rangeMode ? '排班確認表' : '當月排班確認表';
    const companyName = vendorCompanyNames[vendor] ?? vendor;
    const dateRange = rocYearS === rocYearE
      ? `確認排班區間：${rocYearS}年${startD.month}月${startD.day}日~${rocYearS}年${endD.month}月${endD.day}日`
      : `確認排班區間：${rocYearS}年${startD.month}月${startD.day}日~${rocYearE}年${endD.month}月${endD.day}日`;

    // 假日備註：找出本週期內的國定假日，若員工調移則備註
    const periodHolidays = NATIONAL_HOLIDAYS.filter(
      h => reportDates.some(d => d.year === h.year && d.month === h.month && d.day === h.day)
    );
    const getRemarks = (emp) => {
      const parts = [];
      for (const h of periodHolidays) {
        const dk = dateKey(h.year, h.month, h.day);
        const codeOnHoliday = schedule[emp.id]?.[dk] ?? 'V';
        if (codeOnHoliday !== '國') {
          const foundDate = reportDates.find(d => (schedule[emp.id]?.[dateKey(d.year, d.month, d.day)] ?? 'V') === '國');
          if (foundDate) parts.push(`原${h.month}/${h.day}國定假日${h.name}調移至${foundDate.month}/${foundDate.day}`);
        }
      }
      return parts.join('；');
    };

    const countCode = (emp, code) =>
      reportDates.filter(d => (schedule[emp.id]?.[dateKey(d.year, d.month, d.day)] ?? 'V') === code).length;

    const totalCols = 3 + daysCount + 4 + 3;
    const dc = 3 + daysCount;
    const midCol = Math.floor((3 + dc) / 2);
    const rgtCol = dc - 3;

    const monthRow = new Array(totalCols).fill(null);
    monthRow[1] = '月份';
    reportDates.forEach((d, i) => { monthRow[2 + (i+1)] = d.month; });
    monthRow[dc] = '各假別計算'; monthRow[dc+4] = '員工簽名'; monthRow[dc+5] = '確認日期'; monthRow[dc+6] = '備註';

    const dateRow = new Array(totalCols).fill(null);
    dateRow[1] = '日期';
    reportDates.forEach((d, i) => { dateRow[2 + (i+1)] = d.day; });
    dateRow[dc] = '請假\n天數'; dateRow[dc+1] = '休假\n天數'; dateRow[dc+2] = '例假日\n天數'; dateRow[dc+3] = '國定\n假日\n天數';

    const weekRow = new Array(totalCols).fill(null);
    weekRow[1] = '星期';
    reportDates.forEach((d, i) => { weekRow[2 + (i+1)] = d.wd; });

    const headerRow = new Array(totalCols).fill(null);
    headerRow[1] = '員工編號'; headerRow[2] = '員工姓名';

    const empRows = emps.map(emp => {
      const r = new Array(totalCols).fill(null);
      r[1] = emp.empId; r[2] = emp.name;
      reportDates.forEach((d, i) => {
        r[2 + (i+1)] = schedule[emp.id]?.[dateKey(d.year, d.month, d.day)] ?? 'V';
      });
      r[dc]   = countCode(emp, '事') + countCode(emp, '病');
      r[dc+1] = countCode(emp, '休');
      r[dc+2] = countCode(emp, '例');
      r[dc+3] = countCode(emp, '國');
      r[dc+6] = getRemarks(emp);
      return r;
    });

    const noteRow1 = new Array(totalCols).fill(null);
    noteRow1[1] = '1. 本表僅供排班及出勤／休假日確認使用，標示說明如下：實際出勤、請假、加班、補休及薪資計算，仍以公司系統紀錄及相關規定為準。';
    noteRow1[dc+4] = '人力廠商 假別確認簽章';
    const noteRow2 = new Array(totalCols).fill(null);
    noteRow2[1] = '     ※班別／狀態說明：V＝出勤日　例＝例假日　休＝休假日　事＝事假　病＝病假　國＝國定假日';
    const noteRow3 = new Array(totalCols).fill(null);
    noteRow3[1] = '2. 排班確認表經勞資雙方個別協商確認，員工簽名即同意配合公司實施八週彈性工時進行工作日、休息日及國定假日之調移，調移後之具體日期如本表所載。';

    const titleRow = new Array(totalCols).fill(null);
    titleRow[1] = companyName; titleRow[midCol] = tableTitle; titleRow[rgtCol] = dateRange;

    return [
      new Array(totalCols).fill(null),
      titleRow,
      new Array(totalCols).fill(null),
      noteRow1, noteRow2, noteRow3,
      new Array(totalCols).fill(null),
      monthRow, dateRow, weekRow, headerRow,
      ...empRows,
    ];
  };

  const applySheetStyles = (ws, daysInMonth, empsCount) => {
    const dc        = 3 + daysInMonth;   // first count-col index (0-based)
    const totalCols = dc + 7;
    const midCol    = Math.floor((3 + dc) / 2);
    const rgtCol    = dc - 3;

    // ── helpers ──────────────────────────────────────────────────────────
    const colLetter = (idx) => {
      let s = '', i = idx + 1;
      while (i > 0) { const m = (i-1)%26; s = String.fromCharCode(65+m)+s; i = Math.floor((i-1)/26); }
      return s;
    };
    const cr  = (r, c) => colLetter(c) + (r + 1);
    const ec  = (r, c) => { const k = cr(r,c); if (!ws[k]) ws[k] = {t:'s',v:''}; return ws[k]; };
    const sty = (r, c, s) => { ec(r,c).s = s; };

    const F    = '微軟正黑體';
    const thin = { style:'thin', color:{rgb:'000000'} };
    const bdr  = { top:thin, bottom:thin, left:thin, right:thin };
    const bdrM = bdr;

    // colour palette matching reference
    const ODD  = 'BDD7EE';  // light blue  (odd  7-day block)
    const EVEN = 'F2F2F2';  // light grey  (even 7-day block)
    const CBLUE= '0070C0';  // solid blue  count-col headers
    const CGRN = 'E2EFDA';  // light green count-col data
    const SALM = 'FCE4D6';  // light salmon sig / date cols
    const WHITE= 'FFFFFF';

    const weekBg = (d) => Math.floor((d-1)/7) % 2 === 0 ? ODD : EVEN;

    const mkS = (bg, rgb, sz, bold, halign, wrap) => ({
      font:      { name:F, sz:sz||12, bold:!!bold, color:{rgb: rgb||'000000'} },
      fill:      bg ? { patternType:'solid', fgColor:{rgb:bg} } : {},
      alignment: { horizontal:halign||'center', vertical:'center', wrapText:!!wrap },
      border:    bdr,
    });

    // ── row heights (hpt = height in points) ─────────────────────────────
    ws['!rows'] = [
      {hpt:8},   // r0  row1 spacer
      {hpt:30},  // r1  row2 title
      {hpt:8},   // r2  row3 spacer
      {hpt:25},  // r3  row4 note1
      {hpt:25},  // r4  row5 note2
      {hpt:25},  // r5  row6 note3
      {hpt:8},   // r6  row7 spacer
      {hpt:20},  // r7  row8  月份
      {hpt:20},  // r8  row9  日期
      {hpt:20},  // r9  row10 星期
      {hpt:20},  // r10 row11 員工編號
      ...Array.from({length:empsCount}, ()=>({hpt:30})),
    ];

    // ── column widths ─────────────────────────────────────────────────────
    ws['!cols'] = [
      {wch:1.5},  // A spacer
      {wch:16},   // B empId
      {wch:11},   // C empName
      ...Array.from({length:daysInMonth}, ()=>({wch:4.5})),
      {wch:5.5},{wch:5.5},{wch:5.5},{wch:5.5},  // 4 count cols
      {wch:21},   // sig
      {wch:11},   // confirm date
      {wch:30},   // remarks
      {wch:1.5},  // trailing spacer
    ];

    // ── merges ────────────────────────────────────────────────────────────
    ws['!merges'] = [
      // note rows B:count_end
      {s:{r:3,c:1}, e:{r:3,c:dc+3}},
      {s:{r:4,c:1}, e:{r:4,c:dc+3}},
      {s:{r:5,c:1}, e:{r:5,c:dc+3}},
      // 人力廠商 box spans note rows + sig cols
      {s:{r:3,c:dc+4}, e:{r:5,c:dc+6}},
      // header label cells B:C merged per row
      {s:{r:7,c:1}, e:{r:7,c:2}},   // 月份
      {s:{r:8,c:1}, e:{r:8,c:2}},   // 日期
      {s:{r:9,c:1}, e:{r:9,c:2}},   // 星期
      // 各假別計算 spans 4 count cols in month row
      {s:{r:7,c:dc}, e:{r:7,c:dc+3}},
      // sig / date / remarks span all 4 header rows (r7–r10)
      {s:{r:7,c:dc+4}, e:{r:10,c:dc+4}},
      {s:{r:7,c:dc+5}, e:{r:10,c:dc+5}},
      {s:{r:7,c:dc+6}, e:{r:10,c:dc+6}},
      // count headers span rows 日期→員工編號 (r8–r10)
      {s:{r:8,c:dc},   e:{r:10,c:dc}},
      {s:{r:8,c:dc+1}, e:{r:10,c:dc+1}},
      {s:{r:8,c:dc+2}, e:{r:10,c:dc+2}},
      {s:{r:8,c:dc+3}, e:{r:10,c:dc+3}},
      // each date col: 星期 row merged down into 員工編號 row (r9–r10)
      ...Array.from({length:daysInMonth}, (_,i) => ({s:{r:9,c:3+i}, e:{r:10,c:3+i}})),
    ];

    // ── title row (r=1) ───────────────────────────────────────────────────
    sty(1, 1,      { font:{name:F,sz:16,bold:true,color:{rgb:'CC0000'}}, alignment:{horizontal:'left',  vertical:'center'} });
    sty(1, midCol, { font:{name:F,sz:16,bold:true,color:{rgb:'000000'}}, alignment:{horizontal:'center',vertical:'center'} });
    sty(1, rgtCol, { font:{name:F,sz:11,bold:true,color:{rgb:'000000'}}, alignment:{horizontal:'right', vertical:'center'} });

    // ── note rows (r=3,4,5) ───────────────────────────────────────────────
    const noteS = mkS(WHITE,'333333',10,false,'left',true);
    for (let r=3;r<=5;r++) sty(r, 1, noteS);
    // 人力廠商 box — medium border, salmon bg
    sty(3, dc+4, { font:{name:F,sz:11,bold:true,color:{rgb:'000000'}},
                   fill:{patternType:'solid',fgColor:{rgb:SALM}},
                   alignment:{horizontal:'center',vertical:'center',wrapText:true},
                   border:bdrM });

    // ── header rows ───────────────────────────────────────────────────────
    const hLbl = mkS(EVEN,'000000',12,false,'center',false);  // light gray — not blank
    const hCnt = mkS(CBLUE,'FFFFFF',10,true,'center',true);
    const hSig = mkS(SALM,'000000',12,false,'center',true);
    const hRmk = mkS(EVEN,'000000',12,false,'left',false);

    // row 7 (月份): label B:C, month-number cells, 各假別計算, sig/date/remarks
    sty(7,1,hLbl); sty(7,2,hLbl);
    for (let i=0;i<daysInMonth;i++) sty(7,3+i, mkS(weekBg(i+1),'000000',12,false,'center',false));
    for (let i=0;i<4;i++) sty(7,dc+i,hCnt);
    sty(7,dc+4,hSig); sty(7,dc+5,hSig); sty(7,dc+6,hRmk);

    // row 8 (日期): label, day numbers, count headers (rowspan covers r8-r10)
    sty(8,1,hLbl); sty(8,2,hLbl);
    for (let i=0;i<daysInMonth;i++) sty(8,3+i, mkS(weekBg(i+1),'000000',12,false,'center',false));
    for (let i=0;i<4;i++) sty(8,dc+i,hCnt);

    // row 9 (星期): label, weekday chars (each merges down into r10)
    sty(9,1,hLbl); sty(9,2,hLbl);
    for (let i=0;i<daysInMonth;i++) sty(9,3+i, mkS(weekBg(i+1),'000000',12,false,'center',false));

    // row 10 (員工編號 / 員工姓名): only B and C visible (date cols merged from r9)
    sty(10,1,hLbl); sty(10,2,hLbl);

    // ── data rows ─────────────────────────────────────────────────────────
    for (let row=0; row<empsCount; row++) {
      const r = 11 + row;
      sty(r,1, mkS(WHITE,'000000',12,false,'center',false));
      sty(r,2, mkS(WHITE,'000000',12,false,'center',false));
      for (let i=0;i<daysInMonth;i++) sty(r,3+i, mkS(weekBg(i+1),'000000',12,false,'center',false));
      for (let i=0;i<4;i++) sty(r,dc+i,  mkS(CGRN,'000000',12,false,'center',false));
      sty(r,dc+4, mkS(SALM,'000000',12,false,'center',false));
      sty(r,dc+5, mkS(SALM,'000000',12,false,'center',false));
      sty(r,dc+6, mkS(EVEN,'000000',12,false,'left',true));
    }

    // ── border sweep: ensure every cell in the table area has borders ──────
    // Merged cells whose non-top-left members have no style need borders set
    // so Excel renders the outer boundary of each merge correctly.
    for (let r = 7; r <= 10 + empsCount; r++) {
      for (let c = 1; c <= dc + 6; c++) {
        const cell = ec(r, c);
        if (!cell.s) cell.s = { border: bdr, alignment: { horizontal: 'center', vertical: 'center' } };
        else cell.s.border = bdr;
      }
    }
    // Note rows: vendor box cells
    for (let r = 3; r <= 5; r++) {
      for (let c = 1; c <= dc + 6; c++) {
        const cell = ec(r, c);
        if (!cell.s) cell.s = { border: bdr };
        else cell.s.border = bdr;
      }
    }
    // Restore medium border on vendor box top-left
    ec(3, dc+4).s.border = bdrM;
  };

  const exportVendor = (vendor) => {
    try {
      const wb   = XLSX.utils.book_new();
      const emps = scopedEmployees.filter(e => e.vendor === vendor);
      const wsData = buildVendorSheet(vendor);
      const ws   = XLSX.utils.aoa_to_sheet(wsData);
      applySheetStyles(ws, reportDates.length, emps.length);
      XLSX.utils.book_append_sheet(wb, ws, vendor.substring(0, 30));
      const buf  = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
      const label = rangeMode && viewRange
        ? `${viewRange.start.replace(/-/g,'')}~${viewRange.end.replace(/-/g,'')}`
        : `${selectedYear}${String(selectedMonth).padStart(2,'0')}`;
      saveAs(new Blob([buf], { type: 'application/octet-stream' }),
        `班表_${vendor}_${label}.xlsx`);
      toast(`已匯出 ${vendor} 班表`, 'success');
    } catch (err) {
      toast('匯出失敗：' + err.message, 'error');
    }
  };


  const vendors = useMemo(() => [...new Set(scopedEmployees.map(e => e.vendor))], [scopedEmployees]);

  const exportAll = async () => {
    for (const v of vendors) exportVendor(v);
    toast(`批次匯出完成，共 ${vendors.length} 個廠商`, 'success');
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <h2 className="text-xl font-bold text-slate-800">報表匯出</h2>
        <div className="flex items-center gap-2 flex-wrap">
          {rangeMode ? (
            <div className="flex items-center gap-1">
              <button onClick={() => setViewOffset(v => v - 1)}
                className="px-2 py-1.5 bg-white border border-[#DDD9D0] rounded-lg text-sm hover:bg-slate-100 font-bold"
                title="上一個週期">◀</button>
              <span className={`px-3 py-1.5 border rounded-lg text-sm font-medium
                ${viewOffset === 0 ? 'bg-teal-50 border-teal-200 text-blue-700' : 'bg-amber-50 border-amber-300 text-amber-700'}`}>
                📅 {viewRange?.start} ~ {viewRange?.end}
                {viewOffset !== 0 && <span className="ml-1 text-xs opacity-70">（{viewOffset > 0 ? `+${viewOffset}` : viewOffset} 期）</span>}
              </span>
              <button onClick={() => setViewOffset(v => v + 1)}
                className="px-2 py-1.5 bg-white border border-[#DDD9D0] rounded-lg text-sm hover:bg-slate-100 font-bold"
                title="下一個週期">▶</button>
              {viewOffset !== todayPeriodOffset(reportRange) && (
                <button onClick={() => setViewOffset(todayPeriodOffset(reportRange))}
                  className="px-2 py-1.5 bg-blue-100 border border-blue-300 text-blue-700 rounded-lg text-xs hover:bg-blue-200">
                  回目前
                </button>
              )}
            </div>
          ) : (
            <>
              <select value={selectedYear} onChange={e => setSelectedYear(+e.target.value)}
                className="border border-[#DDD9D0] rounded-lg px-2 py-1.5 text-sm">
                {years.map(y => <option key={y} value={y}>{y}年</option>)}
              </select>
              <select value={selectedMonth} onChange={e => setSelectedMonth(+e.target.value)}
                className="border border-[#DDD9D0] rounded-lg px-2 py-1.5 text-sm">
                {months.map(m => <option key={m} value={m}>{m}月</option>)}
              </select>
            </>
          )}
          <button onClick={exportAll}
            className="px-4 py-2 bg-slate-800 text-white rounded-lg text-sm hover:bg-slate-900">
            📦 批次匯出全部廠商
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {vendors.map(vendor => {
          const count = scopedEmployees.filter(e => e.vendor === vendor).length;
          return (
            <div key={vendor}
              className="bg-white border border-[#DDD9D0] rounded-xl p-5 flex flex-col gap-3">
              <div>
                <div className="font-semibold text-slate-800">{vendor}</div>
                <div className="text-sm text-slate-500">{count} 人員</div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => exportVendor(vendor)}
                  className="w-full py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
                  📊 匯出 Excel
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* 日報表與月報表僅日翊員工／管理員可見 */}
      {(currentUser?.role === ROLES.ADMIN || currentUser?.role === ROLES.AREA) && (<>
        <DailySummary />
        <MonthlySummary />
      </>)}

      <div className="bg-teal-50 border border-teal-200 rounded-xl p-4 text-sm text-blue-700">
        <p className="font-medium mb-1">匯出說明</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>每份報表自動包含法規宣告文字與主管簽章欄位</li>
          <li>批次匯出將依廠商別生成獨立的 .xlsx 檔案</li>
          <li>匯出內容以當前班表資料為準</li>
        </ul>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// SYSTEM SETTINGS
// ─────────────────────────────────────────────

// 國定假日短名對照
const HOLIDAY_SHORT = {
  '元旦': '元旦', '農曆除夕': '除夕',
  '二二八和平紀念日': '228', '兒童節': '兒童節',
  '清明節': '清明', '勞動節': '勞動節',
  '端午節': '端午', '中秋節': '中秋', '國慶日': '國慶',
  '教師節': '教師節', '光復節': '光復', '行憲紀念日': '行憲',
  '小年夜': '小年夜',
};
const getHolidayShort = (h, springIdx) => {
  if (h.name === '春節') return ['初一','初二','初三'][springIdx] ?? '春節';
  return HOLIDAY_SHORT[h.name] ?? h.name;
};
// key 格式: "year-month-day"
const holidayKey = (h) => `${h.year}-${h.month}-${h.day}`;

// ─────────────────────────────────────────────
// ATTENDANCE (點名表)
// ─────────────────────────────────────────────

const DEFAULT_ATTEND_SETTINGS = {
  leaveTypes: ['事假', '病假', '特休假', '公假', '喪假', '婚假', '其他'],
  lateEarlyStatus: ['正常到班（無遲到早退）', '遲到', '早退', '遲到且早退'],
  groups: [],
};

function AttendSubBtn({ active, onClick, icon, label }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
        ${active
          ? 'border-blue-600 text-blue-700 bg-white'
          : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-[#F5F2EC]'}`}>
      {label}
    </button>
  );
}

const MaintTagList = ({ items, onRemove }) => (
  <div className="flex flex-wrap gap-2 mt-2">
    {(items ?? []).map(item => (
      <span key={item} className="flex items-center gap-1 bg-slate-100 text-slate-700 px-3 py-1 rounded-full text-xs">
        {item}
        <button onClick={() => onRemove(item)} className="text-slate-400 hover:text-red-500 ml-1 text-sm leading-none">×</button>
      </span>
    ))}
  </div>
);

const MaintAddRow = ({ value, onChange, onAdd, placeholder }) => (
  <div className="flex gap-2 mt-2">
    <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      onKeyDown={e => e.key === 'Enter' && onAdd()}
      className="flex-1 border border-[#DDD9D0] rounded-lg px-3 py-1.5 text-sm" />
    <button onClick={onAdd}
      className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">新增</button>
  </div>
);

function MaintPane({ attendSettings, setAttendSettings, groupOptions }) {
  const { attendData, setAttendData, employees } = useApp();
  const toast = useToast();
  const [newLeave, setNewLeave] = useState('');
  const [newGroup, setNewGroup] = useState('');
  const [newStatus, setNewStatus] = useState('');
  const [cleanStart, setCleanStart] = useState('');
  const [cleanEnd, setCleanEnd] = useState('');
  const [cleanGroup, setCleanGroup] = useState('');
  const [cleanPreview, setCleanPreview] = useState(null);
  const [cleanConfirm, setCleanConfirm] = useState(false);

  const addItem = (key, val, setter) => {
    if (!val.trim()) return;
    if ((attendSettings[key] ?? []).includes(val.trim())) { toast('已存在', 'warn'); return; }
    setAttendSettings(prev => ({ ...prev, [key]: [...(prev[key] ?? []), val.trim()] }));
    setter('');
  };
  const removeItem = (key, val) =>
    setAttendSettings(prev => ({ ...prev, [key]: (prev[key] ?? []).filter(x => x !== val) }));

  const previewClean = () => {
    if (!cleanStart || !cleanEnd) { toast('請設定起迄日期', 'error'); return; }
    let count = 0;
    Object.keys(attendData).forEach(dk => {
      if (dk >= cleanStart && dk <= cleanEnd) {
        if (!cleanGroup) count += Object.keys(attendData[dk]).length;
        else {
          const g = cleanGroup;
          count += employees.filter(e => (e.shiftType === g || e.group === g) && attendData[dk][e.id]).length;
        }
      }
    });
    setCleanPreview(count);
    setCleanConfirm(false);
  };

  const executeClean = () => {
    setAttendData(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(dk => {
        if (dk >= cleanStart && dk <= cleanEnd) {
          if (!cleanGroup) { delete next[dk]; }
          else {
            const day = { ...next[dk] };
            const g = cleanGroup;
            employees.filter(e => e.shiftType === g || e.group === g).forEach(e => delete day[e.id]);
            next[dk] = day;
          }
        }
      });
      return next;
    });
    toast('已清除完成', 'success');
    setCleanPreview(null); setCleanConfirm(false);
  };

  return (
    <div className="space-y-5">
      <div className="bg-white border border-[#DDD9D0] rounded-xl p-5 space-y-5">
        <h3 className="font-semibold text-slate-700">系統參數維護</h3>
        <div>
          <div className="text-sm font-medium text-slate-600">🏖 請假別</div>
          <MaintTagList items={attendSettings.leaveTypes} onRemove={v => removeItem('leaveTypes', v)} />
          <MaintAddRow value={newLeave} onChange={setNewLeave} placeholder="新增假別（Enter確認）"
            onAdd={() => addItem('leaveTypes', newLeave, setNewLeave)} />
        </div>
        <div className="border-t border-slate-100 pt-4">
          <div className="text-sm font-medium text-slate-600">🏭 作業組別</div>
          <MaintTagList items={attendSettings.groups} onRemove={v => removeItem('groups', v)} />
          <MaintAddRow value={newGroup} onChange={setNewGroup} placeholder="新增組別"
            onAdd={() => addItem('groups', newGroup, setNewGroup)} />
        </div>
        <div className="border-t border-slate-100 pt-4">
          <div className="text-sm font-medium text-slate-600">📊 出勤狀況</div>
          <MaintTagList items={attendSettings.lateEarlyStatus} onRemove={v => removeItem('lateEarlyStatus', v)} />
          <MaintAddRow value={newStatus} onChange={setNewStatus} placeholder="新增出勤狀況"
            onAdd={() => addItem('lateEarlyStatus', newStatus, setNewStatus)} />
        </div>
      </div>

      <div className="bg-white border border-rose-100 rounded-xl p-5">
        <h3 className="font-semibold text-slate-700 mb-1">🗑 異常資料清理</h3>
        <p className="text-xs text-slate-400 mb-4">清除特定日期範圍的點名記錄，此操作不可逆。</p>
        <div className="flex flex-wrap gap-3 items-end mb-4">
          <div>
            <label className="block text-xs text-slate-500 mb-1">起始日期</label>
            <input type="date" value={cleanStart} onChange={e => setCleanStart(e.target.value)}
              className="border border-[#DDD9D0] rounded-lg px-3 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">迄止日期</label>
            <input type="date" value={cleanEnd} onChange={e => setCleanEnd(e.target.value)}
              className="border border-[#DDD9D0] rounded-lg px-3 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">清除組別</label>
            <select value={cleanGroup} onChange={e => setCleanGroup(e.target.value)}
              className="border border-[#DDD9D0] rounded-lg px-3 py-1.5 text-sm min-w-[140px]">
              <option value="">全部</option>
              {groupOptions.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <button onClick={previewClean}
            className="px-4 py-2 bg-slate-600 hover:bg-slate-700 text-white rounded-lg text-sm">
            預覽影響筆數
          </button>
        </div>
        {cleanPreview !== null && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-4">
            <p className="text-sm text-rose-700">
              將清除 <strong>{cleanStart}</strong> 至 <strong>{cleanEnd}</strong>
              {cleanGroup ? `（${cleanGroup}）` : '（全部組別）'} 共 <strong>{cleanPreview}</strong> 筆資料。
            </p>
            {!cleanConfirm ? (
              <button onClick={() => setCleanConfirm(true)}
                className="mt-3 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-sm">
                確認清除
              </button>
            ) : (
              <div className="mt-3 flex gap-2 items-center">
                <span className="text-sm text-rose-600 font-medium">確定要永久清除？</span>
                <button onClick={executeClean}
                  className="px-4 py-1.5 bg-rose-700 hover:bg-rose-800 text-white rounded-lg text-sm">確認</button>
                <button onClick={() => setCleanConfirm(false)}
                  className="px-4 py-1.5 border border-[#DDD9D0] rounded-lg text-sm hover:bg-[#F5F2EC]">取消</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ReportPane({ generateReport, groupOptions, attendDate, selectedGroup }) {
  const toast = useToast();
  const [rDate, setRDate] = useState(attendDate);
  const [rGroup, setRGroup] = useState(selectedGroup ?? '');
  // 跟隨上方篩選列：useState 初始值只在掛載時生效，之後切換組別須靠 effect 同步
  useEffect(() => { setRGroup(selectedGroup ?? ''); }, [selectedGroup]);
  const [text, setText] = useState('');
  const textRef = React.useRef(null);

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(
      () => toast('已複製至剪貼簿', 'success'),
      () => { textRef.current?.select(); document.execCommand('copy'); toast('已複製', 'success'); }
    );
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-[#DDD9D0] rounded-xl p-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-slate-500 mb-1">出勤日期</label>
          <input type="date" value={rDate} onChange={e => setRDate(e.target.value)}
            className="border border-[#DDD9D0] rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">作業組別</label>
          <select value={rGroup} onChange={e => setRGroup(e.target.value)}
            className="border border-[#DDD9D0] rounded-lg px-3 py-2 text-sm min-w-[160px]">
            <option value="">全部</option>
            {groupOptions.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        <button onClick={() => setText(generateReport(rDate, rGroup))}
          className="px-4 py-2 bg-[#1a2f5e] hover:bg-[#1e3870] text-white rounded-lg text-sm font-medium">
          📋 產生回報文字
        </button>
      </div>

      {text ? (
        <div className="bg-white border border-[#DDD9D0] rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-slate-700">出勤回報（可直接編輯）</span>
            <button onClick={handleCopy}
              className="px-3 py-1.5 bg-[#1a2f5e] hover:bg-[#1e3870] text-white rounded-lg text-xs font-medium">
              📋 一鍵複製文字
            </button>
          </div>
          <textarea ref={textRef} value={text} onChange={e => setText(e.target.value)}
            rows={12}
            className="w-full border border-[#DDD9D0] rounded-lg px-3 py-2 text-sm font-mono resize-y" />
        </div>
      ) : (
        <p className="text-sm text-slate-400 text-center py-8">選擇日期與組別後，點擊「產生回報文字」</p>
      )}
    </div>
  );
}

function ImportPane({ todayStr }) {
  const { selectedGroup, setExtras, attendSettings } = useApp();
  const toast = useToast();
  const defaultStatus = attendSettings.lateEarlyStatus?.[0] ?? '正常到班（無遲到早退）';
  const activeGroup = selectedGroup;

  const [importStart, setImportStart] = useState(todayStr);
  const [importEnd,   setImportEnd]   = useState(todayStr);
  const [parsedRows,  setParsedRows]  = useState(null);
  const [fileName,    setFileName]    = useState('');
  const [importing,   setImporting]   = useState(false);

  const parseRocDate = (raw) => {
    if (raw == null) return null;
    const s = String(raw).trim();
    if (!s) return null;
    if (s.includes('/')) {
      const parts = s.split('/');
      if (parts.length === 3) {
        const [y, m, d] = parts.map(Number);
        const wy = y < 1000 ? y + 1911 : y;
        return `${wy}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      }
    }
    if (!isNaN(Number(s))) {
      const serial = Number(s);
      const epoch = new Date(1899, 11, 30);
      const dt = new Date(epoch.getTime() + serial * 86400000);
      return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
    }
    return null;
  };

  const findColIdx = (headers, keywords) =>
    headers.findIndex(h => keywords.some(k => String(h ?? '').includes(k)));

  const handleFile = (e) => {
    if (!activeGroup) { toast('請先在上方選擇組別後再上傳', 'error'); e.target.value = ''; return; }
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setParsedRows(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        if (rows.length < 2) { toast('檔案無資料', 'error'); return; }
        let headerIdx = 0;
        for (let i = 0; i < Math.min(5, rows.length); i++) {
          const r = rows[i].map(String);
          if (r.some(c => ['報到日期','報名狀態','姓名','名字','廠商','公司'].some(k => c.includes(k)))) {
            headerIdx = i; break;
          }
        }
        const headers = rows[headerIdx].map(String);
        const dateCol   = findColIdx(headers, ['報到日期']);
        const statusCol = findColIdx(headers, ['報名狀態']);
        const nameCol   = findColIdx(headers, ['姓名', '名字']);
        const vendorCol = findColIdx(headers, ['廠商', '公司']);
        if (dateCol < 0 || nameCol < 0) { toast('找不到必要欄位（報到日期、姓名）', 'error'); return; }
        const result = [];
        for (let i = headerIdx + 1; i < rows.length; i++) {
          const row = rows[i];
          const dateStr = parseRocDate(row[dateCol]);
          if (!dateStr) continue;
          if (dateStr < importStart || dateStr > importEnd) continue;
          const status = statusCol >= 0 ? String(row[statusCol] ?? '').trim() : '成功';
          if (status !== '成功') continue;
          const name = String(row[nameCol] ?? '').trim();
          const vendor = vendorCol >= 0 ? String(row[vendorCol] ?? '').trim() : '';
          if (!name) continue;
          result.push({ date: dateStr, name, vendor });
        }
        setParsedRows(result);
        if (result.length === 0) toast('符合條件的資料為 0 筆，請確認狀態欄位是否標示「成功」', 'error');
        else toast(`成功解析 ${result.length} 筆資料`, 'success');
      } catch (err) { toast('解析失敗：' + err.message, 'error'); }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const handleImport = () => {
    if (!activeGroup) { toast('請先在上方選擇組別', 'error'); return; }
    if (!parsedRows || parsedRows.length === 0) { toast('無可匯入資料', 'error'); return; }
    setImporting(true);
    setExtras(prev => {
      const next = { ...prev };
      for (let dk = importStart; dk <= importEnd; ) {
        if (next[dk]) next[dk] = next[dk].filter(e => !e._isImport);
        const d = new Date(dk); d.setDate(d.getDate() + 1);
        dk = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      }
      parsedRows.forEach(r => {
        if (!next[r.date]) next[r.date] = [];
        next[r.date].push({
          id: 'imp_' + r.date + '_' + r.name + '_' + Math.random().toString(36).slice(2,6),
          name: r.name, vendor: r.vendor, group: activeGroup, note: '臨時人員',
          present: false, lateEarly: defaultStatus, timeNote: '', absType: '', _isImport: true,
        });
      });
      return next;
    });
    toast(`已匯入 ${parsedRows.length} 筆臨時人員`, 'success');
    setParsedRows(null); setFileName(''); setImporting(false);
  };

  return (
    <div className="space-y-5">
      <div className="bg-white border border-[#DDD9D0] rounded-xl p-5">
        <h3 className="font-semibold text-slate-700 mb-1">匯入派工表</h3>
        <p className="text-xs text-slate-400 mb-5">
          支援 Excel (.xlsx) 檔案。系統自動識別「報到日期（民國年）」、「報名狀態＝成功」，匯入為臨時人員。
        </p>
        <div className="flex gap-3 flex-wrap items-end">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">匯入起日</label>
            <input type="date" value={importStart} onChange={e => setImportStart(e.target.value)}
              className="border border-[#DDD9D0] rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">匯入迄日</label>
            <input type="date" value={importEnd} onChange={e => setImportEnd(e.target.value)}
              className="border border-[#DDD9D0] rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>
        <div className={`mt-4 flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${activeGroup ? 'bg-teal-50 text-blue-700 border border-teal-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
          <span>{activeGroup ? '✅' : '⚠️'}</span>
          <span>{activeGroup ? `匯入組別：${activeGroup}` : '請先在上方篩選列選擇組別'}</span>
        </div>
        <div className="mt-3">
          <label className="block text-xs font-medium text-slate-600 mb-2">上傳派工表檔案</label>
          <label className={`flex items-center gap-3 border-2 border-dashed rounded-xl px-4 py-4 transition-colors
            ${activeGroup ? 'border-blue-300 hover:border-blue-500 hover:bg-teal-50 cursor-pointer' : 'border-slate-200 bg-[#F5F2EC] cursor-not-allowed opacity-60'}`}>
            <span className="text-2xl">📂</span>
            <div>
              <div className="text-sm font-medium text-slate-700">{fileName ? fileName : '點擊選擇 Excel 檔案'}</div>
              <div className="text-xs text-slate-400 mt-0.5">支援 .xlsx</div>
            </div>
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} />
          </label>
        </div>
      </div>
      {parsedRows !== null && (
        <div className="bg-white border border-[#DDD9D0] rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-700">解析結果預覽</h3>
            <span className={`text-sm font-semibold px-3 py-1 rounded-full ${parsedRows.length > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
              共 {parsedRows.length} 筆
            </span>
          </div>
          {parsedRows.length > 0 && (
            <>
              <div className="overflow-x-auto rounded-lg border border-slate-100 mb-4 max-h-60">
                <table className="w-full text-xs">
                  <thead className="bg-[#F5F2EC] sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left text-slate-500 font-medium">報到日期</th>
                      <th className="px-3 py-2 text-left text-slate-500 font-medium">姓名</th>
                      <th className="px-3 py-2 text-left text-slate-500 font-medium">廠商</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {parsedRows.slice(0, 50).map((r, i) => (
                      <tr key={i} className="hover:bg-[#F5F2EC]">
                        <td className="px-3 py-2 text-slate-600">{r.date}</td>
                        <td className="px-3 py-2 font-medium text-slate-800">{r.name}</td>
                        <td className="px-3 py-2 text-slate-500">{r.vendor || '—'}</td>
                      </tr>
                    ))}
                    {parsedRows.length > 50 && (
                      <tr><td colSpan={3} className="px-3 py-2 text-center text-slate-400">... 僅顯示前 50 筆</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700 mb-4">
                ⚠️ 匯入將覆蓋「{activeGroup}」於 {importStart} ～ {importEnd} 期間的舊有臨時人員資料，長期人員不受影響。
              </div>
              <button onClick={handleImport} disabled={importing}
                className="w-full py-2.5 bg-[#1a2f5e] hover:bg-[#1e3870] disabled:opacity-50 text-white rounded-xl font-medium text-sm">
                ✅ 確認匯入 {parsedRows.length} 筆臨時人員
              </button>
            </>
          )}
        </div>
      )}
      <div className="bg-white border border-[#DDD9D0] rounded-xl p-4 text-xs text-slate-500 space-y-1">
        <div className="font-medium text-slate-600 mb-2">📋 必備欄位說明</div>
        <div>• <span className="font-medium">報到日期</span>：民國年格式（113/07/15）自動轉換西元年</div>
        <div>• <span className="font-medium">報名狀態</span>：只匯入標示「成功」的資料</div>
        <div>• <span className="font-medium">姓名／名字</span>：人員名稱（必填）</div>
        <div>• <span className="font-medium">廠商／公司</span>：派工單位</div>
      </div>
    </div>
  );
}

function StatsPane({ attendDate, selectedGroup, totalCount, presentCount, absentCount, attendRate, groupOptions, exportStats }) {
  const [rDate,  setRDate]  = useState(attendDate);
  const [rGroup, setRGroup] = useState(selectedGroup ?? '');
  useEffect(() => { setRGroup(selectedGroup ?? ''); }, [selectedGroup]);
  return (
    <div className="space-y-5">
      <div className="bg-white border border-[#DDD9D0] rounded-xl p-5">
        <h3 className="font-semibold text-slate-700 mb-4">數據看板</h3>
        <div className="text-xs text-slate-400 mb-3">{attendDate} ／ {rGroup || '全部組別'}</div>
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="text-center p-3 bg-[#F5F2EC] rounded-xl">
            <div className="text-2xl font-bold text-slate-700">{totalCount}</div>
            <div className="text-xs text-slate-500 mt-1">應到總計</div>
          </div>
          <div className="text-center p-3 bg-teal-50 rounded-xl">
            <div className="text-2xl font-bold text-teal-700">{presentCount}</div>
            <div className="text-xs text-slate-500 mt-1">實到人數</div>
          </div>
          <div className="text-center p-3 bg-rose-50 rounded-xl">
            <div className="text-2xl font-bold text-rose-500">{absentCount}</div>
            <div className="text-xs text-slate-500 mt-1">缺勤人數</div>
          </div>
        </div>
        <div>
          <div className="flex justify-between text-xs text-slate-500 mb-1">
            <span>到班率</span>
            <span className="font-semibold text-teal-700">{attendRate}%</span>
          </div>
          <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-teal-500 rounded-full transition-all" style={{ width: `${attendRate}%` }} />
          </div>
        </div>
      </div>
      <div className="bg-white border border-[#DDD9D0] rounded-xl p-5">
        <h3 className="font-semibold text-slate-700 mb-4">產出 Excel 統計報表</h3>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-slate-500 mb-1">報表日期</label>
            <input type="date" value={rDate} onChange={e => setRDate(e.target.value)}
              className="border border-[#DDD9D0] rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">報表組別</label>
            <select value={rGroup} onChange={e => setRGroup(e.target.value)}
              className="border border-[#DDD9D0] rounded-lg px-3 py-2 text-sm min-w-[160px]">
              <option value="">全選</option>
              {groupOptions.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <button onClick={() => exportStats(rDate, rGroup)}
            className="px-4 py-2 bg-[#1a2f5e] hover:bg-[#1e3870] text-white rounded-lg text-sm font-medium">
            📥 下載 Excel
          </button>
        </div>
        <p className="text-xs text-slate-400 mt-3">包含「出勤人數統計」與「請假與異常名單」兩個分頁</p>
      </div>
    </div>
  );
}

const WORKER_PHONE_SLOTS = [
  { key: 'morning', label: '上午' },
  { key: 'noon', label: '中午' },
  { key: 'afternoon', label: '下午' },
  { key: 'ot', label: '加班' },
];

function WorkerSelfField({ rec, field, label, checkboxClass, textClass, onSet }) {
  const nowTimeStr = () => new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
  return (
    <label className="flex items-center gap-2 cursor-pointer text-base select-none">
      <input type="checkbox" checked={!!rec[field]}
        onChange={ev => onSet({
          [field]: ev.target.checked,
          [field + 'At']: ev.target.checked ? nowTimeStr() : '',
          ...(ev.target.checked ? { [PHONE_OPPOSITE[field] ?? '_']: false } : {}),
        })}
        className={`w-6 h-6 cursor-pointer ${checkboxClass}`} />
      {label}{rec[field] && rec[field + 'At'] && <span className={`text-sm ml-1 ${textClass}`}>{rec[field + 'At']}</span>}
    </label>
  );
}

// ── 臨時人力自助簽到／手機控管（畫面 2）──
// 臨時人力無帳號，資料寫入當日 extras，透過公開端點 /api/attendance/temp 送出。
function TempSelfCheck({ onLogout }) {
  const toast = useToast();
  const todayStr = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  const { currentUser } = useApp();
  const [rec, setLocalRec] = useState({});
  // 'init' 建檔中 / 'ready' 可填寫 / 'failed' 建檔失敗（此時不可勾選，避免誤以為已存檔）
  const [status, setStatus] = useState('init');
  const [retryTick, setRetryTick] = useState(0);

  const push = useCallback(async (patch) => {
    try {
      const r = await fetch('/api/attendance/temp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: todayStr, id: currentUser.id, patch }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        return { ok: false, error: d.error ?? `伺服器回應 ${r.status}` };
      }
      const d = await r.json().catch(() => ({}));
      return { ok: true, entry: d.entry };
    } catch {
      return { ok: false, error: '無法連線，請確認網路' };
    }
  }, [todayStr, currentUser.id]);

  // 進入畫面即建檔，讓日翊端立刻在名單看到這位臨時人力
  const [initError, setInitError] = useState('');
  const [locker, setLocker] = useState(null);
  const [unlisted, setUnlisted] = useState(false);
  useEffect(() => {
    let alive = true;
    setStatus('init');
    push({ name: currentUser.name, vendor: currentUser.vendor, group: currentUser.group,
           warehouse: currentUser.warehouse })
      .then(r => {
        if (!alive) return;
        setStatus(r.ok ? 'ready' : 'failed');
        setInitError(r.ok ? '' : r.error);
        if (r.ok) { setLocker(r.entry?.locker ?? null); setUnlisted(!!r.entry?._unlisted); }
      });
    return () => { alive = false; };
  }, [push, currentUser, retryTick]);

  const setRec = patch => {
    const before = rec;
    setLocalRec(prev => ({ ...prev, ...patch }));
    push(patch).then(r => {
      // 送出失敗就把畫面還原，避免顯示成已完成但伺服器沒有資料
      if (!r.ok) { setLocalRec(before); toast(`儲存失敗：${r.error}`, 'error'); }
    });
  };

  return (
    <div className="min-h-screen bg-[#F5F2EC]">
      <div className="bg-white border-b border-[#DDD9D0] px-4 py-3 flex items-center">
        <span className="font-bold text-slate-800">委外人力排班作業平台</span>
        <button onClick={onLogout} className="ml-auto text-sm text-slate-500 hover:text-red-600">離開</button>
      </div>
      <div className="p-6 max-w-lg mx-auto space-y-4">
        <div className="text-center">
          <h2 className="text-xl font-bold text-slate-800">簽到 / 手機控管</h2>
          <p className="text-base font-semibold text-slate-700 mt-1">{currentUser.name}</p>
          <p className="text-sm text-slate-400 mt-0.5">
            {currentUser.warehouse}・{currentUser.vendor}・{currentUser.group}・{todayStr}
          </p>
          <span className="inline-block mt-2 px-3 py-1 rounded-lg bg-violet-50 border border-violet-200
                           text-violet-700 text-sm font-semibold">臨時人力</span>
        </div>

        {status === 'ready' && unlisted && (
          <div className="bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 text-sm text-amber-800">
            <div className="font-semibold">⚠ 今日派工名單上查無您的姓名</div>
            <p className="text-xs mt-1">
              您仍可簽到與繳交手機，但請向現場幹部確認報名狀態，以免出勤未被計入。
            </p>
          </div>
        )}

        {status === 'ready' && (
          locker ? (
            <div className="bg-indigo-50 border-2 border-indigo-300 rounded-xl px-5 py-4 text-center">
              <div className="text-sm text-indigo-700">您的手機置物櫃號</div>
              <div className="text-3xl font-extrabold text-indigo-800 mt-1 tracking-wide">
                {lockerLabel(locker)}
              </div>
              <div className="text-xs text-indigo-600 mt-1.5">
                請將手機放入此格；離場前記得取回
              </div>
            </div>
          ) : (
            <div className="bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 text-sm text-amber-800 text-center">
              臨時人力手機櫃已滿，請洽現場幹部安排
            </div>
          )
        )}

        {status === 'init' && (
          <p className="text-center text-sm text-slate-400">建檔中…</p>
        )}
        {status === 'failed' && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
            <div className="font-semibold mb-1">⚠ 尚未建檔成功，目前無法簽到</div>
            <p className="text-xs mb-2">{initError}</p>
            <button onClick={() => setRetryTick(t => t + 1)}
              className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs hover:bg-red-700">
              重試
            </button>
          </div>
        )}

        <div className={`bg-white border border-[#DDD9D0] rounded-xl p-5 space-y-4
                        ${status === 'ready' ? '' : 'opacity-50 pointer-events-none'}`}>
          <div className="flex items-center gap-6 justify-center">
            <WorkerSelfField rec={rec} field="signedIn" label="簽到" checkboxClass="accent-teal-600" textClass="text-teal-600" onSet={setRec} />
            <WorkerSelfField rec={rec} field="signedOut" label="簽退" checkboxClass="accent-slate-600" textClass="text-slate-600" onSet={setRec} />
          </div>
          <div className="flex items-center justify-center gap-5 flex-wrap border-t border-slate-100 pt-4">
            <WorkerSelfField rec={rec} field="phoneSubmitted" label="上班繳交手機" checkboxClass="accent-indigo-600" textClass="text-indigo-600" onSet={setRec} />
            <WorkerSelfField rec={rec} field="phoneNotSubmitted" label="手機未交" checkboxClass="accent-orange-600" textClass="text-orange-600" onSet={setRec} />
          </div>
          <div className="space-y-2 border-t border-slate-100 pt-4">
            {WORKER_PHONE_SLOTS.map(slot => (
              <div key={slot.key} className="flex items-center gap-6 justify-center">
                <span className="text-sm text-slate-400 w-10 flex-shrink-0 text-right">{slot.label}</span>
                <WorkerSelfField rec={rec} field={`${slot.key}Taken`} label="領取" checkboxClass="accent-amber-600" textClass="text-amber-600" onSet={setRec} />
                <WorkerSelfField rec={rec} field={`${slot.key}Returned`} label="歸還" checkboxClass="accent-emerald-600" textClass="text-emerald-600" onSet={setRec} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 委外人員自助簽到／手機控管 ──
function WorkerSelfCheck() {
  const { employees, currentUser, attendData, setAttendData, lockerAssign, schedule } = useApp();
  const toast = useToast();

  // 須與 Attendance 元件的 attendDate 格式（補零）一致，否則會存到不同的 attendData key
  const todayStr = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();

  const emp = resolveSelfEmployee(currentUser, employees);
  const empId = emp?.id;

  // 今日班表若為休假，提醒本人一聲（仍可正常簽到，班表不會被異動）
  // schedule 的鍵為 dateKey 格式（不補零），todayStr 有補零，須轉換
  const todayLeave = (() => {
    if (!empId) return null;
    const [ty, tm, td] = todayStr.split('-').map(Number);
    const code = schedule?.[empId]?.[dateKey(ty, tm, td)];
    return { '休': '休假', '例': '例假', '國': '國定假日' }[code] ?? null;
  })();

  const rec = attendData[todayStr]?.[empId] ?? {};
  const setRec = patch => {
    const newRecord = { ...rec, ...patch };
    setAttendData(prev => ({
      ...prev,
      [todayStr]: { ...(prev[todayStr] ?? {}), [empId]: newRecord },
    }));
    // 手機瀏覽器切到背景時計時器可能被暫停，直接立即送出，不等共用的 2 秒 debounce
    const token = localStorage.getItem('sms_jwt');
    if (!token) return;
    fetch('/api/attendance', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ attendData: { [todayStr]: { [empId]: newRecord } }, extras: {} }),
    }).then(r => { if (!r.ok) toast('儲存失敗，請檢查網路後重新勾選', 'error'); })
      .catch(() => toast('儲存失敗，請檢查網路後重新勾選', 'error'));
  };

  if (!emp) {
    return <div className="p-6 text-sm text-slate-400">找不到您的人員資料，請聯繫管理員。</div>;
  }

  return (
    <div className="p-6 max-w-lg mx-auto space-y-4">
      <div className="text-center">
        <h2 className="text-xl font-bold text-slate-800">簽到 / 手機控管</h2>
        <p className="text-sm text-slate-400 mt-1">{emp.name}・{emp.vendor}・{todayStr}</p>
        {todayLeave && (
          <div className="mt-3 bg-blue-50 border border-blue-300 rounded-xl px-4 py-3 text-left">
            <div className="text-sm font-semibold text-blue-700">
              📅 您今日班表為「{todayLeave}」
            </div>
            <p className="text-xs text-blue-600 mt-1">
              若因作業需求出勤，仍可正常簽到與繳交手機；班表不會因此變動。
            </p>
          </div>
        )}
        {lockerAssign?.[empId] && (
          <p className="mt-2 inline-block px-3 py-1 rounded-lg bg-indigo-50 border border-indigo-200
                        text-indigo-700 text-base font-semibold">
            🔐 {lockerLabel(lockerAssign[empId])}
          </p>
        )}
      </div>

      <div className="bg-white border border-[#DDD9D0] rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-6 justify-center">
          <WorkerSelfField rec={rec} field="signedIn" label="簽到" checkboxClass="accent-teal-600" textClass="text-teal-600" onSet={setRec} />
          <WorkerSelfField rec={rec} field="signedOut" label="簽退" checkboxClass="accent-slate-600" textClass="text-slate-600" onSet={setRec} />
        </div>
        <div className="flex items-center justify-center gap-5 flex-wrap border-t border-slate-100 pt-4">
          <WorkerSelfField rec={rec} field="phoneSubmitted" label="上班繳交手機" checkboxClass="accent-indigo-600" textClass="text-indigo-600" onSet={setRec} />
          <WorkerSelfField rec={rec} field="phoneNotSubmitted" label="手機未交" checkboxClass="accent-orange-600" textClass="text-orange-600" onSet={setRec} />
        </div>
        <div className="space-y-2 border-t border-slate-100 pt-4">
          {WORKER_PHONE_SLOTS.map(slot => (
            <div key={slot.key} className="flex items-center gap-6 justify-center">
              <span className="text-sm text-slate-400 w-10 flex-shrink-0 text-right">{slot.label}</span>
              <WorkerSelfField rec={rec} field={`${slot.key}Taken`} label="領取" checkboxClass="accent-amber-600" textClass="text-amber-600" onSet={setRec} />
              <WorkerSelfField rec={rec} field={`${slot.key}Returned`} label="歸還" checkboxClass="accent-emerald-600" textClass="text-emerald-600" onSet={setRec} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// phoneOnly：作為左側主選單的獨立分頁「手機控管」使用，
// 沿用本元件既有的人員／出勤資料邏輯，僅隱藏其他子分頁
function Attendance({ phoneOnly = false }) {
  const { employees, setEmployees, warehouses, setWarehouses, vendors: _allVendors, setVendors, selectedWarehouse, setSelectedWarehouse, selectedDept, setSelectedDept, selectedGroup, selectedWorkArea, setSelectedGroup, selectedVendor, currentUser, schedule, applyRemoteSchedule, attendData, setAttendData, extras, setExtras, attendSettings, setAttendSettings, lockerAssign, setLockerAssign, hasUnsavedChanges, shiftTypesByWh } = useApp();
  const toast = useToast();

  // 手機控管為大肚倉的作業，進入此分頁時預設切到大肚倉（之後仍可自行切換倉別）
  // 手機控管為大肚倉的作業，進入此分頁時預設切到大肚倉（之後仍可自行切換倉別）
  const phoneWhInitRef = useRef(false);
  useEffect(() => {
    if (!phoneOnly || phoneWhInitRef.current) return;
    phoneWhInitRef.current = true;
    const dadu = warehouses.find(w => w.name === '大肚倉');
    if (dadu && selectedWarehouse !== dadu.id) {
      setSelectedWarehouse(dadu.id);
      // 課別/組別屬於原倉別，換倉後需清除，否則會篩不到任何人
      setSelectedDept(null);
      setSelectedGroup(null);
    }
  }, [phoneOnly, warehouses, selectedWarehouse, setSelectedWarehouse, setSelectedDept, setSelectedGroup]);

  const todayStr = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  })();

  const [subTab, setSubTab] = useState(phoneOnly ? 'phone' : 'attend');
  // 點名表與手機控管是同一個元件（只差 phoneOnly），切換主選單時 React 會重用實例，
  // useState 的初始值不會重跑，subTab 會殘留（例如停在「匯入」就切不回手機控管畫面）。
  useEffect(() => {
    if (phoneOnly) setSubTab('phone');
    else setSubTab(prev => (prev === 'phone' ? 'attend' : prev));
  }, [phoneOnly]);
  const [attendDate, setAttendDate] = useState(todayStr);
  const [addModal, setAddModal] = useState(false);
  const [phoneOnlyIncomplete, setPhoneOnlyIncomplete] = useState(false);
  const [phoneScope, setPhoneScope] = useState('all');   // all | long | temp
  const [addForm, setAddForm] = useState({ name: '', vendor: '', group: '', note: '' });
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);

  const syncFromServer = useCallback(async (silent = false) => {
    const token = localStorage.getItem('sms_jwt');
    if (!token) return;
    if (!silent) setSyncing(true);
    try {
      const isVendor = currentUser?.role === ROLES.VENDOR;
      const url = isVendor ? '/api/attendance' : '/api/state';
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) return;
      const data = await r.json();
      const newAttend = isVendor ? (data.attendData ?? {}) : (data?.attendData ?? {});
      const newExtras = isVendor ? (data.extras    ?? {}) : (data?.extras    ?? {});
      if (Object.keys(newAttend).length > 0)
        setAttendData(prev => {
          const merged = { ...prev };
          for (const [date, dayMap] of Object.entries(newAttend)) {
            if (Object.keys(dayMap).length > 0)
              // 本地已編輯的紀錄優先（避免輪詢伺服器舊資料覆蓋尚未存檔的勾選）
              merged[date] = { ...dayMap, ...(prev[date] ?? {}) };
          }
          return merged;
        });
      if (Object.keys(newExtras).length > 0)
        // 本地已有的日期優先（避免輪詢覆蓋尚未存檔的手動新增臨時人員）
        setExtras(prev => ({ ...newExtras, ...prev }));
      // 非 vendor 同時更新員工/廠商/倉別等維護資料（儀表板在職人數來源）
      // 本地有未存檔變更時跳過，避免用伺服器舊資料蓋掉剛匯入的班表
      if (!isVendor && !hasUnsavedChanges()) {
        if (Array.isArray(data?.employees) && data.employees.length > 0) setEmployees(data.employees);
        if (Array.isArray(data?.vendors)   && data.vendors.length   > 0) setVendors(data.vendors);
        if (Array.isArray(data?.warehouses)&& data.warehouses.length> 0) setWarehouses(data.warehouses);
        applyRemoteSchedule(data?.schedule);
        if (data?.attendSettings) setAttendSettings(data.attendSettings);
      }
      setLastSync(new Date());
      if (!silent) toast('資料已同步', 'success');
    } catch (_) {
      if (!silent) toast('同步失敗，請檢查網路', 'error');
    } finally {
      if (!silent) setSyncing(false);
    }
  }, [currentUser, setAttendData, setExtras, toast]);

  // 10 秒自動輪詢（點名表開啟期間）
  useEffect(() => {
    const id = setInterval(() => syncFromServer(true), 10000);
    return () => clearInterval(id);
  }, [syncFromServer]);

  // 與上方篩選列同一份來源：倉別設定的課別組別清單（不再掃員工資料，
  // 否則已從課別移除、但員工欄位還掛著的舊組別會殘留在選單裡）。
  // 順序沿用倉別設定的宣告順序，不另外排序。
  const groupOptions = useMemo(() => {
    const picked = [];
    for (const w of warehouses) {
      if (selectedWarehouse && w.id !== selectedWarehouse) continue;
      for (const d of (w.departments ?? [])) {
        if (selectedDept && d.id !== selectedDept) continue;
        picked.push(...(d.groups ?? []));
      }
    }
    return [...new Set(picked)];
  }, [warehouses, selectedWarehouse, selectedDept]);

  const ABSENT_CODES = new Set(['休', '例', '國']);

  // 人員上班時間：由員工的班別（shiftTypeId）帶出起訖時間，供點名時核對
  const fmtHHMM = t => `${String(t ?? '').slice(0, 2)}:${String(t ?? '').slice(2)}`;
  const shiftInfo = emp => {
    const st = findShiftType(shiftTypesByWh, selectedWarehouse ?? 'default', emp.shiftTypeId);
    return st ? { name: st.name, time: `${fmtHHMM(st.startTime)}~${fmtHHMM(st.endTime)}` } : null;
  };

  // 本日被排除的人員，供名單上方還原
  const excludedEmps = useMemo(() => {
    const day = attendData[attendDate] ?? {};
    return employees.filter(e => day[e.id]?._excluded);
  }, [employees, attendData, attendDate]);

  const scopedEmps = useMemo(() => {
    let list = currentUser.role === ROLES.VENDOR
      ? employees.filter(e => currentUser.vendors.includes(e.vendor))
      : employees.filter(e => e.vendor && e.vendor.trim() !== '');
    list = filterByScope(list, warehouses, selectedWarehouse, selectedDept, selectedGroup, selectedWorkArea);
    if (selectedVendor) list = list.filter(e => e.vendor === selectedVendor);
    if (selectedGroup) list = list.filter(e => e.shiftType === selectedGroup || e.group === selectedGroup);
    // 班表當日排休/例/國 → 不出現在點名名單，
    // 但若因作業需求臨時來上班且已產生簽到／手機控管紀錄，仍須顯示，
    // 否則資料存進去卻沒有任何畫面呈現，幹部端等於看不到這個人。
    // dateKey 格式無補零 (2026-7-16)，attendDate 有補零 (2026-07-16)，需轉換
    const [ay, am, ad] = attendDate.split('-').map(Number);
    const attendDk = dateKey(ay, am, ad);
    const dayRecs = attendData[attendDate] ?? {};
    list = list.filter(e => !ABSENT_CODES.has(schedule[e.id]?.[attendDk])
                            || hasAttendActivity(dayRecs[e.id]));
    // 幹部手動排除於當日名單者（調班、支援他課等）；班表與清冊不受影響
    list = list.filter(e => !dayRecs[e.id]?._excluded);
    return list;
  }, [employees, currentUser, warehouses, selectedWarehouse, selectedDept, selectedGroup, selectedWorkArea, selectedVendor, attendDate, schedule, attendData]);

  // 排休卻來上班者的 id，供名單上標示區隔
  const offDutyPresentIds = useMemo(() => {
    const [ay, am, ad] = attendDate.split('-').map(Number);
    const attendDk = dateKey(ay, am, ad);
    const dayRecs = attendData[attendDate] ?? {};
    return new Set(scopedEmps
      .filter(e => ABSENT_CODES.has(schedule[e.id]?.[attendDk]) && hasAttendActivity(dayRecs[e.id]))
      .map(e => e.id));
  }, [scopedEmps, attendDate, attendData, schedule]);

  const attendDeptName = useMemo(() => {
    if (!selectedDept) return null;
    const wh = warehouses.find(w => w.id === selectedWarehouse);
    return wh?.departments?.find(d => d.id === selectedDept)?.name ?? null;
  }, [warehouses, selectedWarehouse, selectedDept]);

  const dateExtras = useMemo(() => filterExtrasByScope(extras[attendDate], warehouses,
    selectedWarehouse, attendDeptName, selectedGroup, selectedVendor),
    [extras, attendDate, warehouses, selectedWarehouse, attendDeptName, selectedGroup, selectedVendor]);

  const vendorGroups = useMemo(() => {
    const map = {};
    scopedEmps.forEach(e => {
      const v = e.vendor || '未分配';
      if (!map[v]) map[v] = [];
      map[v].push(e);
    });
    return map;
  }, [scopedEmps]);

  // 臨時人員依廠商分組（含匯入 + 手動新增）
  const extrasVendorGroups = useMemo(() => {
    const map = {};
    dateExtras.forEach(e => {
      const v = e.vendor || '未分配';
      if (!map[v]) map[v] = [];
      map[v].push(e);
    });
    return map;
  }, [dateExtras]);

  const defaultStatus = attendSettings.lateEarlyStatus?.[0] ?? '正常到班（無遲到早退）';

  const getRecord = (empId) => {
    if (attendData[attendDate]?.[empId]) return attendData[attendDate][empId];
    // schedule 的鍵為 dateKey 格式（不補零，如 2026-9-2），attendDate 有補零（2026-09-02），
    // 直接用 attendDate 查會在月/日小於 10 時一律查不到班表，須先轉換（與 scopedEmps 一致）
    const [sy, sm, sd] = attendDate.split('-').map(Number);
    const shiftCode = schedule[empId]?.[dateKey(sy, sm, sd)];
    // 班表 V → 預設未勾選（點名時再確認）
    if (shiftCode === 'V') {
      return { present: false, lateEarly: defaultStatus, timeNote: '', absType: '', note: '' };
    }
    // 班表休/例/國定 → 預設缺勤並帶入假別
    const SHIFT_LEAVE_MAP = { '休': '休假', '例': '例假', '國': '國定假日' };
    if (SHIFT_LEAVE_MAP[shiftCode]) {
      return { present: false, lateEarly: defaultStatus, timeNote: '', absType: SHIFT_LEAVE_MAP[shiftCode], note: '' };
    }
    // 無班表記錄 → 預設未到班
    return { present: false, lateEarly: defaultStatus, timeNote: '', absType: '', note: '' };
  };

  const setRecord = (empId, patch) => {
    setAttendData(prev => ({
      ...prev,
      [attendDate]: { ...(prev[attendDate] ?? {}), [empId]: { ...getRecord(empId), ...patch } },
    }));
  };

  const toggleAll = (vendorName, val) => {
    const emps = vendorGroups[vendorName] ?? [];
    setAttendData(prev => {
      const day = { ...(prev[attendDate] ?? {}) };
      emps.forEach(e => { day[e.id] = { ...getRecord(e.id), present: val }; });
      return { ...prev, [attendDate]: day };
    });
  };

  const handleAddExtra = () => {
    if (!addForm.name.trim()) { toast('姓名為必填', 'error'); return; }
    const e = { id: 'extra_' + Date.now(), ...addForm, present: true, lateEarly: defaultStatus, timeNote: '', absType: '' };
    setExtras(prev => ({ ...prev, [attendDate]: [...(prev[attendDate] ?? []), e] }));
    setAddModal(false);
    setAddForm({ name: '', vendor: '', group: '', note: '' });
    toast('已新增：' + addForm.name, 'success');
  };

  const removeExtra = (id) =>
    setExtras(prev => ({ ...prev, [attendDate]: (prev[attendDate] ?? []).filter(e => e.id !== id) }));

  const setExtraRecord = (id, patch) =>
    setExtras(prev => ({
      ...prev,
      [attendDate]: (prev[attendDate] ?? []).map(e => e.id === id ? { ...e, ...patch } : e),
    }));

  const totalCount = scopedEmps.length + dateExtras.length;
  const presentCount = scopedEmps.filter(e => getRecord(e.id).present).length + dateExtras.filter(e => e.present).length;
  const absentCount = totalCount - presentCount;
  const attendRate = totalCount > 0 ? Math.round((presentCount / totalCount) * 100) : 0;

  // ── 統計 Excel
  const exportStats = (reportDate, reportGroup) => {
    try {
      let emps = reportGroup
        ? employees.filter(e => e.shiftType === reportGroup || e.group === reportGroup)
        : scopedEmps;
      const exExtras = (extras[reportDate] ?? []).filter(e => !reportGroup || e.group === reportGroup);
      const getData = id => attendData[reportDate]?.[id] ?? { present: true };

      const s1 = [['廠商', '應到', '實到', '缺勤', '到班率']];
      const vm = {};
      emps.forEach(e => {
        const v = e.vendor || '未分配';
        if (!vm[v]) vm[v] = { t: 0, p: 0 };
        vm[v].t++; if (getData(e.id).present) vm[v].p++;
      });
      exExtras.forEach(e => {
        const v = e.vendor || '手動新增';
        if (!vm[v]) vm[v] = { t: 0, p: 0 };
        vm[v].t++; if (e.present) vm[v].p++;
      });
      let tt = 0, tp = 0;
      sortVendorNames(Object.keys(vm)).forEach(v => {
        const d = vm[v];
        tt += d.t; tp += d.p;
        s1.push([v, d.t, d.p, d.t - d.p, d.t > 0 ? `${Math.round((d.p/d.t)*100)}%` : '—']);
      });
      s1.push(['合計', tt, tp, tt - tp, tt > 0 ? `${Math.round((tp/tt)*100)}%` : '—']);

      const s2 = [['日期', '廠商', '員工編號', '姓名', '出勤狀況', '假別/遲到狀態', '備註']];
      emps.forEach(emp => {
        const rec = getData(emp.id);
        if (!rec.present || (rec.lateEarly && rec.lateEarly !== defaultStatus)) {
          s2.push([reportDate, emp.vendor || '未分配', emp.empId ?? '', emp.name,
            rec.present ? '出勤' : '缺勤',
            rec.present ? (rec.lateEarly || '') : (rec.absType || ''),
            rec.note || '']);
        }
      });
      exExtras.forEach(e => {
        if (!e.present || (e.lateEarly && e.lateEarly !== defaultStatus)) {
          s2.push([reportDate, e.vendor || '', '', e.name,
            e.present ? '出勤' : '缺勤',
            e.present ? (e.lateEarly || '') : (e.absType || ''),
            e.note || '']);
        }
      });

      const wb = XLSX.utils.book_new();
      const ws1 = XLSX.utils.aoa_to_sheet(s1);
      ws1['!cols'] = [{ wch: 14 }, { wch: 6 }, { wch: 6 }, { wch: 6 }, { wch: 8 }];
      const ws2 = XLSX.utils.aoa_to_sheet(s2);
      ws2['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 8 }, { wch: 20 }, { wch: 20 }];
      XLSX.utils.book_append_sheet(wb, ws1, '出勤人數統計');
      XLSX.utils.book_append_sheet(wb, ws2, '請假與異常名單');
      XLSX.writeFile(wb, `點名統計_${reportDate}${reportGroup ? '_' + reportGroup : ''}.xlsx`);
      toast('匯出成功', 'success');
    } catch (err) { toast('匯出失敗：' + err.message, 'error'); }
  };

  // ── 回報文字
  const generateReport = (reportDate, reportGroup) => {
    // 長期 = 清冊人員；臨時 = 手動新增
    // 統一用 vendor/scope 過濾，再依報告日期排班過濾排休/例/國
    let longList = currentUser.role === ROLES.VENDOR
      ? employees.filter(e => currentUser.vendors.includes(e.vendor))
      : employees.filter(e => e.vendor && e.vendor.trim() !== '');
    longList = filterByScope(longList, warehouses, selectedWarehouse, selectedDept, selectedGroup, selectedWorkArea);
    if (reportGroup) longList = longList.filter(e => e.shiftType === reportGroup || e.group === reportGroup);
    const [ry, rm, rd] = reportDate.split('-').map(Number);
    const reportDk = dateKey(ry, rm, rd);
    longList = longList.filter(e => !ABSENT_CODES.has(schedule[e.id]?.[reportDk]));
    const longEmps = longList;
    const tempEmps = (extras[reportDate] ?? []).filter(e => !reportGroup || e.group === reportGroup);
    const getData = id => attendData[reportDate]?.[id] ?? { present: true };

    // 星期對照
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    const [y, m, d] = reportDate.split('-').map(Number);
    const dow = weekdays[new Date(y, m - 1, d).getDay()];
    const dateLabel = `${m}/${d}（${dow}）`;

    // 課別標頭
    // selectedDept / selectedWarehouse 存的是 id，須轉成名稱才能給人看
    const whObjR = warehouses.find(w => w.id === selectedWarehouse);
    const deptLabel = whObjR?.departments?.find(d => d.id === selectedDept)?.name
                      ?? whObjR?.name ?? '';
    const groupLabel = reportGroup || selectedGroup || '';
    const header = deptLabel ? `${deptLabel}${groupLabel ? `（${groupLabel}）` : ''}` : groupLabel;

    // 統計輔助
    const countAbsTypes = (list, getRecFn) => {
      const map = {};
      list.forEach(e => {
        const rec = getRecFn(e);
        if (!rec.present) {
          const t = rec.absType || '缺勤';
          map[t] = (map[t] || 0) + 1;
        }
      });
      return map;
    };

    const longPresent = longEmps.filter(e => getData(e.id).present).length;
    const longAbsent  = longEmps.length - longPresent;
    const longAbsMap  = countAbsTypes(longEmps, e => getData(e.id));

    const tempPresent = tempEmps.filter(e => e.present).length;
    const tempAbsent  = tempEmps.length - tempPresent;
    const tempAbsMap  = countAbsTypes(tempEmps, e => e);

    const fmtAbsMap = (map) => {
      const parts = Object.entries(map).map(([t, n]) => `${t}*${n}`);
      return parts.length ? `（${parts.join('、')}）` : '（無缺勤）';
    };

    // 廠商分組
    const buildVm = (list, getRecFn) => {
      const vm = {};
      list.forEach(e => {
        const v = e.vendor || '未分配';
        if (!vm[v]) vm[v] = { long: { t: 0, p: 0 }, temp: { t: 0, p: 0 }, absent: [], notes: [] };
        const rec = getRecFn(e);
        // 到班者若填了時間備註（遲到／早退的實際時間等），一併帶進回報文字
        if (rec.present && String(rec.timeNote ?? '').trim())
          vm[v].notes.push({
            name: e.name,
            status: rec.lateEarly || '',
            note: String(rec.timeNote).trim(),
          });
        if (e._isTemp) {
          vm[v].temp.t++;
          if (rec.present) vm[v].temp.p++;
          else vm[v].absent.push({ name: e.name, type: rec.absType || '缺勤' });
        } else {
          vm[v].long.t++;
          if (rec.present) vm[v].long.p++;
          else vm[v].absent.push({ name: e.name, type: rec.absType || '缺勤' });
        }
      });
      return vm;
    };

    const allList = [
      ...longEmps.map(e => ({ ...e, _isTemp: false })),
      ...tempEmps.map(e => ({ ...e, _isTemp: true })),
    ];
    const vm = buildVm(allList, e => e._isTemp ? e : getData(e.id));

    let text = '';
    if (header) text += `${header}\n\n`;
    text += `總出勤人力回報\n\n`;
    text += `出勤日期：${dateLabel}\n\n`;
    text += `應到人數（長期）：${longEmps.length}人\n`;
    text += `實到人數（長期）：${longPresent}人\n`;
    text += `缺勤人數（長期）：${longAbsent}人\n`;
    text += `${fmtAbsMap(longAbsMap)}\n\n`;
    text += `應到人數（臨時）：${tempEmps.length}人\n`;
    text += `實到人數（臨時）：${tempPresent}人\n`;
    text += `缺勤人數（臨時）：${tempAbsent}人\n`;
    text += `${fmtAbsMap(tempAbsMap)}\n\n`;

    sortVendorNames(Object.keys(vm)).forEach(v => {
      const d = vm[v];
      text += `\n《${v}》\n`;
      text += `應到（長期）:${d.long.t} 實到（長期）:${d.long.p}\n`;
      text += `應到（臨時）:${d.temp.t} 實到（臨時）:${d.temp.p}\n`;
      // 缺勤按假別分組列出
      const absByType = {};
      d.absent.forEach(a => { if (!absByType[a.type]) absByType[a.type] = []; absByType[a.type].push(a.name); });
      Object.entries(absByType).forEach(([t, names]) => {
        text += `${t}：${names.join('、')}\n`;
      });
      // 時間備註：依遲到早退狀態分組，狀態為「正常到班」者歸在「時間備註」
      if (d.notes.length > 0) {
        const noteByStatus = {};
        d.notes.forEach(n => {
          const label = (!n.status || n.status.startsWith('正常')) ? '時間備註' : n.status;
          (noteByStatus[label] ??= []).push(`${n.name}（${n.note}）`);
        });
        Object.entries(noteByStatus).forEach(([label, items]) => {
          text += `${label}：${items.join('、')}\n`;
        });
      }
    });

    return text;
  };

  // ── 點名分頁
  const attendPane = (
    <div className="space-y-4">
      <div className="bg-white border border-[#DDD9D0] rounded-xl p-4 flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-xs text-slate-500 mb-1">點名出勤日期</label>
          <input type="date" value={attendDate} onChange={e => setAttendDate(e.target.value)}
            className="border border-[#DDD9D0] rounded-lg px-3 py-2 text-sm" />
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-slate-500">實到 <span className="font-bold text-teal-700">{presentCount}</span>/{totalCount}人</span>
          <button onClick={() => syncFromServer(false)} disabled={syncing}
            title={lastSync ? `上次同步：${lastSync.toLocaleTimeString('zh-TW', {hour:'2-digit',minute:'2-digit',second:'2-digit'})}` : '點擊同步最新出勤資料'}
            className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors
              ${syncing
                ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                : 'bg-white hover:bg-teal-50 text-teal-700 border-teal-300 hover:border-teal-500'}`}>
            {syncing ? '⏳ 同步中…' : '🔄 同步'}
          </button>
          <button onClick={() => setAddModal(true)}
            className="px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-medium">
            👤 手動新增
          </button>
        </div>
      </div>

      {excludedEmps.length > 0 && (
        <div className="bg-slate-50 border border-[#DDD9D0] rounded-xl px-4 py-3">
          <div className="text-xs text-slate-500 mb-2">
            本日已移出名單 {excludedEmps.length} 人（班表與清冊未變動，點姓名可還原）
          </div>
          <div className="flex flex-wrap gap-1.5">
            {excludedEmps.map(e => (
              <button key={e.id}
                onClick={() => { setRecord(e.id, { _excluded: false }); toast(`已還原 ${e.name}`, 'success'); }}
                className="px-2 py-1 rounded-lg border border-[#DDD9D0] bg-white text-xs text-slate-600
                           hover:bg-teal-50 hover:border-teal-300 hover:text-teal-700">
                ↩ {e.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {Object.keys(vendorGroups).length === 0 && dateExtras.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-10">請先在人員清冊匯入資料，或使用匯入派工表</p>
      ) : (() => {
        // 合併所有廠商名稱，維持出現順序
        const allVendors = sortVendorNames([...new Set([
          ...Object.keys(vendorGroups),
          ...Object.keys(extrasVendorGroups),
        ])]);
        return (
          <div className="space-y-2">
            {allVendors.map(vName => {
              const longEmps = vendorGroups[vName] ?? [];
              const tempEmps = extrasVendorGroups[vName] ?? [];
              return (
                <div key={vName} className="space-y-1">
                  {/* 長期人員卡 */}
                  {longEmps.length > 0 && (
                    <div className="border border-[#DDD9D0] rounded-xl overflow-hidden">
                      <div className="flex items-center justify-between bg-blue-700 text-white px-4 py-2.5">
                        <span className="font-semibold flex items-center gap-2">
                          👥 {vName}
                          <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full">{longEmps.filter(e => getRecord(e.id).present).length}/{longEmps.length}人</span>
                          <span className="text-xs opacity-70">長期</span>
                        </span>
                        <div className="flex gap-2">
                          <button onClick={() => toggleAll(vName, true)}
                            className="text-xs bg-blue-600 hover:bg-teal-500 px-3 py-1 rounded-full">全選到班</button>
                          <button onClick={() => toggleAll(vName, false)}
                            className="text-xs bg-blue-900 hover:bg-blue-800 px-3 py-1 rounded-full">取消全選</button>
                        </div>
                      </div>
                      <div className="divide-y divide-slate-100">
                        {longEmps.map(emp => {
                          const rec = getRecord(emp.id);
                          return (
                            <div key={emp.id} className={`px-3 py-3 ${rec.present ? '' : 'bg-rose-50'}`}>
                              <div className="flex items-start gap-3 flex-wrap">
                                <input type="checkbox" checked={rec.present}
                                  onChange={ev => setRecord(emp.id, { present: ev.target.checked })}
                                  className="w-6 h-6 mt-0.5 accent-blue-600 cursor-pointer flex-shrink-0" />
                                <div className="min-w-[96px] flex-shrink-0">
                                  {/* 休假卻來上班者以藍字呈現；班表不做任何異動 */}
                                  <div className={`font-bold text-lg leading-snug ${
                                    offDutyPresentIds.has(emp.id) ? 'text-blue-600' : 'text-slate-900'}`}>
                                    {emp.name}
                                  </div>
                                  <div className={`text-[13px] ${
                                    offDutyPresentIds.has(emp.id) ? 'text-blue-400' : 'text-slate-500'}`}>
                                    {emp.empId}
                                  </div>
                                  {offDutyPresentIds.has(emp.id) && (
                                    <div className="text-[11px] text-blue-600 font-medium">休假出勤</div>
                                  )}
                                  {(() => {
                                    // 未指派班別時明確標示，避免與「功能失效」混淆
                                    const si = shiftInfo(emp);
                                    return si ? (
                                      <div className="text-[11px] text-indigo-600 whitespace-nowrap"
                                           title={si.name}>
                                        🕐 {si.time}
                                      </div>
                                    ) : (
                                      <div className="text-[11px] text-slate-300 whitespace-nowrap"
                                           title="請至「人員班別設定」指派班別">
                                        🕐 未設班別
                                      </div>
                                    );
                                  })()}
                                </div>
                                {rec.present ? (
                                  <>
                                    <select value={rec.lateEarly || defaultStatus}
                                      onChange={ev => setRecord(emp.id, { lateEarly: ev.target.value })}
                                      className="border border-[#DDD9D0] rounded-lg px-2 py-1.5 text-sm text-slate-700 flex-1 min-w-0">
                                      {(attendSettings.lateEarlyStatus ?? []).map(s => <option key={s} value={s}>{s}</option>)}
                                    </select>
                                    <input type="text" value={rec.timeNote || ''} placeholder="時間備註"
                                      onChange={ev => setRecord(emp.id, { timeNote: ev.target.value })}
                                      className="border border-[#DDD9D0] rounded-lg px-2 py-1 text-xs w-24" />
                                  </>
                                ) : (
                                  <>
                                    <select value={rec.absType || ''}
                                      onChange={ev => setRecord(emp.id, { absType: ev.target.value })}
                                      className="border border-rose-200 bg-white rounded-lg px-2 py-1.5 text-sm text-slate-700 flex-1 min-w-0">
                                      <option value="">請選假別</option>
                                      {(attendSettings.leaveTypes ?? []).map(t => <option key={t} value={t}>{t}</option>)}
                                    </select>
                                    <input type="text" value={rec.note || ''} placeholder="備註原因"
                                      onChange={ev => setRecord(emp.id, { note: ev.target.value })}
                                      className="border border-[#DDD9D0] rounded-lg px-2 py-1.5 text-sm w-full sm:w-32" />
                                  </>
                                )}
                                {/* 僅將此人移出「當日」名單；班表與人員清冊不受影響，可隨時還原 */}
                                <button
                                  onClick={() => {
                                    if (!window.confirm(`將「${emp.name}」移出 ${attendDate} 的點名名單？

班表與人員清冊不會變動，可在名單上方還原。`)) return;
                                    setRecord(emp.id, { _excluded: true });
                                    toast(`已將 ${emp.name} 移出本日名單`, 'info');
                                  }}
                                  title="移出本日名單"
                                  className="ml-auto shrink-0 w-7 h-7 rounded-lg border border-[#DDD9D0]
                                             text-slate-400 hover:bg-red-50 hover:text-red-600 hover:border-red-300
                                             flex items-center justify-center text-sm">
                                  ✕
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {/* 臨時人員卡 */}
                  {tempEmps.length > 0 && (
                    <div className="border border-amber-200 rounded-xl overflow-hidden">
                      <div className="flex items-center justify-between bg-amber-500 text-white px-4 py-2.5">
                        <span className="font-semibold flex items-center gap-2">
                          👥 {vName}
                          <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full">{tempEmps.filter(e => e.present).length}/{tempEmps.length}人</span>
                          <span className="text-xs opacity-70">臨時</span>
                        </span>
                        <label className="flex items-center gap-1.5 cursor-pointer text-xs font-medium select-none">
                          <input type="checkbox"
                            checked={tempEmps.length > 0 && tempEmps.every(e => e.present)}
                            ref={el => { if (el) el.indeterminate = tempEmps.some(e => e.present) && !tempEmps.every(e => e.present); }}
                            onChange={ev => tempEmps.forEach(e => setExtraRecord(e.id, { present: ev.target.checked }))}
                            className="w-4 h-4 accent-white cursor-pointer" />
                          全選
                        </label>
                      </div>
                      <div className="divide-y divide-slate-100">
                        {tempEmps.map(e => (
                          <div key={e.id} className={`px-3 py-3 ${e.present ? '' : 'bg-rose-50'}`}>
                            <div className="flex items-start gap-3 flex-wrap">
                              <input type="checkbox" checked={e.present}
                                onChange={ev => setExtraRecord(e.id, { present: ev.target.checked })}
                                className="w-6 h-6 mt-0.5 accent-amber-500 cursor-pointer flex-shrink-0" />
                              <div className="min-w-[96px] flex-shrink-0">
                                <div className="font-bold text-slate-900 text-lg leading-snug">{e.name}</div>
                                <div className="text-[13px] text-slate-500">{e._isImport ? '派工匯入' : '手動新增'}</div>
                              </div>
                              {e.present ? (
                                <>
                                  <select value={e.lateEarly || defaultStatus}
                                    onChange={ev => setExtraRecord(e.id, { lateEarly: ev.target.value })}
                                    className="border border-[#DDD9D0] rounded-lg px-2 py-1.5 text-sm flex-1 min-w-0">
                                    {(attendSettings.lateEarlyStatus ?? []).map(s => <option key={s} value={s}>{s}</option>)}
                                  </select>
                                  <input type="text" value={e.timeNote || ''} placeholder="時間備註"
                                    onChange={ev => setExtraRecord(e.id, { timeNote: ev.target.value })}
                                    className="border border-[#DDD9D0] rounded-lg px-2 py-1.5 text-sm w-full sm:w-24" />
                                </>
                              ) : (
                                <>
                                  <select value={e.absType || ''}
                                    onChange={ev => setExtraRecord(e.id, { absType: ev.target.value })}
                                    className="border border-rose-200 bg-white rounded-lg px-2 py-1.5 text-sm flex-1 min-w-0">
                                    <option value="">請選假別</option>
                                    {(attendSettings.leaveTypes ?? []).map(t => <option key={t} value={t}>{t}</option>)}
                                  </select>
                                  <input type="text" value={e.note || ''} placeholder="備註原因"
                                    onChange={ev => setExtraRecord(e.id, { note: ev.target.value })}
                                    className="border border-[#DDD9D0] rounded-lg px-2 py-1.5 text-sm w-full sm:w-28" />
                                </>
                              )}
                              <button onClick={() => removeExtra(e.id)}
                                className="text-slate-300 hover:text-red-400 ml-auto">🗑</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })()}
    </div>
  );


  const nowTimeStr = () => new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });

  const PHONE_BREAK_SLOTS = [
    { key: 'morning', label: '上午' },
    { key: 'noon', label: '中午' },
    { key: 'afternoon', label: '下午' },
    { key: 'ot', label: '加班' },
  ];

  const PhoneField = ({ rec, field, label, checkboxClass, textClass, onSet }) => (
    <label className="flex items-center gap-1.5 cursor-pointer text-sm select-none">
      <input type="checkbox" checked={!!rec[field]}
        onChange={ev => onSet({
          [field]: ev.target.checked,
          [field + 'At']: ev.target.checked ? nowTimeStr() : '',
          // 繳交／未交互斥：勾一邊自動取消另一邊
          ...(ev.target.checked ? { [PHONE_OPPOSITE[field] ?? '_']: false } : {}),
        })}
        className={`w-5 h-5 cursor-pointer ${checkboxClass}`} />
      {label}{rec[field] && rec[field + 'At'] && <span className={`text-xs ml-1 ${textClass}`}>{rec[field + 'At']}</span>}
    </label>
  );

  // ── 櫃號分配：先試算並顯示結果，確認後才寫入
  const [lockerPreview, setLockerPreview] = useState(null);

  const handleAssignLockers = () => {
    const dadu = warehouses.find(w => w.name === '大肚倉');
    const deptNames = new Set((dadu?.departments ?? []).map(d => d.name));
    const targets = employees.filter(e =>
      e.status !== '離職' && deptNames.has(e.dept) && LOCKER_GROUP_CABINET[e.group]);
    if (targets.length === 0) { toast('大肚倉查無可分配櫃號的人員', 'warn'); return; }

    const result = assignLockers(targets, lockerAssign);
    // 依鐵櫃整理成可檢視的清單，並標出本次新配者
    const byCab = LOCKER_CABINETS.map(cab => ({
      id: cab.id,
      groups: cab.groups,
      rows: targets
        .filter(e => result.assign[e.id]?.cab === cab.id)
        .map(e => ({
          name: e.name, empId: e.empId, group: e.group,
          slot: result.assign[e.id].slot,
          isNew: lockerLabel(lockerAssign?.[e.id]) !== lockerLabel(result.assign[e.id]),
        }))
        .sort((a, b) => a.slot - b.slot),
    }));
    setLockerPreview({ ...result, byCab, targetCount: targets.length });
  };

  const confirmAssignLockers = () => {
    if (!lockerPreview) return;
    setLockerAssign(lockerPreview.assign);
    setLockerPreview(null);
    toast(`櫃號已套用：共 ${Object.keys(lockerPreview.assign).length} 人`, 'success');
  };

  // ── 手機櫃號總表：依鐵櫃列出全部 75 格的佔用狀況 ──
  const [lockerSheetOpen, setLockerSheetOpen] = useState(false);

  const lockerSheet = useMemo(() => {
    // 員工id → 員工資料，供總表顯示組別與廠商
    const empById = new Map(employees.map(e => [e.id, e]));

    // 長期人員（鐵櫃一／三／四）：來自固定綁定的 lockerAssign
    const fixed = LOCKER_CABINETS.map(cab => {
      const slots = Array.from({ length: LOCKER_CAPACITY }, () => null);
      for (const [id, a] of Object.entries(lockerAssign ?? {})) {
        if (a?.cab !== cab.id || !(a.slot >= 1 && a.slot <= LOCKER_CAPACITY)) continue;
        const e = empById.get(id);
        slots[a.slot - 1] = e
          ? { name: e.name, empId: e.empId, group: e.group, vendor: e.vendor }
          : { name: '（查無此人）', empId: '', group: '', vendor: '' };
      }
      return { id: cab.id, groups: cab.groups, slots, used: slots.filter(Boolean).length };
    });

    // 臨時人力（鐵櫃二）：逐日配發，來自當日 extras
    const tempSlots = Array.from({ length: LOCKER_CAPACITY }, () => null);
    for (const e of (extras[attendDate] ?? [])) {
      const sl = e.locker?.slot;
      if (e.locker?.cab !== TEMP_LOCKER_CAB || !(sl >= 1 && sl <= LOCKER_CAPACITY)) continue;
      tempSlots[sl - 1] = { name: e.name, empId: '', group: e.group ?? '', vendor: e.vendor ?? '' };
    }
    const tempCab = {
      id: TEMP_LOCKER_CAB, groups: [`臨時人力・${attendDate} 當日`],
      slots: tempSlots, used: tempSlots.filter(Boolean).length,
    };

    // 依鐵櫃編號排序：一、二、三、四
    return [fixed[0], tempCab, ...fixed.slice(1)];
  }, [lockerAssign, employees, extras, attendDate]);

  const exportLockerSheet = () => {
    try {
      const aoa = [['鐵櫃', '櫃號', '姓名', '員工編號', '組別', '廠商']];
      for (const cab of lockerSheet)
        cab.slots.forEach((p, i) => aoa.push([
          `鐵櫃 ${cab.id}`, `${i + 1}號格`,
          p?.name ?? '', p?.empId ?? '', p?.group ?? '', p?.vendor ?? '',
        ]));
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [{ wch: 6 }, { wch: 8 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 10 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '手機櫃號總表');
      XLSX.writeFile(wb, `手機櫃號總表_${attendDate}.xlsx`);
      toast('櫃號總表匯出成功', 'success');
    } catch (err) {
      toast('匯出失敗：' + err.message, 'error');
    }
  };

  const lockerSheetModal = lockerSheetOpen && (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
         onClick={() => setLockerSheetOpen(false)}>
      <div className="bg-white rounded-xl w-full max-w-4xl max-h-[85vh] flex flex-col"
           onClick={ev => ev.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[#DDD9D0] flex items-start gap-3 flex-wrap">
          <div className="min-w-0">
            <h3 className="font-bold text-slate-800">手機櫃號總表</h3>
            <p className="text-xs text-slate-500 mt-1">
              共 {lockerSheet.reduce((n, c) => n + c.used, 0)} 人已配號，
              空格 {lockerSheet.reduce((n, c) => n + (LOCKER_CAPACITY - c.used), 0)} 格
            </p>
          </div>
          <button onClick={exportLockerSheet}
            className="ml-auto px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700">
            📊 匯出 Excel
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {lockerSheet.map(cab => (
            <div key={cab.id}>
              <div className="text-sm font-semibold text-slate-700 mb-2">
                🔐 鐵櫃 {cab.id}
                <span className="ml-2 text-xs font-normal text-slate-400">
                  {cab.groups.join(' → ')}・已用 {cab.used}/{LOCKER_CAPACITY} 格
                </span>
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-1">
                {cab.slots.map((pp, i) => (
                  <div key={i}
                    title={pp ? `${pp.group}・${pp.vendor}・${pp.empId}` : '空格'}
                    className={`px-1.5 py-1 rounded border text-xs truncate
                      ${pp ? 'bg-indigo-50 border-indigo-200 text-indigo-900'
                           : 'bg-slate-50 border-slate-200 text-slate-300'}`}>
                    <b className="tabular-nums">{i + 1}號格</b>
                    <span className="ml-1">{pp ? pp.name : '空'}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="px-5 py-3 border-t border-[#DDD9D0] flex justify-end">
          <button onClick={() => setLockerSheetOpen(false)}
            className="px-4 py-2 border border-[#DDD9D0] rounded-lg text-sm hover:bg-[#F5F2EC]">
            關閉
          </button>
        </div>
      </div>
    </div>
  );

  const lockerPreviewModal = lockerPreview && (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
         onClick={() => setLockerPreview(null)}>
      <div className="bg-white rounded-xl w-full max-w-3xl max-h-[85vh] flex flex-col"
           onClick={ev => ev.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[#DDD9D0]">
          <h3 className="font-bold text-slate-800">櫃號分配試算</h3>
          <p className="text-xs text-slate-500 mt-1">
            對象：大肚倉在職且組別有對應鐵櫃者 {lockerPreview.targetCount} 人。
            本次新配 <strong className="text-indigo-700">{lockerPreview.assigned}</strong> 人
            {lockerPreview.released > 0 && <>、回收 <strong>{lockerPreview.released}</strong> 格</>}
            。既有櫃號一律保留不重排。<span className="text-emerald-700 font-medium">綠底＝本次新配</span>
          </p>
          {lockerPreview.overflow.length > 0 && (
            <p className="mt-2 text-xs text-red-600 font-medium">
              ⚠ 有 {lockerPreview.overflow.length} 人無格位可用（每櫃上限 {LOCKER_CAPACITY} 格）：
              {lockerPreview.overflow.map(e => e.name).join('、')}
            </p>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {lockerPreview.byCab.map(cab => (
            <div key={cab.id}>
              <div className="text-sm font-semibold text-slate-700 mb-2">
                🔐 鐵櫃 {cab.id}
                <span className="ml-2 text-xs font-normal text-slate-400">
                  {cab.groups.join(' → ')}・{cab.rows.length}/{LOCKER_CAPACITY} 格
                </span>
              </div>
              {cab.rows.length === 0
                ? <p className="text-xs text-slate-400 pl-4">無人員</p>
                : <div className="flex flex-wrap gap-1.5">
                    {cab.rows.map(r => (
                      <span key={r.empId ?? r.name}
                        title={`${r.group}・${r.empId ?? ''}`}
                        className={`px-2 py-1 rounded border text-xs
                          ${r.isNew
                            ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                            : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
                        <b>{r.slot}號格</b> {r.name}
                      </span>
                    ))}
                  </div>}
            </div>
          ))}
        </div>
        <div className="px-5 py-3 border-t border-[#DDD9D0] flex justify-end gap-2">
          <button onClick={() => setLockerPreview(null)}
            className="px-4 py-2 border border-[#DDD9D0] rounded-lg text-sm hover:bg-[#F5F2EC]">
            取消（不寫入）
          </button>
          <button onClick={confirmAssignLockers}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700">
            確認套用
          </button>
        </div>
      </div>
    </div>
  );

  // ── 手機控管統計
  // 手機控管子分頁：長期人員與臨時人力人數與作業節奏不同，分開檢視較好核對
  const phoneScopeLong = phoneScope !== 'temp';
  const phoneScopeTemp = phoneScope !== 'long';
  const phoneAllPeople = [
    ...(phoneScopeLong ? scopedEmps.map(e => getRecord(e.id)) : []),
    ...(phoneScopeTemp ? dateExtras : []),
  ];
  const phoneTotalCount = phoneAllPeople.length;
  const phoneSignedInCount = phoneAllPeople.filter(r => r.signedIn).length;
  const phoneSignedOutCount = phoneAllPeople.filter(r => r.signedOut).length;
  const phoneSubmittedCount = phoneAllPeople.filter(r => r.phoneSubmitted).length;
  const phoneNotSubmittedCount = phoneAllPeople.filter(r => r.phoneNotSubmitted).length;
  // 已明確標記「未交」者視為已處理，不再列為待辦
  const phoneIsIncomplete = r => !(r.signedIn && (r.phoneSubmitted || r.phoneNotSubmitted));
  const phoneIncompleteCount = phoneAllPeople.filter(phoneIsIncomplete).length;

  const StatTile = ({ label, value, total, color, note }) => (
    <div className="flex-1 min-w-[100px] bg-white border border-[#DDD9D0] rounded-xl px-4 py-3">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`text-xl font-bold ${color}`}>{value}<span className="text-sm text-slate-400 font-normal">/{total}</span></div>
      {note && <div className="text-[11px] text-amber-600 mt-0.5">{note}</div>}
    </div>
  );

  // ── 手機控管分頁
  const phonePane = (
    <div className="space-y-4">
      {lockerPreviewModal}
      {lockerSheetModal}

      {/* 長期／臨時切換：兩者人數與作業節奏不同，分開檢視較好核對 */}
      <div className="flex gap-1 border-b border-[#DDD9D0]">
        {[
          { key: 'all',  label: '全部',     n: scopedEmps.length + dateExtras.length },
          { key: 'long', label: '長期人員', n: scopedEmps.length },
          { key: 'temp', label: '臨時人力', n: dateExtras.length },
        ].map(t => (
          <button key={t.key} onClick={() => setPhoneScope(t.key)}
            className={`px-4 py-2 text-sm rounded-t-lg border-b-2 -mb-px transition-colors
              ${phoneScope === t.key
                ? 'font-semibold text-indigo-700 border-indigo-600 bg-white'
                : 'text-slate-500 border-transparent hover:bg-white/60'}`}>
            {t.label}
            <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full
              ${phoneScope === t.key ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'}`}>
              {t.n}
            </span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        <StatTile label="應到人數" value={phoneTotalCount} total={phoneTotalCount} color="text-slate-700"
          note={phoneScopeLong && offDutyPresentIds.size > 0 ? `含 ${offDutyPresentIds.size} 位排休出勤` : null} />
        <StatTile label="已簽到" value={phoneSignedInCount} total={phoneTotalCount} color="text-teal-600" />
        <StatTile label="已簽退" value={phoneSignedOutCount} total={phoneTotalCount} color="text-slate-600" />
        <StatTile label="已繳交手機" value={phoneSubmittedCount} total={phoneTotalCount} color="text-indigo-600" />
        <StatTile label="手機未交" value={phoneNotSubmittedCount} total={phoneTotalCount} color={phoneNotSubmittedCount > 0 ? 'text-orange-600' : 'text-slate-400'} />
        <StatTile label="尚未完成" value={phoneIncompleteCount} total={phoneTotalCount} color={phoneIncompleteCount > 0 ? 'text-rose-600' : 'text-emerald-600'} />
      </div>

      <div className="bg-white border border-[#DDD9D0] rounded-xl p-4 flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-xs text-slate-500 mb-1">日期</label>
          <input type="date" value={attendDate} onChange={e => setAttendDate(e.target.value)}
            className="border border-[#DDD9D0] rounded-lg px-3 py-2 text-sm" />
        </div>
        <label className="flex items-center gap-1.5 cursor-pointer text-sm text-slate-600 select-none">
          <input type="checkbox" checked={phoneOnlyIncomplete}
            onChange={ev => setPhoneOnlyIncomplete(ev.target.checked)}
            className="w-4 h-4 accent-rose-600 cursor-pointer" />
          只顯示未完成（未簽到或未繳交手機）
        </label>
        {(currentUser.role === ROLES.ADMIN || currentUser.role === ROLES.AREA) && (
          <button onClick={handleAssignLockers}
            title={`${LOCKER_CABINETS.map(c => `鐵櫃${c.id}：${c.groups.join(' → ')}`).join('；')}。每櫃 ${LOCKER_CAPACITY} 格，既有櫃號不會被重排。`}
            className="px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700
                       flex items-center gap-1">
            🔐 分配櫃號
          </button>
        )}
        <button onClick={() => setLockerSheetOpen(true)}
          className="px-3 py-2 bg-white border border-[#DDD9D0] text-slate-700 rounded-lg text-sm
                     hover:bg-[#F5F2EC] flex items-center gap-1">
          📋 櫃號總表
        </button>
        <div className="ml-auto text-sm text-slate-500">
          已繳交手機 <span className="font-bold text-indigo-700">{phoneSubmittedCount}</span>/{phoneTotalCount}人
        </div>
      </div>

      {Object.keys(vendorGroups).length === 0 && dateExtras.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-10">請先在人員清冊匯入資料，或使用匯入派工表</p>
      ) : (() => {
        const allVendors = sortVendorNames([...new Set([
          ...Object.keys(vendorGroups),
          ...Object.keys(extrasVendorGroups),
        ])]);
        return (
          <div className="space-y-2">
            {allVendors.map(vName => {
              let longEmps = phoneScopeLong ? (vendorGroups[vName] ?? []) : [];
              let tempEmps = phoneScopeTemp ? (extrasVendorGroups[vName] ?? []) : [];
              if (phoneOnlyIncomplete) {
                longEmps = longEmps.filter(emp => phoneIsIncomplete(getRecord(emp.id)));
                tempEmps = tempEmps.filter(e => phoneIsIncomplete(e));
              }
              const all = [...longEmps, ...tempEmps];
              if (all.length === 0) return null;
              return (
                <div key={vName} className="border border-[#DDD9D0] rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between bg-indigo-600 text-white px-4 py-2.5">
                    <span className="font-semibold flex items-center gap-2">
                      📱 {vName}
                    </span>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {longEmps.map(emp => {
                      const rec = getRecord(emp.id);
                      return (
                        <div key={emp.id} className="px-3 py-3 flex items-start gap-4 flex-wrap">
                          <div className="min-w-[100px] flex-shrink-0">
                            <div className="font-medium text-slate-800 text-sm">{emp.name}</div>
                            <div className="text-xs text-slate-400">{emp.empId}</div>
                            {offDutyPresentIds.has(emp.id) && (
                              <div className="mt-0.5 inline-block px-1.5 py-0.5 rounded bg-amber-100
                                              border border-amber-300 text-amber-800 text-xs font-semibold
                                              whitespace-nowrap">
                                排休出勤
                              </div>
                            )}
                            {lockerAssign?.[emp.id] && (
                              <div className="mt-0.5 inline-block px-1.5 py-0.5 rounded bg-indigo-50
                                              border border-indigo-200 text-indigo-700 text-xs font-semibold
                                              whitespace-nowrap">
                                🔐 {lockerLabel(lockerAssign[emp.id])}
                              </div>
                            )}
                          </div>
                          <div className="flex flex-col gap-1.5 flex-1 min-w-[220px]">
                            <div className="flex items-center gap-4 flex-wrap">
                              <PhoneField rec={rec} field="signedIn" label="簽到" checkboxClass="accent-teal-600" textClass="text-teal-600" onSet={p => setRecord(emp.id, p)} />
                              <PhoneField rec={rec} field="signedOut" label="簽退" checkboxClass="accent-slate-600" textClass="text-slate-600" onSet={p => setRecord(emp.id, p)} />
                            </div>
                            <div className="flex items-center gap-4 flex-wrap">
                              <PhoneField rec={rec} field="phoneSubmitted" label="上班繳交手機" checkboxClass="accent-indigo-600" textClass="text-indigo-600" onSet={p => setRecord(emp.id, p)} />
                              <PhoneField rec={rec} field="phoneNotSubmitted" label="手機未交" checkboxClass="accent-orange-600" textClass="text-orange-600" onSet={p => setRecord(emp.id, p)} />
                            </div>
                            {PHONE_BREAK_SLOTS.map(slot => (
                              <div key={slot.key} className="flex items-center gap-4 flex-wrap">
                                <span className="text-xs text-slate-400 w-8 flex-shrink-0">{slot.label}</span>
                                <PhoneField rec={rec} field={`${slot.key}Taken`} label="領取" checkboxClass="accent-amber-600" textClass="text-amber-600" onSet={p => setRecord(emp.id, p)} />
                                <PhoneField rec={rec} field={`${slot.key}Returned`} label="歸還" checkboxClass="accent-emerald-600" textClass="text-emerald-600" onSet={p => setRecord(emp.id, p)} />
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                    {tempEmps.map(e => (
                      <div key={e.id} className="px-3 py-3 flex items-start gap-4 flex-wrap bg-amber-50/40">
                        <div className="min-w-[100px] flex-shrink-0">
                          <div className="font-medium text-slate-800 text-sm">{e.name}</div>
                          <div className="text-xs text-slate-400">
                            {e._isImport
                              ? (e._claimId ? '派工匯入・本人已登入' : '派工匯入')
                              : e._isTemp ? '臨時人力自填' : '手動新增'}
                          </div>
                          {e._unlisted && (
                            <div className="mt-0.5 inline-block px-1.5 py-0.5 rounded bg-amber-100
                                            border border-amber-300 text-amber-800 text-xs font-semibold
                                            whitespace-nowrap">
                              不在派工名單
                            </div>
                          )}
                          {e.locker && (
                            <div className="mt-0.5 inline-block px-1.5 py-0.5 rounded bg-indigo-50
                                            border border-indigo-200 text-indigo-700 text-xs font-semibold
                                            whitespace-nowrap">
                              🔐 {lockerLabel(e.locker)}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col gap-1.5 flex-1 min-w-[220px]">
                          <div className="flex items-center gap-4 flex-wrap">
                            <PhoneField rec={e} field="signedIn" label="簽到" checkboxClass="accent-teal-600" textClass="text-teal-600" onSet={p => setExtraRecord(e.id, p)} />
                            <PhoneField rec={e} field="signedOut" label="簽退" checkboxClass="accent-slate-600" textClass="text-slate-600" onSet={p => setExtraRecord(e.id, p)} />
                          </div>
                          <div className="flex items-center gap-4 flex-wrap">
                            <PhoneField rec={e} field="phoneSubmitted" label="上班繳交手機" checkboxClass="accent-indigo-600" textClass="text-indigo-600" onSet={p => setExtraRecord(e.id, p)} />
                            <PhoneField rec={e} field="phoneNotSubmitted" label="手機未交" checkboxClass="accent-orange-600" textClass="text-orange-600" onSet={p => setExtraRecord(e.id, p)} />
                          </div>
                          {PHONE_BREAK_SLOTS.map(slot => (
                            <div key={slot.key} className="flex items-center gap-4 flex-wrap">
                              <span className="text-xs text-slate-400 w-8 flex-shrink-0">{slot.label}</span>
                              <PhoneField rec={e} field={`${slot.key}Taken`} label="領取" checkboxClass="accent-amber-600" textClass="text-amber-600" onSet={p => setExtraRecord(e.id, p)} />
                              <PhoneField rec={e} field={`${slot.key}Returned`} label="歸還" checkboxClass="accent-emerald-600" textClass="text-emerald-600" onSet={p => setExtraRecord(e.id, p)} />
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            {phoneOnlyIncomplete && phoneIncompleteCount === 0 && (
              <p className="text-sm text-emerald-600 text-center py-10">🎉 全員已完成簽到與繳交手機</p>
            )}
          </div>
        );
      })()}
    </div>
  );

  // (ReportPane is defined at module level)

  // (MaintPane is defined at module level)


  return (
    <div className="p-6 space-y-4 max-w-4xl">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-800">{phoneOnly ? '手機控管' : '點名表'}</h2>
        {lastSync && (
          <span className="text-xs text-slate-400">
            🔄 {lastSync.toLocaleTimeString('zh-TW', {hour:'2-digit',minute:'2-digit',second:'2-digit'})} 已同步
          </span>
        )}
      </div>

      {!phoneOnly && <div className="flex border-b border-[#DDD9D0] bg-[#F5F2EC] rounded-t-xl overflow-x-auto">
        <AttendSubBtn active={subTab==='attend'} onClick={() => setSubTab('attend')} icon="☑️" label="點名" />
        <AttendSubBtn active={subTab==='stats'}  onClick={() => setSubTab('stats')}  icon="📊" label="統計" />
        <AttendSubBtn active={subTab==='report'} onClick={() => setSubTab('report')} icon="📋" label="回報" />
        <AttendSubBtn active={subTab==='maint'}  onClick={() => setSubTab('maint')}  icon="⚙️" label="維護" />
        <AttendSubBtn active={subTab==='import'} onClick={() => setSubTab('import')} icon="📂" label="匯入" />
      </div>}

      <div>
        {subTab === 'attend' && attendPane}
        {subTab === 'phone'  && phonePane}
        {subTab === 'stats'  && <StatsPane attendDate={attendDate} selectedGroup={selectedGroup} totalCount={totalCount} presentCount={presentCount} absentCount={absentCount} attendRate={attendRate} groupOptions={groupOptions} exportStats={exportStats} />}
        {subTab === 'report' && <ReportPane generateReport={generateReport} groupOptions={groupOptions} attendDate={attendDate} selectedGroup={selectedGroup} />}
        {subTab === 'maint'  && <MaintPane attendSettings={attendSettings} setAttendSettings={setAttendSettings} groupOptions={groupOptions} />}
        {subTab === 'import' && <ImportPane todayStr={todayStr} />}
      </div>

      {addModal && (
        <Modal onClose={() => setAddModal(false)}>
          <div className="bg-white rounded-xl shadow w-full max-w-sm p-6">
            <h3 className="font-bold text-lg text-slate-800 mb-4">手動新增人員</h3>
            <div className="mb-3">
              <label className="block text-sm font-medium text-slate-700 mb-1">姓名 <span className="text-red-400">*</span></label>
              <input value={addForm.name} onChange={e => setAddForm(p => ({ ...p, name: e.target.value }))}
                className="w-full border border-[#DDD9D0] rounded-lg px-3 py-1.5 text-sm" placeholder="請輸入姓名" />
            </div>
            <div className="mb-3">
              <label className="block text-sm font-medium text-slate-700 mb-1">廠商</label>
              <input value={addForm.vendor} onChange={e => setAddForm(p => ({ ...p, vendor: e.target.value }))}
                className="w-full border border-[#DDD9D0] rounded-lg px-3 py-1.5 text-sm" placeholder="選填" />
            </div>
            <div className="mb-3">
              <label className="block text-sm font-medium text-slate-700 mb-1">作業組別</label>
              <select value={addForm.group} onChange={e => setAddForm(p => ({ ...p, group: e.target.value }))}
                className="w-full border border-[#DDD9D0] rounded-lg px-3 py-1.5 text-sm">
                <option value="">選填</option>
                {groupOptions.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div className="mb-5">
              <label className="block text-sm font-medium text-slate-700 mb-1">備註</label>
              <input value={addForm.note} onChange={e => setAddForm(p => ({ ...p, note: e.target.value }))}
                className="w-full border border-[#DDD9D0] rounded-lg px-3 py-1.5 text-sm" placeholder="選填" />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setAddModal(false)}
                className="px-4 py-2 border border-[#DDD9D0] rounded-lg text-sm hover:bg-[#F5F2EC]">取消</button>
              <button onClick={handleAddExtra}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">新增</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function VendorCompanyRow({ vendorName, companyTitle, onSave }) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(companyTitle);

  React.useEffect(() => { setDraft(companyTitle); }, [companyTitle]);

  return (
    <div className="flex items-center gap-3 py-2.5 px-1">
      <span className="w-20 shrink-0 text-sm font-medium text-slate-700">{vendorName}</span>
      {editing ? (
        <>
          <input
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { onSave(vendorName, draft.trim()); setEditing(false); }
              if (e.key === 'Escape') { setDraft(companyTitle); setEditing(false); }
            }}
            className="flex-1 border border-blue-400 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
          <button onClick={() => { onSave(vendorName, draft.trim()); setEditing(false); }}
            className="px-3 py-1 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700">儲存</button>
          <button onClick={() => { setDraft(companyTitle); setEditing(false); }}
            className="px-3 py-1 border border-[#DDD9D0] rounded-lg text-xs hover:bg-[#F5F2EC]">取消</button>
        </>
      ) : (
        <>
          <span className="flex-1 text-sm text-slate-500">{companyTitle || <span className="italic text-slate-300">（未設定）</span>}</span>
          <button onClick={() => setEditing(true)}
            className="px-3 py-1 border border-[#DDD9D0] rounded-lg text-xs hover:bg-[#F5F2EC] text-slate-600">編輯</button>
        </>
      )}
    </div>
  );
}

// 系統設定的可收合區塊：設定項目多，全部展開會讓頁面過長難以瀏覽。
// 預設全部收合，點標題列展開；state 存在各自的元件內，切換分頁後回到預設。
function SettingsSection({ title, desc, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white border border-[#DDD9D0] rounded-xl overflow-hidden">
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-start gap-2 px-5 py-3.5 text-left hover:bg-[#F5F2EC] transition-colors">
        <span className="text-slate-400 text-xs mt-1 w-3 shrink-0">{open ? '▼' : '▶'}</span>
        <span className="min-w-0">
          <span className="block font-semibold text-slate-700">{title}</span>
          {desc && !open && <span className="block text-xs text-slate-400 mt-0.5 truncate">{desc}</span>}
        </span>
      </button>
      {open && <div className="px-5 pb-5 border-t border-[#DDD9D0] pt-4">{children}</div>}
    </div>
  );
}

function Settings() {
  const {
    systemLocked, setSystemLocked,
    deptLocks, setDeptLocks,
    deptRanges, setDeptRanges,
    deptSegments, setDeptSegments,
    dailyDemand, setDailyDemand,
    unlockPwd, setUnlockPwd,
    periodRange, setPeriodRange,
    lockerAssign, setLockerAssign,
    scheduleRange, setScheduleRange,
    openHolidays, setOpenHolidays,
    vendorHolidayOpen, setVendorHolidayOpen,
    vendorRestOpen, setVendorRestOpen,
    workerRestOpen, setWorkerRestOpen,
    vendorCompanyNames, setVendorCompanyNames,
    vendors, setVendors,
    warehouses, setWarehouses,
    workAreas, setWorkAreas,
    employees, setEmployees,
    selectedYear, currentUser,
  } = useApp();
  const toast = useToast();

  // 系統設定含破壞性（刪除倉別／課別／廠商）與全域設定，日翊僅開放課別鎖定與開放區間
  const isAdminUser = currentUser?.role === ROLES.ADMIN;
  // 全域區間已取消，國定假日改以各課別區間的聯集決定篩選範圍
  const unionRange = useMemo(() => unionAllSegments(deptSegments, deptRanges), [deptSegments, deptRanges]);

  // ── 作業區設定 ──
  const [areaInput, setAreaInput] = useState('');
  const [unlockInput, setUnlockInput] = useState('');
  const addArea = () => {
    const v = areaInput.trim();
    if (!v) { toast('請輸入作業區名稱', 'error'); return; }
    if (workAreas.includes(v)) { toast(`「${v}」已存在`, 'warn'); return; }
    setWorkAreas([...workAreas, v]);
    setAreaInput('');
    toast(`已新增作業區：${v}`, 'success');
  };
  const removeArea = (a, used) => {
    // 仍有人員指派時需確認，刪除後那些人會變成「未設定」
    if (used > 0 && !window.confirm(`目前有 ${used} 位人員指派為「${a}」。
刪除後這些人的作業區會變成「未設定」，確定刪除？`)) return;
    setWorkAreas(workAreas.filter(x => x !== a));
    if (used > 0) setEmployees(prev => prev.map(e => e.workArea === a ? { ...e, workArea: '' } : e));
    toast(`已刪除作業區：${a}`, 'info');
  };

  // ── 每期日期區間 ──
  const [pStart, setPStart] = useState(periodRange.start ?? '');
  const [pEnd,   setPEnd]   = useState(periodRange.end   ?? '');
  useEffect(() => {
    setPStart(periodRange.start ?? '');
    setPEnd(periodRange.end ?? '');
  }, [periodRange]);
  const periodDays = (pStart && pEnd && pStart <= pEnd)
    ? Math.round((parseLocal(pEnd) - parseLocal(pStart)) / 86400000) + 1
    : 0;
  const savePeriod = () => {
    if (!pStart || !pEnd) { toast('請填寫起訖日期', 'error'); return; }
    if (pStart > pEnd)    { toast('結束日期不可早於開始日期', 'error'); return; }
    setPeriodRange({ start: pStart, end: pEnd });
    toast(`每期日期區間已儲存（共 ${periodDays} 天）`, 'success');
  };

  // 課別鎖定／開放區間只列出自己權責範圍內的倉別：
  // 管理員為全倉；其餘角色依 allowedWarehouses（未指派則不顯示任何倉別）。
  // 各倉可分別展開／收合，避免課別一次全部攤開
  const [openLockWh, setOpenLockWh] = useState(() => new Set());

  const lockableWarehouses = useMemo(() => {
    if (currentUser?.role === ROLES.ADMIN) return warehouses;
    const allowed = currentUser?.allowedWarehouses ?? [];
    return allowed.length > 0 ? warehouses.filter(w => allowed.includes(w.id)) : [];
  }, [warehouses, currentUser]);

  const vendorNames = vendors.map(v => v.name);

  // ── 廠商別 modal 狀態 ──
  const emptyVd = { id: '', code: '', name: '', companyHeader: '' };
  const [vdModal,  setVdModal]  = useState(false);
  const [vdTarget, setVdTarget] = useState(null);
  const [vdForm,   setVdForm]   = useState(emptyVd);

  const openAddVd  = () => { setVdForm(emptyVd); setVdTarget(null); setVdModal(true); };
  const openEditVd = vd => { setVdForm({ companyHeader: vendorCompanyNames[vd.name] ?? '', ...vd }); setVdTarget(vd); setVdModal(true); };

  const saveVd = () => {
    if (!vdForm.name.trim()) { toast('廠商名稱為必填', 'error'); return; }
    if (vendors.some(v => v.name === vdForm.name.trim() && v.id !== vdForm.id)) {
      toast('已有相同廠商名稱', 'error'); return;
    }
    const updated = { ...vdForm, name: vdForm.name.trim(), code: vdForm.code.trim().toUpperCase(), companyHeader: vdForm.companyHeader.trim() };
    if (vdTarget) {
      setVendors(prev => prev.map(v => v.id === updated.id ? updated : v));
      toast('廠商已更新：' + updated.name, 'success');
    } else {
      setVendors(prev => [...prev, { ...updated, id: 'vd_' + Date.now() }]);
      toast('已新增廠商：' + updated.name, 'success');
    }
    if (updated.companyHeader) {
      setVendorCompanyNames(prev => {
        const next = { ...prev, [updated.name]: updated.companyHeader };
        LS.set('sms_vendor_company_names', next);
        return next;
      });
    }
    setVdModal(false);
  };

  const deleteVd = id => {
    const vd = vendors.find(v => v.id === id);
    setVendors(prev => prev.filter(v => v.id !== id));
    toast(`廠商「${vd?.name}」已移除`, 'info');
  };

  // ── 倉別 modal 狀態 ──
  const emptyWh = { id: '', name: '' };
  const [whModal, setWhModal]   = useState(false);
  const [whTarget, setWhTarget] = useState(null);
  const [whForm,   setWhForm]   = useState(emptyWh);

  // ── 課別 modal 狀態 ──
  const emptyDept = { id: '', code: '', name: '', vendors: [], groups: [] };
  const [deptModal,  setDeptModal]  = useState(false);
  const [deptWhId,   setDeptWhId]   = useState(null);   // parent warehouse id
  const [deptTarget, setDeptTarget] = useState(null);
  const [deptForm,   setDeptForm]   = useState(emptyDept);
  const [groupInput, setGroupInput] = useState('');

  // ── 倉別 CRUD ──
  const openAddWh  = () => { setWhForm(emptyWh); setWhTarget(null); setWhModal(true); };
  const openEditWh = wh => { setWhForm({ id: wh.id, name: wh.name }); setWhTarget(wh); setWhModal(true); };

  const saveWh = () => {
    if (!whForm.name.trim()) { toast('倉別名稱為必填', 'error'); return; }
    if (whTarget) {
      setWarehouses(prev => prev.map(w => w.id === whForm.id
        ? { ...w, name: whForm.name.trim() } : w));
      toast('倉別已更新：' + whForm.name, 'success');
    } else {
      setWarehouses(prev => [...prev, { id: 'wh' + Date.now(), name: whForm.name.trim(), departments: [] }]);
      toast('已新增倉別：' + whForm.name, 'success');
    }
    setWhModal(false);
  };

  const deleteWh = id => {
    setWarehouses(prev => prev.filter(w => w.id !== id));
    toast('倉別已刪除', 'info');
  };

  // ── 課別 CRUD ──
  const openAddDept = whId => {
    setDeptForm(emptyDept); setDeptTarget(null); setDeptWhId(whId); setGroupInput(''); setDeptModal(true);
  };
  const openEditDept = (whId, dept) => {
    setDeptForm({ groups: [], ...dept }); setDeptTarget(dept); setDeptWhId(whId); setGroupInput(''); setDeptModal(true);
  };

  const saveDept = () => {
    if (!deptForm.name.trim()) { toast('課別名稱為必填', 'error'); return; }
    setWarehouses(prev => prev.map(w => {
      if (w.id !== deptWhId) return w;
      if (deptTarget) {
        return { ...w, departments: w.departments.map(d =>
          d.id === deptForm.id ? { ...deptForm, name: deptForm.name.trim(), code: deptForm.code.trim() } : d
        )};
      } else {
        return { ...w, departments: [...w.departments, {
          ...deptForm, id: 'dept_' + Date.now(),
          name: deptForm.name.trim(), code: deptForm.code.trim()
        }]};
      }
    }));
    toast(deptTarget ? '課別已更新' : '已新增課別：' + deptForm.name, 'success');
    setDeptModal(false);
  };

  const deleteDept = (whId, deptId) => {
    setWarehouses(prev => prev.map(w =>
      w.id === whId ? { ...w, departments: w.departments.filter(d => d.id !== deptId) } : w
    ));
    toast('課別已刪除', 'info');
  };

  const toggleDeptVendor = v => {
    setDeptForm(p => ({
      ...p,
      vendors: p.vendors.includes(v) ? p.vendors.filter(x => x !== v) : [...p.vendors, v],
    }));
  };

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <h2 className="text-xl font-bold text-slate-800">系統設定</h2>


      {/* ── 每期日期區間 ── */}
      <SettingsSection title="每期日期區間"
        desc={isAdminUser ? '定義一期涵蓋哪些日子，決定班表顯示與翻頁單位' : '全域設定，僅管理員可修改'}>
        <p className="text-xs text-slate-500 mb-3">
          排班以<strong>週期</strong>為單位而非月份。此處設定「一期」的起訖日，班表即以此為一頁顯示，
          用 ◀ ▶ 可往前後翻期，出勤天／休假天也依此期間統計。
          <br />
          <strong className="text-slate-600">此設定與「各課別開放排班區間」互相獨立</strong>——
          前者決定<strong>看到哪些日子</strong>，後者決定<strong>各課什麼時候可以編輯</strong>，兩者可以不同。
        </p>
        {isAdminUser ? (
          <>
            <div className="flex gap-3 items-end flex-wrap">
              <div>
                <label className="block text-xs text-slate-600 mb-1">本期開始日</label>
                <input type="date" value={pStart} onChange={e => setPStart(e.target.value)}
                  className="border border-[#DDD9D0] rounded-lg px-3 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">本期結束日</label>
                <input type="date" value={pEnd} onChange={e => setPEnd(e.target.value)}
                  className="border border-[#DDD9D0] rounded-lg px-3 py-1.5 text-sm" />
              </div>
              {periodDays > 0 && (
                <span className="px-2.5 py-1.5 rounded-lg bg-blue-50 border border-blue-200
                                 text-blue-700 text-sm font-semibold">共 {periodDays} 天</span>
              )}
              <button onClick={savePeriod}
                className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
                儲存
              </button>
              <button onClick={() => { setPStart(''); setPEnd(''); setPeriodRange({}); toast('已清除，班表改以月份檢視', 'info'); }}
                className="px-4 py-1.5 border border-[#DDD9D0] rounded-lg text-sm hover:bg-[#F5F2EC]">
                清除
              </button>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              留空則班表退回以「年／月」檢視。翻期是以本期天數為單位往前後推算，
              例如設定 28 天，按 ▶ 就是往後 28 天。
            </p>
          </>
        ) : (
          <p className="text-sm text-slate-600 bg-[#F5F2EC] border border-[#DDD9D0] rounded-lg px-3 py-2">
            🔒 此為全域設定，僅管理員可修改。
          </p>
        )}
        {periodRange.start && (
          <p className="mt-3 text-xs text-teal-700">
            目前設定：{periodRange.start} ～ {periodRange.end}
          </p>
        )}
      </SettingsSection>

      {/* ── 各課別鎖定與開放區間 ── */}
      <SettingsSection title="各課別鎖定與開放區間" desc="各課可分別鎖定並自訂開放區間">
        <p className="text-xs text-slate-500 mb-2">
          班表編輯權限以<strong>課別</strong>為單位控管。各課排班完成時間不同，可在該課排完後單獨鎖定，不影響其他課別。
          <br />開放排班區間<strong>一律由各課自行設定</strong>；<strong className="text-amber-700">未設定的課別視為尚未開放，該課人員無法排班</strong>。
        </p>

        {/* 各選項的實際效果對照 */}
        <div className="mb-4 bg-[#F5F2EC] border border-[#DDD9D0] rounded-lg px-3 py-2">
          <div className="text-xs font-semibold text-slate-600 mb-1.5">各選項實際效果</div>
          <div className="space-y-1 text-xs">
            {[
              { icon: '🔓', label: '解除鎖定', riyi: true,  vendor: true,  note: '' },
              { icon: '🔐', label: '部分鎖定', riyi: true,  vendor: false, note: '' },
              { icon: '🔒', label: '全部鎖定', riyi: false, vendor: false, note: '（該課鎖住）' },
            ].map(r => (
              <div key={r.label} className="flex items-center gap-2 flex-wrap">
                <span className="w-24 shrink-0 text-slate-700">{r.icon} {r.label}</span>
                <span className={r.riyi ? 'text-emerald-700' : 'text-red-600'}>
                  日翊{r.riyi ? '可' : '✗'}
                </span>
                <span className="text-slate-300">·</span>
                <span className={r.vendor ? 'text-emerald-700' : 'text-red-600'}>
                  廠商{r.vendor ? '可' : '✗'}
                </span>
                {r.note && <span className="text-slate-400">{r.note}</span>}
              </div>
            ))}
          </div>
          <div className="text-xs text-slate-400 mt-1.5">※「廠商」含廠商幹部與委外人員</div>
        </div>
        {lockableWarehouses.length === 0 ? (
          <p className="text-sm text-slate-400">
            {warehouses.length === 0 ? '尚未設定倉別' : '您尚未被指派可管理的倉別'}
          </p>
        ) : (
          <div className="space-y-4">
            {lockableWarehouses.map(w => {
              const open = openLockWh.has(w.id);
              // 摘要：讓收合狀態下也看得出哪些倉已設定
              const setCount = (w.departments ?? [])
                .filter(d => segmentsOf(deptSegments, deptRanges, deptLocks, d.name).length > 0).length;
              return (
              <div key={w.id} className="border border-[#DDD9D0] rounded-xl overflow-hidden">
                <button
                  onClick={() => setOpenLockWh(prev => {
                    const n = new Set(prev);
                    n.has(w.id) ? n.delete(w.id) : n.add(w.id);
                    return n;
                  })}
                  className="w-full flex items-center gap-2 px-3 py-2.5 bg-[#F5F2EC] hover:bg-[#EFEAE1] transition-colors">
                  <span className="text-slate-400 text-xs">{open ? '▼' : '▶'}</span>
                  <span className="text-sm font-semibold text-slate-700">🏭 {w.name}</span>
                  <span className="text-xs text-slate-400">
                    {(w.departments ?? []).length} 課
                    {setCount > 0
                      ? <span className="text-indigo-600 font-medium">　已設定 {setCount} 課</span>
                      : <span className="text-amber-600 font-medium">　尚未設定</span>}
                  </span>
                </button>
                {!open ? null : (w.departments ?? []).length === 0 ? (
                  <p className="text-xs text-slate-400 p-3">此倉別尚無課別</p>
                ) : (
                  <div className="space-y-1.5 p-3">
                    {(w.departments ?? []).map(d => {
                      const segs = segmentsOf(deptSegments, deptRanges, deptLocks, d.name);
                      const groupOpts = d.groups ?? [];
                      const write = (next) => {
                        setDeptSegments(prev => ({ ...prev, [d.name]: next }));
                        // 新格式一旦建立即以其為準，清掉同課的舊格式避免兩套並存
                        setDeptRanges(prev => { const n = { ...prev }; delete n[d.name]; return n; });
                        setDeptLocks(prev  => { const n = { ...prev }; delete n[d.name]; return n; });
                      };
                      const addSeg = () => write([...segs, {
                        id: 'sg' + Date.now() + Math.random().toString(36).slice(2, 5),
                        start: '', end: '', lock: 'none', groups: [],
                      }]);
                      const patch = (i, k, v) => write(segs.map((s, idx) => idx === i ? { ...s, [k]: v } : s));
                      const drop = (i) => {
                        const next = segs.filter((_, idx) => idx !== i);
                        write(next);
                        toast(`${d.name}：已刪除一段區間${next.length === 0 ? '，該課目前僅能查看班表' : ''}`, 'warn');
                      };

                      return (
                        <div key={d.id ?? d.name} className="border border-[#DDD9D0] rounded-xl p-3 bg-white">
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            <span className="text-sm font-semibold text-slate-700">{d.name}</span>
                            {segs.length === 0
                              ? <span className="text-xs text-amber-600 font-medium">尚未設定，僅能查看班表</span>
                              : <span className="text-xs text-slate-400">{segs.length} 段區間</span>}
                            <button onClick={addSeg}
                              className="ml-auto px-2.5 py-1 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700">
                              ＋ 新增區間
                            </button>
                          </div>

                          {segs.length === 0 && (
                            <p className="text-xs text-slate-400">
                              按「新增區間」設定開放排班的日期；同一課的不同組別、不同期間可各自設定鎖定模式。
                            </p>
                          )}

                          <div className="space-y-2">
                            {segs.map((sg, i) => {
                              const cur = normalizeLockMode(sg.lock);
                              return (
                                <div key={sg.id ?? i} className="flex items-center gap-2 flex-wrap
                                                                 border-t border-slate-100 pt-2 first:border-t-0 first:pt-0">
                                  <input type="date" value={sg.start ?? ''} onChange={e => patch(i, 'start', e.target.value)}
                                    className="border border-[#DDD9D0] rounded-lg px-2 py-1 text-xs" />
                                  <span className="text-xs text-slate-400">~</span>
                                  <input type="date" value={sg.end ?? ''} onChange={e => patch(i, 'end', e.target.value)}
                                    className="border border-[#DDD9D0] rounded-lg px-2 py-1 text-xs" />

                                  <div className="flex gap-1">
                                    {LOCK_MODES.map(m => {
                                      const active = cur === m.key;
                                      const tone = m.key === 'none' ? 'bg-emerald-600' : m.key === 'partial' ? 'bg-amber-500' : 'bg-red-600';
                                      return (
                                        <button key={m.key} onClick={() => patch(i, 'lock', m.key)} title={m.desc}
                                          className={`px-2.5 py-1 text-xs rounded-lg border transition-colors
                                            ${active ? `${tone} text-white border-transparent` : 'bg-white border-[#DDD9D0] text-slate-600 hover:bg-[#F5F2EC]'}`}>
                                          {m.icon} {m.label}
                                        </button>
                                      );
                                    })}
                                  </div>

                                  <div className="flex items-center gap-1 flex-wrap">
                                    <span className="text-xs text-slate-400">適用組別</span>
                                    <button onClick={() => patch(i, 'groups', [])}
                                      className={`px-2 py-1 text-xs rounded-lg border transition-colors
                                        ${(sg.groups ?? []).length === 0
                                          ? 'bg-slate-700 text-white border-transparent'
                                          : 'bg-white border-[#DDD9D0] text-slate-600 hover:bg-[#F5F2EC]'}`}>
                                      全部
                                    </button>
                                    {groupOpts.map(g => {
                                      const on = (sg.groups ?? []).includes(g);
                                      return (
                                        <button key={g}
                                          onClick={() => patch(i, 'groups', on
                                            ? (sg.groups ?? []).filter(x => x !== g)
                                            : [...(sg.groups ?? []), g])}
                                          className={`px-2 py-1 text-xs rounded-lg border transition-colors
                                            ${on ? 'bg-blue-600 text-white border-transparent'
                                                 : 'bg-white border-[#DDD9D0] text-slate-600 hover:bg-[#F5F2EC]'}`}>
                                          {g}
                                        </button>
                                      );
                                    })}
                                  </div>

                                  <button onClick={() => drop(i)}
                                    className="ml-auto px-2 py-1 text-xs rounded-lg border border-[#DDD9D0] text-red-500 hover:bg-red-50">
                                    刪除
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              );
            })}
          </div>
        )}
      </SettingsSection>

      {/* ── 開放排班國定假日 ── */}
      {/* ── 快速解鎖密碼 ── */}
      {isAdminUser && (<SettingsSection title="快速解鎖密碼" desc="日翊在班表被鎖定時臨時開啟編輯所需的密碼">
        <p className="text-xs text-slate-500 mb-3">
          課別被鎖定或日期不在開放排班區間時，班表上方會出現「🔓 快速解鎖」按鈕（<strong>僅日翊員工與管理員看得到</strong>）。
          輸入此密碼後可暫時編輯，時間到自動恢復鎖定。
          <br />解鎖只影響操作者當下那台電腦，不會變更任何課別的設定，委外幹部與委外人員也不受影響。
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input type="password" value={unlockInput} onChange={e => setUnlockInput(e.target.value)}
            placeholder={unlockPwd ? '輸入新密碼以變更' : '設定解鎖密碼'}
            className="border border-[#DDD9D0] rounded-lg px-3 py-1.5 text-sm w-52" />
          <button
            onClick={async () => {
              const v = unlockInput.trim();
              if (v.length < 4) { toast('密碼至少 4 個字元', 'error'); return; }
              setUnlockPwd(await hashPwd(v));
              setUnlockInput('');
              toast(unlockPwd ? '解鎖密碼已變更' : '解鎖密碼已設定', 'success');
            }}
            className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
            {unlockPwd ? '變更密碼' : '設定密碼'}
          </button>
          {unlockPwd && (
            <button
              onClick={() => {
                if (!window.confirm('清除後，班表將不再提供快速解鎖功能。確定清除？')) return;
                setUnlockPwd('');
                toast('已清除解鎖密碼', 'warn');
              }}
              className="px-3 py-1.5 border border-[#DDD9D0] rounded-lg text-sm text-slate-500 hover:bg-[#F5F2EC]">
              清除
            </button>
          )}
          <span className={`text-xs font-medium ${unlockPwd ? 'text-teal-700' : 'text-amber-600'}`}>
            {unlockPwd ? '✅ 已設定' : '🔒 尚未設定，班表不會顯示解鎖按鈕'}
          </span>
        </div>
      </SettingsSection>)}

      {/* ── 資料健檢與合併 ── */}
      {isAdminUser && (<SettingsSection title="資料健檢與合併" desc="找出重複的人員記錄，並把舊記錄底下的排休救回現用記錄">
        <p className="text-xs text-slate-500 mb-3">
          早期清冊匯入以未正規化的員編比對，同一個人可能被當成新人重建，舊記錄底下的休／例／國
          會留在資料庫但畫面上看不到。此工具先<strong>只檢查不異動</strong>，確認報告後再執行合併。
          <br />合併只會在現用記錄該格是「V 或空白」時才寫入舊值，<strong>不會覆蓋您現有的排班</strong>，且執行前會自動備份。
        </p>
        <button onClick={openHealthDrawer}
          className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
          開始健檢（於右側面板顯示）
        </button>
      </SettingsSection>)}

      {/* ── 作業區設定 ── */}
      {isAdminUser && (<SettingsSection title="作業區設定" desc="維護可指派給人員的作業區項目">
        <p className="text-xs text-slate-500 mb-3">
          作業區指派到<strong>每一位人員</strong>（於人員清冊設定），可用於上方篩選列快速篩出特定作業區的人。
          <br />未指派者在篩選列以「未設定」歸類。
        </p>
        <div className="flex gap-2 mb-3 flex-wrap">
          <input value={areaInput} onChange={e => setAreaInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addArea(); }}
            placeholder="輸入新作業區名稱"
            className="border border-[#DDD9D0] rounded-lg px-3 py-1.5 text-sm w-48" />
          <button onClick={addArea}
            className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
            ➕ 新增
          </button>
        </div>
        {workAreas.length === 0 ? (
          <p className="text-sm text-slate-400">尚未設定任何作業區</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {workAreas.map(a => {
              const used = employees.filter(e => e.workArea === a).length;
              return (
                <span key={a}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border
                             border-[#DDD9D0] bg-white text-sm text-slate-700">
                  {a}
                  <span className="text-xs text-slate-400">{used} 人</span>
                  <button onClick={() => removeArea(a, used)}
                    title={used > 0 ? `仍有 ${used} 人使用此作業區` : '刪除'}
                    className="text-slate-400 hover:text-red-600 font-bold">×</button>
                </span>
              );
            })}
          </div>
        )}
      </SettingsSection>)}

      {isAdminUser && (<SettingsSection title="開放排班國定假日" desc="勾選後班表中「國」顯示假日短名">
        <p className="text-xs text-slate-500 mb-4">
          依各課別開放排班區間的整體範圍自動篩選國定假日。勾選後班表中「國」將顯示假日短名（如端午、元旦）。
          {!unionRange.start && <span className="text-teal-700 ml-1">（請先於上方設定各課別的開放排班區間）</span>}
        </p>
        {(() => {
          // 解析區間
          const parseLocal = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); };
          const rangeStart = unionRange.start ? parseLocal(unionRange.start) : null;
          const rangeEnd   = unionRange.end   ? parseLocal(unionRange.end)   : null;

          // 篩選區間內的國定假日
          const springCounts = {};
          const holidays = NATIONAL_HOLIDAYS
            .filter(h => {
              if (!rangeStart || !rangeEnd) return false;
              const d = new Date(h.year, h.month - 1, h.day);
              return d >= rangeStart && d <= rangeEnd;
            })
            .map(h => {
              if (h.name === '春節') {
                const k = `${h.year}`;
                springCounts[k] = (springCounts[k] ?? 0);
                const idx = springCounts[k]++;
                return { ...h, shortName: getHolidayShort(h, idx), key: holidayKey(h) };
              }
              return { ...h, shortName: getHolidayShort(h, 0), key: holidayKey(h) };
            });

          if (holidays.length === 0) {
            return <p className="text-sm text-slate-400">區間內無國定假日。</p>;
          }

          const toggle = key => setOpenHolidays(prev =>
            prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
          );
          const allKeys = holidays.map(h => h.key);
          return (
            <div className="space-y-3">
              <div className="flex gap-3 mb-2">
                <button onClick={() => setOpenHolidays(prev => [...new Set([...prev, ...allKeys])])}
                  className="px-3 py-1 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700">全選</button>
                <button onClick={() => setOpenHolidays(prev => prev.filter(k => !allKeys.includes(k)))}
                  className="px-3 py-1 text-xs border border-[#DDD9D0] rounded-lg hover:bg-[#F5F2EC]">全不選</button>
              </div>
              <div className="flex flex-wrap gap-2">
                {holidays.map(h => {
                  const checked = openHolidays.includes(h.key);
                  return (
                    <label key={h.key}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border cursor-pointer text-sm transition-colors
                        ${checked ? 'bg-teal-50 border-blue-400 text-blue-800' : 'bg-white border-slate-200 text-slate-600 hover:bg-[#F5F2EC]'}`}>
                      <input type="checkbox" checked={checked} onChange={() => toggle(h.key)} className="accent-blue-600" />
                      <span className="font-medium">{h.shortName}</span>
                      <span className="text-xs opacity-60">{h.month}/{h.day}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })()}
      </SettingsSection>)}

      {/* ── 委外幹部假日排班權限（國定假日／排休兩項開關）── */}
      {isAdminUser && (<SettingsSection title="委外幹部假日排班權限" desc="控制委外幹部能否自行安排「國」與休假">
        {/* 1. 開放國定假日排班 */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-slate-700">1. 開放國定假日排班</p>
            <p className="text-xs text-slate-500 mt-0.5">
              開啟後，委外幹部可在班表中自行安排「國」定假日；關閉時點擊格子將自動跳過「國」。
            </p>
          </div>
          <button
            onClick={() => {
              setVendorHolidayOpen(v => !v);
              toast(vendorHolidayOpen ? '已關閉：委外幹部無法自行排國定' : '已開啟：委外幹部可排國定假日', 'info');
            }}
            className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none
              ${vendorHolidayOpen ? 'bg-blue-600' : 'bg-slate-300'}`}>
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform
              ${vendorHolidayOpen ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
        <p className={`mt-2 text-xs font-medium ${vendorHolidayOpen ? 'text-teal-700' : 'text-slate-400'}`}>
          {vendorHolidayOpen ? '✅ 目前開放中' : '🔒 目前關閉中（委外幹部不可排國定）'}
        </p>

        {/* 2. 開放委外幹部排休 */}
        <div className="flex items-center justify-between gap-4 mt-5 pt-5 border-t border-[#DDD9D0]">
          <div>
            <p className="text-sm font-semibold text-slate-700">2. 開放委外幹部排休（{REST_QUOTA} 日）</p>
            <p className="text-xs text-slate-500 mt-0.5">
              關閉時，委外幹部與委外人員相同，每週只能排一天休假。
              開啟後，委外幹部改以「本期」為單位，休假（休）＋例休（例）合計最多 {REST_QUOTA} 天，不再受每週一天限制。
            </p>
          </div>
          <button
            onClick={() => {
              setVendorRestOpen(v => !v);
              toast(vendorRestOpen
                ? '已關閉：委外幹部恢復每週限排一天休假'
                : `已開啟：委外幹部本期可排 ${REST_QUOTA} 天休假（含例休）`, 'info');
            }}
            className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none
              ${vendorRestOpen ? 'bg-blue-600' : 'bg-slate-300'}`}>
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform
              ${vendorRestOpen ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
        <p className={`mt-2 text-xs font-medium ${vendorRestOpen ? 'text-teal-700' : 'text-slate-400'}`}>
          {vendorRestOpen
            ? `✅ 目前開放中（本期上限 ${REST_QUOTA} 天，含例休）`
            : '🔒 目前關閉中（委外幹部每週限排一天休假）'}
        </p>

        {/* 3. 開放委外人員排休 */}
        <div className="flex items-center justify-between gap-4 mt-5 pt-5 border-t border-[#DDD9D0]">
          <div>
            <p className="text-sm font-semibold text-slate-700">3. 開放委外人員排休（{REST_QUOTA} 日）</p>
            <p className="text-xs text-slate-500 mt-0.5">
              關閉時，委外人員每週只能排一天休假。
              開啟後，委外人員改以「本期」為單位，休假（休）＋例休（例）合計最多 {REST_QUOTA} 天，不再受每週一天限制。
            </p>
          </div>
          <button
            onClick={() => {
              setWorkerRestOpen(v => !v);
              toast(workerRestOpen
                ? '已關閉：委外人員恢復每週限排一天休假'
                : `已開啟：委外人員本期可排 ${REST_QUOTA} 天休假（含例休）`, 'info');
            }}
            className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none
              ${workerRestOpen ? 'bg-blue-600' : 'bg-slate-300'}`}>
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform
              ${workerRestOpen ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
        <p className={`mt-2 text-xs font-medium ${workerRestOpen ? 'text-teal-700' : 'text-slate-400'}`}>
          {workerRestOpen
            ? `✅ 目前開放中（本期上限 ${REST_QUOTA} 天，含例休）`
            : '🔒 目前關閉中（委外人員每週限排一天休假）'}
        </p>
        <p className="mt-3 text-xs text-slate-400">
          ※ 第 2、3 項為各自獨立的開關，可只開放其中一種身分。「例」仍僅由日翊排定，
          但日翊排的例休會佔用該員本期 {REST_QUOTA} 天的額度。
        </p>
      </SettingsSection>)}

      {/* ── 廠商別維護 ── */}
      {isAdminUser && (<SettingsSection title="廠商別維護" desc="管理系統中所有委外廠商">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs text-slate-400">管理系統中所有委外廠商，新增後即可在帳號管理與倉別設定中使用。</p>
          <button onClick={openAddVd}
            className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
            ➕ 新增廠商
          </button>
        </div>

        <div className="border border-[#DDD9D0] rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#F5F2EC]">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium text-slate-600 w-24">代碼</th>
                <th className="px-4 py-2.5 text-left font-medium text-slate-600">廠商名稱</th>
                <th className="px-4 py-2.5 text-right font-medium text-slate-600 w-28">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {vendors.length === 0 && (
                <tr><td colSpan={3} className="text-center py-6 text-slate-400 text-sm">尚未設定任何廠商</td></tr>
              )}
              {vendors.map(vd => (
                <tr key={vd.id} className="hover:bg-[#F5F2EC]">
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                      {vd.code || '—'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-medium text-slate-800">{vd.name}</td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => openEditVd(vd)}
                        className="px-2.5 py-1 text-xs border border-[#DDD9D0] rounded-lg hover:bg-[#F5F2EC] text-slate-600">
                        編輯
                      </button>
                      <button onClick={() => deleteVd(vd.id)}
                        className="px-2.5 py-1 text-xs border border-red-200 rounded-lg hover:bg-red-50 text-red-600">
                        刪除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SettingsSection>)}

      {/* ── 倉別 × 課別 × 廠商別維護 ── */}
      <SettingsSection title="倉別 × 課別 × 廠商別維護"
        desc={isAdminUser ? '每個倉可設定多個課別與所屬廠商' : '可設定所屬倉別的課別與廠商配置'}>
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs text-slate-400">
            每個倉可設定多個課別，每個課別再配置所屬廠商。
            {!isAdminUser && '（僅顯示您負責的倉別；倉別本身的新增／編輯／刪除限管理員）'}
          </p>
          {/* 倉別的新增／編輯／刪除影響全系統，一律限管理員 */}
          {isAdminUser && (
            <button onClick={openAddWh}
              disabled={vendors.length === 0}
              title={vendors.length === 0 ? '請先在「廠商別維護」新增廠商' : undefined}
              className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">
              ➕ 新增倉別
            </button>
          )}
        </div>
        {vendors.length === 0 && (
          <div className="mb-4 flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5">
            <span>⚠️</span> 請先在上方「廠商別維護」新增廠商，再設定倉別與課別的廠商配置。
          </div>
        )}

        {lockableWarehouses.length === 0 && (
          <p className="text-sm text-slate-400 text-center py-6">
            {warehouses.length === 0 ? '尚未設定任何倉別' : '您尚未被指派可管理的倉別'}
          </p>
        )}

        <div className="space-y-4">
          {lockableWarehouses.map(wh => (
            <div key={wh.id} className="border border-[#DDD9D0] rounded-xl overflow-hidden">
              {/* 倉別 header */}
              <div className="flex items-center justify-between bg-[#F5F2EC] px-4 py-2.5 border-b border-[#DDD9D0]">
                <span className="font-bold text-slate-800">🏭 {wh.name}</span>
                <div className="flex gap-2">
                  <button onClick={() => openAddDept(wh.id)}
                    className="px-2.5 py-1 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700">
                    ＋ 新增課別
                  </button>
                  {isAdminUser && <>
                    <button onClick={() => openEditWh(wh)}
                      className="px-2.5 py-1 text-xs border border-[#DDD9D0] rounded-lg hover:bg-white text-slate-600">
                      編輯
                    </button>
                    <button onClick={() => deleteWh(wh.id)}
                      className="px-2.5 py-1 text-xs border border-red-200 rounded-lg hover:bg-red-50 text-red-600">
                      刪除
                    </button>
                  </>}
                </div>
              </div>

              {/* 課別列表 */}
              {(wh.departments ?? []).length === 0 ? (
                <p className="text-xs text-slate-400 italic px-4 py-3">尚未設定課別，點「新增課別」開始</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {(wh.departments ?? []).map(dept => (
                    <div key={dept.id} className="flex items-start gap-3 px-4 py-3 hover:bg-[#F5F2EC]">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5">
                          {dept.code && (
                            <span className="font-mono text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                              {dept.code}
                            </span>
                          )}
                          <span className="font-medium text-slate-800 text-sm">{dept.name}</span>
                        </div>
                        <div className="flex flex-wrap gap-1 mb-1">
                          <span className="text-xs text-slate-400 mr-1">廠商：</span>
                          {(dept.vendors ?? []).length === 0
                            ? <span className="text-xs text-slate-400 italic">尚未配置</span>
                            : (dept.vendors ?? []).map(v => (
                                <span key={v}
                                  className="px-2 py-0.5 bg-teal-50 text-blue-700 border border-teal-200
                                             rounded-full text-xs">
                                  {v}
                                </span>
                              ))
                          }
                        </div>
                        <div className="flex flex-wrap gap-1">
                          <span className="text-xs text-slate-400 mr-1">組別：</span>
                          {(dept.groups ?? []).length === 0
                            ? <span className="text-xs text-slate-400 italic">尚未配置</span>
                            : (dept.groups ?? []).map(g => (
                                <span key={g}
                                  className="px-2 py-0.5 bg-green-50 text-green-700 border border-green-200
                                             rounded-full text-xs">
                                  {g}
                                </span>
                              ))
                          }
                        </div>
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        <button onClick={() => openEditDept(wh.id, dept)}
                          className="px-2.5 py-1 text-xs border border-[#DDD9D0] rounded-lg hover:bg-white text-slate-600">
                          編輯
                        </button>
                        <button onClick={() => deleteDept(wh.id, dept.id)}
                          className="px-2.5 py-1 text-xs border border-red-200 rounded-lg hover:bg-red-50 text-red-600">
                          刪除
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </SettingsSection>

      {/* ── 廠商公司抬頭維護 ── */}
      {(() => {
        const allVendors = [...new Set([
          ...Object.keys(VENDOR_COMPANY_NAMES),
          ...vendors.map(v => v.name),
        ])].filter(Boolean).sort();

        const saveCompanyName = (vendorName, newTitle) => {
          const updated = { ...vendorCompanyNames, [vendorName]: newTitle };
          setVendorCompanyNames(updated);
          LS.set('sms_vendor_company_names', updated);
          toast('已儲存：' + vendorName, 'success');
        };

        if (!isAdminUser) return null;
        return (
          <SettingsSection title="廠商公司抬頭維護" desc="報表標題列顯示的廠商全名">
            <p className="text-xs text-slate-400 mb-3">設定匯出 Excel / PDF 報表標題列顯示的廠商全名。</p>
            {allVendors.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-4">尚未有廠商資料</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {allVendors.map(vName => (
                  <VendorCompanyRow
                    key={vName}
                    vendorName={vName}
                    companyTitle={vendorCompanyNames[vName] ?? ''}
                    onSave={saveCompanyName}
                  />
                ))}
              </div>
            )}
          </SettingsSection>
        );
      })()}

      {/* ── 廠商別新增/編輯 Modal ── */}
      {vdModal && (
        <Modal onClose={() => setVdModal(false)}>
          <div className="bg-white rounded-xl shadow w-full max-w-sm p-6">
            <h3 className="font-bold text-lg text-slate-800 mb-4">
              {vdTarget ? '編輯廠商' : '新增廠商'}
            </h3>
            <div className="mb-3">
              <label className="block text-sm font-medium text-slate-700 mb-1">
                廠商代碼 <span className="text-slate-400 font-normal text-xs">（選填，如 CS、SY）</span>
              </label>
              <input value={vdForm.code}
                onChange={e => setVdForm(p => ({ ...p, code: e.target.value }))}
                placeholder="例如：CS"
                maxLength={6}
                className="w-full border border-[#DDD9D0] rounded-lg px-3 py-1.5 text-sm uppercase" />
            </div>
            <div className="mb-3">
              <label className="block text-sm font-medium text-slate-700 mb-1">
                廠商名稱 <span className="text-red-400">*</span>
              </label>
              <input value={vdForm.name}
                onChange={e => setVdForm(p => ({ ...p, name: e.target.value }))}
                placeholder="例如：承杺"
                className="w-full border border-[#DDD9D0] rounded-lg px-3 py-1.5 text-sm" />
            </div>
            <div className="mb-5">
              <label className="block text-sm font-medium text-slate-700 mb-1">
                公司抬頭 <span className="text-slate-400 font-normal text-xs">（Excel／報表顯示的全名）</span>
              </label>
              <input value={vdForm.companyHeader ?? ''}
                onChange={e => setVdForm(p => ({ ...p, companyHeader: e.target.value }))}
                placeholder="例如：承杺人力資源有限公司"
                className="w-full border border-[#DDD9D0] rounded-lg px-3 py-1.5 text-sm" />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setVdModal(false)}
                className="px-4 py-2 border border-[#DDD9D0] rounded-lg text-sm hover:bg-[#F5F2EC]">
                取消
              </button>
              <button onClick={saveVd}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
                儲存
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── 倉別 新增/編輯 Modal ── */}
      {whModal && (
        <Modal onClose={() => setWhModal(false)}>
          <div className="bg-white rounded-xl shadow w-full max-w-sm p-6">
            <h3 className="font-bold text-lg text-slate-800 mb-4">
              {whTarget ? '編輯倉別' : '新增倉別'}
            </h3>
            <div className="mb-5">
              <label className="block text-sm font-medium text-slate-700 mb-1">
                倉別名稱 <span className="text-red-400">*</span>
              </label>
              <input value={whForm.name}
                onChange={e => setWhForm(p => ({ ...p, name: e.target.value }))}
                placeholder="例如：大溪倉"
                className="w-full border border-[#DDD9D0] rounded-lg px-3 py-1.5 text-sm" />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setWhModal(false)}
                className="px-4 py-2 border border-[#DDD9D0] rounded-lg text-sm hover:bg-[#F5F2EC]">
                取消
              </button>
              <button onClick={saveWh}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
                儲存
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── 課別 新增/編輯 Modal ── */}
      {deptModal && (
        <Modal onClose={() => setDeptModal(false)}>
          <div className="bg-white rounded-xl shadow w-full max-w-md p-6">
            <h3 className="font-bold text-lg text-slate-800 mb-1">
              {deptTarget ? '編輯課別' : '新增課別'}
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              倉別：{warehouses.find(w => w.id === deptWhId)?.name}
            </p>

            <div className="mb-3">
              <label className="block text-sm font-medium text-slate-700 mb-1">
                課別代碼 <span className="text-slate-400 font-normal text-xs">（選填，如 L035）</span>
              </label>
              <input value={deptForm.code}
                onChange={e => setDeptForm(p => ({ ...p, code: e.target.value }))}
                placeholder="例如：L035"
                className="w-full border border-[#DDD9D0] rounded-lg px-3 py-1.5 text-sm" />
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-1">
                課別名稱 <span className="text-red-400">*</span>
              </label>
              <input value={deptForm.name}
                onChange={e => setDeptForm(p => ({ ...p, name: e.target.value }))}
                placeholder="例如：大肚理貨課"
                className="w-full border border-[#DDD9D0] rounded-lg px-3 py-1.5 text-sm" />
            </div>

            <div className="mb-5">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                配置廠商
                <span className="ml-2 text-xs text-slate-400 font-normal">
                  （已選 {deptForm.vendors.length} 家）
                </span>
              </label>
              {vendorNames.length === 0
                ? <p className="text-xs text-slate-400 italic">請先至「廠商別維護」新增廠商</p>
                : (
                  <div className="grid grid-cols-2 gap-2 max-h-36 overflow-y-auto">
                    {vendorNames.map(v => {
                      const checked = deptForm.vendors.includes(v);
                      return (
                        <label key={v}
                          className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer
                                      transition-colors text-sm
                                      ${checked
                                        ? 'bg-teal-50 border-blue-400 text-blue-800'
                                        : 'bg-white border-slate-200 text-slate-600 hover:bg-[#F5F2EC]'}`}>
                          <input type="checkbox" checked={checked} onChange={() => toggleDeptVendor(v)}
                            className="rounded accent-blue-600" />
                          {v}
                        </label>
                      );
                    })}
                  </div>
                )
              }
            </div>

            {/* 組別管理 */}
            <div className="mb-5">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                組別設定
                <span className="ml-2 text-xs text-slate-400 font-normal">
                  （共 {(deptForm.groups ?? []).length} 組）
                </span>
              </label>
              {/* 已加入的組別 */}
              <div className="flex flex-wrap gap-1.5 mb-2 min-h-[28px]">
                {(deptForm.groups ?? []).length === 0
                  ? <span className="text-xs text-slate-400 italic">尚未設定組別</span>
                  : (deptForm.groups ?? []).map(g => (
                      <span key={g}
                        className="flex items-center gap-1 px-2 py-0.5 bg-green-50 text-green-800
                                   border border-green-300 rounded-full text-xs">
                        {g}
                        <button
                          onClick={() => setDeptForm(p => ({ ...p, groups: p.groups.filter(x => x !== g) }))}
                          className="hover:text-red-500 font-bold leading-none">×</button>
                      </span>
                    ))
                }
              </div>
              {/* 新增組別輸入 */}
              <div className="flex gap-2">
                <input
                  value={groupInput}
                  onChange={e => setGroupInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const g = groupInput.trim();
                      if (g && !(deptForm.groups ?? []).includes(g))
                        setDeptForm(p => ({ ...p, groups: [...(p.groups ?? []), g] }));
                      setGroupInput('');
                    }
                  }}
                  placeholder="輸入組別名稱（如 A組），按 Enter 新增"
                  className="flex-1 border border-[#DDD9D0] rounded-lg px-3 py-1.5 text-sm" />
                <button
                  type="button"
                  onClick={() => {
                    const g = groupInput.trim();
                    if (g && !(deptForm.groups ?? []).includes(g))
                      setDeptForm(p => ({ ...p, groups: [...(p.groups ?? []), g] }));
                    setGroupInput('');
                  }}
                  className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700">
                  新增
                </button>
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeptModal(false)}
                className="px-4 py-2 border border-[#DDD9D0] rounded-lg text-sm hover:bg-[#F5F2EC]">
                取消
              </button>
              <button onClick={saveDept}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
                儲存
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// SHIFT CODE REFERENCE TABLE
// ─────────────────────────────────────────────

const SHIFT_CODE_HEADERS = ["上班代號","休假代號","元旦","除夕","初ㄧ","初二","初三","228紀念日","兒童節","清明節","勞動節","端午","中秋","雙十","小年夜","教師節","光復節","行憲紀念日"];

const SHIFT_CODE_ROWS = [
  ["00:30","Z0A","A0H","Y0H","X0H","W0H","V0H","U0H","T0H","S0H","R0H","Q0H","P0H","M0H","L0H","K0H","J0H","I0H","H0H"],
  ["01:00","ZA1","AH1","YH1","XH1","WH1","VH1","UH1","TH1","SH1","RH1","QH1","PH1","MH1","LH1","KH1","JH1","IH1","HH1"],
  ["01:30","Z1A","A1H","Y1H","X1H","W1H","V1H","U1H","T1H","S1H","R1H","Q1H","P1H","M1H","L1H","K1H","J1H","I1H","H1H"],
  ["02:00","ZA2","AH2","YH2","XH2","WH2","VH2","UH2","TH2","SH2","RH2","QH2","PH2","MH2","LH2","KH2","JH2","IH2","HH2"],
  ["02:30","Z2A","A2H","Y2H","X2H","W2H","V2H","U2H","T2H","S2H","R2H","Q2H","P2H","M2H","L2H","K2H","J2H","I2H","H2H"],
  ["03:00","ZA3","AH3","YH3","XH3","WH3","VH3","UH3","TH3","SH3","RH3","QH3","PH3","MH3","LH3","KH3","JH3","IH3","HH3"],
  ["03:30","Z3A","A3H","Y3H","X3H","W3H","V3H","U3H","T3H","S3H","R3H","Q3H","P3H","M3H","L3H","K3H","J3H","I3H","H3H"],
  ["04:00","ZA4","AH4","YH4","XH4","WH4","VH4","UH4","TH4","SH4","RH4","QH4","PH4","MH4","LH4","KH4","JH4","IH4","HH4"],
  ["04:30","Z4A","A4H","Y4H","X4H","W4H","V4H","U4H","T4H","S4H","R4H","Q4H","P4H","M4H","L4H","K4H","J4H","I4H","H4H"],
  ["05:00","ZA5","AH5","YH5","XH5","WH5","VH5","UH5","TH5","SH5","RH5","QH5","PH5","MH5","LH5","KH5","JH5","IH5","HH5"],
  ["05:30","Z5A","A5H","Y5H","X5H","W5H","V5H","U5H","T5H","S5H","R5H","Q5H","P5H","M5H","L5H","K5H","J5H","I5H","H5H"],
  ["06:00","ZA6","AH6","YH6","XH6","WH6","VH6","UH6","TH6","SH6","RH6","QH6","PH6","MH6","LH6","KH6","JH6","IH6","HH6"],
  ["06:30","Z6A","A6H","Y6H","X6H","W6H","V6H","U6H","T6H","S6H","R6H","Q6H","P6H","M6H","L6H","K6H","J6H","I6H","H6H"],
  ["07:00","ZA7","AH7","YH7","XH7","WH7","VH7","UH7","TH7","SH7","RH7","QH7","PH7","MH7","LH7","KH7","JH7","IH7","HH7"],
  ["07:30","Z7A","A7H","Y7H","X7H","W7H","V7H","U7H","T7H","S7H","R7H","Q7H","P7H","M7H","L7H","K7H","J7H","I7H","H7H"],
  ["08:00","ZA8","AH8","YH8","XH8","WH8","VH8","UH8","TH8","SH8","RH8","QH8","PH8","MH8","LH8","KH8","JH8","IH8","HH8"],
  ["08:30","Z8A","A8H","Y8H","X8H","W8H","V8H","U8H","T8H","S8H","R8H","Q8H","P8H","M8H","L8H","K8H","J8H","I8H","H8H"],
  ["09:00","ZA9","AH9","YH9","XH9","WH9","VH9","UH9","TH9","SH9","RH9","QH9","PH9","MH9","LH9","KH9","JH9","IH9","HH9"],
  ["09:30","Z9A","A9H","Y9H","X9H","W9H","V9H","U9H","T9H","S9H","R9H","Q9H","P9H","M9H","L9H","K9H","J9H","I9H","H9H"],
  ["10:00","ZAX","AHX","YHX","XHX","WHX","VHX","UHX","THX","SHX","RHX","QHX","PHX","MHX","LHX","KHX","JHX","IHX","HHX"],
  ["10:30","ZXA","AXH","YXH","XXH","WXH","VXH","UXH","TXH","SXH","RXH","QXH","PXH","MXH","LXH","KXH","JXH","IXH","HXH"],
  ["11:00","ZAE","AHE","YHE","XHE","WHE","VHE","UHE","THE","SHE","RHE","QHE","PHE","MHE","LHE","KHE","JHE","IHE","HHE"],
  ["11:30","ZEA","AEH","YEH","XEH","WEH","VEH","UEH","TEH","SEH","REH","QEH","PEH","MEH","LEH","KEH","JEH","IEH","HEH"],
  ["12:00","ZPT","AHT","YHT","XHT","WHT","VHT","UHT","THT","SHT","RHT","QHT","PHT","MHT","LHT","KHT","JHT","IHT","HHT"],
  ["12:30","ZTP","ATD","YTD","XTD","WTD","VTD","UTD","TTD","STD","RTD","QTD","PTD","MTD","LTD","KTD","JTD","ITD","HTD"],
  ["13:00","ZP1","AD1","YD1","XD1","WD1","VD1","UD1","TD1","SD1","RD1","QD1","PD1","MD1","LD1","KD1","JD1","ID1","HD1"],
  ["13:30","Z1P","A1D","Y1D","X1D","W1D","V1D","U1D","T1D","S1D","R1D","Q1D","P1D","M1D","L1D","K1D","J1D","I1D","H1D"],
  ["14:00","ZP2","AD2","YD2","XD2","WD2","VD2","UD2","TD2","SD2","RD2","QD2","PD2","MD2","LD2","KD2","JD2","ID2","HD2"],
  ["14:30","Z2P","A2D","Y2D","X2D","W2D","V2D","U2D","T2D","S2D","R2D","Q2D","P2D","M2D","L2D","K2D","J2D","I2D","H2D"],
  ["15:00","ZP3","AD3","YD3","XD3","WD3","VD3","UD3","TD3","SD3","RD3","QD3","PD3","MD3","LD3","KD3","JD3","ID3","HD3"],
  ["15:30","Z3P","A3D","Y3D","X3D","W3D","V3D","U3D","T3D","S3D","R3D","Q3D","P3D","M3D","L3D","K3D","J3D","I3D","H3D"],
  ["16:00","ZP4","AD4","YD4","XD4","WD4","VD4","UD4","TD4","SD4","RD4","QD4","PD4","MD4","LD4","KD4","JD4","ID4","HD4"],
  ["16:30","Z4P","A4D","Y4D","X4D","W4D","V4D","U4D","T4D","S4D","R4D","Q4D","P4D","M4D","L4D","K4D","J4D","I4D","H4D"],
  ["17:00","ZP5","AD5","YD5","XD5","WD5","VD5","UD5","TD5","SD5","RD5","QD5","PD5","MD5","LD5","KD5","JD5","ID5","HD5"],
  ["17:30","Z5P","A5D","Y5D","X5D","W5D","V5D","U5D","T5D","S5D","R5D","Q5D","P5D","M5D","L5D","K5D","J5D","I5D","H5D"],
  ["18:00","ZP6","AD6","YD6","XD6","WD6","VD6","UD6","TD6","SD6","RD6","QD6","PD6","MD6","LD6","KD6","JD6","ID6","HD6"],
  ["18:30","Z6P","A6D","Y6D","X6D","W6D","V6D","U6D","T6D","S6D","R6D","Q6D","P6D","M6D","L6D","K6D","J6D","I6D","H6D"],
  ["19:00","ZP7","AD7","YD7","XD7","WD7","VD7","UD7","TD7","SD7","RD7","QD7","PD7","MD7","LD7","KD7","JD7","ID7","HD7"],
  ["19:30","Z7P","A7D","Y7D","X7D","W7D","V7D","U7D","T7D","S7D","R7D","Q7D","P7D","M7D","L7D","K7D","J7D","I7D","H7D"],
  ["20:00","ZP8","AD8","YD8","XD8","WD8","VD8","UD8","TD8","SD8","RD8","QD8","PD8","MD8","LD8","KD8","JD8","ID8","HD8"],
  ["20:30","Z8P","A8D","Y8D","X8D","W8D","V8D","U8D","T8D","S8D","R8D","Q8D","P8D","M8D","L8D","K8D","J8D","I8D","H8D"],
  ["21:00","ZP9","AD9","YD9","XD9","WD9","VD9","UD9","TD9","SD9","RD9","QD9","PD9","MD9","LD9","KD9","JD9","ID9","HD9"],
  ["21:30","Z9P","A9D","Y9D","X9D","W9D","V9D","U9D","T9D","S9D","R9D","Q9D","P9D","M9D","L9D","K9D","J9D","I9D","H9D"],
  ["22:00","ZPX","ADX","YDX","XDX","WDX","VDX","UDX","TDX","SDX","RDX","QDX","PDX","MDX","LDX","KDX","JDX","IDX","HDX"],
  ["22:30","ZXP","AXD","YXD","XXD","WXD","VXD","UXD","TXD","SXD","RXD","QXD","PXD","MXD","LXD","KXD","JXD","IXD","HXD"],
  ["23:00","ZPE","ADE","YDE","XDE","WDE","VDE","UDE","TDE","SDE","RDE","QDE","PDE","MDE","LDE","KDE","JDE","IDE","HDE"],
  ["23:30","ZEP","AED","YED","XED","WED","VED","UED","TED","SED","RED","QED","PED","MED","LED","KED","JED","IED","HED"],
];

// 欄標題分組上色（前2欄為代號，其餘為假日）
const HOLIDAY_COL_COLOR = 'bg-orange-50 text-orange-800';
const CODE_COL_WORK_COLOR = 'bg-green-50 text-green-800';
const CODE_COL_LEAVE_COLOR = 'bg-yellow-50 text-yellow-800';

// ─────────────────────────────────────────────
// SHIFT SETUP (人員班別設定)
// ─────────────────────────────────────────────

const SHIFT_TYPE_DEFAULTS = [
  { id: 'st1', name: '日班', startTime: '0800', endTime: '1700', color: 'bg-blue-100 text-blue-800' },
  { id: 'st2', name: '晚班', startTime: '1900', endTime: '0300', color: 'bg-purple-100 text-purple-800' },
  { id: 'st3', name: '夜班', startTime: '2300', endTime: '0700', color: 'bg-slate-100 text-slate-800' },
];

const PRESET_TIMES = Array.from({length: 48}, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, '0');
  const m = i % 2 === 0 ? '00' : '30';
  return h + m;
});

function ShiftSetup() {
  const { employees, setEmployees, vendors, warehouses, selectedWarehouse, selectedDept, selectedGroup, selectedWorkArea, currentUser,
          shiftTypesByWh, setShiftTypesByWh } = useApp();
  const toast = useToast();

  const whKey = selectedWarehouse ?? 'default';
  const shiftTypes = shiftTypesByWh[whKey] ?? SHIFT_TYPE_DEFAULTS;
  const setShiftTypes = (types) => {
    setShiftTypesByWh(prev => ({ ...prev, [whKey]: types }));
  };

  const [showTypeModal, setShowTypeModal] = useState(false);
  const emptyType = { id: '', name: '', startTime: '0900', endTime: '1800', color: 'bg-blue-100 text-blue-800' };
  const [typeForm, setTypeForm] = useState(emptyType);
  const [editTypeId, setEditTypeId] = useState(null);

  const colorOptions = [
    { label: '藍',   value: 'bg-blue-100 text-blue-800' },
    { label: '綠',   value: 'bg-green-100 text-green-800' },
    { label: '紫',   value: 'bg-purple-100 text-purple-800' },
    { label: '橘',   value: 'bg-orange-100 text-orange-800' },
    { label: '紅',   value: 'bg-red-100 text-red-800' },
    { label: '黃',   value: 'bg-yellow-100 text-yellow-800' },
    { label: '灰',   value: 'bg-slate-100 text-slate-800' },
    { label: '青',   value: 'bg-teal-100 text-teal-800' },
  ];

  const openAddType  = () => { setTypeForm(emptyType); setEditTypeId(null); setShowTypeModal(true); };
  const openEditType = t  => { setTypeForm({ ...t }); setEditTypeId(t.id); setShowTypeModal(true); };

  const saveType = () => {
    if (!typeForm.name || !typeForm.startTime || !typeForm.endTime) {
      toast('班別名稱與時間為必填', 'error'); return;
    }
    const newTypes = editTypeId
      ? shiftTypes.map(t => t.id === editTypeId ? { ...typeForm, id: editTypeId } : t)
      : [...shiftTypes, { ...typeForm, id: 'st' + Date.now() }];
    setShiftTypes(newTypes);
    toast(editTypeId ? '班別已更新' : '班別已新增', 'success');
    setShowTypeModal(false);
  };

  const deleteType = id => {
    const newTypes = shiftTypes.filter(t => t.id !== id);
    setShiftTypes(newTypes);
    setEmployees(p => p.map(e => e.shiftTypeId === id ? { ...e, shiftTypeId: '' } : e));
    toast('班別已刪除', 'info');
  };

  // 人員班別指派
  const assignShift = (empId, shiftTypeId) => {
    setEmployees(p => p.map(e => e.id === empId ? { ...e, shiftTypeId } : e));
  };

  // 清冊匯入
  const fileRef = useRef(null);
  const handleImport = e => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast('檔案過大，上限 10 MB', 'error'); e.target.value = ''; return; }
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const wb = XLSX.read(ev.target.result, { type: 'array', cellFormula: false, cellHTML: false });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        if (rows.length < 2) { toast('檔案無資料', 'error'); return; }
        if (rows.length > 12000) { toast('資料筆數超過上限（12,000 列）', 'error'); return; }

        // 判斷第一列是否為標頭（含中文字）
        const firstRow = rows[0].map(c => String(c).trim());
        const hasHeader = firstRow.some(c => /[一-鿿]/.test(c));
        const dataRows = hasHeader ? rows.slice(1) : rows;

        let added = 0, updated = 0;
        const newEmps = [...employees];
        const newTypes = [...shiftTypes];

        dataRows.forEach(row => {
          const empId    = String(row[0] ?? '').trim();
          const name     = String(row[1] ?? '').trim();
          const startRaw = String(row[2] ?? '').trim().replace(':', '').padStart(4, '0');
          const endRaw   = String(row[3] ?? '').trim().replace(':', '').padStart(4, '0');

          if (!empId) return;

          // 依上下班時間找或建立班別
          let shiftTypeId = '';
          if (startRaw.length === 4 && endRaw.length === 4) {
            let st = newTypes.find(t => t.startTime === startRaw && t.endTime === endRaw);
            if (!st) {
              st = { id: 'st' + Date.now() + Math.random(), name: `${startRaw.slice(0,2)}:${startRaw.slice(2)}~${endRaw.slice(0,2)}:${endRaw.slice(2)}`, startTime: startRaw, endTime: endRaw, color: 'bg-blue-100 text-blue-800' };
              newTypes.push(st);
            }
            shiftTypeId = st.id;
          }

          const idx = newEmps.findIndex(e => e.empId === empId);
          if (idx !== -1) {
            newEmps[idx] = { ...newEmps[idx], shiftTypeId };
            updated++;
          } else if (name) {
            newEmps.push({ id: 'e' + Date.now() + Math.random(), empId, name, vendor: '', dept: '', group: '', status: '在職', shiftTypeId });
            added++;
          }
        });

        setShiftTypes(newTypes);
        saveTypes(newTypes, selectedWarehouse);
        setEmployees(newEmps);
        toast(`匯入完成：新增 ${added} 筆，更新班別 ${updated} 筆`, 'success');
      } catch (err) {
        toast('匯入失敗：' + err.message, 'error');
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const shiftCategoryOrder = (name = '') => {
    if (name.includes('日')) return 0;
    if (name.includes('中')) return 1;
    if (name.includes('夜') || name.includes('晚')) return 2;
    return 3;
  };
  const sortedShiftTypes = [...shiftTypes].sort((a, b) => {
    const ca = shiftCategoryOrder(a.name), cb = shiftCategoryOrder(b.name);
    if (ca !== cb) return ca - cb;
    return parseInt(a.startTime, 10) - parseInt(b.startTime, 10);
  });

  const vendorNames = vendors.map(v => v.name);
  const [filterVendor, setFilterVendor] = useState('');
  const [filterShift,  setFilterShift]  = useState('');
  const [nameSearchSetup, setNameSearchSetup] = useState('');
  // 表頭排序：col 為 null 時使用預設排序（未指派在最上方）
  const [setupSort, setSetupSort] = useState({ col: null, dir: 1 });
  const toggleSetupSort = (col) => setSetupSort(prev =>
    prev.col !== col ? { col, dir: 1 }
    : prev.dir === 1 ? { col, dir: -1 }
    : { col: null, dir: 1 });

  // 拖曳排序
  const dragSrcIdx = useRef(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const onDragStart = (e, idx) => { dragSrcIdx.current = idx; e.dataTransfer.effectAllowed = 'move'; };
  const onDragOver  = (e, idx) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverIdx(idx); };
  const onDrop      = (e, idx) => {
    e.preventDefault();
    const src = dragSrcIdx.current;
    if (src == null || src === idx) { setDragOverIdx(null); return; }
    const reordered = [...shiftTypes];
    const [moved] = reordered.splice(src, 1);
    reordered.splice(idx, 0, moved);
    setShiftTypes(reordered);
    saveTypes(reordered, selectedWarehouse);
    dragSrcIdx.current = null;
    setDragOverIdx(null);
  };
  const onDragEnd = () => { dragSrcIdx.current = null; setDragOverIdx(null); };

  const visibleEmps = (() => {
    let list = currentUser?.role === ROLES.VENDOR
      ? employees.filter(e => currentUser.vendors.includes(e.vendor))
      : employees.filter(e => e.vendor && e.vendor.trim() !== '');
    list = filterByScope(list, warehouses, selectedWarehouse, selectedDept, selectedGroup, selectedWorkArea);
    const filtered = list.filter(e => {
      if (filterVendor && e.vendor !== filterVendor) return false;
      if (filterShift  && e.shiftTypeId !== filterShift) return false;
      if (nameSearchSetup.trim()) {
        const q = nameSearchSetup.trim().toLowerCase();
        if (!(e.name ?? '').toLowerCase().includes(q) && !(e.empId ?? '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
    // 未指派排最上方（shiftTypeId 空值或找不到對應班別皆視為未指派）
    const isAssigned = e => !!e.shiftTypeId && shiftTypes.some(t => t.id === e.shiftTypeId);
    const byDefault = [
      ...filtered.filter(e => !isAssigned(e)),
      ...filtered.filter(e =>  isAssigned(e)),
    ];
    if (!setupSort.col) return byDefault;
    // 點表頭排序時，以該欄為主鍵；同值者沿用預設順序（未指派在前）
    const order = new Map(byDefault.map((e, i) => [e.id, i]));
    const startOf = e => {
      const st = findShiftType(shiftTypesByWh, whKey, e.shiftTypeId);
      const n = Number(st?.startTime);
      return Number.isFinite(n) ? n : 9999;
    };
    const endOf = e => {
      const st = findShiftType(shiftTypesByWh, whKey, e.shiftTypeId);
      const n = Number(st?.endTime);
      return Number.isFinite(n) ? n : 9999;
    };
    const cmp = {
      empId:  (a, b) => (a.empId ?? '').localeCompare(b.empId ?? '', 'zh-Hant'),
      name:   (a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'zh-Hant'),
      vendor: (a, b) => vendorRank(a.vendor) - vendorRank(b.vendor) ||
                        (a.vendor ?? '').localeCompare(b.vendor ?? '', 'zh-Hant'),
      shift:  (a, b) => startOf(a) - startOf(b),
      end:    (a, b) => endOf(a) - endOf(b),
    }[setupSort.col];
    return [...byDefault].sort((a, b) =>
      (cmp(a, b) * setupSort.dir) || (order.get(a.id) - order.get(b.id)));
  })();

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-xl font-bold text-slate-800">人員班別設定</h2>

      {/* ── 班別時段管理 ── */}
      <div className="bg-white border border-[#DDD9D0] rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="font-semibold text-slate-700">班別時段管理</h3>
            {selectedWarehouse
              ? <p className="text-xs text-teal-700 mt-0.5">目前倉別：{warehouses.find(w => w.id === selectedWarehouse)?.name ?? selectedWarehouse}</p>
              : <p className="text-xs text-amber-500 mt-0.5">請先從頂欄選擇倉別，各倉可獨立設定班別時段</p>
            }
          </div>
          <button onClick={openAddType}
            className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
            ➕ 新增班別
          </button>
        </div>
        <div className="flex flex-wrap gap-3">
          {shiftTypes.map((t, idx) => (
            <div key={t.id}
              draggable
              onDragStart={e => onDragStart(e, idx)}
              onDragOver={e => onDragOver(e, idx)}
              onDrop={e => onDrop(e, idx)}
              onDragEnd={onDragEnd}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${t.color} border-opacity-40 cursor-grab active:cursor-grabbing select-none transition-opacity
                ${dragOverIdx === idx && dragSrcIdx.current !== idx ? 'ring-2 ring-blue-400 opacity-80' : ''}
                ${dragSrcIdx.current === idx ? 'opacity-40' : ''}`}>
              <span className="text-slate-400 text-xs mr-0.5">⠿</span>
              <span className="font-semibold text-sm">{t.name}</span>
              <span className="text-xs opacity-70">{t.startTime.slice(0,2)}:{t.startTime.slice(2)} ~ {t.endTime.slice(0,2)}:{t.endTime.slice(2)}</span>
              <button onClick={() => openEditType(t)} className="text-xs opacity-60 hover:opacity-100 ml-1">✏️</button>
              <button onClick={() => deleteType(t.id)} className="text-xs opacity-60 hover:opacity-100 text-red-500">✕</button>
            </div>
          ))}
          {shiftTypes.length === 0 && <p className="text-sm text-slate-400">尚未設定任何班別</p>}
        </div>
      </div>

      {/* ── 班別匯入 ── */}
      <div className="bg-white border border-[#DDD9D0] rounded-xl p-5">
        <h3 className="font-semibold text-slate-700 mb-3">班別匯入</h3>
        <p className="text-xs text-slate-500 mb-3">Excel 欄位（依序）：員工編號、姓名、上班時間、下班時間　範例：CY10901361 / 林雅蔆 / 0900 / 1800</p>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleImport} className="hidden" />
        <button onClick={() => fileRef.current.click()}
          className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700">
          📂 選擇 Excel 檔案匯入
        </button>
      </div>

      {/* ── 人員班別指派 ── */}
      <div className="bg-white border border-[#DDD9D0] rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="font-semibold text-slate-700">人員班別指派</h3>
          <div className="flex gap-2 flex-wrap items-center">
            <input value={nameSearchSetup} onChange={e => setNameSearchSetup(e.target.value)}
              placeholder="搜尋姓名／員工編號…"
              className="px-2 py-1 border border-[#DDD9D0] rounded-lg text-sm w-44" />
            <select value={filterVendor} onChange={e => setFilterVendor(e.target.value)}
              className="px-2 py-1 border border-[#DDD9D0] rounded-lg text-sm">
              <option value="">全部廠商</option>
              {vendorNames.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
            <select value={filterShift} onChange={e => setFilterShift(e.target.value)}
              className="px-2 py-1 border border-[#DDD9D0] rounded-lg text-sm">
              <option value="">全部班別</option>
              {sortedShiftTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              <option value="none">未指派</option>
            </select>
          </div>
        </div>

        <div className="border border-[#DDD9D0] rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-100">
              <tr>
                {[['員工編號','empId'],['姓名','name'],['廠商','vendor'],
                  ['班別指派','shift'],['上班時間','shift'],['下班時間','end']].map(([h, col], i) => (
                  <th key={h} className="px-4 py-2.5 text-left font-semibold text-slate-600 text-xs">
                    <SortHeader label={h} col={col} sort={setupSort} onSort={toggleSetupSort} align="left" tone="light" />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleEmps.map((emp, idx) => {
                const st = findShiftType(shiftTypesByWh, whKey, emp.shiftTypeId);
                // 指派來自其他倉別的班別時，補進選項才不會顯示成「未指派」
                const stFromOtherWh = st && !sortedShiftTypes.some(t => t.id === st.id);
                return (
                  <tr key={emp.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-[#F5F2EC]'}>
                    <td className="px-4 py-2 font-mono text-xs text-slate-500">{emp.empId}</td>
                    <td className="px-4 py-2 font-medium text-slate-800">{emp.name}</td>
                    <td className="px-4 py-2 text-slate-500 text-xs">{emp.vendor || '—'}</td>
                    <td className="px-4 py-2">
                      <select value={emp.shiftTypeId ?? ''}
                        onChange={e => assignShift(emp.id, e.target.value)}
                        className="px-2 py-1 border border-[#DDD9D0] rounded text-xs">
                        <option value="">── 未指派 ──</option>
                        {stFromOtherWh && <option value={st.id}>{st.name}（其他倉別）</option>}
                        {sortedShiftTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-600">
                      {st ? `${st.startTime.slice(0,2)}:${st.startTime.slice(2)}` : '—'}
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-600">
                      {st ? `${st.endTime.slice(0,2)}:${st.endTime.slice(2)}` : '—'}
                    </td>
                  </tr>
                );
              })}
              {visibleEmps.length === 0 && (
                <tr><td colSpan="6" className="px-4 py-8 text-center text-slate-400 text-sm">無符合條件的人員</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 班別 Modal */}
      {showTypeModal && (
        <Modal onClose={() => setShowTypeModal(false)}>
          <div className="bg-white rounded-xl shadow w-full max-w-sm p-6 space-y-4">
            <h3 className="font-bold text-lg text-slate-800">{editTypeId ? '編輯班別' : '新增班別'}</h3>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">班別名稱</label>
              <input value={typeForm.name} onChange={e => setTypeForm(p => ({ ...p, name: e.target.value }))}
                placeholder="例：日班、夜班"
                className="w-full px-3 py-2 border border-[#DDD9D0] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-sm font-medium text-slate-700 mb-1">上班時間</label>
                <select value={typeForm.startTime} onChange={e => setTypeForm(p => ({ ...p, startTime: e.target.value }))}
                  className="w-full px-3 py-2 border border-[#DDD9D0] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                  {PRESET_TIMES.map(t => <option key={t} value={t}>{t.slice(0,2)}:{t.slice(2)}</option>)}
                </select>
              </div>
              <div className="flex-1">
                <label className="block text-sm font-medium text-slate-700 mb-1">下班時間</label>
                <select value={typeForm.endTime} onChange={e => setTypeForm(p => ({ ...p, endTime: e.target.value }))}
                  className="w-full px-3 py-2 border border-[#DDD9D0] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                  {PRESET_TIMES.map(t => <option key={t} value={t}>{t.slice(0,2)}:{t.slice(2)}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">顏色標籤</label>
              <div className="flex flex-wrap gap-2">
                {colorOptions.map(c => (
                  <button key={c.value} type="button"
                    onClick={() => setTypeForm(p => ({ ...p, color: c.value }))}
                    className={`px-3 py-1 rounded-full text-xs font-medium ${c.value} ${typeForm.color === c.value ? 'ring-2 ring-offset-1 ring-blue-500' : ''}`}>
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={saveType}
                className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">儲存</button>
              <button onClick={() => setShowTypeModal(false)}
                className="flex-1 py-2 border border-[#DDD9D0] text-slate-600 rounded-lg text-sm hover:bg-[#F5F2EC]">取消</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ShiftCodeTable() {
  const toast = useToast();
  const fileRef = useRef();
  const { shiftCodeRows: rows, setShiftCodeRows: setRows,
          shiftCodeHeaders: headers, setShiftCodeHeaders: setHeaders } = useApp();

  const [importedAt, setImportedAt] = useState(() =>
    LS.get('sms_shiftcode_imported_at', null)
  );
  useEffect(() => { LS.set('sms_shiftcode_imported_at', importedAt); }, [importedAt]);

  // ── 密碼鎖 ──
  const [unlocked,      setUnlocked]      = useState(false);
  const [showPwdModal,  setShowPwdModal]  = useState(false);
  const [pwdInput,      setPwdInput]      = useState('');
  const [pwdError,      setPwdError]      = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const pwdRef = useRef();

  const requireUnlock = (action) => {
    if (unlocked) { action(); return; }
    setPendingAction(() => action);
    setPwdInput('');
    setPwdError(false);
    setShowPwdModal(true);
    setTimeout(() => pwdRef.current?.focus(), 50);
  };

  const submitPwd = () => {
    if (pwdInput === '0000') {
      setUnlocked(true);
      setShowPwdModal(false);
      pendingAction?.();
      setPendingAction(null);
    } else {
      setPwdError(true);
      setPwdInput('');
      setTimeout(() => pwdRef.current?.focus(), 50);
    }
  };

  const [search, setSearch] = useState('');
  const [editingCell, setEditingCell] = useState(null); // { ri, ci }
  const [editValue,   setEditValue]   = useState('');
  const editRef = useRef();

  const startEdit = (ri, ci, val) => {
    requireUnlock(() => {
      setEditingCell({ ri, ci });
      setEditValue(val);
      setTimeout(() => editRef.current?.select(), 0);
    });
  };

  const commitEdit = () => {
    if (!editingCell) return;
    const { ri, ci } = editingCell;
    setRows(prev => prev.map((row, r) => {
      if (r !== ri) return row;
      const next = [...row];
      next[ci] = editValue.trim().toUpperCase();
      return next;
    }));
    setEditingCell(null);
  };

  const cancelEdit = () => setEditingCell(null);

  // ── Excel 匯入解析 ──
  const handleImport = (e) => {
    const file = e.target.files[0];
    if (!file) { return; }
    e.target.value = '';
    requireUnlock(() => {
    if (file.size > 10 * 1024 * 1024) { toast('檔案過大，上限 10 MB', 'error'); return; }
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, { type: 'binary', cellFormula: false, cellHTML: false });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1 });

        if (rawRows.length < 2) { toast('檔案無有效資料', 'error'); return; }

        const rawHeaders = rawRows[0];
        const newHeaders = rawHeaders.slice(1).map(h => (h ?? '').toString().trim()).filter(Boolean);

        if (!newHeaders.length) { toast('無法識別表頭欄位', 'error'); return; }

        const fracToTime = (frac) => {
          if (typeof frac === 'string' && frac.includes(':')) return frac.trim();
          const totalMin = Math.round(Number(frac) * 24 * 60);
          return String(Math.floor(totalMin / 60)).padStart(2, '0') + ':' + String(totalMin % 60).padStart(2, '0');
        };

        const newRows = [];
        for (let i = 1; i < rawRows.length; i++) {
          const row = rawRows[i];
          if (!row || row.every(c => c === null || c === undefined || c === '')) continue;
          const timeVal = row[0];
          if (timeVal === null || timeVal === undefined || timeVal === '') continue;
          const time = fracToTime(timeVal);
          const cells = row.slice(1).map(c => (c ?? '').toString().trim());
          newRows.push([time, ...cells]);
        }

        if (newRows.length === 0) { toast('解析後無有效資料列', 'error'); return; }

        setHeaders(newHeaders);
        setRows(newRows);
        const now = new Date().toLocaleString('zh-TW');
        setImportedAt(now);
        toast(`匯入完成：${newRows.length} 筆時間 × ${newHeaders.length} 欄代號`, 'success');
      } catch (err) {
        toast('檔案解析失敗：' + err.message, 'error');
      }
    };
    reader.readAsBinaryString(file);
    }); // requireUnlock end
  };

  const handleReset = () => {
    requireUnlock(() => {
      setHeaders(SHIFT_CODE_HEADERS);
      setRows(SHIFT_CODE_ROWS);
      setImportedAt(null);
      toast('已還原為內建預設資料', 'info');
    });
  };

  // ── 搜尋 ──
  const matchedCells = useMemo(() => {
    if (!search.trim()) return new Set();
    const q = search.trim().toUpperCase();
    const hits = new Set();
    rows.forEach((row, ri) => {
      row.forEach((cell, ci) => {
        if (ci > 0 && cell.toUpperCase() === q) hits.add(`${ri}-${ci}`);
      });
    });
    return hits;
  }, [search, rows]);

  const searchResult = useMemo(() => {
    if (!search.trim()) return null;
    const q = search.trim().toUpperCase();
    const results = [];
    rows.forEach((row, ri) => {
      row.forEach((cell, ci) => {
        if (ci > 0 && cell.toUpperCase() === q) {
          const colLabel = ci === 1 ? headers[0] : ci === 2 ? headers[1] : (headers[ci - 1] ?? `欄${ci}`);
          results.push({ time: row[0], col: colLabel });
        }
      });
    });
    return results;
  }, [search, rows, headers]);

  return (
    <div className="p-6 space-y-4">
      {/* 密碼驗證 Modal */}
      {showPwdModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
          <div className="bg-white rounded-xl shadow p-7 w-80">
            <div className="text-center mb-4">
              <div className="text-3xl mb-2">🔒</div>
              <h3 className="font-bold text-slate-800 text-lg">需要驗證密碼</h3>
              <p className="text-sm text-slate-500 mt-1">請輸入班別代號表修改密碼</p>
            </div>
            <input
              ref={pwdRef}
              type="password"
              value={pwdInput}
              onChange={e => { setPwdInput(e.target.value); setPwdError(false); }}
              onKeyDown={e => e.key === 'Enter' && submitPwd()}
              placeholder="請輸入密碼"
              className={`w-full border rounded-lg px-3 py-2 text-center text-xl tracking-widest
                focus:outline-none focus:ring-2
                ${pwdError
                  ? 'border-red-400 focus:ring-red-300 bg-red-50'
                  : 'border-[#DDD9D0] focus:ring-blue-400'}`}
            />
            {pwdError && (
              <p className="text-red-500 text-sm text-center mt-2">密碼錯誤，請重新輸入</p>
            )}
            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowPwdModal(false)}
                className="flex-1 py-2 border border-[#DDD9D0] rounded-lg text-slate-600 text-sm hover:bg-[#F5F2EC]">
                取消
              </button>
              <button onClick={submitPwd}
                className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
                確認
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 標題列 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-slate-800">班別代號對照表</h2>
            {unlocked
              ? <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full border border-green-200">🔓 已解鎖</span>
              : <span className="px-2 py-0.5 bg-slate-100 text-slate-500 text-xs rounded-full border border-[#DDD9D0]">🔒 唯讀</span>
            }
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            {rows.length} 筆時間 × {headers.length} 欄代號
            {importedAt && <span className="ml-2 text-blue-500">（最後更新：{importedAt}）</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* 搜尋 */}
          <div className="relative">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜尋代號（如 ZA8）"
              className="border border-[#DDD9D0] rounded-lg px-3 py-1.5 text-sm w-44
                         focus:outline-none focus:ring-2 focus:ring-blue-400 pr-7"
            />
            {search && (
              <button onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400
                           hover:text-slate-600 text-base leading-none">✕</button>
            )}
          </div>
          {/* 匯入 */}
          <button onClick={() => fileRef.current.click()}
            className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 whitespace-nowrap">
            📥 匯入更新
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleImport} className="hidden" />
          {/* 還原預設 */}
          {importedAt && (
            <button onClick={handleReset}
              className="px-3 py-1.5 border border-[#DDD9D0] text-slate-600 rounded-lg text-sm
                         hover:bg-[#F5F2EC] whitespace-nowrap">
              ↩ 還原預設
            </button>
          )}
        </div>
      </div>

      {/* 搜尋結果提示 */}
      {searchResult !== null && (
        <div className={`px-4 py-2.5 rounded-lg text-sm ${
          searchResult.length > 0
            ? 'bg-teal-50 border border-teal-200 text-blue-700'
            : 'bg-white border border-[#DDD9D0] text-slate-500'
        }`}>
          {searchResult.length === 0
            ? `找不到代號「${search.trim().toUpperCase()}」`
            : <>
                找到 <span className="font-bold">{searchResult.length}</span> 筆：
                {searchResult.map((r, i) => (
                  <span key={i} className="ml-2 font-mono bg-blue-100 px-1.5 py-0.5 rounded text-xs">
                    {r.time} / {r.col}
                  </span>
                ))}
              </>
          }
        </div>
      )}

      {/* 圖例 */}
      <div className="flex gap-3 text-xs flex-wrap">
        <span className={`px-2 py-0.5 rounded ${CODE_COL_WORK_COLOR}`}>上班代號（欄1）</span>
        <span className={`px-2 py-0.5 rounded ${CODE_COL_LEAVE_COLOR}`}>休假代號（欄2）</span>
        <span className={`px-2 py-0.5 rounded ${HOLIDAY_COL_COLOR}`}>國定假日代號（欄3以後）</span>
        <span className="px-2 py-0.5 rounded bg-yellow-300 text-yellow-900 font-medium">搜尋符合</span>
        <span className="text-slate-400 ml-2">✏️ 點擊儲存格可編輯（需密碼驗證）</span>
      </div>

      {/* 表格 */}
      <div className="border border-[#DDD9D0] rounded-xl overflow-hidden">
        <div className="overflow-x-auto" style={{ maxHeight: '65vh' }}>
          <table className="border-collapse text-xs" style={{ minWidth: `${80 + (headers.length + 1) * 64}px` }}>
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="sticky left-0 z-20 bg-slate-700 text-white px-3 py-2.5 text-left
                               w-20 min-w-[80px] whitespace-nowrap border-r border-slate-600">
                  上班時間
                </th>
                {headers.map((h, i) => (
                  <th key={i}
                    className={`px-2 py-2.5 text-center whitespace-nowrap w-16 min-w-[64px]
                                border-r border-slate-600 font-semibold
                                ${i === 0 ? 'bg-green-700 text-white' :
                                  i === 1 ? 'bg-yellow-600 text-white' :
                                  'bg-slate-700 text-slate-200'}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} className={ri % 2 === 0 ? 'bg-white' : 'bg-[#F5F2EC]'}>
                  <td className="sticky left-0 z-10 bg-inherit px-3 py-1.5 font-mono font-semibold
                                 text-slate-700 border-r border-slate-200 whitespace-nowrap">
                    {row[0]}
                  </td>
                  {row.slice(1).map((cell, ci) => {
                    const colIdx = ci + 1;
                    const key = `${ri}-${colIdx}`;
                    const isHit = matchedCells.has(key);
                    const isEditing = editingCell?.ri === ri && editingCell?.ci === colIdx;
                    const baseColor =
                      ci === 0 ? CODE_COL_WORK_COLOR :
                      ci === 1 ? CODE_COL_LEAVE_COLOR :
                      HOLIDAY_COL_COLOR;
                    return (
                      <td key={ci}
                        onClick={() => !isEditing && startEdit(ri, colIdx, cell)}
                        className={`px-0 py-0 text-center font-mono border-r border-slate-100
                                    transition-colors cursor-pointer group
                                    ${isEditing ? 'ring-2 ring-inset ring-blue-400' :
                                      isHit ? 'bg-yellow-300 text-yellow-900 font-bold ring-1 ring-yellow-500'
                                            : baseColor}`}>
                        {isEditing ? (
                          <input
                            ref={editRef}
                            value={editValue}
                            onChange={e => setEditValue(e.target.value)}
                            onBlur={commitEdit}
                            onKeyDown={e => {
                              if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
                              if (e.key === 'Escape') cancelEdit();
                            }}
                            className="w-full h-full px-1 py-1.5 text-center font-mono text-xs
                                       bg-white outline-none uppercase"
                            style={{ minWidth: 48 }}
                          />
                        ) : (
                          <span className="block px-2 py-1.5 group-hover:bg-black/5">
                            {cell}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-slate-400">
        {importedAt
          ? `使用者匯入資料，最後更新：${importedAt}`
          : '使用內建預設資料（休假代碼-1.xlsx）｜時間為班別上班起始時間（30分鐘間距）'}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────
// ACCOUNT MANAGEMENT
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// PERMISSION MANAGEMENT
// ─────────────────────────────────────────────

function AccountManagement() {
  const { users, setUsers, vendors, warehouses, currentUser, employees,
          setWorkerPwds, selectedWarehouse, selectedDept, selectedGroup, selectedWorkArea, selectedVendor } = useApp();
  const vendorNames = vendors.map(v => v.name);
  const toast = useToast();

  // ── 分頁 Tab ──
  const [activeTab,   setActiveTab]   = useState('staff');
  const [expandedId,  setExpandedId]  = useState(null);

  // ── AD 員工清單（從後端取得）──
  const [apiUsers,       setApiUsers]       = useState([]);
  const [apiUsersLoaded, setApiUsersLoaded] = useState(false);
  const [savingWhFor,    setSavingWhFor]    = useState(null);
  const [savingRoleFor,  setSavingRoleFor]  = useState(null);
  const [vendorSearch,   setVendorSearch]   = useState('');

  const refreshApiUsers = useCallback(() => {
    if (!currentUser?._apiAuth) return;
    const token = localStorage.getItem(JWT_KEY);
    if (!token) return;
    fetch('/api/users', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) { setApiUsers(data); setApiUsersLoaded(true); } })
      .catch(() => {});
  }, [currentUser]);

  useEffect(() => { refreshApiUsers(); }, [refreshApiUsers]);

  // 切回前景時重新拉取（跨裝置角色變更同步）
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') refreshApiUsers(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refreshApiUsers]);

  // 定期輪詢（30 秒），確保停留在帳號管理頁也能同步其他裝置的角色變更
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') refreshApiUsers();
    }, 30000);
    return () => clearInterval(id);
  }, [refreshApiUsers]);

  const updateApiUserRole = async (userId, newRole) => {
    const token = localStorage.getItem(JWT_KEY);
    if (!token) return;
    setSavingRoleFor(userId);
    try {
      const r = await fetch(`/api/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ role: newRole }),
      });
      if (r.ok) {
        const updated = await r.json();
        setApiUsers(prev => prev.map(u => u.id === updated.id ? updated : u));
        toast(`${updated.username} 已${newRole === 'admin' ? '升級為管理員' : '降級為日翊'}`, 'success');
      } else {
        const d = await r.json().catch(() => ({}));
        toast(d.error ?? '操作失敗', 'error');
      }
    } catch {
      toast('操作失敗', 'error');
    } finally {
      setSavingRoleFor(null);
    }
  };

  const updateApiUserWh = async (userId, newWh) => {
    const token = localStorage.getItem(JWT_KEY);
    if (!token) return;
    setSavingWhFor(userId);
    try {
      const r = await fetch(`/api/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ allowed_warehouses: newWh }),
      });
      if (r.ok) {
        const updated = await r.json();
        setApiUsers(prev => prev.map(u => u.id === updated.id ? updated : u));
        toast('倉別權限已更新：' + updated.username, 'success');
      } else {
        toast('更新失敗', 'error');
      }
    } catch {
      toast('更新失敗', 'error');
    } finally {
      setSavingWhFor(null);
    }
  };

  // 日翊員工帳號：設定可看哪些分頁（存入 DB 的 page_perms）
  const [savingPermFor, setSavingPermFor] = useState(null);
  const [permOpenFor, setPermOpenFor] = useState(null);
  const updateApiUserPages = async (userId, newPages) => {
    const token = localStorage.getItem(JWT_KEY);
    if (!token) return;
    setSavingPermFor(userId);
    try {
      const r = await fetch(`/api/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ page_perms: newPages }),
      });
      if (r.ok) {
        const updated = await r.json();
        setApiUsers(prev => prev.map(u => u.id === updated.id ? updated : u));
        toast('分頁權限已更新：' + updated.username, 'success');
      } else {
        toast('更新失敗', 'error');
      }
    } catch {
      toast('更新失敗', 'error');
    } finally {
      setSavingPermFor(null);
    }
  };

  // 日翊員工帳號刪除（兩段式確認；grace 與自己的帳號不可刪）
  // 注意：AD 帳號下次登入時系統會自動重建一筆最低權限(worker)紀錄，
  //       因此刪除的效果是「撤銷現有角色與權限」，而非永久封鎖登入。
  const [confirmDelFor, setConfirmDelFor] = useState(null);
  const [deletingFor, setDeletingFor] = useState(null);
  const deleteApiUser = async (u) => {
    const token = localStorage.getItem(JWT_KEY);
    if (!token) return;
    setDeletingFor(u.id);
    try {
      const r = await fetch(`/api/users/${u.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) {
        setApiUsers(prev => prev.filter(x => x.id !== u.id));
        toast(`已刪除帳號：${u.username}`, 'info');
      } else {
        const d = await r.json().catch(() => ({}));
        toast(d.error || '刪除失敗', 'error');
      }
    } catch {
      toast('刪除失敗，請檢查網路', 'error');
    } finally {
      setDeletingFor(null);
      setConfirmDelFor(null);
    }
  };

  // 協助忘記密碼者還原預設密碼（密碼＝帳號／員工編號，對方登入後須自行設定新密碼）
  const [resetPwdFor, setResetPwdFor] = useState(null);   // 兩段式確認
  const [resettingFor, setResettingFor] = useState(null);
  const resetPassword = async (kind, target, label) => {
    const token = localStorage.getItem(JWT_KEY);
    if (!token) return;
    setResettingFor(target);
    try {
      const r = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ kind, target }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        // 委外人員密碼同時存在本機快取，一併清除以免舊密碼被誤用
        if (kind === 'worker') setWorkerPwds(prev => { const n = { ...prev }; delete n[target]; return n; });
        toast(kind === 'worker'
          ? `${label} 請以員工編號「${d.defaultPassword}」登入（委外人員帳密皆為員工編號）`
          : `${label} 密碼已重設，請以「${d.defaultPassword}」登入並設定新密碼`, 'success');
      } else {
        toast(d.error || '密碼重設失敗', 'error');
      }
    } catch {
      toast('密碼重設失敗，請檢查網路', 'error');
    } finally {
      setResettingFor(null);
      setResetPwdFor(null);
    }
  };

  // 核准日翊 AD 權限申請：升為日翊(area)並標記已核准
  const [approvingFor, setApprovingFor] = useState(null);
  // 核准時選定的倉別（userId → wh id 陣列）。日翊角色若倉別空白會看不到任何倉，故必須指定
  const [pendingWh, setPendingWh] = useState({});
  const togglePendingWh = (userId, whId) => setPendingWh(prev => {
    const cur = prev[userId] ?? [];
    return { ...prev, [userId]: cur.includes(whId) ? cur.filter(x => x !== whId) : [...cur, whId] };
  });
  const approveAccessRequest = async (u) => {
    const token = localStorage.getItem(JWT_KEY);
    if (!token) return;
    setApprovingFor(u.id);
    try {
      const r = await fetch(`/api/users/${u.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          role: 'area',
          approved: true,
          allowed_warehouses: pendingWh[u.id] ?? [],
        }),
      });
      if (r.ok) {
        const updated = await r.json();
        setApiUsers(prev => prev.map(x => x.id === updated.id ? updated : x));
        const whNames = (updated.allowedWarehouses ?? [])
          .map(id => warehouses.find(w => w.id === id)?.name ?? id).join('、');
        setPendingWh(prev => { const n = { ...prev }; delete n[u.id]; return n; });
        toast(`已核准 ${updated.username}（${whNames || '未指派倉別'}）`, 'success');
      } else {
        const d = await r.json().catch(() => ({}));
        toast(d.error || '核准失敗', 'error');
      }
    } catch {
      toast('核准失敗，請檢查網路', 'error');
    } finally {
      setApprovingFor(null);
    }
  };

  // ── 委外人員搜尋 ──
  const [workerSearchName, setWorkerSearchName] = useState('');
  const [workerSearchId,   setWorkerSearchId]   = useState('');

  // ── 帳號新增 / 編輯 Modal ──
  const [showModal, setShowModal] = useState(false);
  const [editUser,  setEditUser]  = useState(null);
  const emptyForm = { id: '', username: '', password: '', name: '', role: ROLES.VENDOR, vendors: [], allowedWarehouses: [] };
  const [form, setForm] = useState(emptyForm);

  const openAdd  = () => { setForm(emptyForm); setEditUser(null); setShowModal(true); };
  const openEdit = u  => { setForm({ ...u });  setEditUser(u);   setShowModal(true); };

  const handleSave = async () => {
    if (!form.username || !form.password || !form.name) {
      toast('帳號、密碼、姓名為必填', 'error'); return;
    }
    // 密碼強度驗證（明文時才檢查）
    if (!form.password.startsWith('sha256:')) {
      if (form.password.length < 8)          { toast('密碼至少需 8 個字元', 'error'); return; }
      if (!/[A-Za-z]/.test(form.password))   { toast('密碼需包含至少一個英文字母', 'error'); return; }
      if (!/[0-9]/.test(form.password))      { toast('密碼需包含至少一個數字', 'error'); return; }
    }
    const pwd = form.password.startsWith('sha256:')
      ? form.password
      : await hashPwd(form.password);
    const saved = { ...form, password: pwd };
    if (editUser) {
      setUsers(prev => prev.map(u => u.id === saved.id ? saved : u));
      toast('帳號已更新：' + saved.username, 'success');
      // 廠商帳號登入以資料庫為準，姓名／密碼／授權廠商／倉別須一併寫回
      if (saved.role === ROLES.VENDOR) await syncVendorToDB(saved);
    } else {
      const created = { ...saved, id: 'u' + Date.now(), approved: true, loginCount: 0,
                        permissions: getDefaultPermissions(saved.role) };
      setUsers(prev => [...prev, created]);
      toast('帳號已新增：' + saved.username, 'success');
      // 未寫入資料庫的廠商帳號無法登入（歷來已發生過）
      if (created.role === ROLES.VENDOR) await syncVendorToDB(created);
    }
    setShowModal(false);
  };

  const handleDelete = async id => {
    const target = users.find(u => u.id === id);
    if (target?.system) { toast('系統帳號不可刪除', 'error'); return; }
    setUsers(prev => prev.filter(u => u.id !== id));
    // 只刪本機會留下仍可登入的資料庫帳號
    await deleteFromDB(target);
    toast('帳號已刪除', 'info');
  };

  // 寫入 DB 失敗時務必提示：否則畫面顯示建立成功、實際 DB 沒有帳號，
  // 使用者要到登入失敗時才會發現（歷來已發生過一次）
  // 廠商帳號同時存在於本機 users 與資料庫 users 表，登入一律以資料庫為準。
  // 任何只改本機的操作（編輯、刪除、撤銷）都不會生效，刪除更會留下仍可登入的帳號。
  const deleteFromDB = async (u) => {
    const token = localStorage.getItem(JWT_KEY);
    if (!token || !u) return;
    const dbId = apiUsers.find(a => a.id === u.id || a.username === u.username)?.id;
    if (!dbId) return;   // 資料庫沒有這筆，僅本機資料
    const r = await fetch(`/api/users/${dbId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => null);
    if (r?.ok) setApiUsers(prev => prev.filter(a => a.id !== dbId));
    else toast(`帳號 ${u.username} 未能自資料庫刪除，該帳號可能仍可登入`, 'error');
  };

  const syncVendorToDB = async (u) => {
    const token = localStorage.getItem('sms_jwt');
    if (!token) return;
    try {
      const r = await fetch('/api/auth/vendor-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          id: u.id,
          username: u.username,
          password_hash: u.password,
          name: u.name,
          vendors: u.vendors ?? [],
          allowed_warehouses: u.allowedWarehouses ?? [],
        }),
      });
      if (!r.ok) {
        toast(`帳號 ${u.username} 未能寫入資料庫（HTTP ${r.status}），該帳號將無法登入，請聯繫管理員`, 'error');
      }
    } catch (e) {
      toast(`帳號 ${u.username} 寫入資料庫失敗：${e.message}`, 'error');
    }
  };

  const handleApprove = async u => {
    if (u._api) {
      const token = localStorage.getItem(JWT_KEY);
      const r = await fetch(`/api/users/${u.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ approved: true }),
      }).catch(() => null);
      if (r?.ok) {
        const updated = await r.json();
        setApiUsers(prev => prev.map(x => x.id === updated.id ? updated : x));
        // 廠商帳號分頁列的是本機 users 陣列，而此申請是直接寫入資料庫的，
        // 核准後若不補進本機清單，帳號雖可登入卻不會出現在分頁上、也無法管理。
        if (updated.role === ROLES.VENDOR) {
          setUsers(prev => prev.some(x => x.username === updated.username)
            ? prev.map(x => x.username === updated.username
                ? { ...x, id: updated.id, approved: true, role: ROLES.VENDOR,
                    name: updated.name, vendors: updated.vendors ?? [],
                    allowedWarehouses: updated.allowedWarehouses ?? [] }
                : x)
            : [...prev, {
                id: updated.id,
                username: updated.username,
                name: updated.name || updated.username,
                role: ROLES.VENDOR,
                approved: true,
                vendors: updated.vendors ?? [],
                allowedWarehouses: updated.allowedWarehouses ?? [],
                permissions: getDefaultPermissions(ROLES.VENDOR),
                mustChangePassword: false,
              }]);
        }
        toast(`已核准 ${updated.username}`, 'success');
      } else {
        toast('核准失敗', 'error');
      }
      return;
    }
    const target = users.find(x => x.id === u.id);
    setUsers(prev => prev.map(x => x.id === u.id ? { ...x, approved: true } : x));
    toast('帳號已核准', 'success');
    if (target?.role === ROLES.VENDOR) await syncVendorToDB({ ...target, approved: true });
  };

  const handleReject = async u => {
    if (u._api) {
      const token = localStorage.getItem(JWT_KEY);
      const r = await fetch(`/api/users/${u.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => null);
      if (r?.ok) {
        setApiUsers(prev => prev.filter(x => x.id !== u.id));
        toast('申請已拒絕並刪除', 'info');
      } else {
        toast('拒絕失敗', 'error');
      }
      return;
    }
    setUsers(prev => prev.filter(x => x.id !== u.id));
    toast('申請已拒絕並刪除', 'info');
  };

  const toggleApproved = async u => {
    if (u.system) { toast('系統帳號不可停用', 'error'); return; }
    const next = !u.approved;
    setUsers(prev => prev.map(x => x.id === u.id ? { ...x, approved: next } : x));
    toast((u.approved ? '已停用：' : '已啟用：') + u.username, u.approved ? 'warn' : 'success');

    // 登入以資料庫的 approved 為準，只改本機會讓「已停用」的帳號仍可登入
    const dbId = apiUsers.find(a => a.id === u.id || a.username === u.username)?.id;
    if (!dbId) return;
    const token = localStorage.getItem(JWT_KEY);
    if (!token) return;
    const r = await fetch(`/api/users/${dbId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ approved: next }),
    }).catch(() => null);
    if (r?.ok) {
      const updated = await r.json();
      setApiUsers(prev => prev.map(a => a.id === updated.id ? updated : a));
    } else {
      toast(`${u.username} 的狀態未能寫入資料庫，該帳號可能仍可登入`, 'error');
    }
  };

  const togglePerm = (userId, pageKey, featKey, val) => {
    const target = users.find(u => u.id === userId);
    if (!target) return;
    const perms = { ...(target.permissions ?? getDefaultPermissions(target.role)) };
    const page  = { ...perms[pageKey] };
    if (featKey === 'view') {
      page.view = val;
      if (!val) PAGE_PERMISSIONS.find(p => p.key === pageKey)?.features.forEach(f => { page[f.key] = false; });
    } else {
      page[featKey] = val;
      if (val) page.view = true;
    }
    perms[pageKey] = page;
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, permissions: perms } : u));

    // 透過帳號申請建立的廠商帳號登入時讀的是資料庫的 page_perms 欄位，
    // 只改本機 users 不會生效，故同一份設定須一併寫回資料庫。
    if (!apiUsers.some(a => a.id === userId)) return;
    const token = localStorage.getItem(JWT_KEY);
    if (!token) return;
    const pages = Object.entries(perms).filter(([, v]) => v?.view).map(([k]) => k);
    fetch(`/api/users/${userId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ page_perms: pages }),
    })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(updated => setApiUsers(prev => prev.map(u => u.id === updated.id ? updated : u)))
      .catch(() => toast('權限已在本機更新，但寫入伺服器失敗，請重試', 'error'));
  };

  const toggleVendor = v => setForm(p => ({
    ...p, vendors: p.vendors.includes(v) ? p.vendors.filter(x => x !== v) : [...p.vendors, v],
  }));

  const toggleWarehouse = whId => setForm(p => ({
    ...p,
    allowedWarehouses: (p.allowedWarehouses ?? []).includes(whId)
      ? (p.allowedWarehouses ?? []).filter(x => x !== whId)
      : [...(p.allowedWarehouses ?? []), whId],
  }));

  // 登入次數／最後登入由伺服器在每次登入時累計，本機 users 不會更新，
  // 故一律以 apiUsers（資料庫）為準，查無對應帳號才退回本機值。
  const dbUserOf = u => apiUsers.find(a => a.id === u.id || a.username === u.username);
  const loginCountOf = u => dbUserOf(u)?.loginCount ?? u.loginCount ?? 0;
  const lastLoginOf = u => {
    const t = dbUserOf(u)?.last_login;
    if (!t) return null;
    const d = new Date(t);
    return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
  };

  const roleLabel = { admin: '管理員', area: '日翊', vendor: '委外幹部', worker: '委外人員' };
  const roleBadge = { admin: 'bg-red-100 text-red-700', area: 'bg-purple-100 text-purple-700', vendor: 'bg-blue-100 text-blue-700', worker: 'bg-orange-100 text-orange-700' };

  // 廠商帳號申請以資料庫為準：申請者尚未登入，資料是直接寫入伺服器的，
  // 本機 users 只保留舊資料相容（依帳號去重，避免同一筆重複顯示）
  const pendingUsers = (() => {
    const seen = new Set();
    const out = [];
    apiUsers.filter(u => u.role === ROLES.VENDOR && !u.approved).forEach(u => {
      seen.add(u.username);
      out.push({ ...u, _api: true, name: u.display_name || u.username });
    });
    users.filter(u => u.approved === false && !seen.has(u.username)).forEach(u => out.push(u));
    return out;
  })();
  const staffUsers   = users.filter(u => [ROLES.ADMIN, ROLES.AREA].includes(u.role) && u.approved !== false);

  // 員工帳號 tab：依上方「倉別」篩選（比對該帳號的可用倉別）。
  // 管理員可使用全部倉別，故不受倉別篩選影響，一律顯示。
  const staffApiUsers = apiUsers.filter(u => {
    if (![ROLES.ADMIN, ROLES.AREA].includes(u.role)) return false;
    if (selectedWarehouse && u.role !== ROLES.ADMIN
        && !(u.allowedWarehouses ?? []).includes(selectedWarehouse)) return false;
    return true;
  });

  // Tab 2: 廠商帳號 — 依登入員工的倉別×課別×廠商別綁定過濾可見廠商
  const allowedWhForFilter = currentUser?.role === ROLES.ADMIN ? null : (currentUser?.allowedWarehouses ?? []);
  const visibleVendorNames = allowedWhForFilter === null
    ? null
    : allowedWhForFilter.length === 0
      ? null
      : new Set(
          warehouses
            .filter(w => allowedWhForFilter.includes(w.id))
            .flatMap(w => w.departments ?? [])
            .flatMap(d => d.vendors ?? [])
        );
  // 上方條件（倉別/課別）篩選廠商名稱
  const scopeVendorNames = selectedDept
    ? new Set(warehouses.find(w => w.id === selectedWarehouse)?.departments?.find(d => d.id === selectedDept)?.vendors ?? [])
    : selectedWarehouse
      ? new Set(warehouses.find(w => w.id === selectedWarehouse)?.departments?.flatMap(d => d.vendors ?? []) ?? [])
      : null;
  const vendorUsers = users.filter(u => {
    if (u.role !== ROLES.VENDOR || u.approved === false) return false;
    const vs = u.vendors ?? [];
    if (visibleVendorNames !== null && !vs.some(v => visibleVendorNames.has(v))) return false;
    if (scopeVendorNames   !== null && !vs.some(v => scopeVendorNames.has(v)))   return false;
    // 上方「廠商」篩選：先前未套用，導致選了廠商清單卻不會收斂
    if (selectedVendor && !vs.includes(selectedVendor)) return false;
    const q = vendorSearch.trim().toLowerCase();
    if (q && !(`${u.username} ${u.name ?? ''}`.toLowerCase().includes(q))) return false;
    return true;
  });

  const tabUsers = activeTab === 'staff' ? staffUsers : vendorUsers;

  // 委外人員 tab：從員工清冊取得，依上方條件篩選，標示是否已升級為幹部帳號
  const workerEmpListAll = filterByScope(
    employees.filter(e => e.status !== '離職' && e.vendor),
    warehouses, selectedWarehouse, selectedDept, selectedGroup, selectedWorkArea
  );
  const workerEmpList = workerEmpListAll.filter(e =>
    // 上方「廠商」篩選同樣要套用，否則選了廠商清單卻不會收斂
    (!selectedVendor   || e.vendor === selectedVendor) &&
    (!workerSearchName || e.name?.includes(workerSearchName)) &&
    (!workerSearchId   || e.empId?.includes(workerSearchId))
  );
  const upgradedEmpIds = new Set(
    users.filter(u => u.role === ROLES.VENDOR && u.employeeId).map(u => u.employeeId)
  );

  const handleUpgradeToVendor = async (emp) => {
    if (upgradedEmpIds.has(emp.id)) { toast('此員工已有委外幹部帳號', 'warn'); return; }
    const hashed = await hashPwd(emp.empId);
    const newUser = {
      id: 'worker_upgraded_' + emp.id,
      username: emp.empId,
      password: hashed,
      name: emp.name,
      role: ROLES.VENDOR,
      vendors: emp.vendor ? [emp.vendor] : [],
      allowedWarehouses: [],
      approved: true,
      loginCount: 0,
      employeeId: emp.id,
      permissions: getDefaultPermissions(ROLES.VENDOR),
      mustChangePassword: true,
    };
    setUsers(prev => [...prev, newUser]);
    toast(`已升級 ${emp.name}（${emp.empId}）為委外幹部`, 'success');
    await syncVendorToDB(newUser);
  };

  const handleDowngradeToWorker = async (emp) => {
    const target = users.find(u => u.role === ROLES.VENDOR && u.employeeId === emp.id);
    setUsers(prev => prev.filter(u => !(u.role === ROLES.VENDOR && u.employeeId === emp.id)));
    // 同上：資料庫的帳號未刪除的話，撤銷後仍可登入
    await deleteFromDB(target);
    toast(`已撤銷 ${emp.name} 的委外幹部權限`, 'info');
  };

  const TAB_CFG = [
    { key: 'staff',  label: '員工帳號', icon: '🏢', count: apiUsersLoaded ? staffApiUsers.length : staffUsers.length },
    { key: 'vendor', label: '廠商帳號', icon: '🤝', count: vendorUsers.length },
    { key: 'worker', label: '委外人員', icon: '👷', count: workerEmpListAll.length },
  ];

  return (
    <div className="p-6 space-y-4">
      {/* 標題列 */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-800">帳號與權限管理</h2>
        <div className="flex items-center gap-2">
          {/* 帳號清單只在進入頁面與切回分頁時抓取，新申請不會自動出現，故提供手動重新整理 */}
          <button onClick={() => { refreshApiUsers(); toast('已重新載入帳號清單', 'success'); }}
            className="px-3 py-1.5 bg-white border border-[#DDD9D0] text-slate-700 rounded-lg text-sm
                       hover:bg-[#F5F2EC]">
            🔄 重新整理
          </button>
          <button onClick={openAdd}
            className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
            ➕ 新增帳號
          </button>
        </div>
      </div>

      {/* 待審核申請：無資料時仍顯示一行說明，避免與「清單未更新」混淆 */}
      {pendingUsers.length === 0 && apiUsersLoaded && (
        <p className="text-xs text-slate-400">
          目前無待審核的廠商帳號申請（申請後請按上方「🔄 重新整理」）
        </p>
      )}
      {pendingUsers.length > 0 && (
        <div className="border border-amber-300 bg-amber-50 rounded-xl p-4 space-y-3">
          <h3 className="font-semibold text-amber-800 flex items-center gap-2">
            <span>⏳</span> 待審核廠商帳號申請（{pendingUsers.length} 筆）
          </h3>
          {pendingUsers.map(u => (
            <div key={u.id} className="flex items-center justify-between bg-white border border-amber-200 rounded-lg px-4 py-2.5">
              <div className="text-sm">
                <span className="font-mono font-medium text-slate-700">{u.username}</span>
                <span className="mx-2 text-slate-400">·</span>
                <span className="text-slate-600">{u.name}</span>
                <span className="mx-2 text-slate-400">·</span>
                <span className="text-emerald-700">{u.vendors?.join('、')}</span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => handleApprove(u)}
                  className="px-3 py-1 bg-emerald-600 text-white text-xs rounded-lg hover:bg-emerald-700">核准</button>
                <button onClick={() => handleReject(u)}
                  className="px-3 py-1 bg-red-500 text-white text-xs rounded-lg hover:bg-red-600">拒絕</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[#DDD9D0]">
        {TAB_CFG.map(t => (
          <button key={t.key}
            onClick={() => { setActiveTab(t.key); setExpandedId(null); }}
            className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-t-lg border border-b-0 transition-colors
                        ${activeTab === t.key
                          ? 'bg-white border-slate-200 text-teal-700 -mb-px z-10'
                          : 'bg-[#F5F2EC] border-transparent text-slate-500 hover:text-slate-700'}`}>
            <span>{t.label}</span>
            <span className={`px-1.5 py-0.5 rounded-full text-xs
                              ${activeTab === t.key ? 'bg-blue-100 text-teal-700' : 'bg-slate-200 text-slate-500'}`}>
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {/* ── 委外人員 Tab ── */}
      {activeTab === 'worker' && (
        <div>
        <div className="flex gap-2 mb-3">
          <input value={workerSearchName} onChange={e => setWorkerSearchName(e.target.value)}
            placeholder="搜尋姓名…"
            className="border border-[#DDD9D0] rounded-lg px-3 py-1.5 text-sm w-40" />
          <input value={workerSearchId} onChange={e => setWorkerSearchId(e.target.value)}
            placeholder="搜尋員編…"
            className="border border-[#DDD9D0] rounded-lg px-3 py-1.5 text-sm w-36" />
          {(workerSearchName || workerSearchId) && (
            <button onClick={() => { setWorkerSearchName(''); setWorkerSearchId(''); }}
              className="px-3 py-1.5 text-xs text-slate-500 border border-[#DDD9D0] rounded-lg hover:bg-[#F5F2EC]">
              清除
            </button>
          )}
          <span className="ml-auto text-xs text-slate-400 self-center">
            顯示 {workerEmpList.length} / {workerEmpListAll.length} 筆
          </span>
        </div>
        <div className="border border-[#DDD9D0] rounded-xl overflow-hidden">
          <div className="grid text-xs font-semibold text-slate-500 uppercase tracking-wide
                          bg-slate-100 px-4 py-2.5 border-b border-[#DDD9D0]"
               style={{ gridTemplateColumns: '120px 1fr 1fr 100px 90px 140px' }}>
            <span>員工編號</span>
            <span>姓名</span>
            <span>廠商</span>
            <span>班別</span>
            <span>登入次數</span>
            <span>幹部權限</span>
          </div>
          <div className="divide-y divide-slate-100">
            {workerEmpList.length === 0 && (
              <p className="text-sm text-slate-400 text-center py-6">尚未匯入員工清冊</p>
            )}
            {workerEmpList.map(emp => {
              const isUpgraded = upgradedEmpIds.has(emp.id);
              return (
                <div key={emp.id} className="grid items-center gap-2 px-4 py-2.5 hover:bg-[#F5F2EC]"
                     style={{ gridTemplateColumns: '120px 1fr 1fr 100px 90px 140px' }}>
                  <span className="font-mono text-sm text-slate-700">{emp.empId}</span>
                  <span className="text-sm text-slate-700">{emp.name}</span>
                  <span className="text-xs text-slate-500">{emp.vendor || '—'}</span>
                  <span className="text-xs text-slate-500">{emp.shiftType || '—'}</span>
                  {(() => {
                    // 委外人員的登入次數由伺服器以員編為 key 累計於 users 表
                    const db = apiUsers.find(a => a.username === emp.empId);
                    const t = db?.last_login ? new Date(db.last_login) : null;
                    return (
                      <span>
                        <span className="text-teal-700 font-bold text-sm">{db?.loginCount ?? 0}</span>
                        {t && <span className="block text-[10px] text-slate-400 leading-tight">
                          {t.getFullYear()}/{String(t.getMonth()+1).padStart(2,'0')}/{String(t.getDate()).padStart(2,'0')}</span>}
                      </span>
                    );
                  })()}
                  <div className="flex items-center gap-2">
                    {isUpgraded ? (
                      <>
                        <span className="px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-700 font-medium">已升委外幹部</span>
                        <button onClick={() => handleDowngradeToWorker(emp)}
                          className="px-2 py-1 text-xs text-red-500 hover:bg-red-50 rounded">撤銷</button>
                      </>
                    ) : (
                      <button onClick={() => handleUpgradeToVendor(emp)}
                        className="px-3 py-1 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                        升級為委外幹部
                      </button>
                    )}
                    {resettingFor === emp.empId
                      ? <span className="px-2 py-1 text-xs text-slate-400">重設中…</span>
                      : resetPwdFor === emp.empId
                        ? <span className="flex items-center gap-1">
                            <button onClick={() => resetPassword('worker', emp.empId, emp.name)}
                              className="px-2 py-1 text-xs bg-amber-600 text-white rounded hover:bg-amber-700">
                              確定重設
                            </button>
                            <button onClick={() => setResetPwdFor(null)}
                              className="px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 rounded">取消</button>
                          </span>
                        : <button onClick={() => setResetPwdFor(emp.empId)}
                            title="還原為預設密碼（＝員工編號），對方登入後須自行設定新密碼"
                            className="px-2 py-1 text-xs text-amber-700 hover:bg-amber-50 rounded">
                            重設密碼
                          </button>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        </div>
      )}

      {/* ── 待審核：日翊 AD 權限申請 ── */}
      {activeTab === 'staff' && apiUsersLoaded && (() => {
        // 僅列出「日翊 AD 帳號」的權限申請：廠商幹部有自己的審核流程，不應混入
        const pendingAd = apiUsers.filter(u =>
          u.role !== ROLES.VENDOR &&
          (!u.approved || (u.role !== ROLES.ADMIN && u.role !== ROLES.AREA))
        );
        if (pendingAd.length === 0) return null;
        return (
          <div className="border border-amber-300 rounded-xl overflow-hidden mb-4">
            <div className="bg-amber-50 px-4 py-2.5 border-b border-amber-200 flex items-center gap-2">
              <span className="text-sm font-semibold text-amber-800">⏳ 待審核權限申請（{pendingAd.length} 筆）</span>
              <span className="text-xs text-amber-700">這些 AD 帳號已通過公司驗證，但尚未取得系統使用權限</span>
            </div>
            <div className="divide-y divide-amber-100">
              {pendingAd.map(u => (
                <div key={u.id} className="px-4 py-3 flex items-center gap-3 flex-wrap hover:bg-amber-50/50">
                  <span className="font-mono font-bold text-slate-800 text-sm w-32 shrink-0">{u.username}</span>
                  <span className="text-sm text-slate-600">
                    {u.display_name && u.display_name !== u.username ? u.display_name : '（未填姓名）'}
                  </span>
                  {u.request_note
                    ? <span className="text-xs text-slate-500 bg-white border border-amber-200 rounded px-2 py-0.5">
                        {u.request_note}
                      </span>
                    : <span className="text-xs text-slate-400">申請中（未補件）</span>}

                  {/* 核准前須指定倉別：日翊角色倉別空白會看不到任何倉別 */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-slate-500">開放倉別：</span>
                    {warehouses.map(w => (
                      <label key={w.id} className="flex items-center gap-1 cursor-pointer text-xs select-none">
                        <input type="checkbox"
                          checked={(pendingWh[u.id] ?? []).includes(w.id)}
                          disabled={approvingFor === u.id}
                          onChange={() => togglePendingWh(u.id, w.id)}
                          className="rounded accent-emerald-600" />
                        <span>{w.name}</span>
                      </label>
                    ))}
                  </div>

                  <div className="ml-auto flex items-center gap-2">
                    {approvingFor === u.id
                      ? <span className="text-xs text-slate-400">核准中…</span>
                      : <button onClick={() => approveAccessRequest(u)}
                          disabled={(pendingWh[u.id] ?? []).length === 0}
                          title={(pendingWh[u.id] ?? []).length === 0 ? '請先勾選開放倉別' : ''}
                          className="px-3 py-1 text-xs bg-emerald-600 text-white rounded-lg
                                     hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed">
                          核准為日翊
                        </button>}
                    {confirmDelFor === u.id
                      ? <span className="flex items-center gap-1">
                          <button onClick={() => deleteApiUser(u)}
                            className="px-2 py-1 text-xs bg-red-600 text-white rounded-lg hover:bg-red-700">確定拒絕</button>
                          <button onClick={() => setConfirmDelFor(null)}
                            className="px-2 py-1 text-xs border border-slate-300 text-slate-600 rounded-lg">取消</button>
                        </span>
                      : <button onClick={() => setConfirmDelFor(u.id)}
                          className="px-2.5 py-1 text-xs border border-red-300 text-red-600 rounded-lg hover:bg-red-50">
                          拒絕
                        </button>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* 清單表頭（員工 / 廠商 tab） */}
      {/* ── 員工帳號 Tab：AD 員工清單（API mode） ── */}
      {activeTab === 'staff' && apiUsersLoaded && (
        <div className="border border-[#DDD9D0] rounded-xl overflow-hidden">
          <div className="bg-[#F5F2EC] px-4 py-2.5 border-b border-[#DDD9D0] flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">AD 員工帳號（{staffApiUsers.length} 筆）</span>
            <span className="text-xs text-slate-400">可設定每位員工可使用的倉別</span>
          </div>
          <div className="divide-y divide-slate-100">
            {staffApiUsers.map(u => (
              <div key={u.id} className="px-4 py-3 flex items-center gap-3 flex-wrap hover:bg-[#F5F2EC]">
                <span className="font-mono font-bold text-slate-800 text-sm w-28 shrink-0">{u.username}</span>
                {u.display_name && <span className="text-sm text-slate-600 shrink-0">{u.display_name}</span>}
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium w-fit ${roleBadge[u.role]}`}>{roleLabel[u.role]}</span>
                {/* 登入次數／最後登入：資料庫於每次登入時累計 */}
                <span className="shrink-0 text-xs text-slate-400" title="登入次數">
                  登入 <span className="text-teal-700 font-bold text-sm">{u.loginCount ?? 0}</span> 次
                  {u.last_login && (() => { const d = new Date(u.last_login);
                    return <span className="ml-1 text-[11px] text-slate-400">
                      （{d.getFullYear()}/{String(d.getMonth()+1).padStart(2,'0')}/{String(d.getDate()).padStart(2,'0')}）
                    </span>; })()}
                </span>
                <span className="text-xs text-slate-400 shrink-0">可用倉別：</span>
                <div className="flex flex-wrap gap-2 flex-1">
                  {warehouses.map(w => {
                    const checked = (u.allowedWarehouses ?? []).includes(w.id);
                    return (
                      <label key={w.id} className="flex items-center gap-1 cursor-pointer text-sm select-none">
                        <input type="checkbox"
                          checked={checked}
                          disabled={u.role === ROLES.ADMIN || savingWhFor === u.id}
                          onChange={() => {
                            const cur = u.allowedWarehouses ?? [];
                            const next = checked ? cur.filter(x => x !== w.id) : [...cur, w.id];
                            updateApiUserWh(u.id, next);
                          }}
                          className="rounded accent-teal-600" />
                        <span className={u.role === ROLES.ADMIN ? 'text-slate-400' : ''}>{w.name}</span>
                      </label>
                    );
                  })}
                  {u.role === ROLES.ADMIN && <span className="text-xs text-slate-400 italic">管理員可使用全部倉別</span>}
                  {savingWhFor === u.id && <span className="text-xs text-slate-400">儲存中…</span>}
                </div>
                {/* 角色升降級 */}
                <div className="shrink-0 flex items-center gap-2">
                  {savingRoleFor === u.id
                    ? <span className="text-xs text-slate-400">處理中…</span>
                    : u.role === ROLES.AREA
                      ? <button
                          onClick={() => updateApiUserRole(u.id, 'admin')}
                          className="px-2.5 py-1 text-xs bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors">
                          升級為管理員
                        </button>
                      : u.role === ROLES.ADMIN && u.username !== 'grace'
                        ? <button
                            onClick={() => updateApiUserRole(u.id, 'area')}
                            className="px-2.5 py-1 text-xs border border-slate-300 text-slate-500 rounded-lg hover:bg-slate-100 transition-colors">
                            降為日翊
                          </button>
                        : null
                  }

                  {/* 刪除帳號：grace 與自己的帳號不提供 */}
                  {u.username !== 'grace' && u.username !== currentUser.username && (
                    deletingFor === u.id
                      ? <span className="text-xs text-slate-400">刪除中…</span>
                      : confirmDelFor === u.id
                        ? <span className="flex items-center gap-1">
                            <span className="text-xs text-red-600">確定刪除？</span>
                            <button onClick={() => deleteApiUser(u)}
                              className="px-2 py-1 text-xs bg-red-600 text-white rounded-lg hover:bg-red-700">
                              確定
                            </button>
                            <button onClick={() => setConfirmDelFor(null)}
                              className="px-2 py-1 text-xs border border-slate-300 text-slate-600 rounded-lg hover:bg-slate-100">
                              取消
                            </button>
                          </span>
                        : <button onClick={() => setConfirmDelFor(u.id)}
                            title="刪除後該帳號的角色與權限一併清除；下次以 AD 登入時會重建為最低權限帳號"
                            className="px-2.5 py-1 text-xs border border-red-300 text-red-600 rounded-lg hover:bg-red-50">
                            刪除
                          </button>
                  )}
                </div>

                {/* 分頁權限（管理員全開不可調整） */}
                <div className="w-full">
                  {u.role === ROLES.ADMIN ? (
                    <span className="text-xs text-slate-400 italic">管理員擁有全部分頁權限，無法調整</span>
                  ) : (
                    <>
                      <button
                        onClick={() => setPermOpenFor(permOpenFor === u.id ? null : u.id)}
                        className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">
                        {permOpenFor === u.id ? '▲ 收合分頁權限' : '▼ 分頁權限'}
                        <span className="text-slate-400 ml-1">
                          ({(() => {
                            const eff = (u.page_perms?.length ?? 0) > 0
                              ? u.page_perms
                              : defaultStaffPageKeys(u.allowedWarehouses);
                            const isDefault = (u.page_perms?.length ?? 0) === 0;
                            return `${eff.length}/${STAFF_PAGE_OPTIONS().length}${isDefault ? '（預設）' : ''}`;
                          })()})
                        </span>
                      </button>
                      {permOpenFor === u.id && (
                        <div className="mt-2 p-3 bg-[#F5F2EC] rounded-xl border border-[#DDD9D0]">
                          <p className="text-xs text-slate-500 mb-2">
                            勾選此帳號可看到的分頁。預設為全選，但「手機控管」屬大肚倉作業，
                            非大肚倉的員工預設不勾選（仍可手動開啟）。全部不勾＝還原為預設值。
                            「系統設定」僅開放本倉可設定的項目，倉別新增／刪除等全域操作仍限管理員。
                          </p>
                          <div className="flex items-center gap-2 mb-2">
                            <button
                              onClick={() => updateApiUserPages(u.id, STAFF_PAGE_OPTIONS().map(n => n.key))}
                              disabled={savingPermFor === u.id}
                              className="px-2.5 py-1 text-xs bg-indigo-600 text-white rounded-lg
                                         hover:bg-indigo-700 disabled:opacity-50">
                              全選
                            </button>
                            <button
                              onClick={() => updateApiUserPages(u.id, [])}
                              disabled={savingPermFor === u.id}
                              className="px-2.5 py-1 text-xs border border-slate-300 text-slate-600 rounded-lg
                                         hover:bg-slate-100 disabled:opacity-50">
                              還原預設
                            </button>
                            <span className="text-xs text-slate-400">（預設＝全選，非大肚倉者不含手機控管）</span>
                          </div>
                          <div className="flex flex-wrap gap-3">
                            {STAFF_PAGE_OPTIONS().map(n => {
                              const cur = (u.page_perms?.length ?? 0) > 0
                                ? u.page_perms
                                : defaultStaffPageKeys(u.allowedWarehouses);
                              const on = cur.includes(n.key);
                              return (
                                <label key={n.key} className="flex items-center gap-1.5 cursor-pointer select-none text-sm">
                                  <input type="checkbox" checked={on}
                                    disabled={savingPermFor === u.id}
                                    onChange={() => updateApiUserPages(
                                      u.id,
                                      on ? cur.filter(k => k !== n.key) : [...cur, n.key]
                                    )}
                                    className="rounded accent-indigo-600" />
                                  <span>{n.icon} {n.label}</span>
                                </label>
                              );
                            })}
                            {savingPermFor === u.id && <span className="text-xs text-slate-400">儲存中…</span>}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'vendor' && (
        <div className="flex items-center gap-2 flex-wrap">
          <input value={vendorSearch} onChange={e => setVendorSearch(e.target.value)}
            placeholder="搜尋帳號／姓名…"
            className="border border-[#DDD9D0] rounded-lg px-3 py-1.5 text-sm w-52" />
          {vendorSearch && (
            <button onClick={() => setVendorSearch('')}
              className="px-3 py-1.5 text-xs text-slate-500 border border-[#DDD9D0] rounded-lg hover:bg-[#F5F2EC]">
              清除
            </button>
          )}
          <span className="text-xs text-slate-400">
            {selectedVendor ? `已依上方篩選「${selectedVendor}」` : '（可用上方倉別／課別／廠商一併篩選）'}
            ・共 {vendorUsers.length} 筆
          </span>
        </div>
      )}

      {(activeTab === 'vendor' || (activeTab === 'staff' && !apiUsersLoaded)) && (
      <div className="overflow-x-auto">
      <div className="min-w-[860px]">
      <div className="grid text-xs font-semibold text-slate-500 uppercase tracking-wide
                      bg-slate-100 rounded-t-xl px-4 py-2.5 border border-[#DDD9D0]"
           style={{ gridTemplateColumns: '1fr 1fr 90px 90px 160px 130px 120px' }}>
        <span>帳號</span>
        <span>姓名</span>
        <span>角色</span>
        <span>登入次數</span>
        <span>授權廠商</span>
        <span>審核狀態</span>
        <span>操作 / 權限</span>
      </div>

      <div className="border border-[#DDD9D0] rounded-b-xl divide-y divide-slate-100 overflow-hidden">
        {tabUsers.map(u => {
          const perms = u.permissions ?? getDefaultPermissions(u.role);
          const isOpen = expandedId === u.id;
          const visibleCount = PAGE_PERMISSIONS.filter(p => perms[p.key]?.view).length;

          return (
            <div key={u.id}>
              {/* ── 摘要列 ── */}
              <div className="grid items-center gap-2 px-4 py-3 hover:bg-[#F5F2EC]"
                   style={{ gridTemplateColumns: '1fr 1fr 90px 90px 160px 130px 120px' }}>

                <span className="font-mono font-bold text-slate-800 text-sm truncate">{u.username}</span>
                <span className="text-slate-600 text-sm truncate">{u.name}</span>

                <span className={`px-2 py-0.5 rounded-full text-xs font-medium w-fit ${roleBadge[u.role]}`}>
                  {roleLabel[u.role]}
                </span>

                <span className="pl-4">
                  <span className="text-teal-700 font-bold text-sm">{loginCountOf(u)}</span>
                  {lastLoginOf(u) && (
                    <span className="block text-[10px] text-slate-400 leading-tight">{lastLoginOf(u)}</span>
                  )}
                </span>

                <span className="text-slate-500 text-xs truncate">
                  {u.role === ROLES.ADMIN ? '全部廠商' : u.vendors?.join('、') || '—'}
                </span>

                <button onClick={() => toggleApproved(u)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors w-fit
                    ${u.approved !== false
                      ? 'bg-green-100 text-green-700 hover:bg-green-200'
                      : 'bg-red-100 text-red-700 hover:bg-red-200'}`}>
                  {u.approved !== false ? '✔ 已核准' : '✕ 已停用'}
                </button>

                {/* 操作按鈕 */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button onClick={() => openEdit(u)}
                    className="px-2 py-1 text-xs text-teal-700 hover:text-blue-800 hover:bg-teal-50 rounded">
                    編輯
                  </button>
                  <button onClick={() => handleDelete(u.id)}
                    className="px-2 py-1 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 rounded">
                    刪除
                  </button>
                  {resettingFor === u.username
                    ? <span className="px-2 py-1 text-xs text-slate-400">重設中…</span>
                    : resetPwdFor === u.username
                      ? <span className="flex items-center gap-1">
                          <button onClick={() => resetPassword('vendor', u.username, u.name || u.username)}
                            className="px-2 py-1 text-xs bg-amber-600 text-white rounded hover:bg-amber-700">
                            確定重設
                          </button>
                          <button onClick={() => setResetPwdFor(null)}
                            className="px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 rounded">取消</button>
                        </span>
                      : <button onClick={() => setResetPwdFor(u.username)}
                          title="還原為預設密碼（＝帳號），對方登入後須自行設定新密碼"
                          className="px-2 py-1 text-xs text-amber-700 hover:bg-amber-50 rounded">
                          重設密碼
                        </button>}
                  <button onClick={() => setExpandedId(isOpen ? null : u.id)}
                    className="px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-50 rounded flex items-center gap-0.5">
                    {isOpen ? '▲' : '▼'} 權限
                    <span className="text-indigo-300 ml-0.5">({visibleCount}/{PAGE_PERMISSIONS.length})</span>
                  </button>
                </div>
              </div>

              {/* ── 展開：細部權限 ── */}
              {isOpen && (
                <div className="bg-[#F5F2EC] border-t border-slate-200 px-6 py-4">
                  {u.role === ROLES.ADMIN
                    ? <p className="text-xs text-slate-400 italic">超級管理員擁有全部權限，無法調整。</p>
                    : <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
                        {PAGE_PERMISSIONS.map(page => {
                          const pagePerm = perms[page.key] ?? { view: false };
                          return (
                            <div key={page.key} className="bg-white rounded-xl border border-[#DDD9D0] p-3 space-y-2">
                              <label className="flex items-center gap-2 cursor-pointer select-none">
                                <input type="checkbox" checked={!!pagePerm.view}
                                  onChange={e => togglePerm(u.id, page.key, 'view', e.target.checked)}
                                  className="rounded accent-blue-600" />
                                <span className="text-sm font-semibold text-slate-700">{page.label}</span>
                                <span className="text-xs text-slate-400 ml-auto">可視</span>
                              </label>
                              {page.features.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 pl-5">
                                  {page.features.map(f => (
                                    <label key={f.key} className="flex items-center gap-1 cursor-pointer select-none">
                                      <input type="checkbox" checked={!!pagePerm[f.key]}
                                        onChange={e => togglePerm(u.id, page.key, f.key, e.target.checked)}
                                        className="rounded accent-indigo-500" />
                                      <span className={`text-xs px-1.5 py-0.5 rounded-full border
                                        ${pagePerm[f.key]
                                          ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                                          : 'bg-[#F5F2EC] text-slate-400 border-slate-200'}`}>
                                        {f.label}
                                      </span>
                                    </label>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                  }
                </div>
              )}
            </div>
          );
        })}
      </div>
      </div>
      </div>
      )}

      {/* 帳號新增 / 編輯 Modal */}
      {showModal && (
        <Modal onClose={() => setShowModal(false)}>
          <div className="bg-white rounded-xl shadow w-full max-w-md p-6">
            <h3 className="font-bold text-lg text-slate-800 mb-4">
              {editUser ? '編輯帳號' : '新增帳號'}
            </h3>
            {[
              { key: 'username', label: '帳號' },
              { key: 'password', label: '密碼', type: 'password' },
              { key: 'name',     label: '姓名' },
            ].map(f => (
              <div key={f.key} className="mb-3">
                <label className="block text-sm font-medium text-slate-700 mb-1">{f.label}</label>
                <input type={f.type ?? 'text'} value={form[f.key] ?? ''}
                  onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                  className="w-full border border-[#DDD9D0] rounded-lg px-3 py-1.5 text-sm" />
              </div>
            ))}
            <div className="mb-3">
              <label className="block text-sm font-medium text-slate-700 mb-1">角色</label>
              <select value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}
                className="w-full border border-[#DDD9D0] rounded-lg px-3 py-1.5 text-sm">
                <option value={ROLES.ADMIN}>管理員</option>
                <option value={ROLES.AREA}>日翊</option>
                <option value={ROLES.VENDOR}>委外幹部</option>
              </select>
            </div>
            {form.role !== ROLES.ADMIN && (
              <div className="mb-3">
                <label className="block text-sm font-medium text-slate-700 mb-2">授權廠商</label>
                <div className="flex flex-wrap gap-2">
                  {vendorNames.map(v => (
                    <label key={v} className="flex items-center gap-1.5 cursor-pointer text-sm">
                      <input type="checkbox" checked={form.vendors.includes(v)} onChange={() => toggleVendor(v)} className="rounded" />
                      {v}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-1">
                可使用倉別
                <span className="ml-1 font-normal text-slate-400 text-xs">（不勾選代表可使用全部倉別）</span>
              </label>
              <div className="flex flex-wrap gap-2">
                {warehouses.map(w => (
                  <label key={w.id} className="flex items-center gap-1.5 cursor-pointer text-sm">
                    <input type="checkbox"
                      checked={(form.allowedWarehouses ?? []).includes(w.id)}
                      onChange={() => toggleWarehouse(w.id)}
                      disabled={form.role === ROLES.ADMIN}
                      className="rounded accent-teal-600" />
                    <span className={form.role === ROLES.ADMIN ? 'text-slate-400' : ''}>{w.name}</span>
                  </label>
                ))}
                {form.role === ROLES.ADMIN && (
                  <span className="text-xs text-slate-400 italic">管理員可使用全部倉別</span>
                )}
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowModal(false)}
                className="px-4 py-2 border border-[#DDD9D0] rounded-lg text-sm hover:bg-[#F5F2EC]">取消</button>
              <button onClick={handleSave}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">儲存</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// APP ROOT
// ─────────────────────────────────────────────

export default function App() {
  const today = new Date();

  // ── Persistent state ──
  const [users,         setUsers]         = useState(() => {
    let saved = LS.get('sms_users', SEED_USERS);
    // 密碼分離儲存：從 sms_user_pwds 合回密碼（若存在）
    const pwds = LS.get('sms_user_pwds', {});
    saved = saved.map(u => ({
      approved: true, loginCount: 0, allowedWarehouses: [],
      permissions: getDefaultPermissions(u.role),
      ...u,
      password: pwds[u.id] ?? u.password ?? '',
    }));
    const DEMO  = { ...mkUser('u0', 'reyi',  '8963', ROLES.ADMIN, 'Demo管理員', SEED_VENDORS.map(v=>v.name), true),  mustChangePassword: true };
    const GRACE = { ...mkUser('ug', 'Grace', 'AAAaaa323390', ROLES.ADMIN, 'Grace', SEED_VENDORS.map(v=>v.name), true), mustChangePassword: false };
    if (!saved.some(u => u.username === 'reyi'))  saved = [DEMO,  ...saved];
    const graceIdx = saved.findIndex(u => u.username === 'Grace');
    if (graceIdx === -1) {
      saved = [GRACE, ...saved];
    } else {
      const existingPwd = saved[graceIdx].password;
      const isHashed = existingPwd?.startsWith('pbkdf2:') || existingPwd?.startsWith('sha256:');
      if (!isHashed) saved[graceIdx] = { ...saved[graceIdx], ...GRACE };
    }
    return saved;
  });
  // 委外人員自訂密碼：{ [empId]: 'sha256:...' }
  const [workerPwds, setWorkerPwds] = useState(() => LS.get('sms_worker_pwds', {}));
  useEffect(() => { LS.set('sms_worker_pwds', workerPwds, storageWarn); }, [workerPwds]);

  const [employees,     setEmployees]     = useState(() => LS.get('sms_employees',  SEED_EMPLOYEES));
  const [vendors,           setVendors]           = useState(() => LS.get('sms_vendors',    SEED_VENDORS));
  const [warehouses,        setWarehouses]        = useState(() => {
    const saved = LS.get('sms_warehouses', null);
    if (!saved) return SEED_WAREHOUSES;
    // v1: flat format (no departments[])
    if (!('departments' in (saved[0] ?? {}))) return SEED_WAREHOUSES;
    // v2/v3: has departments but course codes changed — detect by checking if
    //   any saved warehouse has departments whose codes don't match any SEED dept code
    const seedCodes = new Set(SEED_WAREHOUSES.flatMap(w => w.departments.map(d => d.code)));
    const savedCodes = saved.flatMap(w => (w.departments ?? []).map(d => d.code));
    const hasStale = savedCodes.length > 0 && savedCodes.some(c => !seedCodes.has(c));
    if (hasStale) return SEED_WAREHOUSES;
    // Otherwise migrate: ensure groups[] exists on every dept
    return saved.map(w => ({
      ...w,
      departments: (w.departments ?? []).map(d => ({ groups: [], ...d })),
    }));
  });
  const [selectedWarehouse, setSelectedWarehouse] = useState(() => LS.get('sms_sel_wh',     null));
  const [selectedDept,      setSelectedDept]      = useState(() => LS.get('sms_sel_dept',   null));
  const [selectedGroup,     setSelectedGroup]     = useState(() => LS.get('sms_sel_grp',    null));
  const [selectedWorkArea,  setSelectedWorkArea]  = useState(() => LS.get('sms_sel_area',   null));
  // 作業區清單（可於系統設定增修）；人員的 workArea 欄位對應其中一項，空字串＝未設定
  const [workAreas,         setWorkAreas]         = useState(() => LS.get('sms_work_areas', SEED_WORK_AREAS));
  const [selectedVendor,    setSelectedVendor]    = useState(() => LS.get('sms_sel_vendor', null));
  const [systemLocked,  setSystemLocked]  = useState(() => LS.get('sms_locked',     false));
  // 各課別鎖定狀態 { 課別名稱: 'none'|'partial'|'full' }：各課排班完成時間不同，需分別鎖定
  const [deptLocks, setDeptLocks] = useState(() => LS.get('sms_dept_locks', {}));
  // 每期日期區間：定義「一期」涵蓋哪些日子，決定班表顯示的天數、出勤／休假天統計
  // 與週期翻頁單位。與「各課開放排班區間」互相獨立——前者是排班週期，後者是可編輯的時段。
  const [periodRange, setPeriodRange] = useState(() => LS.get('sms_period_range', {}));

  // 各課別開放排班區間 { 課別名稱: {start,end} }；未設定＝該課尚未開放，不可排班。
  // 全域 scheduleRange 已停用（保留欄位以相容舊資料，不再影響任何判斷）
  const [deptRanges, setDeptRanges] = useState(() => LS.get('sms_dept_ranges', {}));
  // 多段區間（每段自帶鎖定模式與適用組別）；空值時沿用上面的單一區間
  const [deptSegments, setDeptSegments] = useState(() => LS.get('sms_dept_segments', {}));
  // 每日需求人數：key 為「課別|組別|日期」，各課各組分別記錄
  const [dailyDemand, setDailyDemand] = useState(() => LS.get('sms_daily_demand', {}));
  // 快速解鎖密碼（雜湊後儲存）；供日翊在課別鎖定或區間外時臨時開啟編輯
  const [unlockPwd, setUnlockPwd] = useState(() => LS.get('sms_unlock_pwd', ''));
  // 手機控管櫃號 { 員工id: {cab,slot} }：固定綁定人員，不隨每日出勤變動
  const [lockerAssign, setLockerAssign] = useState(() => LS.get('sms_locker_assign', {}));
  const [scheduleRange, setScheduleRange] = useState(() => LS.get('sms_range',      {}));
  const [openHolidays,       setOpenHolidays]       = useState(() => LS.get('sms_open_holidays', []));
  const [vendorHolidayOpen,  setVendorHolidayOpen]  = useState(() => LS.get('sms_vendor_hol_open', false));
  const [vendorRestOpen,     setVendorRestOpen]     = useState(() => LS.get('sms_vendor_rest_open', false));
  const [workerRestOpen,     setWorkerRestOpen]     = useState(() => LS.get('sms_worker_rest_open', false));
  const [vendorCompanyNames, setVendorCompanyNames] = useState(() => LS.get('sms_vendor_company_names', VENDOR_COMPANY_NAMES));
  const [selectedYear,  setSelectedYear]  = useState(() => LS.get('sms_year',       today.getFullYear()));
  const [selectedMonth, setSelectedMonth] = useState(() => LS.get('sms_month',      today.getMonth() + 1));
  const [attendData, setAttendData] = useState(() => LS.get('sms_attendance', {}));
  const [extras,     setExtras]     = useState(() => LS.get('sms_attend_extras', {}));
  const [attendSettings, setAttendSettings] = useState(() => LS.get('sms_attend_settings', DEFAULT_ATTEND_SETTINGS));

  const [schedule, setSchedule] = useState(() => {
    const saved = LS.get('sms_schedule', null);
    if (saved) {
      // 遷移舊資料：若 key 為純數字則補上年月
      const savedYear  = LS.get('sms_year',  today.getFullYear());
      const savedMonth = LS.get('sms_month', today.getMonth() + 1);
      const migrated = {};
      Object.entries(saved).forEach(([empId, days]) => {
        migrated[empId] = {};
        Object.entries(days).forEach(([k, v]) => {
          if (/^\d{1,2}$/.test(k)) {
            migrated[empId][dateKey(savedYear, savedMonth, Number(k))] = v;
          } else {
            migrated[empId][k] = v;
          }
        });
      });
      return migrated;
    }
    return buildDefaultSchedule(SEED_EMPLOYEES, today.getFullYear(), today.getMonth() + 1);
  });

  // ── 班表「本機實際改過的格子」追蹤 ───────────────────────────────
  // 背景：所有人共用同一份班表，過去每次存檔都送出整份 schedule 快照。
  // 伺服器逐格合併時以送出的值為準，於是 A 的舊快照會把 B 剛改好的格子蓋回舊值
  //（例：委外幹部排好「休」，日翊端 30 秒內的自動存檔又把它改回「V」）。
  // 作法：記錄本機真正改過哪些格子，存檔只送這些格子；套用伺服器資料時不計入，
  // 並把尚未存檔的本機異動疊回去，避免背景同步把自己剛改的內容洗掉。
  const scheduleRef      = useRef(schedule);
  scheduleRef.current    = schedule;
  // 未存檔清單同時寫入 localStorage：本機班表本來就會存在 localStorage，
  // 若清單只放在記憶體，使用者改完 2 秒內關掉分頁，重開後畫面看得到改動卻永遠不會上傳，
  // 還會被背景同步洗掉。兩者一起持久化才不會出現「看得到卻沒存到」的落差。
  // 但這份清單必須有時效。存檔若一直失敗（網路不穩、伺服器忙），格子會永遠留著，
  // 而且每次收到伺服器資料時都用本機舊值蓋過去，隔天再推回伺服器 ——
  // 症狀是「昨天調好的班表，今天又變回調整前的樣子」。
  // 超過 10 分鐘的未存檔紀錄一律放棄，改以伺服器為準（舊格式無時間戳，一併放棄）。
  const DIRTY_TTL_MS = 10 * 60 * 1000;
  const dirtyAtRef = useRef(new Map());
  const dirtyCellsRef = useRef((() => {
    const raw = LS.get('sms_dirty_cells', {});
    const now = Date.now();
    const keep = new Set();
    if (raw && !Array.isArray(raw)) {
      for (const [k, ts] of Object.entries(raw)) {
        if (typeof ts === 'number' && now - ts < DIRTY_TTL_MS) { keep.add(k); dirtyAtRef.current.set(k, ts); }
      }
    }
    return keep;
  })());
  const persistDirty = () => {
    const now = Date.now();
    const out = {};
    for (const k of dirtyCellsRef.current) {
      if (!dirtyAtRef.current.has(k)) dirtyAtRef.current.set(k, now);
      out[k] = dirtyAtRef.current.get(k);
    }
    for (const k of [...dirtyAtRef.current.keys()]) if (!dirtyCellsRef.current.has(k)) dirtyAtRef.current.delete(k);
    LS.set('sms_dirty_cells', out);
  };
  const applyingRemoteRef = useRef(false);
  const cellKey = (empId, dk) => empId + CELL_SEP + dk;

  const markScheduleDiff = (prev, next) => {
    const dirty = dirtyCellsRef.current;
    for (const [empId, days] of Object.entries(next ?? {})) {
      const before = prev?.[empId] ?? {};
      for (const [dk, v] of Object.entries(days ?? {}))
        if (before[dk] !== v) dirty.add(cellKey(empId, dk));
    }
    for (const [empId, days] of Object.entries(prev ?? {})) {
      const after = next?.[empId];
      for (const dk of Object.keys(days ?? {}))
        if (!after || !(dk in after)) dirty.add(cellKey(empId, dk));
    }
  };

  /** 對外的 setSchedule：自動記錄被改動的格子 */
  const setScheduleTracked = useCallback((arg) => {
    setSchedule(prev => {
      const next = typeof arg === 'function' ? arg(prev) : arg;
      if (!applyingRemoteRef.current) { markScheduleDiff(prev, next); persistDirty(); }
      return next;
    });
  }, []);

  /** 套用伺服器班表：不記為本機異動，並保留尚未存檔的本機改動 */
  const applyRemoteSchedule = useCallback((remote) => {
    if (!remote || Object.keys(remote).length === 0) return;
    applyingRemoteRef.current = true;
    try {
      const merged = {};
      for (const [empId, days] of Object.entries(remote)) merged[empId] = { ...days };
      const now = Date.now();
      for (const key of [...dirtyCellsRef.current]) {
        // 過期的未存檔紀錄不再覆蓋伺服器值，否則會變成每天把舊值推回去
        const ts = dirtyAtRef.current.get(key);
        if (ts && now - ts >= DIRTY_TTL_MS) { dirtyCellsRef.current.delete(key); dirtyAtRef.current.delete(key); continue; }
        const [empId, dk] = key.split(CELL_SEP);
        const localVal = scheduleRef.current?.[empId]?.[dk];
        if (localVal === undefined) continue;
        (merged[empId] ??= {})[dk] = localVal;
      }
      setSchedule(merged);
    } finally {
      applyingRemoteRef.current = false;
    }
  }, []);

  // ── Session state ──
  const [currentUser,  setCurrentUser]  = useState(null);
  const [currentPage,  setCurrentPage]  = useState('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen,    setMobileNavOpen]    = useState(false);

  // ── 班別設定（跨裝置同步，存入 server） ──
  const [shiftTypesByWh, setShiftTypesByWh] = useState(() => {
    const map = {};
    Object.keys(localStorage)
      .filter(k => k === 'sms_shift_types' || k.startsWith('sms_shift_types_'))
      .forEach(k => {
        const wk = k === 'sms_shift_types' ? 'default' : k.replace('sms_shift_types_', '');
        try { map[wk] = JSON.parse(localStorage.getItem(k)); } catch {}
      });
    return map;
  });
  const [shiftCodeRows,    setShiftCodeRows]    = useState(() => LS.get('sms_shiftcode_rows',    SHIFT_CODE_ROWS));
  const [shiftCodeHeaders, setShiftCodeHeaders] = useState(() => LS.get('sms_shiftcode_headers', SHIFT_CODE_HEADERS));

  // ── Server-sync ──
  const serverSyncedRef = useRef(false);
  const saveDebouncerRef = useRef(null);
  // 本地有尚未寫回伺服器的變更。背景輪詢期間若整份覆蓋 schedule 等狀態，
  // 會把還在 debounce 中的匯入結果洗掉（匯入 → 輪詢取回舊資料覆蓋 → 存回舊資料）。
  const dirtyRef = useRef(false);
  const forceSaveRef = useRef(false); // 匯入等重要操作後設 true，下次 effect 立即存

  const loadServerState = useCallback(async (token, roleOverride) => {
    // 將本地 localStorage 全部狀態寫回 DB（用於本地資料比 DB 新的情況）
    const writeLocalToServer = () => {
      const localShiftTypesByWh = {};
      Object.keys(localStorage)
        .filter(k => k === 'sms_shift_types' || k.startsWith('sms_shift_types_'))
        .forEach(k => {
          const wk = k === 'sms_shift_types' ? 'default' : k.replace('sms_shift_types_', '');
          try { localShiftTypesByWh[wk] = JSON.parse(localStorage.getItem(k)); } catch {}
        });
      serverSyncedRef.current = true;
      fetch('/api/state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          employees:          LS.get('sms_employees', []),
          vendors:            LS.get('sms_vendors', []),
          warehouses:         LS.get('sms_warehouses', []),
          schedule:           LS.get('sms_schedule', {}),
          systemLocked:       LS.get('sms_locked', false),
          deptLocks:          LS.get('sms_dept_locks', {}),
          deptRanges:         LS.get('sms_dept_ranges', {}),
          deptSegments:       LS.get('sms_dept_segments', {}),
          dailyDemand:        LS.get('sms_daily_demand', {}),
          unlockPwd:          LS.get('sms_unlock_pwd', ''),
          workAreas:          LS.get('sms_work_areas', SEED_WORK_AREAS),
          periodRange:        LS.get('sms_period_range', {}),
          lockerAssign:       LS.get('sms_locker_assign', {}),
          scheduleRange:      LS.get('sms_range', {}),
          openHolidays:       LS.get('sms_open_holidays', []),
          vendorHolidayOpen:  LS.get('sms_vendor_hol_open', false),
          vendorRestOpen:     LS.get('sms_vendor_rest_open', false),
          workerRestOpen:     LS.get('sms_worker_rest_open', false),
          vendorCompanyNames: LS.get('sms_vendor_company_names', {}),
          attendData:         LS.get('sms_attendance', {}),
          extras:             LS.get('sms_attend_extras', {}),
          shiftTypesByWh:     localShiftTypesByWh,
          shiftCodeRows:      LS.get('sms_shiftcode_rows', []),
          shiftCodeHeaders:   LS.get('sms_shiftcode_headers', []),
          users: (() => {
            const saved = LS.get('sms_users', []);
            const pwds  = LS.get('sms_user_pwds', {});
            return saved.map(u => ({ ...u, password: pwds[u.id] ?? u.password ?? '' }));
          })(),
          workerPwds:         LS.get('sms_worker_pwds', {}),
        }),
      }).catch(e => console.warn('本地回寫失敗:', e.message));
    };

    try {
      // 角色須由呼叫端傳入：登入當下 setCurrentUser 尚未生效，且本 callback 的 deps
      // 皆為穩定 setter，會永久捕捉到初次渲染時的 currentUser（null），
      // 導致 vendor/worker 一律走到 admin 分支打 GET /api/state 被 403，讀不到任何資料
      const role = roleOverride ?? currentUser?.role;
      const isVendor = role === ROLES.VENDOR;
      const isWorker = role === ROLES.WORKER;

      if (isWorker) {
        // worker 讀取班表（GET /api/schedule）+ 自己的出勤/手機控管紀錄（GET /api/attendance，後端已限縮為本人）
        const [r, ra] = await Promise.all([
          fetch('/api/schedule',   { headers: { Authorization: `Bearer ${token}` } }),
          fetch('/api/attendance', { headers: { Authorization: `Bearer ${token}` } }),
        ]);
        if (r.ok) {
          const s = await r.json();
          if (Array.isArray(s.employees) && s.employees.length > 0) setEmployees(s.employees);
          if (s.vendors?.length > 0)    setVendors(s.vendors);
          if (s.warehouses?.length > 0) setWarehouses(s.warehouses);
          applyRemoteSchedule(s.schedule);
          if (s.scheduleRange)           setScheduleRange(s.scheduleRange);
          if (s.openHolidays)            setOpenHolidays(s.openHolidays);
          if (s.systemLocked != null)    setSystemLocked(s.systemLocked);
          if (s.deptLocks)               setDeptLocks(s.deptLocks);
          if (s.deptRanges)              setDeptRanges(s.deptRanges);
          if (s.deptSegments) setDeptSegments(s.deptSegments);
          if (s.dailyDemand) setDailyDemand(s.dailyDemand);
          if (s.unlockPwd !== undefined) setUnlockPwd(s.unlockPwd);
              if (s.periodRange)             setPeriodRange(s.periodRange);
              if (s.workAreas?.length > 0)   setWorkAreas(s.workAreas);
              if (s.lockerAssign)            setLockerAssign(s.lockerAssign);
          if (s.vendorHolidayOpen != null) setVendorHolidayOpen(s.vendorHolidayOpen);
          if (s.vendorRestOpen != null) setVendorRestOpen(s.vendorRestOpen);
          if (s.workerRestOpen != null) setWorkerRestOpen(s.workerRestOpen);
          if (s.shiftCodeRows?.length > 0)     setShiftCodeRows(s.shiftCodeRows);
          if (s.shiftCodeHeaders?.length > 0)  setShiftCodeHeaders(s.shiftCodeHeaders);
        }
        if (ra.ok) {
          const att = await ra.json();
          if (att?.attendData && Object.keys(att.attendData).length > 0) setAttendData(att.attendData);
        }
        // worker 可自助簽到/手機控管（PUT /api/attendance，後端已限縮只能寫自己），啟用 auto-save
        serverSyncedRef.current = true;
      } else if (isVendor) {
        // vendor 讀取班表 + 出勤資料，不寫入 /api/state
        const [rs, ra] = await Promise.all([
          fetch('/api/schedule',   { headers: { Authorization: `Bearer ${token}` } }),
          fetch('/api/attendance', { headers: { Authorization: `Bearer ${token}` } }),
        ]);
        if (rs.ok) {
          const s = await rs.json();
          if (Array.isArray(s.employees) && s.employees.length > 0) setEmployees(s.employees);
          if (s.vendors?.length > 0)    setVendors(s.vendors);
          if (s.warehouses?.length > 0) setWarehouses(s.warehouses);
          applyRemoteSchedule(s.schedule);
          if (s.scheduleRange)           setScheduleRange(s.scheduleRange);
          if (s.openHolidays)            setOpenHolidays(s.openHolidays);
          if (s.systemLocked != null)    setSystemLocked(s.systemLocked);
          if (s.deptLocks)               setDeptLocks(s.deptLocks);
          if (s.deptRanges)              setDeptRanges(s.deptRanges);
          if (s.deptSegments) setDeptSegments(s.deptSegments);
          if (s.dailyDemand) setDailyDemand(s.dailyDemand);
          if (s.unlockPwd !== undefined) setUnlockPwd(s.unlockPwd);
              if (s.periodRange)             setPeriodRange(s.periodRange);
              if (s.workAreas?.length > 0)   setWorkAreas(s.workAreas);
              if (s.lockerAssign)            setLockerAssign(s.lockerAssign);
          if (s.vendorHolidayOpen != null) setVendorHolidayOpen(s.vendorHolidayOpen);
          if (s.vendorRestOpen != null) setVendorRestOpen(s.vendorRestOpen);
          if (s.workerRestOpen != null) setWorkerRestOpen(s.workerRestOpen);
          if (s.shiftCodeRows?.length > 0)     setShiftCodeRows(s.shiftCodeRows);
          if (s.shiftCodeHeaders?.length > 0)  setShiftCodeHeaders(s.shiftCodeHeaders);
        }
        if (ra.ok) {
          const att = await ra.json();
          if (att?.attendData && Object.keys(att.attendData).length > 0) setAttendData(att.attendData);
          if (att?.extras    && Object.keys(att.extras).length > 0)    setExtras(att.extras);
        }
        // vendor auto-save 只涉及 /api/attendance，允許啟用
        serverSyncedRef.current = true;
      } else {
        const r = await fetch('/api/state', { headers: { Authorization: `Bearer ${token}` } });
        // HTTP 失敗（503 等）：不啟用 auto-save，避免種子/空資料覆蓋 DB
        if (!r.ok) { console.warn('loadServerState: HTTP', r.status); return; }
        const state = await r.json();
        // server 回傳 null 代表 DB 尚未初始化，不啟用 auto-save
        if (!state) return;

        const serverEmps = Array.isArray(state?.employees) ? state.employees : [];
        const localEmps  = LS.get('sms_employees', []);

        // 出勤、班表、共用設定：一律以 DB 為準（多人協作資料來源唯一）
        if (serverEmps.length > 0)              setEmployees(serverEmps);
        if (state?.vendors?.length > 0)                setVendors(state.vendors);
        if (state?.warehouses?.length > 0)             setWarehouses(state.warehouses);
        applyRemoteSchedule(state?.schedule);
        if (state?.systemLocked   != null) setSystemLocked(state.systemLocked);
        if (state?.deptLocks)              setDeptLocks(state.deptLocks);
        if (state?.deptRanges)             setDeptRanges(state.deptRanges);
        if (state?.deptSegments)           setDeptSegments(state.deptSegments);
        if (state?.dailyDemand)            setDailyDemand(state.dailyDemand);
        if (state?.unlockPwd !== undefined) setUnlockPwd(state.unlockPwd);
        if (state?.periodRange)            setPeriodRange(state.periodRange);
        if (state?.workAreas?.length > 0)  setWorkAreas(state.workAreas);
        if (state?.lockerAssign)           setLockerAssign(state.lockerAssign);
        if (state?.scheduleRange)          setScheduleRange(state.scheduleRange);
        if (state?.openHolidays)           setOpenHolidays(state.openHolidays);
        if (state?.vendorHolidayOpen != null) setVendorHolidayOpen(state.vendorHolidayOpen);
        if (state?.vendorRestOpen != null)    setVendorRestOpen(state.vendorRestOpen);
        if (state?.workerRestOpen != null)    setWorkerRestOpen(state.workerRestOpen);
        if (state?.vendorCompanyNames)     setVendorCompanyNames(state.vendorCompanyNames);
        if (state?.attendData && Object.keys(state.attendData).length > 0) setAttendData(prev => {
          const merged = { ...prev };
          for (const [date, dayMap] of Object.entries(state.attendData)) {
            if (Object.keys(dayMap).length > 0)
              merged[date] = { ...(prev[date] ?? {}), ...dayMap };
          }
          return merged;
        });
        if (state?.extras && Object.keys(state.extras).length > 0) setExtras(prev => {
          const merged = { ...prev };
          for (const [date, list] of Object.entries(state.extras)) {
            if (list?.length > 0) merged[date] = list;
          }
          return merged;
        });
        if (state?.shiftTypesByWh && Object.keys(state.shiftTypesByWh).length > 0) setShiftTypesByWh(state.shiftTypesByWh);
        if (state?.shiftCodeRows?.length > 0)          setShiftCodeRows(state.shiftCodeRows);
        if (state?.shiftCodeHeaders?.length > 0)       setShiftCodeHeaders(state.shiftCodeHeaders);
        if (state?.attendSettings)                     setAttendSettings(state.attendSettings);
        if (Array.isArray(state?.users) && state.users.length > 0) setUsers(state.users);
        if (state?.workerPwds && Object.keys(state.workerPwds).length > 0) setWorkerPwds(state.workerPwds);

        // 本地員工數多於 DB 且 DB 有基本資料（vendors/warehouses 存在）→ 可能有尚未入庫的匯入資料，回寫 DB
        const dbHasBaseData = (state?.vendors?.length > 0) || (state?.warehouses?.length > 0);
        if (dbHasBaseData && localEmps.length > serverEmps.length) writeLocalToServer();
        // DB 無員工且本地有員工 → 寫回 DB（但 DB 必須已有 vendors/warehouses，否則本地資料不完整不寫回）
        else if (dbHasBaseData && serverEmps.length === 0 && localEmps.length > 0) writeLocalToServer();
        // 成功讀取 DB 狀態後才啟用 auto-save
        else serverSyncedRef.current = true;
      }
    } catch (e) {
      // 例外（網路中斷等）：不啟用 auto-save
      console.warn('無法從伺服器載入狀態:', e.message);
    }
  }, [setEmployees, setVendors, setWarehouses, setSchedule, setSystemLocked,
      setScheduleRange, setOpenHolidays, setVendorHolidayOpen, setVendorCompanyNames,
      setAttendData, setExtras, setShiftTypesByWh, setShiftCodeRows, setShiftCodeHeaders, setAttendSettings, setUsers, setWorkerPwds]);

  // ── 背景同步核心（visibilitychange & 定期輪詢共用）──
  const syncFromServerBackground = useCallback(() => {
    if (!serverSyncedRef.current) return;
    const token = localStorage.getItem(JWT_KEY);
    if (!token) return;
    const role = currentUser?.role;
    const applySchedule = s => {
      if (!s) return;
      // 本地仍有未寫回伺服器的變更（例如剛匯入班表、還在 2 秒 debounce 內）時，
      // 一律不套用伺服器版本，否則會用舊資料蓋掉尚未存檔的內容並在下一次存檔寫回。
      if (dirtyRef.current) return;
      if (Array.isArray(s.employees) && s.employees.length > 0) setEmployees(s.employees);
      if (s.vendors?.length > 0)    setVendors(s.vendors);
      if (s.warehouses?.length > 0) setWarehouses(s.warehouses);
      applyRemoteSchedule(s.schedule);
      if (s.scheduleRange)           setScheduleRange(s.scheduleRange);
      if (s.openHolidays)            setOpenHolidays(s.openHolidays);
      if (s.systemLocked != null)    setSystemLocked(s.systemLocked);
      if (s.deptLocks)               setDeptLocks(s.deptLocks);
      if (s.deptRanges)              setDeptRanges(s.deptRanges);
      if (s.deptSegments) setDeptSegments(s.deptSegments);
      if (s.dailyDemand) setDailyDemand(s.dailyDemand);
      if (s.unlockPwd !== undefined) setUnlockPwd(s.unlockPwd);
              if (s.periodRange)             setPeriodRange(s.periodRange);
              if (s.workAreas?.length > 0)   setWorkAreas(s.workAreas);
              if (s.lockerAssign)            setLockerAssign(s.lockerAssign);
      if (s.vendorHolidayOpen != null) setVendorHolidayOpen(s.vendorHolidayOpen);
      if (s.vendorRestOpen != null) setVendorRestOpen(s.vendorRestOpen);
      if (s.workerRestOpen != null) setWorkerRestOpen(s.workerRestOpen);
      if (s.shiftCodeRows?.length > 0)     setShiftCodeRows(s.shiftCodeRows);
      if (s.shiftCodeHeaders?.length > 0)  setShiftCodeHeaders(s.shiftCodeHeaders);
      if (s.attendSettings)                setAttendSettings(s.attendSettings);
    };
    if (role === ROLES.WORKER) {
      fetch('/api/schedule', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : null).then(applySchedule).catch(() => {});
      fetch('/api/attendance', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : null)
        .then(att => {
          if (!att) return;
          // merge：本地未存的舊日期從 server 補齊，本地有的（可能含未存的今日勾選）不被覆蓋
          if (att.attendData && Object.keys(att.attendData).length > 0)
            setAttendData(prev => ({ ...att.attendData, ...prev }));
        }).catch(() => {});
    } else if (role === ROLES.VENDOR) {
      fetch('/api/schedule',   { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : null).then(applySchedule).catch(() => {});
      fetch('/api/attendance', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : null)
        .then(att => {
          if (!att) return;
          // merge：本地未存的舊日期從 server 補齊，本地有的（可能含未存的今日勾選）不被覆蓋
          if (att.attendData && Object.keys(att.attendData).length > 0)
            setAttendData(prev => ({ ...att.attendData, ...prev }));
          if (att.extras    && Object.keys(att.extras).length > 0)
            setExtras(prev => ({ ...att.extras, ...prev }));
        }).catch(() => {});
    } else {
      fetch('/api/state', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : null)
        .then(state => {
          if (!state) return;
          applySchedule(state);
          // 本地已有的出勤勾選優先（避免前景切換觸發的同步覆蓋尚未存檔的勾選）
          if (state.attendData && Object.keys(state.attendData).length > 0)
            setAttendData(prev => {
              const merged = { ...prev };
              for (const [date, dayMap] of Object.entries(state.attendData)) {
                if (Object.keys(dayMap).length > 0)
                  merged[date] = { ...dayMap, ...(prev[date] ?? {}) };
              }
              return merged;
            });
          if (state.extras && Object.keys(state.extras).length > 0)
            setExtras(prev => ({ ...state.extras, ...prev }));
          if (state.vendorCompanyNames) setVendorCompanyNames(state.vendorCompanyNames);
          if (state.shiftTypesByWh && Object.keys(state.shiftTypesByWh).length > 0) setShiftTypesByWh(state.shiftTypesByWh);
          if (Array.isArray(state.users) && state.users.length > 0) setUsers(state.users);
          if (state.workerPwds && Object.keys(state.workerPwds).length > 0) setWorkerPwds(state.workerPwds);
        }).catch(() => {});
    }
  }, [currentUser, setEmployees, setVendors, setWarehouses, setSchedule, setSystemLocked,
      setScheduleRange, setOpenHolidays, setVendorHolidayOpen, setVendorCompanyNames,
      setAttendData, setExtras, setShiftTypesByWh, setShiftCodeRows, setShiftCodeHeaders, setUsers, setWorkerPwds]);

  // ── 切回前景自動同步 ──
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      syncFromServerBackground();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [syncFromServerBackground]);

  // ── 定期背景輪詢（30 秒）：確保長時間停留在同一分頁也能同步其他裝置的變更 ──
  useEffect(() => {
    if (!currentUser) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') syncFromServerBackground();
    }, 30000);
    return () => clearInterval(id);
  }, [currentUser, syncFromServerBackground]);

  // ── Persist to localStorage ──
  const storageWarn = useCallback(() => {
    // 避免重複 toast（每分鐘最多一次）
    const last = sessionStorage.getItem('_quota_warn');
    if (!last || Date.now() - Number(last) > 60000) {
      sessionStorage.setItem('_quota_warn', String(Date.now()));
      // 直接 alert，因為 toast 依賴 context 可能在此時不可用
      alert('⚠️ 瀏覽器儲存空間已滿，部分資料可能未儲存！\n請聯繫管理員或清除舊資料。');
    }
  }, []);
  useEffect(() => {
    // 密碼不存入 sms_users，改存 sms_user_pwds（獨立 key）
    const sanitized = users.map(({ password, ...u }) => u);
    const pwds = Object.fromEntries(users.filter(u => u.password).map(u => [u.id, u.password]));
    LS.set('sms_users',     sanitized, storageWarn);
    LS.set('sms_user_pwds', pwds,      storageWarn);
  }, [users]);
  useEffect(() => { LS.set('sms_employees',  employees,     storageWarn); }, [employees]);
  useEffect(() => { LS.set('sms_vendors',    vendors);            }, [vendors]);
  useEffect(() => { LS.set('sms_warehouses', warehouses);         }, [warehouses]);
  useEffect(() => { LS.set('sms_sel_wh',    selectedWarehouse);   }, [selectedWarehouse]);
  useEffect(() => { LS.set('sms_sel_dept',  selectedDept);        }, [selectedDept]);
  useEffect(() => { LS.set('sms_sel_grp',   selectedGroup);       }, [selectedGroup]);
  useEffect(() => { LS.set('sms_sel_area',  selectedWorkArea);    }, [selectedWorkArea]);
  useEffect(() => { LS.set('sms_work_areas', workAreas);          }, [workAreas]);
  useEffect(() => { LS.set('sms_schedule',   schedule,      storageWarn); }, [schedule]);
  useEffect(() => { LS.set('sms_locked',         systemLocked);  }, [systemLocked]);
  useEffect(() => { LS.set('sms_dept_locks',     deptLocks);     }, [deptLocks]);
  useEffect(() => { LS.set('sms_dept_ranges',    deptRanges);    }, [deptRanges]);
  useEffect(() => { LS.set('sms_dept_segments',  deptSegments);  }, [deptSegments]);
  useEffect(() => { LS.set('sms_daily_demand',   dailyDemand);   }, [dailyDemand]);
  useEffect(() => { LS.set('sms_unlock_pwd',    unlockPwd);     }, [unlockPwd]);
  useEffect(() => { LS.set('sms_period_range',   periodRange);   }, [periodRange]);
  useEffect(() => { LS.set('sms_locker_assign',  lockerAssign);  }, [lockerAssign]);
  useEffect(() => { LS.set('sms_range',          scheduleRange); }, [scheduleRange]);
  useEffect(() => { LS.set('sms_open_holidays',       openHolidays);      }, [openHolidays]);
  useEffect(() => { LS.set('sms_vendor_hol_open',    vendorHolidayOpen); }, [vendorHolidayOpen]);
  useEffect(() => { LS.set('sms_vendor_rest_open',   vendorRestOpen);    }, [vendorRestOpen]);
  useEffect(() => { LS.set('sms_worker_rest_open',   workerRestOpen);    }, [workerRestOpen]);
  useEffect(() => { LS.set('sms_year',      selectedYear);  }, [selectedYear]);
  useEffect(() => { LS.set('sms_month',     selectedMonth); }, [selectedMonth]);
  useEffect(() => { LS.set('sms_attendance',    attendData); }, [attendData]);
  useEffect(() => { LS.set('sms_attend_extras', extras);    }, [extras]);
  useEffect(() => { LS.set('sms_shiftcode_rows',    shiftCodeRows);    }, [shiftCodeRows]);
  useEffect(() => { LS.set('sms_shiftcode_headers', shiftCodeHeaders); }, [shiftCodeHeaders]);
  useEffect(() => { LS.set('sms_attend_settings',   attendSettings);   }, [attendSettings]);
  useEffect(() => {
    Object.entries(shiftTypesByWh).forEach(([wk, types]) => {
      const key = wk === 'default' ? 'sms_shift_types' : `sms_shift_types_${wk}`;
      try { localStorage.setItem(key, JSON.stringify(types)); } catch {}
    });
  }, [shiftTypesByWh]);

  const triggerForceSave = useCallback(() => { forceSaveRef.current = true; }, []);

  // 永遠指向最新狀態的 ref（每次 render 同步更新，供 saveNow 讀取）
  const latestStateRef = useRef({});
  latestStateRef.current = {
    employees, vendors, warehouses, schedule, systemLocked, deptLocks, deptRanges, deptSegments, dailyDemand, unlockPwd, periodRange, workAreas, lockerAssign,
    scheduleRange, openHolidays, vendorHolidayOpen, vendorRestOpen, workerRestOpen, vendorCompanyNames,
    attendData, extras, shiftTypesByWh, shiftCodeRows, shiftCodeHeaders, attendSettings,
    users, workerPwds,
  };

  // ── 手動立即存檔（讀 latestStateRef，無 stale closure 問題） ──
  const saveNow = useCallback((onDone) => {
    if (!serverSyncedRef.current) return;
    const token = localStorage.getItem(JWT_KEY);
    if (!token) return;
    if (saveDebouncerRef.current) clearTimeout(saveDebouncerRef.current);
    // 與自動存檔一致：班表只送本機改過的格子
    const sentCells = [...dirtyCellsRef.current];
    fetch('/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify((() => {
        const { schedule: _full, ...rest } = latestStateRef.current;
        const d = buildDirtySchedule(sentCells, scheduleRef.current);
        return Object.keys(d).length > 0 ? { ...rest, schedule: d } : rest;
      })()),
    }).then(async r => {
      if (r.ok) { sentCells.forEach(k => dirtyCellsRef.current.delete(k)); persistDirty(); }
      if (onDone) onDone(r.ok);
      if (!r.ok) return;
      // 與自動存檔一致：伺服器擋下的格子要出聲，否則會變成「按了沒反應也沒錯誤」
      const j = await r.json().catch(() => null);
      if (j?.skipped > 0)
        globalToast?.(`有 ${j.skipped} 位人員的班表未儲存（權限或廠商歸屬不符）`, 'error');
      if (j?.locked > 0) {
        globalToast?.('該課別已鎖定或不在開放排班區間，剛才的異動未儲存。', 'error');
        syncFromServerBackground();
      }
    }).catch(e => { console.warn('手動存檔失敗:', e.message); if (onDone) onDone(false); });
  }, []); // 不需任何 deps，永遠讀最新 ref

  // ── 同步共用狀態至後端（debounced 2s，登入後才生效） ──
  useEffect(() => {
    if (!serverSyncedRef.current) return;
    const token = localStorage.getItem(JWT_KEY);
    if (!token) return;
    if (saveDebouncerRef.current) clearTimeout(saveDebouncerRef.current);
    // 班表只送本機真正改過的格子，避免舊快照覆蓋他人剛存的異動
    const sentCells = [...dirtyCellsRef.current];
    // 沒有異動時不帶 schedule（送 {} 會被伺服器的 jsonb 合併當成「清空整份班表」）
    const dirtySchedule = buildDirtySchedule(sentCells, scheduleRef.current);
    const clearSent = () => { sentCells.forEach(k => dirtyCellsRef.current.delete(k)); persistDirty(); };
    const body = JSON.stringify({
      employees, vendors, warehouses, systemLocked, deptLocks, deptRanges, deptSegments, dailyDemand, unlockPwd, periodRange, workAreas, lockerAssign,
      scheduleRange, openHolidays, vendorHolidayOpen, vendorRestOpen, workerRestOpen, vendorCompanyNames,
      attendData, extras, shiftTypesByWh, shiftCodeRows, shiftCodeHeaders, attendSettings,
      users, workerPwds,
      ...(Object.keys(dirtySchedule).length > 0 ? { schedule: dirtySchedule } : {}),
    });
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    dirtyRef.current = true;
    const done = ok => { if (ok) { dirtyRef.current = false; clearSent(); } };
    if (forceSaveRef.current) {
      // 匯入等重要操作後立即存，不經 setTimeout（避免關頁前 callback 被取消）
      forceSaveRef.current = false;
      fetch('/api/state', { method: 'PUT', headers, body })
        .then(r => { done(r.ok); if (!r.ok) console.warn('匯入後立即存檔失敗 HTTP', r.status); })
        .catch(e => console.warn('匯入後立即存檔失敗:', e.message));
      return;
    }
    saveDebouncerRef.current = setTimeout(() => {
      fetch('/api/state', { method: 'PUT', headers, body })
        .then(async r => {
          done(r.ok);
          if (!r.ok) { console.warn('自動存檔失敗 HTTP', r.status); return; }
          // 伺服器因權限／廠商歸屬過濾掉部分人員時要出聲，不能靜靜地當作存檔成功
          const j = await r.json().catch(() => null);
          if (j?.skipped > 0)
            globalToast?.(`有 ${j.skipped} 位人員的班表未儲存（權限或廠商歸屬不符）`, 'error');
          // 課別在本機畫面開著的期間被改為鎖定／區間關閉時，伺服器會拒收；
          // 必須讓使用者知道剛才排的沒有存進去，並立即抓回最新設定收合畫面。
          if (j?.locked > 0) {
            globalToast?.('該課別已鎖定或不在開放排班區間，剛才的異動未儲存。', 'error');
            syncFromServerBackground();
          }
        })
        .catch(e => console.warn('狀態同步失敗:', e.message));
    }, 2000);
  }, [employees, vendors, warehouses, schedule, systemLocked, deptLocks, deptRanges, deptSegments, dailyDemand, unlockPwd, periodRange, workAreas, lockerAssign, scheduleRange,
      openHolidays, vendorHolidayOpen, vendorRestOpen, workerRestOpen, vendorCompanyNames, attendData, extras,
      shiftTypesByWh, shiftCodeRows, shiftCodeHeaders, attendSettings, users, workerPwds]);

  // ── 出勤資料同步（PUT /api/attendance，2s debounce，admin/area/vendor/worker 皆適用）──
  const vendorAttendDebRef = useRef(null);
  useEffect(() => {
    if (!serverSyncedRef.current) return;
    const role = currentUser?.role;
    if (role !== ROLES.VENDOR && role !== ROLES.ADMIN && role !== ROLES.AREA && role !== ROLES.WORKER) return;
    const token = localStorage.getItem(JWT_KEY);
    if (!token) return;
    if (vendorAttendDebRef.current) clearTimeout(vendorAttendDebRef.current);
    const body = JSON.stringify({ attendData, extras });
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    if (forceSaveRef.current) {
      forceSaveRef.current = false;
      fetch('/api/attendance', { method: 'PUT', headers, body })
        .then(r => { if (!r.ok) console.warn('出勤立即存檔失敗 HTTP', r.status); })
        .catch(e => console.warn('出勤立即存檔失敗:', e.message));
      return;
    }
    vendorAttendDebRef.current = setTimeout(() => {
      fetch('/api/attendance', { method: 'PUT', headers, body })
        .then(r => { if (!r.ok) console.warn('出勤自動存檔失敗 HTTP', r.status); })
        .catch(e => console.warn('出勤自動存檔失敗:', e.message));
    }, 2000);
  }, [attendData, extras, currentUser]);

  const handleLogout = useCallback(() => {
    localStorage.removeItem(JWT_KEY);
    setCurrentUser(null);
    setCurrentPage('dashboard');
  }, []);

  // ── Idle timeout（30 分鐘無操作自動登出）──
  const IDLE_MS = 30 * 60 * 1000;
  const idleTimer = useRef(null);
  const [idleWarning, setIdleWarning] = useState(false);

  const resetIdle = useCallback(() => {
    sessionStorage.setItem('_idle_last', String(Date.now()));
    setIdleWarning(false);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      handleLogout();
    }, IDLE_MS);
  }, [handleLogout]);

  useEffect(() => {
    if (!currentUser) { if (idleTimer.current) clearTimeout(idleTimer.current); return; }
    const EVENTS = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
    EVENTS.forEach(ev => document.addEventListener(ev, resetIdle, { passive: true }));
    resetIdle();
    // 警告：剩 2 分鐘時提示
    const warnTimer = setInterval(() => {
      const key = '_idle_last';
      const last = Number(sessionStorage.getItem(key) || Date.now());
      if (Date.now() - last > IDLE_MS - 2 * 60 * 1000) setIdleWarning(true);
    }, 30000);
    return () => {
      EVENTS.forEach(ev => document.removeEventListener(ev, resetIdle));
      if (idleTimer.current) clearTimeout(idleTimer.current);
      clearInterval(warnTimer);
    };
  }, [currentUser, resetIdle]);

  // JWT 工作階段還原：頁面載入時檢查本機儲存的 token
  useEffect(() => {
    const token = localStorage.getItem(JWT_KEY);
    if (!token) return;
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(apiUser => {
        if (!apiUser) { localStorage.removeItem(JWT_KEY); return; }
        const role = apiUser.role === 'admin' ? ROLES.ADMIN
                   : apiUser.role === 'vendor' ? ROLES.VENDOR
                   : apiUser.role === 'worker' ? ROLES.WORKER
                   : ROLES.AREA;
        const allowedWh = apiUser.allowedWarehouses || [];
        const userVendors = role === ROLES.VENDOR
          ? (apiUser.vendors ?? [])
          : vendors.map(v => v.name);
        setCurrentUser({
          id: `api_${apiUser.id}`, username: apiUser.username, name: apiUser.name || apiUser.username,
          role, vendors: userVendors,
          permissions: buildPermsFromPagePerms(role, apiUser.page_perms, allowedWh),
          allowedWarehouses: allowedWh,
          approved: true, _apiAuth: true,
        });
        if (role === ROLES.VENDOR || role === ROLES.WORKER) setCurrentPage('schedule');
        if (allowedWh.length === 1) setSelectedWarehouse(allowedWh[0]);
        loadServerState(token, role);
      })
      .catch(() => localStorage.removeItem(JWT_KEY));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogin = useCallback((user, jwtToken) => {
    // 臨時人力無帳號、無 JWT，直接進入自助畫面，不載入任何管理資料
    if (user?.role === ROLES.TEMP) { setCurrentUser(user); return; }
    if (jwtToken) {
      localStorage.setItem(JWT_KEY, jwtToken);
      loadServerState(jwtToken, user?.role);
    }
    if (user._apiAuth) {
      setCurrentUser(user);
      if (user.role === ROLES.VENDOR || user.role === ROLES.WORKER) setCurrentPage('schedule');
      // 若只開放一個倉，登入後自動選取
      if ((user.allowedWarehouses ?? []).length === 1) {
        setSelectedWarehouse(user.allowedWarehouses[0]);
      }
      return;
    }
    const updated = { ...user, loginCount: (user.loginCount ?? 0) + 1 };
    setUsers(prev => prev.map(u => u.id === user.id ? updated : u));
    setCurrentUser(updated);
    if (user.role === ROLES.VENDOR || user.role === ROLES.WORKER) setCurrentPage('schedule');
    if ((user.allowedWarehouses ?? []).length === 1) {
      setSelectedWarehouse(user.allowedWarehouses[0]);
    }
  }, [loadServerState, setSelectedWarehouse]);

  const ctx = {
    users, setUsers,
    employees, setEmployees,
    vendors, setVendors,
    warehouses, setWarehouses,
    selectedWarehouse, setSelectedWarehouse,
    selectedDept, setSelectedDept,
    selectedGroup, setSelectedGroup,
    selectedWorkArea, setSelectedWorkArea,
    workAreas, setWorkAreas,
    selectedVendor, setSelectedVendor,
    schedule, setSchedule: setScheduleTracked, applyRemoteSchedule,
    systemLocked, setSystemLocked,
    deptLocks, setDeptLocks,
    deptRanges, setDeptRanges,
    deptSegments, setDeptSegments,
    dailyDemand, setDailyDemand,
    unlockPwd, setUnlockPwd,
    periodRange, setPeriodRange,
    lockerAssign, setLockerAssign,
    scheduleRange, setScheduleRange,
    openHolidays, setOpenHolidays,
    vendorHolidayOpen, setVendorHolidayOpen,
    vendorRestOpen, setVendorRestOpen,
    workerRestOpen, setWorkerRestOpen,
    vendorCompanyNames, setVendorCompanyNames,
    selectedYear, setSelectedYear,
    selectedMonth, setSelectedMonth,
    attendData, setAttendData,
    extras, setExtras,
    shiftTypesByWh, setShiftTypesByWh,
    shiftCodeRows, setShiftCodeRows,
    shiftCodeHeaders, setShiftCodeHeaders,
    attendSettings, setAttendSettings,
    workerPwds, setWorkerPwds,
    currentUser,
    saveNow,
    triggerForceSave,
    hasUnsavedChanges: () => dirtyRef.current,
  };

  const PAGE_MAP = {
    dashboard: <Dashboard />,
    schedule:  <ScheduleTable />,
    employees: <EmployeeRoster />,
    reports:    <Reports />,
    shiftsetup:  <ShiftSetup />,
    shiftcodes: <ShiftCodeTable />,
    settings:   <Settings />,
    accounts:   <AccountManagement />,
    attendance: <Attendance />,
    phoneControl: <Attendance phoneOnly />,
    selfCheck:  <WorkerSelfCheck />,
  };

  if (!currentUser) {
    return (
      <ToastProvider>
        <LoginScreen users={users} onLogin={handleLogin} onRegister={u => setUsers(prev => [...prev, u])} vendors={vendors} employees={employees} workerPwds={workerPwds} warehouses={warehouses} />
      </ToastProvider>
    );
  }

  // 臨時人力：獨立的自助畫面，不進入主框架（無側邊選單、不讀取管理資料）
  if (currentUser.role === ROLES.TEMP) {
    return (
      <ToastProvider>
        <AppContext.Provider value={ctx}>
          <TempSelfCheck onLogout={() => setCurrentUser(null)} />
        </AppContext.Provider>
      </ToastProvider>
    );
  }

  // 首次登入強制改密碼（委外人員已改為帳密皆為員工編號，一律跳過）
  if (currentUser.mustChangePassword && currentUser.role !== ROLES.WORKER) {
    const isWorker = currentUser.role === ROLES.WORKER;
    return (
      <ToastProvider>
        <ForcePwdChange user={currentUser} onDone={async updated => {
          if (isWorker) {
            // 委外人員的密碼只認伺服器上的那份（登入一律由伺服器驗證），
            // 所以必須先確認伺服器收到，才能放行並寫入本機。
            // 原本是送出後不看結果，失敗時密碼只留在本機、畫面卻顯示成功，
            // 之後新密碼一律「密碼錯誤」，只有員編能登入。
            const token = localStorage.getItem(JWT_KEY);
            if (!token) return false;
            try {
              const r = await fetch('/api/auth/worker-password', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ passwordHash: updated.password }),
              });
              if (!r.ok) { console.warn('委外密碼寫入伺服器失敗 HTTP', r.status); return false; }
            } catch (e) {
              console.warn('委外密碼寫入伺服器失敗:', e.message);
              return false;
            }
            // 伺服器已收到，再存一份到本機供離線備援
            setWorkerPwds(prev => ({ ...prev, [updated.empId]: updated.password }));
          } else {
            setUsers(prev => prev.map(u => u.id === updated.id ? updated : u));
            // 廠商帳號以資料庫的 password_hash 驗證登入，只改本機會使新密碼無效
            if (updated.role === ROLES.VENDOR) {
              const token = localStorage.getItem(JWT_KEY);
              if (token) {
                fetch('/api/auth/vendor-password', {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                  body: JSON.stringify({ passwordHash: updated.password }),
                }).then(r => { if (!r.ok) console.warn('廠商密碼寫入資料庫失敗 HTTP', r.status); })
                  .catch(e => console.warn('廠商密碼寫入資料庫失敗:', e.message));
              }
            }
          }
          setCurrentUser({ ...updated, mustChangePassword: false });
        }} />
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      <AppContext.Provider value={ctx}>
        {idleWarning && (
          <div className="fixed top-0 inset-x-0 z-[9999] text-sm text-center py-2 px-4 flex items-center justify-center gap-3" style={{background:'var(--sms-amber)',color:'#fff'}}>
            <span>閒置逾時警告：即將自動登出，請繼續操作以維持登入狀態</span>
            <button onClick={resetIdle} className="underline font-semibold hover:no-underline">繼續使用</button>
          </div>
        )}
        <div className="flex h-screen overflow-hidden" style={{background:'var(--sms-bg)'}}>
          {/* Desktop sidebar */}
          <div className="hidden md:flex">
            <Sidebar
              currentPage={currentPage} onNavigate={setCurrentPage}
              currentUser={currentUser} onLogout={handleLogout}
              collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(p => !p)}
            />
          </div>

          {/* Mobile nav */}
          <MobileNav
            currentPage={currentPage} onNavigate={setCurrentPage}
            currentUser={currentUser} onLogout={handleLogout}
            open={mobileNavOpen} onClose={() => setMobileNavOpen(false)}
          />

          {/* Main content */}
          <main className="flex-1 flex flex-col overflow-hidden">
            {/* Mobile header */}
            <header className="md:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-[#DDD9D0]" style={{fontFamily:'inherit'}}>
              <button onClick={() => setMobileNavOpen(true)} className="text-slate-600 text-2xl">☰</button>
              <span className="font-semibold text-slate-800">委外人力排班作業平台</span>
              <span className="text-sm text-slate-500">{currentUser.name}</span>
            </header>

            {/* 全域倉別 / 課別選擇列 */}
            {currentUser.role !== ROLES.WORKER && <WarehouseDeptBar />}

            {/* 資料健檢面板（右側滑出，僅管理員）：由篩選列或系統設定叫出 */}
            <HealthDrawer />

            <div className="flex-1 overflow-y-auto" style={{background:'var(--sms-bg)'}}>
              {(() => {
                const userPerms = currentUser.permissions ?? getDefaultPermissions(currentUser.role);
                const allowed = currentUser.role === ROLES.ADMIN || userPerms[currentPage]?.view !== false;
                if (!allowed) return (
                  <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3">
                    <span className="text-5xl">🔒</span>
                    <p className="text-lg font-medium">無此頁面的存取權限</p>
                    <p className="text-sm">請聯絡管理員開啟權限</p>
                  </div>
                );
                return PAGE_MAP[currentPage] ?? <Dashboard />;
              })()}
            </div>
          </main>
        </div>
      </AppContext.Provider>
    </ToastProvider>
  );
}
