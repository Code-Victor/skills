// terminal: the video as a terminal session about the change. One mono family,
// a zinc ground with a static dot grid, text that is typed rather than faded,
// overlays that step on a 30 poses a second clock, discrete transitions (a caret
// wipe, a line repaint, a line scroll, a hard slide), corner brackets instead of
// a ring, ONE soft green accent. Extends studio, so it only names what differs.
//
// Grammar, used the same way on every scene: `>` (accent) is a prompt, `# ...`
// (muted) is a comment, a lower-case word after a path is the tag. Everything
// that is not inside a window hangs from one left edge, 0.1 W.
//
// Credit: the caret-wipe idea and its numbers (a caret that IS the wipe edge,
// 3 px bar, 0.5 of frame height) are adapted from remocn's caret-wipe (MIT,
// github.com/kapishdima/remocn); the GLSL here is written for this engine.
import { emChars, stripEmphasis, splitBoxes } from '../layout.js';

const GROUND = '#0C0D0F';
const FG = '#E7E7E4';             // 15.7:1 on the ground
const MUTED = '#8C8E93';          // 5.9:1 on the ground, 5.5:1 on the title bar
const ACCENT = '#86EFAC';         // 13.8:1 on the ground
const RED = '#F28B82';            // Before: 8.1:1 on the ground, 7.6:1 on the title bar
const PANEL = '#101113';          // window / card fill
const BAR = '#15161A';            // title bar fill
const HAIR = 'rgba(255,255,255,0.14)';
const RULE = 'rgba(255,255,255,0.08)';
const EDGE = 0.1;                 // the left edge everything outside a window hangs from (fraction of W)
const BAR_H = 48;                 // the window title bar, u (also window.insets[0])
const NOLIG = 'font-variant-ligatures:none;font-feature-settings:"liga" 0,"calt" 0;';

const lc = (s) => String(s ?? '').toLowerCase();
// The tag rule (Before red, After accent, others muted) lives in palette.mapTag and palette.tagColors;
// builders only look the colour up (exact name first, then any case), never map again.
const tagColor = (c, label) => {
  const t = c.style.palette.tagColors ?? {};
  const k = label in t ? label : Object.keys(t).find((x) => lc(x) === lc(label));
  return k ? t[k] : c.style.palette.tagFallback;
};

/** The slim title bar: three muted dots, a path and the tag as a lower-case word in its colour. */
const bar = (c, h, path, label, fs = 22) => {
  const u = c.u;
  const dots = [0, 1, 2].map(() => `<i style="display:block;width:${10 * u}px;height:${10 * u}px;border-radius:50%;background:rgba(255,255,255,0.2)"></i>`).join('');
  return `<div style="position:absolute;left:0;top:0;right:0;height:${h}px;background:${BAR};border-bottom:1px solid ${RULE};display:flex;align-items:center;gap:${22 * u}px;padding:0 ${18 * u}px;font-family:${c.font('mono')};font-size:${fs * u}px;line-height:1;white-space:nowrap;${NOLIG}">
    <div style="display:flex;gap:${8 * u}px">${dots}</div>
    <div style="display:flex;gap:${14 * u}px"><span style="color:${MUTED}">${c.esc(path)}</span>${label ? `<span style="color:${tagColor(c, label)};font-weight:500">${c.esc(lc(label))}</span>` : ''}</div></div>`;
};

// ------------------------------------------------------------ window
const windowBuilder = (c) => {
  const h = c.insets?.t ?? 0;
  if (!h) return { html: '' };
  return { html: bar(c, h, '~/app', c.label) };
};

