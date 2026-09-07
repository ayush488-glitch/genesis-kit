import assert from 'node:assert/strict';
import { spawnSync, spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
const cli = fileURLToPath(new URL('../tools/genesis.mjs', import.meta.url));
function run(args, ok = true) {
  const r = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  assert.equal(r.status === 0, ok, `${args.join(' ')}\n${r.stdout}\n${r.stderr}`); return r;
}
function fixture(t) {
  const p = mkdtempSync(join(tmpdir(), 'genesis-autonomy-'));
  t.after(() => rmSync(p, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', p]);
  writeFileSync(join(p, 'app.txt'), 'before'); run(['init', p]); return p;
}
const state = p => JSON.parse(readFileSync(join(p, '.genesis/project.json')));
const editState = (p, fn) => { const s = state(p); fn(s); writeFileSync(join(p, '.genesis/project.json'), JSON.stringify(s)); };
const add = (p, extra = []) => run(['task', 'add', p, '--id', 'T-1', '--outcome', 'Complete behavior', ...extra]);
const gate = ['--gate', 'check:node -e "process.exit(0)"'];
const scenario = JSON.stringify({ id: 'happy', actor: 'user', scope: 'app.txt', environment: 'test', duration: 'one operation', observable: 'expected output', gate: 'check' });
function authorize(p, command) { run(['authorize', 'grant', p, '--id', 'A-1', '--task', 'T-1', '--command', command, '--human', 'owner', '--reason', 'fixture', '--expires', new Date(Date.now() + 60000).toISOString()]); }

test('completion bypasses, absent prerequisites and reserved review commands fail closed', t => {
  const p = fixture(t); add(p);
  run(['task', 'set', p, '--id', 'T-1', '--state', 'done'], false);
  run(['task', 'complete', p, '--id', 'T-1'], false);
  run(['task', 'add', p, '--id', 'T-2', '--outcome', 'invalid dependency', '--depends', 'missing', ...gate], false);
  run(['task', 'add', p, '--id', 'T-3', '--outcome', 'fake review', '--risk', 'high', '--gate', 'independent-review:true'], false);
  assert.equal(state(p).tasks[0].state, 'active');
});

test('proof deletion and tampering prevent completion; repeated gates preserve old attempts', t => {
  const p = fixture(t); add(p, gate); run(['gate', p]);
  const first = state(p).tasks[0].gates[0].evidence.path;
  run(['gate', p]); const second = state(p).tasks[0].gates[0].evidence.path;
  assert.notEqual(first, second); assert.ok(readFileSync(join(p, first)).length);
  const proof = JSON.parse(readFileSync(join(p, second))); proof.exit_code = 17;
  writeFileSync(join(p, second), JSON.stringify(proof)); run(['task', 'complete', p, '--id', 'T-1'], false);
  run(['gate', p]); rmSync(join(p, state(p).tasks[0].gates[0].evidence.path));
  run(['task', 'complete', p, '--id', 'T-1'], false);
});

test('a successful command that changes its inputs cannot certify those inputs', t => {
  const p = fixture(t); add(p, ['--gate', `check:node -e "require('fs').writeFileSync('app.txt','changed')"`]);
  run(['gate', p], false); assert.equal(state(p).attempts[0].status, 'failed');
  run(['task', 'complete', p, '--id', 'T-1'], false);
});

test('runtime receipts must identify the current source and scenario environment', t => {
  const p = fixture(t);
  add(p, ['--scenario', scenario, '--runtime', `check:node -e "console.log(JSON.stringify({build:'v1',endpoint:'local',environment:'wrong',source_hash:process.env.GENESIS_SOURCE_HASH}))"`]);
  run(['gate', p], false); run(['task', 'complete', p, '--id', 'T-1'], false);
});

test('runner resumes after human review without replaying a successful worker', t => {
  const p = fixture(t); add(p, [...gate, '--scope', 'app.txt', '--scenario', scenario, '--risk', 'medium', '--owner', 'maker']);
  authorize(p, `node -e "require('fs').appendFileSync('app.txt','!')"`);
  run(['run', p], false);
  assert.equal(readFileSync(join(p, 'app.txt'), 'utf8'), 'before!');
  run(['control', 'approve', p, 'T-1', '--gate', 'independent-review', '--human', 'reviewer', '--reason', 'checked']);
  run(['run', p]);
  assert.equal(readFileSync(join(p, 'app.txt'), 'utf8'), 'before!');
  assert.equal(state(p).tasks[0].state, 'done');
  assert.equal(state(p).attempts.filter(a => a.kind === 'worker').length, 1);
});

test('revoked authorization and out-of-scope writes stop bounded execution', t => {
  const p = fixture(t); add(p, [...gate, '--scope', 'app.txt', '--scenario', scenario]);
  authorize(p, `node -e "require('fs').writeFileSync('other.txt','oops')"`);
  run(['run', p], false); assert.equal(state(p).tasks[0].state, 'blocked');
  assert.equal(state(p).attempts[0].stop_reason, 'scope-violation');
  run(['authorize', 'revoke', p, '--id', 'A-1', '--human', 'owner', '--reason', 'stop']);
  run(['control', 'resume', p, 'T-1', '--human', 'owner']); run(['run', p], false);
});

test('operator pause interrupts a real gate and survives its final state write', async t => {
  const p = fixture(t); add(p, ['--gate', 'check:node -e "setTimeout(()=>{},30000)"']);
  const child = spawn(process.execPath, [cli, 'gate', p], { stdio: 'ignore' });
  t.after(() => child.kill()); const done = new Promise(resolve => child.on('close', resolve));
  for (let i = 0; i < 150 && !state(p).attempts[0]?.child_pid; i++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(state(p).attempts[0]?.child_pid);
  run(['control', 'pause', p, 'T-1', '--human', 'owner']);
  assert.notEqual(await done, 0); assert.equal(state(p).tasks[0].state, 'paused');
  assert.equal(state(p).attempts[0].status, 'failed');
});

test('recovery blocks interrupted work and never replays it', t => {
  const p = fixture(t); add(p, gate);
  editState(p, s => s.attempts.push({ id: 'dead-attempt', task: 'T-1', kind: 'worker', status: 'running', pid: 99999999 }));
  run(['recover', p]); assert.equal(state(p).tasks[0].state, 'blocked');
  assert.equal(state(p).attempts[0].status, 'interrupted');
  assert.equal(readFileSync(join(p, 'app.txt'), 'utf8'), 'before');
});

test('context excludes superseded knowledge and respects its byte budget', t => {
  const p = fixture(t); add(p, [...gate, '--scope', 'app.txt']);
  run(['record', 'knowledge', p, '--id', 'K-1', '--title', 'Old', '--text', 'obsolete']);
  run(['record', 'knowledge', p, '--id', 'K-2', '--title', 'Current', '--text', 'correct', '--supersedes', 'K-1']);
  const out = run(['context', p, '--bytes', '2000']).stdout;
  assert.ok(Buffer.byteLength(out.trim()) <= 2000); assert.doesNotMatch(out, /obsolete/); assert.match(out, /correct/);
});

test('learning needs held-out success, a matching policy artifact and separate promotion', t => {
  const p = fixture(t), base = join(p, '.genesis/local/base'), candidate = join(p, '.genesis/local/candidate');
  for (const dir of [base, candidate]) { mkdirSync(dir); execFileSync('git', ['init', '-q', dir]); }
  writeFileSync(join(base, 'answer.txt'), 'bad'); writeFileSync(join(candidate, 'answer.txt'), 'good');
  writeFileSync(join(candidate, 'policy.json'), JSON.stringify({ rule: 'Check the observed result' }));
  const evaluator = join(p, '.genesis/local/evaluate.mjs');
  writeFileSync(evaluator, `import {readFileSync} from 'node:fs';console.log(JSON.stringify({pass:readFileSync(process.argv[2]+'/answer.txt','utf8')==='good'}));`);
  const suite = join(p, '.genesis/local/suite.json');
  writeFileSync(suite, JSON.stringify({ evaluator, cases: ['development', 'holdout'].map(split => ({ id: split, split, command: 'node -e "process.exit(0)"' })) }));
  run(['evaluate', p, '--baseline', base, '--candidate', candidate, '--suite', suite]);
  const experiment = state(p).experiments[0].id;
  run(['learn', 'propose', p, '--id', 'LR-1', '--rule', 'Check the observed result', '--rollback', 'deactivate']);
  run(['learn', 'evaluate', p, '--id', 'LR-1', '--experiment', experiment], false);
  run(['learn', 'evaluate', p, '--id', 'LR-1', '--experiment', experiment, '--policy', 'policy.json']);
  run(['learn', 'review', p, '--id', 'LR-1', '--human', 'reviewer', '--reason', 'inspected cases']);
  run(['learn', 'approve', p, '--id', 'LR-1', '--human', 'reviewer', '--reason', 'same person'], false);
  run(['learn', 'approve', p, '--id', 'LR-1', '--human', 'owner', '--reason', 'adopt']);
  assert.match(run(['context', p]).stdout, /Check the observed result/);
  run(['learn', 'rollback', p, '--id', 'LR-1', '--human', 'owner', '--reason', 'undo']);
  assert.equal(JSON.parse(run(['context', p]).stdout).rules.length, 0);
  writeFileSync(join(candidate, 'answer.txt'), 'bad');
  run(['evaluate', p, '--baseline', base, '--candidate', candidate, '--suite', suite], false);
  assert.equal(state(p).experiments[1].status, 'fail');
});

test('dependency completion activates only eligible queued work', t => {
  const p = fixture(t); add(p, gate);
  run(['task', 'add', p, '--id', 'T-2', '--outcome', 'Follow-up', '--depends', 'T-1', ...gate]);
  assert.equal(state(p).tasks[1].state, 'queued');
  run(['control', 'resume', p, 'T-2'], false);
  run(['gate', p]); run(['task', 'complete', p, '--id', 'T-1']);
  assert.equal(state(p).lifecycle.active_task, 'T-2');
});

test('proof follows configured environment and approval follows exact gate attempts', t => {
  const p = fixture(t); add(p, [...gate, '--env', 'GENESIS_TEST_INPUT', '--risk', 'medium']);
  const envRun = spawnSync(process.execPath, [cli, 'gate', p], { env: { ...process.env, GENESIS_TEST_INPUT: 'a' }, encoding: 'utf8' });
  assert.equal(envRun.status, 0, envRun.stderr);
  run(['control', 'approve', p, 'T-1', '--gate', 'independent-review', '--human', 'reviewer', '--reason', 'stale env'], false);
  run(['gate', p]);
  run(['control', 'approve', p, 'T-1', '--gate', 'independent-review', '--human', 'reviewer', '--reason', 'current']);
  run(['gate', p]); run(['task', 'complete', p, '--id', 'T-1'], false);
});

test('worker timeout blocks work without silently retrying', t => {
  const p = fixture(t); add(p, [...gate, '--scope', 'app.txt', '--scenario', scenario]);
  authorize(p, 'node -e "setTimeout(()=>{},30000)"');
  run(['run', p, '--timeout', '400'], false);
  assert.equal(state(p).attempts[0].stop_reason, 'timeout');
  assert.equal(state(p).tasks[0].state, 'blocked');
  run(['run', p], false); assert.equal(state(p).attempts.length, 1);
});

test('live writers cannot have their attempt stolen by recovery', async t => {
  const p = fixture(t); add(p, ['--gate', 'check:node -e "setTimeout(()=>{},30000)"']);
  const child = spawn(process.execPath, [cli, 'gate', p], { stdio: 'ignore' });
  t.after(() => child.kill()); const done = new Promise(resolve => child.on('close', resolve));
  for (let i = 0; i < 150 && !state(p).attempts[0]?.child_pid; i++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(state(p).attempts[0]?.child_pid); run(['recover', p], false);
  child.kill('SIGTERM'); await done;
  assert.equal(state(p).attempts[0].status, 'failed');
});

test('revocation during runner verification cancels the gate before completion', async t => {
  const p = fixture(t);
  add(p, ['--gate', 'check:node -e "setTimeout(()=>{},30000)"', '--scope', 'app.txt', '--scenario', scenario]);
  authorize(p, 'node -e "process.exit(0)"');
  const child = spawn(process.execPath, [cli, 'run', p], { stdio: 'ignore' });
  t.after(() => child.kill()); const done = new Promise(resolve => child.on('close', resolve));
  for (let i = 0; i < 200 && !state(p).attempts.some(a => a.kind === 'gate' && a.child_pid); i++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(state(p).attempts.some(a => a.kind === 'gate' && a.child_pid));
  run(['authorize', 'revoke', p, '--id', 'A-1']);
  assert.notEqual(await done, 0);
  assert.equal(state(p).attempts.at(-1).stop_reason, 'authorization-expired');
  assert.notEqual(state(p).tasks[0].state, 'done');
});


test('internal symlink inputs work through repository aliases and stale with their target', t => {
  const p = fixture(t); symlinkSync('app.txt', join(p, 'alias.txt')); add(p, gate);
  const alias = join(p, '.genesis/local/repo-alias'); symlinkSync(p, alias);
  run(['gate', alias]); writeFileSync(join(p, 'app.txt'), 'updated');
  run(['task', 'complete', p, '--id', 'T-1'], false);
});
