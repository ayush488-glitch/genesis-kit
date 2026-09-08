import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const server = join(root, 'tools', 'mcp.mjs'), graphizer = join(root, 'tools', 'graphizer.mjs');

function fixture() {
  const repo = mkdtempSync(join(tmpdir(), 'genesis-mcp-'));
  const write = (rel, body) => { mkdirSync(dirname(join(repo, rel)), { recursive: true }); writeFileSync(join(repo, rel), body); };
  write('src/util.ts', 'export function helper() {}\n');
  write('src/service.ts', "import { helper } from './util';\nexport function serve() { helper(); }\n");
  write('src/other.ts', 'export function helper() {}\n');
  execFileSync(process.execPath, [graphizer, repo, '--write'], { stdio: 'ignore' });
  return repo;
}

// Drives the server the way a host does: newline-delimited JSON-RPC on stdio.
function converse(repo, requests) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [server, repo], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.on('error', reject);
    child.on('close', () => resolve(out.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))));
    for (const request of requests) child.stdin.write(`${JSON.stringify(request)}\n`);
    child.stdin.end();
  });
}
const body = (response) => JSON.parse(response.result.content[0].text);

test('handshakes, lists tools, and answers queries over stdio', async () => {
  const repo = fixture();
  const [init, list, callers, missing] = await converse(repo, [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_callers', arguments: { ref: 'src/util.ts#helper' } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_callers', arguments: { ref: 'nosuchthing' } } },
  ]);

  assert.equal(init.result.serverInfo.name, 'genesis-index');
  assert(init.result.capabilities.tools, 'declares tool capability');
  assert(list.result.tools.some((tool) => tool.name === 'get_impact'));
  for (const tool of list.result.tools) assert(tool.inputSchema.required.length, `${tool.name} declares required arguments`);

  assert.deepEqual(body(callers).map((r) => r.name), ['serve']);
  // A bad reference is a tool error the agent can read, not a dead server.
  assert.equal(missing.result.isError, true);
  assert.match(body === undefined ? '' : missing.result.content[0].text, /nothing matches/);
});

test('surfaces ambiguity rather than quietly choosing one match', async () => {
  const repo = fixture();
  const [, response] = await converse(repo, [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_callees', arguments: { ref: 'helper' } } },
  ]);
  const answer = body(response);
  assert(answer.resolved, 'says which one it used');
  assert.equal(answer.also_matched.length, 2, 'and names the ones it did not');
});

test('rejects an unknown method without dying', async () => {
  const repo = fixture();
  const [, bad, after] = await converse(repo, [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/nope' },
    { jsonrpc: '2.0', id: 3, method: 'ping' },
  ]);
  assert.equal(bad.error.code, -32601);
  assert.deepEqual(after.result, {}, 'still serving after a bad request');
});
