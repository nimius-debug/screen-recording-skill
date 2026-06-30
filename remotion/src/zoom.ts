import { interpolate, Easing } from 'remotion';
import type { RecEvent } from './types';

// Tunables (milliseconds) for the cinematic zoom behaviour.
export const ZOOM_SCALE = 1.6;     // how far we zoom in on a click cluster
const CLUSTER_GAP = 1500;          // clicks within this gap join one zoom
const ZOOM_IN = 400;               // ease-in duration
const HOLD_AFTER = 900;            // stay zoomed this long after last click
const ZOOM_OUT = 650;              // ease-out duration

export type Cluster = {
  startT: number;
  lastT: number;
  fx: number; // focus point (capture px)
  fy: number;
  inStart: number;
  inEnd: number;
  holdEnd: number;
  outEnd: number;
};

export function buildClusters(events: RecEvent[]): Cluster[] {
  const clicks = events.filter((e) => e.type === 'click');
  const clusters: Cluster[] = [];
  const xs: number[][] = [];
  const ys: number[][] = [];
  for (const c of clicks) {
    const last = clusters[clusters.length - 1];
    if (last && c.t - last.lastT <= CLUSTER_GAP) {
      last.lastT = c.t;
      xs[xs.length - 1].push(c.x);
      ys[ys.length - 1].push(c.y);
    } else {
      clusters.push({
        startT: c.t, lastT: c.t, fx: c.x, fy: c.y,
        inStart: 0, inEnd: 0, holdEnd: 0, outEnd: 0,
      });
      xs.push([c.x]);
      ys.push([c.y]);
    }
  }
  clusters.forEach((cl, i) => {
    const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    cl.fx = avg(xs[i]);
    cl.fy = avg(ys[i]);
    cl.inStart = cl.startT;
    cl.inEnd = cl.startT + ZOOM_IN;
    cl.holdEnd = cl.lastT + HOLD_AFTER;
    cl.outEnd = cl.holdEnd + ZOOM_OUT;
  });
  return clusters;
}

export type ZoomState = {
  scale: number;
  // transform-origin as percentages of the video box
  originXpct: number;
  originYpct: number;
};

// Pure function of time: returns the active zoom for a given moment.
export function zoomAt(
  tMs: number,
  clusters: Cluster[],
  width: number,
  height: number,
): ZoomState {
  // Pick the most recent cluster whose window contains t (handles tiny overlaps).
  let active: Cluster | null = null;
  for (const cl of clusters) {
    if (tMs >= cl.inStart && tMs <= cl.outEnd) {
      if (!active || cl.inStart > active.inStart) active = cl;
    }
  }
  if (!active) return { scale: 1, originXpct: 50, originYpct: 50 };

  let scale: number;
  if (tMs < active.inEnd) {
    scale = interpolate(tMs, [active.inStart, active.inEnd], [1, ZOOM_SCALE], {
      easing: Easing.inOut(Easing.cubic),
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
  } else if (tMs <= active.holdEnd) {
    scale = ZOOM_SCALE;
  } else {
    scale = interpolate(tMs, [active.holdEnd, active.outEnd], [ZOOM_SCALE, 1], {
      easing: Easing.inOut(Easing.cubic),
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
  }

  return {
    scale,
    originXpct: (active.fx / width) * 100,
    originYpct: (active.fy / height) * 100,
  };
}
