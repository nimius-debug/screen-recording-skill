---
name: screen-studio
description: >-
  Record a web browser for a given duration and auto-edit it into a polished,
  Screen Studio-style video with smooth zoom-on-click, a synthetic glide cursor,
  and a cinematic frame (gradient background, rounded corners, shadow). Use when
  the user wants to "screen record", "record my browser", make a "demo video",
  a "screen studio" / "zoom on click" video, or turn a browser walkthrough into a
  polished clip. Works on Windows/macOS/Linux. Two modes: live (user clicks in a
  launched browser) and script (Claude drives the browser from described steps).
---

# Screen Studio skill

Turns a browser session into a polished demo video. Capture is done with
**Playwright** (cursor-free page video + exact click/move telemetry), editing with
**Remotion** (zoom-on-click, synthetic cursor, framing), and **ffmpeg** transcodes
the capture for the renderer.

## One-time setup

From the project root:

```
npm install
npx playwright install chromium
```

ffmpeg is bundled via `ffmpeg-static`. The scripts **auto-detect** their browser and
ffmpeg, so no env vars are needed in either a local install or a cloud sandbox (it picks
up a preinstalled Chromium and falls back to a no-transcode render if no H.264 ffmpeg is
present). Overrides: `SS_CHROMIUM_PATH`, `FFMPEG_PATH`, `--no-transcode`.

## Where this runs

- **Local CLI / desktop, or Remote Control** (`claude --remote-control` / `/rc`): the session
  runs on the user's PC — **both** live and script modes work; live mode needs the user to be
  at the machine to click. Output is `out/final.mp4` (use `npm run open-out`).
- **Claude Code on the web** (cloud): **script mode only** (no screen for live). After
  building, return `out/final.mp4` to the user with `SendUserFile`. The cloud cannot see the
  user's local screen — it records its own browser, so the environment needs internet access
  to reach the target URL.

If the user asks for live mode in a cloud session, record.mjs exits with guidance — switch to
script mode (turn their described walkthrough into a steps JSON) instead.

## How to use

Ask the user for: the **URL**, the **duration** (seconds), and the **mode**.

### Live mode — the user clicks themselves
Launches a real browser window; the user interacts for `--duration` seconds, then it
auto-stops. Their clicks/moves drive the zooms.

```
node scripts/record.mjs --mode live --url https://app.example.com --duration 30 --out out
node scripts/build.mjs --in out --out out/final.mp4
```

### Script mode — Claude drives the browser
You (Claude) translate the user's described walkthrough into a steps JSON, then run it
headless. The cursor glides between targets automatically.

```
node scripts/record.mjs --mode script --url https://app.example.com --steps steps.json --duration 30 --out out
node scripts/build.mjs --in out --out out/final.mp4
```

`steps.json` is an array of actions (see `examples/demo-steps.json`):

```json
[
  { "action": "goto",  "url": "https://app.example.com/login" },
  { "action": "type",  "selector": "#email", "text": "demo@acme.com" },
  { "action": "click", "selector": "button[type=submit]", "pause": 1500 },
  { "action": "click", "selector": "#dashboard-card", "pause": 1200 },
  { "action": "scroll", "dy": 600 },
  { "action": "wait",  "ms": 1000 }
]
```
Supported actions: `goto`, `click`, `type`, `press`, `hover`, `scroll`, `wait`.
`pause` (ms) after a step controls how long a zoom lingers — give important clicks a
longer pause so the zoom reads well.

## Output

`scripts/build.mjs` writes the final 1920×1080 MP4 to `--out` (default `out/final.mp4`).
Tell the user where it is. Intermediate files (`recording.webm`, `events.json`) are in
the `--out` dir.

## record.mjs flags

`--mode live|script` · `--url <url>` · `--duration <seconds>` · `--steps <file.json>`
· `--out <dir>` · `--size 1280x800` · `--fps 30` · `--headed`/`--headless`

## build.mjs flags

`--in <dir>` (record output) · `--out <file.mp4>` · `--no-transcode` (use the webm
directly, skip ffmpeg) · env `FFMPEG_PATH` (full ffmpeg) · env `SS_CHROMIUM_PATH`
(Chrome for the renderer, for sandboxes/CI).

## Tuning the look

Zoom amount/timing live in `remotion/src/zoom.ts` (`ZOOM_SCALE`, cluster gap, ease
durations). Background gradient, padding, corner radius and shadow live in
`remotion/src/ScreenStudio.tsx`. Cursor smoothing/size and the click ripple live in
`remotion/src/Cursor.tsx` and `remotion/src/cursor.ts`. Preview interactively with
`npm run studio`.

## Notes

- Capture is **cursor-free** by design (Playwright records the page, not the OS
  cursor); the cursor you see in the output is the synthetic smoothed one.
- This records a **browser**, not the whole desktop. For desktop capture you'd swap
  the capture stage for ffmpeg `gdigrab`/`avfoundation`/`x11grab` (loses cursor-free
  capture and exact click coords).
- steel.dev was evaluated and not used: it records cloud headless-browser sessions,
  not the user's real local browser — local Playwright gives higher fidelity for demos.
