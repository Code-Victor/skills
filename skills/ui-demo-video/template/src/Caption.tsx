import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { fontFamily } from "./font";

type Props = { tag?: string; text: string; tagColor?: string };

// A restrained pill under the frame: sentence case, solid colors, one
// entrance and one exit. It lives outside the recording so it never covers UI.
export const Caption = ({ tag, text, tagColor = "#6ebeff" }: Props) => {
  const frame = useCurrentFrame();
  const { fps, width, durationInFrames } = useVideoConfig();
  const enter = spring({ frame: frame - Math.round(0.25 * fps), fps, config: { damping: 200 } });
  const exit = interpolate(frame, [durationInFrames - Math.round(0.35 * fps), durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const size = width * 0.0135;

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: size * 0.7,
        padding: `${size * 0.55}px ${size * 1.05}px`,
        borderRadius: 999,
        background: "rgba(17,17,20,0.92)",
        boxShadow: "0 1px 0 rgba(255,255,255,0.06) inset, 0 8px 24px rgba(0,0,0,0.18)",
        fontFamily,
        fontSize: size,
        fontWeight: 500,
        lineHeight: 1.2,
        color: "#fff",
        whiteSpace: "nowrap",
        opacity: enter * exit,
        transform: `translateY(${(1 - enter) * size * 0.8}px)`,
      }}
    >
      {tag ? <span style={{ color: tagColor, fontWeight: 600 }}>{tag}</span> : null}
      <span>{text}</span>
    </div>
  );
};
