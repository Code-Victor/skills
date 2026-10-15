// Shared helpers for the ui-demo-video scripts: the timeline sums (kept in
// step with template/src/timeline.ts and transitions.ts), the keys a spec may
// carry, and turning an authored demo.json into the video.json the renderers
// read. Imported by check-video.mjs, deliver.mjs and demo.mjs; it has no side
// effects of its own.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

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
  // spec.style is the resolved style once fillTiming has put it there: it may add transitions of its own
  return ('sec' in o && o.sec) || spec.style?.transition?.custom?.[o.type]?.sec || NATURAL[o.type] || (spec.transitionSec ?? 0.5);
};

// The style a spec (or a --style override) asks for, by name; undefined means the default, studio.
export const styleName = (spec, override) => {
  const st = override ?? spec?.style;
  return typeof st === 'string' ? st : st?.preset;
};
// A spec for a style other than studio holds only what the author wrote; the
// style supplies the rest. These are the values it supplies for timing.
// `style` is the RESOLVED style (compositor/styles resolveStyle(spec)). Returns
// a copy with transition and transitionSec filled the way compose.mjs does, so
// the timeline sums (captions, chapters, checks) match the rendered video.
export const fillTiming = (spec, style) => {
  const out = { ...spec, style };
  if (style?.transition) {
    out.transition ??= style.transition.default;
    out.transitionSec ??= style.transition.sec;
  }
  return out;
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
  clip: [...COMMON, ...CLIPLIKE, 'type', 'trimStartSec', 'frame', 'moves', 'autoCamera', 'movesFrom', 'captions', 'playbackRate', 'camera'],
  split: [...COMMON, 'type', 'aspect', 'before', 'after', 'caption', 'tag'],
  image: [...COMMON, ...CLIPLIKE, 'type', 'moves', 'camera'],
  list: [...COMMON, 'type', 'title', 'items', 'subtitle'],
};
export const TOP_KEYS = ['width', 'height', 'fps', 'theme', 'style', 'camera', 'transition', 'transitionSec', 'transitions', 'scenes', 'music'];
// A callout on a clip or image scene. "style": a hand-drawn annotation (circle, the default, box, underline, highlight,
// bracket, strike, cross) or one of the two older highlights (ring, spotlight); "brackets": a bracket's sides;
// "arrow": false keeps the label without the arrow; "side": where the label goes.
export const CALLOUT_KEYS = ['atSec', 'forSec', 'box', 'mark', 'delaySec', 'maxSec', 'label', 'style', 'brackets', 'arrow', 'side'];
export const CALLOUT_STYLES = ['circle', 'box', 'underline', 'highlight', 'bracket', 'strike', 'cross', 'ring', 'spotlight'];
export const CALLOUT_SIDES = ['above', 'below', 'left', 'right'];
export const BRACKET_SIDES = ['left', 'right', 'top', 'bottom'];
// "camera": "fill" (the zoom grows the whole window until the recording fills the frame) or "inside"
// (the zoom crops inside a fixed window), or { "mode": ... }; on the spec or on a clip or image scene.
export const CAMERA_MODES = ['fill', 'inside'];
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
// A caption in a clip scene's `captions`: at a time, or `leadSec` (0.6) before a mark.
export const CAPTION_KEYS = ['atSec', 'atMark', 'leadSec', 'text', 'tag'];

// A figure take ("source": "figure") records an HTML figure frame by frame
// (capture-figure.mjs) instead of a screen. Of the capture options it takes
// only these; the rest describe a browser session it does not have.
export const FIGURE_CAPTURE = ['fps', 'crf', 'jpegQuality', 'encoder'];
export const FIGURE_TAKE_KEYS = ['source', 'page', 'viewport', 'dpr', 'timeline', 'duration', 'marks', 'figureSteps',
  'seed', 'transitions', ...FIGURE_CAPTURE];
