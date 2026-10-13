// Shared helpers for the ui-demo-video scripts: the timeline sums (kept in
// step with template/src/timeline.ts and transitions.ts), the keys a spec may
// carry, and turning an authored demo.json into the video.json the renderers
// read. Imported by check-video.mjs, deliver.mjs and demo.mjs; it has no side
// effects of its own.
import { createHash } from 'node:crypto';

// ---------------------------------------------------------------- timeline

// remocn's natural lengths in seconds (frames at 30 fps), as in transitions.ts.
export const NATURAL = { 'whip-pan': 26 / 30, 'push-through': 40 / 30, 'focus-pull': 46 / 30 };
export const KNOWN_TRANSITIONS = new Set(['zoom-blur', 'fade', 'cut', 'whip-pan', 'push-through', 'focus-pull']);

// The overlap a transition eats, in seconds. Same order as resolveGap() in
// template/src/transitions.ts and compositor/timeline.js: a non-zero `sec`,
// else the transition's natural length, else transitionSec (which may be 0).
export const gapSec = (spec, i) => {
  const t = spec.transitions?.[i] ?? spec.transition ?? 'zoom-blur';
  const o = typeof t === 'string' ? { type: t } : t;
  if (o.type === 'cut') return 0;
  return ('sec' in o && o.sec) || NATURAL[o.type] || (spec.transitionSec ?? 0.5);
};

// Where each scene starts and ends on the final timeline. The template works
// in whole frames (a scene is round(durationSec * fps) frames, a gap is
// round(sec * fps)), so do the same and convert back to seconds at the end.
export const sceneSpans = (spec) => {
  const fps = spec.fps || 60;
  let start = 0;
  const spans = spec.scenes.map((scene, i) => {
    if (i > 0) start -= Math.round(gapSec(spec, i - 1) * fps);
    const s = { start: start / fps, end: (start + Math.round(scene.durationSec * fps)) / fps, scene };
    start += Math.round(scene.durationSec * fps);
    return s;
  });
  // The renderer's length is where the last scene ends (totalFrames()).
  return { spans, totalSec: spans.length ? spans[spans.length - 1].end : 0 };
};

// ---------------------------------------------------------------- known keys

const COMMON = ['durationSec', 'chapter', 'voiceover'];
const CLIPLIKE = ['src', 'aspect', 'tag', 'caption', 'callouts'];
export const SCENE_KEYS = {
  title: [...COMMON, 'type', 'text', 'subtitle', 'effect'],
  issue: [...COMMON, 'type', 'source', 'id', 'title', 'quote', 'reporter', 'status'],
  clip: [...COMMON, ...CLIPLIKE, 'type', 'trimStartSec', 'frame', 'moves', 'autoCamera', 'movesFrom', 'captions', 'playbackRate'],
  split: [...COMMON, 'type', 'aspect', 'before', 'after', 'caption', 'tag'],
  image: [...COMMON, ...CLIPLIKE, 'type', 'moves'],
  list: [...COMMON, 'type', 'title', 'items', 'subtitle'],
};
export const TOP_KEYS = ['width', 'height', 'fps', 'theme', 'style', 'transition', 'transitionSec', 'transitions', 'scenes', 'music'];
export const DEMO_KEYS = ['name', 'url', 'capture', 'takes'];
// "style" is a name ("midnight") or { preset, overrides }; the names live in compositor/styles/.
export const STYLE_KEYS = ['preset', 'overrides'];
export const THEME_KEYS = ['background', 'foreground', 'accent', 'tagColors', 'logo'];
// Keys beginning with one of these are free notes for the author.
export const isNote = (k) => k.startsWith('_') || k.startsWith('$') || k === 'comment' || k === 'notes';

// What a take may say about how to record it. The value is the capture.mjs
// flag; `bool` ones are bare flags. Anything else in a take is a mistake.
export const CAPTURE_OPTIONS = {
  hide: { flag: '--hide' },
  hideFloating: { flag: '--hide-floating', bool: true },
  keep: { flag: '--keep' },
  redact: { flag: '--redact' },
  dark: { flag: '--dark', bool: true },
  mobile: { flag: '--mobile', bool: true },
  width: { flag: '--width' },
  height: { flag: '--height' },
  scale: { flag: '--scale' },
  cursorScale: { flag: '--cursor-scale' },
  slow: { flag: '--slow' },
  noCursor: { flag: '--no-cursor', bool: true },
  noRipple: { flag: '--no-ripple', bool: true },
  lossless: { flag: '--lossless', bool: true },
  allowRedirect: { flag: '--allow-redirect', bool: true },
  fps: { flag: '--fps' },
  crf: { flag: '--crf' },
  jpegQuality: { flag: '--jpeg-quality' },
  encoder: { flag: '--encoder' },
};
// Options that only matter while recording; a rehearsal leaves them out.
const RECORD_ONLY = new Set(['slow', 'lossless', 'fps', 'crf', 'jpegQuality', 'encoder']);
export const TAKE_KEYS = ['url', 'duration', 'steps', 'setup', 'pageSetup', 'rehearse', ...Object.keys(CAPTURE_OPTIONS)];
export const STEP_KEYS = ['wait', 'waitFor', 'move', 'click', 'type', 'key', 'scroll', 'eval', 'mark', 'camera', 'redact',
  'dur', 'cps', 'instant', 'look', 'target', 'fatal', 'actionTimeout'];

// ---------------------------------------------------------------- takes

export const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const clipPath = (take) => `clips/${take}.mp4`;

