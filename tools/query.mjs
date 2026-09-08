#!/usr/bin/env node
// Ask the code index questions. Read-only, dependency-free, importable so the MCP surface and the
// context packet can reuse exactly the same answers the CLI gives.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const cache = new Map();
// Adjacency, added once so every helper can assume it. Exported because the panel parses the
// graph itself and still needs the same shape.
export function indexGraph(graph) {
  graph.byId = new Map(graph.nodes.map((node) => [node.id, node]));
  graph.out = new Map();
  graph.in = new Map();
  for (const edge of graph.edges) {
    if (!graph.out.has(edge.source)) graph.out.set(edge.source, []);
    if (!graph.in.has(edge.target)) graph.in.set(edge.target, []);
    graph.out.get(edge.source).push(edge);
    graph.in.get(edge.target).push(edge);
  }
  return graph;
}

export function loadGraph(repo) {
  const path = join(resolve(repo), '.genesis', 'index', 'graph.json');
  if (!existsSync(path)) throw new Error(`no index at ${path}; run: genesis index ${repo}`);
  const { mtimeMs, size } = statSync(path), stamp = `${mtimeMs}:${size}`;
  const hit = cache.get(path);
  if (hit && hit.stamp === stamp) return hit.graph;
  const graph = indexGraph(JSON.parse(readFileSync(path, 'utf8')));
  cache.set(path, { stamp, graph });
  return graph;
}

const symbolName = (id) => { const cut = id.lastIndexOf(':'); return cut === -1 ? id : id.slice(cut + 1); };
// Never returns undefined: callers spread this into a row, and a row without an id or name
// crashes the printer and silently strips identity from --json.
export const describe = (node, id) => !node
  ? { id: id ?? null, kind: 'missing', name: id ?? '(unknown)', path: null }
  : node.type === 'symbol'
    ? { id: node.id, kind: node.kind, name: node.name, path: node.path, line: node.line }
    : { id: node.id, kind: node.type, name: node.label, path: node.path };

// A reference can be an exact node id, a file path, a bare symbol name, or "path#name". Ambiguity
// is reported rather than resolved silently, because picking one of several same-named symbols is
// exactly the guess the index refuses to make elsewhere.
export function resolveRef(graph, ref) {
  if (graph.byId.has(ref)) return [graph.byId.get(ref)];
  const file = graph.byId.get(`file:${ref}`);
  if (file) return [file];
  const [head, tail] = ref.includes('#') ? ref.split('#') : [null, ref];
  const matches = graph.nodes.filter((node) => {
    if (node.type === 'symbol') return node.name === tail && (!head || node.path === head || node.path.endsWith(`/${head}`));
    if (node.type === 'file' && !head) return node.path === tail || node.path.endsWith(`/${tail}`);
    return false;
  });
  if (matches.length) return matches;
  return graph.nodes.filter((node) => node.type === 'symbol' && symbolName(node.id).toLowerCase() === tail.toLowerCase());
}

function edgesOf(graph, node, direction, kinds) {
  const list = (direction === 'in' ? graph.in : graph.out).get(node.id) || [];
  return kinds ? list.filter((edge) => kinds.includes(edge.type)) : list;
}

export function callers(graph, node, { limit = 50 } = {}) {
  return edgesOf(graph, node, 'in', ['calls']).slice(0, limit).map((edge) => ({
    ...describe(graph.byId.get(edge.source), edge.source), tier: edge.tier, confidence: edge.confidence,
    ...(edge.candidates ? { candidates: edge.candidates } : {}),
  }));
}
export function callees(graph, node, { limit = 50 } = {}) {
  return edgesOf(graph, node, 'out', ['calls']).slice(0, limit).map((edge) => ({
    ...describe(graph.byId.get(edge.target), edge.target), tier: edge.tier, confidence: edge.confidence,
    ...(edge.candidates ? { candidates: edge.candidates } : {}),
  }));
}
export function defines(graph, rawPrefix, { limit = 200 } = {}) {
  const prefix = String(rawPrefix || '').replace(/\/+$/, '');
  const inside = (path) => path === prefix || path.startsWith(`${prefix}/`);
  return graph.nodes.filter((node) => node.type === 'symbol' && node.path && inside(node.path))
    .sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line).slice(0, limit).map(describe);
}

// Blast radius: everything that transitively reaches this file through imports. This is the
// question worth asking before an edit, and the one a grep cannot answer.
export function impact(graph, node, { hops = 6, limit = 200 } = {}) {
  const seen = new Map([[node.id, 0]]);
  let frontier = [node.id];
  for (let hop = 1; hop <= hops && frontier.length; hop++) {
    const next = [];
    for (const id of frontier) for (const edge of (graph.in.get(id) || [])) {
      if (edge.type !== 'imports' || seen.has(edge.source)) continue;
      seen.set(edge.source, hop);
      next.push(edge.source);
    }
    frontier = next;
  }
  seen.delete(node.id);
  return [...seen].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).slice(0, limit)
    .map(([id, distance]) => ({ ...describe(graph.byId.get(id), id), distance }));
}