export const FIGURE_MARK_KEYS = ['id', 't', 'anchor', 'label', 'poster', 'look'];
export const FIGURE_STEP_KEYS = ['at', 'move', 'dur', 'key', 'click', 'mark', 'anchor', 'label', 'look'];
// What to write instead of a screen-take key on a figure take.
export const FIGURE_INSTEAD = {
  url: 'a figure take records its "page" (an HTML file next to demo.json), not a url',
  steps: 'use "marks" for named moments and "figureSteps" for timed input, not "steps"',
  setup: 'a figure take runs no setup command; build the page before you record',
  pageSetup: 'the page reads window.__figureRecording (figure-hook.js exports it as `recording`) to start still, instead of pageSetup',
  rehearse: 'a figure take has no rehearsal; check frames with capture-figure.mjs --preview',
  width: 'use "viewport": [w, h], not width/height',
  height: 'use "viewport": [w, h], not width/height',
  scale: 'use "dpr", not scale',
  mobile: 'use "viewport" (for example [390, 844]) and "dpr", not mobile',
  dark: 'draw the figure in the colours you want; a figure take emulates no colour scheme',
  hide: 'a figure page has nothing to hide; leave it out of the page',
  hideFloating: 'a figure page has nothing to hide; leave it out of the page',
  keep: 'a figure page has nothing to hide; leave it out of the page',
  redact: 'draw no private data in a figure; leave it out of the page',
  cursorScale: 'a figure take draws no cursor',
  noCursor: 'a figure take draws no cursor',
  noRipple: 'a figure take draws no cursor',
  slow: 'a figure take is stepped frame by frame, so it never needs slowing down',
  lossless: 'use "jpegQuality" (up to 100) for sharper frames',
  allowRedirect: 'a figure take loads a local file, so there is no redirect to allow',
};
export const isFigureTake = (t) => !!t && typeof t === 'object' && t.source !== undefined;

// ---------------------------------------------------------------- takes

export const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const clipPath = (take) => `clips/${take}.mp4`;

