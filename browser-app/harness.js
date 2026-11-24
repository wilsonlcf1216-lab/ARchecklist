// Offline harness: exercise the pure logic of app.js (no DOM) against the real workbook.
const fs = require("fs");
const path = require("path");
global.XLSX = require(path.join(__dirname, "xlsx.full.min.js"));

let src = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
src = src.replace(/boot\(\)\.catch[\s\S]*$/m, ""); // drop the DOM boot call

const test = `
const file = process.argv[2];
const buf = fs.readFileSync(file);
const res = parseWorkbook(buf, path.basename(file));
console.log("sheet meta:", JSON.stringify(res.meta));
console.log("parsed rows:", res.rows.length);
console.log("first row:", JSON.stringify(res.rows[0]));

const before = ITEMS.length;
res.rows.forEach(r => addItem(Object.assign({}, r, { source_file: path.basename(file) })));
console.log("items added:", ITEMS.length - before);

// normalisation checks
const eq = (a,b,label) => console.log((a===b?"PASS":"FAIL")+" "+label+" -> "+JSON.stringify(a));
eq(normStatus("Open"), "Not started", "normStatus Open");
eq(normStatus("Completed"), "Rectified", "normStatus Completed->Rectified");
eq(normStatus("closed"), "Verified", "normStatus closed");
eq(normCategory("architetural"), "Architectural", "normCategory typo");
eq(normSoa("satelliate station"), "Satellite Station", "normSoa typo");

// filter by priority then multi-sort issue_type + priority
state.filters = { priority: ["1"] };
state.sort = [{col:"issue_type",dir:"asc"},{col:"priority",dir:"asc"}];
const q = queryItems();
console.log("filter priority=1 ->", q.length, "items");
console.log("sorted (issue_type, priority):", q.slice(0,6).map(i=>i.issue_type+"/"+i.priority).join("  |  "));

// status counts
const byStatus = {};
ITEMS.forEach(i => byStatus[i.status] = (byStatus[i.status]||0)+1);
console.log("status counts:", JSON.stringify(byStatus));

// overdue detection
const od = ITEMS.filter(isOverdue).length;
console.log("overdue count:", od);

// xlsx export builds without error (write to buffer)
const head = EXPORT_COLUMNS.map(c=>c[0]);
const aoa = [head].concat(q.map(r=>EXPORT_COLUMNS.map(([,f])=>r[f]==null?"":r[f])));
const ws = XLSX.utils.aoa_to_sheet(aoa);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "Rectification List");
const out = XLSX.write(wb, {type:"buffer", bookType:"xlsx"});
console.log("xlsx export bytes:", out.length);
`;

eval(src + "\n" + test);
