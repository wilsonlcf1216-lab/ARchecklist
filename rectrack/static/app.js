"use strict";

const state = {
  ref: null,
  facets: {},
  filters: {},          // {col: [values]}
  sort: [],             // [{col, dir}]
  q: "",
  page: 0,
  pageSize: 100,
  total: 0,
};

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

// ------------------------------------------------------------------ api --
async function api(path, opts) {
  const res = await fetch(path, opts);
  const ct = res.headers.get("Content-Type") || "";
  if (!ct.includes("application/json")) {
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res;
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
  return data;
}

function toast(msg, ms = 2600) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._t);
  t._t = setTimeout(() => (t.hidden = true), ms);
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// -------------------------------------------------------------- helpers --
function flatOptions(def) {
  if (def.fromRef) {
    const v = state.ref[def.fromRef];
    if (Array.isArray(v)) return v.slice();
    return Object.values(v).flat();
  }
  return [];
}

function filterOptions(def) {
  const base = flatOptions(def);
  const facet = (state.facets[def.col] || []).filter(x => !base.includes(x));
  if (def.fromFacet) return (state.facets[def.col] || []).slice();
  return base.concat(facet);
}

// ---------------------------------------------------- filter widgets ----
function buildFilterWidgets() {
  document.querySelectorAll("select[data-filter]").forEach(sel => sel.remove());
  document.querySelectorAll(".multi").forEach(el => el.remove());
  const host = document.querySelector(".tool-group");
  FILTER_DEFS.forEach(def => host.appendChild(makeMulti(def)));
}

function makeMulti(def) {
  const wrap = document.createElement("label");
  wrap.className = "multi";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "multi-btn";
  const menu = document.createElement("div");
  menu.className = "multi-menu";
  menu.hidden = true;

  const render = () => {
    const sel = state.filters[def.col] || [];
    btn.textContent = def.label + (sel.length ? ": " + sel.join(", ") : ": Any");
    btn.classList.toggle("active", sel.length > 0);
  };

  const opts = filterOptions(def);
  if (!opts.length) {
    const none = document.createElement("div");
    none.className = "multi-empty";
    none.textContent = "No values yet";
    menu.appendChild(none);
  }
  opts.forEach(val => {
    const row = document.createElement("label");
    row.className = "multi-item";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = val;
    cb.checked = (state.filters[def.col] || []).includes(val);
    cb.addEventListener("change", () => {
      const set = new Set(state.filters[def.col] || []);
      cb.checked ? set.add(val) : set.delete(val);
      state.filters[def.col] = [...set];
      render();
      state.page = 0;
      refresh();
    });
    row.appendChild(cb);
    row.appendChild(document.createTextNode(val || "(blank)"));
    menu.appendChild(row);
  });

  btn.addEventListener("click", e => {
    e.stopPropagation();
    const wasHidden = menu.hidden;
    document.querySelectorAll(".multi-menu").forEach(m => (m.hidden = true));
    menu.hidden = !wasHidden;
  });
  document.addEventListener("click", () => (menu.hidden = true));

  wrap.appendChild(btn);
  wrap.appendChild(menu);
  render();
  return wrap;
}

function clearFilters() {
  state.filters = {};
  state.q = "";
  state.sort = [];
  state.page = 0;
  document.getElementById("search").value = "";
  renderHead();
  buildFilterWidgets();
  refresh();
}

// ------------------------------------------------------------ queries ----
function buildQuery() {
  const p = new URLSearchParams();
  if (state.q) p.set("q", state.q);
  for (const [col, vals] of Object.entries(state.filters)) {
    (vals || []).forEach(v => p.append("f_" + col, v));
  }
  if (state.sort.length) {
    p.set("sort", state.sort.map(s => s.col).join(","));
    p.set("dir", state.sort.map(s => s.dir).join(","));
  }
  p.set("limit", state.pageSize);
  p.set("offset", state.page * state.pageSize);
  return p;
}

function updateSortInfo() {
  const el = document.getElementById("sortInfo");
  if (!state.sort.length) { el.textContent = ""; return; }
  el.textContent = "Sort: " + state.sort.map(s => `${s.col} ${s.dir}`).join("  \u2192  ");
}

// ------------------------------------------------------------- render ----
async function refresh() {
  const data = await api("/api/items?" + buildQuery().toString() + "&with_photos=1");
  state.total = data.total;
  renderRows(data.items);
  updateSortInfo();
  renderPager();
  loadSummary();
  loadFacets(true);
}

