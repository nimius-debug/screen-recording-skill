import type { RecEvent } from './types';

// Linear interpolation of the raw pointer path at an arbitrary time.
function rawAt(tMs: number, moves: RecEvent[]): { x: number; y: number } | null {
  if (moves.length === 0) return null;
  if (tMs <= moves[0].t) return { x: moves[0].x, y: moves[0].y };
  const lastM = moves[moves.length - 1];
  if (tMs >= lastM.t) return { x: lastM.x, y: lastM.y };
  // binary search for the segment containing tMs
  let lo = 0;
  let hi = moves.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (moves[mid].t <= tMs) lo = mid;
    else hi = mid;
  }
  const a = moves[lo];
  const b = moves[hi];
  const f = (tMs - a.t) / Math.max(1, b.t - a.t);
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

// Smoothed cursor position: trailing weighted average over a short window gives the
// Screen Studio "glide" while staying a pure function of time (deterministic render).
export function cursorAt(
  tMs: number,
  moves: RecEvent[],
): { x: number; y: number; visible: boolean } {
  if (moves.length === 0) return { x: 0, y: 0, visible: false };
  const visible = tMs >= moves[0].t - 1;
  const WINDOW = 140; // ms
  const SAMPLES = 7;
  let sx = 0;
  let sy = 0;
  let sw = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const dt = (WINDOW * i) / (SAMPLES - 1);
    const p = rawAt(tMs - dt, moves);
    if (!p) continue;
    const w = 1 - i / SAMPLES; // recent samples weigh more
    sx += p.x * w;
    sy += p.y * w;
    sw += w;
  }
  if (sw === 0) {
    const p = rawAt(tMs, moves) ?? { x: 0, y: 0 };
    return { ...p, visible };
  }
  return { x: sx / sw, y: sy / sw, visible };
}

export type Pulse = { t: number; x: number; y: number };

export function clickPulses(events: RecEvent[]): Pulse[] {
  return events
    .filter((e) => e.type === 'click')
    .map((e) => ({ t: e.t, x: e.x, y: e.y }));
}
