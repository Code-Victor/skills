// Everything about WHERE things go, in one place shared by Node (plan.js, which
// lays out the HTML) and the page (scenes.js, which draws the textures). Every
// number comes from the style's tokens, so the two cannot disagree.
//
// Also here: the names captured pieces are stored under (`ID`), the *emphasis*
// markup, and a few small helpers.

export const has = (v) => v !== undefined && v !== null && String(v) !== '';
export const esc = (s) => (s === undefined || s === null ? '' : String(s)).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const r2 = (v) => Math.round(v * 100) / 100;
const j = (v) => JSON.stringify(v);

// ------------------------------------------------------------ ids
// A captured piece is stored under a name that includes the style's hash, so
// a token change can never hand back a stale picture.
let STYLE_HASH = '';
export const setStyleHash = (h) => { STYLE_HASH = h; };
export const ID = {
  bg: () => `bg|${STYLE_HASH}`,
  shell: (b, radius, shadow = true, tag = '') => `shell|${STYLE_HASH}|${j([b.w, b.h, b.left, b.top].map(r2))}|${r2(radius)}|${shadow ? 1 : 0}|${tag}`,
  ring: (b, radius) => `ring|${STYLE_HASH}|${j([b.w, b.h].map(r2))}|${r2(radius)}`,
  pill: (top, tag, color, text, extra = '') => `pill|${STYLE_HASH}|${top}|${tag ?? ''}|${color}|${text}|${extra}`,
  chip: (label, accent) => `chip|${STYLE_HASH}|${accent}|${label}`,
  mark: (w, h, kind) => `mark|${STYLE_HASH}|${r2(w)}|${r2(h)}|${kind}`,
  logo: (src, h) => `logo|${src}|${r2(h)}`,
  card: (i) => `scene${i}|${STYLE_HASH}|card`,
  piece: (i, name) => `scene${i}|${STYLE_HASH}|${name}`,
};

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
export const tagColorOf = (spec, style, tag) => (tag ? style.palette.tagColors?.[tag] : undefined) ?? style.palette.tagFallback;
export const accentOf = (style) => style.palette.accent;

/** A small tag for shell stills: changes when the shell's HTML depends on the scene (a builder that prints the tag, or a chrome bar). */
export const shellTag = (style, scene) => {
  const b = style.builders?.includes('window');
  return `${style.window.chrome?.kind ?? 'none'}${b ? `|${scene.tag ?? ''}|${scene.src ?? ''}` : ''}`;
};
/** The label a shell builder may print: the scene's tag, else the recording's file name. */
export const sceneLabel = (scene) => scene.tag ?? (scene.src ? String(scene.src).replace(/^.*\//, '').replace(/\.[^.]+$/, '') : '');

/**
 * Where a caption goes: the CSS of its wrapper (positioned in canvas px) and a
 * key that goes in its piece id. `under` is the band below the window,
 * `overlay` the bottom of the window, `slot` the shell's own bottom strip.
 */
export const captionPos = (spec, style, scene) => {
  const { width: W, height: H } = spec, c = style.caption;
  const l = scene.type === 'split' ? splitBoxes(style, W, H, scene.aspect)[0] : sceneLayout(spec, style, scene);
  const left = c.align === 'left';
  let css, key, padLeft = l && !l.full ? l.view.left : W * 0.05;
  if (!l || l.full) { css = `left:0;right:0;bottom:${H * c.offset}px`; key = 'b'; }
  else if (c.placement === 'overlay') {
    css = `left:0;right:0;bottom:${H - (l.view.top + l.view.h) + H * c.inset}px`; key = `o${r2(l.view.top + l.view.h)}`;
    padLeft = l.view.left + W * 0.02;
  } else if (c.placement === 'slot' && l.ins.b > 0) {
    css = `left:${l.outer.left}px;width:${l.outer.w}px;top:${l.view.top + l.view.h}px;height:${l.ins.b}px`; key = `s${r2(l.view.top + l.view.h)}`;
    padLeft = l.outer.left + W * 0.012;
  } else { const t = l.outer.top + l.outer.h; css = `left:0;right:0;top:${t}px;bottom:0`; key = `${t}`; }
  return { css, key: `${key}${left ? 'L' : ''}`, align: left ? 'flex-start' : 'center', padLeft: left ? padLeft : 0 };
};
/** Size of a callout mark's picture at camera zoom 1, in output px (it is captured at 2x). */
export const markSize = (view, c, u, pad) => ({ w: c.box[2] * view.w + pad * 2 * u, h: c.box[3] * view.h + pad * 2 * u });
