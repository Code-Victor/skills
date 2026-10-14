// The video's timeline, identical to the template's timeline.ts and
// transitions.ts: a transition overlaps the two scenes it joins, so every
// scene starts where the last one ended minus the overlap. Pure functions,
// shared by Node and the page.

// remocn's natural lengths (frames at 30 fps from each component's page), in seconds.
export const NATURAL_SEC = { 'whip-pan': 26 / 30, 'push-through': 40 / 30, 'focus-pull': 46 / 30 };
export const TRANSITIONS = ['zoom-blur', 'fade', 'cut', 'whip-pan', 'push-through', 'focus-pull'];

export const resolveGap = (spec, i) => {
  const t = spec.transitions?.[i] ?? spec.transition;
  const o = typeof t === 'string' ? { type: t } : t;
  // spec.style is the resolved style (compose.mjs puts it there): it may add transitions of its own
  const custom = spec.style?.transition?.custom?.[o.type];
  const sec = o.type === 'cut' ? 0 : (('sec' in o && o.sec) || custom?.sec || NATURAL_SEC[o.type] || spec.transitionSec);
  return { type: o.type, sec, direction: 'direction' in o ? o.direction : undefined, custom, stepped: !!(custom?.stepped ?? o.stepped ?? spec.style?.transition?.stepped) };
};

/** Frames a gap eats: the overlap between the two scenes it joins. */
export const gapFrames = (spec, i, fps) => Math.round(resolveGap(spec, i).sec * fps);

export const sceneSpans = (spec, fps) => {
  let start = 0;
  return spec.scenes.map((scene, i) => {
    if (i > 0) start -= gapFrames(spec, i - 1, fps);
    const span = { start, end: start + Math.round(scene.durationSec * fps) };
    start = span.end;
    return span;
  });
};

export const totalFrames = (spec, fps = spec.fps) => {
  const spans = sceneSpans(spec, fps);
  return spans.length ? spans[spans.length - 1].end : 0;
};

/**
 * What is on screen at output frame n: every scene whose span covers it, its
 * local frame, and the progress (0..1) of the transition it is entering from
 * and/or exiting into (null when there is none).
 */
export const activeScenes = (spec, spans, n, fps) =>
  spans.flatMap((s, i) => {
    if (n < s.start || n >= s.end) return [];
    const prevGap = i > 0 ? gapFrames(spec, i - 1, fps) : 0;
    const nextGap = i + 1 < spans.length ? gapFrames(spec, i, fps) : 0;
    const enter = prevGap > 0 && n - s.start < prevGap ? (n - s.start) / prevGap : null;
    const exit = nextGap > 0 && n >= s.end - nextGap ? (n - (s.end - nextGap)) / nextGap : null;
    return [{
      i, local: n - s.start, enter, exit,
      enterGap: enter !== null ? resolveGap(spec, i - 1) : null,
      exitGap: exit !== null ? resolveGap(spec, i) : null,
    }];
  });
