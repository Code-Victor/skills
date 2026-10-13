// terminal: the video as a terminal session about the change. One mono family,
// a zinc ground with a static dot grid, text that is typed rather than faded,
// overlays that step on a 30 poses a second clock, discrete transitions (a caret
// wipe, a line repaint, a line scroll), corner brackets instead of a ring, ONE
// soft green accent. Extends studio, so it only names what differs.
//
// Credit: the caret-wipe idea and its numbers (a caret that IS the wipe edge,
// 3 px bar, 0.5 of frame height) are adapted from remocn's caret-wipe (MIT,
// github.com/kapishdima/remocn); the GLSL here is written for this engine.
import { emChars, emWords, stripEmphasis, sceneLayout, parseEmphasis } from '../layout.js';

const GROUND = '#0C0D0F';
const FG = '#E7E7E4';
const MUTED = '#8C8E93';          // 6.2:1 on the ground
const ACCENT = '#86EFAC';
const RED = '#F28B82';            // Before
const PANEL = '#101113';          // window / card fill
const BAR = '#15161A';            // title bar fill
const HAIR = 'rgba(255,255,255,0.14)';
const RULE = 'rgba(255,255,255,0.08)';
const MONO_ADV = 0.6;             // JetBrains Mono advance in em
const NOLIG = 'font-variant-ligatures:none;font-feature-settings:"liga" 0,"calt" 0;';

const lc = (s) => String(s ?? '').toLowerCase();
const tagColor = (c, label) => {
  const t = c.style.palette.tagColors ?? {};
  const k = Object.keys(t).find((x) => lc(x) === lc(label));
  return k ? t[k] : MUTED;
};

