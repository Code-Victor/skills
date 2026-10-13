import { fade } from "@remotion/transitions/fade";
import type { TransitionPresentation } from "@remotion/transitions";
import { focusPull } from "@/components/remocn/focus-pull";
import { pushThrough } from "@/components/remocn/push-through";
import { whipPan } from "@/components/remocn/whip-pan";
import { zoomBlur } from "@/components/remocn/zoom-blur";
import type { Transition, TransitionName, VideoSpec } from "./types";

// remocn's natural lengths (frames at 30fps, from each component's page),
// in seconds. Shorter and the effect smears; longer and it drags.
const NATURAL_SEC: Partial<Record<TransitionName, number>> = {
  "whip-pan": 26 / 30,
  "push-through": 40 / 30,
  "focus-pull": 46 / 30,
};

type Resolved = { type: TransitionName; sec: number; direction?: "left" | "right" | "up" | "down" };

export const resolveGap = (spec: VideoSpec, i: number): Resolved => {
  const t: Transition = spec.transitions?.[i] ?? spec.transition;
  const o = typeof t === "string" ? { type: t } : t;
  const sec = o.type === "cut" ? 0 : (("sec" in o && o.sec) || NATURAL_SEC[o.type] || spec.transitionSec);
  return { type: o.type, sec, direction: "direction" in o ? o.direction : undefined };
};

/** Frames a gap eats: the overlap between the two scenes it joins. */
export const gapFrames = (spec: VideoSpec, i: number, fps: number) => Math.round(resolveGap(spec, i).sec * fps);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const presentationFor = (r: Resolved): TransitionPresentation<any> | null => {
  switch (r.type) {
    case "zoom-blur":
      return zoomBlur();
    case "fade":
      return fade();
    case "whip-pan":
      return whipPan({ direction: r.direction ?? "left" });
    case "push-through":
      return pushThrough();
    case "focus-pull":
      return focusPull();
    default:
      return null;
  }
};
