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
const isMp4 = srcVideo.endsWith('.mp4');

const publicDir = join(ROOT, 'remotion', 'public');
mkdirSync(publicDir, { recursive: true });

const wantTranscode = !process.argv.includes('--no-transcode') && !isMp4;
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
  videoName = `recording${srcVideo.slice(srcVideo.lastIndexOf('.'))}`;
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
    // Last-resort fallback rather than failing the whole build.
    console.warn('[build] transcode failed; falling back to the source recording');
    videoName = `recording${srcVideo.slice(srcVideo.lastIndexOf('.'))}`;
    copyFileSync(srcVideo, join(publicDir, videoName));
  }
}

// Stage manifest (with video pointing at the staged file) for Remotion.
const staged = { ...manifest, video: videoName };
writeFileSync(join(publicDir, 'events.json'), JSON.stringify(staged, null, 2));

mkdirSync(dirname(finalOut), { recursive: true });

console.log('[build] rendering with Remotion…');
const propsArg = JSON.stringify(staged);
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const renderArgs = ['remotion', 'render', 'remotion/src/index.ts', 'ScreenStudio',
  finalOut, `--props=${propsArg}`];
// Use a preinstalled Chrome when Remotion can't download its own (sandboxes/CI).
const renderChrome = resolveRenderChrome();
if (renderChrome) {
  renderArgs.push(`--browser-executable=${renderChrome}`);
}
const render = spawnSync(npx, renderArgs, { stdio: 'inherit', cwd: ROOT });
if (render.status !== 0) throw new Error('remotion render failed');

console.log(`[build] done -> ${finalOut}`);
