import test from 'node:test';
import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import { dashboardPage } from '../tools/dashboard.mjs';

test('panel escapes every content surface and keeps commands and receipt links inert', () => {
  const hostile = '</script><script>alert("injected")</script>';
  const task = { id: 'T-1', outcome: hostile, state: 'active', risk: 'medium', gates: [{ id: 'tests', effective_status: 'pass', evidence: { path: 'javascript:alert(1)' } }], scope: [], dependencies: [] };
  const state = { project: { name: hostile, objective: hostile }, lifecycle: { phase: 'build', status: 'active', active_task: 'T-1', next_action: hostile }, attempts: [], learning_proposals: [{ id: 'LR-1', rule: hostile, status: 'proposed' }], experiments: [] };
  const page = dashboardPage({ repo: "/tmp/repo's demo", state, tasks: [task], traces: [{ event: hostile, data: { text: hostile } }], hash: 'a'.repeat(64), instruction: hostile });
  assert.doesNotMatch(page, /<script>alert/);
  assert.doesNotMatch(page, /href="javascript:/);
  assert.match(page, /&lt;script&gt;alert/);
  assert.match(page, /Buttons copy CLI commands/);
  assert.match(page, /role="tablist"/);
  const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  assert.doesNotThrow(() => new Script(scripts[0][1]));
});
