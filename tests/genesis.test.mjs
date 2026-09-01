import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'tools', 'genesis.mjs');

function tempRepo() {
  const repo = mkdtempSync(join(tmpdir(), 'genesis-test-'));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'genesis@example.test'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Genesis Test'], { cwd: repo });
  writeFileSync(join(repo, 'README.md'), '# Fixture\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: repo });
  return repo;
}

function run(args, { ok = true } = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  if (ok && result.status !== 0) assert.fail(`command failed: ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  if (!ok) assert.notEqual(result.status, 0, `command unexpectedly passed: ${args.join(' ')}`);
  return result;
}

function state(repo) {
  return JSON.parse(readFileSync(join(repo, '.genesis', 'project.json'), 'utf8'));
}

test('init creates the minimal policy, knowledge handoff, dashboard, graph, and local ignore', () => {
  const repo = tempRepo();
  run(['init', repo, '--name', 'fresh', '--objective', 'Prove cold starts work']);
  const project = state(repo);
  assert.equal(project.project.name, 'fresh');
  assert.equal(project.policy.ponytail, 'full');
  assert.equal(project.policy.learned_rule_promotion, 'human-required');
  assert.match(readFileSync(join(repo, '.genesis', 'KICKOFF.md'), 'utf8'), /Prove cold starts work/);
  assert.match(readFileSync(join(repo, '.genesis', 'dashboard.html'), 'utf8'), /refreshes every 5 seconds/);
  assert.equal(readFileSync(join(repo, '.genesis', 'local', '.gitignore'), 'utf8'), '*\n!.gitignore\n');
  assert.ok(existsSync(join(repo, '.genesis', 'index', 'graph.json')));
});

test('init refuses to overwrite an existing spine', () => {
  const repo = tempRepo();
  run(['init', repo]);
  const before = readFileSync(join(repo, '.genesis', 'project.json'));
  run(['init', repo], { ok: false });
  assert.deepEqual(readFileSync(join(repo, '.genesis', 'project.json')), before);
});

test('adopt is read-only until --write', () => {
  const repo = tempRepo();
  writeFileSync(join(repo, 'app.py'), 'def hello():\n    return "hi"\n');
  const report = JSON.parse(run(['adopt', repo]).stdout);
  assert.equal(report.files, 2);
  assert.deepEqual(report.languages, ['python']);
  assert.equal(existsSync(join(repo, '.genesis')), false);
  run(['adopt', repo, '--write', '--objective', 'Adopt safely']);
  assert.equal(state(repo).project.mode, 'adopt');
});

test('gate proof fails closed, records provenance, and becomes stale after source change', () => {
  const repo = tempRepo();
  run(['init', repo]);
  run(['task', 'add', repo, '--id', 'T-1', '--outcome', 'Ship one thing', '--gate', 'tests:node -e "process.exit(0)"']);
  run(['task', 'complete', repo, '--id', 'T-1'], { ok: false });
  run(['gate', repo, 'T-1']);
  const proof = JSON.parse(readFileSync(join(repo, '.genesis', 'evidence', 'T-1-tests.json'), 'utf8'));
  assert.equal(proof.exit_code, 0);
  assert.equal(proof.environment.node, process.version);
  assert.ok(proof.source_hash);
  writeFileSync(join(repo, 'README.md'), '# changed\n');
  const status = JSON.parse(run(['status', repo, '--json']).stdout);
  assert.equal(status.tasks[0].gates[0].effective_status, 'stale');
  run(['task', 'complete', repo, '--id', 'T-1'], { ok: false });
  run(['gate', repo, 'T-1']);
  run(['task', 'complete', repo, '--id', 'T-1']);
  assert.equal(state(repo).tasks[0].state, 'done');
});

test('medium-risk tasks require independent human-reviewed evidence', () => {
  const repo = tempRepo();
  run(['init', repo]);
  run(['task', 'add', repo, '--id', 'T-2', '--risk', 'medium', '--owner', 'maker', '--outcome', 'Risky thing', '--gate', 'tests:node -e "process.exit(0)"']);
  assert.equal(state(repo).tasks[0].gates.some((gate) => gate.id === 'independent-review'), true);
  run(['gate', repo, 'T-2']);
  run(['task', 'complete', repo, '--id', 'T-2'], { ok: false });
  run(['control', 'approve', repo, 'T-2', '--human', 'reviewer'], { ok: false });
  run(['control', 'approve', repo, 'T-2', '--gate', 'tests', '--human', 'reviewer'], { ok: false });
  run(['control', 'approve', repo, 'T-2', '--gate', 'independent-review'], { ok: false });
  run(['control', 'approve', repo, 'T-2', '--gate', 'independent-review', '--human', 'maker'], { ok: false });
  run(['control', 'approve', repo, 'T-2', '--gate', 'independent-review', '--human', 'reviewer', '--reason', 'diff and proof checked']);
  run(['task', 'complete', repo, '--id', 'T-2']);
});

test('pause blocks task work until an explicit control resume', () => {
  const repo = tempRepo();
  run(['init', repo]);
  run(['task', 'add', repo, '--id', 'T-pause', '--outcome', 'Respect operator control', '--gate', 'tests:node -e "process.exit(0)"']);
  run(['control', 'pause', repo, 'T-pause', '--human', 'operator', '--reason', 'hold']);
  run(['gate', repo, 'T-pause'], { ok: false });
  run(['task', 'set', repo, '--id', 'T-pause', '--next', 'This must not land'], { ok: false });
  assert.notEqual(state(repo).tasks[0].next_action, 'This must not land');
  run(['control', 'resume', repo, 'T-pause', '--human', 'operator']);
  run(['gate', repo, 'T-pause']);
});

test('unsafe identifiers and invalid profiles fail before writing paths', () => {
  const repo = tempRepo();
  run(['init', repo, '--profile', 'anything-goes'], { ok: false });
  assert.equal(existsSync(join(repo, '.genesis')), false);
  run(['init', repo]);
  run(['task', 'add', repo, '--id', '../escape', '--outcome', 'Nope'], { ok: false });
  run(['task', 'add', repo, '--id', 'T-safe', '--outcome', 'Safe', '--gate', '../proof:node -e "process.exit(0)"'], { ok: false });
  assert.equal(state(repo).tasks.length, 0);
  assert.equal(existsSync(join(repo, 'escape-tests.json')), false);
});

test('local traces redact credentials and are ignored by git', () => {
  const repo = tempRepo();
  run(['init', repo]);
  run(['trace', repo, '--event', 'tool.error', '--message', 'token=abc123 password=hunter2 Authorization: Bearer topsecret']);
  run(['trace', repo, '--event', 'structured.secret', '--data', '{"token":"structured-secret","safe":"visible"}']);
  const event = readFileSync(join(repo, '.genesis', 'local', 'events.jsonl'), 'utf8');
  assert.doesNotMatch(event, /abc123|hunter2|topsecret|structured-secret/);
  assert.match(event, /REDACTED/);
  assert.match(readFileSync(join(repo, '.genesis', 'dashboard.html'), 'utf8'), /structured\.secret/);
  execFileSync('git', ['add', '.genesis'], { cwd: repo });
  const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: repo, encoding: 'utf8' });
  assert.doesNotMatch(staged, /events\.jsonl/);
});

test('learning proposals cannot activate without regression, rollback, review, and a human', () => {
  const repo = tempRepo();
  run(['init', repo]);
  run(['learn', 'propose', repo, '--id', 'LR-1', '--rule', 'Reuse the shared parser']);
  run(['learn', 'approve', repo, '--id', 'LR-1', '--human', 'owner', '--review', 'pass'], { ok: false });
  run(['learn', 'propose', repo, '--id', 'LR-2', '--rule', 'Reuse the shared parser', '--regression', 'node --test', '--rollback', 'deactivate LR-2']);
  run(['learn', 'approve', repo, '--id', 'LR-2', '--human', 'owner', '--review', 'pass']);
  assert.equal(state(repo).learning_proposals.find((item) => item.id === 'LR-2').status, 'active');
});

test('dashboard escapes project-controlled text', () => {
  const repo = tempRepo();
  run(['init', repo, '--name', '<script>alert(1)</script>']);
  const dashboard = readFileSync(join(repo, '.genesis', 'dashboard.html'), 'utf8');
  assert.doesNotMatch(dashboard, /<script>alert/);
  assert.match(dashboard, /&lt;script&gt;/);
});

test('migration preserves every legacy file and is idempotent', () => {
  const repo = tempRepo();
  mkdirSync(join(repo, '.genesis', 'decisions'), { recursive: true });
  writeFileSync(join(repo, '.genesis', 'PLAN.md'), '# old plan\n');
  writeFileSync(join(repo, '.genesis', 'decisions', '0001.md'), '# old decision\n');
  const dry = JSON.parse(run(['migrate', repo]).stdout);
  assert.equal(dry.preserved, true);
  assert.equal(existsSync(join(repo, '.genesis', 'project.json')), false);
  run(['migrate', repo, '--write']);
  assert.equal(readFileSync(join(repo, '.genesis', 'PLAN.md'), 'utf8'), '# old plan\n');
  assert.equal(readFileSync(join(repo, '.genesis', 'decisions', '0001.md'), 'utf8'), '# old decision\n');
  run(['migrate', repo, '--write']);
});

test('cold-session state is reconstructable by a second process', () => {
  const repo = tempRepo();
  run(['init', repo, '--objective', 'Build a resumable project']);
  run(['task', 'add', repo, '--id', 'T-3', '--outcome', 'Create the first slice', '--next', 'Write the failing proof']);
  run(['task', 'set', repo, '--id', 'T-3', '--blocker', 'Need the API contract', '--failure', 'First contract contradicted production behavior', '--limitation', 'No production trace yet']);
  run(['record', 'decision', repo, '--id', 'ADR-1', '--title', 'Use one ledger', '--text', 'Generated views are not writable truth']);
  run(['record', 'knowledge', repo, '--id', 'K-1', '--title', 'API behavior', '--text', 'The API rejects missing workspace IDs', '--source', 'integration test']);
  run(['checkpoint', repo]);
  const kickoff = readFileSync(join(repo, '.genesis', 'KICKOFF.md'), 'utf8');
  assert.match(kickoff, /Build a resumable project/);
  assert.match(kickoff, /T-3 — Create the first slice/);
  assert.match(kickoff, /Need the API contract/);
  assert.match(kickoff, /Write the failing proof/);
  assert.match(kickoff, /First contract contradicted production behavior/);
  assert.match(kickoff, /ADR-1: Use one ledger/);
  assert.match(kickoff, /K-1: API behavior/);
  const second = run(['status', repo, '--json']);
  assert.equal(JSON.parse(second.stdout).lifecycle.active_task, 'T-3');
});

test('new-product workflow blocks implementation until an approved specification and plan', () => {
  const repo = tempRepo();
  run(['init', repo, '--workflow', 'new-product', '--objective', 'Build a clinic scheduler']);
  let project = state(repo);
  assert.equal(project.lifecycle.phase, 'discovery');
  assert.equal(project.lifecycle.active_task, 'SPEC-1');
  assert.match(readFileSync(join(repo, '.genesis', 'KICKOFF.md'), 'utf8'), /Do not write product implementation code/);
  assert.ok(existsSync(join(repo, 'SPEC.md')));
  run(['task', 'add', repo, '--id', 'T-early', '--outcome', 'Code too soon'], { ok: false });
  run(['spec', 'check', repo], { ok: false });

  writeFileSync(join(repo, 'SPEC.md'), `# Product specification

## Problem
Clinics need conflict-free scheduling.
## Users
Clinic staff.
## Functional requirements
- FR-1: Staff can create appointments.
## Non-functional requirements
- NFR-1: Tenant data remains isolated.
## Constraints
- Node.js 18+.
## Non-goals
- Patient self-service.
## Acceptance criteria
- AC-1: An integration test creates an appointment.
## Risks
- Incorrect tenant boundaries.
## Open questions
- None.
`);
  run(['spec', 'check', repo]);
  assert.match(readFileSync(join(repo, '.genesis', 'KICKOFF.md'), 'utf8'), /Present the checked SPEC\.md.*Do not write product implementation code/);
  writeFileSync(join(repo, 'SPEC.md'), `${readFileSync(join(repo, 'SPEC.md'), 'utf8')}\n<!-- clarification -->\n`);
  run(['spec', 'approve', repo, '--human', 'owner', '--reason', 'reviewed'], { ok: false });
  run(['spec', 'check', repo]);
  run(['spec', 'approve', repo, '--human', 'owner'], { ok: false });
  run(['spec', 'approve', repo, '--human', 'owner', '--reason', 'requirements reviewed']);
  assert.equal(state(repo).lifecycle.phase, 'planning');

  run(['task', 'add', repo, '--id', 'T-missing', '--outcome', 'Missing traceability', '--gate', 'tests:node -e "process.exit(0)"'], { ok: false });
  run(['task', 'add', repo, '--id', 'T-unknown', '--outcome', 'Unknown traceability', '--requirement', 'FR-99', '--gate', 'tests:node -e "process.exit(0)"'], { ok: false });
  run(['task', 'add', repo, '--id', 'T-1', '--outcome', 'Create appointments safely', '--risk', 'medium', '--requirement', 'FR-1', '--requirement', 'NFR-1', '--requirement', 'AC-1', '--gate', 'tests:node -e "process.exit(0)"']);
  assert.equal(state(repo).tasks.find((task) => task.id === 'T-1').state, 'queued');
  run(['plan', 'approve', repo, '--human', 'owner', '--reason', 'reviewed'], { ok: false });
  run(['plan', 'check', repo]);
  run(['plan', 'approve', repo, '--human', 'owner'], { ok: false });
  run(['plan', 'approve', repo, '--human', 'owner', '--reason', 'reviewed']);
  project = state(repo);
  assert.equal(project.lifecycle.phase, 'build');
  assert.equal(project.lifecycle.active_task, 'T-1');
  assert.match(readFileSync(join(repo, '.genesis', 'PLAN.md'), 'utf8'), /FR-1, NFR-1, AC-1/);
  run(['task', 'add', repo, '--id', 'T-late', '--outcome', 'Bypass approval', '--requirement', 'FR-1', '--gate', 'tests:node -e "process.exit(0)"'], { ok: false });
  run(['plan', 'reopen', repo, '--human', 'owner', '--reason', 'too soon'], { ok: false });
  run(['gate', repo, 'T-1']);
  run(['control', 'approve', repo, 'T-1', '--gate', 'independent-review', '--human', 'reviewer', '--reason', 'reviewed']);
  run(['task', 'complete', repo, '--id', 'T-1']);
  run(['plan', 'reopen', repo, '--human', 'owner', '--reason', 'Add the next approved slice']);
  run(['task', 'add', repo, '--id', 'T-2', '--outcome', 'Continue the product', '--requirement', 'FR-1', '--requirement', 'NFR-1', '--requirement', 'AC-1', '--gate', 'tests:node -e "process.exit(0)"']);
  assert.equal(state(repo).lifecycle.phase, 'planning');
});

test('specification changes stale approval and agent connection preserves repository instructions', () => {
  const repo = tempRepo();
  run(['init', repo, '--workflow', 'new-product', '--objective', 'Build one thing']);
  writeFileSync(join(repo, 'SPEC.md'), `# Spec
## Problem
One problem.
## Users
One user.
## Functional requirements
- FR-1: One feature.
## Non-functional requirements
- NFR-1: One quality.
## Constraints
- Local.
## Non-goals
- Everything else.
## Acceptance criteria
- AC-1: One proof.
## Risks
- One risk.
## Open questions
- None.
`);
  run(['spec', 'check', repo]);
  run(['spec', 'approve', repo, '--human', 'owner', '--reason', 'reviewed']);
  writeFileSync(join(repo, 'SPEC.md'), `${readFileSync(join(repo, 'SPEC.md'), 'utf8')}\nChanged after approval.\n`);
  assert.equal(JSON.parse(run(['spec', 'status', repo]).stdout).status, 'stale');
  run(['plan', 'check', repo], { ok: false });

  writeFileSync(join(repo, 'AGENTS.md'), '# Existing instructions\n');
  const dry = JSON.parse(run(['agent', 'connect', repo]).stdout);
  assert.equal(dry.dry_run, true);
  assert.equal(existsSync(join(repo, 'CLAUDE.md')), false);
  run(['agent', 'connect', repo, '--write']);
  run(['agent', 'connect', repo, '--write']);
  const agents = readFileSync(join(repo, 'AGENTS.md'), 'utf8');
  assert.match(agents, /# Existing instructions/);
  assert.equal((agents.match(/<!-- genesis:start -->/g) || []).length, 1);
  assert.match(readFileSync(join(repo, 'CLAUDE.md'), 'utf8'), /\.genesis\/KICKOFF\.md/);
});

test('workflow init refuses an existing specification without leaving partial state', () => {
  const repo = tempRepo();
  writeFileSync(join(repo, 'SPEC.md'), '# Existing spec\n');
  run(['init', repo, '--workflow', 'new-product'], { ok: false });
  assert.equal(existsSync(join(repo, '.genesis')), false);
  assert.equal(readFileSync(join(repo, 'SPEC.md'), 'utf8'), '# Existing spec\n');
});

test('an existing task-only Genesis project can start specification explicitly', () => {
  const repo = tempRepo();
  run(['init', repo, '--objective', 'Start plain, specify later']);
  const projectPath = join(repo, '.genesis', 'project.json');
  const legacyV2 = JSON.parse(readFileSync(projectPath, 'utf8'));
  delete legacyV2.artifacts;
  writeFileSync(projectPath, `${JSON.stringify(legacyV2, null, 2)}\n`);
  run(['spec', 'start', repo]);
  assert.equal(state(repo).workflow.type, 'new-product');
  run(['agent', 'connect', repo, '--codex', '--write']);
  assert.ok(existsSync(join(repo, 'AGENTS.md')));
  assert.equal(existsSync(join(repo, 'CLAUDE.md')), false);
});
