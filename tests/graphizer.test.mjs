import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const graphizer = join(dirname(dirname(fileURLToPath(import.meta.url))), 'tools', 'graphizer.mjs');
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'genesis-graph-'));
  mkdirSync(join(root, 'src', 'one'), { recursive: true }); mkdirSync(join(root, 'src', 'two'), { recursive: true }); mkdirSync(join(root, 'python', 'pkg'), { recursive: true });
  writeFileSync(join(root, 'src', 'one', 'index.ts'), 'export function one() {}\n');
  writeFileSync(join(root, 'src', 'two', 'index.ts'), "import { one } from '../one/index.js';\nimport leftpad from 'left-pad';\nexport class Two {}\n");
  writeFileSync(join(root, 'src', 'broken.js'), "import './missing.js';\n");
  writeFileSync(join(root, 'python', 'pkg', '__init__.py'), 'from .worker import run\n');
  writeFileSync(join(root, 'python', 'pkg', 'worker.py'), 'import json\nclass Worker:\n    def work(self):\n        return True\ndef run():\n    return True\n');
  return root;
}

test('dry-run emits deterministic qualified graph without writing', () => {
  const root = fixture();
  const first = execFileSync(process.execPath, [graphizer, root], { encoding: 'utf8' }), second = execFileSync(process.execPath, [graphizer, root], { encoding: 'utf8' });
  assert.equal(first, second);
  const graph = JSON.parse(first);
  assert(graph.nodes.some(({id}) => id === 'file:src/one/index.ts'));
  assert(graph.nodes.some(({id}) => id === 'file:src/two/index.ts'));
  assert(graph.nodes.some(({id}) => id === 'package:npm:left-pad'));
  assert(graph.nodes.some(({id}) => id === 'runtime:python:json'));
  assert(!graph.nodes.some(({id}) => id === 'package:pypi:json'));
  assert(graph.nodes.some(({id}) => id.startsWith('unresolved:src/broken.js:')));
  assert(graph.nodes.some(({id,extractor}) => id === 'symbol:python/pkg/worker.py#class:Worker' && extractor === 'python-stdlib-ast'));
  assert(graph.nodes.some(({id}) => id === 'symbol:python/pkg/worker.py#function:Worker.work'));
  assert(graph.edges.some(({source,target,resolved}) => source === 'file:src/two/index.ts' && target === 'file:src/one/index.ts' && resolved));
  assert.throws(() => statSync(join(root, '.genesis', 'index', 'graph.json')));
});

test('--write creates views and leaves unchanged output untouched', async () => {
  const root = fixture(); execFileSync(process.execPath, [graphizer, root, '--write']);
  const jsonPath = join(root, '.genesis', 'index', 'graph.json'), before = statSync(jsonPath).mtimeMs;
  assert.match(readFileSync(join(root, '.genesis', 'index', 'graph.dot'),'utf8'), /^digraph genesis/);
  assert.match(readFileSync(join(root, '.genesis', 'index', 'graph.html'),'utf8'), /Filter graph/);
  await new Promise(resolve => setTimeout(resolve, 20)); execFileSync(process.execPath, [graphizer, root, '--write']);
  assert.equal(statSync(jsonPath).mtimeMs, before);
});

test('--out keeps compatibility and places sibling views beside JSON', () => {
  const root = fixture(), out = join(root, 'artifacts', 'custom.json'); execFileSync(process.execPath, [graphizer, root, '--out', out, '--write']);
  assert.equal(JSON.parse(readFileSync(out,'utf8')).schemaVersion, 2);
  assert.match(readFileSync(join(root, 'artifacts', 'graph.html'),'utf8'), /code graph/);
});