// ------------------------------------------------------------ caption
// Wraps inside caption.maxWidth and types line by line. The prompt (and, on a full-bleed clip, which has
// no title bar, the tag) are flex items on line one; the text is the last flex item, so line two hangs
// under its first letter. Nothing is drawn behind the text: the type entrance clips the whole picture at
// the caret, so a box would grow with the typing. A full-bleed clip gets caption.scrim instead and the
// caption moves to the common left edge; a split's caption sits just under its two windows.
const captionBuilder = (c) => {
  const { W, H, u, scene } = c, size = c.size;
  const full = scene.type === 'clip' && (scene.frame ?? 'flat') === 'full';
  let css = c.pos.css, pad = c.pos.padLeft, align = 'center';
  if (full) pad = W * EDGE;
  if (scene.type === 'split') { const b = splitBoxes(c.style, W, H, scene.aspect)[0].outer; css = `left:0;right:0;top:${b.top + b.h + 40 * u}px`; align = 'flex-start'; }
  const tag = full && c.tag ? `<span style="color:${c.color};flex:none">${c.esc(lc(c.tag))}</span>` : '';
  return { html: `<div style="position:absolute;${css};display:flex;align-items:${align};justify-content:${c.pos.align};padding-left:${pad}px">
    <div id="pill" style="display:inline-flex;align-items:baseline;gap:${size * 0.6}px;max-width:${W * (c.style.caption.maxWidth ?? 0.64)}px;font-family:${c.font('mono')};font-size:${size}px;font-weight:500;line-height:1.35;color:${FG};${NOLIG}">
      ${tag}<span style="color:${c.accent};font-weight:700;flex:none">&gt;</span><span data-type style="min-width:0;white-space:normal">${c.rich(c.text)}</span></div></div>` };
};

// ------------------------------------------------------------ title
// The comment line (the subtitle, muted, `# ...`) sits above the title. `type` (the default) is ONE
// wrapped piece the engine types across its lines, the caret moving line to line and resting after the
// last character; `lines` prints it a line at a time. A scene that names another effect gets a stepped
// version of it: soft-blur-in types glyph by glyph (no caret), word-push and micro-scale-fade cut the
// whole block in on the clock.
const titleBuilder = (c) => {
  const { W, scene } = c;
  const effect = c.effect ?? scene.effect ?? 'type';
  const len = Array.from(stripEmphasis(scene.text ?? '')).length;
  const maxW = W * (c.style.title.maxWidth ?? 0.78);
  // as big as one line allows (0.59 em a glyph at this tracking), else two lines at 0.044 W, else 0.037 W
  const one = (maxW * 0.97) / (0.59 * Math.max(1, len));
  const size = one >= W * 0.044 ? Math.min(W * 0.056, one) : len <= 54 ? W * 0.044 : W * 0.037;
  const sub = c.has(scene.subtitle) ? `<div data-p="sub" data-pad="8" style="font-size:${W * 0.0156}px;line-height:1.4;margin-bottom:${W * 0.014}px;color:${MUTED};max-width:${maxW}px"># ${c.rich(scene.subtitle)}</div>` : '';
  const block = (inner) => `<div style="max-width:${maxW}px;font-size:${size}px;font-weight:700;letter-spacing:-0.01em;line-height:${c.style.title.lineHeight ?? 1.18};color:${FG}">${inner}</div>`;
  let body = '';
  if (!c.has(scene.text)) body = '';
  else if (effect === 'type' || effect === 'lines') body = block(`<span data-p="all" data-pad="12" data-type style="display:block;white-space:normal">${c.rich(scene.text)}</span>`);
  else if (effect === 'soft-blur-in') {
    const chars = emChars(scene.text);
    let k = 0, words = [], cur = [];
    for (const ch of chars) { cur.push([ch.c, k, ch.em]); k++; if (ch.c === ' ') { words.push(cur); cur = []; } }
    if (cur.length) words.push(cur);
    body = block(words.map((w) => `<span style="white-space:nowrap">${w.map(([ch, i, e]) => `<span ${ch.trim() ? `data-p="c${i}" data-pad="10" ` : ''}style="${e ? `color:${c.accent};` : ''}display:inline-block;white-space:pre">${c.esc(ch)}</span>`).join('')}</span>`).join(''));
  } else {
    // word-push / micro-scale-fade: the first piece holds the whole title, the rest are 1 px stubs the reveal needs
    const names = effect === 'word-push' ? String(stripEmphasis(scene.text)).split(/\s+/).filter(Boolean).map((_, k) => `w${k}`) : ['all'];
    body = block(`<span data-p="${names[0]}" data-pad="12" style="display:block;white-space:normal">${c.rich(scene.text)}</span>`) + names.slice(1).map((n) => `<i data-p="${n}" data-pad="2" style="position:absolute;left:0;top:0;width:1px;height:1px"></i>`).join('');
  }
  return { html: `<div class="af" style="justify-content:center;padding-left:${W * EDGE}px;font-family:${c.font('mono')};${NOLIG}"><div style="position:relative">${sub}${body}</div></div>` };
};

