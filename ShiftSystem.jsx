/**
 * 企業級委外人力排班作業平台 (Shift Management System)
 * Single-file React application
 * Dependencies: react, react-dom, xlsx (SheetJS), file-saver
 */

import React, {
  useState, useEffect, useCallback, useRef, createContext, useContext, useMemo
} from 'react';
import { createPortal } from 'react-dom';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import html2pdf from 'html2pdf.js';

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

const ROLES = { ADMIN: 'admin', AREA: 'area', VENDOR: 'vendor' };

const SHIFT_CODES = {
  V:  { label: 'V',  color: 'bg-green-100 text-green-800',  meaning: '上班' },
  休: { label: '休', color: 'bg-yellow-100 text-yellow-800', meaning: '休假' },
  國: { label: '國', color: 'bg-blue-100 text-blue-800',    meaning: '國定假日' },
  '': { label: '',   color: 'bg-white text-gray-400',        meaning: '空白' },
};

const SHIFT_CYCLE = ['V', '休', '國', ''];

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
};

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
  { year: 2025, month: 1,  day: 28, name: '農曆除夕' },
  { year: 2025, month: 1,  day: 29, name: '春節' },
  { year: 2025, month: 1,  day: 30, name: '春節' },
  { year: 2025, month: 1,  day: 31, name: '春節' },
  { year: 2025, month: 2,  day: 28, name: '二二八和平紀念日' },
  { year: 2025, month: 4,  day: 4,  name: '兒童節' },
  { year: 2025, month: 5,  day: 1,  name: '勞動節' },
  { year: 2025, month: 5,  day: 31, name: '端午節' },
  { year: 2025, month: 10, day: 6,  name: '中秋節' },
  { year: 2025, month: 10, day: 10, name: '國慶日' },
  // 115年 (2026)
  { year: 2026, month: 1,  day: 1,  name: '元旦' },
  { year: 2026, month: 1,  day: 17, name: '農曆除夕' },
  { year: 2026, month: 1,  day: 18, name: '春節' },
  { year: 2026, month: 1,  day: 19, name: '春節' },
  { year: 2026, month: 1,  day: 20, name: '春節' },
  { year: 2026, month: 2,  day: 28, name: '二二八和平紀念日' },
  { year: 2026, month: 4,  day: 3,  name: '兒童節' },
  { year: 2026, month: 4,  day: 5,  name: '清明節' },
  { year: 2026, month: 5,  day: 1,  name: '勞動節' },
  { year: 2026, month: 6,  day: 19, name: '端午節' },
  { year: 2026, month: 9,  day: 25, name: '中秋節' },
  { year: 2026, month: 10, day: 10, name: '國慶日' },
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
];