/** The slim title bar: three muted dots and a path label; the tag lives here. */
const bar = (c, h, path, label) => {
  const u = c.u;
  const dots = [0, 1, 2].map(() => `<i style="display:block;width:${10 * u}px;height:${10 * u}px;border-radius:50%;background:rgba(255,255,255,0.2)"></i>`).join('');
  return `<div style="position:absolute;left:0;top:0;right:0;height:${h}px;background:${BAR};border-bottom:1px solid ${RULE};display:flex;align-items:center;gap:${22 * u}px;padding:0 ${18 * u}px;font-family:${c.font('mono')};font-size:${22 * u}px;line-height:1;white-space:nowrap;${NOLIG}">
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
const captionBuilder = (c) => {
  const { W, u, scene, style } = c, p = c.pos;
  const full = scene.type === 'clip' && (scene.frame ?? 'flat') === 'full';
  const len = stripEmphasis(c.text).length + 2;
  const avail = W - p.padLeft - W * 0.05 - (full ? 60 * u : 0);
  const size = Math.max(W * 0.0115, Math.min(c.size, avail / (MONO_ADV * len)));
  // over a full-bleed recording the line sits on its own dark strip so it reads on a bright page
  const box = full ? `padding:${size * 0.5}px ${size * 0.8}px;background:rgba(12,13,15,0.94);box-shadow:inset 0 0 0 1px ${HAIR};border-radius:${W * 0.004}px;` : '';
  return { html: `<div style="position:absolute;${p.css};display:flex;align-items:center;justify-content:${p.align};padding-left:${p.padLeft}px">
    <div id="pill" style="display:inline-flex;align-items:baseline;gap:${size * 0.6}px;${box}font-family:${c.font('mono')};font-size:${size}px;font-weight:500;line-height:1.3;color:${FG};white-space:nowrap;${NOLIG}">
      <span style="color:${c.accent};font-weight:700">&gt;</span><span data-type>${c.rich(c.text)}</span></div></div>` };
};

// ------------------------------------------------------------ title
// The typed title: the big line is the engine's `sub` piece (the only title piece with the
// `type` entrance and a blinking caret), and the muted comment line rides in the piece the
// reveal draws first (c0 / w0 / all), the rest being 1 px stubs the engine insists on.
// A title too long for one line falls back to wrapped glyph pieces that step on.
const titleBuilder = (c) => {
  const { W, scene } = c, u = c.u;
  const effect = scene.effect ?? 'soft-blur-in';
  const text = stripEmphasis(scene.text ?? ''), len = Array.from(text).length;
  const left = W * 0.1;
  const cSize = W * 0.0145;
  const comment = c.has(scene.subtitle) ? `<span style="color:${MUTED}"># ${c.rich(scene.subtitle, MUTED)}</span>` : '';
  const fit = Math.min(W * 0.056, (W * 0.8) / (MONO_ADV * Math.max(1, len + 1)));
  const wrap = (inner) => `<div class="af" style="justify-content:center;padding-left:${left}px;font-family:${c.font('mono')};${NOLIG}">${inner}</div>`;
  const stub = (name) => `<i data-p="${name}" data-pad="2" style="position:absolute;left:0;top:0;width:1px;height:1px"></i>`;

  if (c.has(scene.text) && c.has(scene.subtitle) && fit >= W * 0.034) {
    const first = effect === 'word-push' ? 'w0' : effect === 'micro-scale-fade' ? 'all' : `c${emChars(scene.text).findIndex((x) => x.c.trim())}`;
    let names;
    if (effect === 'word-push') names = emWords(scene.text).map((_, k) => `w${k}`);
    else if (effect === 'micro-scale-fade') names = ['all'];
    else names = emChars(scene.text).map((x, k) => (x.c.trim() ? `c${k}` : null)).filter(Boolean);
    const holder = `<div data-p="${first}" data-pad="8" style="font-size:${cSize}px;line-height:1.4;margin-bottom:${W * 0.012}px;white-space:nowrap">${comment}</div>`;
    return { html: wrap(`<div style="position:relative">
      ${holder}${names.filter((n) => n !== first).map(stub).join('')}
      <div data-p="sub" data-pad="14" style="font-size:${fit}px;font-weight:700;letter-spacing:-0.01em;line-height:1.2;color:${FG};white-space:nowrap"><span data-type>${c.rich(scene.text)}</span></div></div>`) };
  }

  // fallback: wrapped, glyph pieces step on (no moving caret: the engine types one line only)
  const size = Math.min(W * 0.044, fit * 1.0 > W * 0.02 ? W * 0.044 : W * 0.03);
  const col = (em) => (em ? `color:${c.accent};` : '');
  let inner;
  if (effect === 'word-push') inner = emWords(scene.text).map((w, k) => `<span data-p="w${k}" data-pad="10" style="${col(w.em)}display:inline-block;white-space:pre;margin-right:0.6em">${c.esc(w.w)}</span>`).join('');
  else if (effect === 'micro-scale-fade') inner = `<span data-p="all" data-pad="10" style="display:inline-block">${c.rich(scene.text)}</span>`;
  else {
    const chars = emChars(scene.text);
    let k = 0, words = [], cur = [];
    for (const ch of chars) { cur.push([ch, k++]); if (ch.c === ' ') { words.push(cur); cur = []; } }
    if (cur.length) words.push(cur);
    inner = words.map((w) => `<span style="white-space:nowrap">${w.map(([ch, i]) => `<span ${ch.c.trim() ? `data-p="c${i}" data-pad="10" ` : ''}style="${col(ch.em)}display:inline-block;white-space:pre">${c.esc(ch.c)}</span>`).join('')}</span>`).join('');
  }
  const sub = c.has(scene.subtitle) ? `<div data-p="sub" data-pad="12" style="font-size:${cSize}px;line-height:1.4;margin-bottom:${W * 0.012}px;white-space:nowrap"><span data-type style="color:${MUTED}"># ${c.esc(stripEmphasis(scene.subtitle))}</span></div>` : '';
  return { html: wrap(`<div style="max-width:${W * 0.8}px">${sub}<div style="font-size:${size}px;font-weight:700;letter-spacing:-0.01em;line-height:1.25;color:${FG}">${inner}</div></div>`) };
};

