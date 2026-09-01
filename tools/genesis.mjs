#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync,
  statSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA_VERSION = 2;
const RISK = new Set(['low', 'medium', 'high', 'critical']);
const TASK_STATES = new Set(['queued', 'active', 'paused', 'blocked', 'failed', 'verified', 'done', 'rejected']);
const CONTROL_ACTIONS = new Set(['approve', 'reject', 'pause', 'resume', 'retry', 'requeue', 'rollback']);
const GENERATED = new Set(['KICKOFF.md', 'dashboard.html']);

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
  validateState(state);
  return state;
}

function validateState(state) {
  if (state.schema_version !== SCHEMA_VERSION) throw new Error(`unsupported schema_version ${state.schema_version}`);
  if (!state.project?.name || !state.lifecycle || !Array.isArray(state.tasks)) throw new Error('project state is missing required fields');
  if (state.policy?.ponytail !== 'full') throw new Error('Ponytail full is required by project policy');
  for (const task of state.tasks) {
    if (!task.id || !TASK_STATES.has(task.state) || !RISK.has(task.risk) || !Array.isArray(task.gates)) {
      throw new Error(`invalid task record: ${task.id || '<missing id>'}`);
    }
  }
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
      try { stat = statSync(path); } catch { continue; }
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile()) files.push(path);
    }
  }
  walk(root);
  return files;
}

