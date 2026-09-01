import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('legacy scaffold delegates to v2 init without persisting removed options', () => {
  const repo = mkdtempSync(join(tmpdir(), 'genesis-scaffold-'));
  execFileSync(join(root, 'tools', 'scaffold.sh'), [repo, 'old-script', '--cheap-model', 'tiny', '--objective', 'Keep old scripts working']);
  const state = JSON.parse(readFileSync(join(repo, '.genesis', 'project.json'), 'utf8'));
  assert.equal(state.project.name, 'old-script');
  assert.equal(state.project.objective, 'Keep old scripts working');
  assert.equal(state.policy.ponytail, 'full');
  assert.equal(JSON.stringify(state).includes('tiny'), false);
});

test('installer is offline, idempotent, and installs Genesis plus Ponytail for both agents', () => {
  const home = mkdtempSync(join(tmpdir(), 'genesis-install-'));
  const bin = join(home, 'bin');
  const env = { ...process.env, HOME: home, GENESIS_BIN_DIR: bin };
  execFileSync(join(root, 'install.sh'), { env });
  execFileSync(join(root, 'install.sh'), { env });
  assert.ok(existsSync(join(home, '.codex', 'skills', 'genesis', 'SKILL.md')));
  assert.ok(existsSync(join(home, '.codex', 'skills', 'ponytail', 'SKILL.md')));
  assert.ok(existsSync(join(home, '.claude', 'skills', 'genesis', 'SKILL.md')));
  assert.ok(existsSync(join(home, '.claude', 'skills', 'ponytail', 'SKILL.md')));
  assert.ok(lstatSync(join(bin, 'genesis')).isSymbolicLink());
  assert.match(execFileSync(join(bin, 'genesis'), ['--help'], { encoding: 'utf8' }), /genesis spec start\|status\|check/);
  assert.match(readFileSync(join(home, '.codex', 'skills', 'genesis', 'SKILL.md'), 'utf8'), /New-product workflow/);
  assert.match(readFileSync(join(home, '.codex', 'skills', 'ponytail', 'SKILL.md'), 'utf8'), /The shortest path to done is the right path/);
});
