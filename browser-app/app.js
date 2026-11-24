"use strict";
/* Rectification Tracker - single-file browser app. No server, no install. */

// ============================================================ reference ==
const PRIORITY_LEVELS = ["1", "2", "3", "4"];
const ISSUE_TYPES = ["Defect", "Incomplete works", "Maintenance concern", "Design change request"];
const STATUSES = ["Not started", "In progress", "Completed", "Verified"];
const GENERAL_CATEGORY_GROUPS = {
  "Architectural": ["Ceiling", "Floor", "Wall Finishes", "Door Hardware", "Window and Glazing",
    "Fixtures", "Toilet and Sanitary Fitment", "General Wet Areas", "Signage"],
  "Building Services": ["Mechanical Ventilation and Air Conditioning", "Electrical Installation",
    "Fire Service Installation", "Plumbing and Drainage Installation", "Medical Gas Installation"],
};
const SOA_GROUPS = {
  "Patient Area": ["1-Bed Isolation Room", "2-Bed Room", "4-Bed Room", "8-Bed Room", "End of Life Room", "Ante-Room"],
  "Toilet / Shower": ["Ensuite Toilet", "Anteroom", "Patient Lavatory", "Patient Accessible Toilet",
    "Staff Lavatory (M)", "Staff Lavatory (F)", "Staff Shower", "Emergency Shower"],
  "Staff Area": ["Nurse Station", "Satellite Station", "Treatment Room", "Day Room", "Interview Room", "WM Office", "APN/NO Office"],
  "Store": ["Linen", "Med/Consum/Stationary", "Med/IV Room", "Equipment Parking", "PPE"],
  "Supporting Area": ["Clean Utility", "Dirty Utility", "Assisted Bath", "Meal Preparation Room",
    "Gown-up Room", "Gown-down Room", "ALC-Gown Up", "ALC-Gown Down", "Cleaner's Room", "Refuse & Soiled Linen Room"],
};
const CATEGORY_ALIASES = { "architetural": "Architectural", "architectural": "Architectural", "building_services": "Building Services", "building services": "Building Services" };
const SOA_ALIASES = { "patient_accessible_toilet": "Patient Accessible Toilet", "satelliate station": "Satellite Station" };
const STATUS_ALIASES = { "not started": "Not started", "notstarted": "Not started", "open": "Not started", "in progress": "In progress", "inprogress": "In progress", "wip": "In progress", "completed": "Completed", "complete": "Completed", "done": "Completed", "verified": "Verified", "closed": "Verified" };
const GENERAL_CATEGORIES = Object.values(GENERAL_CATEGORY_GROUPS).flat();
const SOAS = Object.values(SOA_GROUPS).flat();

function normCategory(v) {
  if (!v) return "";
  const raw = String(v).trim();
  const c = CATEGORY_ALIASES[raw.toLowerCase()] || raw;
  return GENERAL_CATEGORIES.find(x => x.toLowerCase() === c.toLowerCase()) || c;
}
function normSoa(v) {
  if (!v) return "";
  const raw = String(v).trim();
  const c = SOA_ALIASES[raw.toLowerCase()] || raw;
  return SOAS.find(x => x.toLowerCase() === c.toLowerCase()) || c;
}
function normStatus(v) {
  if (!v) return "Not started";
  const c = STATUS_ALIASES[String(v).trim().toLowerCase()];
  if (c) return c;
  return STATUSES.find(x => x.toLowerCase() === String(v).trim().toLowerCase()) || String(v).trim();
}
function reference() {
  return { priority_levels: PRIORITY_LEVELS, issue_types: ISSUE_TYPES, statuses: STATUSES,
    general_category_groups: GENERAL_CATEGORY_GROUPS, soa_groups: SOA_GROUPS };
}

const FILTERABLE_COLUMNS = ["soa", "room", "priority", "issue_type", "general_category", "status", "source_file", "floor", "ward_unit"];
const EXPORT_COLUMNS = [
  ["Item No.", "item_no"], ["SoA", "soa"], ["Room", "room"], ["Priority Level", "priority"],
  ["Type of Issue", "issue_type"], ["General Category", "general_category"],
  ["Details Description", "description"], ["Photo Reference Number", "photo_ref"],
  ["Expected Completion Date", "expected_completion_date"], ["Rectification Status", "status"],
  ["Completed Date", "completed_date"], ["Verified Date", "verified_date"],
  ["Floor", "floor"], ["Ward/Unit", "ward_unit"], ["Source File", "source_file"],
];
const COLS = [
  { label: "#", field: "id", sortable: true, w: 50 },
  { label: "Item No.", field: "item_no", sortable: true },
  { label: "SoA", field: "soa", sortable: true },
  { label: "Room", field: "room", sortable: true },
  { label: "Priority", field: "priority", sortable: true },
  { label: "Type of Issue", field: "issue_type", sortable: true },
  { label: "General Category", field: "general_category", sortable: true },
  { label: "Details Description", field: "description", sortable: true, cls: "desc" },
  { label: "Expected Completion", field: "expected_completion_date", sortable: true },
  { label: "Status", field: "status", sortable: true },
  { label: "Photos", field: "photos", sortable: false },
  { label: "Source File", field: "source_file", sortable: true },
];
const FILTER_DEFS = [
  { col: "priority", label: "Priority", fromRef: "priority_levels" },
  { col: "issue_type", label: "Issue Type", fromRef: "issue_types" },
  { col: "general_category", label: "Category", fromRef: "general_category_groups" },
  { col: "status", label: "Status", fromRef: "statuses" },
  { col: "soa", label: "SoA", fromRef: "soa_groups" },
  { col: "floor", label: "Floor", fromFacet: true },
  { col: "ward_unit", label: "Ward/Unit", fromFacet: true },
  { col: "source_file", label: "Source File", fromFacet: true },
];
const DB_NAME = "rectrack", DB_VERSION = 1;

