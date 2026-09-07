#!/usr/bin/env node
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const dir of ['tools', 'tests']) {
  for (const name of readdirSync(join(root, dir)).filter(n => n.endsWith('.mjs'))) {
    const result = spawnSync(process.execPath, ['--check', join(root, dir, name)], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status || 1);
  }
}
console.log('JavaScript syntax checks passed.');
