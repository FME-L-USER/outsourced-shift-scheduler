'use strict';
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        HeadingLevel, AlignmentType, WidthType, ShadingType, PageBreak } = require('docx');
const fs = require('fs');
const OUTPUT = 'C:\\Users\\Grace\\Desktop\\AI測試好朋友\\輪休表\\排班作業\\security-report-20260804-134852.docx';
function h1(t){ return new Paragraph({ heading: HeadingLevel.HEADING_1, children:[new TextRun({text:t,bold:true,size:32,color:'1E3A5F'})] }); }
function body(t,o){ return new Paragraph({ children:[new TextRun(Object.assign({text:t,size:22},o||{}))] }); }
function spacer(){ return new Paragraph({ children:[new TextRun({text:''})] }); }
const FILL={Critical:'FECACA',High:'FED7AA',Medium:'FEF08A',Low:'BBF7D0',Info:'BAE6FD'};
function hc(t){ return new TableCell({ width:{size:0,type:WidthType.AUTO}, shading:{type:ShadingType.CLEAR,color:'auto',fill:'1E3A5F'}, children:[new Paragraph({alignment:AlignmentType.CENTER,children:[new TextRun({text:t,bold:true,color:'FFFFFF',size:20})]})] }); }
function dc(t,f,b,a){ return new TableCell({ width:{size:0,type:WidthType.AUTO}, shading:f?{type:ShadingType.CLEAR,color:'auto',fill:f}:undefined, children:[new Paragraph({alignment:a||AlignmentType.LEFT,children:[new TextRun({text:t||'',size:20,bold:!!b})]})] }); }
const statsTable = new Table({ width:{size:9000,type:WidthType.DXA}, columnWidths:[1800,1800,1800,1800,1800], rows:[
  new TableRow({ children:['Critical','High','Medium','Low','Info'].map(hc) }),
  new TableRow({ children:[dc('0',FILL.Critical,true,AlignmentType.CENTER),dc('0',FILL.High,true,AlignmentType.CENTER),dc('0',FILL.Medium,true,AlignmentType.CENTER),dc('0',FILL.Low,true,AlignmentType.CENTER),dc('0',FILL.Info,true,AlignmentType.CENTER)] }),
]});
const doc = new Document({ sections:[{ properties:{ page:{ size:{width:11906,height:16838}, margin:{top:1440,right:1440,bottom:1440,left:1440} } }, children:[
  spacer(),spacer(),
  new Paragraph({alignment:AlignmentType.CENTER,children:[new TextRun({text:'程式碼資安檢測報告',bold:true,size:52,color:'1E3A5F'})]}),
  spacer(),
  new Paragraph({alignment:AlignmentType.CENTER,children:[new TextRun({text:'Security Audit Report',size:36,color:'4B5563',italics:true})]}),
  spacer(),spacer(),
  new Paragraph({alignment:AlignmentType.CENTER,children:[new TextRun({text:'掃描日期：2026-08-04',size:24})]}),
  new Paragraph({alignment:AlignmentType.CENTER,children:[new TextRun({text:'整體判斷：允許部署（無任何漏洞）',size:24,bold:true,color:'15803D'})]}),
  new Paragraph({children:[new PageBreak()]}),
  h1('1. 執行摘要'),spacer(),
  body('掃描範圍：ShiftSystem.jsx（前端）'),
  body('本次異動（班表管理 — 新增列印報表功能）：'),
  body('  1. 新增 handlePrintReport useCallback 函式'),
  body('     依目前週期（rangeMode viewRange 或 selectedYear/selectedMonth）產生 A3 橫向列印 HTML'),
  body('     員工資料依廠商分組，每格顯示班表代號（支援 showConverted 模式）'),
  body('     連上 6 天警示（粉紅底色）同步呈現於列印頁'),
  body('  2. 所有動態資料插入 HTML 前均通過 esc() 函式進行 HTML 特殊字元跳脫'),
  body('     esc() 替換 &  <  >  " 四個字元，防止 XSS 注入'),
  body('  3. window.open("", "_blank") 開啟空白視窗，document.write 寫入後 win.print()'),
  body('  4. 工具列新增「列印報表」按鈕（紫色，緊接在代碼轉換匯出之後）'),
  spacer(),body('漏洞統計：',{bold:true}),spacer(),statsTable,spacer(),
  body('部署建議：純前端 state 計算 + HTML 特殊字元跳脫，無任何漏洞，可直接部署。'),
  spacer(),new Paragraph({children:[new PageBreak()]}),
  h1('2. 漏洞詳細清單'),spacer(),body('本次掃描未發現任何漏洞。'),spacer(),
  body('補充說明：'),
  body('  handlePrintReport 使用 esc() 對所有動態資料（姓名、員編、廠商、班表代號、週期、範圍）'),
  body('  進行 HTML 特殊字元跳脫後再插入 HTML 字串，無 XSS 風險。'),
  body('  window.open 開啟新空白視窗，不傳送任何資料到外部服務。'),
  body('  所有資料均來自 React state（schedule、visibleEmployees、dayHeaders），'),
  body('  不接受任何使用者直接輸入的字串作為 HTML 插入點。'),
  body('  不引入新的 API 路徑、認證邏輯或資料暴露路徑。'),
  spacer(),
  new Paragraph({children:[new PageBreak()]}),
  h1('3. 結論'),spacer(),
  body('本次掃描未發現任何漏洞，程式碼通過資安檢測，允許部署。'),spacer(),
  body('  \u2705  班表管理新增列印報表功能（A3 橫向，支援 rangeMode 與月份模式）'),
  body('  \u2705  員工資料依廠商分組，班表代號顏色對應（上班/例休/休假/國定假日）'),
  body('  \u2705  所有動態資料通過 esc() HTML 跳脫，無 XSS 風險'),
  body('  \u2705  window.open 列印，不傳送資料到外部'),
  body('  \u2705  不引入新的認證路徑或資料暴露風險'),
]}]});
Packer.toBuffer(doc).then(buf=>{ fs.writeFileSync(OUTPUT,buf); console.log('OK: '+OUTPUT); }).catch(e=>{ console.error(e); process.exit(1); });
