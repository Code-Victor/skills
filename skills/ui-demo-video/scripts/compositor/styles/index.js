// The style registry (Node only). A style is one small file that default-exports
// a token object; `extends: 'studio'` inherits everything it does not mention.
// A spec picks one with  "style": "midnight"  or
// "style": { "preset": "midnight", "overrides": { "post": { "grain": 0.02 } } }.
import crypto from 'node:crypto';
import { withAlpha as alpha, contrast, ensureContrast, luminance, mix, parseColor } from '../color.js';
import studio from './studio.js';
import midnight from './midnight.js';
import editorial from './editorial.js';
import terminal from './terminal.js';
import sketch from './sketch.js';

export const STYLES = { studio, midnight, editorial, terminal, sketch };
// Test hook: UI_DEMO_EXTRA_STYLES=/abs/path/file.js (default export { name: style, ... } or one style) adds styles that are not registered yet.
if (process.env.UI_DEMO_EXTRA_STYLES) {
  const extra = (await import(process.env.UI_DEMO_EXTRA_STYLES)).default;
  if (extra?.name && typeof extra.name === 'string') STYLES[extra.name] = extra; else Object.assign(STYLES, extra);
}
export const DEFAULT_STYLE = 'studio';
export const styleNames = () => Object.keys(STYLES);
/** [{ name, description, suits }] for --list-styles and the docs. */
export const listStyles = () => styleNames().map((name) => ({ name, description: STYLES[name].description, suits: STYLES[name].suits }));
/** The top-level token groups; check-video uses this to flag typos in overrides. */
export const TOKEN_GROUPS = Object.keys(studio).filter((k) => !['name', 'description', 'suits'].includes(k)).concat(['extends']);
export const unknownStyleMessage = (name) => `unknown style "${name}" (valid styles: ${styleNames().join(', ')})`;

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
/** Objects merge key by key; arrays, functions and scalars replace; `undefined` is skipped. */
export const deepMerge = (a, b) => {
  if (!isObj(a) || !isObj(b)) return b === undefined ? a : b;
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) if (v !== undefined) out[k] = isObj(v) && isObj(a[k]) ? deepMerge(a[k], v) : v;
  return out;
};

/**
 * A style with its `extends` chain folded in (child wins). One token is not passed on: `camera.mode`.
 * How the camera frames the recording (fill: the window grows until the recording fills the frame;
 * inside: the zoom crops inside a fixed window) is part of a style's identity, so a style that does
 * not say `camera: { mode: 'fill' }` itself frames inside, whatever it extends.
 */
export const flatten = (name, seen = []) => {
  const s = STYLES[name];
  if (!s) throw new Error(unknownStyleMessage(name));
  if (seen.includes(name)) throw new Error(`style "${name}" extends itself (${[...seen, name].join(' -> ')})`);
  if (!s.extends) return s;
  const parent = flatten(s.extends, [...seen, name]);
  return deepMerge({ ...parent, camera: { ...parent.camera, mode: 'inside' } }, s);
};

/** What a spec asked for: { preset, overrides }. */
export const styleRequest = (spec, flagStyle) => {
  const raw = flagStyle ?? spec.style;
  if (raw === undefined || raw === null) return { preset: DEFAULT_STYLE, overrides: {} };
  if (typeof raw === 'string') return { preset: raw, overrides: {} };
  return { preset: raw.preset ?? DEFAULT_STYLE, overrides: raw.overrides ?? {} };
};

const clone = (v) => (isObj(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)])) : Array.isArray(v) ? v.map(clone) : v);
const fnKey = (k, v) => (typeof v === 'function' ? `fn:${v.toString()}` : v);

/**
 * The style a render uses: preset + overrides, then what the spec's `theme` may change.
 *   studio     theme.background / foreground / accent / tagColors all apply (as always).
 *   any other  the style owns its ground and text colour: theme.background and
 *              theme.foreground are ignored (a note says so; change them with
 *              style.overrides). theme.accent and theme.tagColors still apply, passed
 *              through the style's palette.mapAccent(colour, tools) and
 *              palette.mapTag(name, colour, tools) when it has them, so a style can
 *              adapt an incoming colour to its ground (lift it on a dark one).
 * What is in the spec is what the author wrote (spec-lib no longer fills defaults for a styled
 * spec), so there is no "equal to the default means unset" guessing.
 * `flagStyle` is --style (it beats the spec). The result has a non-enumerable `notes` array of warnings.
 */
