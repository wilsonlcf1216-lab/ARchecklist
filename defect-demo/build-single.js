/* 產出單一 HTML 版本：把 CSS 與 libs 全部內嵌到 index.html
 * 用法：node build-single.js
 */
const fs = require('fs');
const path = require('path');

const root = __dirname;
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let html = read('index.html');

// 內嵌 CSS
const css = read('styles.css');
html = html.replace(/<link rel="stylesheet" href="styles\.css">/, '<style>\n' + css + '\n</style>');

// 內嵌 JS（依 index.html 出現順序）
html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => {
  let code = read(src);
  // 避免 JS 內容中的 </script> 提早結束標籤
  code = code.replace(/<\/script/gi, '<\\/script');
  return '<script>\n' + code + '\n</script>';
});

const outDir = path.join(root, 'dist');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'defect-demo-single.html');
fs.writeFileSync(outFile, html);

console.log('已產出：' + outFile);
console.log('大小：' + (fs.statSync(outFile).size / 1024 / 1024).toFixed(2) + ' MB');