// ------------------------------------------------------------ issue card
const issueBuilder = (c) => {
  const { scene, u } = c, k = c.style.card;
  const key = (t) => `<span style="color:${MUTED};font-size:${22 * u}px;line-height:${42 * u}px">${t}</span>`;
  const val = (t, extra = '') => `<span style="font-size:${32 * u}px;line-height:1.35;color:${FG};${extra}">${t}</span>`;
  const rows = [];
  if (c.has(scene.source)) rows.push(key('source') + val(c.esc(scene.source)));
  if (c.has(scene.status)) rows.push(key('status') + val(`<i style="display:inline-block;width:${12 * u}px;height:${12 * u}px;border-radius:50%;background:${c.accent};margin-right:${14 * u}px"></i>${c.esc(scene.status)}`, `color:${c.accent}`));
  if (c.has(scene.title)) rows.push(key('title') + val(c.rich(scene.title), 'font-weight:700'));
  const reporter = c.has(scene.reporter) ? String(scene.reporter).replace(/^reported by\s+/i, '') : '';
  const grid = `display:grid;grid-template-columns:${128 * u}px 1fr;column-gap:${12 * u}px;row-gap:${6 * u}px;align-items:baseline`;
  const html = `<div class="af" style="align-items:center;justify-content:center;font-family:${c.font('mono')};${NOLIG}">
    <div id="card" style="position:relative;width:${k.width * u}px;border-radius:${c.W * 0.004}px;background:${PANEL};box-shadow:inset 0 0 0 1px ${HAIR},0 12px 32px rgba(0,0,0,0.5);overflow:hidden;padding-top:${52 * u}px">
      ${bar(c, 52 * u, `~/issues/${scene.id ?? ''}`, '')}
      <div style="padding:${34 * u}px ${44 * u}px ${44 * u}px;display:flex;flex-direction:column;gap:${26 * u}px">
        <div style="font-size:${26 * u}px;color:${FG}"><span style="color:${c.accent};font-weight:700">&gt;</span> issue show ${c.esc(scene.id ?? '')}</div>
        ${rows.length ? `<div class="piece" data-p="title" data-pad="6" style="${grid}">${rows.join('')}</div>` : ''}
        ${c.has(scene.quote) ? `<div class="piece" data-p="quote" data-pad="6" style="border-left:${3 * u}px solid ${RED};padding-left:${24 * u}px;font-size:${30 * u}px;line-height:1.5;color:${FG}">“${c.rich(scene.quote)}”</div>` : ''}
        ${reporter ? `<div class="piece" data-p="reporter" data-pad="6" style="${grid}">${key('reporter')}${val(c.esc(reporter), `color:${MUTED}`)}</div>` : ''}
      </div></div></div>`;
  return { html };
};

