import { gapFrames } from "./transitions";
import type { VideoSpec } from "./types";

/**
 * Where each scene starts and ends on the final timeline, in frames. A
 * transition overlaps the two scenes it joins, so each start is the previous
 * starts plus durations, minus the overlaps so far. scripts/deliver.mjs does
 * the same sums for the captions file.
 */
export const sceneSpans = (spec: VideoSpec, fps: number) => {
  let start = 0;
  return spec.scenes.map((scene, i) => {
    if (i > 0) start -= gapFrames(spec, i - 1, fps);
    const span = { start, end: start + Math.round(scene.durationSec * fps) };
    start = span.end;
    return span;
  });
};