function renderHead() {
  const row = document.getElementById("headRow");
  row.innerHTML = "";
  COLS.forEach(col => {
    const th = document.createElement("th");
    if (col.w) th.style.width = col.w + "px";
    const idx = state.sort.findIndex(s => s.col === col.field);
    let arrow = "";
    if (idx >= 0) {
      arrow = (state.sort[idx].dir === "asc" ? " \u2191" : " \u2193") +
        (state.sort.length > 1 ? `<span class="ord">${idx + 1}</span>` : "");
    }
    th.innerHTML = esc(col.label) + (col.sortable ? `<span class="arrow">${arrow}</span>` : "");
    if (col.sortable) {
      th.addEventListener("click", e => toggleSort(col.field, e.shiftKey));
    }
    row.appendChild(th);
  });
}

function toggleSort(field, additive) {
  const idx = state.sort.findIndex(s => s.col === field);
  if (additive) {
    if (idx >= 0) state.sort[idx].dir = state.sort[idx].dir === "asc" ? "desc" : "asc";
    else state.sort.push({ col: field, dir: "asc" });
  } else {
    if (idx === 0 && state.sort.length === 1) {
      state.sort[0].dir = state.sort[0].dir === "asc" ? "desc" : "asc";
    } else {
      state.sort = [{ col: field, dir: "asc" }];
    }
  }
  state.page = 0;
  renderHead();
  refresh();
}

function statusClass(status) {
  return "status-" + String(status || "").replace(/ /g, ".");
}

function isOverdue(item) {
  if (!item.expected_completion_date) return false;
  if (["Completed", "Verified"].includes(item.status)) return false;
  return item.expected_completion_date < new Date().toISOString().slice(0, 10);
}