function monorepo() {
  const root = mkdtempSync(join(tmpdir(), 'genesis-mono-'));
  const write = (rel, body) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), body); };
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - "apps/*"\n  - "packages/common/*"\n\ncatalogs:\n  frontend:\n    react: ^18\n');
  // Trailing comma and comments: a naive JSONC strip breaks on these.
  write('apps/web/tsconfig.json', '{\n  // app config\n  "compilerOptions": {\n    "paths": { "@/*": ["./src/*"] },\n  },\n}\n');
  write('apps/web/src/lib/format.ts', 'export function format() {}\n');
  write('apps/web/src/page.tsx', "import { format } from '@/lib/format';\nimport { shared } from '@scope/shared';\nimport { Button } from '@scope/ui/components/button';\nimport { schema } from '@scope/shared/schema';\nimport react from 'react';\n");
  write('packages/common/shared/package.json', '{"name":"@scope/shared","exports":{".":{"types":"./src/index.ts","default":"./dist/index.js"},"./schema":{"types":"./src/schema.ts","default":"./dist/schema.js"}}}');
  write('packages/common/shared/src/index.ts', 'export const shared = 1;\n');
  write('packages/common/shared/src/schema.ts', 'export const schema = 1;\n');
  write('packages/common/ui/package.json', '{"name":"@scope/ui"}');
  write('packages/common/ui/src/components/button.tsx', 'export const Button = () => null;\n');
  return root;
}

test('resolves tsconfig path aliases and workspace packages across a monorepo', () => {
  const root = monorepo();
  const graph = JSON.parse(execFileSync(process.execPath, [graphizer, root], { encoding: 'utf8' }));
  const edge = (specifier) => graph.edges.find((e) => e.specifier === specifier && e.source === 'file:apps/web/src/page.tsx');
  assert.equal(edge('@/lib/format').target, 'file:apps/web/src/lib/format.ts', 'tsconfig "@/*" alias');
  assert.equal(edge('@scope/shared').target, 'file:packages/common/shared/src/index.ts', 'workspace root via exports "types"');
  assert.equal(edge('@scope/shared/schema').target, 'file:packages/common/shared/src/schema.ts', 'workspace exports subpath');
  assert.equal(edge('@scope/ui/components/button').target, 'file:packages/common/ui/src/components/button.tsx', 'workspace subpath with no exports map, via src/');
  for (const specifier of ['@/lib/format', '@scope/shared', '@scope/shared/schema', '@scope/ui/components/button']) assert.equal(edge(specifier).resolved, true, specifier);
  // A genuine external stays external rather than being force-resolved.
  assert.equal(edge('react').resolved, false);
  assert(graph.nodes.some(({ id }) => id === 'package:npm:react'));
});

test('extracts top-level declaration kinds without claiming nested ones', () => {
  const root = mkdtempSync(join(tmpdir(), 'genesis-symbols-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'shapes.tsx'), [
    'const Icon = ({ className = "" }) => {',            // unexported arrow + default export: the common React shape
    '  const nested = () => null;',                       // nested, must not be claimed
    '  return null;',
    '};',
    'const compact = (a: string, b: string) => a + b;',
    'const wrapped = async (',                            // arrow whose params wrap to the next line
    '  value: string,',
    ') => value;',
    'export type Alias = string;',
    'export interface Shape { size: number }',
    'export enum Mode { On, Off }',
    'export const NAME = "constant";',
    'export default Icon;',
    'export async function load() {}',
    'export abstract class Base {}',
  ].join('\n') + '\n');
  const graph = JSON.parse(execFileSync(process.execPath, [graphizer, root], { encoding: 'utf8' }));
  const symbols = new Map(graph.nodes.filter((n) => n.type === 'symbol').map((n) => [n.name, n.kind]));
  assert.equal(symbols.get('Icon'), 'function', 'unexported arrow component');
  assert.equal(symbols.get('compact'), 'function', 'arrow with typed params');
  assert.equal(symbols.get('wrapped'), 'function', 'arrow with params on following lines');
  assert.equal(symbols.get('Alias'), 'type');
  assert.equal(symbols.get('Shape'), 'interface');
  assert.equal(symbols.get('Mode'), 'enum');
  assert.equal(symbols.get('NAME'), 'variable', 'a plain value stays a variable');
  assert.equal(symbols.get('load'), 'function');
  assert.equal(symbols.get('Base'), 'class');
  assert(!symbols.has('nested'), 'declarations inside a function body must not be claimed');
});