function getDefaultPermissions(role) {
  const isAdmin  = role === ROLES.ADMIN;
  const isArea   = role === ROLES.AREA;
  const perms = {};
  PAGE_PERMISSIONS.forEach(page => {
    const pageVisible =
      isAdmin ? true :
      isArea  ? !['settings','accounts'].includes(page.key) :
      ['dashboard','schedule','employees','shiftcodes'].includes(page.key);

    perms[page.key] = { view: pageVisible };
    page.features.forEach(f => {
      const on = pageVisible && (
        isAdmin ? true :
        isArea  ? !['deleteEmployee','clearAll','lockSchedule','manageWarehouse','addAccount','editAccount','deleteAccount'].includes(f.key) :
        ['editSchedule'].includes(f.key)
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
 */
const SEED_WAREHOUSES = [
  {
    id: 'wh1', name: '大溪倉',
    departments: [
      {
        id: 'dept_wh1_1', code: 'L027', name: '大溪理貨一課', vendors: [],
        groups: ['日班-理貨一組','日班-理貨二組','事務組','中班-理貨一組','中班-理貨二組',
                 '日班-驗收組','夜班-驗收組','中班-驗收組','日班-EC廠退組'],
      },
      {
        id: 'dept_wh1_2', code: 'L022', name: '大溪理貨二課', vendors: [],
        groups: ['日班-店訂組','日班-退貨組','中班-分揀組','日班-加工組','日班-POP組','事務組'],
      },
      {
        id: 'dept_wh1_3', code: 'L021', name: '倉儲管理課', vendors: [],
        groups: ['日班-庫存組','日班-廠退組','日班-收發組','日班-O2O組',
                 '清潔組','事務組','日班-出貨組','中班-庫存組','夜班-O2O組'],
      },
      {
        id: 'dept_wh1_4', code: 'L025', name: '運務課', vendors: [],
        groups: ['運務組'],
      },
      {
        id: 'dept_wh1_5', code: 'L012', name: '營運指導課', vendors: [],
        groups: ['事務組'],
      },
    ],
  },
  {
    id: 'wh2', name: '大肚倉',
    departments: [
      {
        id: 'dept_wh2_1', code: 'L035', name: '大肚理貨課', vendors: [],
        groups: ['日班-理貨組','中班-理貨組','夜班-理貨組','事務組','清潔組','日班-出貨組'],
      },
      {
        id: 'dept_wh2_2', code: 'L037', name: '大肚運務課', vendors: [],
        groups: ['運務組'],
      },
    ],
  },
  {
    id: 'wh3', name: '岡山倉',
    departments: [
      {
        id: 'dept_wh3_1', code: 'L007', name: '岡山營運課', vendors: [],
        groups: ['日班-理貨組','中班-理貨組','夜班-理貨組','日班-庫存組',
                 '日班-出貨組','日班-收發組','清潔組','運務組','事務組'],
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
  // ⚠️ 部署後請立即修改以下密碼，不要使用預設值
  mkUser('u0', 'admin',  'Admin@2024!', ROLES.ADMIN,  '系統管理員',    SEED_VENDORS.map(v=>v.name), true),
  mkUser('u2', 'area01', 'Area@2024!',  ROLES.AREA,   '當區幹部A',     SEED_VENDORS.map(v=>v.name)),
  mkUser('u3', 'cs',     'Cs@2024!',    ROLES.VENDOR, 'CS 承杺幹部',   ['承杺']),
  mkUser('u4', 'ct',     'Ct@2024!',    ROLES.VENDOR, 'CT 芊通幹部',   ['芊通']),
  mkUser('u5', 'cy',     'Cy@2024!',    ROLES.VENDOR, 'CY 承奕幹部',   ['承奕']),
  mkUser('u6', 'df',     'Df@2024!',    ROLES.VENDOR, 'DF 頂富幹部',   ['頂富']),
  mkUser('u7', 'ht',     'Ht@2024!',    ROLES.VENDOR, 'HT 華煬通幹部', ['華煬通']),
  mkUser('u8', 'sy',     'Sy@2024!',    ROLES.VENDOR, 'SY 三彥幹部',   ['三彥']),
  mkUser('u9', 'wy',     'Wy@2024!',    ROLES.VENDOR, 'WY 萬宜幹部',   ['萬宜']),
  mkUser('u10','xb',     'Xb@2024!',    ROLES.VENDOR, 'XB 信邦幹部',   ['信邦']),
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

// 密碼雜湊工具（SHA-256，Web Crypto API）
const hashPwd = async (plain) => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(plain));
  return 'sha256:' + Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
};
const verifyPwd = async (input, stored) => {
  if (!stored) return false;
  if (stored.startsWith('sha256:')) return (await hashPwd(input)) === stored;
  return input === stored; // 舊明文：比對後在外層自動升級
};

// ─────────────────────────────────────────────
// SHARED EMPLOYEE FILTER HELPER
// filterEmployees(list, warehouses, selectedWarehouse, selectedDept, selectedGroup)
// Applies warehouse → dept (vendor) → group cascading filter.
// ─────────────────────────────────────────────

function filterByScope(list, warehouses, selectedWarehouse, selectedDept, selectedGroup) {
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
    if (wh) {
      const deptNames = new Set((wh.departments ?? []).map(d => d.name));
      const whVendors = new Set((wh.departments ?? []).flatMap(d => d.vendors));
      list = list.filter(e => {
        if (e.dept) return deptNames.has(e.dept);
        return whVendors.has(e.vendor);
      });
    }
  }
  return list;
}

// ─────────────────────────────────────────────
// AUTH SCREEN
// ─────────────────────────────────────────────

function LoginScreen({ users, onLogin, onRegister, vendors }) {
  // portal: null = 選擇入口, 'staff' = 員工, 'vendor' = 廠商, 'register' = 申請廠商帳號
  const [portal, setPortal] = useState(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  // 申請表單狀態
  const [regForm, setRegForm] = useState({ username: '', password: '', confirm: '', name: '', vendor: '' });
  const [regError, setRegError] = useState('');
  const [regDone, setRegDone] = useState(false);

  const vendorNames = vendors?.map(v => v.name) ?? [];

  const portalConfig = {
    staff:  { label: '員工入口',   icon: '🏢', color: 'bg-blue-600 hover:bg-blue-700',   roles: [ROLES.ADMIN, ROLES.AREA] },
    vendor: { label: '廠商入口',   icon: '🤝', color: 'bg-emerald-600 hover:bg-emerald-700', roles: [ROLES.VENDOR] },
  };

  const handleBack = () => { setPortal(null); setUsername(''); setPassword(''); setError(''); };

  const handleSubmit = async e => {
    e.preventDefault();
    setError('');
    const allowedRoles = portalConfig[portal].roles;
    const candidate = users.find(u =>
      u.username === username && allowedRoles.includes(u.role)
    );
    if (!candidate) { setError('帳號或密碼錯誤，或無此入口的登入權限。'); return; }
    const ok = await verifyPwd(password, candidate.password);
    if (!ok) { setError('帳號或密碼錯誤，或無此入口的登入權限。'); return; }
    if (candidate.approved === false) { setError('此帳號審核中，請等候管理員核准後再登入。'); return; }
    // 自動將明文密碼升級為 SHA-256 雜湊
    if (!candidate.password.startsWith('sha256:')) {
      const hashed = await hashPwd(password);
      onLogin({ ...candidate, password: hashed }, hashed);
    } else {
      onLogin(candidate);
    }
  };

  const handleRegister = async e => {
    e.preventDefault();
    setRegError('');
    // 頻率限制：每 60 秒只能申請一次
    const lastReg = sessionStorage.getItem('last_reg_ts');
    if (lastReg && Date.now() - Number(lastReg) < 60000) {
      setRegError('操作過於頻繁，請稍候再試。'); return;
    }
    if (!regForm.username || !regForm.password || !regForm.name || !regForm.vendor) {
      setRegError('所有欄位皆為必填'); return;
    }
    if (regForm.password !== regForm.confirm) {
      setRegError('兩次密碼不一致'); return;
    }
    if (regForm.password.length < 6) {
      setRegError('密碼至少需 6 個字元'); return;
    }
    if (users.find(u => u.username === regForm.username)) {
      setRegError('此帳號名稱已被使用，請更換'); return;
    }
    const hashedPwd = await hashPwd(regForm.password);
    sessionStorage.setItem('last_reg_ts', String(Date.now()));
    onRegister({
      id: crypto.randomUUID(),
      username: regForm.username,
      password: hashedPwd,
      name: regForm.name,
      role: ROLES.VENDOR,
      vendors: [regForm.vendor],
      allowedWarehouses: [],
      approved: false,
    });
    setRegDone(true);
  };

  // ── 申請廠商帳號畫面 ──
  if (portal === 'register') {
    if (regDone) return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-800 to-slate-600">
        <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm text-center">
          <div className="text-5xl mb-4">✅</div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">申請已送出</h2>
          <p className="text-sm text-slate-500 mb-6">請等候管理員審核後即可登入，謝謝。</p>
          <button onClick={() => { setPortal(null); setRegDone(false); setRegForm({ username:'', password:'', confirm:'', name:'', vendor:'' }); }}
            className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg transition-colors">
            返回登入
          </button>
        </div>
      </div>
    );
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-800 to-slate-600">
        <form onSubmit={handleRegister} className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm">
          <div className="flex items-center gap-3 mb-6">
            <button type="button" onClick={() => setPortal(null)} className="text-slate-400 hover:text-slate-600 text-xl">‹</button>
            <div>
              <h1 className="text-xl font-bold text-slate-800">📝 申請廠商帳號</h1>
              <p className="text-xs text-slate-400">送出後等候管理員審核</p>
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
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
          ))}
          <div className="mb-5">
            <label className="block text-sm font-medium text-slate-700 mb-1">所屬廠商</label>
            <select value={regForm.vendor} onChange={e => setRegForm(p => ({ ...p, vendor: e.target.value }))}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500">
              <option value="">── 請選擇廠商 ──</option>
              {vendorNames.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <button type="submit" className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg transition-colors">
            送出申請
          </button>
          <button type="button" onClick={() => setPortal(null)} className="w-full mt-3 py-2 text-sm text-slate-500 hover:text-slate-700">
            ← 返回入口選擇
          </button>
        </form>
      </div>
    );
  }

  // ── 入口選擇畫面 ──
  if (!portal) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-800 to-slate-600">
        <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm text-center">
          <div className="text-4xl mb-3">🗓️</div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">委外人力排班作業平台</h1>
          <p className="text-sm text-slate-500 mb-8">Shift Management System</p>

          <p className="text-sm text-slate-600 mb-4 font-medium">請選擇登入入口</p>

          <div className="flex flex-col gap-3">
            <button
              onClick={() => setPortal('staff')}
              className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold
                         rounded-xl transition-colors flex items-center justify-center gap-3 text-base">
              <span className="text-2xl">🏢</span>
              <span>員工入口</span>
              <span className="text-xs text-blue-200 ml-auto">管理員 · 幹部</span>
            </button>
            <button
              onClick={() => setPortal('vendor')}
              className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold
                         rounded-xl transition-colors flex items-center justify-center gap-3 text-base">
              <span className="text-2xl">🤝</span>
              <span>廠商入口</span>
              <span className="text-xs text-emerald-200 ml-auto">委外幹部</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── 登入表單 ──
  const cfg = portalConfig[portal];
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-800 to-slate-600">
      <form onSubmit={handleSubmit}
        className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button type="button" onClick={handleBack}
            className="text-slate-400 hover:text-slate-600 text-xl leading-none">‹</button>
          <div>
            <h1 className="text-xl font-bold text-slate-800">{cfg.icon} {cfg.label}</h1>
            <p className="text-xs text-slate-400">委外人力排班作業平台</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
            {error}
          </div>
        )}

        <label className="block text-sm font-medium text-slate-700 mb-1">帳號</label>
        <input
          type="text" value={username} onChange={e => setUsername(e.target.value)}
          required autoFocus placeholder="請輸入帳號"
          className="w-full mb-4 px-3 py-2 border border-slate-300 rounded-lg text-sm
                     focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        <label className="block text-sm font-medium text-slate-700 mb-1">密碼</label>
        <input
          type="password" value={password} onChange={e => setPassword(e.target.value)}
          required placeholder="請輸入密碼"
          className="w-full mb-6 px-3 py-2 border border-slate-300 rounded-lg text-sm
                     focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        <button type="submit"
          className={`w-full py-2.5 text-white font-semibold rounded-lg transition-colors ${cfg.color}`}>
          登入
        </button>

        <button type="button" onClick={handleBack}
          className="w-full mt-3 py-2 text-sm text-slate-500 hover:text-slate-700 transition-colors">
          ← 返回入口選擇
        </button>

        <div className="mt-4 pt-4 border-t border-slate-100 text-center">
          <span className="text-sm text-slate-400">還沒有帳號？</span>
          <button type="button" onClick={() => { setRegForm({ username:'', password:'', confirm:'', name:'', vendor:'' }); setPortal('register'); }}
            className="ml-1 text-sm text-emerald-600 hover:text-emerald-700 font-medium underline">
            {portal === 'vendor' ? '申請廠商帳號' : '申請帳號'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─────────────────────────────────────────────
// NAVIGATION
// ─────────────────────────────────────────────

const NAV_ITEMS = [
  { key: 'dashboard',    label: '儀表板',       icon: '📊', roles: [ROLES.ADMIN, ROLES.AREA, ROLES.VENDOR] },
  { key: 'schedule',     label: '班表管理',     icon: '📅', roles: [ROLES.ADMIN, ROLES.AREA, ROLES.VENDOR] },
  { key: 'employees',    label: '人員清冊',     icon: '👥', roles: [ROLES.ADMIN, ROLES.AREA, ROLES.VENDOR] },
  { key: 'shiftsetup',   label: '人員班別設定', icon: '⏰', roles: [ROLES.ADMIN, ROLES.AREA] },
  { key: 'reports',      label: '報表匯出',     icon: '📋', roles: [ROLES.ADMIN, ROLES.AREA] },
  { key: 'shiftcodes',   label: '班別代號表',   icon: '📖', roles: [ROLES.ADMIN, ROLES.AREA, ROLES.VENDOR] },
  { key: 'settings',     label: '系統設定',     icon: '⚙️', roles: [ROLES.ADMIN] },
  { key: 'accounts',     label: '帳號管理',     icon: '🔑', roles: [ROLES.ADMIN] },
  { key: 'permissions',  label: '權限管理',     icon: '🛡️', roles: [ROLES.ADMIN] },
];

function Sidebar({ currentPage, onNavigate, currentUser, onLogout, collapsed, onToggle }) {
  const items = NAV_ITEMS.filter(n => n.roles.includes(currentUser.role));

  return (
    <aside className={`flex flex-col bg-slate-900 text-white transition-all duration-300
                       ${collapsed ? 'w-14' : 'w-56'} shrink-0 h-screen sticky top-0`}>
      {/* Logo */}
      <div className="flex items-center gap-2 px-3 py-4 border-b border-slate-700">
        <span className="text-2xl">🗓️</span>
        {!collapsed && <span className="font-bold text-sm leading-tight">班表管理<br/>系統</span>}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 overflow-y-auto">
        {items.map(item => (
          <button key={item.key}
            onClick={() => onNavigate(item.key)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm transition-colors
                        ${currentPage === item.key
                          ? 'bg-blue-600 text-white'
                          : 'text-slate-300 hover:bg-slate-700 hover:text-white'}`}>
            <span className="text-lg shrink-0">{item.icon}</span>
            {!collapsed && <span className="truncate">{item.label}</span>}
          </button>
        ))}
      </nav>

      {/* User Info & Logout */}
      <div className="border-t border-slate-700 p-3">
        {!collapsed && (
          <div className="mb-2 text-xs text-slate-400 truncate">
            <div className="font-medium text-slate-200">{currentUser.name}</div>
            <div>{currentUser.role === ROLES.ADMIN ? '管理員' : currentUser.role === ROLES.AREA ? '當區幹部' : '委外幹部'}</div>
          </div>
        )}
        <button onClick={onLogout}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-slate-400
                     hover:bg-slate-700 hover:text-red-400 transition-colors">
          <span>🚪</span>
          {!collapsed && '登出'}
        </button>
      </div>

      {/* Collapse toggle */}
      <button onClick={onToggle}
        className="absolute -right-3 top-16 bg-slate-700 hover:bg-slate-600 text-white
                   rounded-full w-6 h-6 flex items-center justify-center text-xs shadow">
        {collapsed ? '›' : '‹'}
      </button>
    </aside>
  );
}

// ─────────────────────────────────────────────
// WAREHOUSE / DEPT SELECTOR BAR
// ─────────────────────────────────────────────

function WarehouseDeptBar() {
  const {
    warehouses, currentUser,
    selectedWarehouse, setSelectedWarehouse,
    selectedDept,      setSelectedDept,
    selectedGroup,     setSelectedGroup,
  } = useApp();

  // 限制該帳號可見的倉別（[] = 全部）
  const allowedWh = currentUser?.allowedWarehouses ?? [];
  const visibleWarehouses = allowedWh.length > 0
    ? warehouses.filter(w => allowedWh.includes(w.id))
    : warehouses;

  const whObj   = visibleWarehouses.find(w => w.id === selectedWarehouse) ?? null;
  const depts   = whObj?.departments ?? [];
  const deptObj = depts.find(d => d.id === selectedDept) ?? null;
  const groups  = deptObj?.groups ?? [];

  const handleWhChange = (whId) => {
    setSelectedWarehouse(whId || null);
    setSelectedDept(null);
    setSelectedGroup(null);
  };

  const handleDeptChange = (deptId) => {
    setSelectedDept(deptId || null);
    setSelectedGroup(null);
  };

  const handleGroupChange = (g) => {
    setSelectedGroup(g || null);
  };

  const hasFilter = selectedWarehouse || selectedDept || selectedGroup;
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);

  const filterLabel = [
    selectedWarehouse ? visibleWarehouses.find(w=>w.id===selectedWarehouse)?.name : null,
    selectedDept ? deptObj?.name : null,
    selectedGroup || null,
  ].filter(Boolean).join(' › ') || '全部';

  const selects = (
    <div className="flex items-center gap-2 flex-wrap text-sm">
      <span className="text-slate-500 font-medium whitespace-nowrap">🏭 倉別：</span>
      <select value={selectedWarehouse ?? ''} onChange={e => handleWhChange(e.target.value)}
        className="border border-slate-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
        <option value="">全部倉別</option>
        {visibleWarehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
      </select>
      <span className="text-slate-400">›</span>
      <span className="text-slate-500 font-medium whitespace-nowrap">課別：</span>
      <select value={selectedDept ?? ''} onChange={e => handleDeptChange(e.target.value)}
        disabled={!selectedWarehouse}
        className="border border-slate-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-40">
        <option value="">全部課別</option>
        {depts.map(d => <option key={d.id} value={d.id}>{d.code ? `${d.code} ${d.name}` : d.name}</option>)}
      </select>
      <span className="text-slate-400">›</span>
      <span className="text-slate-500 font-medium whitespace-nowrap">組別：</span>
      <select value={selectedGroup ?? ''} onChange={e => handleGroupChange(e.target.value)}
        disabled={!selectedDept || groups.length === 0}
        className="border border-slate-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-40">
        <option value="">全部組別</option>
        {groups.map(g => <option key={g} value={g}>{g}</option>)}
      </select>
      {hasFilter && (
        <button onClick={() => { setSelectedWarehouse(null); setSelectedDept(null); setSelectedGroup(null); setMobileFilterOpen(false); }}
          className="px-2 py-0.5 text-xs text-slate-500 border border-slate-300 rounded-full hover:bg-slate-100">
          清除篩選
        </button>
      )}
      {selectedDept && deptObj?.vendors?.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-slate-400 text-xs">廠商：</span>
          {deptObj.vendors.map(v => (
            <span key={v} className="px-1.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-full text-xs">{v}</span>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="bg-white border-b border-slate-200 shrink-0">
      {/* Desktop */}
      <div className="hidden md:flex items-center gap-2 px-4 py-2 flex-wrap text-sm">
        {selects}
      </div>
      {/* Mobile: 摺疊列 */}
      <div className="md:hidden">
        <div className="flex items-center justify-between px-4 py-2">
          <span className="text-sm text-slate-600 truncate max-w-[200px]">🏭 {filterLabel}</span>
          <button onClick={() => setMobileFilterOpen(v => !v)}
            className="text-xs px-2 py-1 border border-slate-300 rounded-lg text-slate-600 whitespace-nowrap">
            {mobileFilterOpen ? '收起 ▲' : '篩選 ▼'}
          </button>
        </div>
        {mobileFilterOpen && (
          <div className="px-4 pb-3 flex flex-col gap-2 text-sm border-t border-slate-100">
            <div className="flex items-center gap-2">
              <span className="text-slate-500 w-12 shrink-0">倉別</span>
              <select value={selectedWarehouse ?? ''} onChange={e => handleWhChange(e.target.value)}
                className="flex-1 border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
                <option value="">全部倉別</option>
                {visibleWarehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-500 w-12 shrink-0">課別</span>
              <select value={selectedDept ?? ''} onChange={e => handleDeptChange(e.target.value)}
                disabled={!selectedWarehouse}
                className="flex-1 border border-slate-300 rounded-lg px-2 py-1.5 text-sm disabled:opacity-40">
                <option value="">全部課別</option>
                {depts.map(d => <option key={d.id} value={d.id}>{d.code ? `${d.code} ${d.name}` : d.name}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-500 w-12 shrink-0">組別</span>
              <select value={selectedGroup ?? ''} onChange={e => handleGroupChange(e.target.value)}
                disabled={!selectedDept || groups.length === 0}
                className="flex-1 border border-slate-300 rounded-lg px-2 py-1.5 text-sm disabled:opacity-40">
                <option value="">全部組別</option>
                {groups.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            {hasFilter && (
              <button onClick={() => { setSelectedWarehouse(null); setSelectedDept(null); setSelectedGroup(null); setMobileFilterOpen(false); }}
                className="self-start px-3 py-1 text-xs text-slate-500 border border-slate-300 rounded-full hover:bg-slate-100">
                清除篩選
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MobileNav({ currentPage, onNavigate, currentUser, onLogout, open, onClose }) {
  if (!open) return null;
  const items = NAV_ITEMS.filter(n => n.roles.includes(currentUser.role));
  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <aside className="fixed left-0 top-0 h-full w-64 bg-slate-900 text-white z-50 flex flex-col">
        <div className="flex items-center justify-between px-4 py-4 border-b border-slate-700">
          <span className="font-bold">委外人力排班作業平台</span>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">✕</button>
        </div>
        <nav className="flex-1 py-3">
          {items.map(item => (
            <button key={item.key}
              onClick={() => { onNavigate(item.key); onClose(); }}
              className={`w-full flex items-center gap-3 px-4 py-3 text-sm
                          ${currentPage === item.key ? 'bg-blue-600' : 'hover:bg-slate-700'}`}>
              <span>{item.icon}</span><span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-slate-700 text-sm text-slate-300">
          <div>{currentUser.name}</div>
          <button onClick={onLogout} className="mt-2 text-red-400 hover:text-red-300">登出</button>
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
    warehouses, selectedWarehouse, selectedDept, selectedGroup,
  } = useApp();
  const days = getDaysInMonth(selectedYear, selectedMonth);

  const visibleEmployees = useMemo(() => {
    let list = currentUser.role === ROLES.VENDOR
      ? employees.filter(e => currentUser.vendors.includes(e.vendor))
      : employees;
    return filterByScope(list, warehouses, selectedWarehouse, selectedDept, selectedGroup);
  }, [employees, currentUser, warehouses, selectedWarehouse, selectedDept, selectedGroup]);

  // 每日出勤統計
  const dailyStats = useMemo(() => {
    return Array.from({ length: days }, (_, i) => {
      const day = i + 1;
      const dk = dateKey(selectedYear, selectedMonth, day);
      let working = 0;
      visibleEmployees.forEach(emp => {
        const code = schedule[emp.id]?.[dk] ?? 'V';
        if (code === 'V') working++;
      });
      return { day, working, total: visibleEmployees.length };
    });
  }, [visibleEmployees, schedule, days, selectedYear, selectedMonth]);

  // 各廠商出勤率
  const vendorStats = useMemo(() => {
    const map = {};
    visibleEmployees.forEach(emp => {
      if (!map[emp.vendor]) map[emp.vendor] = { working: 0, total: 0 };
      map[emp.vendor].total++;
      const todayDate = new Date();
      if (todayDate.getFullYear() === selectedYear && todayDate.getMonth() + 1 === selectedMonth) {
        const dk = dateKey(selectedYear, selectedMonth, todayDate.getDate());
        const code = schedule[emp.id]?.[dk] ?? 'V';
        if (code === 'V') map[emp.vendor].working++;
      } else {
        map[emp.vendor].working += Math.round(map[emp.vendor].total * 0.85);
      }
    });
    return Object.entries(map).map(([vendor, s]) => ({ vendor, ...s }));
  }, [visibleEmployees, schedule, selectedYear, selectedMonth]);

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-xl font-bold text-slate-800">儀表板</h2>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: '本月人員總數', value: visibleEmployees.length, icon: '👥', color: 'bg-blue-50 border-blue-200' },
          { label: '廠商數量',     value: new Set(visibleEmployees.map(e => e.vendor)).size, icon: '🏢', color: 'bg-purple-50 border-purple-200' },
          { label: '今日出勤',     value: dailyStats.find(d => d.day === new Date().getDate())?.working ?? '-', icon: '✅', color: 'bg-green-50 border-green-200' },
          { label: '本月天數',     value: days, icon: '📆', color: 'bg-orange-50 border-orange-200' },
        ].map(c => (
          <div key={c.label} className={`rounded-xl border p-4 ${c.color}`}>
            <div className="text-2xl mb-1">{c.icon}</div>
            <div className="text-3xl font-bold text-slate-800">{c.value}</div>
            <div className="text-xs text-slate-500 mt-1">{c.label}</div>
          </div>
        ))}
      </div>

      {/* Vendor Stats */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="font-semibold text-slate-700 mb-4">各廠商今日人力</h3>
        <div className="space-y-3">
          {vendorStats.map(s => (
            <div key={s.vendor}>
              <div className="flex justify-between text-sm text-slate-600 mb-1">
                <span>{s.vendor}</span>
                <span>{s.working} / {s.total} 人</span>
              </div>
              <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all"
                  style={{ width: `${s.total ? (s.working / s.total * 100) : 0}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}

// ─────────────────────────────────────────────
// SCHEDULE TABLE
// ─────────────────────────────────────────────

function ScheduleTable() {
  const {
    employees, schedule, setSchedule, currentUser,
    selectedYear, selectedMonth, setSelectedYear, setSelectedMonth,
    systemLocked, scheduleRange, openHolidays,
    warehouses, selectedWarehouse, selectedDept, selectedGroup,
  } = useApp();
  const toast = useToast();

  // 讀取班別設定與代號表
  const shiftTypes = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('sms_shift_types') ?? '[]'); } catch { return []; }
  }, []);
  const shiftCodeRows = useMemo(() => {
    try {
      const saved = localStorage.getItem('sms_shiftcode_rows');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  }, []);
  const shiftCodeHeaders = useMemo(() => {
    try {
      const saved = localStorage.getItem('sms_shiftcode_headers');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  }, []);

  // 假日名稱 → 代號表欄位名稱對照
  const HOLIDAY_COL_MAP = {
    '元旦':           '元旦',
    '農曆除夕':       '除夕',
    '二二八和平紀念日': '228紀念日',
    '兒童節':         '兒童節',
    '清明節':         '清明節',
    '勞動節':         '勞動節',
    '端午節':         '端午',
    '中秋節':         '中秋',
    '國慶日':         '雙十',
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

  // 依員工班別、班表代號、日期 → 代號表實際代號
  const getDisplayCode = useCallback((emp, rawCode, day) => {
    if (!emp.shiftTypeId) return rawCode;
    const st = shiftTypes.find(t => t.id === emp.shiftTypeId);
    if (!st) return rawCode;
    const timeStr = `${st.startTime.slice(0,2)}:${st.startTime.slice(2)}`;
    const row = shiftCodeRows.find(r => String(r[0]).trim() === timeStr);
    if (!row) return rawCode;

    if (rawCode === 'V' || rawCode === '') {
      return row[1] ? String(row[1]) : rawCode;
    }
    if (rawCode === '休') {
      return row[2] ? String(row[2]) : rawCode;
    }
    if (rawCode === '國' && day != null) {
      const colName = getHolidayColName(selectedYear, selectedMonth, day);
      if (colName) {
        const colIdx = shiftCodeHeaders.findIndex(h => String(h).trim() === colName);
        if (colIdx !== -1 && row[colIdx + 1] != null) return String(row[colIdx + 1]);
      }
      return rawCode;
    }
    return rawCode;
  }, [shiftTypes, shiftCodeRows, shiftCodeHeaders, getHolidayColName, selectedYear, selectedMonth]);

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

  // rangeMode 下的視圖平移（天數偏移）
  const [viewOffset, setViewOffset] = useState(0);
  const rangeMode = !!(scheduleRange.start && scheduleRange.end);
  const viewRange = useMemo(() => {
    if (!rangeMode) return null;
    const s = parseLocal(scheduleRange.start);
    const e = parseLocal(scheduleRange.end);
    const len = Math.round((e - s) / 86400000); // 區間天數
    const shift = viewOffset * len;
    const vs = new Date(s); vs.setDate(vs.getDate() + shift);
    const ve = new Date(e); ve.setDate(ve.getDate() + shift);
    const fmt = d => `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
    return { start: fmt(vs), end: fmt(ve), len };
  }, [rangeMode, scheduleRange, viewOffset]);

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

  const visibleEmployees = useMemo(() => {
    let list = currentUser.role === ROLES.VENDOR
      ? employees.filter(e => currentUser.vendors.includes(e.vendor))
      : employees;
    list = filterByScope(list, warehouses, selectedWarehouse, selectedDept, selectedGroup);
    if (nameSearch.trim()) {
      const q = nameSearch.trim().toLowerCase();
      list = list.filter(e =>
        (e.name ?? '').toLowerCase().includes(q) ||
        (e.empId ?? '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [employees, currentUser, warehouses, selectedWarehouse, selectedDept, selectedGroup, nameSearch]);

  /** 委外幹部：計算當週休假數（以 dk 為基準） */
  const getWeeklyLeaves = useCallback((empId, dk) => {
    const [y, m, d] = dk.split('-').map(Number);
    const base = new Date(y, m - 1, d);
    const dow  = base.getDay();
    let count = 0;
    for (let offset = -dow; offset <= 6 - dow; offset++) {
      const cur = new Date(y, m - 1, d + offset);
      const k = dateKey(cur.getFullYear(), cur.getMonth() + 1, cur.getDate());
      if (schedule[empId]?.[k] === '休') count++;
    }
    return count;
  }, [schedule]);

  const isEditable = useCallback((dk) => {
    if (systemLocked) return false;
    // 編輯限制僅對原始設定區間，往前/往後查看時仍可編輯
    if (scheduleRange.start && scheduleRange.end) {
      const [y,m,d] = dk.split('-').map(Number);
      const date = new Date(y, m-1, d);
      const rs = parseLocal(viewRange?.start ?? scheduleRange.start);
      const re = parseLocal(viewRange?.end   ?? scheduleRange.end);
      if (date < rs || date > re) return false;
    }
    return true;
  }, [systemLocked, scheduleRange, viewRange]);

  const handleCellClick = useCallback((empId, dk) => {
    if (!isEditable(dk)) {
      toast('此日期已鎖定，無法修改。', 'warn');
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

    const current = schedule[empId]?.[dk] ?? '';
    const idx = SHIFT_CYCLE.indexOf(current);
    let next = SHIFT_CYCLE[(idx + 1) % SHIFT_CYCLE.length];

    // 委外幹部不可排國定假日，跳過「國」
    if (currentUser.role === ROLES.VENDOR && next === '國') {
      next = SHIFT_CYCLE[(SHIFT_CYCLE.indexOf('國') + 1) % SHIFT_CYCLE.length];
    }

    // 防呆：委外幹部每週限排一天休假
    if (currentUser.role === ROLES.VENDOR && next === '休') {
      const existingLeaves = getWeeklyLeaves(empId, dk);
      const alreadyLeave = schedule[empId]?.[dk] === '休';
      if (!alreadyLeave && existingLeaves >= 1) {
        toast('委外幹部每週限排一天休假，本週已達上限。', 'error');
        return;
      }
    }

    setSchedule(prev => ({
      ...prev,
      [empId]: { ...prev[empId], [dk]: next },
    }));
  }, [schedule, employees, isEditable, currentUser, getWeeklyLeaves, setSchedule, toast]);

  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const years  = [2024, 2025, 2026, 2027];

  const exportConverted = () => {
    try {
      const colLabel = h => rangeMode ? `${h.month}/${h.day}(${h.wd})` : `${h.day}(${h.wd})`;
      const header = ['員工編號', '姓名', '廠商', ...dayHeaders.map(colLabel), '出勤天'];
      const rows = visibleEmployees.map(emp => {
        let workDays = 0;
        const dayCells = dayHeaders.map(({ dk, day, month, year }) => {
          const raw = schedule[emp.id]?.[dk] ?? 'V';
          const holidayLabel = raw === '國' ? getHolidayLabel(day, month, year) : null;
          const display = holidayLabel ?? getDisplayCode(emp, raw, day);
          if (raw === 'V') workDays++;
          return display;
        });
        return [emp.empId ?? '', emp.name, emp.vendor ?? '', ...dayCells, workDays];
      });
      const aoa = [header, ...rows];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [{ wch: 10 }, { wch: 12 }, { wch: 12 }, ...dayHeaders.map(() => ({ wch: 5 })), { wch: 6 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '班表');
      const label = rangeMode
        ? `${scheduleRange.start}~${scheduleRange.end}`
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

        const baseYear  = rangeMode ? parseInt(scheduleRange.start.split('-')[0]) : selectedYear;
        const baseMonth = rangeMode ? parseInt(scheduleRange.start.split('-')[1]) : selectedMonth;
        const getYear   = (month) => (month < baseMonth - 6 ? baseYear + 1 : baseYear);

        const mapVal = (v) => {
          const s = String(v ?? '').trim();
          if (s === 'V') return 'V';
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
          const row1 = aoa[1] || [];
          for (let c = 3; c < headerRow.length; c++) {
            const mo = parseInt(String(headerRow[c]).trim());
            const dy = parseInt(String(row1[c] ?? '').trim());
            if (!isNaN(mo) && !isNaN(dy) && mo >= 1 && mo <= 12 && dy >= 1 && dy <= 31) {
              dateCols.push({ col: c, month: mo, day: dy });
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

        const updates = {};
        let updatedCells = 0, skippedEmps = 0;
        for (let r = dataStart; r < aoa.length; r++) {
          const row = aoa[r];
          let emp = null;
          if (isFormatC) {
            const name   = String(row[1] ?? '').trim();
            const vendor = String(row[2] ?? '').trim();
            if (!name) continue;
            emp = nameMap[`${name}|${vendor}`] ?? nameMap[name] ?? null;
          } else {
            const empId = String(row[empIdCol] ?? '').trim();
            if (!empId) continue;
            emp = empMap[empId] ?? null;
          }
          if (!emp) { skippedEmps++; continue; }
          if (!updates[emp.id]) updates[emp.id] = {};
          for (const { col, month, day } of dateCols) {
            const val = mapVal(row[col]);
            if (val !== null) {
              updates[emp.id][dateKey(getYear(month), month, day)] = val;
              updatedCells++;
            }
          }
        }

        if (Object.keys(updates).length === 0) {
          toast(`找不到符合員工編號的資料${skippedEmps > 0 ? `（${skippedEmps} 筆員編未匹配）` : ''}`, 'error');
          return;
        }
        setSchedule(prev => {
          const next = { ...prev };
          Object.entries(updates).forEach(([id, days]) => { next[id] = { ...next[id], ...days }; });
          return next;
        });
        toast(`匯入完成：${Object.keys(updates).length} 位員工、${updatedCells} 格班表已更新${skippedEmps > 0 ? `，${skippedEmps} 筆員編未匹配` : ''}`, 'success');
      } catch (err) {
        toast('匯入失敗：' + err.message, 'error');
      }
    };
    reader.readAsBinaryString(file);
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

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-bold text-slate-800">班表管理</h2>
          <input value={nameSearch} onChange={e => setNameSearch(e.target.value)}
            placeholder="搜尋姓名／員工編號…"
            className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm flex-1 sm:w-44 min-w-0" />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {rangeMode ? (
            <div className="flex items-center gap-1">
              <button onClick={() => setViewOffset(v => v - 1)}
                className="px-2 py-1.5 bg-white border border-slate-300 rounded-lg text-sm hover:bg-slate-100 font-bold"
                title="上一個週期">◀</button>
              <span className={`px-3 py-1.5 border rounded-lg text-sm font-medium
                ${viewOffset === 0 ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-amber-50 border-amber-300 text-amber-700'}`}>
                📅 {viewRange?.start} ~ {viewRange?.end}
                {viewOffset !== 0 && <span className="ml-1 text-xs opacity-70">（{viewOffset > 0 ? `+${viewOffset}` : viewOffset} 期）</span>}
              </span>
              <button onClick={() => setViewOffset(v => v + 1)}
                className="px-2 py-1.5 bg-white border border-slate-300 rounded-lg text-sm hover:bg-slate-100 font-bold"
                title="下一個週期">▶</button>
              {viewOffset !== 0 && (
                <button onClick={() => setViewOffset(0)}
                  className="px-2 py-1.5 bg-blue-100 border border-blue-300 text-blue-700 rounded-lg text-xs hover:bg-blue-200">
                  回目前
                </button>
              )}
            </div>
          ) : (
            <>
              <select value={selectedYear} onChange={e => setSelectedYear(+e.target.value)}
                className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
                {years.map(y => <option key={y} value={y}>{y}年</option>)}
              </select>
              <select value={selectedMonth} onChange={e => setSelectedMonth(+e.target.value)}
                className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
                {months.map(m => <option key={m} value={m}>{m}月</option>)}
              </select>
            </>
          )}
          <button onClick={() => setShowConverted(v => !v)}
            className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-1 border transition-colors
              ${showConverted
                ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'
                : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
            {showConverted ? '🔤 顯示代號中' : '🔡 顯示記號'}
          </button>
          {checkedEmpIds.size > 0 && (
            <button onClick={resetChecked}
              className="px-3 py-1.5 bg-red-500 text-white rounded-lg text-sm hover:bg-red-600 flex items-center gap-1">
              🔄 重排已選（{checkedEmpIds.size}人）
            </button>
          )}
          <button onClick={() => importFileRef.current.click()}
            className="px-3 py-1.5 bg-sky-600 text-white rounded-lg text-sm hover:bg-sky-700 flex items-center gap-1">
            📥 匯入班表
          </button>
          <input ref={importFileRef} type="file" accept=".xlsx,.xls" onChange={handleImportSchedule} className="hidden" />
          <button onClick={exportConverted}
            className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700 flex items-center gap-1">
            📊 代碼轉換匯出
          </button>
          {systemLocked && (
            <span className="px-2 py-1 bg-red-100 text-red-700 text-xs rounded-full font-medium">
              🔒 系統已鎖定
            </span>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="flex gap-3 text-xs flex-wrap">
        {Object.entries(SHIFT_CODES).filter(([k]) => k).map(([code, info]) => (
          <span key={code} className={`px-2 py-0.5 rounded ${info.color}`}>
            {code} = {info.meaning}
          </span>
        ))}
        <span className="text-slate-400">（點擊格子切換班別）</span>
      </div>

      {/* Table */}
      <div className="border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto" style={{ maxHeight: 'calc(100vh - 260px)' }}>
          <table className="border-collapse text-xs" style={{ minWidth: `${160 + days * 44}px` }}>
            <thead className="sticky top-0 z-10">
              <tr className="bg-slate-700 text-white">
                <th className="sticky left-0 z-20 bg-slate-700 px-2 py-2 w-8 min-w-[32px] text-center"
                  style={{ width: 32 }}>
                  <input type="checkbox"
                    className="w-3.5 h-3.5 cursor-pointer"
                    checked={visibleEmployees.length > 0 && visibleEmployees.every(e => checkedEmpIds.has(e.id))}
                    onChange={toggleCheckAll} />
                </th>
                <th className="sticky left-8 z-20 bg-slate-700 text-left px-2 py-2 w-36 min-w-[140px]">
                  人員姓名
                </th>
                <th className="hidden sm:table-cell px-2 py-2 w-16 min-w-[64px]">廠商</th>
                <th className="hidden sm:table-cell px-2 py-2 w-20 min-w-[80px]">班別</th>
                {dayHeaders.map(({ dk, day, month, isWeekend, isMonthStart, wd }, colIdx) => {
                  const weekBand = Math.floor(colIdx / 7) % 2 === 1;
                  return (
                  <th key={dk}
                    className={`px-1 py-1 w-11 min-w-[44px] text-center
                                ${weekBand ? 'bg-slate-500' : ''}
                                ${rangeMode && isMonthStart && month !== dayHeaders[0].month ? 'border-l-2 border-blue-400' : ''}`}>
                    {rangeMode && isMonthStart && <div className="text-[9px] text-blue-300 leading-none">{month}月</div>}
                    <div>{day}</div>
                    <div className={`text-xs ${isWeekend ? 'text-yellow-300' : weekBand ? 'text-slate-200' : 'text-slate-300'}`}>{wd}</div>
                  </th>
                  );
                })}
                <th className="px-2 py-2 w-16 min-w-[64px]">出勤天</th>
              </tr>
            </thead>
            <tbody>
              {visibleEmployees.map((emp, rowIdx) => {
                let workDays = 0;
                // 連續6天上班警示（僅對當區幹部/管理員顯示，廠商不顯示）
                const warnDks = (() => {
                  if (currentUser.role === ROLES.VENDOR) return new Set();
                  const s = new Set();
                  let run = [];
                  for (const { dk } of dayHeaders) {
                    if ((schedule[emp.id]?.[dk] ?? 'V') === 'V') {
                      run.push(dk);
                    } else {
                      if (run.length >= 6) run.forEach(k => s.add(k));
                      run = [];
                    }
                  }
                  if (run.length >= 6) run.forEach(k => s.add(k));
                  return s;
                })();
                return (
                  <tr key={emp.id}
                    className={`${checkedEmpIds.has(emp.id) ? 'bg-red-50' : rowIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}`}>
                    <td className="sticky left-0 z-10 px-2 py-2 text-center border-r border-slate-200 bg-inherit"
                      style={{ width: 32 }}>
                      <input type="checkbox"
                        className="w-3.5 h-3.5 cursor-pointer"
                        checked={checkedEmpIds.has(emp.id)}
                        onChange={() => toggleCheck(emp.id)} />
                    </td>
                    <td className="sticky left-8 z-10 px-2 py-2 font-medium text-slate-800
                                   border-r border-slate-200 bg-inherit">
                      <div className="truncate max-w-[130px]">{emp.name}</div>
                      <div className="text-xs text-slate-400 truncate max-w-[130px]">{emp.empId}</div>
                    </td>
                    <td className="hidden sm:table-cell px-2 py-2 text-slate-600 border-r border-slate-100 text-center whitespace-nowrap">
                      {emp.vendor}
                    </td>
                    <td className="hidden sm:table-cell px-2 py-2 border-r border-slate-100 text-center">
                      {(() => {
                        const st = shiftTypes.find(t => t.id === emp.shiftTypeId);
                        return st
                          ? <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-700 whitespace-nowrap">{st.name}</span>
                          : <span className="text-slate-300 text-xs">—</span>;
                      })()}
                    </td>
                    {dayHeaders.map(({ dk, day, month, year, isWeekend, isMonthStart }, colIdx) => {
                      const code = schedule[emp.id]?.[dk] ?? 'V';
                      if (code === 'V') workDays++;
                      const holidayLabel = code === '國' ? getHolidayLabel(day, month, year) : null;
                      const displayCode = showConverted
                        ? (holidayLabel ?? getDisplayCode(emp, code, day))
                        : (holidayLabel ?? code);
                      const info = SHIFT_CODES[code] ?? SHIFT_CODES[''];
                      const locked = !isEditable(dk);
                      const weekBand = Math.floor(colIdx / 7) % 2 === 1;
                      return (
                        <td key={dk}
                          onClick={() => handleCellClick(emp.id, dk)}
                          title={holidayLabel ? `國定假日：${holidayLabel}` : displayCode !== code ? `班別代號：${displayCode}` : undefined}
                          className={`text-center py-2 border-r border-slate-100 cursor-pointer
                                      select-none transition-colors
                                      ${warnDks.has(dk) ? 'bg-pink-200 text-pink-900' : info.color}
                                      ${rangeMode && isMonthStart && month !== dayHeaders[0].month ? 'border-l-2 border-blue-400' : ''}
                                      ${locked ? 'cursor-not-allowed opacity-60' : 'hover:opacity-75'}`}
                          style={weekBand ? { filter: 'brightness(0.93)' } : undefined}>
                          {displayCode || <span className="text-slate-300">·</span>}
                        </td>
                      );
                    })}
                    <td className="px-2 py-1.5 text-center font-semibold text-blue-700">
                      {workDays}
                    </td>
                  </tr>
                );
              })}
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
    warehouses, selectedWarehouse, selectedDept, selectedGroup } = useApp();
  const toast = useToast();
  const fileRef = useRef();

  const [search, setSearch] = useState('');
  const [filterVendor, setFilterVendor] = useState('全部');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newEmp, setNewEmp] = useState({ empId: '', name: '', vendor: '', group: '', status: '在職' });
  const [editTarget, setEditTarget] = useState(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 100;

  const visible = useMemo(() => {
    let list = currentUser.role === ROLES.VENDOR
      ? employees.filter(e => currentUser.vendors.includes(e.vendor))
      : employees;
    list = filterByScope(list, warehouses, selectedWarehouse, selectedDept, selectedGroup);
    if (filterVendor !== '全部') list = list.filter(e => e.vendor === filterVendor);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(e => e.name.toLowerCase().includes(q) || e.empId.toLowerCase().includes(q));
    }
    return list;
  }, [employees, currentUser, warehouses, selectedWarehouse, selectedDept, selectedGroup, filterVendor, search]);

  // 篩選條件變動時重置到第1頁
  useEffect(() => { setPage(1); }, [selectedWarehouse, selectedDept, selectedGroup, filterVendor, search]);

  const totalPages  = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const pagedVisible = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const vendorOptions = useMemo(() =>
    ['全部', ...new Set(employees.map(e => e.vendor))], [employees]);

  const handleAdd = () => {
    if (!newEmp.empId || !newEmp.name || !newEmp.vendor) {
      toast('員編、姓名、廠商為必填', 'error'); return;
    }
    const emp = { ...newEmp, id: 'e' + Date.now() };
    setEmployees(prev => {
      const next = [...prev, emp];
      setSchedule(s => {
        const daysInMo = getDaysInMonth(selectedYear, selectedMonth);
        const row = {};
        for (let d = 1; d <= daysInMo; d++) row[dateKey(selectedYear, selectedMonth, d)] = 'V';
        return { ...s, [emp.id]: row };
      });
      return next;
    });
    toast('已新增人員：' + emp.name, 'success');
    setShowAddModal(false);
    setNewEmp({ empId: '', name: '', vendor: '', group: '', status: '在職' });
  };

  const handleDelete = (id) => {
    setEmployees(prev => prev.filter(e => e.id !== id));
    setSchedule(prev => { const n = { ...prev }; delete n[id]; return n; });
    toast('人員已移除', 'info');
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

        let added = 0, updated = 0, skippedTemp = 0, skippedLeave = 0;
        const existingMap = new Map(employees.map(e => [e.empId, e]));
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

          const vendor = parseCodeName(vendorRaw);
          const group  = parseCodeName(groupRaw);
          const dept   = parseCodeName(deptRaw);

          if (empId && existingMap.has(empId) && !seenInFile.has(empId)) {
            // 同員工編號：更新基本資料，保留 shiftTypeId
            const old = existingMap.get(empId);
            updatedEmps.push({ ...old, name, vendor, dept, group, status: '在職' });
            seenInFile.add(empId);
            updated++;
          } else if (!seenInFile.has(empId)) {
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
            if (empId) { existingMap.set(empId, emp); seenInFile.add(empId); }
            added++;
          }
        }

        setEmployees(prev => {
          const days = getDaysInMonth(selectedYear, selectedMonth);
          setSchedule(s => {
            const ns = { ...s };
            newEmps.forEach(emp => {
              const row = {};
              for (let d = 1; d <= days; d++) row[dateKey(selectedYear, selectedMonth, d)] = 'V';
              ns[emp.id] = row;
            });
            return ns;
          });
          // 合併：更新既有員工資料、附加新員工
          const updatedMap = new Map(updatedEmps.map(e => [e.id, e]));
          const merged = prev.map(e => updatedMap.get(e.id) ?? e);
          return [...merged, ...newEmps];
        });

        const skipMsg = [
          skippedTemp  ? `臨時人員 ${skippedTemp} 筆` : '',
          skippedLeave ? `已離職 ${skippedLeave} 筆` : '',
        ].filter(Boolean).join('、');

        toast(`匯入完成：新增 ${added} 筆、更新 ${updated} 筆${skipMsg ? `，略過（${skipMsg}）` : ''}`, 'success');
      } catch (err) {
        toast('檔案解析失敗：' + err.message, 'error');
      }
    };
    reader.readAsArrayBuffer(file);   // ArrayBuffer 效能遠優於 binary，支援萬筆大檔
    e.target.value = '';
  };

  const EmpModal = ({ emp, onSave, onClose, title }) => {
    const [form, setForm] = useState(emp);
    return (
      <Modal onClose={onClose}>
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
          <h3 className="font-bold text-lg text-slate-800 mb-4">{title}</h3>
          {[
            { key: 'empId',  label: '員編' },
            { key: 'name',   label: '姓名' },
            { key: 'vendor', label: '廠商' },
            { key: 'dept',   label: '課別' },
            { key: 'group',  label: '組別' },
          ].map(f => (
            <div key={f.key} className="mb-3">
              <label className="block text-sm font-medium text-slate-700 mb-1">{f.label}</label>
              <input value={form[f.key] ?? ''} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />
            </div>
          ))}
          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-700 mb-1">狀態</label>
            <select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}
              className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm">
              <option>在職</option><option>已離職</option><option>臨時人員</option>
            </select>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={onClose} className="px-4 py-2 border border-slate-300 rounded-lg text-sm hover:bg-slate-50">取消</button>
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
          placeholder="搜尋姓名 / 員編..." className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm w-52" />
        <select value={filterVendor} onChange={e => setFilterVendor(e.target.value)}
          className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
          {vendorOptions.map(v => <option key={v}>{v}</option>)}
        </select>
        <span className="text-sm text-slate-500 self-center">共 {visible.length} 筆</span>
        {visible.length > PAGE_SIZE && (
          <span className="text-xs text-slate-400 self-center">（每頁 {PAGE_SIZE} 筆）</span>
        )}
      </div>

      {/* Table */}
      <div className="border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-100">
              <tr>
                {['員編','姓名','廠商','課別','組別','狀態','操作'].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-semibold text-slate-600 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pagedVisible.length === 0 && (
                <tr><td colSpan={7} className="text-center py-8 text-slate-400">無人員資料</td></tr>
              )}
              {pagedVisible.map(emp => (
                <tr key={emp.id} className="hover:bg-slate-50">
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
                      ? <span className="px-2 py-0.5 bg-green-50 text-green-700 border border-green-200 rounded-full text-xs">{emp.group}</span>
                      : <span className="text-slate-300">—</span>}
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
                        className="text-blue-600 hover:text-blue-800 text-xs">編輯</button>
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
            className="px-2 py-1 text-xs border border-slate-300 rounded-lg disabled:opacity-40 hover:bg-slate-50">
            ««
          </button>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            className="px-2 py-1 text-xs border border-slate-300 rounded-lg disabled:opacity-40 hover:bg-slate-50">
            ‹
          </button>
          <span className="text-sm text-slate-600 px-2">
            第 <span className="font-semibold">{page}</span> / {totalPages} 頁
            <span className="ml-2 text-slate-400">
              （第 {(page-1)*PAGE_SIZE+1}～{Math.min(page*PAGE_SIZE, visible.length)} 筆）
            </span>
          </span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            className="px-2 py-1 text-xs border border-slate-300 rounded-lg disabled:opacity-40 hover:bg-slate-50">
            ›
          </button>
          <button onClick={() => setPage(totalPages)} disabled={page === totalPages}
            className="px-2 py-1 text-xs border border-slate-300 rounded-lg disabled:opacity-40 hover:bg-slate-50">
            »»
          </button>
        </div>
      )}

      {showAddModal && (
        <EmpModal
          emp={newEmp} title="新增人員" onClose={() => setShowAddModal(false)}
          onSave={form => { setNewEmp(form); handleAdd(); }}
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

// HTML 安全跳脫，防止 XSS 注入到 PDF 匯出的 HTML 字串
const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

function Reports() {
  const { employees, schedule, selectedYear, selectedMonth,
    warehouses, selectedWarehouse, selectedDept, selectedGroup } = useApp();
  const toast = useToast();
  const days = getDaysInMonth(selectedYear, selectedMonth);

  const scopedEmployees = useMemo(() =>
    filterByScope(employees, warehouses, selectedWarehouse, selectedDept, selectedGroup),
    [employees, warehouses, selectedWarehouse, selectedDept, selectedGroup]);

  const buildVendorSheet = (vendor) => {
    const emps = scopedEmployees.filter(e => e.vendor === vendor);
    const rocYear = selectedYear - 1911;
    const daysInMonth = days;
    const WEEKDAYS = ['日','一','二','三','四','五','六'];

    // National holidays in this month
    const monthHolidays = NATIONAL_HOLIDAYS.filter(
      h => h.year === selectedYear && h.month === selectedMonth
    );

    // Get remark for employee: if employee's 國 falls on a non-holiday date
    const getRemarks = (emp) => {
      const parts = [];
      for (const h of monthHolidays) {
        const dk = dateKey(selectedYear, selectedMonth, h.day);
        const codeOnHoliday = schedule[emp.id]?.[dk] ?? 'V';
        if (codeOnHoliday !== '國') {
          let foundDay = null;
          for (let d = 1; d <= daysInMonth; d++) {
            if ((schedule[emp.id]?.[dateKey(selectedYear, selectedMonth, d)] ?? 'V') === '國') { foundDay = d; break; }
          }
          if (foundDay) {
            parts.push(`原${selectedMonth}/${h.day}國定假日${h.name}調移至${selectedMonth}/${foundDay}`);
          }
        }
      }
      return parts.join('；');
    };

    const countCode = (emp, code) => {
      let c = 0;
      for (let d = 1; d <= daysInMonth; d++) {
        if ((schedule[emp.id]?.[dateKey(selectedYear, selectedMonth, d)] ?? 'V') === code) c++;
      }
      return c;
    };

    // AOA rows — columns: [empty, col_B, col_C, day1..dayN, 請假,休假,例假,國定, 員工簽名, 確認日期, 備註]
    const pad = (n) => { const a = []; for (let i = 0; i < n; i++) a.push(null); return a; };
    const totalCols = 3 + daysInMonth + 4 + 3; // B,C + days + 4 counts + 3 sig cols

    const row = (...cells) => {
      const r = new Array(totalCols).fill(null);
      cells.forEach(([i, v]) => { r[i] = v; });
      return r;
    };

    const companyName = VENDOR_COMPANY_NAMES[vendor] ?? vendor;
    const dateRange = `確認排班區間：${rocYear}年${selectedMonth}月1日~${rocYear}年${selectedMonth}月${daysInMonth}日`;

    // Month row: position 1=月份, 2=empty, 3..3+days-1=month numbers, 3+days=各假別計算, 3+days+4=員工簽名, 3+days+5=確認日期, 3+days+6=備註
    const dc = 3 + daysInMonth; // start of count columns (0-based index)
    const monthRow = new Array(totalCols).fill(null);
    monthRow[1] = '月份';
    for (let d = 1; d <= daysInMonth; d++) monthRow[2 + d] = selectedMonth;
    monthRow[dc] = '各假別計算';
    monthRow[dc + 4] = '員工簽名';
    monthRow[dc + 5] = '確認日期';
    monthRow[dc + 6] = '備註';

    const dateRow = new Array(totalCols).fill(null);
    dateRow[1] = '日期';
    for (let d = 1; d <= daysInMonth; d++) dateRow[2 + d] = d;
    dateRow[dc] = '請假\n天數';
    dateRow[dc + 1] = '休假\n天數';
    dateRow[dc + 2] = '例假日\n天數';
    dateRow[dc + 3] = '國定\n假日\n天數';

    const weekRow = new Array(totalCols).fill(null);
    weekRow[1] = '星期';
    for (let d = 1; d <= daysInMonth; d++) {
      const wd = new Date(selectedYear, selectedMonth - 1, d).getDay();
      weekRow[2 + d] = WEEKDAYS[wd];
    }

    const headerRow = new Array(totalCols).fill(null);
    headerRow[1] = '員工編號';
    headerRow[2] = '員工姓名';

    const empRows = emps.map(emp => {
      const r = new Array(totalCols).fill(null);
      r[1] = emp.empId;
      r[2] = emp.name;
      for (let d = 1; d <= daysInMonth; d++) {
        r[2 + d] = schedule[emp.id]?.[dateKey(selectedYear, selectedMonth, d)] ?? 'V';
      }
      r[dc]     = countCode(emp, '事') + countCode(emp, '病');
      r[dc + 1] = countCode(emp, '休');
      r[dc + 2] = countCode(emp, '例');
      r[dc + 3] = countCode(emp, '國');
      r[dc + 6] = getRemarks(emp);
      return r;
    });

    const noteRow1 = new Array(totalCols).fill(null);
    noteRow1[1] = '1. 本表僅供當月排班及出勤／休假日確認使用，標示說明如下：實際出勤、請假、加班、補休及薪資計算，仍以公司系統紀錄及相關規定為準。';
    noteRow1[dc + 4] = '人力廠商 假別確認簽章';

    const noteRow2 = new Array(totalCols).fill(null);
    noteRow2[1] = '     ※班別／狀態說明：V＝出勤日　例＝例假日　休＝休假日　事＝事假　病＝病假　國＝國定假日';

    const noteRow3 = new Array(totalCols).fill(null);
    noteRow3[1] = '2. 當月排班確認表經勞資雙方個別協商確認，員工簽名即同意配合公司實施八週彈性工時進行工作日、休息日及國定假日之調移，調移後之具體日期如本表所載。';

    // Title row: B2=廠商名(red), I2=當月排班確認表, Q2=確認排班區間
    const titleRow = new Array(totalCols).fill(null);
    titleRow[1] = companyName;           // B2 — styled red in exportVendor
    titleRow[8] = '當月排班確認表';      // I2
    titleRow[16] = dateRange;            // Q2

    return [
      new Array(totalCols).fill(null),
      titleRow,
      new Array(totalCols).fill(null),
      noteRow1,
      noteRow2,
      noteRow3,
      new Array(totalCols).fill(null),
      monthRow,
      dateRow,
      weekRow,
      headerRow,
      ...empRows,
    ];
  };

  const applySheetStyles = (ws) => {
    // B2: 廠商名稱 — 紅色粗體
    if (ws['B2']) ws['B2'].s = { font: { bold: true, sz: 13, color: { rgb: 'CC0000' } } };
    // I2: 當月排班確認表 — 粗體
    if (ws['I2']) ws['I2'].s = { font: { bold: true, sz: 13 } };
    // Q2: 確認排班區間 — 粗體
    if (ws['Q2']) ws['Q2'].s = { font: { bold: true, sz: 12 } };
  };

  const exportVendor = (vendor) => {
    try {
      const wb = XLSX.utils.book_new();
      const wsData = buildVendorSheet(vendor);
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      applySheetStyles(ws);
      XLSX.utils.book_append_sheet(wb, ws, vendor.substring(0, 30));
      const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
      saveAs(new Blob([buf], { type: 'application/octet-stream' }),
        `班表_${vendor}_${selectedYear}${String(selectedMonth).padStart(2,'0')}.xlsx`);
      toast(`已匯出 ${vendor} 班表`, 'success');
    } catch (err) {
      toast('匯出失敗：' + err.message, 'error');
    }
  };

  const exportVendorPDF = (vendor) => {
    const rocYear = selectedYear - 1911;
    const emps = scopedEmployees.filter(e => e.vendor === vendor);
    const daysInMonth = days;
    const companyName = VENDOR_COMPANY_NAMES[vendor] ?? vendor;
    const WD = ['日','一','二','三','四','五','六'];
    const getCode = (emp, d) => schedule[emp.id]?.[dateKey(selectedYear, selectedMonth, d)] ?? 'V';
    const countCode = (emp, code) => { let c = 0; for (let d = 1; d <= daysInMonth; d++) if (getCode(emp,d)===code) c++; return c; };
    const monthHolidays = NATIONAL_HOLIDAYS.filter(h => h.year===selectedYear && h.month===selectedMonth);
    const getRemarks = (emp) => {
      const parts = [];
      for (const h of monthHolidays) {
        if (getCode(emp, h.day) !== '國') {
          for (let d = 1; d <= daysInMonth; d++) {
            if (getCode(emp, d) === '國') { parts.push(`原${selectedMonth}/${h.day}國定假日${h.name}調移至${selectedMonth}/${d}`); break; }
          }
        }
      }
      return parts.join('；');
    };
    const codeStyle = c => c==='休'?'color:#0070C0;font-weight:bold':c==='例'?'color:#7030A0;font-weight:bold':c==='國'?'color:#CC0000;font-weight:bold':'';
    const dayInfos = Array.from({length:daysInMonth},(_,i)=>{
      const d=i+1, wd=new Date(selectedYear,selectedMonth-1,d).getDay();
      return {d, month:selectedMonth, weekday:WD[wd], isSun:wd===0, isSat:wd===6};
    });

    // Inline style constants — avoid class-based styles which html2canvas may not honour
    const F  = "font-family:'微軟正黑體','Microsoft JhengHei',Arial,sans-serif;";
    const CS = `border:1px solid #AAA;padding:1px 2px;text-align:center;vertical-align:middle;font-size:7pt;${F}`;
    const HS  = CS + 'background:#4472C4;color:#fff;font-weight:bold;';
    const HDS = CS + 'background:#2F5496;color:#fff;font-weight:bold;';
    const HSG = CS + 'background:#F4B8A0;color:#333;font-weight:bold;';
    const HCN = CS + 'background:#4472C4;color:#fff;font-weight:bold;font-size:6pt;width:28px;';
    const HWK = CS + 'background:#2F5496;color:#fff;font-weight:bold;';  // weekend header
    const CNT = CS + 'background:#DEEAF1;';
    const SIG = CS + 'background:#FDE9D9;';
    const RMK = `border:1px solid #AAA;padding:1px 3px;text-align:left;white-space:normal;word-break:break-all;font-size:6.5pt;background:#FDE9D9;${F}`;

    const mCell = di => `<th style="${di.isSat||di.isSun?HWK:HS}width:14px;">${di.month}</th>`;
    const dCell = di => `<th style="${di.isSat||di.isSun?HWK:HS}width:14px;">${di.d}</th>`;
    const wCell = di => `<th style="${di.isSat||di.isSun?HWK:HS}width:14px;">${di.weekday}</th>`;
    const eDay  = ()  => `<th style="${HS}width:14px;"></th>`;
    const eCnt  = ()  => `<th style="${HS}width:28px;"></th>`;

    const monthCells = dayInfos.map(mCell).join('');
    const dateCells  = dayInfos.map(dCell).join('');
    const weekCells  = dayInfos.map(wCell).join('');
    const emptyDays  = dayInfos.map(eDay).join('');
    const emptyCount = eCnt()+eCnt()+eCnt()+eCnt();

    const empRows = emps.map((emp,idx)=>{
      const rowBg = idx%2===1 ? 'background:#FFF5F5;' : '';
      const dayCells = dayInfos.map(di=>{
        const code = getCode(emp,di.d);
        const bg = di.isSat||di.isSun ? 'background:#E8EDF7;' : rowBg;
        return `<td style="${CS}${bg}${codeStyle(code)}">${code}</td>`;
      }).join('');
      const leave=countCode(emp,'事')+countCode(emp,'病'), rest=countCode(emp,'休'),
            hol=countCode(emp,'例'), nat=countCode(emp,'國'), rmk=getRemarks(emp);
      return `<tr style="height:22px;">
        <td style="${CS}${rowBg}white-space:normal;word-break:break-all;">${esc(emp.empId)}</td>
        <td style="${CS}${rowBg}white-space:normal;word-break:break-word;">${esc(emp.name)}</td>
        ${dayCells}
        <td style="${CNT}">${leave}</td><td style="${CNT}">${rest}</td>
        <td style="${CNT}">${hol}</td><td style="${CNT}">${nat}</td>
        <td style="${SIG}"></td><td style="${SIG}"></td>
        <td style="${RMK}">${esc(rmk)}</td>
      </tr>`;
    }).join('');

    const html = `<div style="font-size:8pt;background:#fff;padding:0;margin:0;${F}">
<table style="width:100%;border-collapse:collapse;border:none;margin-bottom:3px;">
  <tr>
    <td style="border:none;color:#CC0000;font-weight:bold;font-size:12pt;white-space:nowrap;padding:0 10px 0 0;${F}">${companyName}</td>
    <td style="border:none;font-weight:bold;font-size:12pt;text-align:center;${F}">當月排班確認表</td>
    <td style="border:none;font-weight:bold;font-size:10pt;text-align:right;white-space:nowrap;${F}">確認排班區間：${rocYear}年${selectedMonth}月1日~${rocYear}年${selectedMonth}月${daysInMonth}日</td>
  </tr>
</table>
<table style="width:100%;border-collapse:collapse;border:none;margin-bottom:4px;">
  <tr>
    <td style="border:none;font-size:8pt;line-height:1.7;vertical-align:top;padding-right:8px;${F}">
      <div>1. 本表僅供當月排班及出勤／休假日確認使用，標示說明如下：實際出勤、請假、加班、補休及薪資計算，仍以公司系統紀錄及相關規定為準。</div>
      <div style="margin-left:12px">※班別／狀態說明：V＝出勤日&emsp;例＝例假日&emsp;休＝休假日&emsp;事＝事假&emsp;病＝病假&emsp;國＝國定假日</div>
      <div>2. 當月排班確認表經勞資雙方個別協商確認，員工簽名即同意配合公司實施八週彈性工時進行工作日、休息日及國定假日之調移，調移後之具體日期如本表所載。</div>
    </td>
    <td style="border:1.5px solid #999;width:165px;min-height:68px;text-align:center;vertical-align:middle;font-weight:bold;font-size:9pt;padding:5px;${F}">人力廠商 假別確認簽章</td>
  </tr>
</table>
<table style="border-collapse:collapse;width:100%;table-layout:fixed;">
  <colgroup>
    <col style="width:75px"><col style="width:90px">
    ${dayInfos.map(()=>`<col style="width:14px">`).join('')}
    <col style="width:28px"><col style="width:28px"><col style="width:28px"><col style="width:28px">
    <col style="width:60px"><col style="width:60px"><col style="width:120px">
  </colgroup>
  <thead>
    <tr>
      <th style="${HS}">月份</th><th style="${HS}"></th>
      ${monthCells}
      <th style="${HDS}" colspan="4">各假別計算</th>
      <th style="${HSG}" rowspan="4">員工簽名</th>
      <th style="${HSG}" rowspan="4">確認日期</th>
      <th style="${HSG}" rowspan="4">備註</th>
    </tr>
    <tr>
      <th style="${HS}">日期</th><th style="${HS}"></th>
      ${dateCells}
      <th style="${HCN}">請假<br>天數</th><th style="${HCN}">休假<br>天數</th>
      <th style="${HCN}">例假日<br>天數</th><th style="${HCN}">國定<br>假日<br>天數</th>
    </tr>
    <tr>
      <th style="${HS}">星期</th><th style="${HS}"></th>
      ${weekCells}
      ${emptyCount}
    </tr>
    <tr>
      <th style="${HS}">員工編號</th><th style="${HS}">員工姓名</th>
      ${emptyDays}${emptyCount}
    </tr>
  </thead>
  <tbody>${empRows}</tbody>
</table>
</div>`;

    toast(`正在產生 PDF，請稍候…`, 'info');

    // Use 'string' mode — html2pdf manages its own DOM lifecycle and render timing
    html2pdf().set({
      margin:       [8, 6, 8, 6],
      filename:     `班表_${vendor}_${rocYear}年${selectedMonth}月.pdf`,
      image:        { type: 'jpeg', quality: 0.97 },
      html2canvas:  { scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff' },
      jsPDF:        { unit: 'mm', format: 'a4', orientation: 'landscape' },
    }).from(html, 'string').save().then(() => {
      toast(`已下載 ${vendor} PDF 班表`, 'success');
    }).catch(err => {
      toast('PDF 產生失敗：' + err.message, 'error');
    });
  };

  const vendors = useMemo(() => [...new Set(scopedEmployees.map(e => e.vendor))], [scopedEmployees]);

  const exportAll = async () => {
    for (const v of vendors) exportVendor(v);
    toast(`批次匯出完成，共 ${vendors.length} 個廠商`, 'success');
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl font-bold text-slate-800">報表匯出</h2>
        <button onClick={exportAll}
          className="px-4 py-2 bg-slate-800 text-white rounded-lg text-sm hover:bg-slate-900">
          📦 批次匯出全部廠商
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {vendors.map(vendor => {
          const count = scopedEmployees.filter(e => e.vendor === vendor).length;
          return (
            <div key={vendor}
              className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col gap-3">
              <div>
                <div className="font-semibold text-slate-800">{vendor}</div>
                <div className="text-sm text-slate-500">{count} 人員</div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => exportVendor(vendor)}
                  className="flex-1 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
                  📊 匯出 Excel
                </button>
                <button onClick={() => exportVendorPDF(vendor)}
                  className="flex-1 py-1.5 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700">
                  📄 匯出 PDF
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-700">
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
};
const getHolidayShort = (h, springIdx) => {
  if (h.name === '春節') return ['初一','初二','初三'][springIdx] ?? '春節';
  return HOLIDAY_SHORT[h.name] ?? h.name;
};
// key 格式: "year-month-day"
const holidayKey = (h) => `${h.year}-${h.month}-${h.day}`;

function Settings() {
  const {
    systemLocked, setSystemLocked,
    scheduleRange, setScheduleRange,
    openHolidays, setOpenHolidays,
    vendors, setVendors,
    warehouses, setWarehouses,
    selectedYear,
  } = useApp();
  const toast = useToast();

  const vendorNames = vendors.map(v => v.name);

  const [start, setStart] = useState(scheduleRange.start ?? '');
  const [end,   setEnd]   = useState(scheduleRange.end   ?? '');

  // ── 廠商別 modal 狀態 ──
  const emptyVd = { id: '', code: '', name: '' };
  const [vdModal,  setVdModal]  = useState(false);
  const [vdTarget, setVdTarget] = useState(null);
  const [vdForm,   setVdForm]   = useState(emptyVd);

  const openAddVd  = () => { setVdForm(emptyVd); setVdTarget(null); setVdModal(true); };
  const openEditVd = vd => { setVdForm({ ...vd }); setVdTarget(vd); setVdModal(true); };

  const saveVd = () => {
    if (!vdForm.name.trim()) { toast('廠商名稱為必填', 'error'); return; }
    if (vendors.some(v => v.name === vdForm.name.trim() && v.id !== vdForm.id)) {
      toast('已有相同廠商名稱', 'error'); return;
    }
    const updated = { ...vdForm, name: vdForm.name.trim(), code: vdForm.code.trim().toUpperCase() };
    if (vdTarget) {
      setVendors(prev => prev.map(v => v.id === updated.id ? updated : v));
      toast('廠商已更新：' + updated.name, 'success');
    } else {
      setVendors(prev => [...prev, { ...updated, id: 'vd_' + Date.now() }]);
      toast('已新增廠商：' + updated.name, 'success');
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

  const saveRange = () => {
    if (start && end && start > end) {
      toast('結束日期不可早於開始日期', 'error'); return;
    }
    setScheduleRange({ start, end });
    toast('開放排班日期區間已儲存', 'success');
  };

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

      {/* ── 系統鎖定 ── */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h3 className="font-semibold text-slate-700 mb-3">系統鎖定</h3>
        <div className="flex items-center justify-between">
          <div className="text-sm text-slate-600">
            {systemLocked ? '🔒 目前已鎖定，所有幹部無法修改班表' : '🔓 目前未鎖定，幹部可正常編輯班表'}
          </div>
          <button
            onClick={() => {
              setSystemLocked(p => !p);
              toast(systemLocked ? '系統已解鎖' : '系統已鎖定', systemLocked ? 'info' : 'warn');
            }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors
              ${systemLocked
                ? 'bg-green-600 hover:bg-green-700 text-white'
                : 'bg-red-600 hover:bg-red-700 text-white'}`}>
            {systemLocked ? '解除鎖定' : '鎖定系統'}
          </button>
        </div>
      </div>

      {/* ── 開放排班日期區間 ── */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h3 className="font-semibold text-slate-700 mb-3">開放排班日期區間</h3>
        <p className="text-xs text-slate-500 mb-3">設定後，僅允許在此區間內編輯班表。留空表示不限制。</p>
        <div className="flex gap-3 items-end flex-wrap">
          <div>
            <label className="block text-xs text-slate-600 mb-1">開始日期</label>
            <input type="date" value={start} onChange={e => setStart(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-slate-600 mb-1">結束日期</label>
            <input type="date" value={end} onChange={e => setEnd(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />
          </div>
          <button onClick={saveRange}
            className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
            儲存
          </button>
          <button onClick={() => { setStart(''); setEnd(''); setScheduleRange({}); toast('已清除日期限制', 'info'); }}
            className="px-4 py-1.5 border border-slate-300 rounded-lg text-sm hover:bg-slate-50">
            清除
          </button>
        </div>
        {scheduleRange.start && (
          <p className="mt-3 text-xs text-blue-600">
            目前區間：{scheduleRange.start} ～ {scheduleRange.end}
          </p>
        )}
      </div>

      {/* ── 開放排班國定假日 ── */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h3 className="font-semibold text-slate-700 mb-1">開放排班國定假日</h3>
        <p className="text-xs text-slate-500 mb-4">
          依上方開放排班日期區間自動篩選範圍內的國定假日。勾選後班表中「國」將顯示假日短名（如端午、元旦）。
          {!scheduleRange.start && <span className="text-amber-600 ml-1">（請先設定開放排班日期區間）</span>}
        </p>
        {(() => {
          // 解析區間
          const parseLocal = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); };
          const rangeStart = scheduleRange.start ? parseLocal(scheduleRange.start) : null;
          const rangeEnd   = scheduleRange.end   ? parseLocal(scheduleRange.end)   : null;

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
                  className="px-3 py-1 text-xs border border-slate-300 rounded-lg hover:bg-slate-50">全不選</button>
              </div>
              <div className="flex flex-wrap gap-2">
                {holidays.map(h => {
                  const checked = openHolidays.includes(h.key);
                  return (
                    <label key={h.key}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border cursor-pointer text-sm transition-colors
                        ${checked ? 'bg-blue-50 border-blue-400 text-blue-800' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
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
      </div>

      {/* ── 廠商別維護 ── */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-slate-700">廠商別維護</h3>
            <p className="text-xs text-slate-400 mt-0.5">管理系統中所有委外廠商，新增後即可在帳號管理與倉別設定中使用。</p>
          </div>
          <button onClick={openAddVd}
            className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
            ➕ 新增廠商
          </button>
        </div>

        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
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
                <tr key={vd.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                      {vd.code || '—'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-medium text-slate-800">{vd.name}</td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => openEditVd(vd)}
                        className="px-2.5 py-1 text-xs border border-slate-300 rounded-lg hover:bg-slate-50 text-slate-600">
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
      </div>

      {/* ── 倉別 × 課別 × 廠商別維護 ── */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-slate-700">倉別 × 課別 × 廠商別維護</h3>
            <p className="text-xs text-slate-400 mt-0.5">每個倉可設定多個課別，每個課別再配置所屬廠商。</p>
          </div>
          <button onClick={openAddWh}
            className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
            ➕ 新增倉別
          </button>
        </div>

        {warehouses.length === 0 && (
          <p className="text-sm text-slate-400 text-center py-6">尚未設定任何倉別</p>
        )}

        <div className="space-y-4">
          {warehouses.map(wh => (
            <div key={wh.id} className="border border-slate-200 rounded-xl overflow-hidden">
              {/* 倉別 header */}
              <div className="flex items-center justify-between bg-slate-50 px-4 py-2.5 border-b border-slate-200">
                <span className="font-bold text-slate-800">🏭 {wh.name}</span>
                <div className="flex gap-2">
                  <button onClick={() => openAddDept(wh.id)}
                    className="px-2.5 py-1 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700">
                    ＋ 新增課別
                  </button>
                  <button onClick={() => openEditWh(wh)}
                    className="px-2.5 py-1 text-xs border border-slate-300 rounded-lg hover:bg-white text-slate-600">
                    編輯
                  </button>
                  <button onClick={() => deleteWh(wh.id)}
                    className="px-2.5 py-1 text-xs border border-red-200 rounded-lg hover:bg-red-50 text-red-600">
                    刪除
                  </button>
                </div>
              </div>

              {/* 課別列表 */}
              {(wh.departments ?? []).length === 0 ? (
                <p className="text-xs text-slate-400 italic px-4 py-3">尚未設定課別，點「新增課別」開始</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {(wh.departments ?? []).map(dept => (
                    <div key={dept.id} className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50">
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
                                  className="px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200
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
                          className="px-2.5 py-1 text-xs border border-slate-300 rounded-lg hover:bg-white text-slate-600">
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
      </div>

      {/* ── 廠商別新增/編輯 Modal ── */}
      {vdModal && (
        <Modal onClose={() => setVdModal(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6">
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
                className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm uppercase" />
            </div>
            <div className="mb-5">
              <label className="block text-sm font-medium text-slate-700 mb-1">
                廠商名稱 <span className="text-red-400">*</span>
              </label>
              <input value={vdForm.name}
                onChange={e => setVdForm(p => ({ ...p, name: e.target.value }))}
                placeholder="例如：承杺"
                className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setVdModal(false)}
                className="px-4 py-2 border border-slate-300 rounded-lg text-sm hover:bg-slate-50">
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
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6">
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
                className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setWhModal(false)}
                className="px-4 py-2 border border-slate-300 rounded-lg text-sm hover:bg-slate-50">
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
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
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
                className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-1">
                課別名稱 <span className="text-red-400">*</span>
              </label>
              <input value={deptForm.name}
                onChange={e => setDeptForm(p => ({ ...p, name: e.target.value }))}
                placeholder="例如：大肚理貨課"
                className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />
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
                                        ? 'bg-blue-50 border-blue-400 text-blue-800'
                                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
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
                  className="flex-1 border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />
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
                className="px-4 py-2 border border-slate-300 rounded-lg text-sm hover:bg-slate-50">
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

const PRESET_TIMES = Array.from({length: 48}, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, '0');
  const m = i % 2 === 0 ? '00' : '30';
  return h + m;
});

function ShiftSetup() {
  const { employees, setEmployees, vendors, warehouses, selectedWarehouse, selectedDept, selectedGroup, currentUser } = useApp();
  const toast = useToast();

  // 班別定義 list: { id, name, startTime, endTime, color }
  const [shiftTypes, setShiftTypes] = useState(() => {
    const saved = localStorage.getItem('sms_shift_types');
    return saved ? JSON.parse(saved) : [
      { id: 'st1', name: '日班', startTime: '0800', endTime: '1700', color: 'bg-blue-100 text-blue-800' },
      { id: 'st2', name: '晚班', startTime: '1900', endTime: '0300', color: 'bg-purple-100 text-purple-800' },
      { id: 'st3', name: '夜班', startTime: '2300', endTime: '0700', color: 'bg-slate-100 text-slate-800' },
    ];
  });
  useEffect(() => { localStorage.setItem('sms_shift_types', JSON.stringify(shiftTypes)); }, [shiftTypes]);

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
    if (editTypeId) {
      setShiftTypes(p => p.map(t => t.id === editTypeId ? { ...typeForm, id: editTypeId } : t));
      toast('班別已更新', 'success');
    } else {
      setShiftTypes(p => [...p, { ...typeForm, id: 'st' + Date.now() }]);
      toast('班別已新增', 'success');
    }
    setShowTypeModal(false);
  };

  const deleteType = id => {
    setShiftTypes(p => p.filter(t => t.id !== id));
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
  const visibleEmps = (() => {
    let list = currentUser?.role === ROLES.VENDOR
      ? employees.filter(e => currentUser.vendors.includes(e.vendor))
      : employees;
    list = filterByScope(list, warehouses, selectedWarehouse, selectedDept, selectedGroup);
    return list.filter(e => {
      if (filterVendor && e.vendor !== filterVendor) return false;
      if (filterShift  && e.shiftTypeId !== filterShift) return false;
      if (nameSearchSetup.trim()) {
        const q = nameSearchSetup.trim().toLowerCase();
        if (!(e.name ?? '').toLowerCase().includes(q) && !(e.empId ?? '').toLowerCase().includes(q)) return false;
      }
      return true;
    }).sort((a, b) => {
      // 未指派班別的員工排最上方
      const aSet = !!a.shiftTypeId, bSet = !!b.shiftTypeId;
      if (aSet !== bSet) return aSet ? 1 : -1;
      return 0;
    });
  })();

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-xl font-bold text-slate-800">人員班別設定</h2>

      {/* ── 班別時段管理 ── */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-700">班別時段管理</h3>
          <button onClick={openAddType}
            className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
            ➕ 新增班別
          </button>
        </div>
        <div className="flex flex-wrap gap-3">
          {shiftTypes.map(t => (
            <div key={t.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${t.color} border-opacity-40`}>
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
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h3 className="font-semibold text-slate-700 mb-3">班別匯入</h3>
        <p className="text-xs text-slate-500 mb-3">Excel 欄位（依序）：員工編號、姓名、上班時間、下班時間　範例：CY10901361 / 林雅蔆 / 0900 / 1800</p>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleImport} className="hidden" />
        <button onClick={() => fileRef.current.click()}
          className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700">
          📂 選擇 Excel 檔案匯入
        </button>
      </div>

      {/* ── 人員班別指派 ── */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="font-semibold text-slate-700">人員班別指派</h3>
          <div className="flex gap-2 flex-wrap items-center">
            <input value={nameSearchSetup} onChange={e => setNameSearchSetup(e.target.value)}
              placeholder="搜尋姓名／員工編號…"
              className="px-2 py-1 border border-slate-300 rounded-lg text-sm w-44" />
            <select value={filterVendor} onChange={e => setFilterVendor(e.target.value)}
              className="px-2 py-1 border border-slate-300 rounded-lg text-sm">
              <option value="">全部廠商</option>
              {vendorNames.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
            <select value={filterShift} onChange={e => setFilterShift(e.target.value)}
              className="px-2 py-1 border border-slate-300 rounded-lg text-sm">
              <option value="">全部班別</option>
              {sortedShiftTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              <option value="none">未指派</option>
            </select>
          </div>
        </div>

        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-100">
              <tr>
                {['員工編號','姓名','廠商','班別指派','上班時間','下班時間'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left font-semibold text-slate-600 text-xs">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleEmps.map((emp, idx) => {
                const st = shiftTypes.find(t => t.id === emp.shiftTypeId);
                return (
                  <tr key={emp.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                    <td className="px-4 py-2 font-mono text-xs text-slate-500">{emp.empId}</td>
                    <td className="px-4 py-2 font-medium text-slate-800">{emp.name}</td>
                    <td className="px-4 py-2 text-slate-500 text-xs">{emp.vendor || '—'}</td>
                    <td className="px-4 py-2">
                      <select value={emp.shiftTypeId ?? ''}
                        onChange={e => assignShift(emp.id, e.target.value)}
                        className="px-2 py-1 border border-slate-300 rounded text-xs">
                        <option value="">── 未指派 ──</option>
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
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="font-bold text-lg text-slate-800">{editTypeId ? '編輯班別' : '新增班別'}</h3>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">班別名稱</label>
              <input value={typeForm.name} onChange={e => setTypeForm(p => ({ ...p, name: e.target.value }))}
                placeholder="例：日班、夜班"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-sm font-medium text-slate-700 mb-1">上班時間</label>
                <select value={typeForm.startTime} onChange={e => setTypeForm(p => ({ ...p, startTime: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {PRESET_TIMES.map(t => <option key={t} value={t}>{t.slice(0,2)}:{t.slice(2)}</option>)}
                </select>
              </div>
              <div className="flex-1">
                <label className="block text-sm font-medium text-slate-700 mb-1">下班時間</label>
                <select value={typeForm.endTime} onChange={e => setTypeForm(p => ({ ...p, endTime: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
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
                className="flex-1 py-2 border border-slate-300 text-slate-600 rounded-lg text-sm hover:bg-slate-50">取消</button>
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

  // ── 資料狀態：可由 Excel 匯入更新，預設用內建常數，localStorage 持久化 ──
  const [headers, setHeaders] = useState(() =>
    LS.get('sms_shiftcode_headers', SHIFT_CODE_HEADERS)
  );
  const [rows, setRows] = useState(() =>
    LS.get('sms_shiftcode_rows', SHIFT_CODE_ROWS)
  );
  const [importedAt, setImportedAt] = useState(() =>
    LS.get('sms_shiftcode_imported_at', null)
  );

  useEffect(() => { LS.set('sms_shiftcode_headers',     headers);    }, [headers]);
  useEffect(() => { LS.set('sms_shiftcode_rows',        rows);       }, [rows]);
  useEffect(() => { LS.set('sms_shiftcode_imported_at', importedAt); }, [importedAt]);

  const [search, setSearch] = useState('');
  const [editingCell, setEditingCell] = useState(null); // { ri, ci }
  const [editValue,   setEditValue]   = useState('');
  const editRef = useRef();

  const startEdit = (ri, ci, val) => {
    setEditingCell({ ri, ci });
    setEditValue(val);
    setTimeout(() => editRef.current?.select(), 0);
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
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast('檔案過大，上限 10 MB', 'error'); e.target.value = ''; return; }
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, { type: 'binary', cellFormula: false, cellHTML: false });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1 });

        if (rawRows.length < 2) { toast('檔案無有效資料', 'error'); return; }

        // 第一列為表頭（上班時間, 上班代號, 休假代號, ...假日名稱）
        const rawHeaders = rawRows[0];
        // 取第2欄以後為欄標題（跳過「上班時間」）
        const newHeaders = rawHeaders.slice(1).map(h => (h ?? '').toString().trim()).filter(Boolean);

        if (!newHeaders.length) { toast('無法識別表頭欄位', 'error'); return; }

        // 時間欄：Excel 儲存為小數分數，轉為 HH:MM
        const fracToTime = (frac) => {
          if (typeof frac === 'string' && frac.includes(':')) return frac.trim(); // 已是字串時間
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
    e.target.value = '';
  };

  const handleReset = () => {
    setHeaders(SHIFT_CODE_HEADERS);
    setRows(SHIFT_CODE_ROWS);
    setImportedAt(null);
    toast('已還原為內建預設資料', 'info');
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
      {/* 標題列 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">班別代號對照表</h2>
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
              className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm w-44
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
              className="px-3 py-1.5 border border-slate-300 text-slate-600 rounded-lg text-sm
                         hover:bg-slate-50 whitespace-nowrap">
              ↩ 還原預設
            </button>
          )}
        </div>
      </div>

      {/* 搜尋結果提示 */}
      {searchResult !== null && (
        <div className={`px-4 py-2.5 rounded-lg text-sm ${
          searchResult.length > 0
            ? 'bg-blue-50 border border-blue-200 text-blue-700'
            : 'bg-slate-50 border border-slate-200 text-slate-500'
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
        <span className="text-slate-400 ml-2">✏️ 點擊儲存格可直接編輯代號</span>
      </div>

      {/* 表格 */}
      <div className="border border-slate-200 rounded-xl overflow-hidden">
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
                <tr key={ri} className={ri % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
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

function PermissionManagement() {
  const { users, setUsers } = useApp();
  const toast = useToast();

  const roleLabel = { admin: '管理員', area: '當區幹部', vendor: '委外幹部' };
  const roleBadge = { admin: 'bg-red-100 text-red-700', area: 'bg-purple-100 text-purple-700', vendor: 'bg-blue-100 text-blue-700' };

  const toggleApproved = (u) => {
    if (u.username === 'Grace' || u.username === 'reyi') {
      toast('系統帳號不可停用', 'error'); return;
    }
    setUsers(prev => prev.map(x => x.id === u.id ? { ...x, approved: !x.approved } : x));
    toast((u.approved ? '已停用：' : '已啟用：') + u.username, u.approved ? 'warn' : 'success');
  };

  const togglePerm = (userId, pageKey, featKey, val) => {
    setUsers(prev => prev.map(u => {
      if (u.id !== userId) return u;
      const perms = { ...u.permissions };
      const page  = { ...perms[pageKey] };
      if (featKey === 'view') {
        // 關閉 view 時連帶關閉所有子功能
        page.view = val;
        if (!val) {
          PAGE_PERMISSIONS.find(p => p.key === pageKey)?.features.forEach(f => { page[f.key] = false; });
        }
      } else {
        page[featKey] = val;
        if (val) page.view = true; // 開啟子功能時確保 view 也開啟
      }
      perms[pageKey] = page;
      return { ...u, permissions: perms };
    }));
  };

  const [expandedId, setExpandedId] = useState(null);
  const [activeTab,  setActiveTab]  = useState('staff'); // 'staff' | 'vendor'

  const staffUsers  = users.filter(u => u.role !== ROLES.VENDOR);
  const vendorUsers = users.filter(u => u.role === ROLES.VENDOR);
  const tabUsers    = activeTab === 'staff' ? staffUsers : vendorUsers;

  const TAB_CFG = [
    { key: 'staff',  label: '員工',  icon: '🏢', count: staffUsers.length },
    { key: 'vendor', label: '廠商',  icon: '🤝', count: vendorUsers.length },
  ];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3 mb-2">
        <span className="text-2xl">👤</span>
        <h2 className="text-xl font-bold text-slate-800">系統權限與成員管理</h2>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        {TAB_CFG.map(t => (
          <button key={t.key}
            onClick={() => { setActiveTab(t.key); setExpandedId(null); }}
            className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-t-lg
                        border border-b-0 transition-colors
                        ${activeTab === t.key
                          ? 'bg-white border-slate-200 text-blue-600 -mb-px z-10'
                          : 'bg-slate-50 border-transparent text-slate-500 hover:text-slate-700'}`}>
            <span>{t.icon}</span>
            <span>{t.label}</span>
            <span className={`px-1.5 py-0.5 rounded-full text-xs
                              ${activeTab === t.key ? 'bg-blue-100 text-blue-600' : 'bg-slate-200 text-slate-500'}`}>
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {/* Header */}
      <div className="grid text-xs font-semibold text-slate-500 uppercase tracking-wide
                      bg-slate-100 rounded-t-xl px-4 py-2.5 border border-slate-200"
           style={{ gridTemplateColumns: '1fr 1fr 100px 70px 160px 120px' }}>
        <span>帳號</span>
        <span>名稱</span>
        <span>角色</span>
        <span>登入次數</span>
        <span>審核狀態</span>
        <span>分頁權限</span>
      </div>

      <div className="border border-slate-200 rounded-b-xl divide-y divide-slate-100 overflow-hidden">
        {tabUsers.map(u => {
          const perms = u.permissions ?? getDefaultPermissions(u.role);
          const isOpen = expandedId === u.id;
          const visibleCount = PAGE_PERMISSIONS.filter(p => perms[p.key]?.view).length;

          return (
            <div key={u.id}>
              {/* ── 摘要列 ── */}
              <div className="grid items-center gap-3 px-4 py-3 hover:bg-slate-50 cursor-default"
                   style={{ gridTemplateColumns: '1fr 1fr 100px 70px 160px 120px' }}>

                <span className="font-bold text-slate-800 text-sm">{u.username}</span>
                <span className="text-slate-600 text-sm">{u.name}</span>

                <span className={`px-2 py-0.5 rounded-full text-xs font-medium w-fit ${roleBadge[u.role]}`}>
                  {roleLabel[u.role]}
                </span>

                <span className="text-blue-600 font-bold text-center">{u.loginCount ?? 0}</span>

                <button
                  onClick={() => toggleApproved(u)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors w-fit
                    ${u.approved !== false
                      ? 'bg-green-100 text-green-700 hover:bg-green-200'
                      : 'bg-red-100 text-red-700 hover:bg-red-200'}`}>
                  {u.approved !== false ? '已核准（點擊停用）' : '已停用（點擊啟用）'}
                </button>

                {/* 展開按鈕 + 摘要 */}
                <button
                  onClick={() => setExpandedId(isOpen ? null : u.id)}
                  className="flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-800
                             bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-colors w-fit">
                  <span>{isOpen ? '▲ 收合' : '▼ 設定權限'}</span>
                  <span className="text-indigo-400">({visibleCount}/{PAGE_PERMISSIONS.length})</span>
                </button>
              </div>

              {/* ── 展開：細部權限 ── */}
              {isOpen && (
                <div className="bg-slate-50 border-t border-slate-200 px-6 py-4">
                  {u.role === ROLES.ADMIN && (
                    <p className="text-xs text-slate-400 italic mb-3">超級管理員擁有全部權限，無法調整。</p>
                  )}
                  <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
                    {PAGE_PERMISSIONS.map(page => {
                      const pagePerm = perms[page.key] ?? { view: false };
                      return (
                        <div key={page.key}
                             className="bg-white rounded-xl border border-slate-200 p-3 space-y-2">
                          {/* 頁面可視 */}
                          <label className="flex items-center gap-2 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={!!pagePerm.view}
                              onChange={e => togglePerm(u.id, page.key, 'view', e.target.checked)}
                              className="rounded accent-blue-600"
                              disabled={u.role === ROLES.ADMIN}
                            />
                            <span className="text-sm font-semibold text-slate-700">{page.label}</span>
                            <span className="text-xs text-slate-400 ml-auto">可視</span>
                          </label>

                          {/* 子功能 */}
                          {page.features.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 pl-5">
                              {page.features.map(f => (
                                <label key={f.key} className="flex items-center gap-1 cursor-pointer select-none">
                                  <input
                                    type="checkbox"
                                    checked={!!pagePerm[f.key]}
                                    onChange={e => togglePerm(u.id, page.key, f.key, e.target.checked)}
                                    className="rounded accent-indigo-500"
                                    disabled={u.role === ROLES.ADMIN}
                                  />
                                  <span className={`text-xs px-1.5 py-0.5 rounded-full border
                                    ${pagePerm[f.key]
                                      ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                                      : 'bg-slate-50 text-slate-400 border-slate-200'}`}>
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
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AccountManagement() {
  const { users, setUsers, vendors, warehouses } = useApp();
  const vendorNames = vendors.map(v => v.name);
  const toast = useToast();
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState(null);

  const emptyForm = { id: '', username: '', password: '', name: '', role: ROLES.VENDOR, vendors: [], allowedWarehouses: [] };
  const [form, setForm] = useState(emptyForm);

  const openAdd = () => { setForm(emptyForm); setEditUser(null); setShowModal(true); };
  const openEdit = u => { setForm({ ...u }); setEditUser(u); setShowModal(true); };

  const handleSave = () => {
    if (!form.username || !form.password || !form.name) {
      toast('帳號、密碼、姓名為必填', 'error'); return;
    }
    if (editUser) {
      setUsers(prev => prev.map(u => u.id === form.id ? form : u));
      toast('帳號已更新：' + form.username, 'success');
    } else {
      setUsers(prev => [...prev, { ...form, id: 'u' + Date.now() }]);
      toast('帳號已新增：' + form.username, 'success');
    }
    setShowModal(false);
  };

  const handleDelete = id => {
    if (id === 'u1') { toast('無法刪除系統管理員帳號', 'error'); return; }
    setUsers(prev => prev.filter(u => u.id !== id));
    toast('帳號已刪除', 'info');
  };

  const handleApprove = id => {
    setUsers(prev => prev.map(u => u.id === id ? { ...u, approved: true } : u));
    toast('帳號已核准，廠商可立即登入', 'success');
  };

  const handleReject = id => {
    setUsers(prev => prev.filter(u => u.id !== id));
    toast('申請已拒絕並刪除', 'info');
  };

  const pendingUsers = users.filter(u => u.approved === false);

  const toggleVendor = v => {
    setForm(p => ({
      ...p,
      vendors: p.vendors.includes(v) ? p.vendors.filter(x => x !== v) : [...p.vendors, v],
    }));
  };

  const toggleWarehouse = whId => {
    setForm(p => ({
      ...p,
      allowedWarehouses: (p.allowedWarehouses ?? []).includes(whId)
        ? (p.allowedWarehouses ?? []).filter(x => x !== whId)
        : [...(p.allowedWarehouses ?? []), whId],
    }));
  };

  const roleLabel = { admin: '管理員', area: '當區幹部', vendor: '委外幹部' };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-800">帳號管理</h2>
        <button onClick={openAdd}
          className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
          ➕ 新增帳號
        </button>
      </div>

      {/* 待審核申請 */}
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
                <button onClick={() => handleApprove(u.id)}
                  className="px-3 py-1 bg-emerald-600 text-white text-xs rounded-lg hover:bg-emerald-700">核准</button>
                <button onClick={() => handleReject(u.id)}
                  className="px-3 py-1 bg-red-500 text-white text-xs rounded-lg hover:bg-red-600">拒絕</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-100">
            <tr>
              {['帳號', '姓名', '角色', '授權廠商', '可使用倉別', '操作'].map(h => (
                <th key={h} className="px-4 py-3 text-left font-semibold text-slate-600">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map(u => (
              <tr key={u.id} className="hover:bg-slate-50">
                <td className="px-4 py-2.5 font-mono text-slate-700">{u.username}</td>
                <td className="px-4 py-2.5">{u.name}</td>
                <td className="px-4 py-2.5">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium
                    ${u.role === ROLES.ADMIN ? 'bg-red-100 text-red-700'
                    : u.role === ROLES.AREA ? 'bg-purple-100 text-purple-700'
                    : 'bg-blue-100 text-blue-700'}`}>
                    {roleLabel[u.role]}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-slate-500 text-xs">
                  {u.role === ROLES.ADMIN ? '全部廠商' : u.vendors.join('、') || '—'}
                </td>
                <td className="px-4 py-2.5 text-xs">
                  {u.role === ROLES.ADMIN || !(u.allowedWarehouses?.length)
                    ? <span className="text-slate-400">全部倉別</span>
                    : <div className="flex flex-wrap gap-1">
                        {u.allowedWarehouses.map(whId => {
                          const wh = warehouses.find(w => w.id === whId);
                          return wh ? (
                            <span key={whId} className="px-1.5 py-0.5 bg-teal-50 text-teal-700
                                                         border border-teal-200 rounded-full">
                              {wh.name}
                            </span>
                          ) : null;
                        })}
                      </div>
                  }
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex gap-2">
                    <button onClick={() => openEdit(u)} className="text-blue-600 hover:text-blue-800 text-xs">編輯</button>
                    <button onClick={() => handleDelete(u.id)} className="text-red-500 hover:text-red-700 text-xs">刪除</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {showModal && (
        <Modal onClose={() => setShowModal(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
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
                  className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />
              </div>
            ))}
            <div className="mb-3">
              <label className="block text-sm font-medium text-slate-700 mb-1">角色</label>
              <select value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}
                className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm">
                <option value={ROLES.ADMIN}>管理員</option>
                <option value={ROLES.AREA}>當區幹部</option>
                <option value={ROLES.VENDOR}>委外幹部</option>
              </select>
            </div>
            {form.role !== ROLES.ADMIN && (
              <div className="mb-3">
                <label className="block text-sm font-medium text-slate-700 mb-2">授權廠商</label>
                <div className="flex flex-wrap gap-2">
                  {vendorNames.map(v => (
                    <label key={v} className="flex items-center gap-1.5 cursor-pointer text-sm">
                      <input type="checkbox" checked={form.vendors.includes(v)} onChange={() => toggleVendor(v)}
                        className="rounded" />
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
                    <input
                      type="checkbox"
                      checked={(form.allowedWarehouses ?? []).includes(w.id)}
                      onChange={() => toggleWarehouse(w.id)}
                      disabled={form.role === ROLES.ADMIN}
                      className="rounded accent-teal-600"
                    />
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
                className="px-4 py-2 border border-slate-300 rounded-lg text-sm hover:bg-slate-50">取消</button>
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
    // 補齊新欄位（舊 localStorage 可能沒有）
    saved = saved.map(u => ({
      approved: true, loginCount: 0, allowedWarehouses: [],
      permissions: getDefaultPermissions(u.role),
      ...u,
    }));
    const DEMO  = mkUser('u0', 'reyi',  '8963', ROLES.ADMIN, 'Demo管理員', SEED_VENDORS.map(v=>v.name));
    const GRACE = mkUser('ug', 'Grace', '0721', ROLES.ADMIN, 'Grace',      SEED_VENDORS.map(v=>v.name));
    if (!saved.some(u => u.username === 'reyi'))  saved = [DEMO,  ...saved];
    if (!saved.some(u => u.username === 'Grace')) saved = [GRACE, ...saved];
    return saved;
  });
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
  const [selectedWarehouse, setSelectedWarehouse] = useState(() => LS.get('sms_sel_wh',    null));
  const [selectedDept,      setSelectedDept]      = useState(() => LS.get('sms_sel_dept',  null));
  const [selectedGroup,     setSelectedGroup]     = useState(() => LS.get('sms_sel_grp',   null));
  const [systemLocked,  setSystemLocked]  = useState(() => LS.get('sms_locked',     false));
  const [scheduleRange, setScheduleRange] = useState(() => LS.get('sms_range',      {}));
  const [openHolidays,  setOpenHolidays]  = useState(() => LS.get('sms_open_holidays', []));
  const [selectedYear,  setSelectedYear]  = useState(() => LS.get('sms_year',       today.getFullYear()));
  const [selectedMonth, setSelectedMonth] = useState(() => LS.get('sms_month',      today.getMonth() + 1));

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

  // ── Session state ──
  const [currentUser,  setCurrentUser]  = useState(null);
  const [currentPage,  setCurrentPage]  = useState('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen,    setMobileNavOpen]    = useState(false);

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
  useEffect(() => { LS.set('sms_users',      users,         storageWarn); }, [users]);
  useEffect(() => { LS.set('sms_employees',  employees,     storageWarn); }, [employees]);
  useEffect(() => { LS.set('sms_vendors',    vendors);            }, [vendors]);
  useEffect(() => { LS.set('sms_warehouses', warehouses);         }, [warehouses]);
  useEffect(() => { LS.set('sms_sel_wh',    selectedWarehouse);   }, [selectedWarehouse]);
  useEffect(() => { LS.set('sms_sel_dept',  selectedDept);        }, [selectedDept]);
  useEffect(() => { LS.set('sms_sel_grp',   selectedGroup);       }, [selectedGroup]);
  useEffect(() => { LS.set('sms_schedule',   schedule,      storageWarn); }, [schedule]);
  useEffect(() => { LS.set('sms_locked',         systemLocked);  }, [systemLocked]);
  useEffect(() => { LS.set('sms_range',          scheduleRange); }, [scheduleRange]);
  useEffect(() => { LS.set('sms_open_holidays',  openHolidays);  }, [openHolidays]);
  useEffect(() => { LS.set('sms_year',      selectedYear);  }, [selectedYear]);
  useEffect(() => { LS.set('sms_month',     selectedMonth); }, [selectedMonth]);

  const handleLogout = () => { setCurrentUser(null); setCurrentPage('dashboard'); };

  const handleLogin = useCallback((user) => {
    // user.password 此時已是 sha256:... (由 LoginScreen 升級後傳入)
    const updated = { ...user, loginCount: (user.loginCount ?? 0) + 1 };
    setUsers(prev => prev.map(u => u.id === user.id ? updated : u));
    setCurrentUser(updated);
  }, []);

  const ctx = {
    users, setUsers,
    employees, setEmployees,
    vendors, setVendors,
    warehouses, setWarehouses,
    selectedWarehouse, setSelectedWarehouse,
    selectedDept, setSelectedDept,
    selectedGroup, setSelectedGroup,
    schedule, setSchedule,
    systemLocked, setSystemLocked,
    scheduleRange, setScheduleRange,
    openHolidays, setOpenHolidays,
    selectedYear, setSelectedYear,
    selectedMonth, setSelectedMonth,
    currentUser,
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
    permissions: <PermissionManagement />,
  };

  if (!currentUser) {
    return (
      <ToastProvider>
        <LoginScreen users={users} onLogin={handleLogin} onRegister={u => setUsers(prev => [...prev, u])} vendors={vendors} />
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      <AppContext.Provider value={ctx}>
        <div className="flex h-screen bg-slate-50 overflow-hidden">
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
            <header className="md:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200">
              <button onClick={() => setMobileNavOpen(true)} className="text-slate-600 text-2xl">☰</button>
              <span className="font-semibold text-slate-800">委外人力排班作業平台</span>
              <span className="text-sm text-slate-500">{currentUser.name}</span>
            </header>

            {/* 全域倉別 / 課別選擇列 */}
            <WarehouseDeptBar />

            <div className="flex-1 overflow-y-auto">
              {PAGE_MAP[currentPage] ?? <Dashboard />}
            </div>
          </main>
        </div>
      </AppContext.Provider>
    </ToastProvider>
  );
}