// ------------------------------------------------------------ issue card
// A terminal pane on the common left edge, about three quarters of the width: the command, then
// key / value rows, the quote with a Before-red bar, the reporter. No text smaller than a caption.
const issueBuilder = (c) => {
  const { scene, u, W } = c, k = c.style.card;
  const key = (t) => `<span style="color:${MUTED};font-size:${30 * u}px">${t}</span>`;
  const val = (t, extra = '') => `<span style="font-size:${40 * u}px;line-height:1.3;color:${FG};${extra}">${t}</span>`;
  const rows = [];
  if (c.has(scene.source)) rows.push(key('source') + val(c.esc(scene.source)));
  if (c.has(scene.status)) rows.push(key('status') + val(`<i style="display:inline-block;width:${14 * u}px;height:${14 * u}px;border-radius:50%;background:${c.accent};margin-right:${16 * u}px;vertical-align:0.12em"></i>${c.esc(scene.status)}`, `color:${c.accent}`));
  if (c.has(scene.title)) rows.push(key('title') + val(c.rich(scene.title), 'font-weight:700'));
  const reporter = c.has(scene.reporter) ? String(scene.reporter).replace(/^reported by\s+/i, '') : '';
  const grid = `display:grid;grid-template-columns:${200 * u}px 1fr;column-gap:${12 * u}px;row-gap:${14 * u}px;align-items:baseline`;
  const bh = 56 * u;
  const html = `<div class="af" style="align-items:flex-start;justify-content:center;padding-left:${W * EDGE}px;font-family:${c.font('mono')};${NOLIG}">
    <div id="card" style="position:relative;width:${k.width * u}px;border-radius:${W * 0.004}px;background:${PANEL};box-shadow:inset 0 0 0 1px ${HAIR},0 12px 32px rgba(0,0,0,0.5);overflow:hidden;padding-top:${bh}px">
      ${bar(c, bh, `~/issues/${scene.id ?? ''}`, '', 26)}
      <div style="padding:${44 * u}px ${56 * u}px ${56 * u}px;display:flex;flex-direction:column;gap:${36 * u}px">
        <div style="font-size:${32 * u}px;color:${FG}"><span style="color:${c.accent};font-weight:700">&gt;</span> issue show ${c.esc(scene.id ?? '')}</div>
        ${rows.length ? `<div class="piece" data-p="title" data-pad="6" style="${grid}">${rows.join('')}</div>` : ''}
        ${c.has(scene.quote) ? `<div class="piece" data-p="quote" data-pad="6" style="border-left:${4 * u}px solid ${tagColor(c, 'Before')};padding-left:${28 * u}px;font-size:${36 * u}px;line-height:1.45;color:${FG}">“${c.rich(scene.quote)}”</div>` : ''}
        ${reporter ? `<div class="piece" data-p="reporter" data-pad="6" style="${grid}">${key('reporter')}${val(c.esc(reporter), `color:${MUTED}`)}</div>` : ''}
      </div></div></div>`;
  return { html };
};

