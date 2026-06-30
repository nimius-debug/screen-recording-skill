import React from 'react';
import { Composition, staticFile } from 'remotion';
import { ScreenStudio, COMP_WIDTH, COMP_HEIGHT } from './ScreenStudio';
import type { Manifest } from './types';

const defaultProps: Manifest = {
  fps: 30,
  width: 1280,
  height: 800,
  durationMs: 4000,
  video: 'recording.mp4',
  events: [],
};

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="ScreenStudio"
      component={ScreenStudio}
      durationInFrames={120}
      fps={30}
      width={COMP_WIDTH}
      height={COMP_HEIGHT}
      defaultProps={defaultProps}
      calculateMetadata={async ({ props }) => {
        // Allow the manifest to be loaded from public/events.json when not passed
        // explicitly (keeps `npx remotion studio` previewable).
        let p = props;
        if (!p.events || p.events.length === 0) {
          try {
            const res = await fetch(staticFile('events.json'));
            if (res.ok) p = { ...p, ...(await res.json()) };
          } catch (_) {
            // fall back to defaults
          }
        }
        const fps = p.fps || 30;
        const durationInFrames = Math.max(
          1,
          Math.ceil((p.durationMs / 1000) * fps),
        );
        return { durationInFrames, fps, props: p };
      }}
    />
  );
};
