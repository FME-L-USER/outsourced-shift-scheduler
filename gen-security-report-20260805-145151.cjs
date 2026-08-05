'use strict';
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        HeadingLevel, AlignmentType, WidthType, ShadingType, PageBreak } = require('docx');
const fs = require('fs');
const OUTPUT = 'C:\\Users\\Grace\\Desktop\\AI測試好朋友\\輪休表\\排班作業\\security-report-20260805-145151.docx';
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
  new Paragraph({alignment:AlignmentType.CENTER,children:[new TextRun({text:'掃描日期：2026-08-05',size:24})]}),
  new Paragraph({alignment:AlignmentType.CENTER,children:[new TextRun({text:'整體判斷：允許部署（無任何漏洞）',size:24,bold:true,color:'15803D'})]}),
  new Paragraph({children:[new PageBreak()]}),
  h1('1. 執行摘要'),spacer(),
  body('掃描範圍：ShiftSystem.jsx（前端）'),
  body('本次異動：修復廠商幹部勾選點名後切換分頁，回來後長期到班率歸零的問題'),
  body('  根本原因：visibilitychange 觸發時 GET /api/attendance 回傳 DB 舊資料'),
  body('  原本以 setAttendData(att.attendData) 直接取代 local state'),
  body('  若 2 秒 debounce 尚未存入 DB（分頁切換在 2 秒內），'),
  body('  今日剛勾選的到班記錄會被舊資料完全覆蓋，導致 longPresent = 0'),
  body('  儀表板因此只顯示橙色（臨時）條，長期到班率藍綠條消失'),
  body('  修復方式：改為 merge，local 已有的日期不被 server 資料覆蓋：'),
  body('    setAttendData(prev => ({ ...att.attendData, ...prev }))'),
  body('    setExtras(prev => ({ ...att.extras, ...prev }))'),
  body('  local 優先原則：未存的今日勾選不被覆蓋；server 補齊本地沒有的舊日期'),
  spacer(),body('安全性分析：',{bold:true}),
  body('  - 廠商幹部只能操作自己廠商的 attendData，不影響其他廠商'),
  body('  - merge 邏輯為純前端 state 操作，不涉及 API 呼叫或存取控制變更'),
  body('  - 不擴大任何角色的資料讀寫權限'),
  body('  - GET /api/attendance 仍受 requireAuth 保護'),
  spacer(),body('漏洞統計：',{bold:true}),spacer(),statsTable,spacer(),
  body('部署建議：無安全疑慮，可直接部署。'),
  spacer(),new Paragraph({children:[new PageBreak()]}),
  h1('2. 漏洞詳細清單'),spacer(),body('本次掃描未發現任何漏洞。'),spacer(),
  new Paragraph({children:[new PageBreak()]}),
  h1('3. 結論'),spacer(),
  body('本次掃描未發現任何漏洞，程式碼通過資安檢測，允許部署。'),spacer(),
  body('  \u2705  visibilitychange 同步改為 merge，local 未存資料不被 server 舊資料覆蓋'),
  body('  \u2705  廠商幹部切換分頁後，今日點名勾選不再消失'),
  body('  \u2705  長期到班率藍綠條可正確顯示於儀表板'),
]}]});
Packer.toBuffer(doc).then(buf=>{ fs.writeFileSync(OUTPUT,buf); console.log('OK: '+OUTPUT); }).catch(e=>{ console.error(e); process.exit(1); });
