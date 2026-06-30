export type RecEvent = {
  t: number; // ms from recording start
  // 'zoom' is a synthetic, cursor-free event: it drives the zoom-cluster logic
  // (see zoom.ts) without making the synthetic cursor/click-ripple appear.
  type: 'move' | 'click' | 'scroll' | 'start' | 'zoom';
  x: number;
  y: number;
  button?: number;
  scrollY?: number;
};

export type Manifest = {
  fps: number;
  width: number; // captured video frame size
  height: number;
  contentWidth?: number; // actually painted viewport (Playwright may pad the rest)
  contentHeight?: number;
  durationMs: number;
  video: string;
  events: RecEvent[];
};
