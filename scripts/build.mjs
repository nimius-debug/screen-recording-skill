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
import ffmpegStatic from 'ffmpeg-static';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : def;
}

const inDir = resolve(arg('--in', 'out'));
const finalOut = resolve(arg('--out', join(inDir, 'final.mp4')));
const webm = join(inDir, 'recording.webm');
const manifestPath = join(inDir, 'events.json');

if (!existsSync(webm)) throw new Error(`missing ${webm} (run scripts/record.mjs first)`);
if (!existsSync(manifestPath)) throw new Error(`missing ${manifestPath}`);

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const fps = manifest.fps || 30;

const publicDir = join(ROOT, 'remotion', 'public');
mkdirSync(publicDir, { recursive: true });

const noTranscode = process.argv.includes('--no-transcode');
let videoName;
if (noTranscode) {
  // Feed the webm straight to Remotion (its internal ffmpeg decodes VP8 fine).
  videoName = 'recording.webm';
  copyFileSync(webm, join(publicDir, videoName));
  console.log('[build] skipping transcode; using recording.webm directly');
} else {
  // Transcode to constant-fps H.264 mp4 for the most reliable seeking + playback.
  videoName = 'recording.mp4';
  const ffmpegBin = process.env.FFMPEG_PATH || ffmpegStatic;
  console.log(`[build] transcoding webm -> mp4 with ffmpeg (${ffmpegBin})…`);
  const ff = spawnSync(
    ffmpegBin,
    ['-y', '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
     '-r', String(fps), '-an', join(publicDir, videoName)],
    { stdio: 'inherit' },
  );
  if (ff.status !== 0) {
    throw new Error(
      'ffmpeg transcode failed. Ensure ffmpeg supports libx264, set FFMPEG_PATH ' +
      'to a full ffmpeg build, or pass --no-transcode to use the webm directly.',
    );
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
// Use a preinstalled Chrome when Remotion can't download its own (sandboxes/CI).
if (process.env.SS_CHROMIUM_PATH) {
  renderArgs.push(`--browser-executable=${process.env.SS_CHROMIUM_PATH}`);
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
