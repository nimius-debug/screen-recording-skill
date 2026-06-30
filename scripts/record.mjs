#!/usr/bin/env node
// Record a browser session with Playwright, capturing a cursor-free video plus a
// timestamped log of mouse moves / clicks / scrolls that drives the editing stage.
//
// Usage:
//   node scripts/record.mjs --mode live   --url https://example.com --duration 20
//   node scripts/record.mjs --mode script --steps demo.json --duration 30
//
// Outputs (into --out, default ./out):
//   recording.webm   cursor-free page capture (Playwright recordVideo, VP8)
//   events.json      { fps, width, height, durationMs, events:[{t,type,x,y,button}] }

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, renameSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { resolveCaptureChromium, hasDisplay } from './lib/env.mjs';

function parseArgs(argv) {
  const a = { mode: 'live', duration: 20, url: 'about:blank', steps: null,
              out: 'out', size: '1280x800', fps: 30, headless: null };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    switch (k) {
      case '--mode': a.mode = v; i++; break;
      case '--duration': a.duration = Number(v); i++; break;
      case '--url': a.url = v; i++; break;
      case '--steps': a.steps = v; i++; break;
      case '--out': a.out = v; i++; break;
      case '--size': a.size = v; i++; break;
      case '--fps': a.fps = Number(v); i++; break;
      case '--headless': a.headless = true; break;
      case '--headed': a.headless = false; break;
      default: break;
    }
  }
  return a;
}

const args = parseArgs(process.argv);
const [width, height] = args.size.split('x').map(Number);
// Live mode needs a headful window the user can interact with; script/auto run
// headless (recordVideo still captures). Default follows the mode unless overridden.
const headless = args.headless === null ? args.mode !== 'live' : args.headless;

// Live mode is pointless without a real screen to interact with (e.g. a cloud
// sandbox). Fail fast with guidance instead of opening a window nobody can see.
if (args.mode === 'live' && !headless && !hasDisplay()) {
  console.error(
    '[record] live mode needs a real screen, but no display was found.\n' +
    '         Use --mode auto (auto-tour any URL) or --mode script, or run locally /\n' +
    '         via Claude Code Remote Control where you can interact with the window.',
  );
  process.exit(1);
}
const outDir = resolve(args.out);
mkdirSync(outDir, { recursive: true });
const videoDir = join(outDir, '.video');
if (existsSync(videoDir)) rmSync(videoDir, { recursive: true, force: true });
mkdirSync(videoDir, { recursive: true });

// Injected into every document (survives navigation) to report input events.
const initScript = `(() => {
  if (window.__ssHooked) return;
  window.__ssHooked = true;
  let lastMove = 0;
  const send = (type, e, extra) => {
    try {
      window.__recordEvent({ type, x: Math.round(e.clientX), y: Math.round(e.clientY),
        button: e.button, ...(extra || {}) });
    } catch (_) {}
  };
  window.addEventListener('mousemove', (e) => {
    const now = performance.now();
    if (now - lastMove < 16) return;          // ~60Hz throttle
    lastMove = now;
    send('move', e);
  }, true);
  window.addEventListener('mousedown', (e) => send('click', e), true);
  let lastScroll = 0;
  window.addEventListener('scroll', () => {
    const now = performance.now();
    if (now - lastScroll < 50) return;
    lastScroll = now;
    try { window.__recordEvent({ type: 'scroll', x: 0, y: 0, scrollY: window.scrollY }); } catch (_) {}
  }, true);
})();`;

const events = [];
let startTime = null;

// Glide the mouse from its current spot to a target with timed intermediate moves,
// so the in-page listener logs a smooth path (page.mouse.move steps fire too fast to
// survive the throttle). Returns the new position.
async function glide(page, pos, tx, ty) {
  const steps = 24;
  for (let i = 1; i <= steps; i++) {
    const f = i / steps;
    // ease-in-out for a natural arc
    const e = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;
    await page.mouse.move(pos.x + (tx - pos.x) * e, pos.y + (ty - pos.y) * e);
    await page.waitForTimeout(12);
  }
  pos.x = tx;
  pos.y = ty;
}

