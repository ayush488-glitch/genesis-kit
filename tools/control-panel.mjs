// The served control panel. A pure data -> string function, like dashboard.mjs, so it stays testable
// and has no build step. Data arrives from serve.mjs over fetch; changes arrive over SSE.
export function controlPanelPage({ project }) {
  const escape = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(project)} · Genesis</title><style>
:root{--bg:#0b0e14;--panel:#11151f;--line:#1e2534;--ink:#e6ebf5;--dim:#8b96ad;--faint:#5a6478;--accent:#5eead4;--warn:#fbbf24;--bad:#f87171}
*{box-sizing:border-box}
body{margin:0;height:100vh;overflow:hidden;background:var(--bg);color:var(--ink);font:13px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;display:grid;grid-template-columns:260px 1fr 340px;grid-template-rows:44px 1fr}
header{grid-column:1/-1;display:flex;align-items:center;gap:14px;padding:0 14px;border-bottom:1px solid var(--line);background:var(--panel)}
header h1{font-size:13px;font-weight:600;margin:0;letter-spacing:.02em}
header .sep{flex:1}
.tag{font:11px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dim);border:1px solid var(--line);border-radius:5px;padding:2px 7px}
#live{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dim)}
#dot{width:7px;height:7px;border-radius:50%;background:var(--faint);transition:background .3s}
#dot.on{background:var(--accent);box-shadow:0 0 8px var(--accent)}
aside{border-right:1px solid var(--line);background:var(--panel);overflow-y:auto;padding:12px}
#detail{border-right:none;border-left:1px solid var(--line)}
main{position:relative;overflow:hidden}
canvas{display:block;width:100%;height:100%;cursor:grab}
canvas.drag{cursor:grabbing}
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
.crumb{display:flex;flex-wrap:wrap;gap:4px;position:absolute;top:10px;left:10px;z-index:2}
.crumb button,.ctl button,.ctl label{background:rgba(17,21,31,.9);border:1px solid var(--line);color:var(--dim);border-radius:5px;padding:3px 8px;font-size:11px;cursor:pointer;font-family:inherit}
.crumb button:hover,.ctl button:hover{color:var(--ink);border-color:var(--faint)}
.ctl{position:absolute;top:10px;right:10px;z-index:2;display:flex;gap:6px;align-items:center}
.ctl input[type=search]{background:rgba(17,21,31,.9);border:1px solid var(--line);color:var(--ink);border-radius:5px;padding:3px 8px;font:11px inherit;width:150px}
.ctl label{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.ctl select{background:rgba(17,21,31,.9);border:1px solid var(--line);color:var(--dim);border-radius:5px;padding:3px 6px;font:11px inherit}
#empty{position:absolute;inset:0;display:grid;place-content:center;text-align:center;color:var(--faint);font-size:12px;line-height:1.7}
.sym{display:flex;gap:7px;padding:2px 0;font-family:ui-monospace,Menlo,monospace;font-size:11px}
.sym .k{color:var(--faint);width:62px;flex:none}
.sym .n{color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dep{display:flex;justify-content:space-between;gap:8px;font-family:ui-monospace,Menlo,monospace;font-size:11px;padding:2px 0;color:var(--dim)}
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
  <div id="empty" hidden></div>
</main>

<aside id="detail"><div class="hint">Click a node to inspect it.<br>Double-click a directory to expand it.</div></aside>

<script>
const $ = (id) => document.getElementById(id);
const canvas = $('c'), ctx = canvas.getContext('2d');
let graph = { nodes: [], edges: [] }, sim = [], view = { x: 0, y: 0, k: 1 }, expand = [], selected = null, filter = '';

// Deterministic seeding: no Math.random anywhere, so the same index always draws the same way
// and a reindex does not reshuffle a layout someone is reading.
const hueOf = (id) => { let h = 0; for (const ch of id.split('/')[0]) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };

async function load() {
  const params = new URLSearchParams({ depth: $('depth').value, expand: expand.join(','), externals: $('ext').checked ? '1' : '0', isolated: $('iso').checked ? '1' : '0' });
  const data = await fetch('/api/graph?' + params).then((r) => r.json());
  graph = data;
  $('rev').textContent = data.meta.revision ? data.meta.revision.slice(0, 8) : 'no revision';
  $('scale').textContent = data.meta.missing ? 'no index' : data.meta.totalFiles + ' files · ' + data.meta.totalEdges + ' edges';
  $('empty').hidden = !data.meta.missing;
  if (data.meta.missing) $('empty').innerHTML = 'No index yet.<br>Run <code>genesis index &lt;repo&gt;</code> to build one.';
  layout();
  draw();
  renderCrumb();
}

// O(n^2) repulsion. Fine at the few hundred nodes an aggregated view produces; if a view ever
// ships thousands, this is the thing to replace with a quadtree.
// ponytail: naive n-body, swap for Barnes-Hut only if an aggregated view exceeds ~800 nodes.
function layout() {
  const n = graph.nodes.length;
  const index = new Map(graph.nodes.map((node, i) => [node.id, i]));
  // Log-scaled radius: a directory with 2,800 files is not 50x the area of one with 50, and drawing
  // it that way turns the hub into a blob that swallows its neighbours.
  sim = graph.nodes.map((node, i) => {
    const angle = (i / Math.max(1, n)) * Math.PI * 2, radius = 120 + (i % 7) * 45;
    return { ...node, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, vx: 0, vy: 0, r: Math.min(34, 4 + Math.log2(1 + (node.files || 1)) * 3) };
  });
  const links = graph.edges.map((e) => ({ s: index.get(e.source), t: index.get(e.target), w: e.weight })).filter((l) => l.s !== undefined && l.t !== undefined);
  for (let step = 0; step < 260; step++) {
    const cool = 1 - step / 260;
    for (let i = 0; i < n; i++) {
      const a = sim[i];
      for (let j = i + 1; j < n; j++) {
        const b = sim[j];
        let dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy || 0.01;
        if (d2 > 360000) continue;
        // Scale repulsion by the pair's radii so large nodes clear room proportional to their size.
        const force = (2600 + 90 * (a.r + b.r)) / d2, d = Math.sqrt(d2);
        const fx = (dx / d) * force, fy = (dy / d) * force;
        a.vx -= fx; a.vy -= fy; b.vx += fx; b.vy += fy;
      }
    }
    for (const link of links) {
      const a = sim[link.s], b = sim[link.t];
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.01;
      const rest = 90 + 130 / (1 + link.w);
      const force = (d - rest) * 0.012 * Math.min(3, Math.log2(1 + link.w) + 1);
      const fx = (dx / d) * force, fy = (dy / d) * force;
      a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
    }
    for (const node of sim) {
      node.vx -= node.x * 0.0016; node.vy -= node.y * 0.0016;
      node.x += node.vx * cool; node.y += node.vy * cool;
      node.vx *= 0.82; node.vy *= 0.82;
    }
  }
  // Hard separation: springs alone still let discs overlap, and an overlapped node is unclickable.
  for (let pass = 0; pass < 12; pass++) {
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = sim[i], b = sim[j], gap = a.r + b.r + 8;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.01;
      if (d >= gap) continue;
      const push = (gap - d) / 2, ux = dx / d, uy = dy / d;
      a.x -= ux * push; a.y -= uy * push; b.x += ux * push; b.y += uy * push;
    }
  }
  fit();
}

function fit() {
  if (!sim.length) return;
  const xs = sim.map((n) => n.x), ys = sim.map((n) => n.y);
  const w = canvas.width / devicePixelRatio, h = canvas.height / devicePixelRatio;
  const spanX = Math.max(1, Math.max(...xs) - Math.min(...xs)), spanY = Math.max(1, Math.max(...ys) - Math.min(...ys));
  view.k = Math.min(w / (spanX + 160), h / (spanY + 160), 2.2);
  view.x = w / 2 - ((Math.max(...xs) + Math.min(...xs)) / 2) * view.k;
  view.y = h / 2 - ((Math.max(...ys) + Math.min(...ys)) / 2) * view.k;
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * devicePixelRatio; canvas.height = rect.height * devicePixelRatio;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  draw();
}

const matches = (node) => !filter || node.id.toLowerCase().includes(filter);

function draw() {
  const w = canvas.width / devicePixelRatio, h = canvas.height / devicePixelRatio;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.translate(view.x, view.y); ctx.scale(view.k, view.k);
  const at = new Map(sim.map((n) => [n.id, n]));

  for (const edge of graph.edges) {
    const a = at.get(edge.source), b = at.get(edge.target);
    if (!a || !b) continue;
    const lit = selected && (edge.source === selected || edge.target === selected);
    const dim = filter && !(matches(a) || matches(b));
    ctx.strokeStyle = lit ? 'rgba(94,234,212,.55)' : dim ? 'rgba(30,37,52,.35)' : 'rgba(90,100,120,.22)';
    ctx.lineWidth = (lit ? 1.4 : 0.7) / view.k;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  for (const node of sim) {
    const hue = hueOf(node.id), on = matches(node), isSelected = node.id === selected;
    ctx.globalAlpha = on ? 1 : 0.18;
    ctx.beginPath(); ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
    ctx.fillStyle = node.kind === 'file' ? \`hsl(\${hue} 45% 42%)\` : \`hsl(\${hue} 58% 55%)\`;
    ctx.fill();
    if (isSelected) { ctx.strokeStyle = '#5eead4'; ctx.lineWidth = 2 / view.k; ctx.stroke(); }
    if (view.k > 0.42 || isSelected || node.r > 11) {
      ctx.globalAlpha = on ? 0.92 : 0.15;
      ctx.fillStyle = '#e6ebf5';
      ctx.font = \`\${Math.max(9, 11 / view.k)}px ui-sans-serif,system-ui\`;
      ctx.textAlign = 'center';
      ctx.fillText(node.label, node.x, node.y - node.r - 4 / view.k);
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

const toWorld = (event) => { const rect = canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left - view.x) / view.k, y: (event.clientY - rect.top - view.y) / view.k }; };
const pick = (event) => { const p = toWorld(event); return sim.find((n) => Math.hypot(n.x - p.x, n.y - p.y) <= n.r + 4); };

let dragging = null;
canvas.addEventListener('mousedown', (e) => { dragging = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; canvas.classList.add('drag'); });
addEventListener('mouseup', () => { dragging = null; canvas.classList.remove('drag'); });
addEventListener('mousemove', (e) => { if (!dragging) return; view.x = dragging.vx + (e.clientX - dragging.x); view.y = dragging.vy + (e.clientY - dragging.y); draw(); });
canvas.addEventListener('wheel', (e) => { e.preventDefault(); const p = toWorld(e), factor = Math.exp(-e.deltaY * 0.0015); view.k = Math.max(0.08, Math.min(6, view.k * factor)); const rect = canvas.getBoundingClientRect(); view.x = e.clientX - rect.left - p.x * view.k; view.y = e.clientY - rect.top - p.y * view.k; draw(); }, { passive: false });
canvas.addEventListener('click', (e) => { const hit = pick(e); selected = hit ? hit.id : null; draw(); if (hit) inspect(hit.id); });
canvas.addEventListener('dblclick', (e) => { const hit = pick(e); if (!hit || hit.kind !== 'dir') return; if (!expand.includes(hit.id)) expand.push(hit.id); load(); });

function renderCrumb() {
  $('crumb').innerHTML = expand.length ? expand.map((path) => \`<button data-collapse="\${path}">\${path} ✕</button>\`).join('') : '';
  for (const button of $('crumb').querySelectorAll('[data-collapse]')) button.onclick = () => { const path = button.dataset.collapse; expand = expand.filter((p) => p !== path && !p.startsWith(path + '/')); load(); };
}

async function inspect(id) {
  const data = await fetch('/api/node?id=' + encodeURIComponent(id)).then((r) => r.json());
  const list = (items, empty) => items.length ? items.map((d) => \`<div class="dep"><span>\${d.target}</span><b>\${d.weight}</b></div>\`).join('') : \`<div class="hint">\${empty}</div>\`;
  $('detail').innerHTML = \`
    <h2>Selected</h2><div class="mono" style="word-break:break-all;color:var(--accent)">\${id}</div>
    <div class="row"><span>files</span><b>\${data.files}</b></div>
    <div class="row"><span>symbols</span><b>\${data.symbolCount}</b></div>
    <h2>Depends on</h2>\${list(data.dependsOn, 'Nothing outside itself.')}
    <h2>Depended on by</h2>\${list(data.dependedOnBy, 'Nothing imports this.')}
    <h2>Symbols\${data.symbolCount > data.symbols.length ? \` (first \${data.symbols.length})\` : ''}</h2>
    \${data.symbols.map((s) => \`<div class="sym"><span class="k">\${s.kind}</span><span class="n" title="\${s.path}:\${s.line}">\${s.name}</span></div>\`).join('') || '<div class="hint">No symbols extracted here.</div>'}\`;
}

async function loadState() {
  const data = await fetch('/api/summary').then((r) => r.json());
  if (data.missing) { $('state').innerHTML = '<div class="hint">No project.json.</div>'; return; }
  const life = data.lifecycle || {};
  $('state').innerHTML = \`
    <h2>Lifecycle</h2>
    <div class="row"><span>phase</span><b>\${life.phase || '—'}</b></div>
    <div class="row"><span>status</span><b>\${life.status || '—'}</b></div>
    <div class="row"><span>active</span><b class="mono">\${life.active_task || '—'}</b></div>
    \${life.next_action ? \`<h2>Next action</h2><div class="hint">\${life.next_action}</div>\` : ''}
    \${life.blocker ? \`<h2>Blocker</h2><div class="hint" style="color:var(--bad)">\${life.blocker}</div>\` : ''}
    <h2>Tasks</h2>
    \${(data.tasks || []).map((t) => \`<div class="task"><div class="id">\${t.id} <span class="pill \${t.state}">\${t.state}</span></div><div class="out">\${t.outcome || ''}</div></div>\`).join('') || '<div class="hint">No tasks yet.</div>'}
    <h2>Ledger</h2>
    \${Object.entries(data.counts || {}).map(([k, v]) => \`<div class="row"><span>\${k}</span><b>\${v}</b></div>\`).join('')}\`;
}

const events = new EventSource('/events');
events.onopen = () => { $('dot').classList.add('on'); $('livetext').textContent = 'live'; };
events.onerror = () => { $('dot').classList.remove('on'); $('livetext').textContent = 'reconnecting'; };
events.addEventListener('change', () => { loadState(); load(); });

$('q').oninput = (e) => { filter = e.target.value.trim().toLowerCase(); draw(); };
$('ext').onchange = load;
$('iso').onchange = load;
$('depth').onchange = () => { expand = []; load(); };
$('reset').onclick = () => { expand = []; selected = null; load(); };
addEventListener('resize', resize);
resize(); loadState(); load();
</script></body></html>
`;
}
