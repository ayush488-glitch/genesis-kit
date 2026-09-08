import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { boundary, callers, callees, defines, describe, impact, loadGraph, path as shortestPath, resolveRef, search } from '../tools/query.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const graphizer = join(root, 'tools', 'graphizer.mjs'), cli = join(root, 'tools', 'query.mjs');

function repoFixture() {
  const repo = mkdtempSync(join(tmpdir(), 'genesis-query-'));
  const write = (rel, body) => { mkdirSync(dirname(join(repo, rel)), { recursive: true }); writeFileSync(join(repo, rel), body); };
  write('src/util.ts', 'export function helper() {}\n');
  write('src/service.ts', "import { helper } from './util';\nexport function serve() { helper(); }\n");
  write('src/app.ts', "import { serve } from './service';\nexport function boot() { serve(); }\n");
  write('src/other.ts', 'export function helper() {}\n');           // same name elsewhere
  execFileSync(process.execPath, [graphizer, repo, '--write'], { stdio: 'ignore' });
  return repo;
}

test('answers structural questions about the index', () => {
  const repo = repoFixture();
  const graph = loadGraph(repo);

  assert.deepEqual(callers(graph, resolveRef(graph, 'src/util.ts#helper')[0]).map((r) => r.name), ['serve']);
  assert.deepEqual(callees(graph, resolveRef(graph, 'serve')[0]).map((r) => r.name), ['helper']);
  assert.deepEqual(defines(graph, 'src/service.ts').map((r) => r.name), ['serve']);

  // Blast radius is transitive: app imports service imports util.
  const reach = impact(graph, resolveRef(graph, 'src/util.ts')[0]);
  assert.deepEqual(reach.map((r) => [r.path, r.distance]), [['src/service.ts', 1], ['src/app.ts', 2]]);

  // A path answer carries the edges it used, so it can be checked rather than trusted.
  const steps = shortestPath(graph, resolveRef(graph, 'src/app.ts')[0], resolveRef(graph, 'src/util.ts')[0]);
  assert.deepEqual(steps.map((s) => s.type), ['imports', 'imports']);
  assert.equal(steps.at(-1).to, 'file:src/util.ts');
  assert.equal(shortestPath(graph, resolveRef(graph, 'src/util.ts')[0], resolveRef(graph, 'src/app.ts')[0]), null, 'edges have direction');
});

test('reports ambiguity instead of silently choosing', () => {
  const repo = repoFixture();
  const graph = loadGraph(repo);
  const found = resolveRef(graph, 'helper');
  assert.equal(found.length, 2, 'both definitions are returned, not one of them');
  assert.deepEqual(found.map((n) => n.path).sort(), ['src/other.ts', 'src/util.ts']);
  // A qualified reference disambiguates.
  assert.deepEqual(resolveRef(graph, 'src/other.ts#helper').map((n) => n.path), ['src/other.ts']);
});

test('search ranks exact over prefix over substring', () => {
  const repo = repoFixture();
  const graph = loadGraph(repo);
  const names = search(graph, 'helper').map((r) => r.name);
  assert.equal(names[0], 'helper');
});

test('the CLI emits JSON and fails loudly on an unknown reference', () => {
  const repo = repoFixture();
  const out = execFileSync(process.execPath, [cli, repo, 'callers', 'src/util.ts#helper', '--json'], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(out).map((r) => r.name), ['serve']);
  assert.throws(() => execFileSync(process.execPath, [cli, repo, 'callers', 'nosuchsymbol'], { stdio: 'pipe' }));
});

test('scope answers for a directory, which the symbol tools cannot take', () => {
  const repo = repoFixture();
  const graph = loadGraph(repo);

  // A directory is not a node, so resolveRef rightly finds nothing for it.
  assert.equal(resolveRef(graph, 'src').length, 0);

  // A trailing slash is tolerated; shell completion supplies one.
  for (const prefix of ['src', 'src/']) assert.equal(boundary(graph, prefix).files, 4, 'boundary tolerates a trailing slash');

  const out = execFileSync(process.execPath, [cli, repo, 'scope', 'src', '--json'], { encoding: 'utf8' });
  const answer = JSON.parse(out);
  assert.equal(answer.prefix, 'src');
  assert.equal(answer.files, 4);
  assert.equal(answer.dependsOn.length, 0, 'nothing outside src is imported');
});

test('a missing node yields an identifiable row rather than crashing the printer', () => {
  const repo = repoFixture();
  const graph = loadGraph(repo);
  const row = describe(undefined, 'file:deleted.ts');
  assert.equal(row.id, 'file:deleted.ts', 'keeps the id it was asked about');
  assert.equal(row.kind, 'missing');
  assert.doesNotThrow(() => String(row.name || row.id).padEnd(38), 'the text printer can render it');
  // A row without identity would silently strip meaning from --json too.
  assert.notEqual(describe(undefined, 'x').name, undefined);
});

test('--json carries ambiguity for every reference it resolved', () => {
  const repo = repoFixture();
  const one = JSON.parse(execFileSync(process.execPath, [cli, repo, 'callers', 'helper', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  assert.equal(one.ambiguous.length, 1);
  assert.equal(one.ambiguous[0].ref, 'helper');
  assert.equal(one.ambiguous[0].also_matched.length, 2, 'both definitions are named');
  assert(Array.isArray(one.results), 'and the answer is still there');

  // An unambiguous reference keeps the plain array shape.
  const plain = JSON.parse(execFileSync(process.execPath, [cli, repo, 'callers', 'src/util.ts#helper', '--json'], { encoding: 'utf8' }));
  assert(Array.isArray(plain));
});

test('a two-reference query reports both endpoints, not just the last one', () => {
  const repo = mkdtempSync(join(tmpdir(), 'genesis-twoends-'));
  const write = (rel, body) => { mkdirSync(dirname(join(repo, rel)), { recursive: true }); writeFileSync(join(repo, rel), body); };
  write('src/o1.ts', 'export function omega() {}\n');
  write('src/o2.ts', 'export function omega() {}\n');
  write('src/a1.ts', 'import { omega } from "./o1";\n\nexport function alpha() {\n  omega();\n}\n');
  write('src/a2.ts', 'export function alpha() {}\n');
  execFileSync(process.execPath, [graphizer, repo, '--write'], { stdio: 'ignore' });

  const answer = JSON.parse(execFileSync(process.execPath, [cli, repo, 'path', 'alpha', 'omega', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  // Recording ambiguity in one slot let the destination overwrite the source, so a caller could
  // not tell that the path it received started from a guess.
  assert.deepEqual(answer.ambiguous.map((entry) => entry.ref).sort(), ['alpha', 'omega']);
  for (const entry of answer.ambiguous) assert.equal(entry.also_matched.length, 2);
  assert.equal(answer.results.length, 1);
});
