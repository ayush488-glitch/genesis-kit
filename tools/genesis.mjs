#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import {
  appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync,
  lstatSync, statSync, writeFileSync, readlinkSync, realpathSync, rmSync, cpSync, mkdtempSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { dashboardPage } from './dashboard.mjs';

const SCHEMA_VERSION = 2;
const RISK = new Set(['low', 'medium', 'high', 'critical']);
const TASK_STATES = new Set(['queued', 'active', 'paused', 'blocked', 'failed', 'verified', 'done', 'rejected']);
const CONTROL_ACTIONS = new Set(['approve', 'reject', 'pause', 'resume', 'retry', 'requeue', 'rollback']);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const PROFILES = new Set(['prototype', 'production', 'regulated']);
const WORKFLOWS = new Set(['new-product']);
const SPEC_SECTIONS = ['Problem', 'Users', 'Functional requirements', 'Non-functional requirements', 'Constraints', 'Non-goals', 'Acceptance criteria', 'Risks', 'Open questions'];

function fail(message, code = 1) {
  console.error(`genesis: ${message}`);
  process.exitCode = code;
  return null;
}

function parseArgs(input) {
  const positional = [];
  const options = {};
  for (let i = 0; i < input.length; i += 1) {
    const value = input[i];
    if (!value.startsWith('--')) {
      positional.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = input[i + 1];
    const parsed = !next || next.startsWith('--') ? true : next;
    if (parsed !== true) i += 1;
    if (key in options) options[key] = Array.isArray(options[key]) ? [...options[key], parsed] : [options[key], parsed];
    else options[key] = parsed;
  }
  return { positional, options };
}

function values(value) {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function now() {
  return new Date().toISOString();
}

function atomicWrite(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temp, content);
  renameSync(temp, path);
}

function writeJson(path, value) {
  atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`cannot read valid JSON at ${path}: ${error.message}`);
  }
}

function genesisDir(repo) {
  return join(repo, '.genesis');
}

function statePath(repo) {
  return join(genesisDir(repo), 'project.json');
}

function loadState(repo) {
  const path = statePath(repo);
  if (!existsSync(path)) throw new Error(`no Genesis v2 state at ${path}; run init, adopt --write, or migrate --write`);
  const state = readJson(path);
  state.artifacts ||= [];
  state.attempts ||= [];
  state.authorizations ||= [];
  state.experiments ||= [];
  state.incidents ||= [];
  validateState(state);
  return state;
}

function validateState(state) {
  if (state.schema_version !== SCHEMA_VERSION) throw new Error(`unsupported schema_version ${state.schema_version}`);
  if (!state.project?.name || !state.lifecycle || !Array.isArray(state.tasks)) throw new Error('project state is missing required fields');
  if (state.policy?.ponytail !== 'full') throw new Error('Ponytail full is required by project policy');
  if (state.workflow && (!WORKFLOWS.has(state.workflow.type) || !Array.isArray(state.artifacts))) throw new Error('invalid workflow state');
  const ids = new Set();
  for (const task of state.tasks) {
    if (!SAFE_ID.test(task.id) || ids.has(task.id)) throw new Error('duplicate or unsafe task id');
    ids.add(task.id);
    for (const gate of task.gates || []) {
      gate.kind ||= gate.command ? 'command' : 'review';
      if (!SAFE_ID.test(gate.id) || !['command', 'runtime', 'review'].includes(gate.kind) || (gate.id === 'independent-review' && gate.command) || (gate.kind === 'review' && gate.command)) throw new Error('invalid or executable review gate');
    }
    if (new Set((task.gates || []).map(g => g.id)).size !== (task.gates || []).length) throw new Error('duplicate gate id');
    if (!task.id || !TASK_STATES.has(task.state) || !RISK.has(task.risk) || !Array.isArray(task.gates)) {
      throw new Error(`invalid task record: ${task.id || '<missing id>'}`);
    }
  }
  const visited = new Set(), visiting = new Set();
  function visit(task) {
    if (visiting.has(task.id)) throw new Error('cyclic task dependency');
    if (visited.has(task.id)) return;
    visiting.add(task.id);
    for (const id of task.dependencies || []) { const dependency = state.tasks.find(t => t.id === id); if (!dependency) throw new Error('missing task dependency'); visit(dependency); }
    visiting.delete(task.id); visited.add(task.id);
  }
  state.tasks.forEach(visit);
}

function listFiles(root, { includeGenesis = false } = {}) {
  const ignored = new Set(['.git', 'node_modules', '.venv', 'venv', 'dist', 'build', 'coverage', '.next', '.cache', '__pycache__']);
  const files = [];
  function walk(dir) {
    for (const name of readdirSync(dir).sort()) {
      if (ignored.has(name) || name.startsWith('.DS_Store')) continue;
      if (!includeGenesis && name === '.genesis') continue;
      const path = join(dir, name);
      let stat;
      try { stat = lstatSync(path); } catch { continue; }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile()) files.push(path);
    }
  }
  walk(root);
  return files;
}

