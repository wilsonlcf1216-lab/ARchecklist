// 產生「可列印 AR 標記頁」：把 8 張 Barcode 標記內嵌成單一 HTML（base64），方便列印／螢幕顯示
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const spaces = [
  { v: 0, code: 'MAIN-3F-A-01', loc: '主樓', floor: '3F', zone: 'A', room: '01', name: '內科病房' },
  { v: 1, code: 'MAIN-3F-A-02', loc: '主樓', floor: '3F', zone: 'A', room: '02', name: '內科病房' },
  { v: 2, code: 'MAIN-3F-B-05', loc: '主樓', floor: '3F', zone: 'B', room: '05', name: '治療室' },
  { v: 3, code: 'MAIN-2F-A-03', loc: '主樓', floor: '2F', zone: 'A', room: '03', name: '藥房' },
  { v: 4, code: 'EAST-2F-N-07', loc: '東翼', floor: '2F', zone: 'N', room: '07', name: '藥房' },
  { v: 5, code: 'EAST-1F-S-02', loc: '東翼', floor: '1F', zone: 'S', room: '02', name: '候診區' },
  { v: 6, code: 'OPD-G-E-03', loc: '門診', floor: 'G', zone: 'E', room: '03', name: '診室' },
  { v: 7, code: 'OPD-G-E-04', loc: '門診', floor: 'G', zone: 'E', room: '04', name: '診室' }
];

const b64 = {};
for (const s of spaces) {
  const p = path.join(dir, 'markers', '3x3_' + s.v + '.png');
  if (!fs.existsSync(p)) { console.error('缺少標記檔：' + p); process.exit(1); }
  b64[s.v] = fs.readFileSync(p).toString('base64');
}

const cards = spaces.map(function (s) {
  return '' +
    '<div class="card">' +
      '<div class="mk"><img alt="AR marker ' + s.v + '" src="data:image/png;base64,' + b64[s.v] + '"></div>' +
      '<div class="meta">' +
        '<div class="code">' + s.code + '</div>' +
        '<div class="place">' + s.loc + ' · ' + s.floor + ' / ' + s.zone + ' / ' + s.room + '</div>' +
        '<div class="name">' + s.name + '</div>' +
        '<div class="val">AR.js barcode 3x3 · value = <b>' + s.v + '</b></div>' +
      '</div>' +
    '</div>';
}).join('\n');

const html = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>醫院缺陷查驗 — AR 標記列印頁（Barcode 3x3）</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang TC", "Microsoft JhengHei", sans-serif; color: #1c1f24; background: #f2f3f5; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #5b6472; font-size: 13px; margin: 0 0 16px; }
  .tips { background: #fff; border: 1px solid #e3e6eb; border-left: 4px solid #2f6df6; border-radius: 0 10px 10px 0; padding: 10px 14px; font-size: 13px; line-height: 1.6; margin-bottom: 18px; }
  .tips b { color: #2f6df6; }
  .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
  .card { background: #fff; border: 1px dashed #c8ccd3; border-radius: 10px; padding: 14px; display: flex; gap: 14px; align-items: center; break-inside: avoid; }
  .mk { flex: 0 0 auto; width: 160px; height: 160px; background: #fff; display: flex; align-items: center; justify-content: center; }
  .mk img { width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; }
  .meta { flex: 1 1 auto; min-width: 0; }
  .code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 15px; font-weight: 700; letter-spacing: .3px; }
  .place { font-size: 13px; margin-top: 3px; }
  .name { font-size: 12.5px; color: #5b6472; margin-top: 2px; }
  .val { font-size: 11.5px; color: #8a94a3; margin-top: 6px; font-family: ui-monospace, monospace; }
  .val b { color: #1c1f24; }
  @media print {
    body { background: #fff; padding: 0; }
    .tips { border: 1px solid #999; background: #fff; }
    .grid { gap: 12px; }
    .card { border: 1px solid #bbb; padding: 10px; }
    .mk { width: 150px; height: 150px; }
    h1 { font-size: 16px; }
  }
</style>
</head>
<body>
  <h1>醫院缺陷查驗 — AR 標記列印頁</h1>
  <p class="sub">AR.js Barcode 3x3 · 共 ${spaces.length} 個示範空間（value 0–7）</p>
  <div class="tips">
    <b>列印注意：</b>用 <b>黑白</b> 列印、<b>啞面</b>紙（唔好用光面），<b>保留白色邊框</b>、唔好裁到黑格。<br>
    貼好後喺 AR 頁面把手機對準標記（約 30–60cm），見到「已對準」即代表認到位置。標記尺寸建議 <b>≥ 12cm</b>。
  </div>
  <div class="grid">
${cards}
  </div>
</body>
</html>
`;

const out = path.join(dir, 'ar-markers-print.html');
fs.writeFileSync(out, html, 'utf-8');
console.log('已產出：' + out + '（' + (fs.statSync(out).size / 1024).toFixed(1) + ' KB）');
