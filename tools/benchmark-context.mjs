#!/usr/bin/env node
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const repo = mkdtempSync(join(tmpdir(), 'genesis-context-bench-'));
const cli = join(dirname(fileURLToPath(import.meta.url)), 'genesis.mjs');
const run = (...args) => execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' }).trim();
try {
  execFileSync('git', ['init', '-q', repo]);
  run('init', repo, '--name', 'Context benchmark');
  run('task', 'add', repo, '--id', 'T-1', '--outcome', 'Fix parser boundary handling', '--scope', 'src/parser', '--gate', 'tests:node -e "process.exit(0)"');
  const path = join(repo, '.genesis', 'project.json'), state = JSON.parse(readFileSync(path));
  // Synthetic benchmark data only; product state must be edited through the CLI.
  state.knowledge = Array.from({ length: 150 }, (_, i) => ({ id: `K-${i}`, title: `Parser observation ${i}`, text: 'A synthetic observation with a concrete implementation detail. '.repeat(14), paths: i < 30 ? ['src/parser'] : ['src/unrelated'], tags: [], source: 'synthetic benchmark', recorded_at: '2026-09-08T00:00:00Z' }));
  writeFileSync(path, JSON.stringify(state, null, 2));
  run('checkpoint', repo);
  const packet = run('context', repo), data = JSON.parse(packet), full = run('context', repo, '--full', '--bytes', '64000');
  const delta = run('context', repo, '--since', data.fingerprint);
  console.log(JSON.stringify({ fixture: '150 synthetic records; 30 match task scope', measurement: 'UTF-8 bytes, not model tokens or acceptance success', raw_state_bytes: readFileSync(path).length, full_context_bytes: Buffer.byteLength(full), compact_context_bytes: Buffer.byteLength(packet), unchanged_bytes: Buffer.byteLength(delta), kickoff_bytes: readFileSync(join(repo, '.genesis', 'KICKOFF.md')).length, included_records: data.records.length, omitted_items: data.omitted }, null, 2));
} finally { rmSync(repo, { recursive: true, force: true }); }
