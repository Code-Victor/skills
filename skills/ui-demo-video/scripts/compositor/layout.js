// Everything about WHERE things go, in one place shared by Node (plan.js, which
// lays out the HTML) and the page (scenes.js, which draws the textures). Every
// number comes from the style's tokens, so the two cannot disagree.
//
// Also here: the names captured pieces are stored under (`ID`), the *emphasis*
// markup, and a few small helpers.

import { cameraAt, cameraTransform, fillTransform, makeCameraEase } from './motion.js';

export const has = (v) => v !== undefined && v !== null && String(v) !== '';
export const esc = (s) => (s === undefined || s === null ? '' : String(s)).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const r2 = (v) => Math.round(v * 100) / 100;
const j = (v) => JSON.stringify(v);

// ------------------------------------------------------------ ids
// A captured piece is stored under a name that includes the style's hash, so
// a token change can never hand back a stale picture.
let STYLE_HASH = '';
export const setStyleHash = (h) => { STYLE_HASH = h; };
/** The logo treatment, as a suffix for the logo's picture name (empty for none, so the plain logo keeps its name). */
const logoKey = (style) => { const k = style?.logo; return k && (k.filter || k.plate) ? `|${j([k.filter ?? null, k.plate ?? null])}` : ''; };
export const ID = {
  bg: () => `bg|${STYLE_HASH}`,
  shell: (b, radius, shadow = true, tag = '') => `shell|${STYLE_HASH}|${j([b.w, b.h, b.left, b.top].map(r2))}|${r2(radius)}|${shadow ? 1 : 0}|${tag}`,
  ring: (b, radius) => `ring|${STYLE_HASH}|${j([b.w, b.h, b.left, b.top].map(r2))}|${r2(radius)}`,   // position too: two equal-size boxes (a split) must not share one picture
  pill: (top, tag, color, text, extra = '') => `pill|${STYLE_HASH}|${top}|${tag ?? ''}|${color}|${text}|${extra}`,
  chip: (label, accent, extra = '') => `chip|${STYLE_HASH}|${accent}|${label}${extra ? `|${extra}` : ''}`,
  mark: (w, h, kind) => `mark|${STYLE_HASH}|${r2(w)}|${r2(h)}|${kind}`,
  logo: (src, h, style) => `logo|${src}|${r2(h)}${logoKey(style)}`,
  scrim: (view, hgt, radius, color) => `scrim|${STYLE_HASH}|${j([view.w, view.left, view.top, hgt].map(r2))}|${r2(radius)}|${color}`,
  fillScrim: () => `fillscrim|${STYLE_HASH}`,   // fill mode: the screen-space gradient behind a caption with no plate once the recording covers it
  card: (i) => `scene${i}|${STYLE_HASH}|card`,
  piece: (i, name) => `scene${i}|${STYLE_HASH}|${name}`,
  ann: (i, ci, part) => `ann|${STYLE_HASH}|s${i}.${ci}|${part}`,   // a hand-drawn annotation's pictures (annotate.js): the mark per zoom level, the arrow, the label
};

// ------------------------------------------------------------ callouts
/** What a callout may draw: the hand-drawn annotations (Rough Notation's), then the two older highlights. */
export const CALLOUT_STYLES = ['circle', 'box', 'underline', 'highlight', 'bracket', 'strike', 'cross', 'ring', 'spotlight'];
export const CALLOUT_SIDES = ['above', 'below', 'left', 'right'];
/** ring and spotlight draw exactly as they always have (the shader ring or dim, the chip label). */
export const isLegacyCallout = (kind) => kind === 'ring' || kind === 'spotlight';
/** A callout's annotation: its own `style`, else the style's `callout.style` (circle), else ring. */
export const calloutKind = (style, c) => c.style ?? style.callout?.style ?? 'ring';
/** Where a chip label sits (ring, spotlight, and styles that draw their own labels): the callout's `side` if above or below, else below the box when it is near the top. */
export const chipSide = (c) => (c.side === 'above' || c.side === 'below' ? c.side : c.box[1] < 0.18 ? 'below' : 'above');

