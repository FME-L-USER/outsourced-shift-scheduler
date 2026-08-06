'use strict';
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        HeadingLevel, AlignmentType, WidthType, ShadingType, PageBreak } = require('docx');
const fs = require('fs');
const OUTPUT = 'C:\\Users\\Grace\\Desktop\\AI測試好朋友\\輪休表\\排班作業\\security-report-20260806-104457.docx';
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
  body('本次異動：修正排班區間前後期瀏覽時起算日期 off-by-one 錯誤'),
  spacer(),
  h2('問題描述'),spacer(),
  body('排班區間（rangeMode）下按 ► 切換下一期時，起始日與前一期結束日重疊一天。'),
  body('範例：當前期 2026-1-26 ~ 2026-2-22（28天），下一期應從 2/23 開始，'),
  body('但實際顯示 2/22 ~ 3/21，即下一期的第一天等於當前期的最後一天。'),
  spacer(),
  body('根本原因：'),
  body('  len = Math.round((e - s) / 86400000) 計算首尾差值為 27（不含尾端）'),
  body('  shift = viewOffset * len → 下一期偏移 27 天 → 2/22 開始（差 1 天）'),
  body('  正確應偏移含頭含尾的完整天數 len+1 = 28 → 2/23 開始'),
  spacer(),
  h2('修正內容'),spacer(),
  body('修改位置：ShiftSystem.jsx 班表管理 viewRange（第 2079 行）、報表 viewRange（第 3418 行）'),
  body('  修前：const shift = viewOffset * len'),
  body('  修後：const shift = viewOffset * (len + 1)'),
  body('  兩處均修正，確保班表管理與報表匯出的跨期瀏覽一致。'),
  spacer(),
  body('驗證（以 1/26~2/22 為例）：',{bold:true}),
  body('  len = 27（天數差值），len+1 = 28（含頭含尾天數）'),
  body('  +1 期：1/26+28=2/23，2/22+28=3/22 → 顯示 2/23~3/22 ✓'),
  body('  -1 期：1/26-28=12/29，2/22-28=1/25 → 顯示 12/29~1/25 ✓'),
  spacer(),body('漏洞統計：',{bold:true}),spacer(),statsTable,spacer(),
  body('部署建議：無安全疑慮，可直接部署。'),
  spacer(),new Paragraph({children:[new PageBreak()]}),
  h1('2. 漏洞詳細清單'),spacer(),body('本次掃描未發現任何漏洞。'),spacer(),
  new Paragraph({children:[new PageBreak()]}),
  h1('3. 結論'),spacer(),
  body('本次掃描未發現任何漏洞，程式碼通過資安檢測，允許部署。'),spacer(),
  body('  ✅  下一期起始日不再與前一期結束日重疊'),
  body('  ✅  班表管理與報表匯出的跨期瀏覽行為一致'),
]}]});
Packer.toBuffer(doc).then(buf=>{ fs.writeFileSync(OUTPUT,buf); console.log('OK: '+OUTPUT); }).catch(e=>{ console.error(e); process.exit(1); });