// ============================================================== storage ==
let db = null, storageOK = false, lsOK = false;
let ITEMS = [], PHOTOS = [], META = {};
const SEQ = { items: 0, photos: 0 };
const MEM_BLOBS = new Map();  // fallback-mode blob store

function idbReq(req) { return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); }); }
function idbAll(store) { return new Promise((res, rej) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }

async function dbInit() {
  try {
    db = await new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = e => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains("items")) d.createObjectStore("items", { keyPath: "id" });
        if (!d.objectStoreNames.contains("photos")) { const s = d.createObjectStore("photos", { keyPath: "id" }); s.createIndex("item_id", "item_id"); }
        if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta", { keyPath: "key" });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error || new Error("indexedDB error"));
    });
    storageOK = true;
  } catch (e) { storageOK = false; }
  if (storageOK) {
    ITEMS = await idbAll("items");
    const all = await idbAll("photos");
    PHOTOS = all.map(p => ({ id: p.id, item_id: p.item_id, name: p.name, kind: p.kind }));
    const m = await idbAll("meta");
    META = {}; m.forEach(x => (META[x.key] = x.value));
  } else {
    // IndexedDB unavailable: fall back to localStorage for items + metadata (photos stay in memory).
    try { localStorage.setItem("__rt_probe", "1"); localStorage.removeItem("__rt_probe"); lsOK = true; } catch (e) { lsOK = false; }
    if (lsOK) {
      try {
        const raw = localStorage.getItem("rectrack_data");
        if (raw) { const d = JSON.parse(raw); ITEMS = d.items || []; META = d.meta || {}; if (d.seq) { SEQ.items = d.seq.items || 0; SEQ.photos = d.seq.photos || 0; } }
      } catch (e) { /* ignore */ }
    }
  }
  ITEMS.sort((a, b) => a.id - b.id);
  SEQ.items = Math.max(ITEMS.reduce((m, i) => Math.max(m, i.id), 0), META.seq_items || 0);
  SEQ.photos = Math.max(PHOTOS.reduce((m, p) => Math.max(m, p.id), 0), META.seq_photos || 0);
}

let _lsTimer = null;
function scheduleLsSave() {
  if (storageOK || !lsOK) return;
  clearTimeout(_lsTimer);
  _lsTimer = setTimeout(() => {
    try { localStorage.setItem("rectrack_data", JSON.stringify({ items: ITEMS, meta: META, seq: SEQ })); } catch (e) { /* quota */ }
  }, 400);
}

function persistItem(it) { if (storageOK) { try { db.transaction("items", "readwrite").objectStore("items").put(it); } catch (e) { } } else scheduleLsSave(); }
function removeItemRow(id) { if (storageOK) { try { db.transaction("items", "readwrite").objectStore("items").delete(id); } catch (e) { } } else scheduleLsSave(); }
function persistPhoto(p) {
  if (!storageOK) { MEM_BLOBS.set(p.id, p.blob); return; }
  try { db.transaction("photos", "readwrite").objectStore("photos").put({ id: p.id, item_id: p.item_id, name: p.name, kind: p.kind, blob: p.blob }); } catch (e) { }
}
function removePhotoRow(id) { if (!storageOK) { MEM_BLOBS.delete(id); return; } try { db.transaction("photos", "readwrite").objectStore("photos").delete(id); } catch (e) { } }
function putMeta(k, v) { META[k] = v; if (storageOK) { try { db.transaction("meta", "readwrite").objectStore("meta").put({ key: k, value: v }); } catch (e) { } } else scheduleLsSave(); }

async function photoBlob(id) {
  if (!storageOK) return MEM_BLOBS.get(id) || null;
  const p = await idbReq(db.transaction("photos").objectStore("photos").get(id));
  return p ? p.blob : null;
}

// ------------------------------------------------------------- data ops --
function nowStamp() { return new Date().toISOString().slice(0, 19).replace("T", " "); }
function todayStr() { return new Date().toISOString().slice(0, 10); }

function syncStatusDates(it) {
  if (["Completed", "Verified"].includes(it.status)) { if (!it.completed_date) it.completed_date = todayStr(); }
  else it.completed_date = "";
  if (it.status === "Verified") { if (!it.verified_date) it.verified_date = todayStr(); }
  else it.verified_date = "";
}