function contentHash(repo) {
  const hash = createHash('sha256');
  for (const path of listFiles(repo)) {
    hash.update(relative(repo, path).split(sep).join('/'));
    hash.update('\0');
    hash.update(readFileSync(path));
    hash.update('\0');
  }
  return hash.digest('hex');
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

function redactText(value) {
  return String(value)
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]')
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [REDACTED]')
    .replace(/\b(api[_-]?key|token|password|secret|authorization)\b\s*[:=]\s*([^\s,;]+)/gi, '$1=[REDACTED]');
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
  return {
    schema_version: SCHEMA_VERSION,
    project: {
      name: options.name === true || !options.name ? basename(repo) : options.name,
      mode,
      profile: options.profile === true || !options.profile ? 'prototype' : options.profile,
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
    assumptions: [],
    invariants: [],
    decisions: [],
    knowledge: [],
    tasks: [],
    learning_proposals: [],
    cleanup_proposals: [],
    controls: [],
    discovery,
    checkpoint: null,
    legacy: null,
  };
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
  renderDashboard(repo, state);
}

function seed(repo, options, mode, discovery = null) {
  if (existsSync(genesisDir(repo))) throw new Error(`${genesisDir(repo)} already exists; refusing to overwrite`);
  mkdirSync(genesisDir(repo), { recursive: true });
  const state = newState(repo, options, mode, discovery);
  saveState(repo, state, `project.${mode}`, { project: state.project.name });
  return state;
}

function freshGate(gate, sourceHash) {
  if (!gate.evidence || gate.status !== 'pass') return { ...gate, effective_status: gate.status || 'pending' };
  return { ...gate, effective_status: gate.evidence.source_hash === sourceHash ? 'pass' : 'stale' };
}

function taskSummary(task, sourceHash) {
  return { ...task, gates: task.gates.map((gate) => freshGate(gate, sourceHash)) };
}

function renderKickoff(repo, state) {
  const hash = contentHash(repo);
  const active = state.tasks.find((task) => task.id === state.lifecycle.active_task) || null;
  const completed = state.tasks.filter((task) => task.state === 'done');
  const activeGates = active?.gates.map((gate) => freshGate(gate, hash)) || [];
  const decisionText = state.decisions.map((item) => typeof item === 'string' ? item : `${item.id}: ${item.title || item.text}`).join(', ');
  const invariantText = state.invariants.map((item) => typeof item === 'string' ? item : `${item.id}: ${item.text}`).join('; ');
  const assumptionText = state.assumptions.map((item) => typeof item === 'string' ? item : `${item.id}: ${item.text} [${item.status || 'open'}]`).join('; ');
  const lines = [
    `# KICKOFF — ${state.project.name}`,
    '',
    '> Generated from `.genesis/project.json`; do not edit this file.',
    '',
    '## Cold-session contract',
    '',
    'Load the official Ponytail skill at `full`. Verify repository state and baseline before editing.',
    '',
    `- objective: ${state.project.objective}`,
    `- mode/profile: ${state.project.mode} / ${state.project.profile}`,
    `- phase/status: ${state.lifecycle.phase} / ${state.lifecycle.status}`,
    `- active task: ${active ? `${active.id} — ${active.outcome}` : 'none'}`,
    `- owner: ${active?.owner || 'unassigned'}`,
    `- blocker: ${state.lifecycle.blocker || 'none'}`,
    `- next action: ${state.lifecycle.next_action}`,
    `- source hash: ${hash}`,
    '',
    '## Completed work',
    '',
    ...(completed.length ? completed.map((task) => `- ${task.id}: ${task.outcome} · proof: ${task.gates.map((gate) => gate.evidence?.path || `${gate.id}:${gate.status}`).join(', ') || 'no gates'}`) : ['- none']),
    '',
    '## Active evidence and failures',
    '',
    ...(active ? [
      `- gates: ${activeGates.map((gate) => `${gate.id}:${gate.effective_status}${gate.evidence?.path ? ` (${gate.evidence.path})` : ''}`).join(', ') || 'none'}`,
      `- failures: ${active.failures?.join('; ') || 'none recorded'}`,
      `- limitations: ${active.limitations?.join('; ') || 'none recorded'}`,
      `- notes: ${active.notes?.join('; ') || 'none recorded'}`,
    ] : ['- no active task']),
    '',
    '## Binding context',
    '',
    `- decisions: ${decisionText || 'none recorded'}`,
    `- invariants: ${invariantText || 'none confirmed'}`,
    `- assumptions: ${assumptionText || 'none recorded'}`,
    `- knowledge: ${state.knowledge.length ? state.knowledge.map((item) => `${item.id}: ${item.title}`).join(', ') : 'none recorded'}`,
    '',
    '## Resume',
    '',
    '1. Read this file and the active task in `.genesis/project.json`.',
    '2. Inspect relevant decisions, graph neighbors, proof, and recent git history only.',
    '3. Run the baseline command when configured.',
    '4. Report `state -> evidence -> blocker -> next action` before editing.',
    '5. End with `genesis checkpoint <repo>`.',
    '',
  ];
  atomicWrite(join(genesisDir(repo), 'KICKOFF.md'), `${lines.join('\n')}\n`);
}

function html(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function renderDashboard(repo, state) {
  const hash = contentHash(repo);
  const tasks = state.tasks.map((task) => taskSummary(task, hash));
  const traces = recentTraces(repo);
  const rows = tasks.map((task) => {
    const gates = task.gates.map((gate) => `${html(gate.id)}: ${html(gate.effective_status)}`).join('<br>') || 'none';
    return `<tr><td>${html(task.id)}</td><td>${html(task.outcome)}</td><td>${html(task.state)}</td><td>${html(task.risk)}</td><td>${gates}</td><td>${html(task.next_action || '')}</td></tr>`;
  }).join('\n');
  const traceRows = traces.slice().reverse().map((item) => `<tr><td>${html(item.at || '')}</td><td>${html(item.event)}</td><td><code>${html(JSON.stringify(item.data))}</code></td></tr>`).join('\n');
  const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="5"><title>Genesis — ${html(state.project.name)}</title>
<style>body{font:15px/1.5 system-ui;margin:2rem;background:#0d1117;color:#e6edf3}main{max-width:1100px;margin:auto}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1rem}.card{border:1px solid #30363d;border-radius:10px;padding:1rem;background:#161b22}table{width:100%;border-collapse:collapse}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #30363d;padding:.6rem}code{word-break:break-all;color:#79c0ff}.muted{color:#8b949e}</style></head>
<body><main><h1>${html(state.project.name)}</h1><p class="muted">Generated from project.json · refreshes every 5 seconds</p>
<section class="grid"><div class="card"><b>Phase</b><div>${html(state.lifecycle.phase)}</div></div><div class="card"><b>Status</b><div>${html(state.lifecycle.status)}</div></div><div class="card"><b>Active task</b><div>${html(state.lifecycle.active_task || 'none')}</div></div><div class="card"><b>Blocker</b><div>${html(state.lifecycle.blocker || 'none')}</div></div></section>
<h2>Next action</h2><div class="card">${html(state.lifecycle.next_action)}</div>
<h2>Tasks and proof</h2><table><thead><tr><th>ID</th><th>Outcome</th><th>State</th><th>Risk</th><th>Gates</th><th>Next</th></tr></thead><tbody>${rows || '<tr><td colspan="6">No tasks yet.</td></tr>'}</tbody></table>
<h2>Recent local traces</h2><table><thead><tr><th>At</th><th>Event</th><th>Redacted data</th></tr></thead><tbody>${traceRows || '<tr><td colspan="3">No traces yet.</td></tr>'}</tbody></table>
<h2>Source</h2><code>${html(hash)}</code><p class="muted">Raw traces: local/events.jsonl (local only)</p></main></body></html>\n`;
  atomicWrite(join(genesisDir(repo), 'dashboard.html'), page);
}

function runGraphizer(repo) {
  const graphizer = join(dirname(fileURLToPath(import.meta.url)), 'graphizer.mjs');
  const result = spawnSync(process.execPath, [graphizer, repo, '--write'], { encoding: 'utf8' });
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
    lifecycle: state.lifecycle,
    tasks: state.tasks.map((task) => taskSummary(task, hash)),
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
  console.log(join(genesisDir(repo), 'dashboard.html'));
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
  return { id: spec.slice(0, index), command: spec.slice(index + 1), mandatory: true, status: 'pending', evidence: null };
}

function commandTask(parsed, raw) {
  const action = raw[1];
  const nested = parseArgs(raw.slice(2));
  const repo = resolve(nested.positional[0] || '.');
  const state = loadState(repo);
  if (action === 'add') {
    const id = nested.options.id === true || !nested.options.id ? nested.positional[1] : nested.options.id;
    if (!id || state.tasks.some((task) => task.id === id)) throw new Error('task add requires a unique --id');
    const risk = nested.options.risk === true || !nested.options.risk ? 'low' : nested.options.risk;
    if (!RISK.has(risk)) throw new Error(`invalid risk: ${risk}`);
    const task = {
      id,
      outcome: nested.options.outcome === true || !nested.options.outcome ? 'Define the task outcome.' : nested.options.outcome,
      state: 'queued', risk, owner: nested.options.owner || null,
      scope: values(nested.options.scope), dependencies: values(nested.options.depends),
      gates: values(nested.options.gate).map(parseGate),
      next_action: nested.options.next === true || !nested.options.next ? 'Run the task pre-flight.' : nested.options.next,
      blocker: null, notes: [], failures: [], limitations: [], created_at: now(), updated_at: now(),
    };
    state.tasks.push(task);
    if (!state.lifecycle.active_task) {
      state.lifecycle.active_task = id;
      state.lifecycle.phase = 'build';
      task.state = 'active';
      state.lifecycle.next_action = task.next_action;
    }
    saveState(repo, state, 'task.added', { id, outcome: task.outcome });
    console.log(`Added ${id}`);
    return;
  }
  const id = nested.options.id === true || !nested.options.id ? nested.positional[1] : nested.options.id;
  const task = state.tasks.find((item) => item.id === id);
  if (!task) throw new Error(`unknown task: ${id}`);
  if (action === 'set') {
    if (nested.options.state && nested.options.state !== true) {
      if (!TASK_STATES.has(nested.options.state)) throw new Error(`invalid task state: ${nested.options.state}`);
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
    const hash = contentHash(repo);
    const gates = task.gates.map((gate) => freshGate(gate, hash));
    const incomplete = gates.filter((gate) => gate.mandatory && gate.effective_status !== 'pass');
    const needsReview = task.risk !== 'low' && !gates.some((gate) => gate.id === 'independent-review' && gate.effective_status === 'pass');
    if (incomplete.length || needsReview) {
      const names = incomplete.map((gate) => `${gate.id}:${gate.effective_status}`);
      if (needsReview) names.push('independent-review:missing');
      throw new Error(`cannot complete ${id}; ${names.join(', ')}`);
    }
    task.state = 'done';
    task.updated_at = now();
    if (state.lifecycle.active_task === id) {
      const next = state.tasks.find((item) => item.state === 'queued');
      state.lifecycle.active_task = next?.id || null;
      state.lifecycle.phase = next ? 'build' : 'verify';
      state.lifecycle.status = next ? 'active' : 'ready';
      state.lifecycle.next_action = next?.next_action || 'Review completed work and choose the next bounded outcome.';
      if (next) next.state = 'active';
    }
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
    state.invariants.push({ id, text: nested.options.text, source: nested.options.source || 'human-confirmed', recorded_at: now() });
  } else throw new Error(`unknown record type: ${type}`);
  saveState(repo, state, `${type}.recorded`, { id });
  console.log(`Recorded ${id}`);
}

function commandGate(parsed) {
  const repo = resolve(parsed.positional[0] || '.');
  const state = loadState(repo);
  const id = parsed.positional[1] || state.lifecycle.active_task;
  const task = state.tasks.find((item) => item.id === id);
  if (!task) throw new Error(`unknown task: ${id || '<none>'}`);
  if (!task.gates.length) throw new Error(`${id} has no gates`);
  let failed = false;
  for (const gate of task.gates) {
    if (!gate.command) continue;
    const started = now();
    const result = spawnSync(gate.command, { cwd: repo, shell: true, encoding: 'utf8', timeout: Number(parsed.options.timeout || 120000) });
    const proof = {
      task: id, gate: gate.id, command: gate.command, started_at: started, observed_at: now(),
      exit_code: result.status, signal: result.signal, stdout: redact((result.stdout || '').slice(-20000)),
      stderr: redact((result.stderr || '').slice(-20000)), revision: gitInfo(repo),
      source_hash: contentHash(repo), environment: { node: process.version, platform: process.platform, arch: process.arch },
    };
    proof.hash = createHash('sha256').update(JSON.stringify(proof)).digest('hex');
    gate.status = result.status === 0 ? 'pass' : 'fail';
    gate.evidence = { path: `.genesis/evidence/${id}-${gate.id}.json`, source_hash: proof.source_hash, hash: proof.hash, observed_at: proof.observed_at };
    writeJson(join(repo, gate.evidence.path), proof);
    if (gate.mandatory && gate.status !== 'pass') failed = true;
  }
  task.updated_at = now();
  saveState(repo, state, 'gate.ran', { task: id, failed });
  console.log(`${id}: ${failed ? 'failed' : 'passed executable gates'}`);
  if (failed) process.exitCode = 1;
}

function commandControl(parsed, raw) {
  const action = raw[1];
  if (!CONTROL_ACTIONS.has(action)) throw new Error(`unknown control action: ${action}`);
  const nested = parseArgs(raw.slice(2));
  const repo = resolve(nested.positional[0] || '.');
  const state = loadState(repo);
  const id = nested.positional[1] || state.lifecycle.active_task;
  const task = state.tasks.find((item) => item.id === id);
  if (!task) throw new Error(`unknown task: ${id || '<none>'}`);
  const record = { id: randomUUID(), at: now(), action, task: id, human: nested.options.human || null, reason: nested.options.reason || null, revision: nested.options.revision || null };
  if (action === 'approve' && nested.options.gate && nested.options.gate !== true) {
    if (!record.human) throw new Error('manual gate approval requires --human');
    const gate = task.gates.find((item) => item.id === nested.options.gate);
    if (!gate) throw new Error(`unknown gate: ${nested.options.gate}`);
    gate.status = 'pass';
    gate.evidence = { human: record.human, reason: record.reason, source_hash: contentHash(repo), observed_at: record.at };
  } else if (action === 'pause') task.state = 'paused';
  else if (action === 'resume' || action === 'retry' || action === 'requeue') task.state = action === 'requeue' ? 'queued' : 'active';
  else if (action === 'reject') task.state = 'rejected';
  else if (action === 'rollback') {
    if (!record.revision) throw new Error('rollback records require --revision; Genesis never runs destructive git reset');
    task.state = 'blocked';
    task.blocker = `rollback requested to ${record.revision}`;
  }
  state.controls.push(record);
  if (state.lifecycle.active_task === id) {
    state.lifecycle.status = task.state;
    state.lifecycle.blocker = task.blocker;
  }
  saveState(repo, state, `control.${action}`, record);
  console.log(`${action}: ${id}`);
}

function commandLearn(parsed, raw) {
  const action = raw[1];
  const nested = parseArgs(raw.slice(2));
  const repo = resolve(nested.positional[0] || '.');
  const state = loadState(repo);
  if (action === 'propose') {
    if (!nested.options.rule || nested.options.rule === true) throw new Error('learn propose requires --rule');
    const proposal = {
      id: nested.options.id === true || !nested.options.id ? `LR-${String(state.learning_proposals.length + 1).padStart(4, '0')}` : nested.options.id,
      rule: nested.options.rule, rationale: nested.options.rationale || '', regression: nested.options.regression || '',
      rollback: nested.options.rollback || '', status: 'proposed', created_at: now(), approved_by: null,
    };
    state.learning_proposals.push(proposal);
    saveState(repo, state, 'learning.proposed', { id: proposal.id, rule: proposal.rule });
    console.log(`Proposed ${proposal.id}`);
    return;
  }
  if (action === 'approve') {
    const id = nested.options.id === true || !nested.options.id ? nested.positional[1] : nested.options.id;
    const proposal = state.learning_proposals.find((item) => item.id === id);
    if (!proposal) throw new Error(`unknown learning proposal: ${id}`);
    if (!nested.options.human || nested.options.human === true) throw new Error('learning approval requires --human');
    if (!proposal.regression || !proposal.rollback || nested.options.review !== 'pass') {
      throw new Error('learning approval requires recorded regression, rollback, and --review pass');
    }
    proposal.status = 'active';
    proposal.approved_by = nested.options.human;
    proposal.approved_at = now();
    saveState(repo, state, 'learning.approved', { id, human: proposal.approved_by });
    console.log(`Approved ${id}`);
    return;
  }
  throw new Error(`unknown learn action: ${action}`);
}

function commandCleanup(parsed) {
  const repo = resolve(parsed.positional[0] || '.');
  const state = loadState(repo);
  const path = join(genesisDir(repo), 'index', 'graph.json');
  if (!existsSync(path)) runGraphizer(repo);
  const graph = readJson(path);
  const imported = new Set(graph.edges.filter((edge) => edge.kind === 'imports').map((edge) => edge.to));
  const candidates = graph.nodes.filter((node) => node.kind === 'file' && /\.(m?[jt]sx?|cjs|py)$/.test(node.path || '') && !imported.has(node.id))
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
  genesis init <repo> [--name N] [--objective TEXT] [--profile prototype|production|regulated]
  genesis adopt <repo> [--write]
  genesis status|checkpoint|dashboard|cleanup <repo>
  genesis index <repo> [graphizer options]
  genesis trace <repo> --event NAME [--task ID] [--message TEXT]
  genesis record <knowledge|decision|assumption|invariant> <repo> ...
  genesis task add <repo> --id ID --outcome TEXT [--risk low] [--gate id:command]
  genesis task set|complete <repo> --id ID
  genesis gate <repo> [task-id]
  genesis control <approve|reject|pause|resume|retry|requeue|rollback> <repo> [task-id]
  genesis learn propose|approve <repo> ...
  genesis migrate <repo> [--write]
`);
}

async function main(raw) {
  const command = raw[0];
  if (!command || command === 'help' || command === '--help') return printHelp();
  const parsed = parseArgs(raw.slice(1));
  if (command === 'init') return commandInit(parsed);
  if (command === 'adopt') return commandAdopt(parsed);
  if (command === 'status') return commandStatus(parsed);
  if (command === 'checkpoint' || command === 'kickoff') return commandCheckpoint(parsed);
  if (command === 'dashboard') return commandDashboard(parsed);
  if (command === 'trace') return commandTrace(parsed);
  if (command === 'record') return commandRecord(parsed, raw);
  if (command === 'task') return commandTask(parsed, raw);
  if (command === 'gate') return commandGate(parsed);
  if (command === 'control') return commandControl(parsed, raw);
  if (command === 'learn') return commandLearn(parsed, raw);
  if (command === 'cleanup') return commandCleanup(parsed);
  if (command === 'migrate') return commandMigrate(parsed);
  if (command === 'index') return runGraphizer(resolve(parsed.positional[0] || '.')) && console.log('Indexed repository');
  throw new Error(`unknown command: ${command}`);
}

main(process.argv.slice(2)).catch((error) => fail(error.message));