test('resolves calls into proven and ambiguous tiers, and never invents the rest', () => {
  const root = mkdtempSync(join(tmpdir(), 'genesis-calls-'));
  const write = (rel, body) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), body); };
  write('src/util.ts', 'export function helper() {}\n');
  write('src/other.ts', 'export function collide() {}\n');
  write('src/third.ts', 'export function collide() {}\n');
  write('src/base.ts', 'export class Base {}\n');
  write('src/main.ts', [
    "import { helper } from './util';",
    "import { Base } from './base';",
    'export function run() {',
    '  helper();',            // imported, one definition -> proven
    '  local();',             // same file -> proven
    '  collide();',           // two definitions, not imported -> ambiguous, candidates kept
    '  fetch();',             // nothing knows it -> counted, not invented
    '}',
    'export function local() {}',
    'export class Child extends Base {}',
  ].join('\n') + '\n');
  const graph = JSON.parse(execFileSync(process.execPath, [graphizer, root], { encoding: 'utf8' }));
  const from = 'symbol:src/main.ts#function:run';
  const call = (target) => graph.edges.find((e) => e.type === 'calls' && e.source === from && e.target === target);

  assert.equal(call('symbol:src/util.ts#function:helper').tier, 'proven', 'call to an imported symbol');
  assert.equal(call('symbol:src/main.ts#function:local').tier, 'proven', 'call within the same file');

  const ambiguous = graph.edges.find((e) => e.type === 'calls' && e.source === from && e.tier === 'ambiguous');
  assert(ambiguous, 'a name matching several definitions stays ambiguous');
  assert.equal(ambiguous.candidates.length, 2, 'every candidate is kept rather than collapsed to a guess');
  assert.equal(ambiguous.resolved, false);

  assert(!graph.edges.some((e) => e.type === 'calls' && /fetch/.test(e.target)), 'an unknown call is never invented');
  assert(graph.stats.unresolvedCalls > 0, 'unknown calls are counted');

  assert(graph.edges.some((e) => e.type === 'inherits' && e.source === 'symbol:src/main.ts#class:Child' && e.target === 'symbol:src/base.ts#class:Base'));
});

test('incremental reindex reuses unchanged files and matches a full rebuild', () => {
  const root = fixture();
  const out = join(root, '.genesis', 'index', 'graph.json');
  const read = () => JSON.parse(readFileSync(out, 'utf8'));
  // Counts are reported on stderr, never in the graph: the graph has to stay a pure function of
  // the sources, or an unchanged tree would rewrite it on every run.
  const run = (extra = []) => {
    const result = spawnSync(process.execPath, [graphizer, root, '--write', ...extra], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const counts = /\((\d+) extracted, (\d+) reused\)/.exec(result.stderr);
    assert(counts, `no counts in stderr: ${result.stderr}`);
    return { extracted: Number(counts[1]), reused: Number(counts[2]) };
  };

  const cold = run();
  assert.equal(cold.reused, 0, 'a cold run has nothing to reuse');
  assert(cold.extracted > 0);

  const warm = run();
  assert.equal(warm.extracted, 0, 'an unchanged tree re-reads nothing');
  assert.equal(warm.reused, cold.extracted);

  writeFileSync(join(root, 'src', 'one', 'index.ts'), 'export function one() {}\nexport function two() {}\n');
  const edited = run();
  assert.equal(edited.extracted, 1, 'only the edited file is re-read');
  const after = read();
  assert(after.nodes.some(({ id }) => id === 'symbol:src/one/index.ts#function:two'), 'and its new symbol appears');

  // The whole point: incremental must not be a different answer from a full rebuild.
  run(['--full']);
  const full = read();
  assert.deepEqual(after.nodes, full.nodes);
  assert.deepEqual(after.edges, full.edges);
  assert.equal(after.sourceHash, full.sourceHash);
});

test('extracts Python calls and inheritance, kept separate from JavaScript', () => {
  const root = mkdtempSync(join(tmpdir(), 'genesis-py-'));
  const write = (rel, body) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), body); };
  write('pkg/base.py', 'class Base:\n    def run(self):\n        return 1\n');
  write('pkg/worker.py', [
    'from .base import Base',
    'from .util import helper',
    '',
    'class Worker(Base):',                 // inheritance across files
    '    def work(self):',
    '        helper()',                    // imported call
    '        return self.run()',           // attribute call, resolves by bare name
    '',
    'def start():',
    '    w = Worker()',                    // local class
    '    return w.work()',
  ].join('\n') + '\n');
  write('pkg/util.py', 'def helper():\n    return 2\n');
  // Same name in JavaScript: a Python call must never resolve to it.
  write('web/app.js', 'export function helper() {}\n');

  const graph = JSON.parse(execFileSync(process.execPath, [graphizer, root], { encoding: 'utf8' }));
  const call = (from, to) => graph.edges.find((e) => e.type === 'calls' && e.source === from && e.target === to);

  assert(call('symbol:pkg/worker.py#function:Worker.work', 'symbol:pkg/util.py#function:helper'), 'call to an imported Python function');
  assert(call('symbol:pkg/worker.py#function:Worker.work', 'symbol:pkg/base.py#function:Base.run'), 'attribute call resolved by bare name against a qualified symbol');
  assert(graph.edges.some((e) => e.type === 'inherits' && e.source === 'symbol:pkg/worker.py#class:Worker' && e.target === 'symbol:pkg/base.py#class:Base'));

  const crossed = graph.edges.filter((e) => e.type === 'calls' && /\.py#/.test(e.source) && /web\/app\.js/.test(e.target));
  assert.equal(crossed.length, 0, 'a Python call never resolves into JavaScript');
  assert(graph.edges.some((e) => e.extractor === 'python-stdlib-ast-calls'));
});

