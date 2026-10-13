import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { fontFamily } from "./font";
import type { Callout } from "./types";

/**
 * Highlights drawn in the recording's own coordinates, inside the camera, so
 * they stay on their target through a zoom or pan. Strokes are divided by the
 * zoom so a ring keeps the same weight on screen.
 */
export const Callouts = ({
  callouts,
  w,
  h,
  zoom,
  accent,
}: {
  callouts: Callout[];
  w: number;
  h: number;
  zoom: number;
  accent: string;
}) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const k = width / 1920 / zoom;

  return (
    <>
      {callouts.map((c, i) => {
        if (!c.box || c.atSec === undefined) return null;
        const from = Math.round(c.atSec * fps);
        const to = from + Math.round((c.forSec ?? 2.5) * fps);
        if (frame < from - 1 || frame > to + 1) return null;
        const enter = spring({ frame: frame - from, fps, config: { damping: 200 }, durationInFrames: Math.round(0.35 * fps) });
        const exit = interpolate(frame, [to - Math.round(0.25 * fps), to], [1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const o = enter * exit;
        const [x, y, bw, bh] = c.box;
        const pad = 8 * k;
        const left = x * w - pad;
        const top = y * h - pad;
        const boxW = bw * w + pad * 2;
        const boxH = bh * h + pad * 2;
        const labelBelow = y < 0.18;
        return (
          <div key={i} style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: o }}>
            <div
              style={{
                position: "absolute",
                left,
                top,
                width: boxW,
                height: boxH,
                borderRadius: 10 * k,
                boxShadow:
                  c.style === "spotlight"
                    ? `0 0 0 ${2.5 * k}px ${accent}, 0 0 0 ${9999}px rgba(10,10,14,${0.42 * o})`
                    : `0 0 0 ${2.5 * k}px ${accent}`,
                background: c.style === "spotlight" ? "transparent" : `${accent}14`,
                transform: `scale(${0.96 + 0.04 * enter})`,
              }}
            />
            {c.label ? (
              <div
                style={{
                  position: "absolute",
                  left,
                  top: labelBelow ? top + boxH + 10 * k : undefined,
                  bottom: labelBelow ? undefined : h - top + 10 * k,
                  padding: `${6 * k}px ${12 * k}px`,
                  borderRadius: 999,
                  background: accent,
                  color: "#fff",
                  fontFamily,
                  fontSize: 22 * k,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  transform: `translateY(${(1 - enter) * 6 * k * (labelBelow ? -1 : 1)}px)`,
                }}
              >
                {c.label}
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
};