function addItem(data) {
  const id = ++SEQ.items; putMeta("seq_items", SEQ.items);
  const it = {
    id,
    source_file: data.source_file || "",
    item_no: data.item_no || "",
    soa: normSoa(data.soa),
    room: data.room || "",
    priority: (data.priority || "").toString().trim(),
    issue_type: data.issue_type || "",
    general_category: normCategory(data.general_category),
    description: data.description || "",
    photo_ref: data.photo_ref || "",
    expected_completion_date: data.expected_completion_date || "",
    status: normStatus(data.status),
    remarks: data.remarks || "",
    floor: data.floor || "",
    ward_unit: data.ward_unit || "",
    created_at: nowStamp(),
    updated_at: nowStamp(),
  };
  syncStatusDates(it);
  ITEMS.push(it); persistItem(it);
  return it;
}

function updateItem(id, data) {
  const it = ITEMS.find(x => x.id === id);
  if (!it) return null;
  const fields = ["item_no", "soa", "room", "priority", "issue_type", "general_category",
    "description", "photo_ref", "expected_completion_date", "status", "remarks", "floor", "ward_unit"];
  fields.forEach(f => { if (f in data) it[f] = data[f]; });
  it.soa = normSoa(it.soa); it.general_category = normCategory(it.general_category); it.status = normStatus(it.status);
  syncStatusDates(it);
  it.updated_at = nowStamp();
  persistItem(it);
  return it;
}

function deleteItem(id) {
  PHOTOS.filter(p => p.item_id === id).forEach(p => removePhotoRow(p.id));
  PHOTOS = PHOTOS.filter(p => p.item_id !== id);
  ITEMS = ITEMS.filter(x => x.id !== id);
  removeItemRow(id);
}

function photosFor(itemId) { return PHOTOS.filter(p => p.item_id === itemId); }

function addPhotoBlob(itemId, name, kind, blob) {
  const id = ++SEQ.photos; putMeta("seq_photos", SEQ.photos);
  const p = { id, item_id: itemId, name: name, kind: kind || "" };
  PHOTOS.push(p); persistPhoto({ ...p, blob });
  return p;
}
function deletePhoto(id) {
  const p = PHOTOS.find(x => x.id === id);
  if (p) removePhotoRow(p.id);
  PHOTOS = PHOTOS.filter(x => x.id !== id);
}

function clearAll() {
  ITEMS = []; PHOTOS = []; META = {}; MEM_BLOBS.clear(); SEQ.items = 0; SEQ.photos = 0;
  if (storageOK) { try { ["items", "photos", "meta"].forEach(s => db.transaction(s, "readwrite").objectStore(s).clear()); } catch (e) { } }
  else if (lsOK) { try { localStorage.removeItem("rectrack_data"); } catch (e) { } }
}

// =============================================================== excel ==
const HEADER_MAP = {
  "item no": "item_no", "item no.": "item_no", "soa": "soa", "room": "room",
  "room (e.g. 6-beds cubicle)": "room", "priority level": "priority", "type of issue": "issue_type",
  "general category": "general_category", "details description": "description",
  "photo reference number": "photo_ref", "expected completion date": "expected_completion_date",
  "rectification status": "status",
};
const META_LABELS = { "project": "project", "prepared by": "prepared_by", "date": "inspection_date", "floor": "floor", "ward/unit": "ward_unit" };

function normText(t) { return (t == null ? "" : String(t)).replace(/\s+/g, " ").trim().toLowerCase(); }
function cleanCell(v) {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number" && Number.isInteger(v)) return String(v);
  return String(v).trim();
}

function parseWorkbook(buf, filename) {
  const wb = XLSX.read(new Uint8Array(buf), { type: "array", cellDates: true });
  let name = wb.SheetNames.find(n => n.trim().toLowerCase() === "slag list") || wb.SheetNames[0];
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null });
  const meta = { filename, project: "", prepared_by: "", inspection_date: "", floor: "", ward_unit: "" };
  let headerIdx = -1, colMap = {};
  for (let i = 0; i < aoa.length; i++) {
    const row = aoa[i] || [];
    const label = normText(row[0]).replace(/:$/, "");
    if (headerIdx < 0 && META_LABELS[label]) {
      const val = cleanCell(row[1]);
      if (val && !meta[META_LABELS[label]]) meta[META_LABELS[label]] = val;
      continue;
    }
    const cells = row.map(normText);
    if (cells.includes("item no") || cells.includes("item no.") || (cells.includes("priority level") && cells.includes("soa"))) {
      headerIdx = i;
      const used = new Set();
      cells.forEach((c, ci) => {
        if (!c) return;
        let f = HEADER_MAP[c];
        if (!f) for (const k in HEADER_MAP) if (c.startsWith(k)) { f = HEADER_MAP[k]; break; }
        if (f && !used.has(f)) { colMap[ci] = f; used.add(f); }
      });
      break;
    }
  }
  if (headerIdx < 0) throw new Error("Could not find the header row. Expected a row with 'Item No.' and 'Priority Level' (the standard 'Slag List' template).");
  const rows = [];
  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const row = aoa[i] || [];
    const rec = {};
    for (const ci in colMap) rec[colMap[ci]] = cleanCell(row[ci]);
    if (!["soa", "room", "priority", "issue_type", "general_category", "description", "photo_ref", "expected_completion_date"].some(f => rec[f])) continue;
    rec.floor = meta.floor; rec.ward_unit = meta.ward_unit;
    rows.push(rec);
  }
  return { meta, rows };
}

