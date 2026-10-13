import { Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "./types";

// A quiet brand mark in one corner: it fades in once and then holds still for
// the whole video. It sits in the margin, never over the recording or the
// caption band, so it reads as a signature rather than a watermark.
export const Logo = ({ logo }: { logo: NonNullable<Theme["logo"]> }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const k = width / 1920;
  const h = (logo.height ?? 34) * k;
  const pad = 44 * k;
  const corner = logo.corner ?? "bottom-right";
  const opacity =
    (logo.opacity ?? 0.9) * interpolate(frame, [0.3 * fps, 0.9 * fps], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <Img
      src={staticFile(logo.src)}
      style={{
        position: "absolute",
        height: h,
        width: "auto",
        opacity,
        [corner.startsWith("bottom") ? "bottom" : "top"]: pad * (height / width) * 1.6,
        [corner.endsWith("right") ? "right" : "left"]: pad,
      }}
    />
  );
};
