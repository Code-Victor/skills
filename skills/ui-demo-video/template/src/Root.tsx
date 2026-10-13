import "./index.css";
import { Composition, type CalculateMetadataFunction } from "remotion";
import { DemoVideo } from "./DemoVideo";
import { gapFrames } from "./transitions";
import type { VideoSpec } from "./types";
import spec from "./video.json";

// Length = every scene, minus the overlap each transition eats.
const calculateMetadata: CalculateMetadataFunction<VideoSpec> = ({ props }) => {
  const f = (s: number) => Math.round(s * props.fps);
  const scenes = props.scenes.reduce((n, s) => n + f(s.durationSec), 0);
  const overlaps = props.scenes.slice(1).reduce((n, _, i) => n + gapFrames(props, i, props.fps), 0);
  return { durationInFrames: scenes - overlaps, fps: props.fps, width: props.width, height: props.height };
};

export const RemotionRoot = () => (
  <Composition
    id="DemoVideo"
    component={DemoVideo}
    defaultProps={spec as VideoSpec}
    calculateMetadata={calculateMetadata}
    durationInFrames={1}
    fps={60}
    width={1920}
    height={1080}
  />
);