async function targetOf(page, selector) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) return null;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function runSteps(page, stepsArg, pos) {
  let steps = [];
  if (stepsArg) {
    const raw = isAbsolute(stepsArg) ? stepsArg : resolve(stepsArg);
    steps = JSON.parse(readFileSync(raw, 'utf8'));
  }
  for (const step of steps) {
    const action = step.action || step.type;
    try {
      switch (action) {
        case 'goto':
          await page.goto(step.url, { waitUntil: 'domcontentloaded' });
          break;
        case 'click': {
          const t = await targetOf(page, step.selector);
          if (t) {
            await glide(page, pos, t.x, t.y);
            await page.mouse.down();
            await page.mouse.up();
          } else {
            await page.click(step.selector, { timeout: step.timeout ?? 10000 });
          }
          break;
        }
        case 'hover': {
          const t = await targetOf(page, step.selector);
          if (t) await glide(page, pos, t.x, t.y);
          else await page.hover(step.selector);
          break;
        }
        case 'type': await page.fill(step.selector, step.text ?? ''); break;
        case 'press': await page.keyboard.press(step.key); break;
        case 'scroll': await page.mouse.wheel(0, step.dy ?? 600); break;
        case 'wait': await page.waitForTimeout(step.ms ?? 1000); break;
        default: console.warn('[record] unknown step:', action);
      }
      if (step.pause) await page.waitForTimeout(step.pause);
      else await page.waitForTimeout(600); // breathing room so zooms read well
    } catch (err) {
      console.warn(`[record] step "${action}" failed: ${err.message}`);
    }
  }
}

// Smoothly scroll to an absolute Y over ~durMs so the capture pans (rather than jumps).
async function smoothScrollTo(page, targetY, durMs) {
  const steps = Math.max(6, Math.round(durMs / 40));
  const startY = await page.evaluate(() => window.scrollY);
  for (let i = 1; i <= steps; i++) {
    const f = i / steps;
    const e = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2; // ease-in-out
    await page.evaluate((y) => window.scrollTo(0, y), startY + (targetY - startY) * e);
    await page.waitForTimeout(Math.max(16, durMs / steps));
  }
}

// Auto-tour: with no authored steps, make a cinematic demo of ANY page by scrolling
// through it and emitting cursor-free `zoom` events on prominent elements. Works on
// any URL with zero per-site authoring.
async function autoTour(page, totalMs) {
  const info = await page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const sel = 'h1,h2,h3,button,a,img,[role="button"],input[type="submit"],[class*="hero"]';
    const seen = [];
    const out = [];
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 16) continue;          // too small
      if (r.width > vw * 1.2 || r.height > vh * 0.9) continue; // full-bleed
      const s = getComputedStyle(el);
      if (s.visibility === 'hidden' || s.display === 'none' || +s.opacity === 0) continue;
      const docTop = r.top + window.scrollY;
      if (docTop < vh * 0.06) continue;                     // skip top nav / sticky header
      if (seen.some((y) => Math.abs(y - docTop) < vh * 0.22)) continue; // de-dupe rows
      seen.push(docTop);
      out.push({ docTop, cx: r.left + r.width / 2, area: r.width * r.height });
    }
    return { pois: out, scrollHeight: document.documentElement.scrollHeight, vw, vh };
  });

  const stopsBudget = Math.max(2, Math.min(6, Math.round(totalMs / 4000)));
  let stops = info.pois.sort((a, b) => a.docTop - b.docTop);
  if (stops.length > stopsBudget) {
    const picked = [];
    for (let i = 0; i < stopsBudget; i++) {
      picked.push(stops[Math.round((i * (stops.length - 1)) / (stopsBudget - 1))]);
    }
    stops = picked;
  }
  if (stops.length === 0) {
    // No POIs: evenly spaced centre zooms while scrolling top -> bottom.
    const maxScroll = Math.max(0, info.scrollHeight - info.vh);
    stops = Array.from({ length: stopsBudget }, (_, i) => ({
      docTop: (stopsBudget === 1 ? 0 : i / (stopsBudget - 1)) * maxScroll,
      cx: info.vw / 2,
      center: true,
    }));
  }

  const perStop = totalMs / stops.length;
  for (const stop of stops) {
    const targetScroll = Math.max(
      0, Math.min(stop.docTop - info.vh * 0.38, info.scrollHeight - info.vh),
    );
    await smoothScrollTo(page, targetScroll, Math.min(900, perStop * 0.45));
    const vy = stop.center
      ? info.vh / 2
      : Math.max(0, Math.min(stop.docTop - targetScroll, info.vh));
    await page.evaluate(
      ({ x, y }) => window.__recordEvent({ type: 'zoom', x: Math.round(x), y: Math.round(y) }),
      { x: stop.cx, y: vy },
    );
    await page.waitForTimeout(Math.max(400, perStop * 0.5)); // dwell while zoomed
  }
}