function exportXlsx(rows) {
  const head = EXPORT_COLUMNS.map(c => c[0]);
  const aoa = [head, ...rows.map(r => EXPORT_COLUMNS.map(([, f]) => r[f] == null ? "" : r[f]))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [8, 22, 20, 10, 18, 24, 50, 20, 18, 16, 14, 14, 12, 14, 24].map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Rectification List");
  XLSX.writeFile(wb, `rectification_export_${todayStr()}.xlsx`);
}
function csvCell(v) { const s = v == null ? "" : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function exportCsv(rows) {
  const lines = [EXPORT_COLUMNS.map(c => csvCell(c[0])).join(",")];
  rows.forEach(r => lines.push(EXPORT_COLUMNS.map(([, f]) => csvCell(r[f])).join(",")));
  downloadBlob(new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }), `rectification_export_${todayStr()}.csv`);
}
function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

// =============================================================== backup ==
function blobToDataURL(blob) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); }); }
async function dataURLToBlob(u) { const r = await fetch(u); return await r.blob(); }

async function buildBackup() {
  const photos = [];
  for (const p of PHOTOS) {
    const b = await photoBlob(p.id);
    photos.push({ id: p.id, item_id: p.item_id, name: p.name, kind: p.kind, data: b ? await blobToDataURL(b) : null });
  }
  return { app: "rectrack", version: 1, exported_at: new Date().toISOString(), seq: SEQ, meta: META, items: ITEMS, photos };
}

async function restoreBackup(obj) {
  if (!obj || !Array.isArray(obj.items)) throw new Error("Not a valid backup file.");
  clearAll();
  if (obj.seq) { SEQ.items = obj.seq.items || 0; SEQ.photos = obj.seq.photos || 0; }
  (obj.items || []).forEach(it => { ITEMS.push(it); persistItem(it); });
  SEQ.items = Math.max(SEQ.items, ITEMS.reduce((m, i) => Math.max(m, i.id), 0));
  for (const p of (obj.photos || [])) {
    const meta = { id: p.id, item_id: p.item_id, name: p.name, kind: p.kind };
    PHOTOS.push(meta);
    if (p.data) { const blob = await dataURLToBlob(p.data); persistPhoto({ ...meta, blob }); }
    SEQ.photos = Math.max(SEQ.photos, p.id);
  }
  META = obj.meta || {};
  putMeta("seq_items", SEQ.items); putMeta("seq_photos", SEQ.photos);
}

// ================================================================== ui ==
const state = { filters: {}, sort: [], q: "", page: 0, pageSize: 100, objUrls: [] };