// Everything one take needs, with demo-level defaults folded in.
export const takeSpec = (demo, name) => {
  const t = demo.takes?.[name] ?? {};
  const options = {};
  for (const k of Object.keys(CAPTURE_OPTIONS)) {
    const v = t[k] ?? demo.capture?.[k];
    if (v !== undefined && v !== null && v !== false) options[k] = Array.isArray(v) ? v.join(', ') : v;
  }
  let url = t.url ?? demo.url;
  try {
    if (demo.url && t.url) url = new URL(t.url, demo.url).href;
  } catch {}
  return {
    name,
    url,
    duration: t.duration ?? estimateDuration(t.steps ?? []),
    steps: t.steps ?? [],
    setup: t.setup,
    pageSetup: t.pageSetup,
    // How to rehearse, not how to record: kept out of the fingerprint.
    rehearse: t.rehearse,
    options,
  };
};

// capture.mjs's own clock: a rough length for a take that did not say, from
// the waits, glides, typing and scrolls in its steps (clips run to the end of
// the steps anyway; --duration is only a floor).
export const estimateDuration = (steps) => {
  let sec = 1;
  for (const s of steps) {
    sec += (s.wait ?? 0);
    if (s.move || s.click) sec += s.dur ?? (s.move ? 0.8 : 0.6);
    if (s.type) sec += String(s.type).length / (s.instant ? 1000 : (s.cps ?? 14));
    if (s.scroll) sec += s.dur ?? 0.8;
    if (s.waitFor) sec += 0.5;
  }
  return Math.max(3, Math.ceil(sec + 1));
};

// The capture.mjs arguments for a take. `rehearse` leaves out what only a
// recording needs.
export const captureArgs = (take, { rehearse = false, port, stepsFile, out, allowTemp = false } = {}) => {
  const a = ['clip', '--url', take.url, '--steps', stepsFile];
  if (port) a.push('--port', String(port));
  for (const [k, v] of Object.entries(take.options)) {
    if (rehearse && RECORD_ONLY.has(k)) continue;
    const o = CAPTURE_OPTIONS[k];
    if (o.bool) a.push(o.flag);
    else a.push(o.flag, String(v));
  }
  if (take.pageSetup) a.push('--setup', take.pageSetup);
  if (rehearse) a.push('--dry-run');
  else a.push('--out', out, '--duration', String(take.duration), '--sheet');
  if (allowTemp) a.push('--allow-temp');
  return a;
};

// A fingerprint of everything that defines a take. Change a step, the url,
// the duration or a capture option and the clip is stale; change the APP and
// nothing here can tell, so that needs --retake.
export const HASH_VERSION = 1;
export const takeHash = (take) =>
  createHash('sha1')
    .update(JSON.stringify([HASH_VERSION, take.url, take.duration, take.steps, take.setup ?? null, take.pageSetup ?? null,
      Object.fromEntries(Object.entries(take.options).sort(([a], [b]) => a.localeCompare(b)))]))
    .digest('hex')
    .slice(0, 16);

// Takes that scenes refer to, in order of first use.
export const takesUsed = (demo) => {
  const used = [];
  const add = (n) => typeof n === 'string' && n && !used.includes(n) && used.push(n);
  for (const s of Array.isArray(demo?.scenes) ? demo.scenes : []) {
    add(s?.take);
    add(s?.before?.take);
    add(s?.after?.take);
  }
  return used;
};

// ---------------------------------------------------------------- demo -> video

export const DEFAULTS = {
  width: 1920,
  height: 1080,
  fps: 60,
  theme: {
    background: 'radial-gradient(120% 90% at 50% 0%, #f5f6fb 0%, #e4e7f2 100%)',
    foreground: '#111114',
    accent: '#3b6bff',
    tagColors: { Before: '#e5484d', After: '#3b6bff' },
  },
  transition: 'zoom-blur',
  transitionSec: 0.5,
};

// The video.json the renderers read: authoring keys stripped, `take` turned
// into `src`, and aspect filled from the recording when the scene did not say.
// `aspects` maps a take name to its width / height. Where it is not known from
// a recording (a clip or image given as `src`, or a take not recorded yet) the
// aspect is left unset: compose.mjs probes the file itself, and the file check
// compares only an aspect somebody actually wrote.
export const resolveSpec = (demo, aspects = {}) => {
  const spec = {};
  for (const k of TOP_KEYS) if (demo[k] !== undefined) spec[k] = structuredClone(demo[k]);
  for (const [k, v] of Object.entries(DEFAULTS)) if (spec[k] === undefined) spec[k] = structuredClone(v);
  spec.theme = { ...DEFAULTS.theme, ...spec.theme };
  const fill = (o) => {
    if (o?.take) {
      o.src = clipPath(o.take);
      o._aspect = aspects[o.take];
      delete o.take;
    }
  };
  spec.scenes = (spec.scenes ?? []).map((s) => {
    if (s.type === 'split') {
      fill(s.before);
      fill(s.after);
      const known = s.before?._aspect ?? s.after?._aspect;
      if (s.aspect === undefined && known !== undefined) s.aspect = known;
      delete s.before?._aspect;
      delete s.after?._aspect;
    } else if (s.type === 'clip' || s.type === 'image') {
      fill(s);
      if (s.aspect === undefined && s._aspect !== undefined) s.aspect = s._aspect;
      delete s._aspect;
    }
    return s;
  });
  return spec;
};

export const isDemo = (spec, file = '') =>
  /\.demo\.json$|(^|\/)demo\.json$/.test(file) || (spec !== null && typeof spec === 'object' && DEMO_KEYS.some((k) => k in spec)) || (Array.isArray(spec?.scenes) && spec.scenes.some((s) => s?.take || s?.before?.take));
