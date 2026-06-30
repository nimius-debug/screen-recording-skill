import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
// recording.mp4 + events.json are copied here by scripts/build.mjs
Config.setPublicDir('remotion/public');
