import { Audio } from "@remotion/media";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { Fragment } from "react";
import { AbsoluteFill, interpolate, Sequence, staticFile, useVideoConfig } from "remotion";
import { Logo } from "./Logo";
import {
  ClipSceneView,
  ImageSceneView,
  IssueSceneView,
  ListSceneView,
  SplitSceneView,
  TitleSceneView,
} from "./scenes";
import { sceneSpans } from "./timeline";
import { gapFrames, presentationFor, resolveGap } from "./transitions";
import type { Scene, Theme, VideoSpec } from "./types";

const SceneView = ({ scene, theme }: { scene: Scene; theme: Theme }) => {
  switch (scene.type) {
    case "title":
      return <TitleSceneView scene={scene} theme={theme} />;
    case "issue":
      return <IssueSceneView scene={scene} theme={theme} />;
    case "split":
      return <SplitSceneView scene={scene} theme={theme} />;
    case "image":
      return <ImageSceneView scene={scene} theme={theme} />;
    case "list":
      return <ListSceneView scene={scene} theme={theme} />;
    default:
      return <ClipSceneView scene={scene} theme={theme} />;
  }
};

/**
 * Narration per scene, and a music bed that fades in, fades out and dips
 * under narration. Both are optional; most demo videos play muted.
 */
const Soundtrack = ({ spec }: { spec: VideoSpec }) => {
  const { fps, durationInFrames } = useVideoConfig();
  const spans = sceneSpans(spec, fps);
  const voice = spec.scenes.flatMap((scene, i) =>
    scene.voiceover
      ? [{ vo: scene.voiceover, from: spans[i].start + Math.round((scene.voiceover.delaySec ?? 0) * fps), to: spans[i].end }]
      : [],
  );
  const music = spec.music;
  // Dip a little before the voice starts and come back a little after.
  const dip = Math.round(0.3 * fps);
  const voiced = (f: number) => voice.some(({ from, to }) => f >= from - dip && f <= to + dip);
  return (
    <>
      {voice.map(({ vo, from }, i) => (
        <Sequence key={i} from={from} layout="none">
          <Audio src={staticFile(vo.src)} volume={vo.volume ?? 1} />
        </Sequence>
      ))}
      {music ? (
        <Audio
          src={staticFile(music.src)}
          loop
          volume={(f) => {
            const fade = interpolate(
              f,
              [0, (music.fadeInSec ?? 1) * fps, durationInFrames - (music.fadeOutSec ?? 2) * fps, durationInFrames],
              [0, 1, 1, 0],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
            );
            return (music.volume ?? 0.16) * fade * (voiced(f) ? (music.duck ?? 0.35) : 1);
          }}
        />
      ) : null}
    </>
  );
};

export const DemoVideo = (spec: VideoSpec) => {
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill>
      <TransitionSeries>
        {spec.scenes.map((scene, i) => {
          const gap = i > 0 ? resolveGap(spec, i - 1) : null;
          const presentation = gap ? presentationFor(gap) : null;
          return (
            <Fragment key={i}>
              {gap && presentation ? (
                <TransitionSeries.Transition
                  presentation={presentation}
                  timing={linearTiming({ durationInFrames: gapFrames(spec, i - 1, fps) })}
                />
              ) : null}
              <TransitionSeries.Sequence durationInFrames={Math.round(scene.durationSec * fps)} premountFor={fps}>
                <SceneView scene={scene} theme={spec.theme} />
              </TransitionSeries.Sequence>
            </Fragment>
          );
        })}
      </TransitionSeries>
      {/* Above the series, so transitions never carry the brand mark away. */}
      {spec.theme.logo ? <Logo logo={spec.theme.logo} /> : null}
      <Soundtrack spec={spec} />
    </AbsoluteFill>
  );
};
