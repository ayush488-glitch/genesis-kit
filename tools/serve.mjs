#!/usr/bin/env node
// Loopback-only control panel server. Read-only: it never writes state and never runs commands.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, watch } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { controlPanelPage } from './control-panel.mjs';
import { boundary, indexGraph } from './query.mjs';

const argv = process.argv.slice(2);
const VALUED = new Set(['--port']);
const watching = !argv.includes('--no-watch');
const flag = (name, fallback) => { const index = argv.indexOf(name); return index === -1 ? fallback : argv[index + 1]; };
const repo = resolve(argv.find((arg, index) => !arg.startsWith('--') && !VALUED.has(argv[index - 1])) || '.');
const genesis = join(repo, '.genesis');
const graphPath = join(genesis, 'index', 'graph.json');
const statePath = join(genesis, 'project.json');
if (!existsSync(statePath)) { console.error(`no Genesis project at ${repo}; run: node genesis.mjs init ${repo}`); process.exit(1); }

// Reread on demand, but only when the file actually changed, so a browser poll cannot cost a 13MB parse.
const cache = new Map();
const stamp = (path) => { try { const { mtimeMs, size } = statSync(path); return `${mtimeMs}:${size}`; } catch { return null; } };
function readCached(path) {
  const current = stamp(path);
  if (current === null) return null;
  const hit = cache.get(path);
  if (hit && hit.stamp === current) return hit.value;
  let value = null;
  try { value = JSON.parse(readFileSync(path, 'utf8')); } catch { value = null; }
  cache.set(path, { stamp: current, value });
  return value;
}

// --- graph aggregation -------------------------------------------------------
// A directory graph, not a file graph: 12k file nodes cannot be laid out or read, ~200 directory
// nodes can. Expanding a directory replaces it with its children one level down.
function groupOf(path, expanded, depth) {
  const parts = path.split('/');
  let take = depth;
  for (const prefix of expanded) if (path === prefix || path.startsWith(`${prefix}/`)) take = Math.max(take, prefix.split('/').length + 1);
  // Label with the parent too: at any depth most leaves are called src, tests or lib, and a
  // screen full of nodes all labelled "src" tells you nothing.
  if (take >= parts.length) return { id: path, label: parts.slice(-2).join('/'), kind: 'file' };
  return { id: parts.slice(0, take).join('/'), label: parts.slice(Math.max(0, take - 2), take).join('/'), kind: 'dir' };
}

function aggregate({ depth = 1, expand = [], externals = false, isolated = false } = {}) {
  const graph = readCached(graphPath);
  if (!graph) return { nodes: [], edges: [], meta: { missing: true } };
  const fileGroup = new Map(), nodes = new Map(), symbolCount = new Map();
  for (const node of graph.nodes) {
    if (node.type !== 'file') continue;
    const group = groupOf(node.path, expand, depth);
    fileGroup.set(node.id, group.id);
    const existing = nodes.get(group.id) || { ...group, files: 0, symbols: 0, language: node.language };
    existing.files += 1;
    nodes.set(group.id, existing);
  }
  for (const edge of graph.edges) if (edge.type === 'defines') symbolCount.set(edge.source, (symbolCount.get(edge.source) || 0) + 1);
  for (const [fileId, count] of symbolCount) { const group = nodes.get(fileGroup.get(fileId)); if (group) group.symbols += count; }

  const edges = new Map();
  for (const edge of graph.edges) {
    if (edge.type !== 'imports') continue;
    const source = fileGroup.get(edge.source);
    if (!source) continue;
    let target = fileGroup.get(edge.target);
    if (!target) {
      if (!externals) continue;
      const external = indexed(graph).byId.get(edge.target);
      if (!external || external.type === 'unresolved') continue;
      target = external.id;
      if (!nodes.has(target)) nodes.set(target, { id: target, label: external.label, kind: external.type, files: 0, symbols: 0 });
    }
    if (source === target) continue;
    const key = `${source}\u0000${target}`;
    const hit = edges.get(key);
    if (hit) hit.weight += 1; else edges.set(key, { source, target, weight: 1 });
  }
  // A lone file with no dependency edge is a stray config (eslint, tailwind, postcss); a hundred of
  // them drown the graph. Only files are dropped, never directories: a directory with no external
  // edge is still real structure, and dropping it would blank a repo whose imports are all internal.
  if (!isolated) {
    const connected = new Set();
    for (const edge of edges.values()) { connected.add(edge.source); connected.add(edge.target); }
    for (const [id, node] of [...nodes]) if (node.kind === 'file' && !connected.has(id)) nodes.delete(id);
  }
  // Deterministic order so the same index always lays out the same way.
  const sortedNodes = [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
  const sortedEdges = [...edges.values()].sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target));
  return { nodes: sortedNodes, edges: sortedEdges, meta: { depth, expand, externals, isolated, revision: graph.revision, sourceHash: graph.sourceHash, totalFiles: fileGroup.size, totalEdges: graph.edges.length } };
}