// What crosses the boundary of a file or directory. Used by the control panel's detail view and
// by the context packet's scope cards, so both describe a scope the same way.
export function boundary(graph, rawPrefix, { limit = 20 } = {}) {
  // Tolerate a trailing slash: shell completion supplies one, and silently returning nothing for
  // "src/" when "src" works is the kind of wart that reads as a broken tool.
  const prefix = String(rawPrefix || '').replace(/\/+$/, '');
  const inside = (path) => path === prefix || path.startsWith(`${prefix}/`);
  const files = graph.nodes.filter((node) => node.type === 'file' && inside(node.path));
  const ids = new Set(files.map((node) => node.id));
  const symbolCount = graph.nodes.filter((node) => node.type === 'symbol' && node.path && inside(node.path)).length;
  const label = (id) => id.replace(/^file:/, '');
  const dependsOn = new Map(), dependedOnBy = new Map();
  for (const edge of graph.edges) {
    if (edge.type !== 'imports') continue;
    if (ids.has(edge.source) && !ids.has(edge.target)) dependsOn.set(label(edge.target), (dependsOn.get(label(edge.target)) || 0) + 1);
    if (ids.has(edge.target) && !ids.has(edge.source)) dependedOnBy.set(label(edge.source), (dependedOnBy.get(label(edge.source)) || 0) + 1);
  }
  const top = (counted) => [...counted.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([target, weight]) => ({ target, weight }));
  return { prefix, files: files.length, symbolCount, dependsOn: top(dependsOn), dependedOnBy: top(dependedOnBy) };
}

