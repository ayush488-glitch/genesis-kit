import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, watch, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(root, 'tools', 'genesis.mjs'), serve = join(root, 'tools', 'serve.mjs');

function project() {
  const repo = mkdtempSync(join(tmpdir(), 'genesis-serve-'));
  mkdirSync(join(repo, 'src', 'api'), { recursive: true });
  mkdirSync(join(repo, 'src', 'ui'), { recursive: true });
  writeFileSync(join(repo, 'src', 'api', 'client.ts'), "import { format } from '../ui/format';\nexport const fetchUser = async (id: string) => format(id);\n");
  writeFileSync(join(repo, 'src', 'ui', 'format.ts'), 'export const format = (v: string) => v.trim();\nexport type Formatted = string;\n');
  for (const args of [['init', '-q'], ['config', 'user.email', 'genesis@example.test'], ['config', 'user.name', 'Genesis Test'], ['add', '.'], ['commit', '-qm', 'fixture']]) execFileSync('git', args, { cwd: repo });
  execFileSync(process.execPath, [cli, 'init', repo, '--name', 'serve-fixture'], { stdio: 'ignore' });
  return repo;
}

// Resolves once the server prints the loopback URL it actually bound, so the test never guesses a port.
// Recursive fs.watch is unsupported on Linux before Node 20.13. serve.mjs degrades with a message
// there, which is the documented behaviour, so the watcher tests report the platform limit rather
// than failing on it.
function recursiveWatchWorks() {
  const probe = mkdtempSync(join(tmpdir(), 'genesis-watch-probe-'));
  try { watch(probe, { recursive: true }).close(); return true; } catch { return false; }
}
const watchable = recursiveWatchWorks();
const noWatch = watchable ? false : 'recursive fs.watch is unavailable on this platform/runtime';

// SSE frames do not align with read boundaries: one read can carry several frames, or half of one.
// Accumulate across reads and match the buffer, under a single deadline for the whole wait.
async function waitForFrames(reader, patterns, ms = 15000) {
  const decoder = new TextDecoder();
  const deadline = Date.now() + ms;
  let buffer = '';
  let timer;
  const expired = new Promise((resolve) => { timer = setTimeout(() => resolve({ timedOut: true }), ms); });
  try {
    while (Date.now() < deadline) {
      if (patterns.every((pattern) => buffer.includes(pattern))) return buffer;
      const next = await Promise.race([reader.read(), expired]);
      if (next.timedOut || next.done) break;
      buffer += decoder.decode(next.value, { stream: true });
    }
  } finally { clearTimeout(timer); }
  if (patterns.every((pattern) => buffer.includes(pattern))) return buffer;
  throw new Error(`missing ${patterns.filter((p) => !buffer.includes(p)).join(', ')} in stream: ${JSON.stringify(buffer.slice(0, 300))}`);
}

function start(repo) {
  const child = spawn(process.execPath, [serve, repo, '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    const fail = setTimeout(() => reject(new Error('server did not report a URL in time')), 10000);
    child.stdout.on('data', (chunk) => {
      const match = /(http:\/\/127\.0\.0\.1:\d+)/.exec(String(chunk));
      if (match) { clearTimeout(fail); resolve({ child, base: match[1] }); }
    });
    child.on('exit', (code) => { clearTimeout(fail); reject(new Error(`server exited early with ${code}`)); });
  });
}

test('serves an aggregated graph, node detail, and pushes a change event', async (t) => {
  const repo = project();
  const { child, base } = await start(repo);
  t.after(() => child.kill());
  const get = async (path) => (await fetch(base + path)).json();

  assert.equal((await fetch(base + '/')).status, 200);

  // Directory aggregation: one node at the top, its children one level down.
  const top = await get('/api/graph?depth=1');
  assert.deepEqual(top.nodes.map((n) => n.id), ['src']);
  assert.equal(top.nodes[0].files, 2);
  assert.equal(top.edges.length, 0, 'an edge inside a single group is not drawn between groups');

  const split = await get('/api/graph?depth=2');
  assert.deepEqual(split.nodes.map((n) => n.id).sort(), ['src/api', 'src/ui']);
  assert.deepEqual(split.edges.map((e) => [e.source, e.target, e.weight]), [['src/api', 'src/ui', 1]]);

  const detail = await get('/api/node?id=src/ui');
  assert.equal(detail.files, 1);
  assert.deepEqual(detail.symbols.map((s) => [s.kind, s.name]), [['function', 'format'], ['type', 'Formatted']]);
  assert.equal(detail.dependedOnBy[0].target, 'src/api/client.ts');

});

test('a CLI write in another process reaches an open stream with no reload', { skip: noWatch }, async (t) => {
  const repo = project();
  const { child, base } = await start(repo);
  t.after(() => child.kill());
  const stream = await fetch(base + '/events');
  const reader = stream.body.getReader();
  execFileSync(process.execPath, [cli, 'record', 'knowledge', repo, '--title', 'live', '--text', 'written while serving'], { stdio: 'ignore' });
  await waitForFrames(reader, ['event: change']);
  await reader.cancel();
});

