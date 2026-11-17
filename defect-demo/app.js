/* 醫院缺陷查驗 — 技術 Demo（AR.js Barcode 標記）
 * 模組：空間主檔 / AR 查驗 / 記錄與儀表板 / Excel 匯出
 * 注意：相機與 AR 需要 HTTPS 或 http://localhost（安全來源）。
 */
(function () {
  'use strict';

  // ---------- 常數 ----------
  var PRIO = {
    P1: { label: 'Critical', color: '#E8463A' },
    P2: { label: 'High', color: '#F0741F' },
    P3: { label: 'Medium', color: '#EFAA17' },
    P4: { label: 'Low', color: '#4B93E0' }
  };
  var PRIO_ORDER = ['P1', 'P2', 'P3', 'P4'];
  var CATEGORIES = ['天花', '牆身', '地板', '門窗', '機電', '消防', '潔具', '設備', '其他'];

  // 示範空間主檔（正式版由 CSV 匯入）
  var SAMPLE_SPACES = [
    { space_code: 'MAIN-3F-A-01', location_name: '主樓', floor: '3F', zone: 'A', room_no: '01', space_name: '內科病房', marker_value: 0 },
    { space_code: 'MAIN-3F-A-02', location_name: '主樓', floor: '3F', zone: 'A', room_no: '02', space_name: '內科病房', marker_value: 1 },
    { space_code: 'MAIN-3F-B-05', location_name: '主樓', floor: '3F', zone: 'B', room_no: '05', space_name: '治療室', marker_value: 2 },
    { space_code: 'MAIN-2F-A-03', location_name: '主樓', floor: '2F', zone: 'A', room_no: '03', space_name: '藥房', marker_value: 3 },
    { space_code: 'EAST-2F-N-07', location_name: '東翼', floor: '2F', zone: 'N', room_no: '07', space_name: '藥房', marker_value: 4 },
    { space_code: 'EAST-1F-S-02', location_name: '東翼', floor: '1F', zone: 'S', room_no: '02', space_name: '候診區', marker_value: 5 },
    { space_code: 'OPD-G-E-03', location_name: '門診', floor: 'G', zone: 'E', room_no: '03', space_name: '診室', marker_value: 6 },
    { space_code: 'OPD-G-E-04', location_name: '門診', floor: 'G', zone: 'E', room_no: '04', space_name: '診室', marker_value: 7 }
  ];

  // ---------- 狀態 ----------
  var spaces = SAMPLE_SPACES.slice();
  var defects = [];
  var currentSpace = null;      // 目前對準的空間
  var currentAnchor = null;     // 待儲存的位置 {x,y,z,marker_value}
  var pendingPhoto = null;      // 表單內的相片 dataURL
  var db = null;

  // ---------- IndexedDB ----------
  var DB_NAME = 'defect_demo', DB_VER = 1, STORE = 'defects';
  function openDB() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open(DB_NAME, DB_VER);
      r.onupgradeneeded = function (e) {
        var d = e.target.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'defect_id' });
      };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function dbPut(rec) {
    return new Promise(function (res, rej) {
      var t = db.transaction(STORE, 'readwrite');
      t.objectStore(STORE).put(rec);
      t.oncomplete = function () { res(); };
      t.onerror = function () { rej(t.error); };
    });
  }
  function dbGetAll() {
    return new Promise(function (res, rej) {
      var t = db.transaction(STORE, 'readonly');
      var r = t.objectStore(STORE).getAll();
      r.onsuccess = function () { res(r.result || []); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function dbDelete(id) {
    return new Promise(function (res, rej) {
      var t = db.transaction(STORE, 'readwrite');
      t.objectStore(STORE).delete(id);
      t.oncomplete = function () { res(); };
      t.onerror = function () { rej(t.error); };
    });
  }
  function dbClear() {
    return new Promise(function (res, rej) {
      var t = db.transaction(STORE, 'readwrite');
      t.objectStore(STORE).clear();
      t.oncomplete = function () { res(); };
      t.onerror = function () { rej(t.error); };
    });
  }

  // ---------- 小工具 ----------
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function nowISO() {
    var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function nextDefectId() {
    var max = 0;
    defects.forEach(function (d) {
      var m = /^D-(\d+)$/.exec(d.defect_id || '');
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return 'D-' + String(max + 1).padStart(4, '0');
  }
  function findSpace(code) { for (var i = 0; i < spaces.length; i++) if (spaces[i].space_code === code) return spaces[i]; return null; }
  function toast(msg) {
    var t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(t._timer); t._timer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  // ---------- 分頁切換 ----------
  function showView(name) {
    $$('.view').forEach(function (v) { v.classList.remove('active'); });
    var el = document.getElementById('view-' + name); if (el) el.classList.add('active');
    $$('.tab').forEach(function (b) { b.classList.toggle('active', b.dataset.view === name); });
    if (name === 'ar') { buildAR(); }
    else { teardownAR(); }
    if (name === 'list') renderList();
    if (name === 'home') renderSpaces();
  }

  // ---------- 空間主檔 ----------
  function renderSpaces() {
    var rows = spaces.map(function (s) {
      return '<tr><td class="mono">' + esc(s.space_code) + '</td><td>' + esc(s.location_name) + '</td><td>' +
        esc(s.floor) + '</td><td>' + esc(s.zone) + '</td><td>' + esc(s.room_no) + '</td><td>' +
        esc(s.space_name) + '</td><td class="mono">' + esc(s.marker_value) + '</td></tr>';
    }).join('');
    $('#spaceTable tbody').innerHTML = rows;
  }

  function importSpacesCSV(text) {
    var lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) { toast('CSV 內容不足'); return; }
    var head = lines[0].split(',').map(function (s) { return s.trim().toLowerCase(); });
    var idx = function (name) { return head.indexOf(name); };
    var out = [];
    for (var i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      var c = lines[i].split(',');
      out.push({
        space_code: (c[idx('space_code')] || '').trim(),
        location_name: (c[idx('location_name')] || '').trim(),
        floor: (c[idx('floor')] || '').trim(),
        zone: (c[idx('zone')] || '').trim(),
        room_no: (c[idx('room_no')] || '').trim(),
        space_name: (c[idx('space_name')] || '').trim(),
        marker_value: parseInt((c[idx('marker_value')] || '0').trim(), 10) || 0
      });
    }
    out = out.filter(function (s) { return s.space_code; });
    if (!out.length) { toast('找不到有效資料'); return; }
    spaces = out;
    renderSpaces();
    toast('已匯入 ' + out.length + ' 個空間');
  }

  // ---------- AR ----------
  var arMarkers = {};   // marker_value -> a-marker element

  function buildAR() {
    var wrap = $('#arSceneWrap');
    if (wrap.dataset.built === '1') return;      // 已建立
    var markersHtml = spaces.map(function (s) {
      return '<a-marker type="barcode" value="' + s.marker_value + '" id="mkr-' + s.marker_value + '" data-space="' + esc(s.space_code) + '">' +
        '<a-plane id="plane-' + s.marker_value + '" class="clickable" width="2" height="2" rotation="-90 0 0" material="color:#000000;opacity:0.001;transparent:true"></a-plane>' +
        '<a-entity id="pins-' + s.marker_value + '"></a-entity>' +
        '</a-marker>';
    }).join('');

    wrap.innerHTML =
      '<a-scene id="arscene" embedded renderer="antialias:true;alpha:true;preserveDrawingBuffer:true" ' +
      'arjs="sourceType: webcam; debugUIEnabled: false; detectionMode: mono_and_matrix; matrixCodeType: 3x3; maxDetectionRate: 30;" ' +
      'vr-mode-ui="enabled:false" loading-screen="enabled:false" device-orientation-permission-ui="enabled:false">' +
      markersHtml +
      '<a-entity id="arcam" camera cursor="rayOrigin: mouse; fuse: false" raycaster="far: 1000; objects: .clickable"></a-entity>' +
      '</a-scene>';
    wrap.dataset.built = '1';

    var scene = $('#arscene');
    scene.addEventListener('loaded', function () {
      $$('a-marker', scene).forEach(function (m) {
        arMarkers[m.getAttribute('value')] = m;
        m.addEventListener('markerFound', function () {
          currentSpace = findSpace(m.dataset.space);
          updateArStatus();
          renderPinsFor(m);
        });
        m.addEventListener('markerLost', function () {
          if (currentSpace && currentSpace.space_code === m.dataset.space) { currentSpace = null; updateArStatus(); }
        });
      });
      $$('a-plane', scene).forEach(function (p) {
        p.addEventListener('click', function (e) { onPlaneClick(p, e); });
      });
    });
    updateArStatus();
  }

  function teardownAR() {
    var wrap = $('#arSceneWrap');
    if (!wrap || wrap.dataset.built !== '1') { if (wrap) wrap.innerHTML = ''; return; }
    // 停用相機串流
    $$('video').forEach(function (v) {
      if (v.srcObject && v.srcObject.getTracks) v.srcObject.getTracks().forEach(function (t) { t.stop(); });
    });
    wrap.innerHTML = '';
    wrap.dataset.built = '0';
    arMarkers = {};
    currentSpace = null;
    updateArStatus();
  }

  function updateArStatus() {
    var el = $('#arStatus'); if (!el) return;
    if (currentSpace) {
      el.className = 'ar-status ok';
      el.innerHTML = '已對準：<b class="mono">' + esc(currentSpace.space_code) + '</b> · ' + esc(currentSpace.location_name) +
        ' ' + esc(currentSpace.floor) + ' / ' + esc(currentSpace.zone) + ' / ' + esc(currentSpace.room_no) + '（' + esc(currentSpace.space_name) + '）';
    } else {
      el.className = 'ar-status wait';
      el.textContent = '未對準標記 — 請將鏡頭對準該空間的 Barcode 標記（或用下方手動選擇空間）';
    }
    var sel = $('#arSpaceSelect');
    if (sel) sel.value = currentSpace ? currentSpace.space_code : '';
  }

  function onPlaneClick(plane, e) {
    if (!currentSpace) { toast('請先對準標記或選擇空間'); return; }
    var det = e.detail && e.detail.intersection;
    if (!det) return;
    var marker = plane.object3D.parent;                 // a-marker 的 object3D
    var local = marker.worldToLocal(det.point.clone());  // 轉為標記本地座標
    currentAnchor = { x: local.x, y: local.y, z: local.z, marker_value: parseInt(plane.id.replace('plane-', ''), 10) };
    addPinEntity(currentSpace, currentAnchor, 'P1', true);
    openForm(currentSpace, currentAnchor);
  }

  function addPinEntity(space, anchor, priority, temp) {
    var cont = document.getElementById('pins-' + anchor.marker_value); if (!cont) return null;
    var color = (PRIO[priority] || PRIO.P3).color;
    var ent = document.createElement('a-entity');
    ent.setAttribute('position', anchor.x + ' ' + anchor.y + ' ' + anchor.z);
    if (temp) ent.setAttribute('data-temp', '1');
    ent.innerHTML = '<a-sphere radius="0.02" color="' + color + '"></a-sphere>';
    cont.appendChild(ent);
    return ent;
  }

  function renderPinsFor(markerEl) {
    var value = parseInt(markerEl.getAttribute('value'), 10);
    var cont = document.getElementById('pins-' + value);
    if (!cont) return;
    cont.innerHTML = '';
    defects.filter(function (d) { return d.ar_anchor && d.ar_anchor.marker_value === value; }).forEach(function (d) {
      addPinEntity(findSpace(d.space_code), d.ar_anchor, d.priority, false);
    });
  }

  function clearTempPins() {
    $$('a-entity[data-temp="1"]').forEach(function (e) { e.parentNode.removeChild(e); });
  }

  // 拍照：優先抓 A-Frame 畫布（含 AR 疊加），否則退回相機 video 幀
  function capturePhoto() {
    var src = null, w = 0, h = 0;
    var scene = $('#arscene');
    try {
      var cv = scene && (scene.canvas || $('canvas', scene));
      if (cv && cv.width) { src = cv; w = cv.width; h = cv.height; }
    } catch (err) { /* 改用 video */ }
    if (!src) {
      var vids = $$('video');
      for (var i = 0; i < vids.length; i++) {
        if (vids[i].videoWidth) { src = vids[i]; w = vids[i].videoWidth; h = vids[i].videoHeight; break; }
      }
    }
    if (!src || !w || !h) return null;
    var max = 1000, s = Math.min(1, max / Math.max(w, h));
    var out = document.createElement('canvas');
    out.width = Math.round(w * s); out.height = Math.round(h * s);
    out.getContext('2d').drawImage(src, 0, 0, out.width, out.height);
    try { return out.toDataURL('image/jpeg', 0.8); } catch (err) { return null; }
  }

  // ---------- Comment 表單 ----------
  function openForm(space, anchor) {
    if (!space) { toast('請先對準標記或選擇空間'); return; }
    currentSpace = space;
    currentAnchor = anchor || null;
    pendingPhoto = null;
    $('#fSpace').textContent = space.space_code + ' · ' + space.location_name + ' ' + space.floor + '/' + space.zone + '/' + space.room_no;
    $('#fAnchor').textContent = anchor ? ('標記 ' + anchor.marker_value + ' @ (' + anchor.x.toFixed(2) + ', ' + anchor.y.toFixed(2) + ', ' + anchor.z.toFixed(2) + ')') : '（未定位，僅文字描述）';
    $('#fCategory').innerHTML = CATEGORIES.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
    $('#fReporter').value = $('#fReporter').value || '訪客';
    $('#fDesc').value = '';
    $('#fPhotoPreview').innerHTML = '<span class="muted">尚未拍照</span>';
    setPrio('P3');
    $('#formModal').classList.add('show');
  }
  function closeForm() { $('#formModal').classList.remove('show'); clearTempPins(); currentAnchor = null; }
  function setPrio(p) {
    $$('#prioGroup .prio-btn').forEach(function (b) { b.classList.toggle('active', b.dataset.prio === p); });
    $('#prioGroup').dataset.value = p;
  }

  async function saveForm() {
    var prio = $('#prioGroup').dataset.value || 'P3';
    var desc = $('#fDesc').value.trim();
    if (!desc) { toast('請填寫缺陷描述'); return; }
    var sp = currentSpace;
    var rec = {
      defect_id: nextDefectId(),
      guid: 'g-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      space_code: sp.space_code,
      location_name: sp.location_name,
      floor: sp.floor, zone: sp.zone, room_no: sp.room_no,
      space_name: sp.space_name,
      category: $('#fCategory').value,
      description: desc,
      priority: prio,
      priority_label: PRIO[prio].label,
      status: 'open',
      reporter: $('#fReporter').value.trim() || '訪客',
      reported_at: nowISO(),
      updated_at: nowISO(),
      ar_anchor: currentAnchor,
      photo: pendingPhoto
    };
    await dbPut(rec);
    defects.push(rec);
    toast('已儲存 ' + rec.defect_id);
    closeForm();
    if ($('#view-ar').classList.contains('active') && currentSpace) {
      var mk = arMarkers[String(currentSpace.marker_value)];
      if (mk) renderPinsFor(mk);
    }
  }

  // ---------- 記錄與儀表板 ----------
  function renderList() {
    // 篩選
    var pf = $('#filterPrio').value, lf = $('#filterLoc').value;
    var locs = {};
    defects.forEach(function (d) { locs[d.location_name] = 1; });
    var cur = $('#filterLoc').value;
    $('#filterLoc').innerHTML = '<option value="">全部地方</option>' +
      Object.keys(locs).map(function (l) { return '<option' + (l === cur ? ' selected' : '') + '>' + esc(l) + '</option>'; }).join('');

    var list = defects.filter(function (d) {
      return (!pf || d.priority === pf) && (!lf || d.location_name === lf);
    }).sort(function (a, b) {
      return PRIO_ORDER.indexOf(a.priority) - PRIO_ORDER.indexOf(b.priority);
    });

    $('#defectList').innerHTML = list.length ? list.map(function (d) {
      var p = PRIO[d.priority] || PRIO.P3;
      return '<div class="card">' +
        '<div class="card-head"><span class="badge" style="background:' + p.color + '">' + d.priority + ' ' + p.label + '</span>' +
        '<span class="mono space">' + esc(d.space_code) + '</span>' +
        '<span class="muted">' + esc(d.category) + '</span>' +
        '<button class="link danger" data-del="' + esc(d.defect_id) + '">刪除</button></div>' +
        '<div class="card-body">' + esc(d.description) + '</div>' +
        (d.photo ? '<img class="thumb" src="' + d.photo + '" alt="相片">' : '') +
        '<div class="muted small">' + esc(d.reporter) + ' · ' + esc(d.reported_at) + (d.ar_anchor ? ' · 標記 ' + d.ar_anchor.marker_value : '') + '</div>' +
        '</div>';
    }).join('') : '<div class="muted">暫無記錄</div>';

    renderDashboard();
  }

  function renderDashboard() {
    // 依空間
    var bySpace = {};
    defects.forEach(function (d) {
      var k = d.space_code;
      if (!bySpace[k]) bySpace[k] = { space: d, total: 0, P1: 0, P2: 0, P3: 0, P4: 0 };
      bySpace[k].total++; bySpace[k][d.priority]++;
    });
    var spaceArr = Object.keys(bySpace).map(function (k) { return bySpace[k]; })
      .sort(function (a, b) { return b.total - a.total; });
    var maxS = spaceArr.length ? spaceArr[0].total : 1;
    $('#dashSpace').innerHTML = spaceArr.length ? spaceArr.map(function (r) {
      return barRow(r.space.space_code, r.space.location_name + ' ' + r.space.floor + '/' + r.space.zone + '/' + r.space.room_no, r, maxS);
    }).join('') : '<div class="muted">暫無數據</div>';

    // 依地方
    var byLoc = {};
    defects.forEach(function (d) {
      var k = d.location_name;
      if (!byLoc[k]) byLoc[k] = { space: { space_code: k, location_name: k, floor: '', zone: '', room_no: '' }, total: 0, P1: 0, P2: 0, P3: 0, P4: 0 };
      byLoc[k].total++; byLoc[k][d.priority]++;
    });
    var locArr = Object.keys(byLoc).map(function (k) { return byLoc[k]; }).sort(function (a, b) { return b.total - a.total; });
    var maxL = locArr.length ? locArr[0].total : 1;
    $('#dashLoc').innerHTML = locArr.length ? locArr.map(function (r) {
      return barRow(r.space.location_name, '地方', r, maxL);
    }).join('') : '<div class="muted">暫無數據</div>';
  }

  function barRow(title, sub, r, max) {
    var w = Math.max(6, Math.round(r.total / max * 100));
    var segs = PRIO_ORDER.map(function (p) {
      if (!r[p]) return '';
      return '<i style="background:' + PRIO[p].color + ';width:' + (r[p] / r.total * 100) + '%"></i>';
    }).join('');
    return '<div class="bar-row"><div class="bar-label"><b class="mono">' + esc(title) + '</b><span class="muted small">' + esc(sub) + '</span></div>' +
      '<div class="bar-track" style="width:' + w + '%"><div class="bar-seg">' + segs + '</div></div>' +
      '<div class="bar-num">' + r.total + '</div></div>';
  }

  // ---------- Excel 匯出 ----------
  async function exportExcel() {
    if (!defects.length) { toast('沒有記錄可匯出'); return; }
    var wb = new ExcelJS.Workbook();
    wb.creator = 'Defect Demo'; wb.created = new Date();

    // 主表
    var ws = wb.addWorksheet('Defects', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: 'Defect ID', key: 'defect_id', width: 12 },
      { header: 'Space Code', key: 'space_code', width: 16 },
      { header: 'Location', key: 'location_name', width: 10 },
      { header: 'Floor', key: 'floor', width: 8 },
      { header: 'Zone', key: 'zone', width: 7 },
      { header: 'Room', key: 'room_no', width: 7 },
      { header: 'Space Name', key: 'space_name', width: 14 },
      { header: 'Category', key: 'category', width: 9 },
      { header: 'Description', key: 'description', width: 40 },
      { header: 'Priority', key: 'priority', width: 9 },
      { header: 'Priority Label', key: 'priority_label', width: 13 },
      { header: 'Status', key: 'status', width: 10 },
      { header: 'Reporter', key: 'reporter', width: 12 },
      { header: 'Reported Time', key: 'reported_at', width: 18 },
      { header: 'Photo', key: 'photo', width: 18 },
      { header: 'AR Marker', key: 'marker', width: 10 },
      { header: 'Remark', key: 'remark', width: 18 }
    ];
    ws.getRow(1).font = { bold: true, color: { argb: 'FF171717' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFF2' } };

    defects.forEach(function (d) {
      ws.addRow({
        defect_id: d.defect_id, space_code: d.space_code, location_name: d.location_name,
        floor: d.floor, zone: d.zone, room_no: d.room_no, space_name: d.space_name,
        category: d.category, description: d.description, priority: d.priority,
        priority_label: d.priority_label, status: d.status, reporter: d.reporter,
        reported_at: d.reported_at, photo: d.photo ? '見本列縮圖' : '', marker: d.ar_anchor ? d.ar_anchor.marker_value : '', remark: ''
      });
    });

    // 相片內嵌（Photo 欄 = 第 15 欄，index 14）
    defects.forEach(function (d, i) {
      if (!d.photo) return;
      try {
        var imgId = wb.addImage({ base64: d.photo, extension: 'jpeg' });
        ws.addImage(imgId, { tl: { col: 14.1, row: i + 1.05 }, ext: { width: 92, height: 69 } });
        ws.getRow(i + 2).height = 54;
      } catch (err) { /* 略過單張失敗 */ }
    });

    ws.autoFilter = { from: 'A1', to: 'Q1' };

    // 條件式格式：Priority 欄（J）上色
    var cf = function (val, bg, fg) {
      return { type: 'cellIs', operator: 'equal', formulae: ['"' + val + '"'], priority: 1,
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: bg } }, font: { color: { argb: fg }, bold: true } } };
    };
    ws.addConditionalFormatting({ ref: 'J2:J' + (defects.length + 1), rules: [
      cf('P1', 'FFF8C9C2', 'FF9C1F12'),
      cf('P2', 'FFFBE0C2', 'FF8A4B10'),
      cf('P3', 'FFFCF2C4', 'FF7A5B02'),
      cf('P4', 'FFCFE2F7', 'FF12456E')
    ] });

    // Summary by Space
    writeSummary(wb, 'Summary_by_Space', spaceSummary(), 'Space Code');
    // Summary by Location
    writeSummary(wb, 'Summary_by_Location', locSummary(), 'Location');
    // ReadMe
    writeReadMe(wb);

    var buf = await wb.xlsx.writeBuffer();
    downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'Defect-Report.xlsx');
    toast('已匯出 Defect-Report.xlsx');
  }

  function spaceSummary() {
    var m = {};
    defects.forEach(function (d) {
      var k = d.space_code;
      if (!m[k]) m[k] = { key: k, loc: d.location_name, floor: d.floor, zone: d.zone, room: d.room_no, name: d.space_name, total: 0, P1: 0, P2: 0, P3: 0, P4: 0 };
      m[k].total++; m[k][d.priority]++;
    });
    return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return b.total - a.total; });
  }
  function locSummary() {
    var m = {};
    defects.forEach(function (d) {
      var k = d.location_name;
      if (!m[k]) m[k] = { key: k, total: 0, P1: 0, P2: 0, P3: 0, P4: 0 };
      m[k].total++; m[k][d.priority]++;
    });
    return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return b.total - a.total; });
  }
  function writeSummary(wb, name, rows, keyHeader) {
    var ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    var isSpace = name === 'Summary_by_Space';
    ws.columns = isSpace
      ? [{ header: 'Space Code', width: 16 }, { header: 'Location', width: 10 }, { header: 'Floor', width: 8 }, { header: 'Zone', width: 7 }, { header: 'Room', width: 7 }, { header: 'Space Name', width: 14 }, { header: 'Total', width: 8 }, { header: 'P1', width: 6 }, { header: 'P2', width: 6 }, { header: 'P3', width: 6 }, { header: 'P4', width: 6 }]
      : [{ header: 'Location', width: 14 }, { header: 'Total', width: 8 }, { header: 'P1', width: 6 }, { header: 'P2', width: 6 }, { header: 'P3', width: 6 }, { header: 'P4', width: 6 }];
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFF2' } };
    rows.forEach(function (r) {
      if (isSpace) ws.addRow([r.key, r.loc, r.floor, r.zone, r.room, r.name, r.total, r.P1, r.P2, r.P3, r.P4]);
      else ws.addRow([r.key, r.total, r.P1, r.P2, r.P3, r.P4]);
    });
    ws.autoFilter = { from: 'A1', to: isSpace ? 'K1' : 'F1' };
  }
  function writeReadMe(wb) {
    var ws = wb.addWorksheet('ReadMe');
    ws.columns = [{ width: 3 }, { width: 96 }];
    var lines = [
      ['t', '承辦商使用說明 — 如何用 Excel 找到位置與工序'],
      ['', ''],
      ['1', '打開「Defects」工作表：已開啟篩選及凍結首行。一列 = 一個缺陷。'],
      ['2', '篩選 Priority = P1 → 最緊急清單，先處理。顏色：P1 紅、P2 橙、P3 黃、P4 藍。'],
      ['3', '用 Location / Floor / Zone / Room 排序或篩選 → 按地方、樓層派工。'],
      ['4', '「Summary_by_Space」：哪個房間最多 Comment（按 Total 由多到少），重點處理。'],
      ['5', '「Summary_by_Location」：比較各地方的嚴重程度。'],
      ['6', 'Photo 欄已內嵌相片，可直接看缺陷實況。'],
      ['7', 'Space Code 對應現場標籤；AR Marker 欄對應現場 Barcode 標記編號。'],
      ['8', '在 Status 欄更新進度：open → in_progress → fixed → verified。'],
      ['', ''],
      ['', '優先級定義：P1 Critical=即時危險(24h) / P2 High=嚴重(1週) / P3 Medium=功能外觀(1月) / P4 Low=輕微美觀']
    ];
    lines.forEach(function (ln, i) {
      var row = ws.addRow(['', ln[1]]);
      if (ln[0] === 't') { row.getCell(2).font = { bold: true, size: 13 }; }
      if (i === 0) row.height = 22;
    });
  }

  // ---------- 下載 ----------
  function downloadBlob(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  function exportJSON() {
    var data = { project_name: '缺陷查驗 Demo', exported_at: nowISO(), spaces: spaces, defects: defects };
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'defect-data.json');
    toast('已匯出 JSON');
  }
  function importJSON(text) {
    try {
      var data = JSON.parse(text);
      if (data.spaces) spaces = data.spaces;
      if (data.defects) {
        var map = {}; defects.forEach(function (d) { map[d.guid || d.defect_id] = d; });
        data.defects.forEach(function (d) { map[d.guid || d.defect_id] = d; });   // 以 guid 合併
        defects = Object.keys(map).map(function (k) { return map[k]; });
        defects.forEach(function (d) { dbPut(d); });
      }
      renderSpaces(); renderList();
      toast('已匯入 JSON（合併完成）');
    } catch (err) { toast('JSON 格式錯誤'); }
  }

  // ---------- 事件綁定 ----------
  function bind() {
    $$('.tab').forEach(function (b) { b.addEventListener('click', function () { showView(b.dataset.view); }); });

    $('#btnStartAR').addEventListener('click', function () { showView('ar'); });
    $('#btnExitAR').addEventListener('click', function () { showView('home'); });
    $('#btnAddComment').addEventListener('click', function () { openForm(currentSpace, null); });

    $('#arSpaceSelect').addEventListener('change', function (e) {
      currentSpace = e.target.value ? findSpace(e.target.value) : null;
      updateArStatus();
    });

    $('#fileSpaces').addEventListener('change', function (e) {
      var f = e.target.files[0]; if (!f) return;
      var r = new FileReader();
      r.onload = function () { importSpacesCSV(r.result); };
      r.readAsText(f, 'utf-8');
    });
    $('#btnTemplate').addEventListener('click', function () {
      var csv = 'space_code,location_name,floor,zone,room_no,space_name,marker_value\nMAIN-3F-A-01,主樓,3F,A,01,內科病房,0\n';
      downloadBlob(new Blob([csv], { type: 'text/csv' }), 'space-template.csv');
    });
    $('#btnBarcodeGen').addEventListener('click', function () {
      window.open('https://ar-js-org.github.io/AR.js/three.js/examples/marker-training/examples/barcode.html', '_blank');
    });
    $('#btnClear').addEventListener('click', async function () {
      if (!confirm('確定清除所有記錄？')) return;
      await dbClear(); defects = []; renderList(); toast('已清除');
    });

    // 表單
    $$('#prioGroup .prio-btn').forEach(function (b) { b.addEventListener('click', function () { setPrio(b.dataset.prio); }); });
    $('#fPhotoBtn').addEventListener('click', function () {
      var data = capturePhotoNow();
      if (!data) { toast('未能取得相片（需 HTTPS 及相機權限）'); return; }
      pendingPhoto = data;
      $('#fPhotoPreview').innerHTML = '<img src="' + data + '" alt="預覽">';
    });
    $('#fSave').addEventListener('click', saveForm);
    $('#fCancel').addEventListener('click', closeForm);

    // 記錄
    $('#filterPrio').addEventListener('change', renderList);
    $('#filterLoc').addEventListener('change', renderList);
    $('#defectList').addEventListener('click', async function (e) {
      var id = e.target.dataset && e.target.dataset.del; if (!id) return;
      await dbDelete(id);
      defects = defects.filter(function (d) { return d.defect_id !== id; });
      renderList(); toast('已刪除 ' + id);
    });

    // 匯出
    $('#btnExcel').addEventListener('click', function () { exportExcel(); });
    $('#btnJSON').addEventListener('click', exportJSON);
    $('#fileJSON').addEventListener('change', function (e) {
      var f = e.target.files[0]; if (!f) return;
      var r = new FileReader(); r.onload = function () { importJSON(r.result); }; r.readAsText(f, 'utf-8');
    });
  }

  // 表單拍照：AR 場景仍在 DOM 時可用
  function capturePhotoNow() {
    if ($('#arscene')) return capturePhoto();
    var vids = $$('video');
    for (var i = 0; i < vids.length; i++) {
      if (vids[i].videoWidth) {
        var c = document.createElement('canvas');
        c.width = vids[i].videoWidth; c.height = vids[i].videoHeight;
        c.getContext('2d').drawImage(vids[i], 0, 0);
        return c.toDataURL('image/jpeg', 0.8);
      }
    }
    return null;
  }

  // ---------- 啟動 ----------
  async function init() {
    // 環境提示
    if (!window.isSecureContext) {
      $('#envWarn').classList.add('show');
      $('#envWarn').innerHTML = '⚠️ 目前非安全來源（HTTPS / localhost）—— 相機與 AR 將無法使用。請改用 <span class="mono">https://</span> 或 <span class="mono">http://localhost</span> 開啟。';
    }
    db = await openDB();
    defects = await dbGetAll();
    // 空間主檔選擇器
    $('#arSpaceSelect').innerHTML = '<option value="">— 手動選擇空間 —</option>' +
      spaces.map(function (s) { return '<option value="' + esc(s.space_code) + '">' + esc(s.space_code) + ' · ' + esc(s.space_name) + '</option>'; }).join('');
    renderSpaces();
    renderList();
    bind();
  }

  window.addEventListener('DOMContentLoaded', init);
})();
