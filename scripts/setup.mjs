#!/usr/bin/env node
// SessionStart hook: make a fresh Claude Code session ready to record without a
// manual install step. Idempotent — a fast no-op once node_modules exists.

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Playwright is the heaviest required dep; its presence means install already ran.
if (existsSync(join(ROOT, 'node_modules', 'playwright'))) process.exit(0);

console.log('[setup] installing dependencies (first run)…');
const r = spawnSync('npm', ['install', '--no-audit', '--no-fund'], {
  cwd: ROOT,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(r.status ?? 0);