function digest(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function inputManifest(repo, extra = []) {
  let paths;
  try {
    paths = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\0').filter(Boolean);
  } catch { paths = listFiles(repo).map(path => relative(repo, path).split(sep).join('/')); }
  const result = {};
  for (const name of [...new Set([...paths.filter(name => name !== '.genesis' && !name.startsWith('.genesis/')), ...extra])].sort()) {
    const path = safePath(repo, name);
    let info;
    try { info = lstatSync(path); } catch { result[name] = 'missing'; continue; }
    if (info.isSymbolicLink()) {
      const target = realpathSync(path);
      if (relative(realpathSync(repo), target).startsWith('..') || !statSync(target).isFile()) throw new Error(`input symlink must target a file inside the repository: ${name}`);
      result[name] = digest(`${readlinkSync(path)}:${fileHash(target)}`);
    } else if (info.isFile()) result[name] = digest(`${info.mode & 0o111}:${fileHash(path)}`);
  }
  return result;
}

function contentHash(repo) { return digest(inputManifest(repo)); }

function safePath(repo, name) {
  if (typeof name !== 'string' || !name || name.includes('\0') || name.includes('\\') || name.startsWith('/') || name.split('/').includes('..')) throw new Error(`unsafe repository path: ${name}`);
  const path = resolve(repo, name);
  let parent = dirname(path);
  while (!existsSync(parent)) parent = dirname(parent);
  const rel = relative(realpathSync(repo), realpathSync(parent));
  if (rel === '..' || rel.startsWith(`..${sep}`)) throw new Error(`path escapes repository: ${name}`);
  return path;
}

function environment(task = {}) {
  return { node: process.version, platform: process.platform, arch: process.arch,
    verifier: fileHash(fileURLToPath(import.meta.url)),
    variables: Object.fromEntries((task.environment || []).map(name => [name, digest(process.env[name] ?? '<unset>')])) };
}

function taskConfig(state, task) {
  return digest({ policy: state.policy, spec: state.workflow?.spec_check?.source_hash,
    plan: state.workflow?.plan_approval?.source_hash, id: task.id, risk: task.risk,
    outcome: task.outcome, owner: task.owner, scope: task.scope, inputs: task.inputs, environment: task.environment, dependencies: task.dependencies,
    scenarios: task.scenarios, gates: task.gates.map(({ id, command, mandatory, kind, max_age }) => ({ id, command, mandatory, kind, max_age })) });
}

function proofStatus(repo, state, task, gate) {
  if (gate.status !== 'pass' || !gate.evidence) return gate.status || 'pending';
  const ref = gate.evidence;
  if (ref.source_hash !== digest(inputManifest(repo, task.inputs))) return 'stale';
  if (ref.config_hash !== taskConfig(state, task)) return 'stale';
  if (!ref.path) return 'missing';
  try {
    const proof = readJson(safePath(repo, ref.path));
    const { hash, ...body } = proof;
    if (hash !== digest(body) || hash !== ref.hash || proof.task !== task.id || proof.gate !== gate.id || proof.source_hash !== ref.source_hash || proof.config_hash !== ref.config_hash) return 'invalid';
    if (proof.kind !== (gate.kind || (gate.command ? 'command' : 'review'))) return 'invalid';
    if (gate.command) {
      if (proof.command !== gate.command || proof.exit_code !== 0 || proof.failure || proof.before_hash !== proof.source_hash) return 'invalid';
      if (digest(proof.environment) !== digest(environment(task))) return 'stale';
    } else if (!proof.human || !proof.reason || proof.human === task.owner) return 'invalid';
    if (gate.max_age && (!Number.isFinite(Date.parse(proof.observed_at)) || Date.now() - Date.parse(proof.observed_at) > gate.max_age * 1000)) return 'stale';
    if (gate.kind === 'review' && proof.reviewed_proofs !== digest(task.gates.filter(g => g.command).map(g => g.evidence?.hash))) return 'stale';
    return 'pass';
  } catch { return 'missing'; }
}

function withLock(repo, fn) {
  const path = join(tmpdir(), `genesis-${digest(realpathSync(repo))}.lock`);
  mkdirSync(dirname(path), { recursive: true });
  const deadline = Date.now() + 5000;
  for (;;) {
    try { writeFileSync(path, String(process.pid), { flag: 'wx' }); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) throw new Error('repository writer is busy; use recover after an interrupted writer');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  try { return fn(); } finally { rmSync(path, { force: true }); }
}

function readyTask(state, task) {
  return (task.dependencies || []).every(id => state.tasks.some(t => t.id === id && t.state === 'done'));
}

function requireBuild(repo, state, task) {
  if (task.id === 'SPEC-1' || (state.workflow && (state.lifecycle.phase !== 'build' || specStatus(repo, state).status !== 'approved' || planStatus(repo, state).status !== 'approved'))) throw new Error('current specification and plan approval are required for implementation');
  if (!readyTask(state, task)) throw new Error('task dependencies are incomplete');
  if (state.lifecycle.active_task !== task.id || task.state !== 'active') throw new Error(`${task.id} is not the active task; resume it through control`);
}

function activate(repo, state, task) {
  if (!readyTask(state, task)) throw new Error('task dependencies are incomplete');
  const other = state.tasks.find(t => t.id !== task.id && t.state === 'active');
  if (other) throw new Error(`${other.id} is already active`);
  task.state = 'active';
  task.base_manifest ||= inputManifest(repo, task.inputs);
  state.lifecycle = { phase: 'build', status: 'active', active_task: task.id, blocker: null, next_action: task.next_action };
}

function completeTask(repo, state, task) {
  requireBuild(repo, state, task);
  if (!task.gates.some(g => g.command && g.mandatory)) throw new Error('implementation tasks require a mandatory executable gate');
  const pending = task.gates.filter(g => g.mandatory && proofStatus(repo, state, task, g) !== 'pass');
  if (pending.length) throw new Error(`cannot complete ${task.id}; ${pending.map(g => `${g.id}:${proofStatus(repo, state, task, g)}`).join(', ')}`);
  if (task.risk !== 'low' && !task.gates.some(g => g.id === 'independent-review' && !g.command && proofStatus(repo, state, task, g) === 'pass')) throw new Error('independent review is required');
  checkScope(repo, task);
  task.state = 'done'; task.updated_at = now();
  state.lifecycle = { phase: 'verify', status: 'ready', active_task: null, blocker: null, next_action: 'Review completed work and choose the next bounded outcome.' };
  const next = state.tasks.find(t => t.state === 'queued' && readyTask(state, t));
  if (next) activate(repo, state, next);
}

function checkScope(repo, task) {
  if (!task.scope?.length || !task.base_manifest) return;
  const current = inputManifest(repo, task.inputs);
  const changed = [...new Set([...Object.keys(current), ...Object.keys(task.base_manifest)])].filter(name => current[name] !== task.base_manifest[name]);
  const outside = changed.filter(name => !task.scope.some(scope => name === scope || name.startsWith(scope.replace(/\/$/, '') + '/')));
  if (outside.length) throw new Error(`changes outside task scope: ${outside.join(', ')}`);
}

function gitInfo(repo) {
  try {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() !== '';
    return { commit, dirty };
  } catch {
    return { commit: null, dirty: null };
  }
}

function revision(repo) {
  return { ...gitInfo(repo), source_hash: contentHash(repo) };
}

function fileHash(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function redactText(value) {
  return String(value)
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]')
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [REDACTED]')
    .replace(/(["']?\b(?:api[_-]?key|token|password|secret|authorization)\b["']?\s*[:=]\s*["']?)([^\s,;"']+)/gi, '$1[REDACTED]');
}

function redact(value, key = '') {
  if (/^(api[_-]?key|token|password|secret|authorization)$/i.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redact(item, name)]));
  return typeof value === 'string' ? redactText(value) : value;
}

function trace(repo, event, data = {}) {
  const path = join(genesisDir(repo), 'local', 'events.jsonl');
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify({ at: now(), event, data: redact(data) })}\n`);
}

function recentTraces(repo, limit = 50) {
  const path = join(genesisDir(repo), 'local', 'events.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).slice(-limit).map((line) => {
    try { return JSON.parse(line); } catch { return { at: null, event: 'invalid-trace', data: { line: redactText(line) } }; }
  });
}

function discover(repo) {
  const files = listFiles(repo);
  const rel = files.map((path) => relative(repo, path).split(sep).join('/'));
  const extensions = new Map();
  for (const path of rel) {
    const extension = path.includes('.') ? path.slice(path.lastIndexOf('.')).toLowerCase() : '[none]';
    extensions.set(extension, (extensions.get(extension) || 0) + 1);
  }
  const languages = [];
  if (rel.some((path) => /\.(m?[jt]sx?|cjs)$/.test(path))) languages.push('javascript/typescript');
  if (rel.some((path) => path.endsWith('.py'))) languages.push('python');
  if (rel.some((path) => path.endsWith('.go'))) languages.push('go');
  if (rel.some((path) => path.endsWith('.rs'))) languages.push('rust');
  const commandCandidates = [
    ['test', 'package.json', 'npm test'],
    ['test', 'pyproject.toml', 'python -m pytest'],
    ['test', 'pytest.ini', 'python -m pytest'],
    ['test', 'go.mod', 'go test ./...'],
    ['test', 'Cargo.toml', 'cargo test'],
    ['baseline', 'Makefile', 'make test'],
  ];
  const commands = {};
  for (const [kind, marker, command] of commandCandidates) {
    if (rel.includes(marker) && !commands[kind]) commands[kind] = { command, status: 'unverified', source: marker };
  }
  return {
    files: rel.length,
    languages,
    extensions: Object.fromEntries([...extensions].sort()),
    commands,
    legacy_genesis: existsSync(genesisDir(repo)) && !existsSync(statePath(repo)),
    revision: revision(repo),
  };
}

function newState(repo, options, mode, discovery = null) {
  const timestamp = now();
  const profile = options.profile === true || !options.profile ? 'prototype' : options.profile;
  if (!PROFILES.has(profile)) throw new Error(`invalid profile: ${profile}`);
  return {
    schema_version: SCHEMA_VERSION,
    project: {
      name: options.name === true || !options.name ? basename(repo) : options.name,
      mode,
      profile,
      objective: options.objective === true || !options.objective ? 'Define the project objective.' : options.objective,
      constraints: values(options.constraint),
      non_goals: values(options['non-goal']),
      trust_boundary: options['trust-boundary'] === true || !options['trust-boundary'] ? 'local repository' : options['trust-boundary'],
      created_at: timestamp,
      updated_at: timestamp,
    },
    policy: {
      ponytail: 'full',
      autonomy: 'human-in-the-loop',
      learned_rule_promotion: 'human-required',
      cleanup: 'propose-only',
      traces: { storage: 'local', commit_raw: false, redact_secrets: true },
    },
    lifecycle: {
      phase: 'discovery',
      status: 'ready',
      active_task: null,
      blocker: null,
      next_action: mode === 'adopt' ? 'Review the adoption report and confirm project invariants.' : 'Confirm the objective and add the first bounded task.',
    },
    commands: discovery?.commands || {},
    workflow: null,
    artifacts: [],
    assumptions: [],
    invariants: [],
    decisions: [],
    knowledge: [],
    tasks: [],
    learning_proposals: [],
    cleanup_proposals: [],
    controls: [], attempts: [], authorizations: [], experiments: [], incidents: [],
    discovery,
    checkpoint: null,
    legacy: null,
  };
}

function specTemplate(state) {
  return `# Product specification — ${state.project.name}

> Status: draft. A coding agent must not implement product code until this specification is approved through Genesis.

## Problem

[Describe the user problem and desired outcome.]

## Users

[Who uses this product and who is affected by it?]

## Functional requirements

- FR-1: [State one observable capability.]

## Non-functional requirements

- NFR-1: [State one measurable quality, security, privacy, performance, or reliability requirement.]

## Constraints

- [List technical, legal, budget, timeline, platform, or trust-boundary constraints.]

## Non-goals

- [State what this release deliberately will not do.]

## Acceptance criteria

- AC-1: [State one binary outcome that can be proven.]

## Risks

- [Identify material risks and mitigations.]

## Open questions

- [List unresolved questions, or write "None".]
`;
}

function startNewProduct(repo, state) {
  if (state.workflow) throw new Error('a workflow is already active');
  if (state.tasks.some((task) => task.id === 'SPEC-1')) throw new Error('task SPEC-1 already exists; cannot start specification workflow');
  const path = join(repo, 'SPEC.md');
  if (existsSync(path)) throw new Error(`${path} already exists; refusing to overwrite`);
  state.workflow = { type: 'new-product', started_at: now(), spec_check: null, plan_check: null, plan_approval: null };
  state.artifacts.push({ id: 'SPEC-1', type: 'specification', path: 'SPEC.md', status: 'draft', requirements: [], source_hash: null, approval: null });
  const task = {
    id: 'SPEC-1', outcome: 'Produce an approved, implementation-ready product specification', state: 'active', risk: 'medium', owner: null,
    scope: ['SPEC.md'], dependencies: [], requirements: [],
    gates: [{ id: 'independent-review', command: '', mandatory: true, status: 'pending', evidence: null }],
    next_action: 'Interview the human, record durable context, and replace every placeholder in SPEC.md.',
    blocker: null, notes: [], failures: [], limitations: [], created_at: now(), updated_at: now(),
  };
  state.tasks.push(task);
  state.lifecycle = { phase: 'discovery', status: 'active', active_task: 'SPEC-1', blocker: null, next_action: task.next_action };
  atomicWrite(path, specTemplate(state));
}

function ensureLocalIgnore(repo) {
  const path = join(genesisDir(repo), 'local', '.gitignore');
  atomicWrite(path, '*\n!.gitignore\n');
}

function saveState(repo, state, event, data = {}) {
  state.project.updated_at = now();
  validateState(state);
  writeJson(statePath(repo), state);
  ensureLocalIgnore(repo);
  trace(repo, event, data);
  renderKickoff(repo, state);
  renderPlan(repo, state);
  renderDashboard(repo, state);
}

function seed(repo, options, mode, discovery = null) {
  if (existsSync(genesisDir(repo))) throw new Error(`${genesisDir(repo)} already exists; refusing to overwrite`);
  const state = newState(repo, options, mode, discovery);
  const workflow = options.workflow === true ? null : options.workflow;
  if (workflow && !WORKFLOWS.has(workflow)) throw new Error(`unsupported workflow: ${workflow}`);
  if (workflow && existsSync(join(repo, 'SPEC.md'))) throw new Error(`${join(repo, 'SPEC.md')} already exists; refusing to overwrite`);
  mkdirSync(genesisDir(repo), { recursive: true });
  if (workflow) startNewProduct(repo, state);
  saveState(repo, state, `project.${mode}`, { project: state.project.name });
  return state;
}

function freshGate(gate, repo, state, task) {
  return { ...gate, effective_status: proofStatus(repo, state, task, gate) };
}

function taskSummary(task, repo, state) {
  return { ...task, gates: task.gates.map(gate => freshGate(gate, repo, state, task)) };
}

function specification(repo, state) {
  const artifact = state.artifacts?.find((item) => item.type === 'specification');
  if (!artifact) throw new Error('no specification workflow; run genesis spec start <repo>');
  const path = join(repo, artifact.path);
  if (!existsSync(path)) throw new Error(`missing specification artifact: ${artifact.path}`);
  const text = readFileSync(path, 'utf8');
  const requirements = [...new Set([...text.matchAll(/^\s*-?\s*((?:FR|NFR|AC)-\d+)\s*:/gm)].map((match) => match[1]))].sort();
  const missing = SPEC_SECTIONS.filter((heading) => !new RegExp(`^## ${heading}$`, 'm').test(text));
  const placeholders = /\[(?:Describe|Who|State|List|What|Identify)/.test(text);
  const kinds = ['FR-', 'NFR-', 'AC-'].filter((prefix) => !requirements.some((id) => id.startsWith(prefix)));
  const problems = [...missing.map((heading) => `missing section: ${heading}`), ...kinds.map((prefix) => `missing requirement: ${prefix}*`)];
  if (placeholders) problems.push('unresolved template placeholders');
  return { artifact, path, requirements, hash: fileHash(path), problems };
}

function specStatus(repo, state) {
  const spec = specification(repo, state);
  const effective_status = spec.artifact.approval?.source_hash === spec.hash ? spec.artifact.status : spec.artifact.approval ? 'stale' : spec.artifact.status;
  return { id: spec.artifact.id, path: spec.artifact.path, status: effective_status, requirements: spec.requirements, problems: spec.problems, approval: spec.artifact.approval };
}

function planProblems(repo, state) {
  const spec = specStatus(repo, state);
  const tasks = state.tasks.filter((task) => task.id !== 'SPEC-1');
  const problems = [];
  if (spec.status !== 'approved') problems.push(`specification is ${spec.status}`);
  if (!tasks.length) problems.push('no implementation tasks');
  const known = new Set(spec.requirements), covered = new Set();
  for (const task of tasks) {
    if (!task.requirements?.length) problems.push(`${task.id} has no requirement references`);
    for (const id of task.requirements || []) {
      if (!known.has(id)) problems.push(`${task.id} references unknown requirement ${id}`);
      else covered.add(id);
    }
    if (!task.gates.some((gate) => gate.command)) problems.push(`${task.id} has no executable gate`);
  }
  for (const id of known) if (!covered.has(id)) problems.push(`${id} is not covered by a task`);
  return { problems, tasks, requirements: spec.requirements };
}

function planHash(state) {
  const tasks = state.tasks.filter((task) => task.id !== 'SPEC-1').map((task) => ({
    id: task.id, outcome: task.outcome, risk: task.risk, scope: task.scope,
    dependencies: task.dependencies, scenarios: task.scenarios, inputs: task.inputs, environment: task.environment, requirements: task.requirements || [], gates: task.gates.map((gate) => ({ id: gate.id, command: gate.command, mandatory: gate.mandatory, kind: gate.kind, max_age: gate.max_age })),
  }));
  return createHash('sha256').update(JSON.stringify(tasks)).digest('hex');
}

function planStatus(repo, state) {
  const result = planProblems(repo, state), hash = planHash(state);
  const status = state.workflow.plan_approval?.source_hash === hash ? 'approved' : state.workflow.plan_approval ? 'stale' : state.workflow.plan_check?.source_hash === hash ? 'checked' : 'draft';
  return { ...result, hash, status };
}

function workflowInstruction(state) {
  if (!state.workflow) return 'Work only on the active bounded task.';
  if (state.lifecycle.phase === 'discovery') return 'Interview the human and complete SPEC.md. Do not write product implementation code.';
  if (state.lifecycle.phase === 'specification') return 'Present the checked SPEC.md for explicit human approval. Do not write product implementation code.';
  if (state.lifecycle.phase === 'planning') return 'Create requirement-linked implementation tasks with executable gates. Do not write product implementation code.';
  return 'Implement only the active task and prove it against current sources.';
}

function renderPlan(repo, state) {
  if (!state.workflow) return;
  const tasks = state.tasks.filter((task) => task.id !== 'SPEC-1');
  const lines = [
    '# Implementation plan', '', '> Generated from `.genesis/project.json`; do not edit this file.', '',
    `- workflow: ${state.workflow.type}`, `- phase: ${state.lifecycle.phase}`, `- plan approval: ${state.workflow.plan_approval ? `${state.workflow.plan_approval.human} at ${state.workflow.plan_approval.at}` : 'pending'}`, '',
    '## Tasks', '',
    ...(tasks.length ? tasks.flatMap((task) => [
      `### ${task.id} — ${task.outcome}`, '', `- state/risk: ${task.state} / ${task.risk}`,
      `- requirements: ${task.requirements?.join(', ') || 'none'}`, `- scope: ${task.scope.join(', ') || 'not bounded'}`,
      `- gates: ${task.gates.map((gate) => `${gate.id}: ${gate.command || gate.status}`).join(', ') || 'none'}`, `- next: ${task.next_action}`, '',
    ]) : ['- No implementation tasks yet.', '']),
  ];
  atomicWrite(join(genesisDir(repo), 'PLAN.md'), `${lines.join('\n')}\n`);
}

function renderKickoff(repo, state) {
  const active = state.tasks.find(task => task.id === state.lifecycle.active_task);
  let selected, contextError;
  try { selected = contextPacket(repo, state, active); }
  catch (error) { contextError = error.message; selected = { records: [], omitted: 0 }; }
  const records = selected.records.filter(r => r.type !== 'invariants').slice(0, 3);
  const lines = [
    `# KICKOFF — ${state.project.name}`, '',
    '> Generated handoff. Use the CLI for canonical state; do not edit this file.', '',
    `- objective: ${state.project.objective}`,
    `- phase/status: ${state.lifecycle.phase}/${state.lifecycle.status}`,
    `- active task: ${active ? `${active.id} — ${active.outcome}` : 'none'}`,
    `- blocker: ${state.lifecycle.blocker || 'none'}`,
    `- next action: ${state.lifecycle.next_action}`,
    `- phase instruction: ${workflowInstruction(state)}`,
    ...(active ? [
      `- gates: ${active.gates.map(g => `${g.id}:${proofStatus(repo, state, active, g)}`).join(', ') || 'none'}`,
      `- recent failures: ${(active.failures || []).slice(-3).map(v => excerpt(v)).join('; ') || 'none'}`,
    ] : []), '',
    '## Resume', '',
    'Load Genesis and official Ponytail full, then run `genesis brief .` for the current task contract, binding rules and phase guide.',
    'Fetch full records with `genesis context . --id ID` only when needed. Do not load project.json or historical proof wholesale.',
    ...(contextError ? [`**Context requires attention:** ${contextError}. Fetch a complete packet with a larger --bytes budget before implementation.`] : [`Context fingerprint: ${selected.fingerprint}. Use --since only after receiving that full packet; kickoff is not the packet.`]),
    ...records.map(r => `- ${r.id}: ${r.title || excerpt(r.summary || r.text, 100)}`),
    'Applicable invariants, active rules, authorization and proof references are in the packet. Truncated summaries are retrieval pointers, not the full evidence.',
    'Reuse fresh gates with --reuse. Reconcile interrupted attempts before replaying commands. Report state → evidence → blocker → next action; checkpoint before stopping.', '',
  ];
  atomicWrite(join(genesisDir(repo), 'KICKOFF.md'), lines.join('\n'));
}

function html(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function renderDashboard(repo, state) {
  const active = state.tasks.find(t => t.id === state.lifecycle.active_task);
  let context;
  try { context = contextPacket(repo, state, active); } catch { context = null; }
  const page = dashboardPage({ repo, state, tasks: state.tasks.map(task => taskSummary(task, repo, state)),
    traces: recentTraces(repo), hash: contentHash(repo), instruction: workflowInstruction(state),
    spec: state.workflow ? specStatus(repo, state) : null, plan: state.workflow ? planStatus(repo, state) : null, context });
  atomicWrite(join(genesisDir(repo), 'dashboard.html'), page);
}

function runGraphizer(repo, options = []) {
  const graphizer = join(dirname(fileURLToPath(import.meta.url)), 'graphizer.mjs');
  const result = spawnSync(process.execPath, [graphizer, repo, '--write', ...options], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr.trim() || 'graph indexing failed');
  return result.stderr.trim();
}

function commandInit(parsed) {
  const repo = resolve(parsed.positional[0] || '.');
  if (!existsSync(repo) || !statSync(repo).isDirectory()) throw new Error(`repository does not exist: ${repo}`);
  const state = seed(repo, parsed.options, 'init');
  runGraphizer(repo);
  console.log(`Initialized Genesis for ${state.project.name} at ${genesisDir(repo)}`);
}

function commandAdopt(parsed) {
  const repo = resolve(parsed.positional[0] || '.');
  if (!existsSync(repo) || !statSync(repo).isDirectory()) throw new Error(`repository does not exist: ${repo}`);
  const report = discover(repo);
  if (!parsed.options.write && !parsed.options.apply) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const state = seed(repo, parsed.options, 'adopt', report);
  runGraphizer(repo);
  console.log(`Adopted ${state.project.name}; review ${join(genesisDir(repo), 'KICKOFF.md')}`);
}

function commandStatus(parsed) {
  const repo = resolve(parsed.positional[0] || '.');
  const state = loadState(repo);
  const hash = contentHash(repo);
  const view = {
    project: state.project,
    workflow: state.workflow,
    artifacts: state.workflow ? [{ ...specStatus(repo, state) }] : [],
    lifecycle: state.lifecycle,
    tasks: state.tasks.map((task) => taskSummary(task, repo, state)),
    checkpoint: state.checkpoint,
    revision: revision(repo),
  };
  if (parsed.options.json) console.log(JSON.stringify(view, null, 2));
  else {
    console.log(`${state.project.name}: ${state.lifecycle.phase}/${state.lifecycle.status}`);
    console.log(`active: ${state.lifecycle.active_task || 'none'}`);
    console.log(`blocker: ${state.lifecycle.blocker || 'none'}`);
    console.log(`next: ${state.lifecycle.next_action}`);
  }
}

function commandCheckpoint(parsed) {
  const repo = resolve(parsed.positional[0] || '.');
  const state = loadState(repo);
  state.checkpoint = { at: now(), revision: revision(repo), active_task: state.lifecycle.active_task, next_action: state.lifecycle.next_action };
  saveState(repo, state, 'checkpoint', state.checkpoint);
  runGraphizer(repo);
  console.log(`Checkpointed ${state.project.name}`);
}

function commandDashboard(parsed) {
  const repo = resolve(parsed.positional[0] || '.');
  const state = loadState(repo);
  renderDashboard(repo, state);
  const path = join(genesisDir(repo), 'dashboard.html');
  if (parsed.options.open) {
    const result = process.platform === 'darwin' ? spawnSync('open', [path]) : process.platform === 'win32' ? spawnSync('explorer.exe', [path]) : spawnSync('xdg-open', [path]);
    if (result.error || result.status !== 0) throw new Error(`could not open browser; open ${path} manually`);
  }
  console.log(path);
}

function commandMcp(parsed) {
  const server = join(dirname(fileURLToPath(import.meta.url)), 'mcp.mjs');
  const repo = resolve(parsed.positional[0] || '.');
  // Speaks JSON-RPC on stdio and is driven by the host, so it inherits the pipes directly.
  const result = spawnSync(process.execPath, [server, repo], { stdio: 'inherit' });
  if (result.status) process.exitCode = result.status;
}

function commandQuery(parsed, raw) {
  const query = join(dirname(fileURLToPath(import.meta.url)), 'query.mjs');
  const repo = resolve(parsed.positional[0] || '.');
  // Passed through verbatim: the query surface is defined in one place, not mirrored here.
  const result = spawnSync(process.execPath, [query, repo, ...raw.slice(2)], { stdio: 'inherit' });
  if (result.status) process.exitCode = result.status;
}

function commandServe(parsed) {
  const repo = resolve(parsed.positional[0] || '.');
  loadState(repo);
  const serve = join(dirname(fileURLToPath(import.meta.url)), 'serve.mjs');
  const args = [serve, repo];
  if (parsed.options.port) args.push('--port', String(parsed.options.port));
  if (parsed.options.open) args.push('--open');
  // Runs in the foreground until interrupted: it is a viewer, not a daemon, and it holds no lock.
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (result.status !== 0 && result.status !== null) throw new Error('control panel exited unexpectedly');
}

function commandTrace(parsed) {
  const repo = resolve(parsed.positional[0] || '.');
  loadState(repo);
  const event = parsed.options.event === true || !parsed.options.event ? parsed.positional[1] : parsed.options.event;
  if (!event) throw new Error('trace requires --event <name>');
  const data = { task: parsed.options.task || null, message: parsed.options.message || '' };
  if (parsed.options.data && parsed.options.data !== true) data.detail = JSON.parse(parsed.options.data);
  trace(repo, event, data);
  renderDashboard(repo, loadState(repo));
  console.log(`Recorded ${event}`);
}

function parseGate(spec) {
  const index = spec.indexOf(':');
  if (index < 1) throw new Error(`gate must be id:command, got ${spec}`);
  const id = spec.slice(0, index);
  if (!SAFE_ID.test(id)) throw new Error(`unsafe gate id: ${id}`);
  if (id === 'independent-review' || !spec.slice(index + 1).trim()) throw new Error('review gates are reserved; executable gates require a command');
  return { id, kind: 'command', command: spec.slice(index + 1), mandatory: true, status: 'pending', evidence: null };
}

function commandWorkflow(parsed, raw) {
  const action = raw[1] || 'status';
  const nested = parseArgs(raw.slice(2));
  const repo = resolve(nested.positional[0] || '.');
  const state = loadState(repo);
  if (action !== 'status') throw new Error(`unknown workflow action: ${action}`);
  console.log(JSON.stringify({ workflow: state.workflow, lifecycle: state.lifecycle, specification: state.workflow ? specStatus(repo, state) : null, plan: state.workflow ? planStatus(repo, state) : null }, null, 2));
}

function commandSpec(parsed, raw) {
  const action = raw[1];
  const nested = parseArgs(raw.slice(2));
  const repo = resolve(nested.positional[0] || '.');
  const state = loadState(repo);
  if (action === 'start') {
    startNewProduct(repo, state);
    saveState(repo, state, 'spec.started', { path: 'SPEC.md' });
    console.log('Started new-product specification at SPEC.md');
    return;
  }
  const spec = specification(repo, state);
  if (action === 'status') {
    console.log(JSON.stringify(specStatus(repo, state), null, 2));
    return;
  }
  if (action === 'check') {
    if (spec.problems.length) throw new Error(`specification is incomplete; ${spec.problems.join(', ')}`);
    spec.artifact.status = 'checked';
    spec.artifact.requirements = spec.requirements;
    spec.artifact.source_hash = spec.hash;
    spec.artifact.approval = null;
    state.workflow.spec_check = { at: now(), source_hash: spec.hash, requirements: spec.requirements };
    state.workflow.plan_approval = null;
    const task = state.tasks.find((item) => item.id === 'SPEC-1');
    task.state = 'active';
    task.gates[0].status = 'pending';
    task.gates[0].evidence = null;
    task.updated_at = now();
    state.lifecycle = { phase: 'specification', status: 'active', active_task: task.id, blocker: null, next_action: 'Ask the human to review SPEC.md, then record explicit specification approval.' };
    saveState(repo, state, 'spec.checked', { requirements: spec.requirements.length, source_hash: spec.hash });
    console.log(`Specification checked: ${spec.requirements.length} requirements`);
    return;
  }
  if (action === 'approve') {
    const human = nested.options.human;
    if (!human || human === true) throw new Error('spec approve requires --human');
    if (!nested.options.reason || nested.options.reason === true) throw new Error('spec approve requires --reason');
    if (spec.problems.length) throw new Error(`specification is incomplete; ${spec.problems.join(', ')}`);
    if (state.workflow.spec_check?.source_hash !== spec.hash) throw new Error('run spec check against the current SPEC.md before approval');
    const at = now(), task = state.tasks.find((item) => item.id === 'SPEC-1');
    spec.artifact.status = 'approved';
    spec.artifact.requirements = spec.requirements;
    spec.artifact.source_hash = spec.hash;
    spec.artifact.approval = { human, reason: nested.options.reason || null, at, source_hash: spec.hash };
    task.gates[0].status = 'pass';
    task.gates[0].evidence = { human, reason: nested.options.reason || null, source_hash: contentHash(repo), observed_at: at };
    task.state = 'done';
    task.updated_at = at;
    state.lifecycle = { phase: 'planning', status: 'active', active_task: null, blocker: null, next_action: 'Create requirement-linked implementation tasks with executable gates, then run genesis plan check.' };
    saveState(repo, state, 'spec.approved', { human, source_hash: spec.hash });
    console.log(`Specification approved by ${human}; workflow moved to planning`);
    return;
  }
  throw new Error(`unknown spec action: ${action}`);
}

function commandPlan(parsed, raw) {
  const action = raw[1] || 'status';
  const nested = parseArgs(raw.slice(2));
  const repo = resolve(nested.positional[0] || '.');
  const state = loadState(repo);
  if (!state.workflow) throw new Error('no active workflow');
  if (action === 'reopen') {
    const human = nested.options.human;
    if (!human || human === true || !nested.options.reason || nested.options.reason === true) throw new Error('plan reopen requires --human and --reason');
    if (state.lifecycle.active_task) throw new Error('complete or reject the active task before reopening the plan');
    state.workflow.plan_check = null;
    state.workflow.plan_approval = null;
    state.lifecycle = { phase: 'planning', status: 'active', active_task: null, blocker: null, next_action: 'Update requirement-linked tasks, then run genesis plan check.' };
    saveState(repo, state, 'plan.reopened', { human, reason: nested.options.reason });
    console.log(`Plan reopened by ${human}`);
    return;
  }
  const result = planStatus(repo, state), hash = result.hash;
  if (action === 'status') {
    console.log(JSON.stringify({ status: result.status, problems: result.problems, requirements: result.requirements, tasks: result.tasks.map((task) => task.id), approval: state.workflow.plan_approval }, null, 2));
    return;
  }
  if (action === 'check') {
    if (result.problems.length) throw new Error(`plan is incomplete; ${result.problems.join(', ')}`);
    state.workflow.plan_check = { at: now(), source_hash: hash };
    state.workflow.plan_approval = null;
    saveState(repo, state, 'plan.checked', { tasks: result.tasks.length, source_hash: hash });
    console.log(`Plan checked: ${result.tasks.length} tasks cover ${result.requirements.length} requirements`);
    return;
  }
  if (action === 'approve') {
    const human = nested.options.human;
    if (!human || human === true) throw new Error('plan approve requires --human');
    if (!nested.options.reason || nested.options.reason === true) throw new Error('plan approve requires --reason');
    if (result.problems.length) throw new Error(`plan is incomplete; ${result.problems.join(', ')}`);
    if (state.workflow.plan_check?.source_hash !== hash) throw new Error('run plan check against the current tasks before approval');
    state.workflow.plan_approval = { human, reason: nested.options.reason || null, at: now(), source_hash: hash };
    const first = result.tasks.find((task) => task.state === 'queued' && readyTask(state, task));
    if (first) { first.state = 'active'; first.base_manifest = inputManifest(repo, first.inputs); }
    state.lifecycle = { phase: 'build', status: first ? 'active' : 'ready', active_task: first?.id || null, blocker: null, next_action: first?.next_action || 'Add the next approved implementation task.' };
    saveState(repo, state, 'plan.approved', { human, source_hash: hash });
    console.log(`Plan approved by ${human}; workflow moved to build`);
    return;
  }
  throw new Error(`unknown plan action: ${action}`);
}

function commandAgent(parsed, raw) {
  const action = raw[1];
  const nested = parseArgs(raw.slice(2));
  const repo = resolve(nested.positional[0] || '.');
  const state = loadState(repo);
  if (action !== 'connect') throw new Error(`unknown agent action: ${action}`);
  const selected = nested.options.codex || nested.options.claude ? [] : ['AGENTS.md', 'CLAUDE.md'];
  if (nested.options.codex) selected.push('AGENTS.md');
  if (nested.options.claude) selected.push('CLAUDE.md');
  const block = `<!-- genesis:start -->
## Genesis workflow

Before changing this repository, load the Genesis and Ponytail skills and read \`.genesis/KICKOFF.md\`. Obey its phase instruction: do not write product implementation code during discovery, specification, or planning. Use the Genesis CLI for tasks, proof, decisions, approvals, and checkpoints. End every work session with \`genesis checkpoint .\`.
<!-- genesis:end -->`;
  if (!nested.options.write) {
    console.log(JSON.stringify({ dry_run: true, files: selected, block }, null, 2));
    return;
  }
  for (const name of selected) {
    const path = join(repo, name);
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error(`refusing to replace symlink: ${name}`);
    const before = existsSync(path) ? readFileSync(path, 'utf8') : '';
    if (!before.includes('<!-- genesis:start -->')) atomicWrite(path, `${before}${before && !before.endsWith('\n') ? '\n' : ''}${before ? '\n' : ''}${block}\n`);
  }
  saveState(repo, state, 'agent.connected', { files: selected });
  console.log(`Connected Genesis instructions: ${selected.join(', ')}`);
}

function commandTask(parsed, raw) {
  const action = raw[1];
  const nested = parseArgs(raw.slice(2));
  const repo = resolve(nested.positional[0] || '.');
  const state = loadState(repo);
  if (action === 'add') {
    const id = nested.options.id === true || !nested.options.id ? nested.positional[1] : nested.options.id;
    if (!id || !SAFE_ID.test(id) || state.tasks.some((task) => task.id === id)) throw new Error('task add requires a unique safe --id');
    const risk = nested.options.risk === true || !nested.options.risk ? 'low' : nested.options.risk;
    if (!RISK.has(risk)) throw new Error(`invalid risk: ${risk}`);
    const requirements = values(nested.options.requirement);
    if (state.workflow) {
      if (['discovery', 'specification'].includes(state.lifecycle.phase)) throw new Error('specification approval is required before implementation planning');
      if (state.lifecycle.phase !== 'planning') throw new Error('the approved plan is locked; run genesis plan reopen before adding tasks');
      const known = new Set(specStatus(repo, state).requirements);
      if (!requirements.length) throw new Error('workflow tasks require at least one --requirement ID');
      const unknown = requirements.filter((item) => !known.has(item));
      if (unknown.length) throw new Error(`unknown requirement: ${unknown.join(', ')}`);
    }
    const gates = values(nested.options.gate).map(parseGate);
    gates.push(...values(nested.options.runtime).map(value => ({ ...parseGate(value), kind: 'runtime', max_age: positive(nested.options['runtime-max-age'] || 300, 'runtime-max-age') })));
    if (new Set(gates.map(g => g.id)).size !== gates.length) throw new Error('duplicate gate id');
    if (risk !== 'low' && !gates.some((gate) => gate.id === 'independent-review')) {
      gates.push({ id: 'independent-review', kind: 'review', command: '', mandatory: true, status: 'pending', evidence: null });
    }
    const task = {
      id,
      outcome: nested.options.outcome === true || !nested.options.outcome ? 'Define the task outcome.' : nested.options.outcome,
      state: 'queued', risk, owner: nested.options.owner || null,
      scope: values(nested.options.scope), dependencies: values(nested.options.depends), requirements,
      inputs: values(nested.options.input), environment: values(nested.options.env), scenarios: values(nested.options.scenario).map(value => JSON.parse(value)),
      gates,
      next_action: nested.options.next === true || !nested.options.next ? 'Run the task pre-flight.' : nested.options.next,
      blocker: null, notes: [], failures: [], limitations: [], created_at: now(), updated_at: now(),
    };
    for (const path of [...task.scope, ...task.inputs]) safePath(repo, path);
    if (task.dependencies.some(id => id === task.id || !state.tasks.some(t => t.id === id))) throw new Error('dependencies must reference existing tasks');
    for (const scenario of task.scenarios) {
      if (!['id', 'actor', 'scope', 'environment', 'duration', 'observable', 'gate'].every(key => typeof scenario[key] === 'string' && scenario[key].trim()) || !gates.some(g => g.id === scenario.gate && g.command && g.mandatory)) throw new Error('scenario requires id, actor, scope, environment, duration, observable and an executable gate');
    }
    if (new Set(task.scenarios.map(s => s.id)).size !== task.scenarios.length) throw new Error('duplicate scenario id');
    state.tasks.push(task);
    if (!state.lifecycle.active_task && state.lifecycle.phase !== 'planning' && readyTask(state, task)) {
      activate(repo, state, task);
    }
    if (state.workflow && state.lifecycle.phase === 'planning') {
      state.workflow.plan_check = null;
      state.workflow.plan_approval = null;
      state.lifecycle.next_action = 'Finish defining requirement-linked tasks, then run genesis plan check.';
    }
    saveState(repo, state, 'task.added', { id, outcome: task.outcome });
    console.log(`Added ${id}`);
    return;
  }
  const id = nested.options.id === true || !nested.options.id ? nested.positional[1] : nested.options.id;
  const task = state.tasks.find((item) => item.id === id);
  if (!task) throw new Error(`unknown task: ${id}`);
  if (task.state === 'paused') throw new Error(`${id} is paused; resume it through genesis control before mutation`);
  if (action === 'set') {
    if (nested.options.state && nested.options.state !== true) {
      if (!['blocked', 'failed'].includes(nested.options.state) || task.state !== 'active') throw new Error('task set only permits active -> blocked|failed; use complete or control for other transitions');
      task.state = nested.options.state;
    }
    if (nested.options.next && nested.options.next !== true) task.next_action = nested.options.next;
    if (nested.options.blocker !== undefined) task.blocker = nested.options.blocker === true ? null : nested.options.blocker;
    task.notes.push(...values(nested.options.note));
    task.failures.push(...values(nested.options.failure));
    task.limitations.push(...values(nested.options.limitation));
    task.updated_at = now();
    if (state.lifecycle.active_task === id) {
      state.lifecycle.status = task.state;
      state.lifecycle.blocker = task.blocker;
      state.lifecycle.next_action = task.next_action;
    }
    saveState(repo, state, 'task.updated', { id, state: task.state });
    console.log(`Updated ${id}`);
    return;
  }
  if (action === 'complete') {
    completeTask(repo, state, task);
    saveState(repo, state, 'task.completed', { id });
    console.log(`Completed ${id}`);
    return;
  }
  throw new Error(`unknown task action: ${action}`);
}

function commandRecord(parsed, raw) {
  const type = raw[1];
  const nested = parseArgs(raw.slice(2));
  const repo = resolve(nested.positional[0] || '.');
  const state = loadState(repo);
  const id = nested.options.id === true || !nested.options.id ? `${type.toUpperCase()}-${randomUUID().slice(0, 8)}` : nested.options.id;
  if (!SAFE_ID.test(id)) throw new Error(`unsafe record id: ${id}`);
  if (type === 'knowledge') {
    if (!nested.options.title || nested.options.title === true || !nested.options.text || nested.options.text === true) throw new Error('knowledge requires --title and --text');
    state.knowledge.push({ id, title: nested.options.title, text: nested.options.text, source: nested.options.source || null, tags: values(nested.options.tag), recorded_at: now() });
  } else if (type === 'decision') {
    if (!nested.options.title || nested.options.title === true || !nested.options.text || nested.options.text === true) throw new Error('decision requires --title and --text');
    state.decisions.push({ id, title: nested.options.title, text: nested.options.text, status: nested.options.status || 'accepted', source: nested.options.source || null, recorded_at: now() });
  } else if (type === 'assumption') {
    if (!nested.options.text || nested.options.text === true) throw new Error('assumption requires --text');
    state.assumptions.push({ id, text: nested.options.text, status: nested.options.status || 'open', source: nested.options.source || null, recorded_at: now() });
  } else if (type === 'invariant') {
    if (!nested.options.text || nested.options.text === true) throw new Error('invariant requires --text');
    state.invariants.push({ id, text: nested.options.text, source: nested.options.source || 'unverified', recorded_at: now() });
  } else throw new Error(`unknown record type: ${type}`);
  const key = { knowledge: 'knowledge', decision: 'decisions', assumption: 'assumptions', invariant: 'invariants' }[type];
  if (state[key].filter(r => r.id === id).length !== 1) throw new Error('record id already exists');
  const record = state[key].at(-1); record.paths = values(nested.options.path); record.tags = values(nested.options.tag);
  for (const path of record.paths) safePath(repo, path);
  if (nested.options.supersedes) {
    const previous = state[key].find(r => r.id === nested.options.supersedes && r.id !== id);
    if (!previous) throw new Error('unknown superseded record');
    previous.status = 'superseded'; previous.superseded_by = id; record.supersedes = previous.id;
  }
  saveState(repo, state, `${type}.recorded`, { id });
  console.log(`Recorded ${id}`);
}

function positive(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > 2147483647) throw new Error(`${name} must be a positive integer <= 2147483647`);
  return number;
}

function requireText(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  return value;
}

function saveProof(repo, proof) {
  proof.hash = digest(proof);
  mkdirSync(join(genesisDir(repo), 'evidence'), { recursive: true });
  const path = `.genesis/evidence/${proof.task}-${proof.gate}-${proof.attempt}.json`;
  writeFileSync(safePath(repo, path), `${JSON.stringify(proof, null, 2)}\n`, { flag: 'wx' });
  return { path, hash: proof.hash, source_hash: proof.source_hash, config_hash: proof.config_hash, observed_at: proof.observed_at };
}

function runningAttempt(state) { return state.attempts.find(a => a.status === 'running'); }

function beginAttempt(repo, taskId, kind, command, timeout, authorization = null) {
  return withLock(repo, () => {
    const state = loadState(repo), task = state.tasks.find(t => t.id === taskId);
    if (!task) throw new Error(`unknown task: ${taskId}`);
    requireBuild(repo, state, task);
    if (runningAttempt(state)) throw new Error('an attempt is already running; reconcile it with recover');
    const attempt = { id: randomUUID(), task: taskId, kind, command, timeout, authorization,
      pid: process.pid, child_pid: null, started_at: now(), status: 'running',
      before_hash: digest(inputManifest(repo, task.inputs)), config_hash: taskConfig(state, task),
      environment: environment(task), cost: null, stop_reason: null };
    state.attempts.push(attempt);
    saveState(repo, state, 'attempt.started', { id: attempt.id, task: taskId, kind });
    return attempt;
  });
}

function execute(command, cwd, timeout, options = {}) {
  return new Promise(resolveResult => {
    let stdout = '', stderr = '', failure = null, child;
    try { child = spawn(command, { cwd, shell: true, detached: process.platform !== 'win32', env: { ...process.env, ...options.env }, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (error) { resolveResult({ status: null, stdout, stderr: redactText(error.message), failure: 'environment' }); return; }
    function kill() {
      try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch {}
    }
    const timer = setTimeout(() => { failure = 'timeout'; kill(); }, timeout);
    const poll = options.check ? setInterval(() => {
      try { const reason = options.check(); if (reason) { failure = reason; kill(); } }
      catch { failure = 'state-unavailable'; kill(); }
    }, 100) : null;
    const onSignal = () => { failure = 'interrupted'; kill(); };
    process.on('SIGTERM', onSignal); process.on('SIGINT', onSignal);
    child.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-20000); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-20000); });
    child.on('error', error => { failure = 'environment'; stderr = error.message; });
    child.on('close', (status, signal) => {
      clearTimeout(timer); if (poll) clearInterval(poll);
      process.removeListener('SIGTERM', onSignal); process.removeListener('SIGINT', onSignal);
      resolveResult({ status, signal, stdout: redactText(stdout), stderr: redactText(stderr), failure: failure || (status === 0 ? null : 'command-failed') });
    });
    try { options.started?.(child.pid); } catch { failure = 'state-unavailable'; kill(); }
  });
}

async function executeAttempt(repo, attempt) {
  return execute(attempt.command, repo, attempt.timeout, {
    env: { GENESIS_ATTEMPT_ID: attempt.id, GENESIS_TASK_ID: attempt.task, GENESIS_SOURCE_HASH: attempt.before_hash },
    started: pid => withLock(repo, () => {
      const state = loadState(repo), current = state.attempts.find(a => a.id === attempt.id);
      current.child_pid = pid;
      saveState(repo, state, 'attempt.spawned', { id: attempt.id, pid });
    }),
    check: () => {
      const state = loadState(repo), task = state.tasks.find(t => t.id === attempt.task);
      if (task?.state !== 'active') return 'operator-stop';
      if (taskConfig(state, task) !== attempt.config_hash) return 'configuration-changed';
      if (attempt.authorization && !validAuthorization(state, task, attempt.authorization)) return 'authorization-expired';
      return null;
    },
  });
}

async function commandGate(parsed) {
  const repo = resolve(parsed.positional[0] || '.');
  let state = loadState(repo), id = parsed.positional[1] || state.lifecycle.active_task;
  let task = state.tasks.find(t => t.id === id);
  if (!task) throw new Error(`unknown task: ${id}`);
  requireBuild(repo, state, task);
  if (!task.gates.some(g => g.command)) throw new Error(`${id} has no executable gates`);
  const timeout = positive(parsed.options.timeout || 120000, 'timeout');
  const gateIds = task.gates.filter(g => g.command).map(g => g.id);
  for (const gateId of gateIds) {
    state = loadState(repo); task = state.tasks.find(t => t.id === id);
    const gate = task.gates.find(g => g.id === gateId);
    if (parsed.options.reuse && proofStatus(repo, state, task, gate) === 'pass') continue;
    const remaining = parsed.options.deadline ? parsed.options.deadline - Date.now() : timeout;
    if (remaining <= 0) throw new Error('run time budget exhausted before next gate');
    const attempt = beginAttempt(repo, id, 'gate', gate.command, Math.min(timeout, remaining), parsed.options.authorization || null);
    const result = await executeAttempt(repo, attempt);
    const failed = withLock(repo, () => {
      const latest = loadState(repo), currentTask = latest.tasks.find(t => t.id === id);
      const currentGate = currentTask.gates.find(g => g.id === gateId);
      const currentAttempt = latest.attempts.find(a => a.id === attempt.id);
      const hash = digest(inputManifest(repo, currentTask.inputs));
      let failure = result.failure;
      if (hash !== attempt.before_hash) failure = 'source-mutated';
      if (taskConfig(latest, currentTask) !== attempt.config_hash) failure = 'configuration-changed';
      if (currentTask.state !== 'active') failure = 'operator-stop';
      let receipt = null;
      if (gate.kind === 'runtime' && !failure) {
        try {
          receipt = JSON.parse(result.stdout);
          if (!['build', 'environment', 'endpoint'].every(key => typeof receipt[key] === 'string' && receipt[key].trim()) || receipt.source_hash !== attempt.before_hash) throw new Error('runtime identity missing');
          if (currentTask.scenarios?.some(s => s.gate === gateId && s.environment !== receipt.environment)) throw new Error('runtime environment differs from outcome scenario');
        } catch { failure = 'runtime-identity'; }
      }
      currentAttempt.status = failure ? 'failed' : 'passed';
      currentAttempt.stop_reason = failure; currentAttempt.ended_at = now();
      currentGate.status = failure ? 'fail' : 'pass';
      currentGate.evidence = saveProof(repo, { task: id, gate: gateId, kind: gate.kind || 'command', attempt: attempt.id,
        command: gate.command, started_at: attempt.started_at, observed_at: now(), exit_code: result.status,
        signal: result.signal, stdout: result.stdout, stderr: result.stderr, failure, receipt,
        revision: gitInfo(repo), source_hash: hash, before_hash: attempt.before_hash,
        config_hash: attempt.config_hash, environment: attempt.environment });
      saveState(repo, latest, 'gate.ran', { task: id, gate: gateId, attempt: attempt.id, failure });
      return failure;
    });
    if (failed) throw new Error(`${id}/${gateId}: ${failed}`);
  }
  console.log(`${id}: passed executable gates`);
}

function commandControl(parsed, raw) {
  const action = raw[1];
  if (!CONTROL_ACTIONS.has(action)) throw new Error(`unknown control action: ${action}`);
  const nested = parseArgs(raw.slice(2)), repo = resolve(nested.positional[0] || '.');
  const state = loadState(repo), id = nested.positional[1] || state.lifecycle.active_task;
  const task = state.tasks.find(t => t.id === id);
  if (!task) throw new Error(`unknown task: ${id}`);
  const record = { id: randomUUID(), at: now(), action, task: id, human: nested.options.human || null, reason: nested.options.reason || null, revision: nested.options.revision || null };
  if (action === 'approve') {
    requireBuild(repo, state, task);
    requireText(record.human, '--human'); requireText(record.reason, '--reason');
    const gate = task.gates.find(g => g.id === nested.options.gate);
    if (!gate || gate.command) throw new Error('approve requires a manual review gate; executable gates must be run');
    if (record.human === task.owner) throw new Error('task owner cannot approve independent review');
    if (!task.gates.some(g => g.command) || task.gates.some(g => g.command && g.mandatory && proofStatus(repo, state, task, g) !== 'pass')) throw new Error('run current executable proof before review');
    gate.kind = 'review'; gate.status = 'pass';
    gate.evidence = saveProof(repo, { task: id, gate: gate.id, kind: 'review', attempt: record.id,
      human: record.human, reason: record.reason, observed_at: record.at,
      source_hash: digest(inputManifest(repo, task.inputs)), config_hash: taskConfig(state, task),
      reviewed_proofs: digest(task.gates.filter(g => g.command).map(g => g.evidence?.hash)) });
  } else {
    if (['done', 'rejected'].includes(task.state)) throw new Error('terminal tasks cannot be resumed or rewritten; create a new task');
    if (action === 'pause') {
      if (task.state !== 'active') throw new Error('only active tasks can pause');
      task.state = 'paused';
    } else if (['resume', 'retry', 'requeue'].includes(action)) {
      if (runningAttempt(state)) throw new Error('wait for the running attempt to stop or reconcile with recover');
      if (state.workflow && (specStatus(repo, state).status !== 'approved' || planStatus(repo, state).status !== 'approved' || state.lifecycle.phase !== 'build')) throw new Error('current specification and plan approval required');
      if (action === 'requeue') { task.state = 'queued'; if (state.lifecycle.active_task === id) state.lifecycle.active_task = null; }
      else activate(repo, state, task);
    } else if (action === 'reject') { task.state = 'rejected'; if (state.lifecycle.active_task === id) state.lifecycle.active_task = null; }
    else if (action === 'rollback') {
      requireText(record.revision, '--revision');
      task.state = 'blocked'; task.blocker = `rollback requested to ${record.revision}; inspect and restore explicitly`;
    }
  }
  state.controls.push(record);
  if (!state.lifecycle.active_task || state.lifecycle.active_task === id) { state.lifecycle.status = task.state; state.lifecycle.blocker = task.blocker; }
  saveState(repo, state, `control.${action}`, record);
  console.log(`${action}: ${id}`);
}

function validAuthorization(state, task, id) {
  const grant = state.authorizations.find(a => a.id === id);
  return grant && grant.status === 'active' && grant.task === task.id && grant.config_hash === taskConfig(state, task) && Date.parse(grant.expires_at) > Date.now() ? grant : null;
}

function commandAuthorization(parsed, raw) {
  const action = raw[1], nested = parseArgs(raw.slice(2)), repo = resolve(nested.positional[0] || '.');
  const state = loadState(repo);
  if (action === 'list') { console.log(JSON.stringify(state.authorizations, null, 2)); return; }
  if (action === 'revoke') {
    const grant = state.authorizations.find(a => a.id === nested.options.id);
    if (!grant) throw new Error('unknown authorization');
    grant.status = 'revoked'; grant.revoked_at = now();
    saveState(repo, state, 'authorization.revoked', { id: grant.id }); return;
  }
  if (action !== 'grant') throw new Error(`unknown authorization action: ${action}`);
  const id = requireText(nested.options.id, '--id'), task = state.tasks.find(t => t.id === nested.options.task);
  if (!SAFE_ID.test(id) || state.authorizations.some(a => a.id === id) || !task) throw new Error('unique safe authorization id and existing task required');
  requireText(nested.options.human, '--human'); requireText(nested.options.reason, '--reason');
  const command = requireText(nested.options.command, '--command');
  const expires = Date.parse(requireText(nested.options.expires, '--expires'));
  if (!Number.isFinite(expires) || expires <= Date.now()) throw new Error('authorization expiry must be in the future');
  if (!task.scope.length || !task.scenarios?.length) throw new Error('autonomous tasks require bounded scope and outcome scenarios');
  const grant = { id, task: task.id, command, human: nested.options.human, reason: nested.options.reason,
    expires_at: new Date(expires).toISOString(), timeout: positive(nested.options.timeout || 600000, 'timeout'),
    status: 'active', config_hash: taskConfig(state, task), created_at: now() };
  state.authorizations.push(grant);
  saveState(repo, state, 'authorization.granted', { id, task: task.id });
  console.log(`Authorized ${id}; host permissions remain authoritative`);
}

async function commandRun(parsed) {
  const repo = resolve(parsed.positional[0] || '.'), limit = positive(parsed.options['max-tasks'] || 1, 'max-tasks');
  const deadline = Date.now() + positive(parsed.options.timeout || 600000, 'timeout');
  for (let count = 0; count < limit; count++) {
    let state = loadState(repo), task = state.tasks.find(t => t.id === state.lifecycle.active_task);
    if (!task) { console.log('No active task'); return; }
    requireBuild(repo, state, task);
    const grant = state.authorizations.find(a => validAuthorization(state, task, a.id));
    if (!grant) throw new Error(`${task.id} needs a current task-scoped command authorization`);
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('run time budget exhausted; checkpoint is resumable');
    let attempt = [...state.attempts].reverse().find(a => a.task === task.id && a.kind === 'worker' && a.status === 'passed' && a.authorization === grant.id && a.config_hash === taskConfig(state, task) && a.after_hash === digest(inputManifest(repo, task.inputs)) && digest(a.environment) === digest(environment(task)));
    if (!attempt) {
    attempt = beginAttempt(repo, task.id, 'worker', grant.command, Math.min(grant.timeout, remaining), grant.id);
    const result = await executeAttempt(repo, attempt);
    const failure = withLock(repo, () => {
      const latest = loadState(repo), current = latest.tasks.find(t => t.id === task.id), record = latest.attempts.find(a => a.id === attempt.id);
      let failed = result.failure;
      if (taskConfig(latest, current) !== attempt.config_hash) failed = 'configuration-changed';
      if (current.state !== 'active') failed = 'operator-stop';
      if (!validAuthorization(latest, current, grant.id)) failed = 'authorization-expired';
      try { checkScope(repo, current); } catch (error) { failed = 'scope-violation'; current.limitations.push(error.message); }
      record.status = failed ? 'failed' : 'passed'; record.stop_reason = failed; record.ended_at = now();
      record.stdout = result.stdout; record.stderr = result.stderr; record.exit_code = result.status;
      record.after_hash = digest(inputManifest(repo, current.inputs));
      if (failed && current.state === 'active') { current.state = 'blocked'; current.blocker = `${failed}; inspect attempt ${attempt.id} before retrying`; latest.lifecycle.status = 'blocked'; latest.lifecycle.blocker = current.blocker; }
      saveState(repo, latest, 'worker.finished', { id: attempt.id, failure: failed });
      return failed;
    });
    if (failure) throw new Error(`worker stopped: ${failure}; no automatic side-effect replay`);
    }
    const gateBudget = deadline - Date.now();
    if (gateBudget <= 0) throw new Error('worker finished; time budget exhausted before verification');
    await commandGate({ positional: [repo, task.id], options: { timeout: Math.min(gateBudget, 120000), reuse: true, deadline, authorization: grant.id } });
    withLock(repo, () => {
      const latest = loadState(repo), current = latest.tasks.find(t => t.id === task.id);
      if (!validAuthorization(latest, current, grant.id)) throw new Error('authorization expired before completion');
      completeTask(repo, latest, current);
      latest.checkpoint = { at: now(), revision: revision(repo), active_task: latest.lifecycle.active_task, next_action: latest.lifecycle.next_action };
      saveState(repo, latest, 'run.completed-task', { task: task.id, attempt: attempt.id });
    });
    console.log(`Completed ${task.id}`);
  }
}

function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

function commandRecover(parsed) {
  const repo = resolve(parsed.positional[0] || '.'), lock = join(tmpdir(), `genesis-${digest(realpathSync(repo))}.lock`);
  if (existsSync(lock)) {
    const pid = Number(readFileSync(lock, 'utf8'));
    if (!Number.isSafeInteger(pid) || processAlive(pid)) throw new Error('writer may still be alive; recovery will not steal its lock');
    rmSync(lock);
  }
  withLock(repo, () => {
    const state = loadState(repo), attempts = state.attempts.filter(a => a.status === 'running');
    for (const attempt of attempts) {
      if (processAlive(attempt.pid) || processAlive(attempt.child_pid)) throw new Error(`attempt ${attempt.id} may still be running; inspect the process before recovery`);
      attempt.status = 'interrupted'; attempt.stop_reason = 'unreconciled-side-effects'; attempt.ended_at = now();
      const task = state.tasks.find(t => t.id === attempt.task);
      if (task && !['done', 'rejected'].includes(task.state)) {
        task.state = 'blocked'; task.blocker = `Interrupted attempt ${attempt.id}; inspect output and side effects, then explicitly resume`;
        if (state.lifecycle.active_task === task.id) { state.lifecycle.status = 'blocked'; state.lifecycle.blocker = task.blocker; }
      }
    }
    for (const experiment of state.experiments.filter(e => e.status === 'running')) {
      if (processAlive(experiment.pid)) throw new Error(`experiment ${experiment.id} may still be running`);
      experiment.status = 'interrupted'; experiment.ended_at = now(); experiment.error = 'Unreconciled evaluation; inspect child processes before rerunning';
    }
    saveState(repo, state, 'recovery.reconciled', { attempts: attempts.map(a => a.id) });
    console.log(`Reconciled ${attempts.length} interrupted attempts; no commands replayed`);
  });
}

const BRIEF_STAGES = ['research', 'plan', 'implement', 'verify', 'recover'];
const briefStage = state => ['paused', 'blocked', 'failed'].includes(state.lifecycle.status) ? 'recover' : ({ discovery: 'research', specification: 'research', planning: 'plan', build: 'implement', verify: 'verify' }[state.lifecycle.phase] || 'research');
const excerpt = (value, size = 280) => { const text = String(value || ''); return text.length > size ? text.slice(0, size) + '…' : text; };

function contextPacket(repo, state, task, budget = 8000, options = {}) {
  const scopes = task?.scope || [], tags = new Set(task?.requirements || []);
  const relevance = record => record.paths?.some(path => scopes.some(scope => path === scope || path.startsWith(scope + '/') || scope.startsWith(path + '/'))) ? 2
    : record.tags?.some(tag => tags.has(tag)) ? 1 : !record.paths?.length && !record.tags?.length ? 0 : -1;
  const packet = { project: { name: state.project.name, objective: state.project.objective }, source_hash: digest(inputManifest(repo, task?.inputs)), environment_hash: digest(environment(task || {})), config_hash: task ? taskConfig(state, task) : null, task: task ? { id: task.id, outcome: task.outcome, state: task.state, risk: task.risk, owner: task.owner, dependencies: task.dependencies, inputs: task.inputs, environment: task.environment, scope: scopes, requirements: task.requirements,
    scenarios: task.scenarios || [], blocker: task.blocker, next_action: task.next_action,
    gates: task.gates.map(g => ({ id: g.id, command: g.command, status: proofStatus(repo, state, task, g), evidence: g.evidence })) } : null,
    phase: state.lifecycle.phase, instruction: workflowInstruction(state), records: [], graph: [], attempts: [], authorizations: [], rules: [], omitted: 0 };
  if (options.stage) {
    if (!BRIEF_STAGES.includes(options.stage)) throw new Error(`stage must be ${BRIEF_STAGES.join('|')}`);
    packet.stage = options.stage;
    packet.guide = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'recipes', options.stage + '.md'), 'utf8').trim();
  }
  // Binding rules and applicable invariants are never displaced by optional context.
  packet.rules = state.learning_proposals.filter(r => r.status === 'active').map(r => ({ id: r.id, rule: r.rule, experiment: r.experiment, approved_by: r.approved_by }));
  packet.records = (state.invariants || []).filter(r => typeof r === 'object' && r.status !== 'superseded' && relevance(r) >= 0).map(r => ({ type: 'invariants', ...r }));
  const size = () => Buffer.byteLength(JSON.stringify(packet));
  if (size() > budget - 512) throw new Error('context budget too small for task, binding rules and invariants; increase --bytes');
  function add(key, item) {
    packet[key].push(item);
    if (size() > budget - 512) { packet[key].pop(); packet.omitted++; }
  }
  for (const grant of state.authorizations.filter(a => task && a.task === task.id && a.status === 'active')) add('authorizations', { id: grant.id, command: grant.command, usable: Boolean(validAuthorization(state, task, grant.id)), expires_at: grant.expires_at });
  for (const attempt of state.attempts.filter(a => a.task === task?.id).slice(-3).reverse()) add('attempts', { id: attempt.id, kind: attempt.kind, status: attempt.status, stop_reason: attempt.stop_reason });
  const candidates = ['decisions', 'knowledge', 'assumptions'].flatMap(type => (state[type] || []).map((record, index) => ({ type, record, index, score: relevance(record) })))
    .filter(({ record, score }) => typeof record === 'object' && record.status !== 'superseded' && score >= 0)
    .sort((a, b) => b.score - a.score || b.index - a.index || a.type.localeCompare(b.type));
  for (const { type, record, score } of candidates) {
    const entry = options.full ? { type, ...record } : { type, id: record.id, title: record.title, summary: excerpt(record.text), status: record.status, source: excerpt(record.source, 100), truncated: String(record.text || '').length > 280 };
    add('records', { ...entry, included_because: ['project context', 'requirement tag', 'task scope'][score] });
  }
  const graphPath = join(genesisDir(repo), 'index', 'graph.json');
  if (task && existsSync(graphPath)) {
    const graph = readJson(graphPath), seeds = new Set(graph.nodes.filter(n => n.path && scopes.some(scope => n.path === scope || n.path.startsWith(scope + '/'))).map(n => n.id));
    packet.graph_source_hash = graph.sourceHash;
    for (const edge of graph.edges.filter(e => seeds.has(e.source) || seeds.has(e.target))) add('graph', { source: edge.source, target: edge.target, type: edge.type, resolved: edge.resolved, confidence: edge.confidence, advisory: true });
  }
  packet.fingerprint = digest(packet);
  packet.metrics = { bytes: 0, estimated_tokens: 0, token_estimate: 'UTF-8 bytes / 4; model-dependent', budget_bytes: budget };
  for (let i = 0; i < 5; i++) { packet.metrics.bytes = size(); packet.metrics.estimated_tokens = Math.ceil(packet.metrics.bytes / 4); }
  if (size() > budget) throw new Error('context metadata exceeds budget; increase --bytes');
  return packet;
}

