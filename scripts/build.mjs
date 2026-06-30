#!/usr/bin/env node
// Turn a recording (recording.webm + events.json) into the final polished video.
//   1. ffmpeg transcode webm (VP8) -> mp4 (H.264) at a constant fps for Remotion
//   2. stage recording.mp4 + events.json into remotion/public
//   3. remotion render -> final out.mp4
//
// Usage:
//   node scripts/build.mjs [--in out] [--out out/final.mp4]

import { spawnSync } from 'node:child_process';
import { mkdirSync, copyFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveFfmpeg, resolveRenderChrome } from './lib/env.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : def;
}

const inDir = resolve(arg('--in', 'out'));
const finalOut = resolve(arg('--out', join(inDir, 'final.mp4')));
const manifestPath = join(inDir, 'events.json');

// Accept whatever the recorder produced (webm from Playwright, mp4/mkv from elsewhere).
const SRC_NAMES = ['recording.webm', 'recording.mp4', 'recording.mkv'];
const srcVideo = SRC_NAMES.map((n) => join(inDir, n)).find(existsSync);
if (!srcVideo) throw new Error(`no recording.{webm,mp4,mkv} in ${inDir} (run scripts/record.mjs first)`);
if (!existsSync(manifestPath)) throw new Error(`missing ${manifestPath}`);

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const fps = manifest.fps || 30;
const ext = srcVideo.slice(srcVideo.lastIndexOf('.'));

const publicDir = join(ROOT, 'remotion', 'public');
mkdirSync(publicDir, { recursive: true });

const wantTranscode = !process.argv.includes('--no-transcode') && ext !== '.mp4';
const { bin: ffmpegBin, canH264 } = wantTranscode
  ? await resolveFfmpeg()
  : { bin: null, canH264: false };

let videoName;
if (!wantTranscode || !ffmpegBin || !canH264) {
  // No transcode needed/possible — stage the source as-is. Remotion's own ffmpeg
  // decodes VP8 webm fine, so this is a clean fallback when no H.264 encoder exists.
  if (wantTranscode && (!ffmpegBin || !canH264)) {
    console.log('[build] no H.264-capable ffmpeg found; using the recording directly');
  }
  videoName = `recording${ext}`;
  copyFileSync(srcVideo, join(publicDir, videoName));
} else {
  // Transcode to constant-fps H.264 mp4 for the most reliable seeking + playback.
  videoName = 'recording.mp4';
  console.log(`[build] transcoding -> mp4 with ffmpeg (${ffmpegBin})…`);
  const ff = spawnSync(
    ffmpegBin,
    ['-y', '-i', srcVideo, '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
     '-r', String(fps), '-an', join(publicDir, videoName)],
    { stdio: 'inherit' },
  );
  if (ff.status !== 0) {
    console.warn('[build] transcode failed; falling back to the source recording');
    videoName = `recording${ext}`;
    copyFileSync(srcVideo, join(publicDir, videoName));
  }
}

// Stage manifest (with video pointing at the staged file) for Remotion.
const staged = { ...manifest, video: videoName };
writeFileSync(join(publicDir, 'events.json'), JSON.stringify(staged, null, 2));

mkdirSync(dirname(finalOut), { recursive: true });

console.log('[build] rendering with Remotion…');
// Pass props via the staged events.json path rather than inline JSON: on Windows,
// spawning a .cmd with a long quote-heavy inline argument can fail with EINVAL.
const propsPath = join(publicDir, 'events.json');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const renderArgs = ['remotion', 'render', 'remotion/src/index.ts', 'ScreenStudio',
  finalOut, `--props=${propsPath}`];
// Use a preinstalled chrome-headless-shell when Remotion can't download its own
// (sandboxes/CI). Locally this is undefined and Remotion uses its own.
const renderChrome = resolveRenderChrome();
if (renderChrome) {
  renderArgs.push(`--browser-executable=${renderChrome}`);
}
// shell:true is required on Windows: spawning a .cmd directly without it fails
// with EINVAL regardless of the arguments passed.
const render = spawnSync(npx, renderArgs, {
  stdio: 'inherit',
  cwd: ROOT,
  shell: process.platform === 'win32',
});
if (render.status !== 0) throw new Error('remotion render failed');

console.log(`[build] done -> ${finalOut}`);
