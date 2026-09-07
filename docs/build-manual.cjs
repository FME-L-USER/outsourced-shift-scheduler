// 操作手冊組版工具
// 用法：node build-manual.cjs <body 檔> <輸出檔> "<標題>" "<版本>" "<日期>"
// 三本手冊共用同一套版面樣式（_manual-style.html）與目錄互動（_manual-script.html），
// 各自只維護內容檔（*.body.html），避免樣式在三份文件間走鐘。
const fs = require('fs');
const path = require('path');

const [bodyFile, outFile, title, ver, date] = process.argv.slice(2);
if (!bodyFile || !outFile) { console.error('缺少參數'); process.exit(1); }

const dir = __dirname;
const style  = fs.readFileSync(path.join(dir, '_manual-style.html'), 'utf8');
const script = fs.readFileSync(path.join(dir, '_manual-script.html'), 'utf8');
const body   = fs.readFileSync(path.join(dir, bodyFile), 'utf8');

// body 檔以「<!--TOC-->…<!--/TOC-->」標示目錄，其餘為內文
const toc  = (body.match(/<!--TOC-->([\s\S]*?)<!--\/TOC-->/) || [, ''])[1];
const main = body.replace(/<!--TOC-->[\s\S]*?<!--\/TOC-->/, '');

const html = `<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>委外人力排班作業平台｜${title}</title>
${style}

<header class="top">
  <button id="navToggle" aria-label="開啟目錄">☰</button>
  <div>
    <div class="co">日翊文化行銷股份有限公司　|　物流本部</div>
    <h1>委外人力排班作業平台　${title}</h1>
  </div>
  <div class="ver">${ver}　|　${date}</div>
</header>

<div class="wrap">
<nav class="toc" id="toc">
  <div class="toc-title">目錄</div>
${toc}</nav>

<main>
${main}
</main>
</div>

<footer>
  日翊文化行銷股份有限公司　物流本部　|　委外人力排班作業平台（VSP）　${title}　${ver}<br>
  本手冊之畫面均為示意圖，人名與員工編號為虛構範例。
</footer>
${script}
`;

fs.writeFileSync(path.join(dir, outFile), html);
console.log('已產出：' + path.join(dir, outFile) + '（' + html.length + ' 字元）');