function commandContext(parsed, brief = false) {
  const repo = resolve(parsed.positional[0] || '.'), state = loadState(repo);
  if (parsed.options.id) {
    const types = ['decisions', 'knowledge', 'invariants', 'assumptions', 'incidents', 'attempts', 'tasks', 'authorizations', 'experiments', 'learning_proposals'];
    if (parsed.options.type && !types.includes(parsed.options.type)) throw new Error('unknown context record type');
    const matches = (parsed.options.type ? [parsed.options.type] : types).flatMap(key => state[key] || []).filter(r => r.id === parsed.options.id);
    if (!matches.length) throw new Error('unknown context record');
    if (matches.length > 1) throw new Error('ambiguous context id; select its collection with --type');
    console.log(JSON.stringify(matches[0], null, 2)); return;
  }
  const id = parsed.positional[1] || state.lifecycle.active_task;
  const task = state.tasks.find(t => t.id === id);
  if (id && !task) throw new Error(`unknown task: ${id}`);
  const packet = contextPacket(repo, state, task, positive(parsed.options.bytes || 8000, 'bytes'), { full: parsed.options.full, stage: parsed.options.stage || (brief ? briefStage(state) : null) });
  if (parsed.options.stats) console.log(JSON.stringify({ ...packet.metrics, fingerprint: packet.fingerprint, records: packet.records.length, omitted: packet.omitted }));
  else if (parsed.options.since === packet.fingerprint) console.log(JSON.stringify({ unchanged: true, fingerprint: packet.fingerprint, instruction: 'Reuse the previously received packet for this fingerprint; fetch without --since if unavailable.' }));
  else console.log(JSON.stringify(packet));
}

