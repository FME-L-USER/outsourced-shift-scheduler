'use strict';
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        HeadingLevel, AlignmentType, WidthType, ShadingType, PageBreak } = require('docx');
const fs = require('fs');
const OUTPUT = 'C:\\Users\\Grace\\Desktop\\AI測試好朋友\\輪休表\\排班作業\\security-report-20260807-153810.docx';
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
  new Paragraph({alignment:AlignmentType.CENTER,children:[new TextRun({text:'掃描日期：2026-08-07',size:24})]}),
  new Paragraph({alignment:AlignmentType.CENTER,children:[new TextRun({text:'整體判斷：允許部署（無任何漏洞）',size:24,bold:true,color:'15803D'})]}),
  new Paragraph({children:[new PageBreak()]}),
  h1('1. 執行摘要'),spacer(),
  body('掃描範圍：ShiftSystem.jsx（前端）'),
  body('本次異動：修正儀表板長條圖橙色覆蓋綠色長條的 Canvas 繪製 bug'),
  spacer(),
  h2('問題描述'),spacer(),
  body('問題現象：長期到班率（綠/青色長條）被橙色完全覆蓋，即使長期到班率為 100% 也看不到綠色長條。'),
  spacer(),
  body('根本原因：'),
  body('  roundRect() 輔助函式在 w <= 0（零寬度）時，執行 ctx.rect(x, y, 0, h) 後直接 return，'),
  body('  未先呼叫 ctx.beginPath() 清空路徑。'),
  body('  此時 canvas context 仍保留前一個繪製物件（綠色長條）的路徑。'),
  body('  接著程式將 fillStyle 改為橙色（#f97316）並呼叫 ctx.fill()，'),
  body('  結果以橙色重新填滿了綠色長條的路徑形狀，將其完整覆蓋。'),
  spacer(),
  h2('修正內容'),spacer(),
  body('修改位置：ShiftSystem.jsx drawBar() 函式（約第 1565–1578 行）'),
  body('修前：ctx.fillStyle = \'#0d9488\'; roundRect(...longW...); ctx.fill();'),
  body('      ctx.fillStyle = \'#f97316\'; roundRect(...tempW...); ctx.fill();'),
  body('      // 當 tempW=0 時，roundRect 未清空路徑，ctx.fill() 以橙色覆蓋綠色長條'),
  spacer(),
  body('修後：if (longW > 0) { ctx.fillStyle = \'#0d9488\'; roundRect(...); ctx.fill(); }'),
  body('      if (tempW > 0) { ctx.fillStyle = \'#f97316\'; roundRect(...); ctx.fill(); }'),
  body('      // 寬度為 0 時跳過 fill，綠色長條不再被橙色覆蓋'),
  spacer(),body('漏洞統計：',{bold:true}),spacer(),statsTable,spacer(),
  body('部署建議：無安全疑慮，可直接部署。'),
  spacer(),new Paragraph({children:[new PageBreak()]}),
  h1('2. 漏洞詳細清單'),spacer(),body('本次掃描未發現任何漏洞。'),spacer(),
  new Paragraph({children:[new PageBreak()]}),
  h1('3. 結論'),spacer(),
  body('本次掃描未發現任何漏洞，程式碼通過資安檢測，允許部署。'),spacer(),
  body('  ✅  加入 w > 0 guard，防止零寬度 fill 覆蓋前一個路徑'),
  body('  ✅  長期到班率（綠色長條）可正常顯示，不再被橙色覆蓋'),
]}]});
Packer.toBuffer(doc).then(buf=>{ fs.writeFileSync(OUTPUT,buf); console.log('OK: '+OUTPUT); }).catch(e=>{ console.error(e); process.exit(1); });
