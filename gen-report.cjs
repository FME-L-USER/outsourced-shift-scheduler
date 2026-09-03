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
  ['Medium','系統設定開放給日翊後，伺服器端未區分 admin/area','OWASP A01','已修復',
   'PUT /api/state 對 admin 與 area 走同一分支，area 可寫入 warehouses 等全域設定。前端雖已依角色收斂介面，但介面層不構成防護；且日翊存檔時送出整份 warehouses（含其他倉），舊快照會覆蓋別倉設定。',
   'server.cjs / PUT /api/state；ShiftSystem.jsx / Settings',
   '伺服器端新增把關：role=area 時，僅套用其 allowed_warehouses 內倉別的異動，其餘沿用伺服器現值，且不得新增或刪除倉別。前端另依角色隱藏倉別增刪與全域設定區塊。'],
  ['Medium','employees 整份覆蓋導致欄位遺失','OWASP A04','已修復',
   '多位日翊同時登入時，各瀏覽器每 2 秒送出自己的 employees 快照；伺服器整份覆蓋，導致他人剛設定的欄位（如 shiftTypeId 班別指派）被尚未同步的舊快照洗掉。',
   'server.cjs / PUT /api/state',
   '改為逐筆合併：以送出清單為準保留刪除語意，但同一筆人員中「現值有、來源沒有」的欄位予以保留；來源明確帶值者仍會覆蓋。'],
  ['Medium','workerPwds 整份覆蓋導致委外人員密碼遺失','OWASP A07','已修復',
   '委外人員密碼由本人經 PUT /api/auth/worker-password 寫入，管理員端的快照永遠較舊。管理員自動存檔會整份覆蓋，密碼消失後該員下次登入被判定為首次登入而重複要求設定密碼。',
   'server.cjs / PUT /api/state',
   '改為逐員編合併且伺服器現值優先；管理員「重設密碼」為伺服器端直接刪除，不受影響。'],
  ['Info','委外人員與委外幹部排班代碼限縮','—','設計變更（權限收緊）',
   '委外人員與委外幹部一律僅能在 V 與休之間切換，不可排「例」；「國」僅在系統設定開啟委外幹部國定假日排班權限、且該日為開放國定假日時可選。每週限一天休。',
   'ShiftSystem.jsx / handleCellClick',
   '屬權限收緊，非擴權。最終排定仍由日翊員工負責。'],
  ['Info','倉別本身的增刪仍限管理員','OWASP A01','已確認',
   '刪除倉別會使該倉班表、點名、櫃號資料失去歸屬，故不下放。',
   'ShiftSystem.jsx / Settings；server.cjs',
   '前端隱藏新增／編輯／刪除倉別按鈕，後端另以 allowed_warehouses 比對現值清單，area 無法新增或刪除倉別。'],
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
    p('掃描範圍：ShiftSystem.jsx（React 前端）與 server.cjs（Node.js / Express 後端）之系統設定權限、排班代碼限制與 PUT /api/state 寫入邏輯。'),
    p('重點檢視項目：系統設定開放給日翊員工後的權限收斂是否確實（含伺服器端把關），以及 app_state 各欄位整份覆蓋所造成的資料遺失。'),
    p('漏洞統計：Critical 0、High 0、Critical 0、High 0、Medium 3（已修復）、Info 2。'),
    p('部署建議：發現 3 項 Medium，皆已修復並通過建置與語法檢查，允許部署。'),
    new Paragraph({ spacing: { before: 200 } }),
    new Table({ columnWidths: [1200,3200,1800,1800,2600], rows }),

    hdr('2. 漏洞詳細清單', HeadingLevel.HEADING_1),
    ...detail,

    hdr('3. 結論', HeadingLevel.HEADING_1),
    p('本次稽核發現 3 項 Medium 風險：一為系統設定開放後伺服器端缺乏 admin/area 區分，二、三為 app_state 欄位整份覆蓋所致的資料遺失。皆已修復並通過前端建置與 node --check 語法檢查。'),
    p('已確認無虞項目：所有 SQL 皆為參數化查詢（無字串拼接）、無硬編碼密鑰或憑證、錯誤回應不外洩堆疊資訊、欄位白名單可阻擋原型污染（__proto__ 不在白名單內）、React 預設輸出逸脫且本次未新增 dangerouslySetInnerHTML。'),
    p('後續建議：一、前端仍以整份快照存檔，若某位使用者的快照完全缺少一筆新增資料，該筆仍可能被刪除；長期建議改為只送異動內容。二、部署後請重新指派先前遺失的班別，並確認委外人員不再被重複要求設定密碼。'),
  ],
}]});

Packer.toBuffer(doc).then(b => { fs.writeFileSync(OUT, b); console.log('已產出：' + OUT); });