test('refuses writes and unknown routes', async (t) => {
  const repo = project();
  const { child, base } = await start(repo);
  t.after(() => child.kill());
  assert.equal((await fetch(base + '/api/summary', { method: 'POST' })).status, 405, 'the panel is read-only');
  assert.equal((await fetch(base + '/nope')).status, 404);
});

test('hides stray leaf files but keeps directories and honours the toggle', async (t) => {
  const repo = project();
  // A config file nothing imports: the shape that drowns a real graph.
  writeFileSync(join(repo, 'src', 'ui', 'tailwind.config.ts'), 'export default {};\n');
  execFileSync(process.execPath, [join(root, 'tools', 'graphizer.mjs'), repo, '--write'], { stdio: 'ignore' });
  const { child, base } = await start(repo);
  t.after(() => child.kill());
  const get = async (path) => (await fetch(base + path)).json();

  const deep = await get('/api/graph?depth=3');
  assert(!deep.nodes.some((n) => n.id.endsWith('tailwind.config.ts')), 'an unconnected leaf file is hidden by default');
  assert(deep.nodes.some((n) => n.id === 'src/ui/format.ts'), 'a connected leaf file stays');

  const withStrays = await get('/api/graph?depth=3&isolated=1');
  assert(withStrays.nodes.some((n) => n.id.endsWith('tailwind.config.ts')), 'the toggle restores it');

  // A directory with no edges leaving it must never vanish, or a self-contained repo renders empty.
  const top = await get('/api/graph?depth=1');
  assert.deepEqual(top.nodes.map((n) => n.id), ['src']);
  assert.equal(top.edges.length, 0);

  // Labels carry the parent, since most leaves are called src, tests or lib.
  const split = await get('/api/graph?depth=2');
  assert.deepEqual(split.nodes.map((n) => n.label).sort(), ['src/api', 'src/ui']);
});

test('serves the symbol map with numeric edge endpoints', async (t) => {
  const repo = project();
  writeFileSync(join(repo, 'src', 'api', 'client.ts'), "import { format } from '../ui/format';\nexport const fetchUser = (id: string) => format(id);\n");
  execFileSync(process.execPath, [join(root, 'tools', 'graphizer.mjs'), repo, '--write'], { stdio: 'ignore' });
  const { child, base } = await start(repo);
  t.after(() => child.kill());
  const data = await (await fetch(base + '/api/map')).json();

  // Files carry their own symbols; edges index into the flattened symbol order, which is what
  // keeps the payload small enough to ship every symbol at once.
  const paths = data.files.map((f) => f.path);
  assert.deepEqual(paths, paths.slice().sort(), 'files arrive in a stable order the client can index against');
  assert(data.files.some((f) => f.path === 'src/ui/format.ts' && f.symbols.some((s) => s.n === 'format')));
  assert.equal(data.stats.files, data.files.length);
  assert.equal(data.stats.symbols, data.files.reduce((total, f) => total + f.symbols.length, 0));

  const flat = [];
  data.files.forEach((f) => f.symbols.forEach((s) => flat.push(f.path + '#' + s.n)));
  const call = data.edges.find((e) => flat[e[0]].indexOf('fetchUser') !== -1);
  assert(call, 'the cross-file call is present');
  assert.equal(flat[call[1]], 'src/ui/format.ts#format', 'and points at the definition it resolved to');
});

test('reindexes on a source edit and reports it, without any command being run', { skip: noWatch }, async (t) => {
  const repo = project();
  const { child, base } = await start(repo);
  t.after(() => child.kill());

  const stream = await fetch(base + '/events');
  const reader = stream.body.getReader();

  // Nothing here runs the CLI: the watcher alone has to notice and rebuild.
  writeFileSync(join(repo, 'src', 'ui', 'added.ts'), 'export function addedByWatcher() {}\n');

  await waitForFrames(reader, ['event: indexing', 'event: change']);
  await reader.cancel();

  const data = await (await fetch(base + '/api/map')).json();
  assert(data.files.some((f) => f.path === 'src/ui/added.ts'), 'the new file is in the index');
});

test('--no-watch is honoured, so a save does not reindex', async (t) => {
  const repo = project();
  const child = spawn(process.execPath, [serve, repo, '--port', '0', '--no-watch'], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  const banner = await new Promise((resolve, reject) => {
    const fail = setTimeout(() => reject(new Error('no banner')), 10000);
    let seen = '';
    // The mode line follows the URL on a second write, so wait for it rather than the first chunk.
    child.stdout.on('data', (chunk) => { seen += chunk; if (seen.includes('Approvals and gates')) { clearTimeout(fail); resolve(seen); } });
  });
  assert.match(banner, /not watching sources/);
});
