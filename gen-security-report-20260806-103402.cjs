'use strict';
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        HeadingLevel, AlignmentType, WidthType, ShadingType, PageBreak } = require('docx');
const fs = require('fs');
const OUTPUT = 'C:\\Users\\Grace\\Desktop\\AI測試好朋友\\輪休表\\排班作業\\security-report-20260806-103402.docx';
function h1(t){ return new Paragraph({ heading: HeadingLevel.HEADING_1, children:[new TextRun({text:t,bold:true,size:32,color:'1E3A5F'})] }); }
function h2(t){ return new Paragraph({ heading: HeadingLevel.HEADING_2, children:[new TextRun({text:t,bold:true,size:26,color:'1E3A5F'})] }); }
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
  new Paragraph({alignment:AlignmentType.CENTER,children:[new TextRun({text:'掃描日期：2026-08-06',size:24})]}),
  new Paragraph({alignment:AlignmentType.CENTER,children:[new TextRun({text:'整體判斷：允許部署（無任何漏洞）',size:24,bold:true,color:'15803D'})]}),
  new Paragraph({children:[new PageBreak()]}),
  h1('1. 執行摘要'),spacer(),
  body('掃描範圍：ShiftSystem.jsx（前端）'),
  body('本次異動：修正 2026 年農曆春節國定假日資料錯誤，補上小年夜'),
  spacer(),
  h2('問題描述'),spacer(),
  body('三個問題導致 1/22~2/22 區間匯出時農曆假日代號缺失：'),
  body('  1. NATIONAL_HOLIDAYS 中 2026 年農曆假日月份錯誤'),
  body('     現有：month: 1（一月），日期 17~20'),
  body('     正確：month: 2（二月），農曆除夕 2/16、初一 2/17、初二 2/18、初三 2/19'),
  body('  2. 小年夜（KH7）完全缺漏於 NATIONAL_HOLIDAYS（2025 及 2026 均未列）'),
  body('  3. HOLIDAY_COL_MAP 缺少 \'小年夜\' → \'小年夜\' 對應，'),
  body('     即使加入 NATIONAL_HOLIDAYS，getDisplayCode 也無法將其轉為 KH7'),
  spacer(),
  h2('修正內容'),spacer(),
  body('Fix 1 — NATIONAL_HOLIDAYS 2026 年農曆假日（第 190~194 行）：'),
  body('  修前：month:1 day:17 除夕、day:18~20 春節（一月份，完全錯誤）'),
  body('  修後：month:2 day:16 農曆除夕、day:17~19 春節（二月份，正確）'),
  spacer(),
  body('Fix 2 — 補上小年夜（NATIONAL_HOLIDAYS）：'),
  body('  新增：{ year: 2025, month: 1,  day: 27, name: \'小年夜\' }（農曆114年除夕前一日）'),
  body('  新增：{ year: 2026, month: 2,  day: 15, name: \'小年夜\' }（農曆115年除夕前一日）'),
  spacer(),
  body('Fix 3 — HOLIDAY_COL_MAP 補上小年夜對應（第 1979 行）：'),
  body('  新增：\'小年夜\': \'小年夜\''),
  body('  效果：getDisplayCode 遇到 \'國\' + 2/15 → 查 \'小年夜\' 欄 → 回傳 KH7'),
  spacer(),
  body('修正後假日代號對應（2026/1/22~2/22 區間）：',{bold:true}),
  body('  2/15 小年夜 → KH7'),
  body('  2/16 農曆除夕 → XH7'),
  body('  2/17 春節初一 → WH7'),
  body('  2/18 春節初二 → VH7'),
  body('  2/19 春節初三 → UH7'),
  spacer(),body('漏洞統計：',{bold:true}),spacer(),statsTable,spacer(),
  body('部署建議：無安全疑慮，可直接部署。'),
  spacer(),new Paragraph({children:[new PageBreak()]}),
  h1('2. 漏洞詳細清單'),spacer(),body('本次掃描未發現任何漏洞。'),spacer(),
  new Paragraph({children:[new PageBreak()]}),
  h1('3. 結論'),spacer(),
  body('本次掃描未發現任何漏洞，程式碼通過資安檢測，允許部署。'),spacer(),
  body('  ✅  2026 年農曆除夕、初一～初三日期修正為正確的二月份'),
  body('  ✅  2025/2026 小年夜補入 NATIONAL_HOLIDAYS'),
  body('  ✅  HOLIDAY_COL_MAP 補上小年夜，KH7 代號可正確匯出'),
  body('  ✅  系統設定「開放排班國定假日」現可正確顯示 1/22~2/22 區間內的春節假日'),
]}]});
Packer.toBuffer(doc).then(buf=>{ fs.writeFileSync(OUTPUT,buf); console.log('OK: '+OUTPUT); }).catch(e=>{ console.error(e); process.exit(1); });
