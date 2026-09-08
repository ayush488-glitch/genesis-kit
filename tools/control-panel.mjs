// The served control panel. A pure data -> string function, like dashboard.mjs, so it stays testable
// and has no build step. Data arrives from serve.mjs over fetch; changes arrive over SSE.
// The client script deliberately avoids template literals: this page is itself a template literal,
// and nesting them turns every backtick into an escaping hazard.
export function controlPanelPage({ project }) {
  const escape = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(project)} · Genesis</title><style>
:root{--bg:#050807;--panel:#0a0f0e;--line:#1a2422;--ink:#e8e4d9;--dim:#8a9490;--faint:#5a6560;--amber:#ffb454;--gold:#ffd479;--rust:#ff7a45;--sky:#5ec8ea;--bad:#f87171}
*{box-sizing:border-box}
body{margin:0;height:100vh;overflow:hidden;background:var(--bg);color:var(--ink);font:13px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;display:grid;grid-template-columns:240px 1fr 320px;grid-template-rows:44px 1fr}
header{grid-column:1/-1;display:flex;align-items:center;gap:12px;padding:0 14px;border-bottom:1px solid var(--line);background:var(--panel);z-index:3}
header h1{font-size:13px;font-weight:600;margin:0;letter-spacing:.02em}
header .sep{flex:1}
.tag{font:11px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dim);border:1px solid var(--line);border-radius:5px;padding:2px 7px}
#live{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dim)}
#dot{width:7px;height:7px;border-radius:50%;background:var(--faint);transition:background .3s,box-shadow .3s}
#dot.on{background:var(--amber);box-shadow:0 0 10px var(--amber)}
@keyframes flash{0%{box-shadow:0 0 0 0 rgba(255,180,84,.7)}100%{box-shadow:0 0 0 14px rgba(255,180,84,0)}}
#dot.beat{animation:flash .7s ease-out}
aside{border-right:1px solid var(--line);background:var(--panel);overflow-y:auto;padding:12px;scrollbar-width:thin}
#detail{border-right:none;border-left:1px solid var(--line)}
main{position:relative;overflow:hidden;background:radial-gradient(ellipse 70% 55% at 50% 40%,#07110f 0%,var(--bg) 75%)}
canvas{display:block;width:100%;height:100%;cursor:grab}
canvas.drag{cursor:grabbing}
canvas.over{cursor:pointer}
h2{font-size:10px;text-transform:uppercase;letter-spacing:.09em;color:var(--faint);margin:16px 0 7px;font-weight:600}
h2:first-child{margin-top:0}
.row{display:flex;justify-content:space-between;gap:8px;padding:3px 0;color:var(--dim)}
.row b{color:var(--ink);font-weight:500}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px}
.task{border:1px solid var(--line);border-radius:6px;padding:7px 8px;margin-bottom:6px}
.task .id{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:var(--amber)}
.task .out{color:var(--dim);font-size:12px;margin-top:2px}
.pill{font-size:10px;padding:1px 6px;border-radius:99px;border:1px solid var(--line);color:var(--dim)}
.pill.active{color:var(--amber);border-color:var(--amber)}
.pill.blocked,.pill.failed{color:var(--bad);border-color:var(--bad)}
#legend{position:absolute;top:12px;right:12px;z-index:2;background:rgba(10,15,14,.9);backdrop-filter:blur(8px);border:1px solid var(--line);border-radius:8px;padding:10px 12px;font-size:12px}
#legend label{display:flex;align-items:center;gap:9px;padding:3px 0;cursor:pointer;color:var(--dim);white-space:nowrap}
#legend label:hover{color:var(--ink)}
#legend .swatch{width:26px;height:0;border-top-width:2px;border-top-style:solid;flex:none}
#legend button{margin-top:8px;width:100%;background:transparent;border:1px solid var(--line);color:var(--dim);border-radius:5px;padding:5px;font:11px inherit;cursor:pointer;letter-spacing:.1em}
#legend button:hover{color:var(--ink);border-color:var(--amber)}
.ctl{position:absolute;top:12px;left:12px;z-index:2;display:flex;gap:6px;align-items:center}
.ctl input{background:rgba(10,15,14,.9);backdrop-filter:blur(8px);border:1px solid var(--line);color:var(--ink);border-radius:5px;padding:4px 9px;font:11px inherit;width:170px}
.ctl button{background:rgba(10,15,14,.9);border:1px solid var(--line);color:var(--dim);border-radius:5px;padding:4px 9px;font:11px inherit;cursor:pointer}
.ctl button:hover{color:var(--ink);border-color:var(--amber)}
#stats{position:absolute;right:14px;bottom:12px;z-index:2;color:var(--faint);font:11px ui-monospace,Menlo,monospace;text-align:right}
#hint{position:absolute;left:14px;bottom:12px;z-index:2;color:var(--faint);font:10px ui-monospace,Menlo,monospace;line-height:1.7}
#tip{position:absolute;z-index:4;pointer-events:none;background:rgba(5,8,7,.95);border:1px solid var(--line);border-radius:6px;padding:6px 9px;font:11px ui-monospace,Menlo,monospace;color:var(--ink);white-space:nowrap;opacity:0;transition:opacity .12s;box-shadow:0 6px 22px rgba(0,0,0,.7)}
#tip.on{opacity:1}
#tip .s{color:var(--faint);display:block;margin-top:2px}
#empty{position:absolute;inset:0;display:grid;place-content:center;text-align:center;color:var(--faint);font-size:12px;line-height:1.7}
.sym{display:flex;gap:7px;padding:2px 0;font-family:ui-monospace,Menlo,monospace;font-size:11px}
.sym .k{color:var(--faint);width:60px;flex:none}
.sym .n{color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dep{display:flex;justify-content:space-between;gap:8px;font-family:ui-monospace,Menlo,monospace;font-size:11px;padding:2px 0;color:var(--dim);cursor:pointer}
.dep:hover{color:var(--ink)}
.dep span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left}
.dep b{color:var(--amber);font-weight:500}
.hint{color:var(--faint);font-size:11px;line-height:1.6}
</style></head><body>
<header>
  <h1>${escape(project)}</h1>
  <span class="tag" id="rev">—</span>
  <span class="sep"></span>
  <span id="live"><span id="dot"></span><span id="livetext">connecting</span></span>
</header>

<aside id="state"><div class="hint">loading…</div></aside>

<main>
  <canvas id="c"></canvas>
  <div class="ctl">
    <input id="q" type="search" placeholder="filter paths" aria-label="Filter paths">
    <button id="reset">reset view</button>
  </div>
  <div id="legend">
    <label><input type="checkbox" id="e0" checked><span class="swatch" style="border-top-color:#ffd479"></span>calls</label>
    <label><input type="checkbox" id="e1" checked><span class="swatch" style="border-top-color:#ffd479;border-top-style:dashed"></span>candidates</label>
    <label><input type="checkbox" id="e2" checked><span class="swatch" style="border-top-color:#ff7a45"></span>inheritance</label>
    <button id="refresh">&#8635; REFRESH</button>
  </div>
  <div id="tip"></div>
  <div id="stats">—</div>
  <div id="hint">drag to pan · scroll to zoom · hover a file to trace it<br>click to inspect · double-click to focus a directory</div>
  <div id="empty" hidden></div>
</main>

<aside id="detail"><div class="hint">Hover a file to light up what it calls.<br>Click to inspect it.</div></aside>

<script>
var $ = function (id) { return document.getElementById(id); };
var canvas = $('c'), ctx = canvas.getContext('2d'), tip = $('tip');

var mapData = null;          // { files, edges, stats }
var rects = [];              // one per file, in received order
var pos = null;              // Float32Array of symbol x,y pairs, indexed by global symbol index
var owner = null;            // Int32Array symbol index -> file index
var view = { x: 0, y: 0, k: 1 };
var pan = null, hovered = -1, focusPath = '', filter = '';
var show = [true, true, true];   // calls, candidates, inheritance
var pulse = 0, redrawTimer = null;

function fetchMap() {
  return fetch('/api/map').then(function (r) { return r.json(); }).then(function (data) {
    mapData = data;
    $('rev').textContent = data.revision ? data.revision.slice(0, 8) : 'no revision';
    $('empty').hidden = !data.missing;
    if (data.missing) { $('empty').innerHTML = 'No index yet.<br>Run <code>genesis index &lt;repo&gt;</code> to build one.'; return; }
    var s = data.stats;
    $('stats').textContent = s.symbols + ' nodes, ' + s.calls + ' edges (+' + s.candidates + ' possible), ' + s.files + ' files';
    buildLayout();
    fit();
    schedule(true);
  });
}

// --- treemap -----------------------------------------------------------------
// Containment, not a force layout: a file's place on screen is its place in the tree, so the
// picture is stable, and every symbol gets its own cell instead of being averaged into a blob.
function buildTree(files, prefix) {
  var root = { name: '', dirs: new Map(), files: [], value: 0 };
  for (var i = 0; i < files.length; i++) {
    var file = files[i];
    if (prefix && file.path.indexOf(prefix + '/') !== 0) continue;
    var parts = file.path.split('/'), node = root;
    for (var p = 0; p < parts.length - 1; p++) {
      if (!node.dirs.has(parts[p])) node.dirs.set(parts[p], { name: parts[p], dirs: new Map(), files: [], value: 0 });
      node = node.dirs.get(parts[p]);
    }
    node.files.push({ index: i, file: file, value: Math.max(1, file.symbols.length) });
  }
  (function value(node) {
    var total = 0;
    node.dirs.forEach(function (child) { total += value(child); });
    for (var f = 0; f < node.files.length; f++) total += node.files[f].value;
    node.value = total;
    return total;
  })(root);
  return root;
}

// Squarified treemap: pack a row until adding the next item would make the worst aspect ratio
// worse, then start a new row. Keeps cells near-square, which is what makes the grid readable.
function squarify(items, rect, out) {
  var free = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
  var total = 0, i;
  for (i = 0; i < items.length; i++) total += items[i].value;
  if (total <= 0 || free.w <= 0 || free.h <= 0) return;
  var scale = (free.w * free.h) / total;
  var row = [], rowValue = 0, cursor = 0;
  var worst = function (row, side, sum) {
    if (!row.length || side <= 0) return Infinity;
    var max = -Infinity, min = Infinity;
    for (var r = 0; r < row.length; r++) { var a = row[r].value * scale; if (a > max) max = a; if (a < min) min = a; }
    var s2 = sum * scale;
    return Math.max((side * side * max) / (s2 * s2), (s2 * s2) / (side * side * min));
  };
  while (cursor < items.length) {
    var vertical = free.w >= free.h, side = vertical ? free.h : free.w;
    var next = items[cursor];
    if (!row.length || worst(row.concat([next]), side, rowValue + next.value) <= worst(row, side, rowValue)) {
      row.push(next); rowValue += next.value; cursor += 1;
      if (cursor < items.length) continue;
    }
    var thickness = (rowValue * scale) / side, offset = 0;
    for (i = 0; i < row.length; i++) {
      var share = (row[i].value * scale) / thickness;
      out(row[i], vertical
        ? { x: free.x, y: free.y + offset, w: thickness, h: share }
        : { x: free.x + offset, y: free.y, w: share, h: thickness });
      offset += share;
    }
    if (vertical) { free.x += thickness; free.w -= thickness; } else { free.y += thickness; free.h -= thickness; }
    row = []; rowValue = 0;
  }
}

function place(node, rect, depth) {
  var items = [];
  node.dirs.forEach(function (child) { items.push({ value: child.value, dir: child }); });
  for (var f = 0; f < node.files.length; f++) items.push(node.files[f]);
  items.sort(function (a, b) { return b.value - a.value; });
  squarify(items, rect, function (item, box) {
    var pad = depth < 3 ? 3 : 1.5;
    var inner = { x: box.x + pad, y: box.y + pad, w: Math.max(0, box.w - pad * 2), h: Math.max(0, box.h - pad * 2) };
    if (item.dir) { item.dir.box = box; item.dir.depth = depth; boxes.push(item.dir); place(item.dir, inner, depth + 1); return; }
    rects[item.index] = { x: inner.x, y: inner.y, w: inner.w, h: inner.h, file: item.file, index: item.index };
  });
}

var boxes = [];
function buildLayout() {
  var w = 1400, h = 1000;      // world units; the camera scales this to the viewport
  rects = new Array(mapData.files.length);
  boxes = [];
  var tree = buildTree(mapData.files, focusPath);
  place(tree, { x: 0, y: 0, w: w, h: h }, 0);

  // Symbol cells: a grid inside each file box, ordered the same way the server indexed them.
  var count = 0, i;
  for (i = 0; i < mapData.files.length; i++) count += mapData.files[i].symbols.length;
  pos = new Float32Array(count * 2);
  owner = new Int32Array(count);
  var running = 0;
  for (i = 0; i < mapData.files.length; i++) {
    var symbols = mapData.files[i].symbols, rect = rects[i];
    var n = symbols.length;
    if (!rect || rect.w <= 0 || rect.h <= 0) { for (var m = 0; m < n; m++) { pos[(running + m) * 2] = -9999; pos[(running + m) * 2 + 1] = -9999; owner[running + m] = i; } running += n; continue; }
    var cols = Math.max(1, Math.round(Math.sqrt(n * (rect.w / Math.max(0.001, rect.h)))));
    var rows = Math.ceil(n / cols);
    for (var s = 0; s < n; s++) {
      var cx = rect.x + ((s % cols) + 0.5) * (rect.w / cols);
      var cy = rect.y + (Math.floor(s / cols) + 0.5) * (rect.h / rows);
      pos[(running + s) * 2] = cx; pos[(running + s) * 2 + 1] = cy;
      owner[running + s] = i;
    }
    running += n;
  }
}

function fit() {
  var w = canvas.clientWidth, h = canvas.clientHeight;
  view.k = Math.min(w / 1400, h / 1000) * 0.92;
  view.x = (w - 1400 * view.k) / 2;
  view.y = (h - 1000 * view.k) / 2;
}

// --- rendering ---------------------------------------------------------------
var STAR_COUNT = 90;
function stars() {
  // Deterministic: a fixed lattice rather than Math.random, so the backdrop never shimmers
  // between redraws.
  ctx.save();
  for (var i = 0; i < STAR_COUNT; i++) {
    var x = ((i * 6547) % 1400), y = ((i * 3571) % 1000);
    var p = ((i * 7919) % 100) / 100;
    ctx.globalAlpha = 0.05 + p * 0.13;
    ctx.fillStyle = '#cfe8e0';
    ctx.fillRect(x, y, 1.2, 1.2);
  }
  ctx.restore();
}

function matches(path) { return !filter || path.toLowerCase().indexOf(filter) !== -1; }

function draw(withEdges) {
  var w = canvas.clientWidth, h = canvas.clientHeight;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!mapData || mapData.missing) return;
  ctx.save();
  ctx.translate(view.x, view.y);
  ctx.scale(view.k, view.k);
  stars();

  var lit = hovered >= 0 ? hovered : -1;

  // Directory frames, faint and thin: structure you read past, not through.
  for (var b = 0; b < boxes.length; b++) {
    var box = boxes[b].box;
    if (boxes[b].depth > 3) continue;
    ctx.strokeStyle = 'rgba(255,180,84,' + (0.16 - boxes[b].depth * 0.03) + ')';
    ctx.lineWidth = 0.6 / view.k;
    ctx.strokeRect(box.x, box.y, box.w, box.h);
  }

  for (var i = 0; i < rects.length; i++) {
    var rect = rects[i];
    if (!rect || rect.w < 0.6 || rect.h < 0.6) continue;
    var on = matches(rect.file.path), isLit = i === lit;
    ctx.globalAlpha = on ? 1 : 0.15;
    ctx.strokeStyle = isLit ? 'rgba(255,212,121,.95)' : 'rgba(255,180,84,.28)';
    ctx.lineWidth = (isLit ? 1.6 : 0.5) / view.k;
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    if (isLit) { ctx.fillStyle = 'rgba(255,180,84,.10)'; ctx.fillRect(rect.x, rect.y, rect.w, rect.h); }
    ctx.globalAlpha = 1;
  }

  // Symbol cells.
  var dot = Math.max(0.7, 1.6 / view.k);
  ctx.fillStyle = 'rgba(255,196,120,.55)';
  for (var s = 0; s < owner.length; s++) {
    var x = pos[s * 2], y = pos[s * 2 + 1];
    if (x < -1000) continue;
    var fileIndex = owner[s];
    var rect2 = rects[fileIndex];
    if (!rect2 || rect2.w < 2 || rect2.h < 2) continue;
    ctx.globalAlpha = matches(rect2.file.path) ? (fileIndex === lit ? 1 : 0.5) : 0.08;
    ctx.fillRect(x - dot / 2, y - dot / 2, dot, dot);
  }
  ctx.globalAlpha = 1;

  if (withEdges) drawEdges(lit);

  // Directory labels last, so they sit above the filaments.
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  for (var d = 0; d < boxes.length; d++) {
    var node = boxes[d];
    if (node.depth > 2) continue;
    var px = node.box.w * view.k;
    if (px < 70) continue;
    ctx.globalAlpha = 0.5 - node.depth * 0.1;
    ctx.fillStyle = '#ffe9c4';
    ctx.font = Math.max(8, (11 - node.depth) / view.k) + 'px ui-monospace,Menlo,monospace';
    ctx.fillText(node.name, node.box.x + 3 / view.k, node.box.y + 2 / view.k);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

// Additive blending is what makes a dense bundle read as light: hundreds of nearly transparent
// filaments overlapping sum into the bright core, exactly where the coupling is heaviest.
function drawEdges(lit) {
  var edges = mapData.edges;
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineWidth = 0.5 / view.k;
  for (var e = 0; e < edges.length; e++) {
    var edge = edges[e], from = edge[0], to = edge[1], kind = edge[2], ambiguous = edge[3];
    var band = kind === 1 ? 2 : ambiguous ? 1 : 0;
    if (!show[band]) continue;
    var ax = pos[from * 2], ay = pos[from * 2 + 1], bx = pos[to * 2], by = pos[to * 2 + 1];
    if (ax < -1000 || bx < -1000) continue;
    var touching = lit >= 0 && (owner[from] === lit || owner[to] === lit);
    if (lit >= 0 && !touching) continue;
    if (!matches(rects[owner[from]].file.path) && !matches(rects[owner[to]].file.path)) continue;
    var alpha = touching ? 0.85 : (band === 1 ? 0.10 : 0.16);
    ctx.strokeStyle = band === 2 ? 'rgba(255,122,69,' + alpha + ')' : 'rgba(255,206,120,' + alpha + ')';
    if (band === 1) ctx.setLineDash([3 / view.k, 3 / view.k]); else ctx.setLineDash([]);
    // Bow each filament perpendicular to its run so bundles fan out instead of stacking.
    var mx = (ax + bx) / 2, my = (ay + by) / 2, dx = bx - ax, dy = by - ay;
    var d = Math.hypot(dx, dy) || 1;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo(mx + (-dy / d) * d * 0.16, my + (dx / d) * d * 0.16, bx, by);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.globalCompositeOperation = 'source-over';
}

// Edges are the expensive part, so they are skipped while the camera is moving and drawn once
// it settles. Panning stays responsive; the picture arrives a beat later.
function schedule(now) {
  draw(false);
  clearTimeout(redrawTimer);
  redrawTimer = setTimeout(function () { draw(true); }, now ? 0 : 110);
}

function resize() {
  canvas.width = canvas.clientWidth * devicePixelRatio;
  canvas.height = canvas.clientHeight * devicePixelRatio;
}

function toWorld(event) {
  var rect = canvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left - view.x) / view.k, y: (event.clientY - rect.top - view.y) / view.k };
}
function pick(event) {
  var p = toWorld(event);
  for (var i = 0; i < rects.length; i++) {
    var r = rects[i];
    if (r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return i;
  }
  return -1;
}

canvas.addEventListener('mousedown', function (e) { pan = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; canvas.classList.add('drag'); });
addEventListener('mouseup', function () { pan = null; canvas.classList.remove('drag'); });
addEventListener('mousemove', function (e) {
  if (pan) { view.x = pan.vx + (e.clientX - pan.x); view.y = pan.vy + (e.clientY - pan.y); schedule(); return; }
  if (!rects.length) return;
  var hit = pick(e);
  canvas.classList.toggle('over', hit >= 0);
  if (hit !== hovered) { hovered = hit; schedule(hit < 0 ? false : true); }
  if (hit >= 0) {
    var file = rects[hit].file, rect = canvas.getBoundingClientRect();
    tip.classList.add('on');
    tip.innerHTML = file.path + '<span class="s">' + file.symbols.length + ' symbols</span>';
    tip.style.left = Math.min(e.clientX - rect.left + 14, rect.width - tip.offsetWidth - 8) + 'px';
    tip.style.top = (e.clientY - rect.top + 14) + 'px';
  } else tip.classList.remove('on');
});
canvas.addEventListener('mouseleave', function () { hovered = -1; tip.classList.remove('on'); schedule(); });
canvas.addEventListener('wheel', function (e) {
  e.preventDefault();
  var p = toWorld(e), rect = canvas.getBoundingClientRect();
  view.k = Math.max(0.05, Math.min(60, view.k * Math.exp(-e.deltaY * 0.0016)));
  view.x = e.clientX - rect.left - p.x * view.k;
  view.y = e.clientY - rect.top - p.y * view.k;
  schedule();
}, { passive: false });
canvas.addEventListener('click', function (e) { var hit = pick(e); if (hit >= 0) inspect(rects[hit].file.path); });
canvas.addEventListener('dblclick', function (e) {
  var hit = pick(e);
  if (hit < 0) return;
  var parts = rects[hit].file.path.split('/');
  focusPath = parts.slice(0, Math.max(1, parts.length - 1)).join('/');
  buildLayout(); fit(); schedule(true);
});

function inspect(path) {
  return fetch('/api/node?id=' + encodeURIComponent(path)).then(function (r) { return r.json(); }).then(function (data) {
    var list = function (items, empty) {
      if (!items.length) return '<div class="hint">' + empty + '</div>';
      return items.map(function (d) { return '<div class="dep"><span>' + d.target + '</span><b>' + d.weight + '</b></div>'; }).join('');
    };
    $('detail').innerHTML =
      '<h2>Selected</h2><div class="mono" style="word-break:break-all;color:var(--amber)">' + path + '</div>' +
      '<div class="row"><span>files</span><b>' + data.files + '</b></div>' +
      '<div class="row"><span>symbols</span><b>' + data.symbolCount + '</b></div>' +
      '<h2>Depends on</h2>' + list(data.dependsOn, 'Nothing outside itself.') +
      '<h2>Depended on by</h2>' + list(data.dependedOnBy, 'Nothing imports this.') +
      '<h2>Symbols' + (data.symbolCount > data.symbols.length ? ' (first ' + data.symbols.length + ')' : '') + '</h2>' +
      (data.symbols.map(function (s) { return '<div class="sym"><span class="k">' + s.kind + '</span><span class="n" title="' + s.path + ':' + s.line + '">' + s.name + '</span></div>'; }).join('') || '<div class="hint">No symbols extracted here.</div>');
  });
}

function loadState() {
  return fetch('/api/summary').then(function (r) { return r.json(); }).then(function (data) {
    if (data.missing) { $('state').innerHTML = '<div class="hint">No project.json.</div>'; return; }
    var life = data.lifecycle || {};
    $('state').innerHTML =
      '<h2>Lifecycle</h2>' +
      '<div class="row"><span>phase</span><b>' + (life.phase || '&mdash;') + '</b></div>' +
      '<div class="row"><span>status</span><b>' + (life.status || '&mdash;') + '</b></div>' +
      '<div class="row"><span>active</span><b class="mono">' + (life.active_task || '&mdash;') + '</b></div>' +
      (life.next_action ? '<h2>Next action</h2><div class="hint">' + life.next_action + '</div>' : '') +
      (life.blocker ? '<h2>Blocker</h2><div class="hint" style="color:var(--bad)">' + life.blocker + '</div>' : '') +
      '<h2>Tasks</h2>' +
      ((data.tasks || []).map(function (t) { return '<div class="task"><div class="id">' + t.id + ' <span class="pill ' + t.state + '">' + t.state + '</span></div><div class="out">' + (t.outcome || '') + '</div></div>'; }).join('') || '<div class="hint">No tasks yet.</div>') +
      '<h2>Ledger</h2>' +
      Object.keys(data.counts || {}).map(function (k) { return '<div class="row"><span>' + k + '</span><b>' + data.counts[k] + '</b></div>'; }).join('');
  });
}

var events = new EventSource('/events');
events.onopen = function () { $('dot').classList.add('on'); $('livetext').textContent = 'live'; };
events.onerror = function () { $('dot').classList.remove('on'); $('livetext').textContent = 'reconnecting'; };
events.addEventListener('indexing', function (e) {
  var data = JSON.parse(e.data);
  $('livetext').textContent = data.state === 'start' ? 'indexing' : (data.ok ? 'live' : 'index failed');
});
events.addEventListener('change', function () {
  $('dot').classList.remove('beat');
  void $('dot').offsetWidth;
  $('dot').classList.add('beat');
  loadState();
  fetchMap();
});

for (var band = 0; band < 3; band++) (function (b) {
  $('e' + b).onchange = function () { show[b] = this.checked; schedule(true); };
})(band);
$('q').oninput = function (e) { filter = e.target.value.trim().toLowerCase(); schedule(); };
$('refresh').onclick = function () { fetchMap(); };
$('reset').onclick = function () { focusPath = ''; hovered = -1; buildLayout(); fit(); schedule(true); };
addEventListener('resize', function () { resize(); fit(); schedule(); });

resize();
loadState();
fetchMap();
</script></body></html>
`;
}
