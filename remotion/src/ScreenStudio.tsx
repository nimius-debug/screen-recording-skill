import React from 'react';
import {
  AbsoluteFill,
  OffthreadVideo,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { buildClusters, zoomAt } from './zoom';
import { Cursor } from './Cursor';
import type { Manifest } from './types';

export const COMP_WIDTH = 1920;
export const COMP_HEIGHT = 1080;
const PADDING = 90;
const RADIUS = 16;

export const ScreenStudio: React.FC<Manifest> = (props) => {
  const { width, height, events, video } = props;
  // The painted region (may be smaller than the recorded frame; Playwright can pad
  // the bottom with grey). Fit / clip to this so the band never shows.
  const contentW = props.contentWidth || width;
  const contentH = props.contentHeight || height;
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tMs = (frame / fps) * 1000;

  const clusters = React.useMemo(() => buildClusters(events), [events]);
  const { scale, originXpct, originYpct } = zoomAt(tMs, clusters, contentW, contentH);

  // Fit the painted content inside the padded frame.
  const fitScale = Math.min(
    (COMP_WIDTH - PADDING * 2) / contentW,
    (COMP_HEIGHT - PADDING * 2) / contentH,
  );
  const displayW = contentW * fitScale;
  const displayH = contentH * fitScale;
  // Render the full video scaled so its painted (top-left) region fills the box;
  // the grey padding overflows and is clipped by the frame's overflow:hidden.
  const videoRenderW = displayW * (width / contentW);
  const videoRenderH = displayH * (height / contentH);

  return (
    <AbsoluteFill
      style={{
        background:
          'linear-gradient(135deg, #6d28d9 0%, #4f46e5 45%, #0ea5e9 100%)',
      }}
    >
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
        <div
          style={{
            width: displayW,
            height: displayH,
            borderRadius: RADIUS,
            overflow: 'hidden',
            boxShadow:
              '0 30px 80px rgba(0,0,0,0.45), 0 8px 24px rgba(0,0,0,0.35)',
          }}
        >
          {/* Zoom stage: scales video + cursor together around the click point. */}
          <div
            style={{
              width: displayW,
              height: displayH,
              transform: `scale(${scale})`,
              transformOrigin: `${originXpct}% ${originYpct}%`,
            }}
          >
            <OffthreadVideo
              src={staticFile(video)}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: videoRenderW,
                height: videoRenderH,
                display: 'block',
              }}
            />
            <Cursor
              events={events}
              fps={fps}
              fitScale={fitScale}
              zoom={scale}
            />
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
