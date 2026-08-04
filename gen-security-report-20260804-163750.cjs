'use strict';
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        HeadingLevel, AlignmentType, WidthType, ShadingType, PageBreak } = require('docx');
const fs = require('fs');
const OUTPUT = 'C:\\Users\\Grace\\Desktop\\AI測試好朋友\\輪休表\\排班作業\\security-report-20260804-163750.docx';
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
  body('掃描範圍：ShiftSystem.jsx（前端）、server.cjs（後端）'),
  body('本次異動（新增 vendor 出勤資料持久化）：'),
  body('  後端 server.cjs：'),
  body('  1. 新增 GET /api/attendance（admin / area / vendor 可讀）'),
  body('     回傳 { attendData, extras } 子集，不暴露員工薪資或完整排班'),
  body('  2. 新增 PUT /api/attendance（admin / area / vendor 可寫）'),
  body('     使用 JSONB 局部更新：app_state.data || {attendData, extras}'),
  body('     不覆蓋其他欄位（employees、schedule 等）'),
  body('  前端 ShiftSystem.jsx：'),
  body('  3. 啟動載入：vendor 登入後呼叫 GET /api/attendance 取得出勤資料'),
  body('  4. 新增 vendorAttendDebRef：attendData/extras 變更時 2s debounce'),
  body('     呼叫 PUT /api/attendance 儲存，forceSave 時立即存'),
  spacer(),body('安全性分析：',{bold:true}),
  body('  - PUT /api/attendance 透過 requireAuth 驗證 JWT，角色白名單 [admin,area,vendor]'),
  body('  - JSONB 局部更新避免 vendor 覆蓋 employees/schedule 等敏感欄位'),
  body('  - vendor 無法讀取 GET /api/state（仍需 admin/area 權限）'),
  spacer(),body('漏洞統計：',{bold:true}),spacer(),statsTable,spacer(),
  body('部署建議：新增出勤專用端點，角色控制明確，可直接部署。'),
  spacer(),new Paragraph({children:[new PageBreak()]}),
  h1('2. 漏洞詳細清單'),spacer(),body('本次掃描未發現任何漏洞。'),spacer(),
  body('補充說明：'),
  body('  - JSONB 更新使用 jsonb_build_object 避免 SQL injection'),
  body('  - 請求參數 attendData/extras 使用 $1 參數化查詢'),
  body('  - 角色驗證先於資料庫操作，防止未授權寫入'),
  spacer(),
  new Paragraph({children:[new PageBreak()]}),
  h1('3. 結論'),spacer(),
  body('本次掃描未發現任何漏洞，程式碼通過資安檢測，允許部署。'),spacer(),
  body('  \u2705  vendor 勾選點名及匯入派工資料現可持久化至後端 DB'),
  body('  \u2705  JSONB 局部更新確保 vendor 無法覆蓋其他欄位'),
  body('  \u2705  角色白名單控制，不影響既有 admin/area 權限模型'),
]}]});
Packer.toBuffer(doc).then(buf=>{ fs.writeFileSync(OUTPUT,buf); console.log('OK: '+OUTPUT); }).catch(e=>{ console.error(e); process.exit(1); });