// ------------------------------------------------------------ list
// Like the title: the comment line above, the heading under it, then the lines print one by one with
// accent checks (a long one wraps under its own first letter). After the last one the prompt returns and types a muted `# 3 changes`; the caret rests
// there, blinking, until the video ends.
const listBuilder = (c) => {
  const { scene, u, W } = c, k = c.style.list, M = c.style.motion.list;
  const items = scene.items ?? [];
  const check = `<svg width="${40 * u}" height="${40 * u}" viewBox="0 0 24 24" style="flex-shrink:0;margin-top:${(k.itemSize * 1.3 - 40) / 2 * u}px"><path d="M4.5 12.8l5 4.7L19.5 6.8" fill="none" stroke="${c.accent}" stroke-width="2.6" stroke-linecap="square"/></svg>`;
  const head = c.has(scene.title) || c.has(scene.subtitle) ? `<div data-p="head" data-pad="6">
      ${c.has(scene.subtitle) ? `<div style="font-size:${32 * u}px;line-height:1.4;color:${MUTED};${c.has(scene.title) ? `margin-bottom:${16 * u}px;` : ''}"># ${c.rich(scene.subtitle)}</div>` : ''}
      ${c.has(scene.title) ? `<div style="font-size:${k.titleSize * u}px;font-weight:700;color:${FG};line-height:1.15;letter-spacing:-0.01em">${c.rich(scene.title)}</div>` : ''}</div>` : '<div></div>';
  const n = items.length;
  const summary = n ? `<div data-p="done" data-pad="8" style="display:flex;gap:${20 * u}px;align-items:baseline;margin-top:${14 * u}px;font-size:${36 * u}px;white-space:nowrap"><span style="color:${c.accent};font-weight:700">&gt;</span><span data-type style="color:${MUTED}"># ${n} ${n === 1 ? 'change' : 'changes'}</span></div>` : '';
  return { html: `<div class="af" style="justify-content:center;padding-left:${W * EDGE}px;font-family:${c.font('mono')};${NOLIG}">
    <div style="display:flex;flex-direction:column;gap:${k.gap * u}px">${head}
      <div style="display:flex;flex-direction:column;gap:${k.itemGap * u}px">
        ${items.map((it, i) => `<div data-p="i${i}" data-pad="6" style="display:flex;align-items:flex-start;gap:${20 * u}px;max-width:${W * 0.8}px;font-size:${k.itemSize * u}px;line-height:1.3;font-weight:500;color:${FG}">${check}<span>${c.rich(it)}</span></div>`).join('')}
        ${summary}
      </div></div></div>`,
    pieces: n ? { done: { at: M.start + n * M.step + 0.25, enter: 'type', cps: 30, caret: 'block' } } : undefined };
};

// ------------------------------------------------------------ split bars
// A split's two windows get the same title bar as a clip's (dots, ~/app, the tag in its colour), drawn on
// the scene's background layer just above each box; the bar runs a little under the box so its rounded
// top corners show bar colour, not ground. The engine's own split labels are switched off (split.labelSize 0):
// they cannot be restyled, so the tag lives in the bar.
const furnitureBuilder = (c) => {
  if (c.sceneType !== 'split') return null;
  const u = c.u, h = BAR_H * u, under = 16 * u, r = c.W * c.style.window.radius, sc = c.scene;
  const labels = [sc.before?.label ?? 'Before', sc.after?.label ?? 'After'];
  return { html: splitBoxes(c.style, c.W, c.H, sc.aspect).map(({ outer: b }, i) => `<div style="position:absolute;left:${b.left}px;top:${b.top - h}px;width:${b.w}px;height:${h + under}px;background:${BAR};border-radius:${r}px ${r}px 0 0;box-shadow:inset 0 0 0 1px ${HAIR};overflow:hidden">${bar(c, h, '~/app', c.has(labels[i]) ? labels[i] : '')}</div>`).join('') };
};

