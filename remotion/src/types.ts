export type RecEvent = {
  t: number; // ms from recording start
  type: 'move' | 'click' | 'scroll' | 'start';
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
