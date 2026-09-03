const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, WidthType, ShadingType, VerticalAlign, PageBreak,
} = require('docx');
const fs = require('fs');
const path = require('path');

const TIMESTAMP = process.argv[2];
const DIR = process.cwd();
const OUT = path.join(DIR, `security-report-${TIMESTAMP}.docx`);
const DATE = TIMESTAMP.slice(0,4)+'-'+TIMESTAMP.slice(4,6)+'-'+TIMESTAMP.slice(6,8);

const shade = f => ({ type: ShadingType.CLEAR, color: 'auto', fill: f });
const cell = (text, fill, bold=false, w=2200) => new TableCell({
  width: { size: w, type: WidthType.DXA }, shading: shade(fill),
  verticalAlign: VerticalAlign.CENTER,
  margins: { top: 80, bottom: 80, left: 120, right: 120 },
  children: String(text).split('\n').map(t => new Paragraph({ children: [new TextRun({ text: t, bold, size: 18 })] })),
});
const hdr = (t, lv) => new Paragraph({ heading: lv, spacing: { before: 240, after: 120 },
  children: [new TextRun({ text: t, bold: true, size: lv === HeadingLevel.HEADING_1 ? 28 : 24 })] });
const p = (t, sz=20) => new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: t, size: sz })] });

const SEV = { Critical:'FECACA', High:'FED7AA', Medium:'FEF08A', Low:'BBF7D0', Info:'BAE6FD' };

const findings = [
  ['High','刪除帳號未自資料庫移除，帳號仍可登入','OWASP A01','已修復',
   '帳號同時存在於 app_state.users（畫面管理用）與資料庫 users 表（登入驗證用）。刪除帳號僅移除本機資料，資料庫的帳號仍在，被刪除者可繼續登入系統。',
   'ShiftSystem.jsx / handleDelete',
   '新增 deleteFromDB()，刪除時一併呼叫 DELETE /api/users/:id；寫入失敗時明確提示該帳號可能仍可登入。'],
  ['High','停用帳號未同步資料庫，停用後仍可登入','OWASP A01','已修復',
   '登入以資料庫的 approved 欄位判斷，停用操作僅改本機，被停用的帳號仍可通過登入驗證。',
   'ShiftSystem.jsx / toggleApproved',
   '改為同時 PUT /api/users/:id 更新 approved，並回寫 apiUsers；失敗時提示。'],
  ['High','撤銷委外幹部未自資料庫移除，仍可登入','OWASP A01','已修復',
   '撤銷幹部權限僅過濾本機 users 陣列，資料庫帳號未刪除，被撤銷者仍可以幹部身分登入。',
   'ShiftSystem.jsx / handleDowngradeToWorker',
   '撤銷時一併呼叫 deleteFromDB()。'],
  ['High','委外幹部變更密碼未寫回資料庫，舊密碼仍可登入','OWASP A07','已修復',
   '廠商帳號登入以資料庫 password_hash 驗證。首次登入強制改密碼的流程僅更新本機，導致新密碼無效而舊密碼（多為員工編號等預設值）持續有效。',
   'ShiftSystem.jsx / ForcePwdChange；server.cjs',
   '新增 PUT /api/auth/vendor-password（requireAuth，限 role=vendor 且僅能變更自己的密碼），前端於改密碼後呼叫。'],
  ['Medium','分頁權限設定對資料庫帳號無效','OWASP A01','已修復',
   '權限勾選僅寫入本機 users.permissions，但經帳號申請建立的廠商帳號登入時讀取資料庫的 page_perms 欄位，導致管理員取消勾選後該使用者仍可存取該分頁。',
   'ShiftSystem.jsx / togglePerm',
   '勾選後若該帳號存在於資料庫，一併 PUT /api/users/:id 更新 page_perms。'],
  ['Medium','未設定權限的廠商帳號套用日翊角色的預設分頁','OWASP A01','已修復',
   'buildPermsFromPagePerms 在 page_perms 為空時一律套用 defaultStaffPageKeys（日翊 area 角色的預設），使廠商幹部取得不應有的分頁可見範圍。',
   'ShiftSystem.jsx / buildPermsFromPagePerms',
   '改為依角色計算預設分頁：area 沿用原邏輯，其餘角色取該角色 getDefaultPermissions 中 view 為真的分頁。'],
  ['Medium','編輯與新增帳號未寫回資料庫','OWASP A04','已修復',
   '編輯帳號（姓名、密碼、授權廠商、可用倉別）與新增帳號僅寫入本機，資料庫未更新；新增的廠商帳號因資料庫無資料而無法登入。',
   'ShiftSystem.jsx / handleSave',
   '廠商角色於儲存後呼叫 syncVendorToDB()（後端為 ON CONFLICT DO UPDATE 之 upsert）。'],
  ['Info','其他功能是否有同類問題','—','已稽核確認無',
   '檢視全部 14 個後端寫入端點與所有本機狀態寫入點，確認除帳號外的資料（班表、人員清冊、倉別設定、出勤、櫃號、系統設定等）皆僅存在 app_state 單一來源。',
   'server.cjs 全部 post/put/delete 端點；ShiftSystem.jsx 狀態寫入點',
   '出勤資料雖有 PUT /api/state 與 PUT /api/attendance 兩條路徑，但寫入的是同一份 app_state.attendData／extras，不存在分歧。'],
];