function renderRows(items) {
  const body = document.getElementById("gridBody");
  body.innerHTML = "";
  document.getElementById("emptyHint").hidden = items.length > 0;
  items.forEach(it => {
    const tr = document.createElement("tr");
    tr.addEventListener("click", () => openItem(it.id));

    const cells = [
      it.id,
      esc(it.item_no),
      esc(it.soa),
      esc(it.room),
      it.priority ? `<span class="prio prio-${esc(it.priority)}">${esc(it.priority)}</span>` : "",
      esc(it.issue_type),
      esc(it.general_category),
      `<div class="desc">${esc(it.description)}</div>`,
      esc(it.expected_completion_date) +
        (isOverdue(it) ? ` <span class="overdue-text">(overdue)</span>` : ""),
      `<span class="badge ${statusClass(it.status)}">${esc(it.status)}</span>`,
      photosCell(it),
      esc(it.source_file),
    ];
    cells.forEach(html => {
      const td = document.createElement("td");
      td.innerHTML = html == null ? "" : html;
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });
}

function photosCell(it) {
  const photos = it.photos || [];
  if (!photos.length) return '<span style="color:#9aa3ad">none</span>';
  const first = photos[0];
  return `<img class="thumb" src="/photos/${encodeURIComponent(first.filename)}" alt="">` +
    (photos.length > 1 ? ` <small>+${photos.length - 1}</small>` : "");
}

function renderPager() {
  const from = state.total ? state.page * state.pageSize + 1 : 0;
  const to = Math.min(state.total, (state.page + 1) * state.pageSize);
  document.getElementById("pageInfo").textContent = `${from}\u2013${to} of ${state.total}`;
  document.getElementById("btnPrev").disabled = state.page === 0;
  document.getElementById("btnNext").disabled = to >= state.total;
}

// ------------------------------------------------------------ summary ----
async function loadSummary() {
  const s = await api("/api/summary");
  const statusOrder = state.ref ? state.ref.statuses : [];
  const cards = [
    { n: s.total, l: "Total items" },
    { n: s.overdue, l: "Overdue", cls: "overdue" },
  ];
  statusOrder.forEach(st => cards.push({ n: s.by_status[st] || 0, l: st }));
  const extra = Object.keys(s.by_status).filter(k => !statusOrder.includes(k));
  extra.forEach(k => cards.push({ n: s.by_status[k], l: k || "(blank)" }));

  document.getElementById("cards").innerHTML = cards.map(c =>
    `<div class="card ${c.cls || ""}"><div class="n">${c.n}</div><div class="l">${esc(c.l)}</div></div>`
  ).join("");
}

async function loadFacets(rebuild) {
  const f = await api("/api/facets");
  const changed = JSON.stringify(f) !== JSON.stringify(state.facets);
  state.facets = f;
  if (rebuild && changed) buildFilterWidgets();
}

// ------------------------------------------------------------- modals ----
function showModal(title, bodyBuilder) {
  const modal = document.getElementById("modal");
  document.getElementById("modalTitle").textContent = title;
  const body = document.getElementById("modalBody");
  body.innerHTML = "";
  bodyBuilder(body);
  modal.hidden = false;
}
function closeModal() { document.getElementById("modal").hidden = true; }

function selectOptions(options, selected, groups) {
  let html = "";
  if (groups) {
    for (const [g, vals] of Object.entries(groups)) {
      html += `<optgroup label="${esc(g)}">` + vals.map(v =>
        `<option value="${esc(v)}" ${v === selected ? "selected" : ""}>${esc(v)}</option>`).join("") + "</optgroup>";
    }
  } else {
    html = options.map(v =>
      `<option value="${esc(v)}" ${v === selected ? "selected" : ""}>${esc(v)}</option>`).join("");
  }
  return `<option value="">-- select --</option>` + html;
}

function itemFormHtml(it) {
  it = it || {};
  const r = state.ref;
  return `
  <div class="form-grid">
    <label>SoA / Area type <select id="fld_soa">${selectOptions(null, it.soa, r.soa_groups)}</select></label>
    <label>Room <input id="fld_room" value="${esc(it.room)}" placeholder="e.g. 6-Beds Cubicle"></label>
    <label>Priority Level <select id="fld_priority">${selectOptions(r.priority_levels, it.priority)}</select></label>
    <label>Type of Issue <select id="fld_issue_type">${selectOptions(r.issue_types, it.issue_type)}</select></label>
    <label>General Category <select id="fld_general_category">${selectOptions(null, it.general_category, r.general_category_groups)}</select></label>
    <label>Status <select id="fld_status">${selectOptions(r.statuses, it.status || "Not started")}</select></label>
    <label>Expected Completion Date <input id="fld_expected_completion_date" type="date" value="${esc(it.expected_completion_date)}"></label>
    <label>Floor <input id="fld_floor" value="${esc(it.floor)}"></label>
    <label>Ward / Unit <input id="fld_ward_unit" value="${esc(it.ward_unit)}"></label>
    <label>Photo Reference Number <input id="fld_photo_ref" value="${esc(it.photo_ref)}"></label>
    <label class="full">Details Description <textarea id="fld_description">${esc(it.description)}</textarea></label>
    <label class="full">Remarks <textarea id="fld_remarks">${esc(it.remarks)}</textarea></label>
  </div>`;
}

function collectForm() {
  const val = id => {
    const el = document.getElementById(id);
    return el ? el.value : "";
  };
  return {
    soa: val("fld_soa"), room: val("fld_room"), priority: val("fld_priority"),
    issue_type: val("fld_issue_type"), general_category: val("fld_general_category"),
    status: val("fld_status"), expected_completion_date: val("fld_expected_completion_date"),
    floor: val("fld_floor"), ward_unit: val("fld_ward_unit"),
    photo_ref: val("fld_photo_ref"), description: val("fld_description"),
    remarks: val("fld_remarks"),
  };
}

async function openItem(id) {
  const it = await api("/api/items/" + id);
  showModal("Item #" + it.id, body => {
    body.innerHTML = itemFormHtml(it) +
      `<h4 style="margin:18px 0 4px">Photos</h4>
       <div class="meta-note">At least two photos recommended: one overview, one close-up.</div>
       <div class="photo-row" id="photoRow"></div>
       <div style="margin-top:10px">
         <input type="file" id="photoInput" accept="image/*" multiple>
         <button class="btn small" id="btnUpload">Upload photo(s)</button>
       </div>
       <div class="modal-foot">
         <button class="btn danger" id="btnDelete">Delete item</button>
         <button class="btn" id="btnCancel">Cancel</button>
         <button class="btn primary" id="btnSave">Save changes</button>
       </div>`;
    renderPhotos(it.photos || []);
    document.getElementById("btnUpload").addEventListener("click", () => uploadPhotos(it.id));
    document.getElementById("btnSave").addEventListener("click", async () => {
      await api("/api/items/" + it.id, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(collectForm()),
      });
      toast("Item saved");
      closeModal();
      refresh();
    });
    document.getElementById("btnDelete").addEventListener("click", async () => {
      if (!confirm("Delete item #" + it.id + "?")) return;
      await api("/api/items/" + it.id, { method: "DELETE" });
      toast("Item deleted");
      closeModal();
      refresh();
    });
    document.getElementById("btnCancel").addEventListener("click", closeModal);
  });
}

function renderPhotos(photos) {
  const row = document.getElementById("photoRow");
  if (!row) return;
  if (!photos.length) { row.innerHTML = '<span style="color:#9aa3ad">No photos attached.</span>'; return; }
  row.innerHTML = photos.map(p =>
    `<div class="photo-cell">
       <img class="photo-thumb" data-photo="${p.id}" src="/photos/${encodeURIComponent(p.filename)}" alt="">
       <button data-del="${p.id}" title="Remove">&times;</button>
     </div>`).join("");
  row.querySelectorAll("img").forEach(img => img.addEventListener("click", () => {
    showModal("Photo", b => { b.innerHTML = `<img class="gallery-img" src="${img.src}">`; });
  }));
  row.querySelectorAll("button[data-del]").forEach(btn => btn.addEventListener("click", async () => {
    await api("/api/photos/" + btn.dataset.del, { method: "DELETE" });
    const item = await api("/api/items/" + currentItemId());
    renderPhotos(item.photos || []);
    refresh();
  }));
}

function currentItemId() {
  const m = document.getElementById("modalTitle").textContent.match(/#(\d+)/);
  return m ? m[1] : null;
}

async function uploadPhotos(itemId) {
  const input = document.getElementById("photoInput");
  if (!input.files.length) { toast("Choose one or more image files first"); return; }
  let n = 0;
  for (const file of input.files) {
    const b64 = await fileToBase64(file);
    await api(`/api/items/${itemId}/photos`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: file.name, content_base64: b64 }),
    });
    n++;
  }
  input.value = "";
  const item = await api("/api/items/" + itemId);
  renderPhotos(item.photos || []);
  toast(n + " photo(s) uploaded");
  refresh();
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function openAdd() {
  showModal("Add item", body => {
    body.innerHTML = itemFormHtml({ status: "Not started", floor: "", ward_unit: "" }) +
      `<div class="modal-foot">
         <button class="btn" id="btnCancel">Cancel</button>
         <button class="btn primary" id="btnSave">Create item</button>
       </div>`;
    document.getElementById("btnCancel").addEventListener("click", closeModal);
    document.getElementById("btnSave").addEventListener("click", async () => {
      const res = await api("/api/items", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(collectForm()),
      });
      toast("Item #" + res.id + " created \u2014 add photos next");
      closeModal();
      refresh();
      openItem(res.id);
    });
  });
}

