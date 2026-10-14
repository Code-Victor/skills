// The whole video is described by src/video.json. Times are in seconds so
// the file reads the same at any fps.

export type Theme = {
  /** Any CSS background: color, gradient. */
  background: string;
  /** Text color for titles on the background. */
  foreground: string;
  /** One accent: callouts, list checks, the issue status pill. Default #3b6bff. */
  accent?: string;
  /** Colors for the "Before" / "After" (or any) caption tags. */
  tagColors?: Record<string, string>;
  /**
   * A brand mark pinned to the corner of every scene, above transitions so it
   * never moves. File in public/, e.g. "brand/logo.svg".
   */
  logo?: {
    src: string;
    /** Height in px at 1080p; scales with the canvas. Default 34. */
    height?: number;
    /** Default 0.9. */
    opacity?: number;
    /** Default "bottom-right". */
    corner?: "bottom-right" | "bottom-left" | "top-right" | "top-left";
  };
};

/** A camera keyframe. x/y are the focus point as fractions of the recording. */
export type CameraMove = {
  atSec: number;
  x?: number;
  y?: number;
  zoom?: number;
};

/** @deprecated Use CameraMove; kept so older video.json files still load. */
export type StageMove = CameraMove;

export type TitleScene = Omit<SceneCommon, "durationSec"> & {
  type: "title";
  text: string;
  subtitle?: string;
  durationSec: number;
  /**
   * soft-blur-in: per-character reveal, for an opening title.
   * word-push: builds word by word, for a closing line.
   * micro-scale-fade: quiet fade and settle, for a chapter card.
   */
  effect?: "soft-blur-in" | "word-push" | "micro-scale-fade";
};

/**
 * A highlight drawn over the recording that moves with the camera. Give a box,
 * or the label of a `mark` step and let scripts/auto-camera.mjs fill it in.
 */
export type Callout = {
  /** When it appears. With `mark`, auto-camera.mjs sets it from the mark. */
  atSec?: number;
  /**
   * How long it stays. Default 2.5. With `mark`, auto-camera.mjs sets it: up
   * to `maxSec`, ending just after the next click, which usually changes
   * what the callout circles.
   */
  forSec?: number;
  /** [x, y, w, h] as fractions of the recording. With `mark`, set for you. */
  box?: [number, number, number, number];
  /**
   * Label of a `mark` step in the take. auto-camera.mjs then owns atSec,
   * forSec and box, and recomputes them on every run (after a trim or speed
   * change too).
   */
  mark?: string;
  /** With `mark`: seconds after the mark to appear. Default 0. */
  delaySec?: number;
  /** With `mark`: the longest it stays. Default 2.5. */
  maxSec?: number;
  /** A short label, hung from a hand-drawn arrow to the mark (a chip next to the box for ring and spotlight). */
  label?: string;
  /**
   * The compositor (compose.mjs) draws a hand-drawn annotation in the style's ink, after Rough Notation:
   * circle (default): the thing that changed. underline, highlight: text. box: a region. bracket: a group.
   * strike, cross: what was removed. ring: a soft outline. spotlight: dims everything else too.
   * This Remotion template draws ring for every annotation and spotlight as it always has.
   */
  style?: "circle" | "box" | "underline" | "highlight" | "bracket" | "strike" | "cross" | "ring" | "spotlight";
  /** With style "bracket": the sides it draws. Default ["left", "right"]. */
  brackets?: Array<"left" | "right" | "top" | "bottom">;
  /** false: the label without the arrow. Default true when there is a label. */
  arrow?: boolean;
  /** Where the label goes. Default: the side with room, all the time it shows (above, then below, right, left). */
  side?: "above" | "below" | "left" | "right";
};

/** A caption that shows from atSec until the next one, or the scene's end. */
export type TimedCaption = { atSec: number; text: string; tag?: string };

/** Options for scripts/auto-camera.mjs; see that file for what each does. */
export type AutoCamera = {
  zoom?: number;
  maxZoom?: number;
  minZoom?: number;
  lead?: number;
  hold?: number;
  gap?: number;
  reach?: number;
  pad?: number;
  outSec?: number;
  endWide?: boolean;
};

/** Narration for one scene: a file in public/, e.g. "audio/vo-03.mp3". */
export type Voiceover = { src: string; volume?: number; delaySec?: number };

type SceneCommon = {
  durationSec: number;
  /** Chapter name, for chapters.txt and the captions file deliver.mjs writes. */
  chapter?: string;
  voiceover?: Voiceover;
};

