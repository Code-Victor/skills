import { Video } from "@remotion/media";
import type { ReactNode } from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Backdrop } from "@/components/remocn/backdrop";
import { MicroScaleFade } from "@/components/remocn/micro-scale-fade";
import { SoftBlurIn } from "@/components/remocn/soft-blur-in";
import { Stage } from "@/components/remocn/stage";
import { WordPush } from "@/components/remocn/word-push";
import { Callouts } from "./Callouts";
import { Caption } from "./Caption";
import { fontFamily } from "./font";
import type {
  CameraMove,
  ClipScene,
  ImageScene,
  IssueScene,
  ListScene,
  SplitScene,
  Theme,
  TimedCaption,
  TitleScene,
} from "./types";

const ACCENT = "#3b6bff";

// Frame box: as large as fits in the top ~80% of the canvas at the clip's
// aspect ratio, leaving a band underneath for the caption.
const frameBox = (width: number, height: number, aspect: number) => {
  const maxH = height * 0.8;
  const maxW = width * 0.9;
  const h = Math.min(maxH, maxW / aspect);
  const w = h * aspect;
  return { w, h, left: (width - w) / 2, top: height * 0.055 };
};

// On-screen movement eases in and out; enters and exits elsewhere ease out.
const CAMERA_EASE = Easing.bezier(0.65, 0, 0.35, 1);

/**
 * The camera at a frame, interpolated between keyframes. Holding a shot is
 * two keyframes with the same values; there is no implicit hold.
 */
const cameraAt = (moves: CameraMove[] | undefined, frame: number, fps: number) => {
  const keys = [...(moves ?? [])].sort((a, b) => a.atSec - b.atSec);
  const at = (k: CameraMove) => ({ x: k.x ?? 0.5, y: k.y ?? 0.5, zoom: k.zoom ?? 1 });
  if (keys.length === 0) return { x: 0.5, y: 0.5, zoom: 1 };
  const t = frame / fps;
  if (t <= keys[0].atSec) return at(keys[0]);
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i].atSec) {
      const a = at(keys[i - 1]);
      const b = at(keys[i]);
      const k = CAMERA_EASE((t - keys[i - 1].atSec) / Math.max(0.001, keys[i].atSec - keys[i - 1].atSec));
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, zoom: a.zoom + (b.zoom - a.zoom) * k };
    }
  }
  return at(keys[keys.length - 1]);
};

/**
 * The recording (a video or a still), pushed in and panned inside its box.
 * The focus point is centred where it can be; the translation is clamped so
 * the edge of the recording never pulls into view. Callouts ride inside the
 * camera so they stay on their target.
 */