const rows = [new TableRow({ children: [
  cell('嚴重度','E2E8F0',true,1200), cell('問題','E2E8F0',true,3200),
  cell('分類','E2E8F0',true,1800), cell('狀態','E2E8F0',true,1800), cell('位置','E2E8F0',true,2600) ] })];
findings.forEach(f => rows.push(new TableRow({ children: [
  cell(f[0], SEV[f[0]], true, 1200), cell(f[1],'FFFFFF',false,3200),
  cell(f[2],'FFFFFF',false,1800), cell(f[3],'FFFFFF',false,1800), cell(f[5],'FFFFFF',false,2600) ] })));

const detail = [];
findings.forEach((f,i) => {
  detail.push(hdr(`2.${i+1} ${f[1]}`, HeadingLevel.HEADING_2));
  detail.push(p(`嚴重度：${f[0]}　　分類：${f[2]}　　狀態：${f[3]}`));
  detail.push(p(`位置：${f[5]}`));
  detail.push(p(`問題描述：${f[4]}`));
  detail.push(p(`處理說明：${f[6]}`));
});

const doc = new Document({ sections: [{
  properties: { page: { size: { width: 11906, height: 16838 },
    margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
  children: [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 2400, after: 200 },
      children: [new TextRun({ text: '程式碼資安檢測報告', bold: true, size: 48 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 600 },
      children: [new TextRun({ text: 'Security Audit Report', size: 28, color: '64748B' })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `專案：委外人力排班作業平台`, size: 24 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `掃描日期：${DATE}`, size: 24 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 400 },
      children: [new TextRun({ text: '整體判斷：允許部署（漏洞已修復）', bold: true, size: 32, color: '047857' })] }),
    new Paragraph({ children: [new PageBreak()] }),

    hdr('1. 執行摘要', HeadingLevel.HEADING_1),
    p('掃描範圍：ShiftSystem.jsx（React 前端）與 server.cjs（Node.js / Express 後端）之帳號管理相關程式碼。'),
    p('重點檢視項目：帳號資料同時存在本機 app_state 與資料庫 users 表，而登入一律以資料庫為準，凡僅寫入本機的操作皆失效。本次針對帳號管理的全部操作逐一稽核。'),
    p('漏洞統計：Critical 0、High 0、Critical 0、High 4（已修復）、Medium 3（已修復）、Info 1。'),
    p('部署建議：發現 4 項 High、3 項 Medium，皆已修復並通過建置與語法檢查。因涉及帳號存取控制，建議儘速部署。'),
    new Paragraph({ spacing: { before: 200 } }),
    new Table({ columnWidths: [1200,3200,1800,1800,2600], rows }),

    hdr('2. 漏洞詳細清單', HeadingLevel.HEADING_1),
    ...detail,

    hdr('3. 結論', HeadingLevel.HEADING_1),
    p('本次稽核發現 4 項 High 與 3 項 Medium 風險，集中於「帳號資料雙儲存但登入僅認資料庫」所導致的存取控制失效，皆已修復並通過前端建置與 node --check 語法檢查。'),
    p('已確認無虞項目：所有 SQL 皆為參數化查詢（無字串拼接）、無硬編碼密鑰或憑證、錯誤回應不外洩堆疊資訊、欄位白名單可阻擋原型污染（__proto__ 不在白名單內）、React 預設輸出逸脫且本次未新增 dangerouslySetInnerHTML。'),
    p('後續建議：一、部署後請確認先前已刪除或停用的帳號是否仍存在於資料庫，必要時重新執行一次刪除或停用。二、先前透過新增帳號建立的廠商帳號若無法登入，請重新編輯並儲存一次以寫入資料庫。三、長期而言建議收斂為單一資料來源，避免同類問題再次發生。'),
  ],
}]});

Packer.toBuffer(doc).then(b => { fs.writeFileSync(OUT, b); console.log('已產出：' + OUT); });