// Scope description comes from the query layer, so the panel and the context packet cannot
// disagree about what a directory depends on.
function detail(id) {
  const graph = readCached(graphPath);
  if (!graph) return { id, missing: true };
  const inside = (path) => path === id || path.startsWith(`${id}/`);
  const edge = boundary(indexed(graph), id);
  const symbols = graph.nodes.filter((node) => node.type === 'symbol' && inside(node.path)).map(({ name, kind, path, line }) => ({ name, kind, path, line }));
  return {
    id,
    files: edge.files,
    symbolCount: edge.symbolCount,
    symbols: symbols.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line).slice(0, 200),
    dependsOn: edge.dependsOn,
    dependedOnBy: edge.dependedOnBy,
  };
}

// The map view needs every symbol and every symbol-level edge, which the aggregated graph
// deliberately hides. Sent as parallel arrays with numeric edge endpoints: the same payload
// shaped as objects with string ids is several times larger for no extra information.
// The panel keeps its own parsed copy; give the query helpers the adjacency they expect.
const indexed = (graph) => (graph.byId ? graph : indexGraph(graph));
const KIND_CODE = { calls: 0, inherits: 1 };
function map() {
  const graph = readCached(graphPath);
  if (!graph) return { files: [], edges: [], missing: true };
  const symbolsByFile = new Map();
  for (const node of graph.nodes) {
    if (node.type !== 'symbol') continue;
    if (!symbolsByFile.has(node.path)) symbolsByFile.set(node.path, []);
    symbolsByFile.get(node.path).push(node);
  }
  const paths = [...symbolsByFile.keys()].sort();
  const index = new Map();
  const files = [];
  let running = 0;
  for (const path of paths) {
    const symbols = symbolsByFile.get(path).sort((a, b) => a.line - b.line || a.id.localeCompare(b.id));
    for (const symbol of symbols) index.set(symbol.id, running++);
    files.push({ path, symbols: symbols.map((s) => ({ n: s.name, k: s.kind, l: s.line })) });
  }
  const edges = [];
  let calls = 0, candidates = 0, inherits = 0;
  for (const edge of graph.edges) {
    const code = KIND_CODE[edge.type];
    if (code === undefined) continue;
    const from = index.get(edge.source), to = index.get(edge.target);
    if (from === undefined || to === undefined || from === to) continue;
    const ambiguous = edge.tier === 'ambiguous' ? 1 : 0;
    if (edge.type === 'inherits') inherits += 1; else if (ambiguous) candidates += 1; else calls += 1;
    edges.push([from, to, code, ambiguous]);
  }
  return { files, edges, stats: { symbols: running, files: files.length, calls, candidates, inherits, unresolvedCalls: (graph.stats || {}).unresolvedCalls || 0 }, revision: graph.revision };
}

function summary() {
  const state = readCached(statePath);
  if (!state) return { missing: true };
  const tasks = (state.tasks || []).map(({ id, outcome, state: taskState, risk, requirements }) => ({ id, outcome, state: taskState, risk, requirements }));
  return { project: state.project, lifecycle: state.lifecycle, workflow: state.workflow, tasks, counts: { decisions: (state.decisions || []).length, knowledge: (state.knowledge || []).length, invariants: (state.invariants || []).length, attempts: (state.attempts || []).length } };
}

