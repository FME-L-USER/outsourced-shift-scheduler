'use strict';
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        HeadingLevel, AlignmentType, WidthType, ShadingType, PageBreak } = require('docx');
const fs = require('fs');
const OUTPUT = 'C:\\Users\\Grace\\Desktop\\AI測試好朋友\\輪休表\\排班作業\\security-report-20260806-100727.docx';
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
  body('本次異動：儀表板 KPI 資料正確性修正（5 項）'),
  spacer(),
  h2('問題描述'),spacer(),
  body('根據使用者規格審查，儀表板以下 KPI 來源有誤：'),
  body('  1. KPI 1（長期在職總人數）：visibleEmployees 未過濾離職人員，導致在職人數虛高'),
  body('  2. KPI 3（今日實際到班長期）：actualPresent 計算全部 attendData，未限縮至當前倉別/課別/組別在職員工'),
  body('  3. KPI 4（今日實際到班臨時）：dayExtras 只篩選 selectedGroup，未套用 selectedWarehouse 條件'),
  body('  4. KPI 5（各廠商在職人力分布）：dashEmployees 未過濾離職人員，圓餅圖含離職員工'),
  body('  5. KPI 7（各廠商人力明細組別欄）：per-組別欄顯示「應到人數」而非「實際到班人數」'),
  spacer(),
  h2('修正內容'),spacer(),
  body('Fix 1 — visibleEmployees（第 1364 行）：'),
  body('  修前：employees.filter(e => e.vendor && e.vendor.trim() !== \'\')'),
  body('  修後：同上 + && e.status === \'在職\''),
  spacer(),
  body('Fix 2 — dashEmployees（第 1372 行）：'),
  body('  修前：employees.filter(e => e.vendor && e.vendor.trim() !== \'\')'),
  body('  修後：同上 + && e.status === \'在職\''),
  spacer(),
  body('Fix 3 — actualPresent（第 1454 行）：'),
  body('  修前：Object.values(dayData).filter(r => r.present).length（計算全部）'),
  body('  修後：以 dashEmployees ID Set 交集，只計算範圍內在職員工'),
  spacer(),
  body('Fix 4 — dayExtras scope filter（第 1423 行）：'),
  body('  修前：只篩選 selectedGroup'),
  body('  修後：加入 scopeVendors（從 dashEmployees 萃取），selectedWarehouse 不為空時限縮廠商'),
  spacer(),
  body('Fix 5 — 各廠商組別欄（第 1806 行）：'),
  body('  修前：s.groups[gc.label]（應到人數）'),
  body('  修後：s.groupPresent[gc.label]（實際到班人數）'),
  body('  說明：vendorStats 新增 groupPresent 物件，員工 attendData 打勾時計入對應組別'),
  spacer(),body('漏洞統計：',{bold:true}),spacer(),statsTable,spacer(),
  body('部署建議：無安全疑慮，可直接部署。'),
  spacer(),new Paragraph({children:[new PageBreak()]}),
  h1('2. 漏洞詳細清單'),spacer(),body('本次掃描未發現任何漏洞。'),spacer(),
  new Paragraph({children:[new PageBreak()]}),
  h1('3. 結論'),spacer(),
  body('本次掃描未發現任何漏洞，程式碼通過資安檢測，允許部署。'),spacer(),
  body('  ✅  KPI 1/5：visibleEmployees / dashEmployees 限縮為在職員工'),
  body('  ✅  KPI 3：actualPresent 交集當前倉別/課別/組別在職員工 ID'),
  body('  ✅  KPI 4：dayExtras 加入廠商範圍過濾，配合 selectedWarehouse 條件'),
  body('  ✅  KPI 7：各組別欄改顯示實際到班人數（groupPresent）而非應到人數'),
]}]});
Packer.toBuffer(doc).then(buf=>{ fs.writeFileSync(OUTPUT,buf); console.log('OK: '+OUTPUT); }).catch(e=>{ console.error(e); process.exit(1); });
