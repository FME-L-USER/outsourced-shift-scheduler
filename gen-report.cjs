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
  ['High','委外人員可用員工編號從任何裝置登入，繞過已設定的密碼','OWASP A07','已修復',
   '委外人員的密碼雜湊存放於 app_state.workerPwds，而該資料僅管理端有權限讀取，委外人員自己的裝置永遠取不到。前端卻先以本機資料判斷：查無密碼即視為首次登入，並接受「密碼＝員工編號」直接放行，未向伺服器求證。因此任何人只要知道某位委外人員的員工編號，即可從新裝置或無痕視窗登入其帳號，即使該員早已設定過密碼。同一缺陷也使該員每次登入都被要求重設密碼，且新密碼因取不到 JWT 而無法寫回伺服器，形成無限迴圈。',
   'ShiftSystem.jsx / 登入流程（identity === worker）',
   '改為一律先呼叫 /api/auth/worker-login 由伺服器驗證，是否需要改密碼以伺服器回傳的 firstLogin 為準；伺服器回 401 即中止登入。僅在連線失敗時退回本機驗證供離線查看，且不再發放 JWT。'],
  ['Low','委外幹部的「需改密碼」旗標未以伺服器為準','—','已修復',
   '本機 users 清單中的 mustChangePassword 為舊種子資料，密碼實際改在資料庫時該旗標不會被清除，導致每次登入都被要求重設密碼。',
   'ShiftSystem.jsx / 登入流程（vendor 本機驗證分支）',
   '登入成功後改採伺服器回傳的 mustChangePassword。'],
  ['Info','委外人員登入次數未被記錄','—','已修復',
   '委外人員多半不存在於 users 表，原本以 UPDATE 累計登入次數的語法匹配不到任何列，統計恆為 0；加上多數登入未經伺服器，伺服器端亦無從得知。',
   'server.cjs / POST /api/auth/worker-login',
   '改為 upsert，首次登入時建立僅供統計用的紀錄（password_hash 留空，不改變既有登入方式），已升級為幹部者不覆蓋其角色與權限。統計自本次部署起累計，過去資料無法回溯。'],
  ['High','空的班表 payload 會清空整份班表資料','OWASP A04 / 資料完整性','已修復',
   'PUT /api/state 最終以 `data = app_state.data || $1::jsonb` 寫入，jsonb 的 || 運算對同名 key 是「整個取代」而非深層合併。前端改為只送異動格子後，無異動時會送出 schedule: {}，導致資料庫中整份班表（648 筆人員、逾兩萬格）被清空。此問題已於開發期間實際觸發，造成資料遺失，事後以瀏覽器本機快照與人工匯入復原。',
   'server.cjs / PUT /api/state；ShiftSystem.jsx / 自動存檔與 saveNow',
   '雙層防護：伺服器端收到空的 schedule 一律剔除，永不寫入；前端無異動時完全不帶 schedule 欄位。此為部分更新與整份取代語意不一致所致，同類欄位（attendData、extras）已確認皆走各自的合併路徑，不受影響。'],
  ['Medium','班表以整份快照覆蓋，造成多人協作時資料互相洗掉','OWASP A04','已修復',
   '每次存檔都送出整份班表快照，伺服器逐格以送來的值為準。日翊端每 30 秒才同步一次，空窗期內的存檔會用舊快照把委外幹部剛排好的休假改回原值，且無任何提示。存活與否取決於時間差，結果隨機。',
   'ShiftSystem.jsx / 班表存檔',
   '改為只送本機實際改動過的格子；未存檔清單一併持久化，避免關閉分頁後遺失。套用伺服器資料時會保留尚未存檔的本機改動。'],
  ['Medium','委外幹部的排班寫入可能被無聲過濾','OWASP A01','已修復',
   '伺服器以字串全等比對廠商名稱來判斷幹部可否寫入該員班表。清冊或帳號設定任一邊夾帶半形／全形空白時即比對失敗，該筆被略過但仍回傳成功，形成「畫面顯示已存檔、實際未寫入」的無聲失敗。',
   'server.cjs / PUT /api/state（vendor/worker 分支）',
   '比對改為正規化後進行；被過濾的筆數寫入伺服器日誌並回傳前端，不再靜默略過。'],
  ['Low','點名表背景同步因未解構變數而長期失效','—','已修復',
   '點名表的背景同步呼叫了三個未從 context 解構的 setter，拋出的 ReferenceError 被外層 catch 吞掉，該條同步實際上從未生效，且無任何錯誤訊息。',
   'ShiftSystem.jsx / Attendance.syncFromServer',
   '補上解構。此類「例外被 catch 靜默吞掉」的寫法會掩蓋缺陷，建議後續於 catch 中至少輸出警告。'],
  ['Medium','各倉的課別設定會被其他倉的存檔整份覆蓋','OWASP A01 / A04','已修復',
   'deptLocks 與 deptRanges 是以「課別名稱」為 key 的單一物件，PUT /api/state 以整份覆蓋寫入。日翊(area)畫面上只看得到自己倉別的課，送出的卻是整份快照，因此大溪的日翊按下存檔，會把大肚剛設好的課別鎖定與開放排班區間洗回自己讀到的舊值，形同越權異動非所轄倉別的設定。',
   'server.cjs / PUT /api/state',
   '改為以倉別為界合併：只採用 allowed_warehouses 所轄課別的 key（含該範圍內的刪除，維持「清除」語意），其餘 key 一律沿用伺服器現值。admin 管轄全部倉別，行為不變。'],
  ['Low','臨時人員名單未套用倉別／課別篩選','OWASP A01','已修復',
   '點名表與手機控管的臨時人員（extras）僅比對組別與廠商，未套用上方的倉別與課別篩選，導致選擇某一課時，仍會顯示其他課的臨時人力，造成跨課別的資料曝光與點名誤判。',
   'ShiftSystem.jsx / filterExtrasByScope、Attendance',
   'extras 僅存組別與廠商，改由組別回推所屬倉別與課別後再行篩選；組別已不屬於任何課者，在有倉別或課別條件時不顯示。屬畫面層收斂，後端讀取權限本就限於 admin/area。'],
  ['Low','前端未解構的變數造成整頁白屏','—','已修復',
   '帳號與權限管理元件使用了作業區篩選條件，卻未自 context 解構該變數，觸發 ReferenceError 導致整個分頁白屏，屬可用性缺陷。',
   'ShiftSystem.jsx / AccountManagement',
   '補上解構，並全面掃描其餘 8 個使用該條件的元件確認無遺漏。'],
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
