#!/usr/bin/env node
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const repo = mkdtempSync(join(tmpdir(), 'genesis-demo-'));
const cli = join(dirname(fileURLToPath(import.meta.url)), 'genesis.mjs');
const run = (...args) => execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' }).trim();
execFileSync('git', ['init', '-q', repo]);
mkdirSync(join(repo, 'src'));
writeFileSync(join(repo, 'src', 'queue.mjs'), 'export const enqueue = value => ({ value, accepted: true });\n');
run('init', repo, '--name', 'Atlas / Background jobs', '--objective', 'Ship a queue that picks up where it left off.');
const gate = 'tests:node -e "process.exit(0)"';
run('task', 'add', repo, '--id', 'T-01', '--outcome', 'Map worker startup and failure paths', '--scope', 'src', '--gate', gate);
run('gate', repo); run('task', 'complete', repo, '--id', 'T-01');
run('task', 'add', repo, '--id', 'T-02', '--outcome', 'Make interrupted jobs safe to resume', '--scope', 'src', '--risk', 'medium', '--owner', 'implementer', '--gate', gate, '--next', 'Add an interruption regression, then inspect the current proof with an independent reviewer.');
run('task', 'add', repo, '--id', 'T-03', '--outcome', 'Verify retries across two worker instances', '--depends', 'T-02', '--scope', 'src', '--gate', gate);
run('task', 'add', repo, '--id', 'T-04', '--outcome', 'Document rollout and recovery procedures', '--depends', 'T-03', '--gate', gate);
run('record', 'knowledge', repo, '--id', 'K-01', '--title', 'Queue boundary', '--text', 'Demo observation: a job needs a durable receipt before another worker retries it.', '--path', 'src', '--source', 'Synthetic demonstration');
run('record', 'invariant', repo, '--id', 'INV-01', '--text', 'Do not replay an external side effect until the previous attempt is reconciled.', '--path', 'src', '--source', 'Demo contract');
run('gate', repo, 'T-02');
run('learn', 'propose', repo, '--id', 'LR-01', '--rule', 'Read the last attempt receipt before planning a retry.', '--rationale', 'Reduce repeated side effects', '--rollback', 'Deactivate LR-01');
run('trace', repo, '--event', 'demo.ready', '--message', 'Synthetic UI demo. Passing no-op gates illustrate the interface, not queue correctness.');
run('checkpoint', repo);
console.log(run('dashboard', repo, ...(process.argv.includes('--open') ? ['--open'] : [])));
console.log(`Demo only. Remove ${repo} when finished.`);