// Everything one take needs, with demo-level defaults folded in. `where` is
// the demo.json's folder (a figure take's page is relative to it), or
// { dir, file } to also name the demo file itself.
export const takeSpec = (demo, name, where = {}) => {
  const t = demo.takes?.[name] ?? {};
  if (isFigureTake(t)) return figureTakeSpec(demo, name, t, typeof where === 'string' ? { dir: where } : where);
  const options = {};
  for (const k of Object.keys(CAPTURE_OPTIONS)) {
    const v = t[k] ?? demo.capture?.[k];
    if (v !== undefined && v !== null && v !== false) options[k] = Array.isArray(v) ? v.join(', ') : v;
  }
  let url = takeUrl(t.url, demo.url);
  const file = localPage(url, typeof where === 'string' ? where : where?.dir);
  if (file) url = pathToFileURL(file).href;
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

// A screen take's url: its own, resolved against the top-level url when both
// are there, else whichever is given.
export const takeUrl = (own, base) => {
  let url = own ?? base;
  try {
    if (base && own) url = new URL(own, base).href;
  } catch {}
  return url;
};
// A url with no scheme ("figure/app.html") names a page on disk, relative to
// the demo.json folder (`dir`), and records as a file:// url. Before, such a
// url could not load at all, so no take that worked reads differently.
export const hasScheme = (url) => /^[A-Za-z][A-Za-z0-9+.-]*:/.test(url);
export const localPage = (url, dir) => (typeof url === 'string' && url && dir && !hasScheme(url) ? resolve(dir, url) : null);

// A figure take: the page and how figure time runs. demo.url and the demo's
// screen capture options don't apply; fps, crf, jpegQuality and encoder do.
const figureTakeSpec = (demo, name, t, { dir = '.', file } = {}) => {
  const options = {};
  for (const k of FIGURE_CAPTURE) {
    const v = t[k] ?? demo.capture?.[k];
    if (v !== undefined && v !== null && v !== false) options[k] = v;
  }
  const timeline = Array.isArray(t.timeline) ? t.timeline : null;
  return {
    name,
    source: 'figure',
    page: resolve(dir, String(t.page ?? '')),
    // The take's length: the timeline's last video second, else `duration`.
    duration: timeline ? timeline.at(-1)?.[0] : t.duration,
    timeline,
    viewport: t.viewport ?? [1920, 1080],
    dpr: t.dpr ?? 1.5,
    marks: t.marks ?? [],
    figureSteps: t.figureSteps ?? [],
    seed: t.seed ?? 1,
    transitions: t.transitions ?? 'off',
    // Left out of the page folder's fingerprint (it is there when the page sits next to it).
    demoFile: file ? resolve(file) : null,
    steps: [],
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

// The capture.mjs arguments for a take (capture-figure.mjs for a figure
// take). `rehearse` leaves out what only a recording needs.
export const captureArgs = (take, { rehearse = false, port, stepsFile, out, allowTemp = false, draft = false } = {}) => {
  if (take.source === 'figure') return figureArgs(take, { out, allowTemp, draft });
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

const figureArgs = (take, { out, allowTemp, draft }) => {
  const [w, h] = take.viewport;
  const a = ['--page', take.page, '--out', out, '--viewport', `${w}x${h}`, '--dpr', String(take.dpr)];
  if (take.timeline) a.push('--timeline', JSON.stringify(take.timeline));
  else a.push('--duration', String(take.duration));
  if (take.marks.length) a.push('--marks', JSON.stringify(take.marks));
  if (take.figureSteps.length) a.push('--steps', JSON.stringify(take.figureSteps));
  a.push('--seed', String(take.seed), '--transitions', take.transitions);
  for (const [k, v] of Object.entries(take.options)) a.push(CAPTURE_OPTIONS[k].flag, String(v));
  if (draft || take.draft) a.push('--draft');
  if (allowTemp) a.push('--allow-temp');
  return a;
};

// A fingerprint of everything that defines a take. Change a step, the url,
// the duration or a capture option and the clip is stale; change the APP and
// nothing here can tell, so that needs --retake. A figure take also covers
// its page and the files next to it, so editing the figure re-records it.
export const HASH_VERSION = 1;
export const takeHash = (take) => {
  if (take.source === 'figure') return figureHash(take);
  return createHash('sha1')
    .update(JSON.stringify([HASH_VERSION, take.url, take.duration, take.steps, take.setup ?? null, take.pageSetup ?? null,
      Object.fromEntries(Object.entries(take.options).sort(([a], [b]) => a.localeCompare(b)))]))
    .digest('hex')
    .slice(0, 16);
};

// Files in a figure's folder that are not part of the figure: the demo's own
// files (a page often sits next to demo.json) and what a run writes.
const NOT_FIGURE = /^\.|\.md$|\.(mp4|mov|webm|gif)$|\.events\.json$|\.take\.json$|\.sheet\.png$|(^|\.)demo\.json$/i;
const FIGURE_FILE_MAX = 20 * 1024 * 1024;
const sortKeys = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
const figureHash = (take) => {
  const h = createHash('sha1');
  h.update(JSON.stringify([HASH_VERSION, 'figure', take.duration, take.timeline, take.marks, take.figureSteps, take.seed,
    take.transitions, take.viewport, take.dpr, !!take.draft, sortKeys(take.options)]));
  // The page, then every file beside it (not in subfolders), by name.
  const page = take.page;
  h.update('\0page\0');
  try { h.update(readFileSync(page)); } catch { h.update('\0missing\0'); }
  const dir = dirname(page);
  let names = [];
  try { names = readdirSync(dir).sort(); } catch {}
  for (const n of names) {
    const f = join(dir, n);
    if (f === page || f === take.demoFile || NOT_FIGURE.test(n)) continue;
    let st;
    try { st = statSync(f); } catch { continue; }
    if (!st.isFile() || st.size > FIGURE_FILE_MAX) continue;
    h.update(`\0${n}\0`);
    try { h.update(readFileSync(f)); } catch {}
  }
  return h.digest('hex').slice(0, 16);
};

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
//
// `opts.style` is a --style override: it replaces demo.style in the result.
// With studio (or no style) the authoring defaults below are written in, as
// they always were. With any other style the spec holds only what the author
// wrote for theme, transition and transitionSec, so the engine can tell a
// choice from a default and the style supplies the rest.
export const resolveSpec = (demo, aspects = {}, opts = {}) => {
  const spec = {};
  for (const k of TOP_KEYS) if (demo[k] !== undefined) spec[k] = structuredClone(demo[k]);
  if (opts.style) spec.style = opts.style;
  const styled = (styleName(spec) ?? 'studio') !== 'studio';
  const KEEP_BLANK = styled ? ['theme', 'transition', 'transitionSec'] : [];
  for (const [k, v] of Object.entries(DEFAULTS)) if (spec[k] === undefined && !KEEP_BLANK.includes(k)) spec[k] = structuredClone(v);
  if (!styled) spec.theme = { ...DEFAULTS.theme, ...spec.theme };
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
