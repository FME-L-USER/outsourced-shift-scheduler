'use strict';
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        HeadingLevel, AlignmentType, WidthType, ShadingType, PageBreak } = require('docx');
const fs = require('fs');
const OUTPUT = 'C:\\Users\\Grace\\Desktop\\AI測試好朋友\\輪休表\\排班作業\\security-report-20260804-135948.docx';
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
  body('本次異動（報表匯出頁面 — 新增週期選擇器）：'),
  body('  1. Reports() 元件新增 viewOffset state、rangeMode、viewRange useMemo'),
  body('     邏輯與 ScheduleTable 完全相同：rangeMode 顯示 ◀ 日期徽章 ▶，月份模式顯示年月下拉'),
  body('  2. 新增 reportDates useMemo：依目前選擇週期建立 {year,month,day,wd} 日期陣列'),
  body('  3. buildVendorSheet 改用 reportDates 陣列取代 selectedYear/selectedMonth/days'),
  body('     - 日期欄位：由 reportDates 逐一填入，支援跨月區間'),
  body('     - countCode：改為對 reportDates 過濾計數'),
  body('     - getRemarks：改為對 reportDates 範圍內的國定假日做備註'),
  body('     - 標題列：rangeMode 顯示「排班確認表」，月份模式顯示「當月排班確認表」'),
  body('     - dateRange 字串：依實際起訖日期產生民國年月日文字'),
  body('  4. exportVendor 改用 reportDates.length 傳入 applySheetStyles'),
  body('     - 檔名依週期動態命名（rangeMode：日期範圍；月份模式：年月）'),
  body('  5. JSX 標題列新增週期選擇器 UI（與班表管理樣式一致）'),
  body('     - 新增 setSelectedYear、setSelectedMonth 到 useApp() 解構'),
  spacer(),body('漏洞統計：',{bold:true}),spacer(),statsTable,spacer(),
  body('部署建議：純前端 state 計算，無任何漏洞，可直接部署。'),
  spacer(),new Paragraph({children:[new PageBreak()]}),
  h1('2. 漏洞詳細清單'),spacer(),body('本次掃描未發現任何漏洞。'),spacer(),
  body('補充說明：'),
  body('  週期選擇器邏輯與 ScheduleTable 相同，純 React state 計算，不接受外部輸入。'),
  body('  buildVendorSheet 使用 dateKey(year,month,day) 查詢 schedule state，無注入風險。'),
  body('  reportDates 由 parseLocal(viewRange.start/end) 衍生，不接受使用者直接輸入字串。'),
  body('  不引入新的 API 路徑、認證邏輯或資料暴露路徑。'),
  spacer(),
  new Paragraph({children:[new PageBreak()]}),
  h1('3. 結論'),spacer(),
  body('本次掃描未發現任何漏洞，程式碼通過資安檢測，允許部署。'),spacer(),
  body('  \u2705  報表匯出頁面新增週期選擇器（rangeMode ◀▶ 或年月下拉）'),
  body('  \u2705  buildVendorSheet 改用 reportDates，支援跨月區間匯出'),
  body('  \u2705  純前端 state 計算，無 XSS 或注入風險'),
  body('  \u2705  不引入新的認證路徑或資料暴露風險'),
]}]});
Packer.toBuffer(doc).then(buf=>{ fs.writeFileSync(OUTPUT,buf); console.log('OK: '+OUTPUT); }).catch(e=>{ console.error(e); process.exit(1); });
