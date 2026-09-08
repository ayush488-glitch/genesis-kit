// The served control panel. A pure data -> string function, like dashboard.mjs, so it stays testable
// and has no build step. Data arrives from serve.mjs over fetch; changes arrive over SSE.
// The client script deliberately avoids template literals: this page is itself a template literal,
// and nesting them turns every backtick into an escaping hazard.
export function controlPanelPage({ project }) {
  const escape = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(project)} · Genesis</title><style>
:root{--bg:#070910;--panel:#0d1119;--line:#1b2231;--ink:#e6ebf5;--dim:#8b96ad;--faint:#556080;--accent:#5eead4;--bad:#f87171}
*{box-sizing:border-box}
body{margin:0;height:100vh;overflow:hidden;background:var(--bg);color:var(--ink);font:13px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;display:grid;grid-template-columns:250px 1fr 330px;grid-template-rows:44px 1fr}
header{grid-column:1/-1;display:flex;align-items:center;gap:12px;padding:0 14px;border-bottom:1px solid var(--line);background:var(--panel);z-index:3}
header h1{font-size:13px;font-weight:600;margin:0;letter-spacing:.02em}
header .sep{flex:1}
.tag{font:11px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dim);border:1px solid var(--line);border-radius:5px;padding:2px 7px}
#live{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dim)}
#dot{width:7px;height:7px;border-radius:50%;background:var(--faint);transition:background .3s,box-shadow .3s}
#dot.on{background:var(--accent);box-shadow:0 0 10px var(--accent)}
@keyframes flash{0%{box-shadow:0 0 0 0 rgba(94,234,212,.7)}100%{box-shadow:0 0 0 14px rgba(94,234,212,0)}}
#dot.beat{animation:flash .7s ease-out}
aside{border-right:1px solid var(--line);background:var(--panel);overflow-y:auto;padding:12px;scrollbar-width:thin}
#detail{border-right:none;border-left:1px solid var(--line)}
main{position:relative;overflow:hidden;background:radial-gradient(ellipse 80% 60% at 50% 45%,#0b1220 0%,var(--bg) 70%)}
canvas{display:block;width:100%;height:100%;cursor:grab}
canvas.drag{cursor:grabbing}
canvas.over{cursor:pointer}
h2{font-size:10px;text-transform:uppercase;letter-spacing:.09em;color:var(--faint);margin:16px 0 7px;font-weight:600}
h2:first-child{margin-top:0}
.row{display:flex;justify-content:space-between;gap:8px;padding:3px 0;color:var(--dim)}
.row b{color:var(--ink);font-weight:500}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px}
.task{border:1px solid var(--line);border-radius:6px;padding:7px 8px;margin-bottom:6px}
.task .id{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:var(--accent)}
.task .out{color:var(--dim);font-size:12px;margin-top:2px}
.pill{font-size:10px;padding:1px 6px;border-radius:99px;border:1px solid var(--line);color:var(--dim)}
.pill.active{color:var(--accent);border-color:var(--accent)}
.pill.blocked,.pill.failed{color:var(--bad);border-color:var(--bad)}
.crumb{display:flex;flex-wrap:wrap;gap:4px;position:absolute;top:10px;left:10px;z-index:2;max-width:50%}
.crumb button,.ctl button,.ctl label{background:rgba(13,17,25,.88);backdrop-filter:blur(6px);border:1px solid var(--line);color:var(--dim);border-radius:5px;padding:3px 8px;font-size:11px;cursor:pointer;font-family:inherit}
.crumb button:hover,.ctl button:hover{color:var(--ink);border-color:var(--accent)}
.ctl{position:absolute;top:10px;right:10px;z-index:2;display:flex;gap:6px;align-items:center}
.ctl input[type=search]{background:rgba(13,17,25,.88);backdrop-filter:blur(6px);border:1px solid var(--line);color:var(--ink);border-radius:5px;padding:3px 8px;font:11px inherit;width:140px}
.ctl label{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.ctl select{background:rgba(13,17,25,.88);border:1px solid var(--line);color:var(--dim);border-radius:5px;padding:3px 6px;font:11px inherit}
#tip{position:absolute;z-index:4;pointer-events:none;background:rgba(7,9,16,.94);border:1px solid var(--line);border-radius:6px;padding:6px 9px;font:11px ui-monospace,Menlo,monospace;color:var(--ink);white-space:nowrap;opacity:0;transition:opacity .12s;box-shadow:0 6px 22px rgba(0,0,0,.6)}
#tip.on{opacity:1}
#tip .s{color:var(--faint);display:block;margin-top:2px}
#empty{position:absolute;inset:0;display:grid;place-content:center;text-align:center;color:var(--faint);font-size:12px;line-height:1.7}
#legend{position:absolute;left:10px;bottom:10px;z-index:2;color:var(--faint);font-size:10px;line-height:1.7;font-family:ui-monospace,Menlo,monospace}
.sym{display:flex;gap:7px;padding:2px 0;font-family:ui-monospace,Menlo,monospace;font-size:11px}
.sym .k{color:var(--faint);width:60px;flex:none}
.sym .n{color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dep{display:flex;justify-content:space-between;gap:8px;font-family:ui-monospace,Menlo,monospace;font-size:11px;padding:2px 0;color:var(--dim);cursor:pointer}
.dep:hover{color:var(--ink)}
.dep span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left}
.dep b{color:var(--accent);font-weight:500}
.hint{color:var(--faint);font-size:11px;line-height:1.6}
</style></head><body>
<header>
  <h1>${escape(project)}</h1>
  <span class="tag" id="rev">—</span>
  <span class="tag" id="scale">—</span>
  <span class="sep"></span>
  <span id="live"><span id="dot"></span><span id="livetext">connecting</span></span>
</header>

<aside id="state"><div class="hint">loading…</div></aside>

<main>
  <canvas id="c"></canvas>
  <div class="crumb" id="crumb"></div>
  <div class="ctl">
    <input id="q" type="search" placeholder="filter" aria-label="Filter nodes">
    <select id="depth" aria-label="Grouping depth"><option value="1">depth 1</option><option value="2">depth 2</option><option value="3" selected>depth 3</option><option value="4">depth 4</option><option value="5">depth 5</option></select>
    <label><input type="checkbox" id="ext"> externals</label>
    <label><input type="checkbox" id="iso"> stray files</label>
    <button id="reset">reset</button>
  </div>
  <div id="tip"></div>
  <div id="legend">drag to pan · scroll to zoom · drag a node to move it<br>click to inspect · double-click a directory to expand</div>
  <div id="empty" hidden></div>
</main>

<aside id="detail"><div class="hint">Click a node to inspect it.<br>Double-click a directory to expand it.</div></aside>

<script>
var $ = function (id) { return document.getElementById(id); };
var canvas = $('c'), ctx = canvas.getContext('2d'), tip = $('tip');

// Nodes persist across reloads by id, so changing depth or reindexing morphs the layout instead
// of throwing it away and redrawing something unrecognisable.
var nodes = new Map(), edges = [], meta = {}, expand = [];
var view = { x: 0, y: 0, k: 1 }, fitted = false;
var alpha = 0;              // simulation heat, reheated on every data change
var selected = null, hovered = null, filter = '';
var drag = null, pan = null;
var neighbours = new Set();
var clock = 0;

// Deterministic: no Math.random anywhere, so the same index always settles the same way.
function hueOf(id) { var h = 0, head = id.split('/')[0]; for (var i = 0; i < head.length; i++) h = (h * 31 + head.charCodeAt(i)) % 360; return h; }
function radiusOf(files) { return Math.min(32, 4 + Math.log2(1 + (files || 1)) * 3); }

function load() {
  var params = new URLSearchParams({ depth: $('depth').value, expand: expand.join(','), externals: $('ext').checked ? '1' : '0', isolated: $('iso').checked ? '1' : '0' });
  return fetch('/api/graph?' + params).then(function (r) { return r.json(); }).then(applyData);
}

function applyData(data) {
  meta = data.meta || {};
  $('rev').textContent = meta.revision ? meta.revision.slice(0, 8) : 'no revision';
  $('scale').textContent = meta.missing ? 'no index' : meta.totalFiles + ' files · ' + meta.totalEdges + ' edges';
  $('empty').hidden = !meta.missing;
  if (meta.missing) $('empty').innerHTML = 'No index yet.<br>Run <code>genesis index &lt;repo&gt;</code> to build one.';

  var incoming = new Map();
  data.nodes.forEach(function (n, i) { incoming.set(n.id, { node: n, i: i }); });
  Array.prototype.forEach.call(Array.from(nodes.keys()), function (id) { if (!incoming.has(id)) nodes.delete(id); });
  var count = data.nodes.length;
  incoming.forEach(function (entry, id) {
    var existing = nodes.get(id);
    if (existing) { existing.files = entry.node.files; existing.symbols = entry.node.symbols; existing.label = entry.node.label; existing.kind = entry.node.kind; existing.tr = radiusOf(entry.node.files); return; }
    // Seed a new node near its parent, so expanding a directory grows outward from the one you
    // opened rather than teleporting its children in from the edge of the world.
    var parent = null, rest = id, cut = rest.lastIndexOf('/');
    while (cut > 0 && !parent) { rest = rest.slice(0, cut); parent = nodes.get(rest) || null; cut = rest.lastIndexOf('/'); }
    var angle = (entry.i / Math.max(1, count)) * Math.PI * 2;
    var spread = parent ? 32 : 150 + (entry.i % 7) * 40;
    nodes.set(id, {
      id: id, label: entry.node.label, kind: entry.node.kind, files: entry.node.files, symbols: entry.node.symbols,
      x: (parent ? parent.x : 0) + Math.cos(angle) * spread, y: (parent ? parent.y : 0) + Math.sin(angle) * spread,
      vx: 0, vy: 0, r: 1, tr: radiusOf(entry.node.files), pulse: 0
    });
  });
  edges = data.edges.filter(function (e) { return nodes.has(e.source) && nodes.has(e.target); });
  // First paint settles off-screen then frames the result; afterwards the layout keeps only enough
  // heat to relax, or the graph drifts out of the view it was just fitted to.
  if (!fitted && nodes.size) { for (var i = 0; i < 260; i++) step(1 - i / 260); fitted = true; alpha = 0.12; fit(); }
  else alpha = 1;
  recomputeNeighbours();
  renderCrumb();
}

// One simulation step. O(n^2) repulsion is fine at the few hundred nodes an aggregated view
// produces. ponytail: naive n-body, swap for Barnes-Hut only if a view exceeds ~800 nodes.
function step(heat) {
  var list = Array.from(nodes.values()), n = list.length, i, j;
  for (i = 0; i < n; i++) {
    var a = list[i];
    for (j = i + 1; j < n; j++) {
      var b = list[j];
      var dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy || 0.01;
      if (d2 > 400000) continue;
      var d = Math.sqrt(d2);
      // Repulsion scales with the pair's radii so large nodes clear proportional room.
      var force = (2400 + 90 * (a.tr + b.tr)) / d2;
      var fx = (dx / d) * force, fy = (dy / d) * force;
      a.vx -= fx; a.vy -= fy; b.vx += fx; b.vy += fy;
    }
  }
  for (i = 0; i < edges.length; i++) {
    var edge = edges[i], s = nodes.get(edge.source), t = nodes.get(edge.target);
    var ex = t.x - s.x, ey = t.y - s.y, ed = Math.hypot(ex, ey) || 0.01;
    var rest = 100 + 140 / (1 + edge.weight);
    var pull = (ed - rest) * 0.011 * Math.min(3, Math.log2(1 + edge.weight) + 1);
    s.vx += (ex / ed) * pull; s.vy += (ey / ed) * pull;
    t.vx -= (ex / ed) * pull; t.vy -= (ey / ed) * pull;
  }
  for (i = 0; i < n; i++) {
    var node = list[i];
    if (node === drag) { node.vx = 0; node.vy = 0; continue; }
    node.vx -= node.x * 0.0016; node.vy -= node.y * 0.0016;
    node.x += node.vx * heat; node.y += node.vy * heat;
    node.vx *= 0.80; node.vy *= 0.80;
  }
  // Hard separation: springs alone still let discs overlap, and an overlapped node is unclickable.
  for (var pass = 0; pass < 3; pass++) {
    for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) {
      var p = list[i], q = list[j], gap = p.r + q.r + 9;
      var ox = q.x - p.x, oy = q.y - p.y, od = Math.hypot(ox, oy) || 0.01;
      if (od >= gap) continue;
      var push = (gap - od) / 2, ux = ox / od, uy = oy / od;
      if (p !== drag) { p.x -= ux * push; p.y -= uy * push; }
      if (q !== drag) { q.x += ux * push; q.y += uy * push; }
    }
  }
}

function fit() {
  var list = Array.from(nodes.values());
  if (!list.length) return;
  var xs = list.map(function (n) { return n.x; }), ys = list.map(function (n) { return n.y; });
  var w = canvas.clientWidth, h = canvas.clientHeight;
  var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
  var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
  view.k = Math.min(w / Math.max(1, maxX - minX + 180), h / Math.max(1, maxY - minY + 180), 2.2);
  view.x = w / 2 - ((maxX + minX) / 2) * view.k;
  view.y = h / 2 - ((maxY + minY) / 2) * view.k;
}

function matches(node) { return !filter || node.id.toLowerCase().indexOf(filter) !== -1; }

function recomputeNeighbours() {
  neighbours = new Set();
  var focus = hovered || selected;
  if (!focus) return;
  neighbours.add(focus);
  for (var i = 0; i < edges.length; i++) {
    if (edges[i].source === focus) neighbours.add(edges[i].target);
    if (edges[i].target === focus) neighbours.add(edges[i].source);
  }
}

// Quadratic curve bowed perpendicular to the run. Straight lines between many nodes read as a
// mesh; a consistent bow keeps separate edges legible and gives the particles a path to follow.
function control(s, t) {
  var mx = (s.x + t.x) / 2, my = (s.y + t.y) / 2;
  var dx = t.x - s.x, dy = t.y - s.y, d = Math.hypot(dx, dy) || 1;
  return { x: mx + (-dy / d) * d * 0.11, y: my + (dx / d) * d * 0.11 };
}
function along(s, c, t, u) {
  var v = 1 - u;
  return { x: v * v * s.x + 2 * v * u * c.x + u * u * t.x, y: v * v * s.y + 2 * v * u * c.y + u * u * t.y };
}

function draw() {
  var w = canvas.clientWidth, h = canvas.clientHeight;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.translate(view.x, view.y);
  ctx.scale(view.k, view.k);
  var focus = hovered || selected;

  for (var i = 0; i < edges.length; i++) {
    var edge = edges[i], s = nodes.get(edge.source), t = nodes.get(edge.target);
    if (!s || !t) continue;
    var lit = focus && (edge.source === focus || edge.target === focus);
    var dim = (focus && !lit) || (filter && !(matches(s) || matches(t)));
    var c = control(s, t);
    ctx.strokeStyle = lit ? 'rgba(94,234,212,.65)' : dim ? 'rgba(60,72,96,.10)' : 'rgba(110,126,158,.20)';
    ctx.lineWidth = (lit ? 1.5 : 0.7) / view.k;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.quadraticCurveTo(c.x, c.y, t.x, t.y);
    ctx.stroke();

    // Packets run source -> target, so which way a dependency points is visible at a glance
    // instead of needing an arrowhead nobody can see at this zoom.
    if (dim) continue;
    var packets = lit ? 3 : 1;
    for (var p = 0; p < packets; p++) {
      var u = (clock * (lit ? 0.34 : 0.19) + p / packets + (i % 7) / 7) % 1;
      var at = along(s, c, t, u);
      ctx.globalAlpha = lit ? 0.95 : 0.4;
      ctx.fillStyle = lit ? '#5eead4' : 'hsl(' + hueOf(edge.source) + ' 60% 68%)';
      ctx.beginPath();
      ctx.arc(at.x, at.y, (lit ? 2 : 1.3) / view.k, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  nodes.forEach(function (node) {
    var on = matches(node), near = !focus || neighbours.has(node.id);
    var hue = hueOf(node.id);
    ctx.globalAlpha = on ? (near ? 1 : 0.22) : 0.12;
    if (node.pulse > 0) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.r + (1 - node.pulse) * 26, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(94,234,212,' + (node.pulse * 0.55) + ')';
      ctx.lineWidth = 1.5 / view.k;
      ctx.stroke();
    }
    var glow = node.id === focus || node.pulse > 0;
    if (glow) { ctx.shadowBlur = 22; ctx.shadowColor = 'rgba(94,234,212,.8)'; }
    ctx.beginPath();
    ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
    ctx.fillStyle = node.kind === 'file' ? 'hsl(' + hue + ' 42% 40%)' : 'hsl(' + hue + ' 58% 54%)';
    ctx.fill();
    ctx.shadowBlur = 0;
    if (node.id === selected) { ctx.strokeStyle = '#5eead4'; ctx.lineWidth = 2 / view.k; ctx.stroke(); }
    if (view.k > 0.4 || glow || node.r > 12) {
      ctx.globalAlpha = on ? (near ? 0.94 : 0.16) : 0.1;
      ctx.fillStyle = '#e6ebf5';
      ctx.font = Math.max(9, 11 / view.k) + 'px ui-sans-serif,system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(node.label, node.x, node.y - node.r - 5 / view.k);
    }
    ctx.globalAlpha = 1;
  });
  ctx.restore();
}

function frame() {
  clock += 1 / 60;
  if (alpha > 0.004) { step(alpha); alpha *= 0.982; }
  nodes.forEach(function (node) {
    node.r += (node.tr - node.r) * 0.12;                 // grow in rather than pop in
    if (node.pulse > 0) node.pulse = Math.max(0, node.pulse - 0.012);
  });
  draw();
  requestAnimationFrame(frame);
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
  var p = toWorld(event), found = null;
  nodes.forEach(function (node) { if (Math.hypot(node.x - p.x, node.y - p.y) <= node.r + 5) found = node; });
  return found;
}

canvas.addEventListener('mousedown', function (e) {
  var hit = pick(e);
  if (hit) { drag = hit; alpha = Math.max(alpha, 0.35); }
  else { pan = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; canvas.classList.add('drag'); }
});
addEventListener('mouseup', function () { drag = null; pan = null; canvas.classList.remove('drag'); });
addEventListener('mousemove', function (e) {
  if (pan) { view.x = pan.vx + (e.clientX - pan.x); view.y = pan.vy + (e.clientY - pan.y); return; }
  if (drag) { var p = toWorld(e); drag.x = p.x; drag.y = p.y; drag.vx = 0; drag.vy = 0; return; }
  var hit = pick(e), id = hit ? hit.id : null;
  canvas.classList.toggle('over', !!hit);
  if (id !== hovered) { hovered = id; recomputeNeighbours(); }
  if (hit) {
    var rect = canvas.getBoundingClientRect();
    tip.classList.add('on');
    tip.innerHTML = hit.id + '<span class="s">' + hit.files + ' files · ' + hit.symbols + ' symbols · ' + hit.kind + '</span>';
    tip.style.left = Math.min(e.clientX - rect.left + 14, rect.width - tip.offsetWidth - 8) + 'px';
    tip.style.top = (e.clientY - rect.top + 14) + 'px';
  } else tip.classList.remove('on');
});
canvas.addEventListener('mouseleave', function () { hovered = null; recomputeNeighbours(); tip.classList.remove('on'); });
canvas.addEventListener('wheel', function (e) {
  e.preventDefault();
  var p = toWorld(e), rect = canvas.getBoundingClientRect();
  view.k = Math.max(0.06, Math.min(7, view.k * Math.exp(-e.deltaY * 0.0015)));
  view.x = e.clientX - rect.left - p.x * view.k;
  view.y = e.clientY - rect.top - p.y * view.k;
}, { passive: false });
canvas.addEventListener('click', function (e) {
  var hit = pick(e);
  selected = hit ? hit.id : null;
  recomputeNeighbours();
  if (hit) inspect(hit.id);
});
canvas.addEventListener('dblclick', function (e) {
  var hit = pick(e);
  if (!hit || hit.kind !== 'dir') return;
  if (expand.indexOf(hit.id) === -1) expand.push(hit.id);
  load();
});

function renderCrumb() {
  var box = $('crumb');
  box.innerHTML = expand.map(function (path) { return '<button data-collapse="' + path + '">' + path + ' &#10005;</button>'; }).join('');
  Array.prototype.forEach.call(box.querySelectorAll('[data-collapse]'), function (button) {
    button.onclick = function () {
      var path = button.dataset.collapse;
      expand = expand.filter(function (p) { return p !== path && p.indexOf(path + '/') !== 0; });
      load();
    };
  });
}

function inspect(id) {
  return fetch('/api/node?id=' + encodeURIComponent(id)).then(function (r) { return r.json(); }).then(function (data) {
    var list = function (items, empty) {
      if (!items.length) return '<div class="hint">' + empty + '</div>';
      return items.map(function (d) { return '<div class="dep" data-goto="' + d.target + '"><span>' + d.target + '</span><b>' + d.weight + '</b></div>'; }).join('');
    };
    $('detail').innerHTML =
      '<h2>Selected</h2><div class="mono" style="word-break:break-all;color:var(--accent)">' + id + '</div>' +
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

// Clicking a dependency in the panel flies to it on the canvas, so the graph and the detail view
// drive each other instead of being two separate readings of the same index.
$('detail').addEventListener('click', function (e) {
  var row = e.target.closest ? e.target.closest('[data-goto]') : null;
  if (!row) return;
  var target = row.dataset.goto, node = nodes.get(target);
  if (!node) node = nodes.get(target.split('/').slice(0, -1).join('/'));
  if (!node) return;
  selected = node.id;
  recomputeNeighbours();
  inspect(node.id);
  view.x = canvas.clientWidth / 2 - node.x * view.k;
  view.y = canvas.clientHeight / 2 - node.y * view.k;
});

var events = new EventSource('/events');
events.onopen = function () { $('dot').classList.add('on'); $('livetext').textContent = 'live'; };
events.onerror = function () { $('dot').classList.remove('on'); $('livetext').textContent = 'reconnecting'; };
events.addEventListener('change', function () {
  // Light the graph up when the repo moves underneath it, which is the point of watching it.
  $('dot').classList.remove('beat');
  void $('dot').offsetWidth;
  $('dot').classList.add('beat');
  nodes.forEach(function (node) { node.pulse = 1; });
  loadState();
  load();
});

$('q').oninput = function (e) { filter = e.target.value.trim().toLowerCase(); };
$('ext').onchange = load;
$('iso').onchange = load;
$('depth').onchange = function () { expand = []; load(); };
$('reset').onclick = function () {
  expand = []; selected = null; hovered = null; recomputeNeighbours();
  load().then(function () { var settle = 0; var relax = setInterval(function () { step(0.6); if (++settle > 60) { clearInterval(relax); alpha = 0.1; fit(); } }, 8); });
};
addEventListener('resize', function () { resize(); fit(); });

resize();
loadState();
load();
requestAnimationFrame(frame);
</script></body></html>
`;
}
