import React from 'react';
import { useCurrentFrame, interpolate, Easing } from 'remotion';
import { cursorAt, clickPulses } from './cursorMath';
import type { RecEvent } from './types';

const CURSOR_SVG = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    <path d="M6 2 L6 26 L12 20 L16 29 L20 27 L16 18 L25 18 Z"
      fill="white" stroke="black" stroke-width="1.5" stroke-linejoin="round"/>
  </svg>`,
)}`;

type Props = {
  events: RecEvent[];
  fps: number;
  fitScale: number; // capture px -> displayed px
  zoom: number; // current zoom scale (cursor is counter-scaled to stay constant)
};

// Renders the synthetic cursor and click ripples in capture-pixel space (scaled by
// fitScale). Lives inside the zoom stage so it tracks the video content under zoom.
export const Cursor: React.FC<Props> = ({ events, fps, fitScale, zoom }) => {
  const frame = useCurrentFrame();
  const tMs = (frame / fps) * 1000;
  const moves = events.filter((e) => e.type === 'move' || e.type === 'click');
  const { x, y, visible } = cursorAt(tMs, moves);
  const pulses = clickPulses(events);

  const counter = 1 / zoom; // keep visual size constant during zoom
  const cursorPx = 26 * counter;

  return (
    <>
      {pulses.map((p, i) => {
        const dt = tMs - p.t;
        if (dt < 0 || dt > 500) return null;
        const r = interpolate(dt, [0, 500], [4, 46], {
          easing: Easing.out(Easing.cubic),
          extrapolateRight: 'clamp',
        }) * counter;
        const opacity = interpolate(dt, [0, 500], [0.45, 0], {
          extrapolateRight: 'clamp',
        });
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: p.x * fitScale,
              top: p.y * fitScale,
              width: r * 2,
              height: r * 2,
              marginLeft: -r,
              marginTop: -r,
              borderRadius: '50%',
              background: 'rgba(80,140,255,0.9)',
              opacity,
              pointerEvents: 'none',
            }}
          />
        );
      })}
      {visible && (
        <img
          src={CURSOR_SVG}
          alt=""
          style={{
            position: 'absolute',
            left: x * fitScale,
            top: y * fitScale,
            width: cursorPx,
            height: cursorPx,
            // hotspot is the tip (top-left of the arrow)
            transform: 'translate(-2px, -2px)',
            pointerEvents: 'none',
            filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.35))',
          }}
        />
      )}
    </>
  );
};
