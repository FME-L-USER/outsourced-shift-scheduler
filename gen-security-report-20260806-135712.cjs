'use strict';
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        HeadingLevel, AlignmentType, WidthType, ShadingType, PageBreak } = require('docx');
const fs = require('fs');
const OUTPUT = 'C:\\Users\\Grace\\Desktop\\AI測試好朋友\\輪休表\\排班作業\\security-report-20260806-135712.docx';
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
  body('本次異動：修正儀表板長期到班率（綠色橫條）持續顯示 0% 問題'),
  spacer(),
  h2('問題描述'),spacer(),
  body('問題現象：'),
  body('  - 點名表勾選的是長期員工，儀表板各廠商到班率卻顯示在橘色（臨時）橫條，綠色（長期）橫條顯示 0%'),
  spacer(),
  body('根本原因：'),
  body('  vendorStats 中計算 longPresent 的方式是迭代 dashEmployees，'),
  body('  對每位員工檢查 attendData[attendDkPad][emp.id]?.present。'),
  body('  但 dashEmployees 使用 e.status !== \'離職\' 和 filterByScope 過濾，'),
  body('  而 點名表的 scopedEmps 僅使用 e.vendor 過濾（未過濾 status）。'),
  body('  當兩者包含的員工 ID 集合不完全相同時（例如員工 status 欄位空白或'),
  body('  scopeEmps 包含 dashEmployees 未含的員工），'),
  body('  被勾選的員工 ID 不在 dashEmployees 的迭代範圍內，'),
  body('  導致 longPresent 計算為 0，綠色橫條顯示 0%。'),
  spacer(),
  h2('修正內容'),spacer(),
  body('修改位置：ShiftSystem.jsx vendorStats useMemo（第 1422～1428 行）'),
  body(''),
  body('修前：'),
  body('  迭代 dashEmployees，對每位員工檢查 attendData[attendDkPad][emp.id]?.present'),
  body('  僅計算 dashEmployees 範圍內員工的出勤'),
  body(''),
  body('修後：'),
  body('  改為直接掃描 attendData[attendDkPad] 中所有 present=true 的記錄，'),
  body('  透過 employees.find(e => e.id === empId) 查出員工廠商，'),
  body('  確認廠商在 map（dashEmployees 建立的廠商範圍）內才計入 longPresent。'),
  body('  這樣無論員工是否在 dashEmployees 的 scope/status 過濾範圍內，'),
  body('  只要他被勾選且廠商在範圍內，就會正確計入 longPresent。'),
  spacer(),
  body('同時更新 vendorStats 的 useMemo 依賴陣列，加入 employees。'),
  spacer(),body('漏洞統計：',{bold:true}),spacer(),statsTable,spacer(),
  body('部署建議：無安全疑慮，可直接部署。'),
  spacer(),new Paragraph({children:[new PageBreak()]}),
  h1('2. 漏洞詳細清單'),spacer(),body('本次掃描未發現任何漏洞。'),spacer(),
  new Paragraph({children:[new PageBreak()]}),
  h1('3. 結論'),spacer(),
  body('本次掃描未發現任何漏洞，程式碼通過資安檢測，允許部署。'),spacer(),
  body('  ✅  longPresent 改為掃描 attendData 全部記錄，不受 dashEmployees 範圍限制'),
  body('  ✅  點名表勾選長期員工後，儀表板綠色橫條將正確顯示到班率'),
  body('  ✅  臨時人員（extras）仍獨立計入橘色橫條，兩者不互相干擾'),
]}]});
Packer.toBuffer(doc).then(buf=>{ fs.writeFileSync(OUTPUT,buf); console.log('OK: '+OUTPUT); }).catch(e=>{ console.error(e); process.exit(1); });