// ------------------------------------------------------------ emphasis
// `*word*` marks the one accented word or phrase; `\*` is a literal asterisk.
/** "a *b* c" -> [{ t: 'a ', em: false }, { t: 'b', em: true }, { t: ' c', em: false }] */
export const parseEmphasis = (text) => {
  const s = String(text ?? ''), runs = [];
  let cur = '', em = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && s[i + 1] === '*') { cur += '*'; i++; continue; }
    if (c === '*') {
      // an opening * needs a closing one later; a lone * stays literal
      if (!em && !/(^|[^\\])\*/.test(s.slice(i + 1).replace(/\\\*/g, ''))) { cur += c; continue; }
      if (cur) runs.push({ t: cur, em }); cur = ''; em = !em; continue;
    }
    cur += c;
  }
  if (cur) runs.push({ t: cur, em });
  return runs;
};
/** The text with the markers removed (for caption files, chapters, anywhere plain text is wanted). */
export const stripEmphasis = (text) => parseEmphasis(text).map((r) => r.t).join('');
/** HTML for emphasised text: the marked run in a span coloured `color` (colour shift only). */
export const richHtml = (text, color) => parseEmphasis(text).map((r) => (r.em ? `<span style="color:${color}">${esc(r.t)}</span>` : esc(r.t))).join('');
/** Characters with their emphasis flag, for per-glyph reveals. */
export const emChars = (text) => parseEmphasis(text).flatMap((r) => Array.from(r.t).map((c) => ({ c, em: r.em })));
/** Words with their emphasis flag (a marked phrase marks every word in it). */
export const emWords = (text) => parseEmphasis(text).flatMap((r) => r.t.split(/\s+/).filter(Boolean).map((w) => ({ w, em: r.em })));

// ------------------------------------------------------------ boxes
/** Chrome bar height plus the style's own insets, in px: { t, r, b, l }. */
export const insetsOf = (style, W) => {
  const u = W / 1920, w = style.window, i = w.insets ?? [0, 0, 0, 0];
  const chrome = w.chrome?.kind && w.chrome.kind !== 'none' ? (w.chrome.height ?? 44) * u : 0;
  return { t: i[0] * u + chrome, r: i[1] * u, b: i[2] * u, l: i[3] * u, chrome };
};
/**
 * The window of a flat scene: `outer` is the whole shell, `view` the rectangle
 * the recording is drawn in (and the camera moves inside). They are equal unless
 * the style has insets or a chrome bar. The view keeps the recording's aspect.
 */
