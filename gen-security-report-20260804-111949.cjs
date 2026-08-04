'use strict';
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        HeadingLevel, AlignmentType, WidthType, ShadingType, PageBreak } = require('docx');
const fs = require('fs');
const OUTPUT = 'C:\\Users\\Grace\\Desktop\\AI測試好朋友\\輪休表\\排班作業\\security-report-20260804-111949.docx';
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
  body('本次異動（班表管理 — 一週一例假規則修正）：'),
  body('  問題 1：班表匯入邏輯錯誤 — 原本計數「休」並將第 2 個以上的「休」升格為「例」，'),
  body('          導致同一週可能出現多個「例」。'),
  body('  修正 1：改為計數「例」，一週內第 2 個以上的「例」降格為「休」，'),
  body('          「休」維持不變，確保每週最多一個「例」。'),
  body('  問題 2：手動點擊時 ADMIN/AREA 角色無一週一例的限制，'),
  body('          可任意新增多個「例」。'),
  body('  修正 2：ADMIN/AREA 點擊「例」時若本週已有「例」，'),
  body('          自動改為「休」並顯示提示，委外幹部維持原有錯誤阻擋行為。'),
  spacer(),body('漏洞統計：',{bold:true}),spacer(),statsTable,spacer(),
  body('部署建議：純前端邏輯修正，無任何漏洞，可直接部署。'),
  spacer(),new Paragraph({children:[new PageBreak()]}),
  h1('2. 漏洞詳細清單'),spacer(),body('本次掃描未發現任何漏洞。'),spacer(),
  body('補充說明：'),
  body('  weekExCount 僅在匯入函式內部存取，不涉及使用者輸入或外部資料。'),
  body('  getWeeklyLeaves 為既有 useCallback，已在 VENDOR 防呆中使用，無新攻擊面。'),
  body('  next = "休" 的自動轉換屬於純前端 state 操作，無 XSS 或注入風險。'),
  body('  不引入新的 API 路徑、認證變更或資料暴露風險。'),
  spacer(),
  new Paragraph({children:[new PageBreak()]}),
  h1('3. 結論'),spacer(),
  body('本次掃描未發現任何漏洞，程式碼通過資安檢測，允許部署。'),spacer(),
  body('  ✅  匯入：一週最多一例，多餘的例降格為休'),
  body('  ✅  手動編輯：ADMIN/AREA 超額自動轉換，不硬性阻擋'),
  body('  ✅  純前端 state 操作，無 XSS 或注入風險'),
  body('  ✅  不引入新的認證路徑或資料暴露風險'),
]}]});
Packer.toBuffer(doc).then(buf=>{ fs.writeFileSync(OUTPUT,buf); console.log('OK: '+OUTPUT); }).catch(e=>{ console.error(e); process.exit(1); });