test('a failing python3 costs symbols, not whole files', () => {
  const root = mkdtempSync(join(tmpdir(), 'genesis-nopy-'));
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  mkdirSync(join(root, 'pkg'), { recursive: true });
  writeFileSync(join(root, 'pkg', 'app.py'), 'import helper\ndef main():\n    return helper.go()\n');
  writeFileSync(join(root, 'pkg', 'helper.py'), 'def go():\n    return 1\n');
  writeFileSync(join(root, 'pkg', 'web.ts'), 'export const x = 1;\n');
  // A python3 that always fails, the way a missing interpreter behaves.
  writeFileSync(join(bin, 'python3'), '#!/bin/sh\nexit 127\n', { mode: 0o755 });

  const result = spawnSync(process.execPath, [graphizer, root], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
  assert.equal(result.status, 0);
  const graph = JSON.parse(result.stdout);

  const files = graph.nodes.filter((n) => n.type === 'file').map((n) => n.path).sort();
  assert.deepEqual(files, ['pkg/app.py', 'pkg/helper.py', 'pkg/web.ts'], 'every walked file keeps a node');
  assert.equal(graph.nodes.filter((n) => n.type === 'symbol' && n.path.endsWith('.py')).length, 0, 'but no Python symbols were invented');
  assert(graph.warnings.some((w) => /Python AST unavailable/.test(w)), 'and the failure is reported');

  // Dropping the nodes while keeping the edges would leave imports pointing at nothing.
  const ids = new Set(graph.nodes.map((n) => n.id));
  assert.equal(graph.edges.filter((e) => !ids.has(e.source) || !ids.has(e.target)).length, 0, 'no edge points at a missing node');
});

test('an aliased parent class resolves to the name the target file declares', () => {
  const root = mkdtempSync(join(tmpdir(), 'genesis-alias-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'base.ts'), 'export class Base {\n  run() {}\n}\n');
  // The local alias exists only here; base.ts declares Base.
  writeFileSync(join(root, 'src', 'child.ts'), 'import { Base as Parent } from "./base";\n\nexport class Child extends Parent {\n}\n');
  const graph = JSON.parse(execFileSync(process.execPath, [graphizer, root], { encoding: 'utf8' }));
  assert(graph.edges.some((e) => e.type === 'inherits' && e.source === 'symbol:src/child.ts#class:Child' && e.target === 'symbol:src/base.ts#class:Base'));
});

function rustFixture() {
  const root = mkdtempSync(join(tmpdir(), 'genesis-rust-'));
  const write = (rel, body) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), body); };
  write('src/lib.rs', [
    'mod config;',
    'mod net;',
    '',
    'use std::collections::HashMap;',
    'use serde::{Serialize, Deserialize};',
    'use crate::config::Settings;',
    'pub use crate::config::Settings as Config;',
    '',
    'pub struct App {',
    '    pub name: String,',
    '}',
    'pub(crate) struct Internal;',
    'pub enum Mode { On, Off }',
    'pub trait Runner {',
    '    fn run(&self);',
    '}',
    'impl App {',
    '    pub fn start() {}',
    '}',
    'impl Runner for App {',
    '    fn run(&self) {}',
    '}',
    '',
    'pub async fn launch() {}',
    'pub fn probe() {}',
    'fn hidden() {}',
  ].join('\n') + '\n');
  write('src/config.rs', 'pub struct Settings {\n    pub debug: bool,\n}\n\npub fn load() -> Settings {\n    Settings { debug: true }\n}\n');
  write('src/net/mod.rs', 'pub mod tcp;\npub mod pool;\n\nuse crate::config::Settings;\n');
  write('src/net/tcp.rs', 'pub struct Socket;\n');
  write('src/net/pool.rs', 'use super::tcp::Socket;\n\npub struct Pool;\n');
  return root;
}

