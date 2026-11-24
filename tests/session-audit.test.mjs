import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const tool = fileURLToPath(new URL('../tools/session-audit.mjs', import.meta.url));
const lines = records => records.map(record => JSON.stringify(record)).join('\n') + '\n';

// Synthetic transcripts in the two shapes the tool reads. Nothing here comes from a real session.
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'genesis-audit-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const claude = join(root, 'claude', '-work-shop'), codex = join(root, 'codex', '2026', '01', '02');
  mkdirSync(join(claude, 'aaaaaaaa-0000-4000-8000-000000000001', 'subagents'), { recursive: true });
  mkdirSync(codex, { recursive: true });
  const user = (content, extra = {}) => ({ type: 'user', timestamp: '2026-01-01T10:00:00Z', cwd: '/work/shop', message: { content }, ...extra });
  const bash = (id, command) => ({ type: 'assistant', timestamp: '2026-01-01T10:01:00Z', message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } });
  const result = (id, content, is_error = false) => user([{ type: 'tool_result', tool_use_id: id, content, is_error }]);
  writeFileSync(join(claude, 'aaaaaaaa-0000-4000-8000-000000000001.jsonl'), lines([
    user('SECRET-PROMPT build the checkout page'),
    bash('t1', 'genesis brief . && node /opt/kit/tools/genesis.mjs task add . --id T-1'), result('t1', 'ok'),
    bash('t2', 'for t in T-1 T-2; do genesis control approve . $t --gate independent-review --human Owner --reason ok; done'), result('t2', 'ok'),
    bash('t3', 'cat > NOTES.md <<EOF\nRun the genesis control approve step later.\nEOF'), result('t3', 'boom', true),
    bash('t4', 'rm -rf build'), result('t4', "The user doesn't want to proceed with this tool use.", true),
    user('<task-notification>agent finished</task-notification>'),
    user('<pasted_content id="1">a pasted brief</pasted_content>'),
    user('[Request interrupted by user]'),
    user('<command-name>/model</command-name><command-args></command-args>'),
    user('hidden', { isMeta: true }),
    bash('t5', 'genesis trace . --event papercut --message "tried x; expected y; got z; fix w"; genesis checkpoint .'), result('t5', 'ok'),
    { type: 'pr-link', prUrl: 'https://example.test/shop/pull/7' }, { type: 'pr-link', prUrl: 'https://example.test/shop/pull/7' },
  ]));
  writeFileSync(join(claude, 'aaaaaaaa-0000-4000-8000-000000000001', 'subagents', 'agent-1.jsonl'), lines([user('subagent brief'), bash('s1', 'genesis status .')]));
  const item = payload => ({ type: 'response_item', timestamp: '2026-01-02T09:00:00Z', payload });
  writeFileSync(join(codex, 'rollout-2026-01-02T09-00-00-bbbbbbbb-0000-4000-8000-000000000002.jsonl'), lines([
    { type: 'session_meta', payload: { cwd: '/work/depot' } },
    item({ type: 'message', role: 'user', content: [{ type: 'input_text', text: '<heartbeat><automation_id>1</automation_id></heartbeat>' }] }),
    item({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'SECRET-PROMPT fix the invoice export' }] }),
    item({ type: 'function_call', name: 'shell', arguments: JSON.stringify({ command: 'genesis plan approve . --human Owner --reason "said go"' }) }),
    item({ type: 'function_call', name: 'shell', arguments: JSON.stringify({ command: 'npm test' }) }),
    { type: 'compacted', payload: {} },
  ]));
  return root;
}

test('session audit counts turns, tool use and Genesis commands without printing transcript text', t => {
  const root = fixture(t);
  const run = (...extra) => spawnSync(process.execPath, [tool, '--claude', join(root, 'claude'), '--codex', join(root, 'codex'), ...extra], { encoding: 'utf8' });
  const json = run('--json');
  assert.equal(json.status, 0, json.stderr);
  const [claude, codex] = JSON.parse(json.stdout);
  assert.equal(claude.agent, 'claude');
  assert.equal(claude.human_turns, 2, 'the prompt and the pasted brief; not the notification, bare slash command, meta or interrupt');
  assert.equal(claude.interruptions, 1);
  assert.equal(claude.tool_calls, 5);
  assert.equal(claude.tool_errors, 1);
  assert.equal(claude.refused_tool_calls, 1);
  assert.deepEqual(claude.genesis_commands, { brief: 1, task: 1, control: 1, trace: 1, checkpoint: 1 });
  assert.equal(claude.approvals_run_by_agent, 1, 'a loop is one written command; text inside a here-document is not a command');
  assert.equal(claude.papercuts, 1);
  assert.equal(claude.checkpointed, true);
  assert.deepEqual(claude.pull_requests, ['https://example.test/shop/pull/7']);
  assert.equal(codex.agent, 'codex');
  assert.equal(codex.cwd, '/work/depot');
  assert.equal(codex.human_turns, 1);
  assert.equal(codex.tool_calls, 2);
  assert.equal(codex.tool_errors, null);
  assert.equal(codex.compactions, 1);
  assert.deepEqual(codex.genesis_commands, { plan: 1 });
  assert.equal(codex.approvals_run_by_agent, 1);
  assert.doesNotMatch(json.stdout, /SECRET-PROMPT|pasted brief|said go/);

  const table = run();
  assert.match(table.stdout, /^date\s+agent\s+session/);
  assert.match(table.stdout, /2026-01-01\s+claude\s+aaaaaaaa\s+shop\s+2\s+1\s+1\s+5\s+1\s+5\s+1\s+1\s+yes\s+1/);
  assert.doesNotMatch(table.stdout, /SECRET-PROMPT/);
  assert.equal(JSON.parse(run('--json', '--since', '2026-01-02').stdout).length, 1);
  assert.equal(JSON.parse(run('--json', '--project', 'depot').stdout)[0].agent, 'codex');
});