export const frameBox = (style, W, H, aspect) => {
  const w = style.window, ins = insetsOf(style, W);
  const vh = Math.min(H * w.maxHeight - ins.t - ins.b, (W * w.maxWidth - ins.l - ins.r) / aspect);
  const vw = vh * aspect;
  const ow = vw + ins.l + ins.r, oh = vh + ins.t + ins.b;
  const left = w.align === 'left' ? W * w.margin : w.align === 'right' ? W - W * w.margin - ow : (W - ow) / 2;
  const top = H * w.top;
  return { outer: { w: ow, h: oh, left, top }, view: { w: vw, h: vh, left: left + ins.l, top: top + ins.t }, ins };
};
export const splitBoxes = (style, W, H, aspect) => {
  const s = style.split, gap = W * s.gap;
  const w = Math.min((W * s.width - gap) / 2, H * s.height * aspect);
  const h = w / aspect, top = H * s.top, left0 = (W - (w * 2 + gap)) / 2;
  return [0, 1].map((i) => { const b = { w, h, top, left: left0 + i * (w + gap) }; return { outer: b, view: b, ins: { t: 0, r: 0, b: 0, l: 0, chrome: 0 } }; });
};
/** Layout of a scene's window: { outer, view, ins, full } (null for scenes without one). */
export const sceneLayout = (spec, style, scene) => {
  const { width: W, height: H } = spec;
  if (scene.type === 'clip' && (scene.frame ?? 'flat') === 'full') { const b = { w: W, h: H, left: 0, top: 0 }; return { outer: b, view: b, ins: { t: 0, r: 0, b: 0, l: 0, chrome: 0 }, full: true }; }
  if (scene.type === 'clip' || scene.type === 'image') return frameBox(style, W, H, scene.aspect);
  return null;
};
export const radiusOf = (style, W) => W * style.window.radius;
/** Where the caption band starts (under the window), or null (bottom aligned / overlaid). */
export const bandTop = (spec, style, scene) => {
  if (style.caption.placement === 'overlay') return null;
  if (scene.type === 'split') { const b = splitBoxes(style, spec.width, spec.height, scene.aspect)[0].outer; return b.top + b.h; }
  const l = sceneLayout(spec, style, scene);
  if (!l || l.full) return null;
  return l.outer.top + l.outer.h;
};
/** A caption tag's colour: the palette's, lifted to the plate's contrast when the style asks (caption.tagContrast; resolveStyle works it out). */
export const tagColorOf = (spec, style, tag) => {
  const lifted = style.captionTags;
  if (lifted) return (tag ? lifted.colors[tag] : undefined) ?? lifted.fallback;
  return (tag ? style.palette.tagColors?.[tag] : undefined) ?? style.palette.tagFallback;
};
export const accentOf = (style) => style.palette.accent;
/** The title's entrance: the scene's own `effect`, else the style's `title.enter`, else soft-blur-in. */
export const effectOf = (style, scene) => scene.effect ?? style.title?.enter ?? 'soft-blur-in';
/** Does a callout chip depend on the callout and its scene (the style has its own builder)? Then its picture is named per callout and side. */
export const chipKey = (style, index, ci, side) => (style.builders?.includes('calloutChip') ? `${side}|${index}.${ci}` : '');