// Resolve the names a task text mentions against the index, before the agent starts reading.
// Weighted the way evidence actually differs: a file path in a traceback is worth more than a
// quoted string, which is worth more than a bare identifier that merely looks like a symbol.
const NOISE = new Set(['this', 'that', 'with', 'from', 'when', 'then', 'should', 'return', 'true', 'false', 'null', 'undefined', 'error', 'value', 'result', 'data', 'test', 'tests', 'const', 'function', 'class', 'async', 'await', 'string', 'number', 'object', 'array']);
export function symptoms(graph, text, { limit = 12 } = {}) {
  if (!text) return [];
  const weights = new Map();
  const bump = (name, weight, because) => {
    const hit = weights.get(name);
    if (!hit || hit.weight < weight) weights.set(name, { weight, because });
  };
  for (const match of text.matchAll(/[\w./-]+\.(?:m?[jt]sx?|cjs|py)(?::(\d+))?/g)) bump(match[0].split(':')[0], 3, 'named a file');
  for (const match of text.matchAll(/["'`]([^"'`\n]{2,60})["'`]/g)) bump(match[1].trim(), 2, 'quoted');
  for (const match of text.matchAll(/\b([A-Za-z_$][\w$]{3,})\b/g)) { const word = match[1]; if (!NOISE.has(word.toLowerCase())) bump(word, 1, 'named a symbol'); }

  const sites = [];
  for (const [name, { weight, because }] of weights) {
    if (weight === 3) {
      for (const node of graph.nodes) if (node.type === 'file' && (node.path === name || node.path.endsWith(`/${name}`))) sites.push({ ...describe(node), weight, because });
      continue;
    }
    for (const node of graph.nodes) if (node.type === 'symbol' && node.name === name) sites.push({ ...describe(node), weight, because });
  }
  return sites.sort((a, b) => b.weight - a.weight || (a.path || '').localeCompare(b.path || '')).slice(0, limit);
}

export function neighbours(graph, node, { hops = 1, limit = 100, kinds = null } = {}) {
  const seen = new Map([[node.id, 0]]);
  let frontier = [node.id];
  for (let hop = 1; hop <= hops && frontier.length; hop++) {
    const next = [];
    for (const id of frontier) {
      const around = [...(graph.out.get(id) || []).map((e) => [e, e.target]), ...(graph.in.get(id) || []).map((e) => [e, e.source])];
      for (const [edge, other] of around) {
        if (kinds && !kinds.includes(edge.type)) continue;
        if (seen.has(other)) continue;
        seen.set(other, hop);
        next.push(other);
      }
    }
    frontier = next;
  }
  seen.delete(node.id);
  return [...seen].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).slice(0, limit)
    .map(([id, distance]) => ({ ...describe(graph.byId.get(id), id), distance }));
}

// Shortest dependency path, following edge direction. Returns the edges too, so the answer can be
// checked rather than taken on trust.
export function path(graph, from, to, { hops = 8 } = {}) {
  const previous = new Map([[from.id, null]]);
  let frontier = [from.id];
  for (let hop = 0; hop < hops && frontier.length; hop++) {
    const next = [];
    for (const id of frontier) for (const edge of (graph.out.get(id) || [])) {
      if (previous.has(edge.target)) continue;
      previous.set(edge.target, edge);
      if (edge.target === to.id) { frontier = []; next.length = 0; break; }
      next.push(edge.target);
    }
    if (previous.has(to.id)) break;
    frontier = next;
  }
  if (!previous.has(to.id)) return null;
  const steps = [];
  for (let at = to.id; previous.get(at); at = previous.get(at).source) {
    const edge = previous.get(at);
    steps.unshift({ from: edge.source, to: edge.target, type: edge.type, tier: edge.tier ?? null, confidence: edge.confidence });
  }
  return steps;
}

export function search(graph, text, { limit = 40 } = {}) {
  const needle = text.toLowerCase();
  const scored = [];
  for (const node of graph.nodes) {
    if (node.type !== 'symbol' && node.type !== 'file') continue;
    const hay = (node.type === 'symbol' ? node.name : node.path).toLowerCase();
    const at = hay.indexOf(needle);
    if (at === -1) continue;
    // Exact beats prefix beats contains; shorter names win ties, so `user` finds `user` before
    // `getUserPreferencesFromCache`.
    scored.push({ node, score: (hay === needle ? 0 : at === 0 ? 1 : 2) * 1000 + hay.length });
  }
  return scored.sort((a, b) => a.score - b.score || a.node.id.localeCompare(b.node.id)).slice(0, limit).map((hit) => describe(hit.node));
}

// --- CLI ---------------------------------------------------------------------
const USAGE = `usage: node query.mjs <repo> <command> [args] [--json] [--limit N] [--hops N]

  search <text>            symbols and files matching text
  defines <path>           symbols declared under a file or directory
  scope <path>             what a file or directory depends on, and what depends on it
  callers <ref>            what calls this symbol
  callees <ref>            what this symbol calls
  impact <path>            what transitively imports this file (blast radius)
  neighbours <ref>         what sits within N hops
  path <from> <to>         shortest dependency path, with the edges it used

A <ref> is a node id, a file path, a bare symbol name, or path#name.`;

function main(argv) {
  const flags = {}, positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') flags.json = true;
    else if (argv[i].startsWith('--')) flags[argv[i].slice(2)] = argv[++i];
    else positional.push(argv[i]);
  }
  const [repo, command, ...rest] = positional;
  if (!repo || !command) { console.error(USAGE); process.exit(1); }
  const graph = loadGraph(repo);
  const options = { limit: Number(flags.limit) || undefined, hops: Number(flags.hops) || undefined };
  // Ambiguity is recorded, not only printed: a note on stderr is invisible to anything reading
  // --json, which is exactly the caller most likely to act on the wrong symbol. Recorded per
  // reference, because `path` resolves two and one of them overwriting the other loses the fact
  // that the source was ambiguous at all.
  const ambiguous = [];
  const one = (ref) => {
    const found = resolveRef(graph, ref);
    if (!found.length) throw new Error(`nothing matches "${ref}"; try: query <repo> search ${ref}`);
    if (found.length > 1) {
      ambiguous.push({ ref, resolved: found[0].id, also_matched: found.map((node) => node.id) });
      console.error(`note: "${ref}" matches ${found.length}; using ${found[0].id}. Pass a unique id or path#name to choose.`);
    }
    return found[0];
  };

  let result;
  if (command === 'search') result = search(graph, rest.join(' '), options);
  else if (command === 'defines') result = defines(graph, rest[0], options);
  else if (command === 'scope') result = boundary(graph, rest[0], options);
  else if (command === 'callers') result = callers(graph, one(rest[0]), options);
  else if (command === 'callees') result = callees(graph, one(rest[0]), options);
  else if (command === 'impact') result = impact(graph, one(rest[0]), options);
  else if (command === 'neighbours' || command === 'neighbors') result = neighbours(graph, one(rest[0]), options);
  else if (command === 'path') { result = path(graph, one(rest[0]), one(rest[1]), options); if (!result) { console.error('no path found'); process.exit(2); } }
  else { console.error(USAGE); process.exit(1); }

  if (flags.json) {
    console.log(JSON.stringify(ambiguous.length ? { ambiguous, results: result } : result, null, 2));
    return;
  }
  if (result && !Array.isArray(result)) {
    console.log(`${result.prefix}: ${result.files} files, ${result.symbolCount} symbols`);
    for (const [label, rows] of [['depends on', result.dependsOn], ['depended on by', result.dependedOnBy]]) {
      console.log(`  ${label}:`);
      for (const row of rows) console.log(`    ${row.target} (${row.weight})`);
      if (!rows.length) console.log('    (nothing)');
    }
    return;
  }
  if (!result.length) { console.log('(nothing)'); return; }
  for (const row of result) {
    if (row.from) { console.log(`${row.from} -[${row.type}${row.tier ? ` ${row.tier}` : ''}]-> ${row.to}`); continue; }
    const where = row.path ? `${row.path}${row.line ? `:${row.line}` : ''}` : '';
    const marks = [row.kind, row.tier, row.distance !== undefined ? `${row.distance} hop` : null].filter(Boolean).join(' · ');
    console.log(`${(row.name || row.id).padEnd(38)} ${marks.padEnd(24)} ${where}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exit(1); }
}