// Auto-detect Chromium: Playwright's own bundled build locally, or a preinstalled
// browser in cloud sandboxes. SS_CHROMIUM_PATH overrides.
const executablePath = resolveCaptureChromium();
const browser = await chromium.launch({
  headless,
  executablePath,
  // Force the OS window to match the capture size so recordVideo fills the frame
  // (headless Chromium otherwise defaults to 1280x720 and pads the rest grey).
  args: [`--window-size=${width},${height}`, '--hide-scrollbars',
         '--force-device-scale-factor=1'],
});
const context = await browser.newContext({
  viewport: { width, height },
  deviceScaleFactor: 1,
  recordVideo: { dir: videoDir, size: { width, height } },
});

await context.exposeBinding('__recordEvent', (_source, data) => {
  if (startTime === null) return;
  events.push({ t: Date.now() - startTime, ...data });
});
await context.addInitScript(initScript);

const page = await context.newPage();
startTime = Date.now();           // recording clock origin
events.push({ t: 0, type: 'start', x: width / 2, y: height / 2 });

if (args.mode === 'script' || args.mode === 'auto') {
  if (args.url && args.url !== 'about:blank') {
    await page.goto(args.url, { waitUntil: 'domcontentloaded' });
  }
  // Auto-tour when explicitly requested, or as the fallback when script mode has no
  // authored steps — so any URL still produces a cinematic demo.
  const autoMode = args.mode === 'auto' || !args.steps;
  if (autoMode) {
    await page.waitForTimeout(500); // let the page settle before touring
    console.log('[record] AUTO-TOUR: scrolling + zooming prominent elements…');
    await autoTour(page, args.duration * 1000);
  } else {
    await runSteps(page, args.steps, { x: width / 2, y: height / 2 });
  }
  const elapsed = (Date.now() - startTime) / 1000;
  if (args.duration > elapsed) await page.waitForTimeout((args.duration - elapsed) * 1000);
} else {
  if (args.url) await page.goto(args.url, { waitUntil: 'domcontentloaded' }).catch(() => {});
  console.log(`[record] LIVE: interact with the browser. Stopping in ${args.duration}s…`);
  await page.waitForTimeout(args.duration * 1000);
}

const durationMs = Date.now() - startTime;
// Playwright's recordVideo can pad the bottom of the frame with grey when Chromium
// paints fewer rows than the requested height. Capture the real painted viewport so
// the editor maps only that region into the polished frame.
const vp = await page
  .evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
  .catch(() => ({ w: width, h: height }));
// Finalize the video: closing the context flushes the .webm to disk.
const video = page.video();
await context.close();
await browser.close();

const recordingPath = join(outDir, 'recording.webm');
if (video) {
  const tmp = await video.path();
  renameSync(tmp, recordingPath);
}
rmSync(videoDir, { recursive: true, force: true });

const manifest = { fps: args.fps, width, height,
  contentWidth: vp.w, contentHeight: vp.h, durationMs,
  video: 'recording.webm', events };
writeFileSync(join(outDir, 'events.json'), JSON.stringify(manifest, null, 2));

console.log(`[record] done: ${recordingPath}`);
console.log(`[record] events: ${events.length} -> ${join(outDir, 'events.json')}`);
console.log(`[record] duration: ${(durationMs / 1000).toFixed(1)}s`);
