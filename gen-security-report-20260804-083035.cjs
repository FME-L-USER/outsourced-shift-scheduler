'use strict';
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        HeadingLevel, AlignmentType, WidthType, ShadingType, PageBreak } = require('docx');
const fs = require('fs');
const OUTPUT = 'C:\\Users\\Grace\\Desktop\\AI測試好朋友\\輪休表\\排班作業\\security-report-20260804-083035.docx';
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
  body('本次異動（班表管理表頭固定修正 — sticky header 滾動後消失）：'),
  body('  問題：班表管理往下滾動後，人員姓名表頭消失。'),
  body('  原因 1：外層 div 使用 overflow-hidden，'),
  body('          造成瀏覽器建立 scroll container，截斷 thead sticky top-0 定位。'),
  body('  原因 2：捲動容器使用 overflow-x-auto，'),
  body('          未顯式啟用垂直軸捲動，sticky 定位參考點不正確。'),
  body('  修正：'),
  body('    1. 外層 div：overflow-hidden → style={{ overflow: "clip" }}'),
  body('       （clip 僅視覺裁剪，不建立 scroll container，sticky 定位不受干擾）'),
  body('    2. 捲動容器：overflow-x-auto → overflow-auto（同時啟用水平與垂直捲動）'),
  body('    3. thead z-index：z-10 → z-20（確保表頭浮於固定欄位之上）'),
  spacer(),body('漏洞統計：',{bold:true}),spacer(),statsTable,spacer(),
  body('部署建議：純 CSS 樣式調整，無任何漏洞，可直接部署。'),
  spacer(),new Paragraph({children:[new PageBreak()]}),
  h1('2. 漏洞詳細清單'),spacer(),body('本次掃描未發現任何漏洞。'),spacer(),
  body('補充說明：'),
  body('  overflow: clip 為純 CSS 值，不引入任何 JavaScript 邏輯或資料處理。'),
  body('  overflow-auto 為標準 CSS，僅影響捲動行為，不引入任何攻擊面。'),
  body('  z-index 調整為純視覺層疊順序，不影響資料流或認證邏輯。'),
  body('  不引入新的 API 路徑、認證變更或資料暴露風險。'),
  spacer(),
  new Paragraph({children:[new PageBreak()]}),
  h1('3. 結論'),spacer(),
  body('本次掃描未發現任何漏洞，程式碼通過資安檢測，允許部署。'),spacer(),
  body('  ✅  純 CSS 樣式調整，無 XSS 或注入風險'),
  body('  ✅  overflow: clip 修正 sticky header，不引入新攻擊面'),
  body('  ✅  不引入新的認證路徑或資料暴露風險'),
]}]});
Packer.toBuffer(doc).then(buf=>{ fs.writeFileSync(OUTPUT,buf); console.log('OK: '+OUTPUT); }).catch(e=>{ console.error(e); process.exit(1); });
