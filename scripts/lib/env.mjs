// Environment auto-detection so the skill runs turnkey in both a local install
// (Playwright/Remotion use their own bundled browsers) and a cloud sandbox
// (Claude Code web), where a Chromium is preinstalled under /opt/pw-browsers and
// ffmpeg-static may not run. No manual env vars required.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';

const PW_DIR = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';

// Newest /opt/pw-browsers/<prefix>-<build>/<rel> that exists, or null.
function findPreinstalled(prefix, rel) {
  try {
    if (!existsSync(PW_DIR)) return null;
    const matches = readdirSync(PW_DIR)
      .filter((d) => d.startsWith(prefix + '-'))
      .map((d) => ({ d, n: parseInt(d.split('-').pop(), 10) || 0 }))
      .sort((a, b) => b.n - a.n);
    for (const { d } of matches) {
      const p = join(PW_DIR, d, rel);
      if (existsSync(p)) return p;
    }
  } catch (_) {
    /* ignore */
  }
  return null;
}

// Chromium for Playwright capture. Priority: explicit override -> Playwright's own
// bundled build (local installs) -> preinstalled cloud Chromium -> undefined (default).
export function resolveCaptureChromium() {
  if (process.env.SS_CHROMIUM_PATH) return process.env.SS_CHROMIUM_PATH;
  try {
    const own = chromium.executablePath();
    if (own && existsSync(own)) return undefined; // let Playwright use its own
  } catch (_) {
    /* ignore */
  }
  return findPreinstalled('chromium', join('chrome-linux', 'chrome')) || undefined;
}

// Chrome for Remotion rendering. Prefer a real chrome-headless-shell when present
// (cloud); otherwise undefined so Remotion downloads/uses its own (local).
export function resolveRenderChrome() {
  if (process.env.SS_RENDER_CHROME) return process.env.SS_RENDER_CHROME;
  return (
    findPreinstalled(
      'chromium_headless_shell',
      join('chrome-linux', 'headless_shell'),
    ) || undefined
  );
}

// ffmpeg binary + whether it can encode H.264. Priority: FFMPEG_PATH -> system
// ffmpeg on PATH -> ffmpeg-static. A binary that won't even run (e.g. a segfaulting
// ffmpeg-static in some sandboxes) is skipped.
export async function resolveFfmpeg() {
  const candidates = [];
  if (process.env.FFMPEG_PATH) candidates.push(process.env.FFMPEG_PATH);
  candidates.push('ffmpeg'); // PATH
  try {
    const m = await import('ffmpeg-static');
    if (m?.default) candidates.push(m.default);
  } catch (_) {
    /* ignore */
  }
  for (const bin of candidates) {
    const probe = spawnSync(bin, ['-hide_banner', '-encoders'], { encoding: 'utf8' });
    if (probe.status === 0 && typeof probe.stdout === 'string') {
      return { bin, canH264: /\blibx264\b/.test(probe.stdout) };
    }
  }
  return { bin: null, canH264: false };
}

// True when there's no usable display for an interactive (headful) browser.
export function hasDisplay() {
  if (process.platform === 'win32' || process.platform === 'darwin') return true;
  return Boolean(process.env.DISPLAY);
}