function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function toast(msg, ms = 2800) {
  const t = document.getElementById("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove("show"), ms);
}
function revokeUrls() { state.objUrls.forEach(u => URL.revokeObjectURL(u)); state.objUrls = []; }

function flatOptions(def) {
  if (def.fromRef) { const v = reference()[def.fromRef]; return Array.isArray(v) ? v.slice() : Object.values(v).flat(); }
  return [];
}
function facets() { const out = {}; FILTERABLE_COLUMNS.forEach(c => { out[c] = [...new Set(ITEMS.map(i => i[c]).filter(v => v !== undefined && v !== null && v !== ""))].sort(); }); return out; }
function filterOptions(def) {
  if (def.fromFacet) return facets()[def.col] || [];
  const base = flatOptions(def);
  const extra = (facets()[def.col] || []).filter(x => !base.includes(x));
  return base.concat(extra);
}

function buildFilterWidgets() {
  const host = document.getElementById("filterGroup");
  host.innerHTML = "";
  FILTER_DEFS.forEach(def => host.appendChild(makeMulti(def)));
}
function makeMulti(def) {
  const wrap = document.createElement("label"); wrap.className = "multi";
  const btn = document.createElement("button"); btn.type = "button"; btn.className = "multi-btn";
  const menu = document.createElement("div"); menu.className = "multi-menu"; menu.hidden = true;
  const render = () => { const sel = state.filters[def.col] || []; btn.textContent = def.label + (sel.length ? ": " + sel.join(", ") : ": Any"); btn.classList.toggle("active", sel.length > 0); };
  const opts = filterOptions(def);
  if (!opts.length) { const e = document.createElement("div"); e.className = "multi-empty"; e.textContent = "No values yet"; menu.appendChild(e); }
  opts.forEach(val => {
    const row = document.createElement("label"); row.className = "multi-item";
    const cb = document.createElement("input"); cb.type = "checkbox"; cb.value = val;
    cb.checked = (state.filters[def.col] || []).includes(val);
    cb.addEventListener("change", () => {
      const set = new Set(state.filters[def.col] || []);
      cb.checked ? set.add(val) : set.delete(val);
      state.filters[def.col] = [...set]; render(); state.page = 0; refresh();
    });
    row.appendChild(cb); row.appendChild(document.createTextNode(val));
    menu.appendChild(row);
  });
  btn.addEventListener("click", e => { e.stopPropagation(); const was = menu.hidden; document.querySelectorAll(".multi-menu").forEach(m => (m.hidden = true)); menu.hidden = !was; });
  wrap.appendChild(btn); wrap.appendChild(menu); render();
  return wrap;
}
function clearFilters() {
  state.filters = {}; state.q = ""; state.sort = []; state.page = 0;
  document.getElementById("search").value = "";
  renderHead(); buildFilterWidgets(); refresh();
}

function matches(it) {
  for (const [col, vals] of Object.entries(state.filters)) { if (vals && vals.length && !vals.includes(it[col] || "")) return false; }
  if (state.q) {
    const s = state.q.toLowerCase();
    const hay = [it.description, it.room, it.photo_ref, it.item_no, it.remarks].map(x => (x || "").toLowerCase()).join(" ");
    if (!hay.includes(s)) return false;
  }
  return true;
}
function cmp(a, b, col, dir) {
  let r;
  if (col === "priority") r = (parseInt(a.priority || "999", 10) || 999) - (parseInt(b.priority || "999", 10) || 999);
  else if (col === "id") r = a.id - b.id;
  else r = String(a[col] || "").localeCompare(String(b[col] || ""), undefined, { numeric: true, sensitivity: "base" });
  return dir === "desc" ? -r : r;
}
function queryItems() {
  let list = ITEMS.filter(matches);
  if (state.sort.length) list = list.slice().sort((a, b) => { for (const s of state.sort) { const r = cmp(a, b, s.col, s.dir); if (r) return r; } return 0; });
  return list;
}

function renderHead() {
  const row = document.getElementById("headRow"); row.innerHTML = "";
  COLS.forEach(col => {
    const th = document.createElement("th");
    if (col.w) th.style.width = col.w + "px";
    const idx = state.sort.findIndex(s => s.col === col.field);
    let arrow = "";
    if (idx >= 0) arrow = (state.sort[idx].dir === "asc" ? " \u2191" : " \u2193") + (state.sort.length > 1 ? `<span class="ord">${idx + 1}</span>` : "");
    th.innerHTML = esc(col.label) + (col.sortable ? `<span class="arrow">${arrow}</span>` : "");
    if (col.sortable) th.addEventListener("click", e => toggleSort(col.field, e.shiftKey));
    row.appendChild(th);
  });
}
function toggleSort(field, additive) {
  const idx = state.sort.findIndex(s => s.col === field);
  if (additive) { if (idx >= 0) state.sort[idx].dir = state.sort[idx].dir === "asc" ? "desc" : "asc"; else state.sort.push({ col: field, dir: "asc" }); }
  else { if (idx === 0 && state.sort.length === 1) state.sort[0].dir = state.sort[0].dir === "asc" ? "desc" : "asc"; else state.sort = [{ col: field, dir: "asc" }]; }
  state.page = 0; renderHead(); refresh();
}
function statusClass(s) { return "status-" + String(s || "").replace(/ /g, "."); }
function isOverdue(it) { return it.expected_completion_date && !["Completed", "Verified"].includes(it.status) && it.expected_completion_date < todayStr(); }

function facetsSig() { const f = facets(); return FILTERABLE_COLUMNS.map(c => (f[c] || []).join("\u0001")).join("\u0002"); }

function refresh() {
  revokeUrls();
  const all = queryItems();
  const total = all.length;
  const start = state.page * state.pageSize;
  const pageItems = all.slice(start, start + state.pageSize);
  if (start >= total && state.page > 0) { state.page = Math.max(0, Math.ceil(total / state.pageSize) - 1); return refresh(); }
  const counts = new Map(); PHOTOS.forEach(p => counts.set(p.item_id, (counts.get(p.item_id) || 0) + 1));
  renderRows(pageItems, counts);
  updateSortInfo();
  document.getElementById("pageInfo").textContent = `${total ? start + 1 : 0}\u2013${Math.min(total, start + state.pageSize)} of ${total}`;
  document.getElementById("btnPrev").disabled = state.page === 0;
  document.getElementById("btnNext").disabled = start + state.pageSize >= total;
  renderSummary();
  const sig = facetsSig();
  if (sig !== state._fsig) { state._fsig = sig; buildFilterWidgets(); }
  fillThumbs();
}
function renderRows(items, counts) {
  const body = document.getElementById("gridBody"); body.innerHTML = "";
  document.getElementById("emptyHint").hidden = items.length > 0;
  items.forEach(it => {
    const tr = document.createElement("tr");
    tr.addEventListener("click", () => openItem(it.id));
    const n = counts.get(it.id) || 0;
    const photoCell = n ? `<img class="thumb" data-photo="${firstPhotoId(it.id)}" alt=""> <span class="photocount">${n}</span>` : `<span class="photocount">none</span>`;
    const cells = [
      it.id, esc(it.item_no), esc(it.soa), esc(it.room),
      it.priority ? `<span class="prio prio-${esc(it.priority)}">${esc(it.priority)}</span>` : "",
      esc(it.issue_type), esc(it.general_category), `<div class="desc">${esc(it.description)}</div>`,
      esc(it.expected_completion_date) + (isOverdue(it) ? ` <span class="overdue-text">(overdue)</span>` : ""),
      `<span class="badge ${statusClass(it.status)}">${esc(it.status)}</span>`,
      photoCell, esc(it.source_file),
    ];
    cells.forEach(html => { const td = document.createElement("td"); td.innerHTML = html == null ? "" : html; if (html && String(html).indexOf('class="desc"') >= 0) td.className = "desc"; tr.appendChild(td); });
    body.appendChild(tr);
  });
}
function firstPhotoId(itemId) { const p = PHOTOS.find(x => x.item_id === itemId); return p ? p.id : ""; }
async function fillThumbs() {
  for (const img of document.querySelectorAll("img.thumb[data-photo]")) {
    const id = Number(img.dataset.photo); if (!id) continue;
    const b = await photoBlob(id);
    if (b) { const u = URL.createObjectURL(b); state.objUrls.push(u); img.src = u; }
  }
}
function updateSortInfo() { document.getElementById("sortInfo").textContent = state.sort.length ? "Sort: " + state.sort.map(s => `${s.col} ${s.dir}`).join("  \u2192  ") : ""; }
function renderSummary() {
  const byStatus = {}, byPriority = {}; let overdue = 0;
  ITEMS.forEach(i => { byStatus[i.status] = (byStatus[i.status] || 0) + 1; byPriority[i.priority || "(blank)"] = (byPriority[i.priority || "(blank)"] || 0) + 1; if (isOverdue(i)) overdue++; });
  const cards = [{ n: ITEMS.length, l: "Total items" }, { n: overdue, l: "Overdue", cls: "overdue" }];
  STATUSES.forEach(s => cards.push({ n: byStatus[s] || 0, l: s }));
  Object.keys(byStatus).filter(k => !STATUSES.includes(k)).forEach(k => cards.push({ n: byStatus[k], l: k || "(blank)" }));
  document.getElementById("cards").innerHTML = cards.map(c => `<div class="card ${c.cls || ""}"><div class="n">${c.n}</div><div class="l">${esc(c.l)}</div></div>`).join("");
}

// --------------------------------------------------------------- modal --
function showModal(title, builder) {
  document.getElementById("modalTitle").textContent = title;
  const body = document.getElementById("modalBody"); body.innerHTML = ""; builder(body);
  document.getElementById("modal").hidden = false;
}
function closeModal() { document.getElementById("modal").hidden = true; }
function selectOptions(selected, groups) {
  let html = `<option value="">-- select --</option>`;
  for (const [g, vals] of Object.entries(groups)) html += `<optgroup label="${esc(g)}">` + vals.map(v => `<option value="${esc(v)}" ${v === selected ? "selected" : ""}>${esc(v)}</option>`).join("") + "</optgroup>";
  return html;
}
function listOptions(list, selected) { return `<option value="">-- select --</option>` + list.map(v => `<option value="${esc(v)}" ${v === selected ? "selected" : ""}>${esc(v)}</option>`).join(""); }
function itemFormHtml(it) {
  it = it || {}; const r = reference();
  return `<div class="form-grid">
    <label>SoA / Area type <select id="fld_soa">${selectOptions(it.soa, r.soa_groups)}</select></label>
    <label>Room <input id="fld_room" value="${esc(it.room)}" placeholder="e.g. 6-Beds Cubicle"></label>
    <label>Priority Level <select id="fld_priority">${listOptions(r.priority_levels, it.priority)}</select></label>
    <label>Type of Issue <select id="fld_issue_type">${listOptions(r.issue_types, it.issue_type)}</select></label>
    <label>General Category <select id="fld_general_category">${selectOptions(it.general_category, r.general_category_groups)}</select></label>
    <label>Status <select id="fld_status">${listOptions(r.statuses, it.status || "Not started")}</select></label>
    <label>Expected Completion Date <input id="fld_expected_completion_date" type="date" value="${esc(it.expected_completion_date)}"></label>
    <label>Floor <input id="fld_floor" value="${esc(it.floor)}"></label>
    <label>Ward / Unit <input id="fld_ward_unit" value="${esc(it.ward_unit)}"></label>
    <label>Photo Reference Number <input id="fld_photo_ref" value="${esc(it.photo_ref)}"></label>
    <label class="full">Details Description <textarea id="fld_description">${esc(it.description)}</textarea></label>
    <label class="full">Remarks <textarea id="fld_remarks">${esc(it.remarks)}</textarea></label>
  </div>`;
}
function collectForm() { const v = id => { const el = document.getElementById(id); return el ? el.value : ""; }; return { soa: v("fld_soa"), room: v("fld_room"), priority: v("fld_priority"), issue_type: v("fld_issue_type"), general_category: v("fld_general_category"), status: v("fld_status"), expected_completion_date: v("fld_expected_completion_date"), floor: v("fld_floor"), ward_unit: v("fld_ward_unit"), photo_ref: v("fld_photo_ref"), description: v("fld_description"), remarks: v("fld_remarks") }; }

function openItem(id) {
  const it = ITEMS.find(x => x.id === id); if (!it) return;
  showModal("Item #" + it.id, body => {
    body.innerHTML = itemFormHtml(it) +
      `<h4 style="margin:18px 0 4px">Photos</h4>
       <div class="meta-note">At least two photos recommended: one overview, one close-up.</div>
       <div class="photo-row" id="photoRow"></div>
       <div style="margin-top:10px"><input type="file" id="photoInput" accept="image/*" multiple> <button class="btn small" id="btnUpload">Upload photo(s)</button></div>
       <div class="modal-foot"><button class="btn danger" id="btnDelete">Delete item</button><button class="btn" id="btnCancel">Cancel</button><button class="btn primary" id="btnSave">Save changes</button></div>`;
    renderPhotos(it.id);
    document.getElementById("btnUpload").addEventListener("click", () => uploadPhotos(it.id));
    document.getElementById("btnSave").addEventListener("click", () => { updateItem(it.id, collectForm()); toast("Item saved"); closeModal(); refresh(); });
    document.getElementById("btnDelete").addEventListener("click", () => { if (confirm("Delete item #" + it.id + "?")) { deleteItem(it.id); toast("Item deleted"); closeModal(); refresh(); } });
    document.getElementById("btnCancel").addEventListener("click", closeModal);
  });
}
async function renderPhotos(itemId) {
  const row = document.getElementById("photoRow"); if (!row) return;
  const list = photosFor(itemId);
  if (!list.length) { row.innerHTML = '<span class="photocount">No photos attached.</span>'; return; }
  row.innerHTML = "";
  for (const p of list) {
    const b = await photoBlob(p.id);
    const cell = document.createElement("div"); cell.className = "photo-cell";
    const img = document.createElement("img"); img.className = "photo-thumb";
    if (b) { const u = URL.createObjectURL(b); state.objUrls.push(u); img.src = u; }
    const del = document.createElement("button"); del.textContent = "\u00d7"; del.title = "Remove";
    del.addEventListener("click", () => { deletePhoto(p.id); renderPhotos(itemId); refresh(); });
    img.addEventListener("click", () => { if (img.src) showModal("Photo", bb => { bb.innerHTML = `<img class="gallery-img" src="${img.src}">`; }); });
    cell.appendChild(img); cell.appendChild(del); row.appendChild(cell);
  }
}
async function uploadPhotos(itemId) {
  const input = document.getElementById("photoInput");
  if (!input.files.length) { toast("Choose one or more image files first"); return; }
  for (const f of input.files) addPhotoBlob(itemId, f.name, "upload", f);
  input.value = ""; toast("Photo(s) uploaded"); await renderPhotos(itemId); refresh();
}
function openAdd() {
  showModal("Add item", body => {
    body.innerHTML = itemFormHtml({ status: "Not started" }) + `<div class="modal-foot"><button class="btn" id="btnCancel">Cancel</button><button class="btn primary" id="btnSave">Create item</button></div>`;
    document.getElementById("btnCancel").addEventListener("click", closeModal);
    document.getElementById("btnSave").addEventListener("click", () => { const it = addItem(collectForm()); toast("Item #" + it.id + " created \u2014 add photos next"); closeModal(); refresh(); openItem(it.id); });
  });
}

// -------------------------------------------------------------- import --
function openImport() {
  showModal("Import handover inspection Excel", body => {
    body.innerHTML = `<div class="meta-note">Select one or more standard template files (same columns as the "Slag List" sheet). Every data row is added as a new item; blank template rows are ignored.</div>
      <label style="display:block;margin-bottom:10px">Excel file(s)<br><input type="file" id="impFiles" accept=".xlsx,.xlsm" multiple></label>
      <label style="display:block;margin-bottom:10px">Photos folder (optional)<br><input type="file" id="impFolder" webkitdirectory directory multiple><div class="meta-note">Images named with the item's Photo Reference Number (e.g. P6A-003_overview.jpg) are auto-attached.</div></label>
      <div class="modal-foot"><button class="btn" id="btnCancel">Cancel</button><button class="btn primary" id="btnDoImport">Import</button></div>`;
    document.getElementById("btnCancel").addEventListener("click", closeModal);
    document.getElementById("btnDoImport").addEventListener("click", doImport);
  });
}
async function doImport() {
  const files = document.getElementById("impFiles").files;
  if (!files.length) { toast("Choose an Excel file"); return; }
  let totalRows = 0;
  try {
    for (const file of files) {
      const buf = await file.arrayBuffer();
      const { meta, rows } = parseWorkbook(buf, file.name);
      rows.forEach(r => addItem({ ...r, source_file: file.name }));
      const imports = META.imports || [];
      imports.push({ filename: file.name, ...meta, row_count: rows.length, imported_at: nowStamp() });
      putMeta("imports", imports);
      totalRows += rows.length;
    }
  } catch (e) { toast("Import error: " + e.message, 5000); return; }

  const folder = document.getElementById("impFolder");
  let matched = 0;
  if (folder && folder.files.length) matched = await matchFolderPhotos(folder.files);
  toast(`Imported ${totalRows} item(s)` + (matched ? `, matched ${matched} photo(s)` : ""));
  closeModal(); state.page = 0; refresh();
}
async function matchFolderPhotos(files) {
  let matched = 0;
  const compact = s => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const f of files) {
    if (!/^image\//.test(f.type) && !/\.(jpe?g|png|gif|bmp|webp|tif?f)$/i.test(f.name)) continue;
    const stem = compact(f.name.replace(/\.[^.]+$/, ""));
    for (const it of ITEMS) {
      const ref = (it.photo_ref || "").trim(); if (!ref) continue;
      if (compact(ref) && stem.includes(compact(ref))) { addPhotoBlob(it.id, f.name, "auto", f); matched++; }
    }
  }
  return matched;
}

// -------------------------------------------------------------- backup --
function openBackup() {
  showModal("Backup & restore", body => {
    body.innerHTML = `<div class="meta-note">A backup contains every item and every photo. Use it to move the tracker to another PC or to keep a safe copy during the 4-month project.</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin:10px 0">
        <button class="btn primary" id="btnSaveBackup">Save backup (.json)</button>
        <button class="btn" id="btnLoadBackup">Restore from backup</button>
        <button class="btn danger" id="btnWipe">Delete all data</button>
      </div>
      <input type="file" id="restoreFile" accept=".json" hidden>
      <div class="meta-note" id="backupInfo"></div>`;
    document.getElementById("btnSaveBackup").addEventListener("click", async () => {
      const data = await buildBackup();
      downloadBlob(new Blob([JSON.stringify(data)], { type: "application/json" }), `rectrack_backup_${todayStr()}.json`);
      toast("Backup saved (" + data.items.length + " items, " + data.photos.length + " photos)");
    });
    document.getElementById("btnLoadBackup").addEventListener("click", () => document.getElementById("restoreFile").click());
    document.getElementById("restoreFile").addEventListener("change", async e => {
      const f = e.target.files[0]; if (!f) return;
      if (!confirm("Restore will REPLACE all current data. Continue?")) return;
      try { await restoreBackup(JSON.parse(await f.text())); toast("Backup restored"); closeModal(); state.page = 0; refresh(); }
      catch (err) { toast("Restore failed: " + err.message, 5000); }
    });
    document.getElementById("btnWipe").addEventListener("click", () => { if (confirm("Delete ALL items and photos? This cannot be undone.")) { clearAll(); toast("All data deleted"); closeModal(); refresh(); } });
  });
}
function openHelp() {
  showModal("How to use", body => {
    body.innerHTML = `<div class="help-list">
      <p><b>Import:</b> click <b>Import Excel</b>, choose your handover inspection file(s) (same template as the "Slag List" sheet). Optionally choose a photos folder to auto-attach images by Photo Reference Number.</p>
      <p><b>Sort:</b> click a column header. Hold <b>Shift</b> and click another header to add a secondary sort (e.g. Type of Issue + Priority).</p>
      <p><b>Filter:</b> use the dropdown buttons; tick several values to combine conditions.</p>
      <p><b>Update progress:</b> click a row to change Status and Expected Completion Date, and to add photos. Completed/Verified dates are stamped automatically.</p>
      <p><b>Export:</b> <b>Export .xlsx</b> / <b>.csv</b> exports exactly the current sorted &amp; filtered view.</p>
      <p><b>Backup:</b> use <b>Backup</b> regularly \u2014 it saves everything (items + photos) to one file you can keep in your GitHub repo or OneDrive.</p>
      <p><b>Where is my data?</b> ${storageOK ? "Saved automatically in this browser on this PC." : "<span style='color:#b91c1c'>Automatic saving is NOT available in this browser/mode \u2014 use Backup before closing, and Restore to load it next time. For autosave, open this file in Google Chrome or Microsoft Edge.</span>"}</p>
    </div>`;
  });
}

// ================================================================ boot ==
async function boot() {
  await dbInit();
  if (!storageOK) {
    const b = document.getElementById("storageBanner");
    b.classList.add("show");
    b.innerHTML = lsOK
      ? "Note: this browser cannot store photos, so photos are kept only until you close this tab. Items, status and dates ARE saved automatically. For full saving including photos, open this file in <b>Google Chrome</b> or <b>Microsoft Edge</b> \u2014 and keep a <b>Backup</b> file for safety."
      : "Automatic saving is not available here. Use <b>Backup</b> before closing and <b>Restore</b> next time. For automatic saving, open this file in <b>Google Chrome</b> or <b>Microsoft Edge</b>.";
  }

  renderHead();
  document.addEventListener("click", () => document.querySelectorAll(".multi-menu").forEach(m => (m.hidden = true)));
  refresh();

  document.getElementById("search").addEventListener("input", e => { state.q = e.target.value.trim(); state.page = 0; clearTimeout(window._st); window._st = setTimeout(refresh, 250); });
  document.getElementById("btnClear").addEventListener("click", clearFilters);
  document.getElementById("btnPrev").addEventListener("click", () => { if (state.page > 0) { state.page--; refresh(); } });
  document.getElementById("btnNext").addEventListener("click", () => { state.page++; refresh(); });
  document.getElementById("btnAdd").addEventListener("click", openAdd);
  document.getElementById("btnImport").addEventListener("click", openImport);
  document.getElementById("btnExportXlsx").addEventListener("click", () => exportXlsx(queryItems()));
  document.getElementById("btnExportCsv").addEventListener("click", () => exportCsv(queryItems()));
  document.getElementById("btnBackup").addEventListener("click", openBackup);
  document.getElementById("btnHelp").addEventListener("click", openHelp);
  document.getElementById("modalClose").addEventListener("click", closeModal);
  document.getElementById("modal").addEventListener("click", e => { if (e.target.id === "modal") closeModal(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });
}
boot().catch(e => { console.error(e); alert("Startup error: " + e.message); });