test('indexes a Rust crate: modules, use paths and top-level items', () => {
  const root = rustFixture();
  const first = execFileSync(process.execPath, [graphizer, root], { encoding: 'utf8' }), graph = JSON.parse(first);
  const edge = (source, specifier) => graph.edges.find((e) => e.type === 'imports' && e.source === source && e.specifier === specifier);

  // Every .rs file in the tree is traversed and carries the rust language.
  for (const id of ['file:src/lib.rs', 'file:src/config.rs', 'file:src/net/mod.rs', 'file:src/net/tcp.rs', 'file:src/net/pool.rs']) {
    assert.equal(graph.nodes.find((n) => n.id === id).language, 'rust', id);
  }

  assert.equal(edge('file:src/lib.rs', 'self::config').target, 'file:src/config.rs', 'a `mod` declaration resolves to its file');
  assert.equal(edge('file:src/lib.rs', 'self::net').target, 'file:src/net/mod.rs', 'a directory module resolves to its mod.rs');
  assert.equal(edge('file:src/lib.rs', 'crate::config::Settings').target, 'file:src/config.rs', 'a crate:: path resolves against the crate root, item fallback to the parent module');
  assert.equal(edge('file:src/net/pool.rs', 'super::tcp::Socket').target, 'file:src/net/tcp.rs', 'a super:: path resolves against the parent module of a file module');
  assert.equal(edge('file:src/lib.rs', 'std::collections::HashMap').target, 'runtime:rust:std', 'the standard library is a runtime node');
  const external = edge('file:src/lib.rs', 'serde::Serialize');
  assert.equal(external.target, 'package:crates:serde', 'an external crate stays a package');
  assert.equal(external.resolved, false);

  const symbol = (path, kind, name) => graph.nodes.find((n) => n.type === 'symbol' && n.id === `symbol:${path}#${kind}:${name}`);
  assert(symbol('src/lib.rs', 'class', 'App') && symbol('src/lib.rs', 'class', 'Internal'), 'structs are classes, including pub(crate)');
  assert(symbol('src/lib.rs', 'enum', 'Mode'), 'enums are claimed');
  assert(symbol('src/lib.rs', 'interface', 'Runner'), 'traits are interfaces');
  assert(symbol('src/lib.rs', 'function', 'launch') && symbol('src/lib.rs', 'function', 'hidden'), 'async and private fns are claimed');
  assert(symbol('src/lib.rs', 'type', 'Runner for App') && symbol('src/lib.rs', 'type', 'App'), 'impl blocks are type bindings');
  assert.equal(symbol('src/lib.rs', 'function', 'launch').extractor, 'conservative-rust-symbols');
  assert(!graph.nodes.some((n) => n.type === 'symbol' && (n.name === 'run' || n.name === 'start')), 'methods inside impl and trait bodies are never claimed');

  // The qualified graph stays deterministic and on the current schema.
  assert.equal(graph.schemaVersion, 2);
  assert.equal(first, execFileSync(process.execPath, [graphizer, root], { encoding: 'utf8' }));
});

test('a repository without Rust files gains no Rust nodes', () => {
  const root = fixture();
  const graph = JSON.parse(execFileSync(process.execPath, [graphizer, root], { encoding: 'utf8' }));
  assert(graph.nodes.every((n) => n.language !== 'rust'), 'no node is reported as rust');
  const rustOnly = (id) => id.startsWith('package:crates:') || id.startsWith('runtime:rust:');
  assert(!graph.nodes.some((n) => rustOnly(n.id)), 'no rust-only node kinds appear');
});