export type ClipScene = SceneCommon & {
  type: "clip";
  /** File in public/, e.g. "clips/after-404.mp4". */
  src: string;
  durationSec: number;
  /** Skip this many seconds at the start of the file. */
  trimStartSec?: number;
  /** Width / height of the recording, e.g. 1.6 for 1440x900. */
  aspect: number;
  /** Short colored label in front of the caption, e.g. "Before". */
  tag?: string;
  caption?: string;
  /**
   * flat (default): the recording in a rounded window on the background. With
   *   `moves`, the camera pushes in and pans INSIDE the window, the way a
   *   screen-recording editor zooms: the frame stays put, the detail grows.
   *   Use this for most scenes.
   * stage: a tilted 3D product shot with camera moves. Save it for one or two
   *   hero moments (the reveal, the ending); on every scene it tires the eye
   *   and makes small UI harder to read.
   * full: the recording fills the canvas edge to edge, for dense UI.
   */
  frame?: "flat" | "stage" | "full";
  moves?: CameraMove[];
  /**
   * Let scripts/auto-camera.mjs write `moves` from the take's events.json:
   * push in on clicks and typing, pull out between them.
   */
  autoCamera?: boolean | AutoCamera;
  /** Set by auto-camera.mjs on the moves it wrote. */
  movesFrom?: "auto-camera";
  /**
   * Several captions in turn, for a scene that walks through steps. Replaces
   * `caption` when present.
   */
  captions?: TimedCaption[];
  callouts?: Callout[];
  /**
   * Play faster to skip a wait (2 = double speed). The scene still lasts
   * durationSec; it covers durationSec * playbackRate of the recording. Say so
   * in the caption when time itself matters.
   */
  playbackRate?: number;
};

/** The problem as it was reported: a ticket card, before the clips. */
export type IssueScene = SceneCommon & {
  type: "issue";
  /** "Linear", "GitHub", "Support"... */
  source?: string;
  /** "ABC-123" */
  id?: string;
  title: string;
  /** The reporter's words, trimmed to the part that matters. */
  quote?: string;
  /** "Reported by Sam, Sep 18" */
  reporter?: string;
  /** "Fixed", "In review"... shown as a pill. */
  status?: string;
};

/** Before and after side by side, playing together. */
export type SplitScene = SceneCommon & {
  type: "split";
  /** Width / height of both recordings. */
  aspect: number;
  before: { src: string; trimStartSec?: number; label?: string };
  after: { src: string; trimStartSec?: number; label?: string };
  caption?: string;
  tag?: string;
};

/** A screenshot, with an optional slow camera drift to keep it alive. */
export type ImageScene = SceneCommon & {
  type: "image";
  src: string;
  aspect: number;
  tag?: string;
  caption?: string;
  moves?: CameraMove[];
  callouts?: Callout[];
};

/** A short list: what changed, or the end card. */
export type ListScene = SceneCommon & {
  type: "list";
  title: string;
  items: string[];
  subtitle?: string;
};

export type Scene = TitleScene | ClipScene | IssueScene | SplitScene | ImageScene | ListScene;

/** A music bed under the whole video, dipped under any voiceover. */
export type Music = {
  src: string;
  /** Default 0.16: a bed, not a soundtrack. */
  volume?: number;
  fadeInSec?: number;
  fadeOutSec?: number;
  /** Multiplier while a voiceover plays. Default 0.35 (about -9 dB). */
  duck?: number;
};

/**
 * zoom-blur: the default cut. fade: soft. cut: none.
 * whip-pan: fast sideways, between peer features.
 * push-through: into something deeper, e.g. before -> after.
 * focus-pull: calm and premium, into and out of title cards.
 */
export type TransitionName = "zoom-blur" | "fade" | "cut" | "whip-pan" | "push-through" | "focus-pull";

export type Transition =
  | TransitionName
  | { type: TransitionName; sec?: number; direction?: "left" | "right" | "up" | "down" };

/**
 * The look of the fast renderer (scripts/compose.mjs): a style name such as
 * "studio" (the default, today's look) or "midnight", or { preset, overrides }
 * with token overrides (see scripts/compositor/styles/README.md). The Remotion
 * template ignores this key and always renders the studio look.
 */
export type StyleChoice = string | { preset?: string; overrides?: Record<string, unknown> };

export type VideoSpec = {
  width: number;
  height: number;
  fps: number;
  theme: Theme;
  /** Optional. Only the compose.mjs renderer reads it; Remotion renders the base look. */
  style?: StyleChoice;
  /** Used between scenes unless a scene pair overrides it. */
  transition: Transition;
  /**
   * Fallback length for zoom-blur and fade. Every other transition has its
   * own natural length (from remocn), unless `{ type, sec }` sets one.
   */
  transitionSec: number;
  /** Optional per-gap overrides; index i is the gap after scene i. */
  transitions?: (Transition | null)[];
  scenes: Scene[];
  /** Optional. Videos for Slack and PRs usually play muted; captions carry the story. */
  music?: Music;
};
