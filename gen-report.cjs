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
  ['Medium','啟動時的資料校正每次都覆寫管理員的設定','OWASP A04','已修復',
   'seedDeptGroups 與 seedWarehouseVendors 原為一次性資料校正，但未設旗標，導致每次容器啟動都以寫死的清單覆蓋。Cloud Run 於部署、擴縮、閒置喚醒時皆會啟動新容器，使管理員在畫面上的調整（例如將運務組拆為日/中/夜班）反覆被打回原狀。',
   'server.cjs / seedDeptGroups、seedWarehouseVendors',
   '改為一次性：於 app_state 記錄 _seedApplied 標記，套用後永久跳過，不再覆寫管理員的調整。'],
  ['Medium','日翊可繞過介面寫入管理員專屬的全域設定','OWASP A01','已修復',
   '新增的「每期日期區間」以及既有的開放排班國定假日、委外幹部排國開關、廠商公司抬頭、廠商主檔，前端僅開放管理員修改，但 PUT /api/state 對 admin 與 area 走同一分支，area 角色仍可直接經 API 寫入。',
   'server.cjs / PUT /api/state',
   '於寫入前無條件剔除 area 角色送出的上述欄位，不再僅依賴前端介面收斂。'],
  ['Low','匯入清冊未驗證組別，無效資料靜默寫入','OWASP A04','已改善',
   '匯入時不比對該課別的組別清單，Excel 中不存在的組別會原樣寫入且無任何提示。這些人員在畫面上與正常資料無異，但以組別篩選時會被靜默濾掉，難以察覺。',
   'ShiftSystem.jsx / handleImport、人員清冊',
   '匯入完成訊息改為警示樣式並列出「課別／組別（人數）」；人員清冊將無效組別標為紅色並附說明。資料仍照常匯入，不阻擋批次作業。'],
  ['Low','連續上班天數將未排班日計為上班','—','已修復',
   '班表將空白格顯示為上班（V），連續天數計算沿用同一規則，導致期末尚未排班的空白被計入，產生超過 7 天的假警示。',
   'ShiftSystem.jsx / getWorkRunInfo',
   '以該員最後一筆實際排定的日期為界，之後的日子不納入計算；真正連續排滿 7 天者仍正確警示。'],
  ['Info','新增 users.login_count 欄位','—','設計變更',
   '為累計登入次數新增資料表欄位，並於 AD 登入（兩處）、廠商幹部登入、委外人員登入四條路徑遞增。',
   'server.cjs / initDB、各登入端點',
   '以 ADD COLUMN IF NOT EXISTS 遷移，查詢皆參數化。既有資料自 0 起算，無法回溯。同時補上委外人員登入原本未更新 last_login 的缺漏。'],
  ['Info','其他角色可寫入的欄位','OWASP A01','已知限制',
   'deptLocks、deptRanges、employees、schedule 等欄位 area 角色可寫入，且伺服器端未依 allowed_warehouses 逐課驗證。',
   'server.cjs / PUT /api/state',
   '此為既有設計：日翊本就需要編輯所轄倉別的班表與課別設定。warehouses 已依 allowed_warehouses 收斂；其餘欄位建議後續補上逐課驗證。'],
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
    p('掃描範圍：ShiftSystem.jsx（React 前端）與 server.cjs（Node.js / Express 後端）之系統設定權限、啟動時資料校正、清冊匯入驗證與 PUT /api/state 寫入邏輯。'),
    p('重點檢視項目：新增「每期日期區間」全域設定後的權限收斂、啟動時資料校正程式反覆覆寫管理員設定的問題、以及匯入清冊未驗證組別所造成的靜默資料異常。'),
    p('漏洞統計：Critical 0、High 0、Critical 0、High 0、Medium 2（已修復）、Low 2（已修復）、Info 2。'),
    p('部署建議：發現 2 項 Medium、2 項 Low，皆已修復並通過建置與語法檢查，允許部署。'),
    new Paragraph({ spacing: { before: 200 } }),
    new Table({ columnWidths: [1200,3200,1800,1800,2600], rows }),

    hdr('2. 漏洞詳細清單', HeadingLevel.HEADING_1),
    ...detail,

    hdr('3. 結論', HeadingLevel.HEADING_1),
    p('本次稽核發現 2 項 Medium 與 2 項 Low 風險，集中於「一次性校正程式未設旗標而反覆覆寫」與「全域設定僅以前端介面收斂」兩類問題，皆已修復並通過前端建置與 node --check 語法檢查。'),
    p('已確認無虞項目：所有 SQL 皆為參數化查詢（無字串拼接）、無硬編碼密鑰或憑證、錯誤回應不外洩堆疊資訊、欄位白名單可阻擋原型污染（__proto__ 不在白名單內）、React 預設輸出逸脫且本次未新增 dangerouslySetInnerHTML。'),
    p('後續建議：一、PUT /api/state 的 deptLocks、deptRanges、employees 等欄位仍未依 allowed_warehouses 逐課驗證，建議後續補上。二、前端仍以整份快照存檔，若某位使用者的快照完全缺少一筆新增資料，該筆仍可能被刪除；長期建議改為只送異動內容。三、部署後請確認各課別的開放排班區間與每期日期區間已設定，否則班表僅能查看。'),
  ],
}]});

Packer.toBuffer(doc).then(b => { fs.writeFileSync(OUT, b); console.log('已產出：' + OUT); });