test('crate:: paths resolve inside the workspace member that imports them', () => {
  const root = mkdtempSync(join(tmpdir(), 'genesis-rust-ws-'));
  const write = (rel, body) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), body); };
  write('Cargo.toml', '[workspace]\nmembers = ["crates/*"]\n');
  write('crates/api/Cargo.toml', '[package]\nname = "api"\n');
  write('crates/api/src/lib.rs', 'use crate::config::Settings;\n\npub struct App;\n');
  write('crates/api/src/config.rs', 'pub struct Settings;\n');
  write('crates/api/src/net/pool.rs', 'use crate::config::Settings;\n');
  write('crates/util/Cargo.toml', '[package]\nname = "util"\n');
  write('crates/util/src/lib.rs', 'use crate::math::Vec2;\n\npub fn helper() {}\n');
  write('crates/util/src/math.rs', 'pub struct Vec2;\n');
  const graph = JSON.parse(execFileSync(process.execPath, [graphizer, root], { encoding: 'utf8' }));
  const edge = (source) => graph.edges.find((e) => e.type === 'imports' && e.specifier === 'crate::config::Settings' && e.source === source);
  assert.equal(edge('file:crates/api/src/lib.rs').target, 'file:crates/api/src/config.rs', 'the member crate root, not the workspace root');
  assert.equal(edge('file:crates/api/src/net/pool.rs').target, 'file:crates/api/src/config.rs', 'from a nested module the nearest enclosing crate still wins');
  const utilEdge = graph.edges.find((e) => e.type === 'imports' && e.specifier === 'crate::math::Vec2' && e.source === 'file:crates/util/src/lib.rs');
  assert.equal(utilEdge.target, 'file:crates/util/src/math.rs', 'a crate:: path in the second member resolves inside that member, not another crate');
});

test('consecutive super segments each climb one module level', () => {
  const root = mkdtempSync(join(tmpdir(), 'genesis-rust-sup-'));
  mkdirSync(join(root, 'src', 'a', 'b'), { recursive: true });
  writeFileSync(join(root, 'src', 'a', 'b', 'c.rs'), 'use super::super::shared::Thing;\n\npub struct C;\n');
  writeFileSync(join(root, 'src', 'a', 'shared.rs'), 'pub struct Thing;\n');
  const graph = JSON.parse(execFileSync(process.execPath, [graphizer, root], { encoding: 'utf8' }));
  const edge = graph.edges.find((e) => e.type === 'imports' && e.specifier === 'super::super::shared::Thing' && e.source === 'file:src/a/b/c.rs');
  assert.equal(edge.target, 'file:src/a/shared.rs', 'the second super keeps climbing instead of being read as a directory name');
});