// ------------------------------------------------------------ callouts
const chipBuilder = (c) => {
  const k = c.style.callout.chip, s = c.s;
  return { html: `<div id="chip" style="position:absolute;left:20px;top:20px;padding:${k.padY * s}px ${k.padX * s}px;background:${GROUND};box-shadow:inset 0 0 0 1px ${c.accent};color:${FG};font-family:${c.font('mono')};font-size:${k.size * s}px;font-weight:500;line-height:1.2;white-space:nowrap;${NOLIG}">${c.rich(c.label, 'inherit')}</div>` };
};
/** Four L-shaped corners that draw out in three steps, then hold. */
const markBuilder = (c) => {
  const { w, h, u } = c, s = 5 * u, o = s;   // o: room for the dark outline under the stroke
  const full = Math.min(Math.min(w, h) * 0.32, 64 * u);
  const svg = (f) => {
    const L = Math.max(s * 2, full * f);
    const d = `M${o} ${o + L}V${o}H${o + L} M${w - o - L} ${o}H${w - o}V${o + L} M${w - o} ${h - o - L}V${h - o}H${w - o - L} M${o + L} ${h - o}H${o}V${h - o - L}`;
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="position:absolute;left:0;top:0"><path d="${d}" fill="none" stroke="${GROUND}" stroke-opacity="0.85" stroke-width="${s * 2}" stroke-linecap="square"/><path d="${d}" fill="none" stroke="${c.accent}" stroke-width="${s}" stroke-linecap="square"/></svg>`;
  };
  const poses = [0.3, 0.65, 1].map(svg);
  return { html: poses[2], poses };
};

// ------------------------------------------------------------ transitions
// All are hard-edged and stepped on the 30-pose clock: no blur, no scale, no brightening.
const ROWS = `float rowH = 54. * uRes.x / 1920.;`;
const EASE = `float e = p < .5 ? 4. * p * p * p : 1. - pow(-2. * p + 2., 3.) / 2.;`;
const CARET = `
vec4 transition(vec2 uv){
  float p = uProgress;
  ${EASE}
  float x = floor(e * 96. + .0001) / 96.;                 // the edge snaps to a column grid
  vec4 c = uv.x < x ? getTo(uv) : getFrom(uv);
  float px = uv.x * uRes.x, ex = x * uRes.x, d = px - ex;
  float line = step(0., d) * step(d, max(2., uRes.x / 640.));
  float block = step(abs(uv.y - .5), .16) * step(0., d) * step(d, uRes.x / 200.);
  float on = step(.001, p) * step(p, .999);
  float k = max(line * .8, block) * on;
  return c * (1. - k) + vec4(uPal[2], 1.) * k;             // hard edge, no blur
}`;
const REPAINT = `
vec4 transition(vec2 uv){
  ${ROWS}
  float rows = ceil(uRes.y / rowH), r = floor(uv.y * uRes.y / rowH);
  float t = r / rows * .72 + .06;                          // the moment this line is repainted
  vec4 c = uProgress >= t ? getTo(uv) : getFrom(uv);
  float fresh = step(t, uProgress) * step(uProgress, t + .08);
  float rule = step(1. - 2. / rowH, fract(uv.y * uRes.y / rowH));
  float k = fresh * rule * .85;
  return c * (1. - k) + vec4(uPal[2], 1.) * k;
}`;
const SCROLL = `
vec4 transition(vec2 uv){
  ${ROWS}
  float n = ceil(uRes.y / rowH), p = uProgress;
  ${EASE}
  float s = floor(e * n) / n, seam = 1. - s;               // whole lines at a time
  vec4 c = uv.y < seam ? getFrom(vec2(uv.x, uv.y + s)) : getTo(vec2(uv.x, uv.y - seam));
  float k = step(abs(uv.y - seam) * uRes.y, 1.5) * step(.001, s) * step(s, .999) * .85;
  return c * (1. - k) + vec4(uPal[2], 1.) * k;
}`;
// whip-pan: both scenes slide together by whole columns along the transition's direction (uDir), with a
// 1.5 px accent seam between them; no blur, no stretch.
const SLIDE = `
vec4 transition(vec2 uv){
  float p = uProgress;
  ${EASE}
  float s = floor(e * 48. + .0001) / 48.;
  vec2 a = uv - uDir * s, b = uv + uDir * (1. - s);
  vec4 c = vec4(0.);
  if (all(greaterThanEqual(a, vec2(0.))) && all(lessThanEqual(a, vec2(1.)))) c = getFrom(a);
  if (all(greaterThanEqual(b, vec2(0.))) && all(lessThanEqual(b, vec2(1.)))) c = getTo(b);
  vec2 ax = abs(uDir);
  float along = dot(uv, ax), edge = (uDir.x + uDir.y) > 0. ? s : 1. - s;
  float k = step(abs(along - edge) * dot(uRes, ax), 1.5) * step(.001, s) * step(s, .999) * .85;
  return c * (1. - k) + vec4(uPal[2], 1.) * k;
}`;

// fade: a crossfade of the two scenes' content, stepped on the clock. (The engine's own fade keeps the outgoing
// scene opaque until the end, which over the shared ground double-exposes a full-bleed clip and then pops it off.)
const FADE = `
vec4 transition(vec2 uv){ return mix(getFrom(uv), getTo(uv), uProgress); }`;

export default {
  name: 'terminal',
  extends: 'studio',
  description: 'A terminal session about the change: mono type, zinc dot grid, typed text, stepped motion, a caret wipe. Named transitions are terminal moves here on purpose: zoom-blur is a caret wipe, focus-pull a line repaint, push-through a line scroll, whip-pan a hard slide, fade a stepped crossfade; a blurred zoom has no place in this world.',
  suits: 'Developer tools and pull-request demos watched by engineers.',

  palette: {
    background: GROUND, foreground: FG, accent: ACCENT, onAccent: GROUND,
    tagColors: { Before: RED, After: ACCENT, Tour: MUTED, Compare: MUTED },
    tagFallback: MUTED, danger: RED,
    // one accent whatever a spec brings, and the tag rule: Before soft red, After the accent, anything else muted
    mapAccent: () => ACCENT,
    mapTag: (name, colour, t) => (/^before$/i.test(name) ? RED : /^after$/i.test(name) ? t.palette.accent : MUTED),
  },
  fonts: {
    text: { family: 'JetBrains Mono', weights: [400, 500, 700], fallback: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" },
    display: { family: 'JetBrains Mono', weights: [400, 500, 700], fallback: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" },
    mono: { family: 'JetBrains Mono', weights: [400, 500, 700], fallback: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" },
  },
  // a dark logo turns light and monochrome, keeping its inner detail (a light logo would go dark: override logo.filter to null)
  logo: { filter: 'grayscale(1) invert(1) brightness(1.15)' },

  canvas: {
    matte: GROUND, model: 'shared',
    background: { kind: 'shader', shader: 'dots', colors: [GROUND, '#FFFFFF'], spacing: 26, radius: 1.2, drift: 0, fade: 0.85, opacity: 0.16, gradient: 0 },
  },
  post: { dither: 2.5, grain: 0, vignette: 0.4, vignetteSoftness: 0.65 },

  window: {
    maxWidth: 0.9, top: 0.045, maxHeight: 0.78,   // a 190 px band under the window: room for a two-line caption
    radius: 0.004, fill: PANEL, shadow: '0 10px 28px rgba(0,0,0,0.5)', shadowPad: 60,
    border: { width: 1, color: HAIR }, highlight: null, insets: [BAR_H, 0, 0, 0], chrome: { kind: 'none' }, drift: null,
  },
  split: { top: 0.2, labelSize: 0 },       // the tags are in the bars the furniture draws; bars, windows and caption sit as one group

  caption: {
    variant: 'mono', placement: 'under', align: 'left', size: 0.0155,
    enter: 'type', typeCps: 50, caret: 'block', delay: 0.4, exit: 0.05, maxWidth: 0.64,   // 0.64 W: no wider than a 16:10 window
    color: FG, weight: 500,
    scrim: { height: 0.36, color: GROUND, opacity: 0.95 },   // only under a full-bleed clip's caption (placement is "under"); text 7:1 or better over a white page
  },
  title: {
    enter: 'type', maxEnterSec: 1.4, typeCps: 30, caret: 'block', maxWidth: 0.78, lineHeight: 1.18, measure: 'glyph',
    subtitleEnter: 'fade', subtitleOpacity: 1, tracking: { type: -0.01, lines: -0.01 },
    lines: { stagger: 0.12, sec: 1 / 30, rise: 0, fade: false },   // `lines` prints the title a line at a time
  },
  card: { width: 1400, shadowPad: 40, rowEnter: 'fade' },
  list: { itemEnter: 'fade', titleSize: 64, itemSize: 44, gap: 44, itemGap: 26 },

  callout: {
    mark: 'brackets', pad: 10, radius: 3, dimAlpha: 0.6, dimColor: GROUND, scaleIn: 0.98, enterSec: 0.2, exitSec: 0.1,
    chip: { size: 22, weight: 500, padY: 8, padX: 14, radius: 0 },
    // annotations: the accent as the pen (a dark casing keeps it 3:1 on a white page), a mono comment typed on a panel; `bracket` keeps the corner brackets
    builderStyles: ['bracket'],
    ink: { width: 3.6, casing: 'auto', casingDark: GROUND },
    arrow: { width: 3.2, head: 14, bow: 0.16 },
    label: { font: 'mono', size: 24, weight: 500, lineHeight: 1.25, em: 0.6, prefix: '# ', prefixColor: MUTED, color: FG, ligatures: false, padX: 14, padY: 7,
      enter: 'type', cps: 50, plate: { background: 'rgba(12,13,15,0.94)', radius: 0, shadow: null, border: HAIR } },
  },

  motion: {
    spring: { damping: 90, stiffness: 2000, mass: 1 },          // critically damped and quick: a few steps, no overshoot
    clock: { poses: 30, seed: 1, jitterPx: 0, jitterDeg: 0 },    // overlays at 30 poses a second, no jitter
    poseRate: 15,
    card: { rise: 0, rows: [0.5, 1.0, 1.5], alpha: [1, 1, 1] },
    list: { headRise: 0, start: 0.5, step: 0.3, dx: 0 },
    split: { stagger: 4, rise: 0 },
    text: {
      softBlur: { staggerSec: 1 / 30, sec: 1 / 30, riseSec: 1 / 30, rise: 0, blur: 0, ease: [0, 0, 1, 1] },
      microScale: { sec: 1 / 30, from: 1, ease: [0, 0, 1, 1] },
      wordPush: { revealSec: 1 / 30, slideSec: 0.001, over: 0, char: 0.5, space: 0, gapSec: 0.1, accel: 0.9 },
      subtitle: { from: 0.05, to: 0.1, rise: 0 },
    },
  },
  camera: { mode: 'inside', ease: { type: 'spring', stiffness: 400, damping: 52, mass: 1 }, motionBlur: null },   // inside: the terminal window stays put, the zoom crops in it

  transition: {
    default: 'caret-wipe', sec: 0.5, stepped: true,
    // every named transition is replaced below (only `cut` is the engine's); these keep the built-in versions sharp if an override removes an alias
    params: { zoomBlur: { scaleIn: 1, scaleOut: 1, sigma: 0 }, focusPull: { bright: 1, brightIn: 1, sigma: 0, scaleOut: 1, scaleIn: 1 }, pushThrough: { scale: 1, scaleIn: 1, settle: 1, sigma: 0 }, whipPan: { travel: 1, stretch: 0, blur: 0 } },
    custom: {
      'caret-wipe': { sec: 0.5, stepped: true, glsl: CARET },
      // every named transition becomes a terminal move, so a spec that names one still looks like this style
      'zoom-blur': { sec: 0.5, stepped: true, glsl: CARET },
      'focus-pull': { sec: 0.5, stepped: true, glsl: REPAINT },
      'push-through': { sec: 0.5, stepped: true, glsl: SCROLL },
      'whip-pan': { sec: 0.5, stepped: true, glsl: SLIDE },
      fade: { sec: 0.5, stepped: true, glsl: FADE },
    },
  },

  build: { furniture: furnitureBuilder, window: windowBuilder, caption: captionBuilder, title: titleBuilder, issue: issueBuilder, list: listBuilder, calloutChip: chipBuilder, calloutMark: markBuilder },
};
