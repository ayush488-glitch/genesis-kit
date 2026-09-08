import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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