// ------------------------------------------------------------ list
const listBuilder = (c) => {
  const { scene, u, W } = c, k = c.style.list;
  const check = `<svg width="${30 * u}" height="${30 * u}" viewBox="0 0 24 24" style="flex-shrink:0"><path d="M4.5 12.8l5 4.7L19.5 6.8" fill="none" stroke="${c.accent}" stroke-width="2.6" stroke-linecap="square"/></svg>`;
  const head = c.has(scene.title) || c.has(scene.subtitle) ? `<div data-p="head" data-pad="6">
      ${c.has(scene.title) ? `<div style="font-size:${k.titleSize * 0.8 * u}px;font-weight:700;color:${FG};line-height:1.2;letter-spacing:-0.01em"><span style="color:${MUTED}"># </span>${c.rich(scene.title)}</div>` : ''}
      ${c.has(scene.subtitle) ? `<div style="margin-top:${10 * u}px;font-size:${26 * u}px;color:${MUTED}">// ${c.rich(scene.subtitle, MUTED)}</div>` : ''}</div>` : '<div></div>';
  return { html: `<div class="af" style="justify-content:center;padding-left:${W * 0.1}px;font-family:${c.font('mono')};${NOLIG}">
    <div style="display:flex;flex-direction:column;gap:${k.gap * u}px">${head}
      <div style="display:flex;flex-direction:column;gap:${k.itemGap * u}px">
        ${(scene.items ?? []).map((it, n) => `<div data-p="i${n}" data-pad="6" style="display:flex;align-items:center;gap:${18 * u}px;font-size:${k.itemSize * u}px;font-weight:500;color:${FG};white-space:nowrap">${check}<span>${c.rich(it)}</span></div>`).join('')}
      </div></div></div>` };
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
const ROWS = `float rowH = 54. * uRes.x / 1920.;`;
const CARET = `
vec4 transition(vec2 uv){
  float p = uProgress;
  float e = p < .5 ? 4. * p * p * p : 1. - pow(-2. * p + 2., 3.) / 2.;
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
  float e = p < .5 ? 4. * p * p * p : 1. - pow(-2. * p + 2., 3.) / 2.;
  float s = floor(e * n) / n, seam = 1. - s;               // whole lines at a time
  vec4 c = uv.y < seam ? getFrom(vec2(uv.x, uv.y + s)) : getTo(vec2(uv.x, uv.y - seam));
  float k = step(abs(uv.y - seam) * uRes.y, 1.5) * step(.001, s) * step(s, .999) * .85;
  return c * (1. - k) + vec4(uPal[2], 1.) * k;
}`;

export default {
  name: 'terminal',
  extends: 'studio',
  description: 'A terminal session about the change: mono type, zinc dot grid, typed text, stepped motion, a caret wipe.',
  suits: 'Developer tools and pull-request demos watched by engineers.',

  palette: {
    background: GROUND, foreground: FG, accent: ACCENT, onAccent: GROUND,
    tagColors: { Before: RED, After: ACCENT, Tour: MUTED, Compare: MUTED },
    tagFallback: MUTED, danger: RED,
  },
  fonts: {
    text: { family: 'JetBrains Mono', weights: [400, 500, 700], fallback: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" },
    display: { family: 'JetBrains Mono', weights: [400, 500, 700], fallback: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" },
    mono: { family: 'JetBrains Mono', weights: [400, 500, 700], fallback: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" },
  },

  canvas: {
    matte: GROUND, model: 'shared',
    background: { kind: 'shader', shader: 'dots', colors: [GROUND, '#FFFFFF'], spacing: 26, radius: 1.2, drift: 0, fade: 0.85, opacity: 0.12, gradient: 0 },
  },
  post: { dither: 2.5, grain: 0, vignette: 0.35, vignetteSoftness: 0.7 },

  window: {
    radius: 0.004, fill: PANEL, shadow: '0 10px 28px rgba(0,0,0,0.5)', shadowPad: 60,
    border: { width: 1, color: HAIR }, highlight: null, insets: [48, 0, 0, 0], chrome: { kind: 'none' }, drift: null,
  },

  caption: {
    variant: 'mono', placement: 'under', align: 'left', size: 0.0155,
    enter: 'type', typeCps: 45, caret: 'block', delay: 0.4, exit: 0.05,
    color: FG, weight: 500,
  },
  title: { measure: 'glyph', subtitleEnter: 'type', subtitleOpacity: 1 },
  card: { width: 1160, shadowPad: 40, rowEnter: 'fade' },
  list: { itemEnter: 'fade', itemSize: 34, gap: 34, itemGap: 20 },

  callout: {
    mark: 'brackets', pad: 10, radius: 3, dimAlpha: 0.6, dimColor: GROUND, scaleIn: 0.98, enterSec: 0.2, exitSec: 0.1,
    chip: { size: 22, weight: 500, padY: 8, padX: 14, radius: 0 },
  },

  motion: {
    spring: { damping: 90, stiffness: 2000, mass: 1 },          // critically damped and quick: a few steps, no overshoot
    clock: { poses: 30, seed: 1, jitterPx: 0, jitterDeg: 0 },    // overlays at 30 poses a second, no jitter
    poseRate: 15,
    card: { rise: 0, rows: [0.5, 1.0, 1.5], alpha: [1, 1, 1] },
    list: { headRise: 0, start: 0.5, step: 0.3, dx: 0 },
    split: { stagger: 4, rise: 0 },
    text: {
      softBlur: { stagger: 1, rise: 0, blur: 0, frames: 1, riseFrames: 1, ease: [0, 0, 1, 1] },
      microScale: { frames: 1, from: 1, ease: [0, 0, 1, 1] },
      wordPush: { reveal: 1, slide: 0.001, over: 0, char: 0.5, space: 0, gap: 3, accel: 0.9 },
      subtitle: { from: 0.35, to: 0.5, rise: 0 },
    },
  },
  camera: { ease: { type: 'spring', stiffness: 400, damping: 52, mass: 1 }, motionBlur: null },

  transition: {
    default: 'caret-wipe', sec: 0.5, stepped: true,
    params: { zoomBlur: { scaleIn: 0.97, scaleOut: 1.03, sigma: 3 }, focusPull: { bright: 1.0, brightIn: 1.0 } },
    custom: {
      'caret-wipe': { sec: 0.5, stepped: true, glsl: CARET },
      // the authoring default and two of its siblings become terminal moves, so a spec that names them still looks like this style
      'zoom-blur': { sec: 0.5, stepped: true, glsl: CARET },
      'focus-pull': { sec: 0.5, stepped: true, glsl: REPAINT },
      'push-through': { sec: 0.5, stepped: true, glsl: SCROLL },
    },
  },

  build: { window: windowBuilder, caption: captionBuilder, title: titleBuilder, issue: issueBuilder, list: listBuilder, calloutChip: chipBuilder, calloutMark: markBuilder },
};