/** A small tag for shell stills: changes when the shell's HTML depends on the scene (a builder that prints the tag, or a chrome bar). */
export const shellTag = (style, scene) => {
  const b = style.builders?.includes('window');
  return `${style.window.chrome?.kind ?? 'none'}${b ? `|${scene.tag ?? ''}|${scene.src ?? ''}` : ''}`;
};
/** The label a shell builder may print: the scene's tag, else the recording's file name. */
export const sceneLabel = (scene) => scene.tag ?? (scene.src ? String(scene.src).replace(/^.*\//, '').replace(/\.[^.]+$/, '') : '');

// ------------------------------------------------------------ camera mode
const FILL_BOTTOM = 0.025;   // fill mode: the caption strip ends this far (fraction of H) above the frame's bottom edge
/** "fill" or "inside" from `"fill"` or `{ "mode": "fill" }`; undefined for anything else. */
export const modeOf = (v) => { const m = typeof v === 'string' ? v : v?.mode; return m === 'fill' || m === 'inside' ? m : undefined; };
/** The mode asked for: the scene's own `camera`, else the spec's, else the style's `camera.mode`. */
export const askedMode = (spec, style, scene) => modeOf(scene?.camera) ?? modeOf(spec.camera) ?? modeOf(style.camera) ?? 'inside';
/**
 * How the camera zooms in a scene. `fill` (flat clip and image scenes of a fill-mode style): the whole
 * window grows over the background until the recording fills the frame. `inside`: the window stays put
 * and the zoom crops inside it (also every full-bleed, split and card scene).
 */
export const cameraModeOf = (spec, style, scene) => {
  const flat = scene.type === 'image' || (scene.type === 'clip' && (scene.frame ?? 'flat') !== 'full');
  return flat && askedMode(spec, style, scene) === 'fill' ? 'fill' : 'inside';
};
/** The camera at frame f of a clip or image scene: { cam (x, y, zoom), xf } where xf maps the window at rest to the screen (fill mode) or is null. */
export const cameraPose = (spec, style, scene, f, fps, ease) => {
  const cam = cameraAt(scene.moves, f, fps, ease);
  if (cameraModeOf(spec, style, scene) !== 'fill') return { cam, xf: null };
  return { cam, xf: fillTransform(cam, sceneLayout(spec, style, scene).view, spec.width, spec.height) };
};
/** Does a caption bring its own plate (so it stays readable over any recording)? Otherwise fill mode puts a scrim behind it. */
export const captionHasPlate = (style) => {
  const k = style.caption;
  return k.variant === 'pill' || k.variant === 'glass' || (k.variant === 'bar' && !!k.bar?.background);
};

/**
 * Where a caption goes: the CSS of its wrapper (positioned in canvas px) and a
 * key that goes in its piece id. `under` is the band below the window,
 * `overlay` the bottom of the window, `slot` the shell's own bottom strip.
 * `place` 'top' (see captionPlacements) lifts it to the top title-safe line
 * (caption.top), or the top of the window for an overlay caption.
 * In fill mode a full-bleed scene's caption sits where the flat scenes' do
 * (the middle of the strip under the window), so captions never jump between scenes.
 */
export const captionPos = (spec, style, scene, place = 'bottom') => {
  const { width: W, height: H } = spec, c = style.caption;
  const l = scene.type === 'split' ? splitBoxes(style, W, H, scene.aspect)[0] : sceneLayout(spec, style, scene);
  const left = c.align === 'left';
  const fillStyle = l && scene.type !== 'split' && askedMode(spec, style, scene) === 'fill';
  // top / bottom: the wrapper's edges in px from the canvas top / bottom (null: not set), for the placement estimate
  let css, key, top = null, bottom = null, padLeft = l && !l.full ? l.view.left : W * 0.05;
  if (place === 'top' && l) {
    const overlay = c.placement === 'overlay' && !l.full && !fillStyle;
    top = overlay ? l.view.top + H * c.inset : H * (c.top ?? 0.05);
    css = `left:0;right:0;top:${top}px`; key = `t${r2(top)}`;
    if (overlay) padLeft = l.view.left + W * 0.02;
  } else if (fillStyle && (l.full || c.placement === 'under')) {
    // fill mode: the middle of the strip under the window at rest (above a small bottom margin); a caption
    // taller than the strip (two lines) grows upward over the window's edge, never off the frame
    const b = l.full ? frameBox(style, W, H, scene.aspect) : l;
    top = b.outer.top + b.outer.h; bottom = H * FILL_BOTTOM;
    css = `left:0;right:0;bottom:${bottom}px;min-height:${H - bottom - top}px`; key = `f${r2(top)}`; padLeft = b.view.left;
  } else if (!l || l.full) { bottom = H * c.offset; css = `left:0;right:0;bottom:${bottom}px`; key = 'b'; }
  else if (c.placement === 'overlay') {
    bottom = H - (l.view.top + l.view.h) + H * c.inset;
    css = `left:0;right:0;bottom:${bottom}px`; key = `o${r2(l.view.top + l.view.h)}`;
    padLeft = l.view.left + W * 0.02;
  } else if (c.placement === 'slot' && l.ins.b > 0) {
    top = l.view.top + l.view.h; bottom = H - top - l.ins.b;
    css = `left:${l.outer.left}px;width:${l.outer.w}px;top:${l.view.top + l.view.h}px;height:${l.ins.b}px`; key = `s${r2(l.view.top + l.view.h)}`;
    padLeft = W * 0.012;   // relative to the strip (the wrapper already starts at outer.left)
  } else { const t = l.outer.top + l.outer.h; top = t; bottom = 0; css = `left:0;right:0;top:${t}px;bottom:0`; key = `${t}`; }
  return { css, key: `${key}${left ? 'L' : ''}`, align: left ? 'flex-start' : 'center', padLeft: left ? padLeft : 0, top, bottom };
};

// ------------------------------------------------------------ caption placement
/** The captions of a clip or image scene with the seconds each one shows: [{ cap (the timed caption, or null for scene.caption), text, tag, from, to }]. */
export const captionTimes = (scene) => {
  if (scene.type === 'clip' && scene.captions?.length) {
    const s = [...scene.captions].sort((a, b) => a.atSec - b.atSec);
    return s.map((c, i) => ({ cap: c, text: c.text, tag: c.tag ?? scene.tag, from: c.atSec, to: i + 1 < s.length ? s[i + 1].atSec : scene.durationSec }));
  }
  return has(scene.caption) ? [{ cap: null, text: scene.caption, tag: scene.tag, from: 0, to: scene.durationSec }] : [];
};
/** Where a caption was placed ('top' or 'bottom'): captionPlacements writes it on the caption (or the scene, for scene.caption). */
export const placeOf = (scene, cap) => (cap ? cap._place : scene._captionPlace) ?? 'bottom';

const ACTION_PAD = 0.06;   // the action's neighbourhood: a caption within 6 % of W / H of it counts as on top of it
const MIN_CLASH = 0.2;     // seconds: a graze shorter than this (a few frames of a camera move) does not move a caption
/**
 * Decide, once per caption, whether it moves to the top (WCAG 1.2.2: captions must not hide what
 * the viewer needs to see; broadcasters move them up when the bottom carries essential information).
 * Only captions that can sit over the recording are considered: fill mode, a full-bleed recording,
 * or the overlay placement. A caption goes to the top when, at any moment it shows, its bottom spot
 * is on or within 6 % (of W and H) of the action, and the top spot is clear more of that time.
 * The action is, in screen space under the camera: the callouts showing (ring and label), the
 * camera's focus while it is zoomed in, and `actions` from the take (clicks, typing:
 * [{ t0, t1, box: [x, y, w, h] }] in seconds of the scene and fractions of the recording).
 * Writes `_place = 'top'` on the timed caption (or `_captionPlace` on the scene). Node runs it once
 * (compose.mjs) and the page reads the result, so captured pieces sit at known places.
 */
export const captionPlacements = (spec, style, scene, actions = []) => {
  if (scene.type !== 'clip' && scene.type !== 'image') return;
  const times = captionTimes(scene);
  const lay = sceneLayout(spec, style, scene), K = style.caption;
  const fill = cameraModeOf(spec, style, scene) === 'fill';
  if (!times.length || (!fill && !lay.full && K.placement !== 'overlay') || (K.placement === 'slot' && !lay.full)) return;
  const { width: W, height: H } = spec, fps = spec.fps ?? 60, ease = makeCameraEase(style.camera?.ease), view = lay.view;
  const mx = W * ACTION_PAD, my = H * ACTION_PAD, u = W / 1920;
  const hit = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  // the caption's box at a spot, from an estimate of its size (0.52 em a character; wraps inside caption.maxWidth)
  const boxAt = (text, tag, place) => {
    const size = W * K.size, chars = stripEmphasis(text).length + (tag ? String(tag).length + 2 : 0);
    let w = chars * 0.52 * size, lines = 1;
    const maxW = K.maxWidth ? K.maxWidth * W : W * 0.9;
    if (w > maxW) { lines = Math.ceil(w / maxW); w = maxW; }
    w += 2.3 * size; const h = lines * 1.3 * size + 1.2 * size;
    const pos = captionPos(spec, style, scene, place), { top, bottom } = pos;
    const y0 = top !== null && bottom !== null ? Math.min(top + (H - bottom - top - h) / 2, H - bottom - h) : top !== null ? top : H - bottom - h;
    const x0 = K.align === 'left' ? pos.padLeft : (W - w) / 2;
    return { x0, x1: x0 + w, y0, y1: y0 + h };
  };
  const trs = [], step = 1 / 12;
  for (let t = 0; t <= scene.durationSec + 1e-6; t += step) {
    const { cam, xf } = cameraPose(spec, style, scene, t * fps, fps, ease);
    const inside = xf ? null : cameraTransform(cam, view.w, view.h);
    // recording fractions (u, v) -> screen px, and the part of the screen the recording covers
    const at = (x, y) => (xf ? [xf.tx + xf.z * (view.left + x * view.w), xf.ty + xf.z * (view.top + y * view.h)] : [view.left + inside.tx + x * view.w * inside.z, view.top + inside.ty + y * view.h * inside.z]);
    const shown = xf ? { x0: Math.max(0, xf.tx + xf.z * view.left), y0: Math.max(0, xf.ty + xf.z * view.top), x1: Math.min(W, xf.tx + xf.z * (view.left + view.w)), y1: Math.min(H, xf.ty + xf.z * (view.top + view.h)) }
      : { x0: view.left, y0: view.top, x1: view.left + view.w, y1: view.top + view.h };
    const zones = [];
    const zone = (x, y, w, h, extraTop = 0, extraBottom = 0) => {   // a box (or a point) of the recording, clipped to what shows, grown by the neighbourhood
      const [ax, ay] = at(x, y), [bx, by] = at(x + w, y + h);
      const r = { x0: Math.max(ax, shown.x0), y0: Math.max(ay - extraTop, shown.y0), x1: Math.min(bx, shown.x1), y1: Math.min(by + extraBottom, shown.y1) };
      if (r.x0 <= r.x1 && r.y0 <= r.y1) zones.push({ x0: r.x0 - mx, x1: r.x1 + mx, y0: r.y0 - my, y1: r.y1 + my });
    };
    for (const c of scene.callouts ?? []) {
      if (!c.box || c.atSec === undefined || t < c.atSec || t > c.atSec + (c.forSec ?? style.callout.forSec)) continue;
      const label = c.label ? 60 * u : 0, below = c.box[1] < 0.18;   // the label rides above the box (below it near the top)
      zone(...c.box, below ? 0 : label, below ? label : 0);
    }
    if (cam.zoom > 1.02) zone(cam.x ?? 0.5, cam.y ?? 0.5, 0, 0);
    for (const a of actions) if (t >= a.t0 && t <= a.t1) zone(...a.box);
    trs.push({ t, zones });
  }
  const report = [];
  for (const c of times) {
    const spots = { bottom: boxAt(c.text, c.tag, 'bottom'), top: boxAt(c.text, c.tag, 'top') }, n = { bottom: 0, top: 0 }, when = [];
    for (const s of trs) if (s.t >= c.from - 1e-6 && s.t <= c.to + 1e-6) for (const k of ['bottom', 'top']) if (s.zones.some((z) => hit(z, spots[k]))) { n[k]++; if (k === 'bottom') when.push(s.t); }
    const top = n.bottom * step >= MIN_CLASH - 1e-9 && n.top < n.bottom;
    if (c.cap) { if (top) c.cap._place = 'top'; else delete c.cap._place; }
    else if (top) scene._captionPlace = 'top'; else delete scene._captionPlace;
    report.push({ text: c.text, place: top ? 'top' : 'bottom', bottomSec: +(n.bottom * step).toFixed(2), topSec: +(n.top * step).toFixed(2), from: when.length ? +when[0].toFixed(2) : null, to: when.length ? +when.at(-1).toFixed(2) : null });
  }
  return report;
};

/** Size of a callout mark's picture at camera zoom 1, in output px (it is captured at 2x). */
export const markSize = (view, c, u, pad) => ({ w: c.box[2] * view.w + pad * 2 * u, h: c.box[3] * view.h + pad * 2 * u });