test('a glob use path resolves to the module it globs', () => {
  const root = mkdtempSync(join(tmpdir(), 'genesis-rust-glob-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'lib.rs'), 'use crate::util::*;\n\npub fn main() {}\n');
  writeFileSync(join(root, 'src', 'util.rs'), 'pub fn helper() {}\n');
  const graph = JSON.parse(execFileSync(process.execPath, [graphizer, root], { encoding: 'utf8' }));
  const edge = graph.edges.find((e) => e.type === 'imports' && e.source === 'file:src/lib.rs' && e.specifier === 'crate::util');
  assert.equal(edge.target, 'file:src/util.rs', 'the glob resolves as the module itself, not as an item of a doubled path');
  assert.equal(edge.resolved, true);
});

test('a trait impl names the qualified type it is implemented for', () => {
  const root = mkdtempSync(join(tmpdir(), 'genesis-rust-impl-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'lib.rs'), 'mod shape;\n\npub trait Display {}\n\nimpl Display for shape::Circle {\n}\n');
  writeFileSync(join(root, 'src', 'shape.rs'), 'pub struct Circle;\n');
  const graph = JSON.parse(execFileSync(process.execPath, [graphizer, root], { encoding: 'utf8' }));
  assert(graph.nodes.some((n) => n.type === 'symbol' && n.id === 'symbol:src/lib.rs#type:Display for shape::Circle'), 'the for-group keeps the whole qualified target, not just its first segment');
});

function rustGraph(prefix, files) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  for (const [rel, body] of Object.entries(files)) { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), body); }
  return JSON.parse(execFileSync(process.execPath, [graphizer, root], { encoding: 'utf8' }));
}

test('nested use groups expand every leaf against its full path', () => {
  const graph = rustGraph('genesis-rust-nest-', {
    'src/lib.rs': 'mod net;\nuse crate::net::{tcp::{Socket, Listener as L}, pool::*, self};\n',
    'src/net/mod.rs': 'pub mod tcp;\npub mod pool;\n',
    'src/net/tcp.rs': 'pub struct Socket;\npub struct Listener;\n',
    'src/net/pool.rs': 'pub struct Pool;\n',
  });
  const target = (specifier) => graph.edges.find((e) => e.type === 'imports' && e.source === 'file:src/lib.rs' && e.specifier === specifier)?.target;
  assert.equal(target('crate::net::tcp::Socket'), 'file:src/net/tcp.rs', 'a leaf of an inner group keeps both group prefixes');
  assert.equal(target('crate::net::tcp::Listener'), 'file:src/net/tcp.rs', 'an aliased leaf inside an inner group resolves by its real name');
  assert.equal(target('crate::net::pool'), 'file:src/net/pool.rs', 'a glob inside a group resolves to the globbed module');
  assert.equal(target('crate::net'), 'file:src/net/mod.rs', 'self inside a group names the group module');
  assert(!graph.nodes.some((n) => n.type === 'unresolved' && /[{}]/.test(n.label)), 'no brace ever leaks into a specifier');
});

test('root glob imports resolve to the crate root or the runtime', () => {
  const graph = rustGraph('genesis-rust-root-', {
    'src/lib.rs': 'pub mod util;\npub struct Root;\n',
    'src/util.rs': 'use crate::*;\nuse super::*;\nuse self::*;\nuse std::*;\nuse core::*;\nuse alloc::*;\n',
  });
  const target = (specifier) => graph.edges.find((e) => e.type === 'imports' && e.source === 'file:src/util.rs' && e.specifier === specifier)?.target;
  assert.equal(target('crate'), 'file:src/lib.rs', 'crate::* globs the crate root');
  assert.equal(target('super'), 'file:src/lib.rs', 'super::* from a top-level file module globs the crate root');
  assert.equal(target('self'), 'file:src/util.rs', 'self::* globs the file itself');
  for (const name of ['std', 'core', 'alloc']) assert.equal(target(name), `runtime:rust:${name}`, `${name}::* is a runtime import`);
  assert(!graph.nodes.some((n) => /^package:crates:(?:std|core|alloc)$/.test(n.id)), 'the standard crates are never external packages');
});

test('unsafe and qualified item forms are claimed', () => {
  const graph = rustGraph('genesis-rust-unsafe-', {
    'src/lib.rs': 'pub struct Buffer;\nunsafe impl Send for Buffer {}\npub unsafe trait Raw {}\npub const fn size() -> usize { 0 }\npub unsafe fn poke() {}\npub extern "C" fn ffi() {}\n',
  });
  const has = (kind, name) => graph.nodes.some((n) => n.id === `symbol:src/lib.rs#${kind}:${name}`);
  assert(has('type', 'Send for Buffer'), 'an unsafe impl is a type binding');
  assert(has('interface', 'Raw'), 'an unsafe trait is an interface');
  for (const name of ['size', 'poke', 'ffi']) assert(has('function', name), `${name} is claimed`);
});

test('items inside inline mod and impl bodies are never claimed, even unindented', () => {
  const graph = rustGraph('genesis-rust-scope-', {
    'src/lib.rs': [
      'mod internal {',
      'pub fn helper() {}',
      'pub struct Hidden;',
      '}',
      'impl Outer {',
      'fn method() { let s = "}"; let c = \'}\'; let r = r#"{ } }"#; }',
      '}',
      '/* a comment { with a brace',
      'fn commented() {} */',
      'pub struct Outer;',
      "fn lifetimes<'a>(x: &'a str) -> &'a str { x }",
      'pub fn after() {}',
    ].join('\n') + '\n',
  });
  const names = graph.nodes.filter((n) => n.type === 'symbol' && n.path === 'src/lib.rs').map((n) => n.name).sort();
  assert.deepEqual(names, ['Outer', 'Outer', 'after', 'lifetimes'].sort(), 'only depth-0 items survive; braces in literals and comments do not shift depth');
});

test('binaries, examples, tests and benches are crates of their own', () => {
  const graph = rustGraph('genesis-rust-targets-', {
    'Cargo.toml': '[package]\nname = "app"\n',
    'src/lib.rs': 'pub mod config;\n',
    'src/config.rs': 'pub struct Settings;\n',
    'src/bin/run.rs': 'mod helper;\nuse crate::config::Settings;\n',
    'src/bin/helper.rs': 'pub fn help() {}\n',
    'src/bin/config.rs': 'pub struct Settings;\n',
    'src/bin/tool/main.rs': 'mod cli;\nuse crate::cli::Args;\n',
    'src/bin/tool/cli.rs': 'pub struct Args;\n',
    'examples/demo.rs': 'mod missing;\n',
    'tests/it.rs': 'mod common;\nuse crate::common::setup;\n',
    'tests/common/mod.rs': 'pub fn setup() {}\n',
  });
  const target = (source, specifier) => graph.edges.find((e) => e.type === 'imports' && e.source === `file:${source}` && e.specifier === specifier)?.target;
  assert.equal(target('src/bin/run.rs', 'crate::config::Settings'), 'file:src/bin/config.rs', 'a binary never reaches into the library crate through crate::');
  assert.equal(target('src/bin/run.rs', 'self::helper'), 'file:src/bin/helper.rs', 'a binary root owns src/bin/ the way lib.rs owns src/');
  assert.equal(target('src/bin/tool/main.rs', 'self::cli'), 'file:src/bin/tool/cli.rs', 'a directory binary owns its own directory');
  assert.equal(target('src/bin/tool/main.rs', 'crate::cli::Args'), 'file:src/bin/tool/cli.rs');
  assert.equal(target('tests/it.rs', 'self::common'), 'file:tests/common/mod.rs', 'an integration test owns tests/');
  assert.equal(target('tests/it.rs', 'crate::common::setup'), 'file:tests/common/mod.rs');
  assert.notEqual(target('examples/demo.rs', 'self::missing'), 'file:examples/demo.rs', 'a missing module is never a self-loop');
  assert(!graph.edges.some((e) => e.type === 'imports' && e.source === e.target), 'no import edge points back at its own file');
});

test('aliased self and a leading :: keep their meaning', () => {
  const graph = rustGraph('genesis-rust-alias-', {
    'src/lib.rs': 'pub mod config;\nuse crate::{self as root};\nuse crate::config::{self as cfg, Settings};\nuse ::std::fmt;\nuse ::serde::Serialize;\nuse ::{core::mem, log::info};\n',
    'src/config.rs': 'pub struct Settings;\n',
  });
  const target = (specifier) => graph.edges.find((e) => e.type === 'imports' && e.source === 'file:src/lib.rs' && e.specifier === specifier)?.target;
  assert.equal(target('crate'), 'file:src/lib.rs', 'self as root names the crate itself');
  assert.equal(target('crate::config'), 'file:src/config.rs', 'self as cfg names the group module');
  assert(!graph.edges.some((e) => /::self$/.test(e.specifier ?? '')), 'self is never appended as a path segment');
  assert.equal(target('std::fmt'), 'runtime:rust:std', 'a leading :: still reaches the standard library');
  assert.equal(target('serde::Serialize'), 'package:crates:serde', 'a leading :: still names the external crate');
  assert.equal(target('core::mem'), 'runtime:rust:core');
  assert.equal(target('log::info'), 'package:crates:log');
  assert(!graph.nodes.some((n) => n.id === 'package:crates:'), 'no empty crate name is ever recorded');
});

test('artifacts are published atomically and leave no staging files', () => {
  const root = fixture();
  execFileSync(process.execPath, [graphizer, root, '--write']);
  const dir = join(root, '.genesis', 'index');
  const leftovers = readdirSync(dir).filter((name) => name.endsWith('.tmp'));
  assert.deepEqual(leftovers, [], 'no staging file survives a write');
  // A reader must never observe a partial file, so what lands is always complete JSON.
  assert.doesNotThrow(() => JSON.parse(readFileSync(join(dir, 'graph.json'), 'utf8')));
});
