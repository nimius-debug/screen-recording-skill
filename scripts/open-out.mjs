#!/usr/bin/env node
// Print and open the most recent rendered video in ./out (or --in <dir>).

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const i = process.argv.indexOf('--in');
const dir = resolve(i !== -1 ? process.argv[i + 1] : 'out');
if (!existsSync(dir)) {
  console.error(`[open-out] no such dir: ${dir}`);
  process.exit(1);
}

const mp4s = readdirSync(dir)
  .filter((f) => f.endsWith('.mp4'))
  .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
  .sort((a, b) => b.t - a.t);

if (mp4s.length === 0) {
  console.error(`[open-out] no .mp4 found in ${dir} (run npm run build first)`);
  process.exit(1);
}

const latest = join(dir, mp4s[0].f);
console.log(latest);

const opener =
  process.platform === 'win32' ? ['cmd', ['/c', 'start', '', latest]]
  : process.platform === 'darwin' ? ['open', [latest]]
  : ['xdg-open', [latest]];
try {
  spawn(opener[0], opener[1], { detached: true, stdio: 'ignore' }).unref();
} catch (_) {
  /* path already printed above */
}