function commandIncident(parsed, raw) {
  const action = raw[1], nested = parseArgs(raw.slice(2)), repo = resolve(nested.positional[0] || '.'), state = loadState(repo);
  if (action === 'list') { console.log(JSON.stringify(state.incidents, null, 2)); return; }
  const id = requireText(nested.options.id, '--id');
  if (!SAFE_ID.test(id)) throw new Error('unsafe incident id');
  if (action === 'record') {
    if (state.incidents.some(i => i.id === id)) throw new Error('incident already exists');
    state.incidents.push({ id, status: 'suspected', symptom: requireText(nested.options.symptom, '--symptom'), hypothesis: requireText(nested.options.hypothesis, '--hypothesis'), history: [], created_at: now() });
  } else if (action === 'update') {
    const incident = state.incidents.find(i => i.id === id);
    if (!incident) throw new Error('unknown incident');
    const status = nested.options.status;
    if (!['reproduced', 'supported', 'refuted', 'fixed'].includes(status)) throw new Error('invalid incident status');
    const evidence = requireText(nested.options.evidence, '--evidence');
    if (status === 'supported') { requireText(nested.options.control, '--control'); requireText(nested.options.trace, '--trace'); }
    incident.history.push({ from: incident.status, to: status, evidence, control: nested.options.control || null, trace: nested.options.trace || null, at: now() });
    incident.status = status;
  } else throw new Error('unknown incident action');
  saveState(repo, state, `incident.${action}`, { id });
}

