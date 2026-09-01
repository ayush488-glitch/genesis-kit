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
  assert(graph.nodes.some(({id,provenance}) => id === 'symbol:python/pkg/worker.py#class:Worker' && provenance.extractor === 'python-stdlib-ast'));
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
  assert.equal(JSON.parse(readFileSync(out,'utf8')).schemaVersion, 1);
  assert.match(readFileSync(join(root, 'artifacts', 'graph.html'),'utf8'), /code graph/);
});
