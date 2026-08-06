'use strict';
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        HeadingLevel, AlignmentType, WidthType, ShadingType, PageBreak } = require('docx');
const fs = require('fs');
const OUTPUT = 'C:\\Users\\Grace\\Desktop\\AI測試好朋友\\輪休表\\排班作業\\security-report-20260806-090819.docx';
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
  body('掃描範圍：ShiftSystem.jsx（前端）、server.cjs（後端）'),
  body('本次異動：防止空 attendData 覆蓋本機出勤資料（三處修正）'),
  spacer(),
  h2('問題描述'),spacer(),
  body('根本原因（三層問題）：'),
  body('  1. Init 條件不嚴謹：if (state?.attendData) 對空物件 {} 為 truthy，'),
  body('     導致 setAttendData({}) 覆蓋 localStorage 的有效出勤記錄'),
  body('  2. 前端 syncFromServer 使用日期層級 merge（...prev, ...newAttend），'),
  body('     若 server 傳回 {"2026-08-06": {}} 空日期，會清空本機同日資料'),
  body('  3. Server PUT /api/attendance 收到空 attendData {} 仍寫入 DB，'),
  body('     產生 attendData:{} 的 DB 記錄，後續任何裝置 init 都被此空物件覆蓋'),
  spacer(),
  h2('修正內容'),spacer(),
  body('Fix 1 — ShiftSystem.jsx init（loadServerState admin/area 分支）：'),
  body('  修前：if (state?.attendData) setAttendData(state.attendData)'),
  body('  修後：Object.keys(state.attendData).length > 0 才更新，'),
  body('        且改為員工層級 merge（不整批覆蓋）'),
  spacer(),
  body('Fix 2 — ShiftSystem.jsx syncFromServer：'),
  body('  修前：{ ...prev, ...newAttend }（日期層級，server 空日期蓋掉本機）'),
  body('  修後：逐 date/dayMap 迭代，只在 dayMap 非空時做員工層級 merge'),
  spacer(),
  body('Fix 3 — server.cjs PUT /api/attendance：'),
  body('  修前：即使 attendData={} 也執行 UPSERT，寫入 attendData:{} 至 DB'),
  body('  修後：attendData 與 extras 均為空時直接 return { ok: true }，不寫 DB'),
  body('        dayMap 為空的日期也略過，不建立空日期記錄'),
  spacer(),body('漏洞統計：',{bold:true}),spacer(),statsTable,spacer(),
  body('部署建議：無安全疑慮，可直接部署。'),
  spacer(),new Paragraph({children:[new PageBreak()]}),
  h1('2. 漏洞詳細清單'),spacer(),body('本次掃描未發現任何漏洞。'),spacer(),
  new Paragraph({children:[new PageBreak()]}),
  h1('3. 結論'),spacer(),
  body('本次掃描未發現任何漏洞，程式碼通過資安檢測，允許部署。'),spacer(),
  body('  ✅  Fix 1：init 不以空 {} 覆蓋本機有效出勤資料'),
  body('  ✅  Fix 2：sync 改為員工層級 merge，空日期不蓋掉本機記錄'),
  body('  ✅  Fix 3：server 拒絕寫入空 attendData，避免產生污染性 DB 記錄'),
  body('  ✅  三層修正後，桌機空狀態不再能清空行動裝置的出勤資料'),
]}]});
Packer.toBuffer(doc).then(buf=>{ fs.writeFileSync(OUTPUT,buf); console.log('OK: '+OUTPUT); }).catch(e=>{ console.error(e); process.exit(1); });