export const resolveStyle = (spec, flagStyle) => {
  const { preset, overrides } = styleRequest(spec, flagStyle);
  if (!STYLES[preset]) throw new Error(unknownStyleMessage(preset));
  let s = clone(deepMerge(flatten(preset), overrides));
  const isStudio = preset === 'studio', notes = [];
  const t = spec.theme ?? {};
  if (isStudio) {
    if (t.foreground !== undefined) s.palette.foreground = t.foreground;
    if (t.accent !== undefined) s.palette.accent = t.accent;
    if (t.tagColors !== undefined) s.palette.tagColors = deepMerge(s.palette.tagColors ?? {}, t.tagColors);
    if (t.background !== undefined) { s.palette.background = t.background; s.canvas = { ...s.canvas, background: { kind: 'css' } }; }
  } else {
    if (t.background !== undefined || t.foreground !== undefined)
      notes.push(`theme.${[t.background !== undefined && 'background', t.foreground !== undefined && 'foreground'].filter(Boolean).join(' and theme.')} ignored: style "${preset}" owns its ground and text colour (change them with "style": { "preset": "${preset}", "overrides": { "palette": { "background": ..., "foreground": ... } } })`);
    const P = s.palette;
    const tools = { palette: P, ground: s.canvas.matte, parse: parseColor, luminance, contrast, mix, alpha, ensureContrast };
    if (t.accent !== undefined) P.accent = typeof P.mapAccent === 'function' ? (P.mapAccent(t.accent, tools) ?? t.accent) : t.accent;
    if (t.tagColors) {
      const own = Object.fromEntries(Object.entries(t.tagColors).map(([k, v]) => [k, typeof P.mapTag === 'function' ? (P.mapTag(k, v, tools) ?? v) : v]));
      P.tagColors = deepMerge(P.tagColors ?? {}, own);
    }
  }
  if (s.canvas.background.kind !== 'css' && s.canvas.model === 'scene') s.canvas.model = 'shared';
  s.camera = { ...s.camera, mode: s.camera?.mode === 'fill' ? 'fill' : 'inside' };
  // caption.tagContrast: lift each tag colour until it holds that contrast on the caption's plate
  // composited over white (the lightest thing a plate can sit on; over black a dark plate only gets darker).
  const plate = captionPlate(s);
  if (s.caption.tagContrast && plate) {
    const lift = (c) => ensureContrast(c, plate, s.caption.tagContrast, s.rgb ?? {});
    s.captionTags = { colors: Object.fromEntries(Object.entries(s.palette.tagColors ?? {}).map(([k, v]) => [k, lift(v)])), fallback: lift(s.palette.tagFallback), accent: lift(s.palette.accent) };   // accent: an *emphasised* word in a caption
  }
  if (s.post.dither > 0 || s.post.grain > 0 || s.post.vignette > 0 || s.caption.variant === 'glass' || s.callout?.label?.plate === 'glass') s.needsMain = true;
  s.name = preset;
  s.builders = Object.keys(s.build ?? {});
  s.hash = crypto.createHash('sha1').update(JSON.stringify(s, fnKey)).digest('hex').slice(0, 8);
  Object.defineProperty(s, 'notes', { value: notes, enumerable: false });
  return s;
};

/** A dark caption plate's colour over white (pill background or glass tint), as #rrggbb; null when the caption has no plate or it cannot be read. */
export const captionPlate = (s) => {
  const k = s.caption, css = k.variant === 'pill' ? k.pill?.background : k.variant === 'glass' ? k.glass?.tint : k.variant === 'bar' ? k.bar?.background : null;
  const c = css ? parseColor(css) ?? s.rgb?.[css] : null;
  if (!c) return null;
  const a = c[3] ?? 1, hx = (v) => Math.round(v * a + 255 * (1 - a)).toString(16).padStart(2, '0');
  return `#${hx(c[0])}${hx(c[1])}${hx(c[2])}`;
};

/** Every colour string in the style that the GPU needs as numbers (resolved by Chrome when the local parser cannot read it). */
export const colorStrings = (s) => {
  const out = new Set();
  const add = (c) => { if (typeof c === 'string' && c) out.add(c); };
  const p = s.palette;
  [p.foreground, p.accent, p.onAccent, p.danger, p.tagFallback, s.canvas.matte, s.callout.dimColor, s.caption.glass.tint, s.caption.glass.border, s.window.fill].forEach(add);
  Object.values(p.tagColors ?? {}).forEach(add);
  for (const c of s.canvas.background.colors ?? []) add(c);
  add(s.canvas.background.tint);
  for (const c of s.caption.color ? [s.caption.color] : []) add(c);
  const K = s.callout ?? {};   // the annotations' pen, band and label (annotate.js reads them in Node)
  [K.ink?.color, K.highlight?.color, K.label?.color, K.label?.prefixColor, K.label?.plate?.background].forEach(add);
  return [...out];
};

/** The manifest copy: JSON only (builders and other functions are Node-side). */
export const serialisable = (s) => JSON.parse(JSON.stringify(s, (k, v) => (typeof v === 'function' ? undefined : v)));