// ------------------------------------------------------------- import ----
function openImport() {
  showModal("Import handover inspection Excel", body => {
    body.innerHTML = `
      <div class="meta-note">
        Select one or more standard template files (same columns as the "Slag List" sheet).
        Every row with data is added as a new item; the 624 blank template rows are ignored.
      </div>
      <label style="display:block;margin-bottom:10px">Excel file(s)
        <input type="file" id="impFiles" accept=".xlsx,.xlsm" multiple>
      </label>
      <label style="display:block;margin-bottom:10px">Photos folder (optional)
        <input id="impFolder" type="text" placeholder="e.g. D:\\\\Inspections\\\\photos  \u2014 images are matched by Photo Reference Number">
      </label>
      <div class="modal-foot">
        <button class="btn" id="btnCancel">Cancel</button>
        <button class="btn primary" id="btnDoImport">Import</button>
      </div>`;
    document.getElementById("btnCancel").addEventListener("click", closeModal);
    document.getElementById("btnDoImport").addEventListener("click", async () => {
      const files = document.getElementById("impFiles").files;
      if (!files.length) { toast("Choose an Excel file"); return; }
      const folder = document.getElementById("impFolder").value.trim();
      let rows = 0, photos = 0;
      for (const file of files) {
        const b64 = await fileToBase64(file);
        const res = await api("/api/import", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: file.name, content_base64: b64, library_folder: folder }),
        });
        rows += res.rows_imported; photos += res.photos_matched || 0;
      }
      toast(`Imported ${rows} item(s)` + (photos ? `, matched ${photos} photo(s)` : ""));
      closeModal();
      refresh();
    });
  });
}

// -------------------------------------------------------------- export ----
function exportUrl(kind) {
  return `/api/export.${kind}?` + buildQuery().toString();
}

// ---------------------------------------------------------------- boot ----
async function boot() {
  state.ref = await api("/api/reference");
  const qp = new URLSearchParams(location.search);
  if (qp.get("q")) { state.q = qp.get("q"); document.getElementById("search").value = state.q; }

  renderHead();
  buildFilterWidgets();
  await loadFacets(false);
  buildFilterWidgets();
  await loadSummary();
  await refresh();

  document.getElementById("search").addEventListener("input", e => {
    state.q = e.target.value.trim();
    state.page = 0;
    clearTimeout(window._st);
    window._st = setTimeout(refresh, 250);
  });
  document.getElementById("btnClear").addEventListener("click", clearFilters);
  document.getElementById("btnPrev").addEventListener("click", () => { if (state.page > 0) { state.page--; refresh(); } });
  document.getElementById("btnNext").addEventListener("click", () => { state.page++; refresh(); });
  document.getElementById("btnAdd").addEventListener("click", openAdd);
  document.getElementById("btnImport").addEventListener("click", openImport);
  document.getElementById("btnExportXlsx").addEventListener("click", () => { location.href = exportUrl("xlsx"); });
  document.getElementById("btnExportCsv").addEventListener("click", () => { location.href = exportUrl("csv"); });
  document.getElementById("modalClose").addEventListener("click", closeModal);
  document.getElementById("modal").addEventListener("click", e => { if (e.target.id === "modal") closeModal(); });
}

boot().catch(e => { console.error(e); toast("Error: " + e.message); });