async function commandEvaluate(parsed) {
  const repo = resolve(parsed.positional[0] || '.'), suitePath = resolve(requireText(parsed.options.suite, '--suite'));
  const baseline = realpathSync(resolve(requireText(parsed.options.baseline, '--baseline'))), candidate = realpathSync(resolve(requireText(parsed.options.candidate, '--candidate')));
  const suite = readJson(suitePath), evaluator = realpathSync(resolve(dirname(suitePath), requireText(suite.evaluator, 'suite.evaluator')));
  for (const path of [baseline, candidate]) if (evaluator === path || evaluator.startsWith(path + sep)) throw new Error('evaluator must be outside both candidate and baseline repositories');
  if (!Array.isArray(suite.cases) || !suite.cases.length || !['development', 'holdout'].every(split => suite.cases.some(c => c.split === split))) throw new Error('suite requires development and holdout cases');
  const ids = new Set();
  for (const item of suite.cases) {
    if (!SAFE_ID.test(item.id) || ids.has(item.id) || !['development', 'holdout'].includes(item.split)) throw new Error('cases require unique safe ids and development|holdout split');
    ids.add(item.id); requireText(item.command, 'case.command'); positive(item.timeout || 60000, 'case.timeout');
  }
  const timeout = positive(parsed.options.timeout || 600000, 'timeout'), deadline = Date.now() + timeout;
  const experiment = { id: `EV-${randomUUID()}`, status: 'running', pid: process.pid, started_at: now(),
    baseline, candidate, baseline_hash: contentHash(baseline), candidate_hash: contentHash(candidate),
    suite_hash: fileHash(suitePath), evaluator_hash: fileHash(evaluator), environment: environment(), results: [] };
  withLock(repo, () => {
    const state = loadState(repo);
    if (state.experiments.some(e => e.status === 'running')) throw new Error('another experiment is running');
    state.experiments.push(experiment); saveState(repo, state, 'evaluation.started', { id: experiment.id });
  });
  const temp = mkdtempSync(join(tmpdir(), 'genesis-evaluation-'));
  try {
    for (const item of [...suite.cases].sort((a, b) => a.split.localeCompare(b.split))) {
      for (const [variant, source] of [['baseline', baseline], ['candidate', candidate]]) {
        const work = join(temp, `${variant}-${item.id}`); mkdirSync(work);
        for (const name of Object.keys(inputManifest(source))) {
          const from = safePath(source, name), to = safePath(work, name);
          if (!existsSync(from)) continue;
          if (lstatSync(from).isSymbolicLink()) throw new Error('evaluation copies require regular input files, not symlinks');
          mkdirSync(dirname(to), { recursive: true }); cpSync(from, to);
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error('evaluation time budget exhausted');
        const started = Date.now();
        const run = await execute(item.command, work, Math.min(item.timeout || 60000, remaining), { env: { GENESIS_CASE_ID: item.id, GENESIS_VARIANT: variant } });
        let passed = false, failure = run.failure;
        if (!failure) {
          if (fileHash(evaluator) !== experiment.evaluator_hash) throw new Error('evaluator changed during experiment');
          const verify = spawnSync(process.execPath, [evaluator, work, item.id], { cwd: dirname(evaluator), encoding: 'utf8', timeout: Math.max(1, Math.min(30000, deadline - Date.now())) });
          try { passed = verify.status === 0 && JSON.parse(verify.stdout).pass === true; } catch {}
          if (!passed) failure = 'verification-failed';
        }
        experiment.results.push({ case: item.id, split: item.split, variant, pass: passed, failure, duration_ms: Date.now() - started, cost: null });
      }
    }
    if (fileHash(evaluator) !== experiment.evaluator_hash || fileHash(suitePath) !== experiment.suite_hash || contentHash(baseline) !== experiment.baseline_hash || contentHash(candidate) !== experiment.candidate_hash) throw new Error('evaluation inputs changed during experiment');
    const regressions = experiment.results.filter(r => r.variant === 'baseline' && r.pass && !experiment.results.find(c => c.variant === 'candidate' && c.case === r.case)?.pass);
    const candidateResults = experiment.results.filter(r => r.variant === 'candidate');
    experiment.status = regressions.length === 0 && candidateResults.every(r => r.pass) ? 'pass' : 'fail';
    experiment.regressions = regressions.map(r => r.case);
  } catch (error) { experiment.status = 'failed'; experiment.error = redactText(error.message); }
  finally {
    rmSync(temp, { recursive: true, force: true });
    experiment.ended_at = now(); experiment.hash = digest(experiment);
    withLock(repo, () => {
      const state = loadState(repo), index = state.experiments.findIndex(e => e.id === experiment.id);
      state.experiments[index] = experiment;
      const path = `.genesis/evidence/${experiment.id}.json`; mkdirSync(join(genesisDir(repo), 'evidence'), { recursive: true });
      writeFileSync(safePath(repo, path), JSON.stringify(experiment, null, 2) + '\n', { flag: 'wx' });
      state.experiments[index] = { id: experiment.id, status: experiment.status, path, hash: experiment.hash };
      saveState(repo, state, 'evaluation.finished', { id: experiment.id, status: experiment.status });
    });
  }
  console.log(JSON.stringify({ id: experiment.id, status: experiment.status, results: experiment.results, error: experiment.error }, null, 2));
  if (experiment.status !== 'pass') process.exitCode = 1;
}

function verifiedExperiment(repo, state, id) {
  const ref = state.experiments.find(e => e.id === id);
  if (!ref?.path || ref.status !== 'pass') throw new Error('a passing evaluation is required');
  const proof = readJson(safePath(repo, ref.path)), { hash, ...body } = proof;
  if (hash !== ref.hash || digest(body) !== hash || proof.status !== 'pass' || proof.candidate_hash !== contentHash(proof.candidate) || proof.environment.verifier !== environment().verifier) throw new Error('experiment is corrupt or stale');
  return proof;
}

function commandLearn(parsed, raw) {
  const action = raw[1], nested = parseArgs(raw.slice(2)), repo = resolve(nested.positional[0] || '.'), state = loadState(repo);
  if (action === 'propose') {
    const id = nested.options.id || `LR-${String(state.learning_proposals.length + 1).padStart(4, '0')}`;
    if (!SAFE_ID.test(id) || state.learning_proposals.some(p => p.id === id)) throw new Error('learning proposal requires a unique safe id');
    state.learning_proposals.push({ id, rule: requireText(nested.options.rule, '--rule'), rationale: nested.options.rationale || '',
      regression: nested.options.regression || '', rollback: nested.options.rollback || '', status: 'proposed', created_at: now(), approved_by: null });
    saveState(repo, state, 'learning.proposed', { id }); console.log(`Proposed ${id}`); return;
  }
  const proposal = state.learning_proposals.find(p => p.id === (nested.options.id || nested.positional[1]));
  if (!proposal) throw new Error('unknown learning proposal');
  if (action === 'evaluate') {
    const experiment = verifiedExperiment(repo, state, requireText(nested.options.experiment, '--experiment'));
    if (proposal.status === 'active') throw new Error('active rules cannot change their experiment');
    const policy = requireText(nested.options.policy, '--policy');
    if (!Object.hasOwn(inputManifest(experiment.candidate), policy)) throw new Error('policy must be a fingerprinted candidate input');
    const artifact = readJson(safePath(experiment.candidate, policy));
    if (artifact.rule !== proposal.rule) throw new Error('candidate policy must contain the exact proposed rule');
    proposal.policy = policy;
    proposal.experiment = experiment.id; proposal.evaluated_rule_hash = digest(proposal.rule); proposal.status = 'evaluated';
  } else if (action === 'review') {
    verifiedExperiment(repo, state, proposal.experiment);
    if (proposal.status !== 'evaluated') throw new Error('evaluate the proposal before review');
    proposal.review = { human: requireText(nested.options.human, '--human'), reason: requireText(nested.options.reason, '--reason'), rule_hash: digest(proposal.rule), experiment: proposal.experiment, at: now() };
    proposal.status = 'reviewed';
  } else if (action === 'approve') {
    verifiedExperiment(repo, state, proposal.experiment);
    const human = requireText(nested.options.human, '--human'); requireText(nested.options.reason, '--reason');
    if (proposal.status !== 'reviewed' || !proposal.rollback || !proposal.review || proposal.review.human === human || proposal.review.rule_hash !== digest(proposal.rule) || proposal.evaluated_rule_hash !== digest(proposal.rule) || proposal.review.experiment !== proposal.experiment) throw new Error('promotion requires current evaluation, independent review and rollback');
    proposal.status = 'active'; proposal.approved_by = human; proposal.approved_at = now();
  } else if (action === 'rollback') {
    requireText(nested.options.human, '--human'); requireText(nested.options.reason, '--reason');
    if (proposal.status !== 'active') throw new Error('only active rules can be rolled back');
    proposal.status = 'rolled-back'; proposal.rolled_back_at = now();
  } else throw new Error(`unknown learn action: ${action}`);
  saveState(repo, state, `learning.${action}`, { id: proposal.id }); console.log(`${action}: ${proposal.id}`);
}

function commandCleanup(parsed) {
  const repo = resolve(parsed.positional[0] || '.');
  const state = loadState(repo);
  const path = join(genesisDir(repo), 'index', 'graph.json');
  if (!existsSync(path)) runGraphizer(repo);
  const graph = readJson(path);
  const imported = new Set(graph.edges.filter((edge) => edge.type === 'imports').map((edge) => edge.target));
  const candidates = graph.nodes.filter((node) => node.type === 'file' && /\.(m?[jt]sx?|cjs|py)$/.test(node.path || '') && !imported.has(node.id))
    .filter((node) => !/(^|\/)(index|main|app|setup|conftest|test[^/]*)\.[^.]+$/.test(node.path));
  state.cleanup_proposals = candidates.map((node) => ({ path: node.path, reason: 'no incoming static import in the current approximate graph', confidence: 'low', action: 'review before deletion' }));
  saveState(repo, state, 'cleanup.proposed', { count: state.cleanup_proposals.length });
  console.log(`Proposed ${state.cleanup_proposals.length} cleanup reviews; deleted 0 files`);
}

function commandMigrate(parsed) {
  const repo = resolve(parsed.positional[0] || '.');
  const dir = genesisDir(repo);
  if (!existsSync(dir)) throw new Error('no legacy .genesis directory found');
  if (existsSync(statePath(repo))) {
    console.log('Genesis v2 state already exists; migration is complete.');
    return;
  }
  const legacyFiles = listFiles(dir, { includeGenesis: true }).map((path) => relative(dir, path).split(sep).join('/')).filter((path) => !path.startsWith('local/'));
  const report = { legacy_files: legacyFiles, preserved: true, unresolved: ['legacy HTML and Markdown remain evidence; operational fields require review'] };
  if (!parsed.options.write && !parsed.options.apply) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const discovery = discover(repo);
  const state = newState(repo, parsed.options, 'adopt', discovery);
  state.legacy = report;
  saveState(repo, state, 'migration.completed', { files: legacyFiles.length });
  runGraphizer(repo);
  console.log(`Migrated without deleting ${legacyFiles.length} legacy files`);
}

function printHelp() {
  console.log(`Genesis software-factory CLI

Usage:
  genesis init <repo> [--name N] [--objective TEXT] [--workflow new-product] [--profile prototype|production|regulated]
  genesis adopt <repo> [--write]
  genesis workflow status <repo>
  genesis spec start|status|check <repo>
  genesis spec approve <repo> --human NAME --reason TEXT
  genesis plan status|check <repo>
  genesis plan approve <repo> --human NAME --reason TEXT
  genesis plan reopen <repo> --human NAME --reason TEXT
  genesis agent connect <repo> [--codex] [--claude] [--write]
  genesis status|checkpoint|dashboard|cleanup <repo>
  genesis index <repo> [graphizer options]
  genesis serve <repo> [--port N] [--open]   live control panel, read-only
  genesis query <repo> search|defines|callers|callees|impact|neighbours|path ...
  genesis mcp <repo>                        expose the index to an agent over MCP stdio
  genesis trace <repo> --event NAME [--task ID] [--message TEXT]
  genesis record decision|knowledge <repo> --title TEXT --text TEXT [--source REF]
  genesis record assumption|invariant <repo> --text TEXT [--source REF]
  genesis task add <repo> --id ID --outcome TEXT [--requirement ID] [--risk low] [--gate id:command]
  genesis task set|complete <repo> --id ID
  genesis gate <repo> [task-id]
  genesis control approve <repo> [task-id] --gate ID --human NAME [--reason TEXT]
  genesis control <reject|pause|resume|retry|requeue|rollback> <repo> [task-id]
  genesis learn propose|evaluate|review|approve|rollback <repo> ...
  genesis context|next <repo> [task-id] [--bytes 8000] [--id RECORD] [--full] [--stats] [--since HASH]
  genesis brief <repo> [task-id] [--stage research|plan|implement|verify|recover]
  genesis authorize grant <repo> --id ID --task ID --command CMD --human NAME --reason TEXT --expires ISO
  genesis authorize list|revoke <repo> [--id ID]
  genesis run <repo> [--max-tasks 1] [--timeout 600000]
  genesis recover <repo>
  genesis evaluate <repo> --baseline PATH --candidate PATH --suite JSON [--timeout 600000]
  genesis incident record|update|list <repo> ...
  genesis migrate <repo> [--write]
`);
}

async function main(raw) {
  const command = raw[0];
  if (!command || command === 'help' || command === '--help') return printHelp();
  const parsed = parseArgs(raw.slice(1));
  if (command === 'gate') return commandGate(parsed);
  if (command === 'run') return commandRun(parsed);
  if (command === 'evaluate') return commandEvaluate(parsed);
  if (command === 'recover') return commandRecover(parsed);
  if (command === 'serve') return commandServe(parsed);
  if (command === 'query') return commandQuery(parsed, raw);
  if (command === 'mcp') return commandMcp(parsed);
  const nestedCommands = ['task', 'control', 'record', 'spec', 'plan', 'agent', 'learn', 'authorize', 'incident', 'workflow'];
  const repo = resolve((nestedCommands.includes(command) ? parseArgs(raw.slice(2)) : parsed).positional[0] || '.');
  return withLock(repo, () => dispatch(command, parsed, raw));
}

function dispatch(command, parsed, raw) {
  if (command === 'context' || command === 'next' || command === 'brief') return commandContext(parsed, command === 'brief');
  if (command === 'authorize') return commandAuthorization(parsed, raw);
  if (command === 'incident') return commandIncident(parsed, raw);
  if (command === 'init') return commandInit(parsed);
  if (command === 'adopt') return commandAdopt(parsed);
  if (command === 'status') return commandStatus(parsed);
  if (command === 'checkpoint' || command === 'kickoff') return commandCheckpoint(parsed);
  if (command === 'dashboard') return commandDashboard(parsed);
  if (command === 'trace') return commandTrace(parsed);
  if (command === 'workflow') return commandWorkflow(parsed, raw);
  if (command === 'spec') return commandSpec(parsed, raw);
  if (command === 'plan') return commandPlan(parsed, raw);
  if (command === 'agent') return commandAgent(parsed, raw);
  if (command === 'record') return commandRecord(parsed, raw);
  if (command === 'task') return commandTask(parsed, raw);
  if (command === 'control') return commandControl(parsed, raw);
  if (command === 'learn') return commandLearn(parsed, raw);
  if (command === 'cleanup') return commandCleanup(parsed);
  if (command === 'migrate') return commandMigrate(parsed);
  if (command === 'index') return runGraphizer(resolve(parsed.positional[0] || '.'), raw.slice(2)) && console.log('Indexed repository');
  throw new Error(`unknown command: ${command}`);
}

main(process.argv.slice(2)).catch((error) => fail(error.message));