const Camera = ({
  moves,
  callouts,
  w,
  h,
  accent,
  children,
}: {
  moves?: CameraMove[];
  callouts?: ClipScene["callouts"];
  w: number;
  h: number;
  accent: string;
  children: ReactNode;
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { x, y, zoom } = cameraAt(moves, frame, fps);
  const z = Math.max(1, zoom);
  const tx = Math.min(0, Math.max(w - w * z, w / 2 - x * w * z));
  const ty = Math.min(0, Math.max(h - h * z, h / 2 - y * h * z));
  return (
    <div
      style={{
        position: "relative",
        width: w,
        height: h,
        transformOrigin: "0 0",
        transform: `translate(${tx}px, ${ty}px) scale(${z})`,
      }}
    >
      {children}
      {callouts?.length ? <Callouts callouts={callouts} w={w} h={h} zoom={z} accent={accent} /> : null}
    </div>
  );
};

const ClipVideo = ({ src, trimStartSec, playbackRate }: { src: string; trimStartSec?: number; playbackRate?: number }) => {
  const { fps } = useVideoConfig();
  return (
    <Video
      src={staticFile(src)}
      trimBefore={Math.round((trimStartSec ?? 0) * fps)}
      playbackRate={playbackRate ?? 1}
      muted
      objectFit="cover"
      style={{ width: "100%", height: "100%" }}
    />
  );
};

/** The rounded window a recording sits in. */
const Window = ({
  box,
  full,
  children,
}: {
  box: { w: number; h: number; left: number; top: number };
  full?: boolean;
  children: ReactNode;
}) => {
  const { width } = useVideoConfig();
  return (
    <div
      style={{
        position: "absolute",
        left: box.left,
        top: box.top,
        width: box.w,
        height: box.h,
        borderRadius: full ? 0 : width * 0.008,
        overflow: "hidden",
        boxShadow: full ? undefined : "0 0 0 1px rgba(0,0,0,0.06), 0 24px 70px rgba(0,0,0,0.22)",
        background: "#fff",
      }}
    >
      {children}
    </div>
  );
};

/** One caption, or several in turn, in the band under the frame. */
const CaptionBand = ({
  top,
  caption,
  captions,
  tag,
  theme,
}: {
  top?: number;
  caption?: string;
  captions?: TimedCaption[];
  tag?: string;
  theme: Theme;
}) => {
  const { fps, height, durationInFrames } = useVideoConfig();
  const color = (t?: string) => (t ? theme.tagColors?.[t] : undefined);
  const band = (node: ReactNode) => (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top,
        bottom: top === undefined ? height * 0.05 : 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {node}
    </div>
  );
  if (captions?.length) {
    const sorted = [...captions].sort((a, b) => a.atSec - b.atSec);
    return (
      <>
        {sorted.map((c, i) => {
          const from = Math.round(c.atSec * fps);
          const to = i + 1 < sorted.length ? Math.round(sorted[i + 1].atSec * fps) : durationInFrames;
          return (
            <Sequence key={i} from={from} durationInFrames={Math.max(1, to - from)} layout="none">
              {band(<Caption tag={c.tag ?? tag} text={c.text} tagColor={color(c.tag ?? tag)} />)}
            </Sequence>
          );
        })}
      </>
    );
  }
  return caption ? band(<Caption tag={tag} text={caption} tagColor={color(tag)} />) : null;
};

export const ClipSceneView = ({ scene, theme }: { scene: ClipScene; theme: Theme }) => {
  const { width, height, fps } = useVideoConfig();
  const mode = scene.frame ?? "flat";
  const box = mode === "full" ? { w: width, h: height, left: 0, top: 0 } : frameBox(width, height, scene.aspect);
  const accent = theme.accent ?? ACCENT;
  const video = <ClipVideo src={scene.src} trimStartSec={scene.trimStartSec} playbackRate={scene.playbackRate} />;

  return (
    <AbsoluteFill>
      <Backdrop fill={{ type: "gradient", value: theme.background }} />
      {mode === "stage" ? (
        <Stage
          contentSize={{ width: 1000 * scene.aspect, height: 1000 }}
          backdrop={theme.background}
          moves={(scene.moves ?? []).map(({ atSec, ...m }) => ({ at: Math.round(atSec * fps), ...m }))}
          // Gentler than Stage's defaults (14 / -20 / 0.86): a product
          // screen should read as tilted, not as a poster on the floor.
          rotateX={6}
          rotateY={-10}
          scale={0.9}
          reflection={0}
          shadow={0.5}
        >
          {video}
        </Stage>
      ) : (
        <Window box={box} full={mode === "full"}>
          <Camera moves={scene.moves} callouts={scene.callouts} w={box.w} h={box.h} accent={accent}>
            {video}
          </Camera>
        </Window>
      )}
      <CaptionBand
        top={mode === "flat" ? box.top + box.h : undefined}
        caption={scene.caption}
        captions={scene.captions}
        tag={scene.tag}
        theme={theme}
      />
    </AbsoluteFill>
  );
};

export const ImageSceneView = ({ scene, theme }: { scene: ImageScene; theme: Theme }) => {
  const { width, height } = useVideoConfig();
  const box = frameBox(width, height, scene.aspect);
  return (
    <AbsoluteFill>
      <Backdrop fill={{ type: "gradient", value: theme.background }} />
      <Window box={box}>
        <Camera moves={scene.moves} callouts={scene.callouts} w={box.w} h={box.h} accent={theme.accent ?? ACCENT}>
          <Img src={staticFile(scene.src)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </Camera>
      </Window>
      <CaptionBand top={box.top + box.h} caption={scene.caption} tag={scene.tag} theme={theme} />
    </AbsoluteFill>
  );
};

/** Before and after in two windows, playing together. */
export const SplitSceneView = ({ scene, theme }: { scene: SplitScene; theme: Theme }) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const gap = width * 0.025;
  const w = Math.min((width * 0.92 - gap) / 2, (height * 0.7 * scene.aspect));
  const h = w / scene.aspect;
  const top = height * 0.12;
  const left0 = (width - (w * 2 + gap)) / 2;
  const sides = [
    { ...scene.before, label: scene.before.label ?? "Before" },
    { ...scene.after, label: scene.after.label ?? "After" },
  ];
  return (
    <AbsoluteFill>
      <Backdrop fill={{ type: "gradient", value: theme.background }} />
      {sides.map((side, i) => {
        const enter = spring({ frame: frame - i * 4, fps, config: { damping: 200 } });
        const left = left0 + i * (w + gap);
        return (
          <div key={side.label}>
            <div
              style={{
                position: "absolute",
                left,
                top: top - height * 0.055,
                fontFamily,
                fontSize: width * 0.0135,
                fontWeight: 600,
                color: theme.tagColors?.[side.label] ?? theme.foreground,
                opacity: enter,
              }}
            >
              {side.label}
            </div>
            <div style={{ opacity: enter, transform: `translateY(${(1 - enter) * 16}px)` }}>
              <Window box={{ w, h, left, top }}>
                <ClipVideo src={side.src} trimStartSec={side.trimStartSec} />
              </Window>
            </div>
          </div>
        );
      })}
      <CaptionBand top={top + h} caption={scene.caption} tag={scene.tag} theme={theme} />
    </AbsoluteFill>
  );
};

/** The problem as reported: a ticket card, so the fix has a "why". */
export const IssueSceneView = ({ scene, theme }: { scene: IssueScene; theme: Theme }) => {
  const frame = useCurrentFrame();
  const { width, fps } = useVideoConfig();
  const u = width / 1920;
  const rise = (delay: number) => {
    const s = spring({ frame: frame - Math.round(delay * fps), fps, config: { damping: 200 } });
    return { opacity: s, transform: `translateY(${(1 - s) * 14 * u}px)` };
  };
  const quiet = { color: theme.foreground, opacity: 0.55 };
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", fontFamily }}>
      <Backdrop fill={{ type: "gradient", value: theme.background }} />
      <div
        style={{
          position: "relative",
          width: 1040 * u,
          padding: `${52 * u}px ${60 * u}px`,
          borderRadius: 28 * u,
          background: "#fff",
          boxShadow: "0 0 0 1px rgba(0,0,0,0.06), 0 24px 70px rgba(0,0,0,0.16)",
          display: "flex",
          flexDirection: "column",
          gap: 22 * u,
          ...rise(0),
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 * u, fontSize: 24 * u, fontWeight: 600 }}>
          {scene.source ? <span style={quiet}>{scene.source}</span> : null}
          {scene.id ? <span style={{ color: theme.foreground }}>{scene.id}</span> : null}
          {scene.status ? (
            <span
              style={{
                marginLeft: "auto",
                padding: `${6 * u}px ${14 * u}px`,
                borderRadius: 999,
                background: `${theme.accent ?? ACCENT}18`,
                color: theme.accent ?? ACCENT,
                fontSize: 21 * u,
              }}
            >
              {scene.status}
            </span>
          ) : null}
        </div>
        <div style={{ fontSize: 48 * u, fontWeight: 600, lineHeight: 1.18, color: theme.foreground, textWrap: "balance", ...rise(0.15) }}>
          {scene.title}
        </div>
        {scene.quote ? (
          <div
            style={{
              borderLeft: `${4 * u}px solid ${theme.tagColors?.Before ?? "#e5484d"}`,
              paddingLeft: 26 * u,
              fontSize: 30 * u,
              lineHeight: 1.45,
              color: theme.foreground,
              ...rise(0.45),
              opacity: 0.85 * rise(0.45).opacity,
            }}
          >
            “{scene.quote}”
          </div>
        ) : null}
        {scene.reporter ? (
          <div style={{ fontSize: 22 * u, color: theme.foreground, ...rise(0.65), opacity: 0.55 * rise(0.65).opacity }}>
            {scene.reporter}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

/** A short list that builds item by item: what changed, or the end card. */
export const ListSceneView = ({ scene, theme }: { scene: ListScene; theme: Theme }) => {
  const frame = useCurrentFrame();
  const { width, fps } = useVideoConfig();
  const u = width / 1920;
  const accent = theme.accent ?? ACCENT;
  const at = (delay: number) => spring({ frame: frame - Math.round(delay * fps), fps, config: { damping: 200 } });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", fontFamily }}>
      <Backdrop fill={{ type: "gradient", value: theme.background }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 30 * u, width: 1100 * u }}>
        <div style={{ opacity: at(0), transform: `translateY(${(1 - at(0)) * 14 * u}px)` }}>
          <div style={{ fontSize: 60 * u, fontWeight: 600, color: theme.foreground, lineHeight: 1.12 }}>{scene.title}</div>
          {scene.subtitle ? (
            <div style={{ marginTop: 12 * u, fontSize: 26 * u, fontWeight: 500, color: theme.foreground, opacity: 0.55 }}>
              {scene.subtitle}
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 * u }}>
          {scene.items.map((item, i) => {
            const s = at(0.45 + i * 0.16);
            return (
              <div
                key={item}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 18 * u,
                  fontSize: 32 * u,
                  fontWeight: 500,
                  color: theme.foreground,
                  opacity: s,
                  transform: `translateX(${(1 - s) * -18 * u}px)`,
                }}
              >
                <svg width={30 * u} height={30 * u} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                  <circle cx="12" cy="12" r="11" fill={`${accent}1f`} />
                  <path d="M7 12.4l3.2 3.1L17 8.8" fill="none" stroke={accent} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {item}
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const TitleSceneView = ({ scene, theme }: { scene: TitleScene; theme: Theme }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const sub = interpolate(frame, [0.7 * fps, 1.2 * fps], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const size = width * 0.042;
  // remocn text components count 30fps frames; keep their timing at any fps.
  const speed = 30 / fps;
  const effect = scene.effect ?? "soft-blur-in";

  return (
    <AbsoluteFill>
      <Backdrop fill={{ type: "gradient", value: theme.background }} />
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          gap: width * 0.008,
          fontFamily,
          // remocn type reads its font from this variable.
          ["--font-geist-sans" as string]: fontFamily,
        }}
      >
        {/* The text components centre themselves absolutely: one line box. */}
        <div style={{ position: "relative", width: "100%", height: size * 1.3 }}>
          {effect === "word-push" ? (
            <WordPush text={scene.text} fontSize={size} fontWeight={600} color={theme.foreground} speed={speed} />
          ) : effect === "micro-scale-fade" ? (
            <MicroScaleFade text={scene.text} fontSize={size} fontWeight={600} color={theme.foreground} speed={speed} />
          ) : (
            <SoftBlurIn text={scene.text} fontSize={size} fontWeight={600} color={theme.foreground} />
          )}
        </div>
        {scene.subtitle ? (
          <div
            style={{
              fontSize: width * 0.0155,
              fontWeight: 500,
              color: theme.foreground,
              opacity: sub * 0.6,
              transform: `translateY(${(1 - sub) * 8}px)`,
            }}
          >
            {scene.subtitle}
          </div>
        ) : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
