// 由站區表 Excel 產生 STATION_LAYOUTS 的 grid 版面設定（保留現場相對位置）
const XLSX = require('xlsx');
const path = require('path');
const DIR = 'C:/Users/Grace/Desktop/★★★★★★★★★站區表';

const JOBS = [
  {
    area: 'O2O', group: '日班-出貨組', workArea: 'O2O', title: 'O 2 O 作 業',
    file: '日班-出貨組站區-O2O.xlsx', sheet: '0914',
    keep: /^(分貨|北|南|NG|移動|箱式立庫|A9\d|補貨站|開箱機|儲調|盤點|收發實習|入庫上架|包裝|QC|A類|訂單播種站|中分站)/,
  },
  {
    area: '理貨', group: '日班-理貨組', title: '理 貨 作 業',
    file: '大肚倉站區表115年9月.xlsx', sheet: '理貨',
    keep: /^([WXY][A-Z]|D[34]|投料|外露件|異常件|無資料|上架|裝箱|\d+-\d+|\d+$)/,
  },
  {
    area: '驗收', group: '日班-理貨組', title: '驗 收 作 業',
    file: '大肚倉站區表115年9月.xlsx', sheet: '驗收 ',
    keep: /^(碼頭|北|南|中|K中|無\s*資\s*料|高風險件|補料|投料|移動|空籃補送|未讀取|EC退|退\s*貨\s*通|救命鞋|特殊VIP|時\s*效\s*件|螺旋輸送|D\d|小幫手|外場人員|特殊件|返廠移動)/,
  },
  {
    area: '中班理貨', group: '中班-理貨組', title: '中 班 理 貨 作 業',
    file: '中班-理貨組站區.xlsx', sheet: '0910',
    keep: /^([WXY][A-Z]|D[34]|投料|外露件|異常件|無資料|上架|裝箱|\d+-\d+|小幫手|推高機人員|外場人員|返廠驗收|空籃補送|運務支援|封箱|共配|外露件過刷|外露件分類|裝箱支援|3F移動|D3異常|D4異常|自動倉)/,
  },
];

const slug = (s, i) => 's' + i + '_' + String(s).replace(/[^A-Za-z0-9]/g, '').slice(0, 10);

for (const job of JOBS) {
  const wb = XLSX.readFile(path.join(DIR, job.file));
  const ws = wb.Sheets[job.sheet];
  if (!ws) { console.error('缺工作表', job.file, job.sheet, '→', wb.SheetNames.join('/')); continue; }
  const range = XLSX.utils.decode_range(ws['!ref']);
  const merges = ws['!merges'] || [];
  const mergeAt = (r, c) => merges.find(m => m.s.r === r && m.s.c === c);

  const blocks = [];
  let i = 0;
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (!cell) continue;
      const t = String(cell.v).replace(/\s+/g, ' ').trim();
      if (!t || !job.keep.test(t)) continue;
      const m = mergeAt(r, c);
      blocks.push({
        key: slug(t, i++),
        label: t,
        r: r + 1, c: c + 1,
        w: m ? (m.e.c - m.s.c + 1) : 1,
      });
    }
  }
  // 貨號範圍（例 2-4）是上一列站位代碼的附註，併入該站位標籤，不另成一格
  const isRange = t => /^\d+(-\d+)?$/.test(t);
  const byPos = new Map(blocks.map(b => [`${b.r}:${b.c}`, b]));
  const merged = [];
  for (const b of blocks) {
    if (isRange(b.label)) {
      const up = byPos.get(`${b.r - 1}:${b.c}`);
      if (up && !isRange(up.label)) { up.label += ' ' + b.label; continue; }
    }
    merged.push(b);
  }
  // 同一列相鄰、同名的重複標籤只留第一個
  const seen = new Set();
  const uniq = merged.filter(b => {
    const k = `${b.r}:${b.label}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });

  const cols = range.e.c + 1;
  console.log(`  '${job.area}': {`);
  console.log(`    group: '${job.group}',`);
  if (job.workArea) console.log(`    workArea: '${job.workArea}',`);
  console.log(`    title: '${job.title}',`);
  console.log(`    grid: { cols: ${cols} },`);
  console.log('    blocks: [');
  for (const b of uniq) {
    console.log(`      { key: '${b.key}', label: '${b.label}', r: ${b.r}, c: ${b.c}, w: ${b.w}, slots: 1 },`);
  }
  console.log('    ],');
  console.log('  },');
}