// --- server ------------------------------------------------------------------
const clients = new Set();
const json = (response, body) => { const payload = JSON.stringify(body); response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(payload) }); response.end(payload); };

const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (request.method !== 'GET') { response.writeHead(405).end(); return; }
  if (url.pathname === '/') { const page = controlPanelPage({ project: readCached(statePath)?.project?.name || 'genesis' }); response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); response.end(page); return; }
  if (url.pathname === '/api/summary') return json(response, summary());
  if (url.pathname === '/api/graph') return json(response, aggregate({
    depth: Math.max(1, Math.min(8, Number(url.searchParams.get('depth')) || 1)),
    expand: (url.searchParams.get('expand') || '').split(',').filter(Boolean),
    externals: url.searchParams.get('externals') === '1',
    isolated: url.searchParams.get('isolated') === '1',
  }));
  if (url.pathname === '/api/map') return json(response, map());
  if (url.pathname === '/api/node') return json(response, detail(url.searchParams.get('id') || ''));
  if (url.pathname === '/events') {
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    response.write(': connected\n\n');
    clients.add(response);
    request.on('close', () => clients.delete(response));
    return;
  }
  response.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
});

// Real liveness: the state file itself is the event source, so an agent working in the terminal
// updates the panel without anyone reloading. Debounced because a save touches several files.
const push = (event, data) => { for (const client of clients) client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
let pending = null;
try {
  watch(genesis, { recursive: true }, (_event, name) => {
    if (name && /(^|\/)(local|evidence)\//.test(name)) return;
    if (name && /(^|\/)index\/cache\.json$/.test(name)) return;   // extraction cache, not graph content
    clearTimeout(pending);
    pending = setTimeout(() => push('change', { at: new Date().toISOString() }), 150);
  });
} catch (error) { console.error(`file watching unavailable, the panel will not update on its own: ${error.message}`); }

// Source watching: edit code, the index rebuilds, the graph follows. Reindexing is incremental,
// so only the files whose size or mtime moved are re-read.
const SKIP = /(^|\/)(\.git|\.genesis|node_modules|dist|build|out|target|coverage|\.next|\.turbo|\.venv|venv|__pycache__)(\/|$)/;
const CODE_FILE = /\.(?:m?[jt]sx?|cjs|py)$/;
// Reindex through the CLI rather than the graphizer directly: `genesis index` runs inside the
// repository write lock, so a save cannot race a command that is already mutating state.
const indexer = join(dirname(fileURLToPath(import.meta.url)), 'genesis.mjs');
let indexing = false, again = false, debounce = null;
function reindex() {
  if (indexing) { again = true; return; }
  indexing = true;
  push('indexing', { state: 'start' });
  const started = Date.now();
  const child = spawn(process.execPath, [indexer, 'index', repo], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('exit', (code) => {
    indexing = false;
    push('indexing', { state: 'done', ms: Date.now() - started, ok: code === 0 });
    if (code !== 0) console.error(`reindex failed: ${stderr.trim().slice(0, 300)}`);
    // A save that landed mid-run is not lost; it is coalesced into one follow-up pass.
    if (again) { again = false; reindex(); }
  });
}
if (watching) {
  try {
    watch(repo, { recursive: true }, (_event, name) => {
      if (!name || SKIP.test(name) || !CODE_FILE.test(name)) return;
      clearTimeout(debounce);
      debounce = setTimeout(reindex, 400);
    });
  } catch (error) { console.error(`source watching unavailable: ${error.message}`); }
}

const port = Number(flag('--port', 0)) || 0;
server.on('error', (error) => {
  console.error(error.code === 'EADDRINUSE'
    ? `port ${port} is already in use; pass a different --port, or omit it to let the OS choose`
    : `control panel could not start: ${error.message}`);
  process.exit(1);
});
server.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}`;
  console.log(`Genesis control panel: ${url}`);
  console.log(watching ? 'Watching sources: edits reindex incrementally. Approvals and gates stay in the CLI.' : 'Read-only, not watching sources. Approvals and gates stay in the CLI.');
  if (argv.includes('--open')) { const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open'; spawnSync(opener, [url], { stdio: 'ignore' }); }
});
