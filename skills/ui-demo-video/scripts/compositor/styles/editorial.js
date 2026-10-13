// editorial: type and stillness. A magazine page that happens to contain a screen
// recording. Flat warm paper with a fine grain, ink text, rules instead of
// shadows, one vermilion accent, Newsreader (serif) with DM Mono (labels). The
// window is a figure on the page, the caption sits under it like a caption in a
// magazine, and a running header (the video's title, "02 / 06") is the page
// furniture. Motion is short and calm: ease-out rises, no blur, no bounce.
//
// Credits: the title and card motion follow remocn's line-by-line-slide and
// staggered-fade-up numbers (MIT, github.com/remocn): short staggers, ease-out.
// Everything here is plain tokens and builders; no engine file is touched.
//
// Why a font loader at the top: the engine fetches one upright weight axis per
// family, with the optical-size axis pinned at 16 and no italics. Newsreader's
// display cut (opsz 72) is what makes a serif look set rather than typed, and
// the pull quote needs a true italic, so this file fetches the variable latin
// cut itself (once, cached beside the engine's fonts, embedded as data URIs)
// and falls back to the engine's Newsreader, then Georgia, if that fails.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { esc, has, parseEmphasis, stripEmphasis } from '../layout.js';

// ------------------------------------------------------------ palette
const PAPER = '#F5F1E8';
const INK = '#1C1B19';
const MUTED = '#625E56';                    // muted ink, 5.4:1 on paper
const RULE = 'rgba(28,27,25,0.16)';         // a hairline: ink at 16%
const ACCENT = '#C23B1E';                   // vermilion, deepened until it reads 4.7:1 on paper
const BRICK = '#9C2D18';                    // Before
const GREEN = '#2B6A43';                    // After
const HANG = 0.26;                          // issue card and list hang from this line (fraction of H)
const L = 0.075;                            // the page margin, fraction of W: header, title, card, list and window share it

// ------------------------------------------------------------ fonts
const cacheDir = path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'ui-demo-video', 'fonts');
const faceFile = path.join(cacheDir, 'editorial-newsreader-var.css');
const loadFaces = async () => {
  try { return fs.readFileSync(faceFile, 'utf8'); } catch { /* not cached yet */ }
  if (process.env.UI_DEMO_FONTS_OFFLINE) return '';
  try {
    const host = process.env.UI_DEMO_FONTS_HOST ?? 'https://fonts.googleapis.com';
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
    const res = await fetch(`${host}/css2?family=Newsreader:ital,opsz,wght@0,6..72,400..600;1,6..72,400..600&display=block`, { headers: { 'user-agent': ua }, signal: AbortSignal.timeout(4000) });
    const text = await res.text();
    if (!res.ok || !text.includes('@font-face')) throw new Error(`HTTP ${res.status}`);
    const blocks = text.split('/* ').slice(1).filter((b) => b.startsWith('latin */')).map((b) => b.slice(b.indexOf('@font-face')));
    let css = blocks.join('\n').replace(/font-family:\s*'Newsreader'/g, "font-family:'Newsreader Var'");
    for (const u of new Set([...css.matchAll(/url\((https:[^)]+)\)/g)].map((m) => m[1]))) {
      const buf = Buffer.from(await (await fetch(u, { signal: AbortSignal.timeout(8000) })).arrayBuffer());
      css = css.split(u).join(`data:font/woff2;base64,${buf.toString('base64')}`);
    }
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(faceFile, css);
    return css;
  } catch (e) {
    console.error(`editorial: Newsreader (display cut and italic) could not be downloaded (${e.message}); the serif falls back to the engine's Newsreader or Georgia`);
    return '';
  }
};
const FACES = await loadFaces();
const SERIF = "'Newsreader Var', Newsreader, Georgia, 'Times New Roman', serif";

// ------------------------------------------------------------ small helpers
const px = (v) => `${Math.round(v * 100) / 100}px`;
/** Straight quotes and apostrophes become typographer's quotes. */
const smart = (t) => t
  .replace(/(^|[\s([{\u2014])"/g, '$1\u201c').replace(/"/g, '\u201d')
  .replace(/(^|[\s([{\u2014])'/g, '$1\u2018').replace(/'/g, '\u2019');
/** Emphasis markup as typography. 'accent': italic in the accent. 'ink': italic in ink. 'roman': upright inside italic text. */
const em = (text, mode = 'accent') => parseEmphasis(text).map((r) => {
  if (!r.em) return esc(smart(r.t));
  if (mode === 'roman') return `<span style="font-style:normal;font-weight:500">${esc(smart(r.t))}</span>`;
  return `<span style="font-style:italic;${mode === 'accent' ? `color:${ACCENT}` : ''}">${esc(smart(r.t))}</span>`;
}).join('');
const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
const hexRgb = (h) => { const m = /^#([0-9a-f]{6})$/i.exec(h); return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null; };
/** A spec may bring its own tag colour (a bright green is fine on a screen, thin on paper): deepen it toward ink until it reads 4.5:1. */
const onPaper = (color) => {
  let rgb = hexRgb(color); if (!rgb) return color;
  const ink = hexRgb(INK), lp = lum(hexRgb(PAPER));
  for (let i = 0; i < 20 && (lp + 0.05) / (lum(rgb) + 0.05) < 4.5; i++) rgb = rgb.map((v, k) => Math.round(v * 0.9 + ink[k] * 0.1));
  return `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
};
const pad2 = (n) => String(n).padStart(2, '0');
const faces = (c) => `${FACES}\n*{font-optical-sizing:auto;font-kerning:normal;text-rendering:geometricPrecision}${c ?? ''}`;
const mono = (c) => c.font('mono');
const serif = (c) => c.font('display');

/** The running header: the video's title on the left, "02 / 06" on the right, over a hairline. dx, dy shift it (the issue and list scenes carry their own copy inside a captured piece, because the engine only draws the furniture layer under clips and images). */
const header = (c, dx, dy) => {
  const { W, u, spec, index } = c;
  const first = spec.scenes.find((s) => s.type === 'title');
  const name = stripEmphasis(first?.text ?? spec.title ?? '');
  const left = W * L + dx;
  return `<div style="position:absolute;left:${px(left)};width:${px(W - 2 * W * L)};top:${px(34 * u + dy)};display:flex;justify-content:space-between;align-items:baseline;gap:${px(40 * u)};font-family:${mono(c)};font-size:${px(22 * u)};line-height:1.3;color:${MUTED};letter-spacing:0.01em">
    <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(name)}</span>
    <span style="font-variant-numeric:tabular-nums;font-feature-settings:'zero' 0;white-space:nowrap">${pad2(index + 1)} / ${pad2(spec.scenes.length)}</span></div>
    <div style="position:absolute;left:${px(left)};width:${px(W - 2 * W * L)};top:${px(80 * u + dy)};height:${px(2 * u)};background:${RULE}"></div>`;
};

/** Glyph, word or whole-text spans for the three title effects, with `*emphasis*` set italic in the accent. */
const titleSpans = (c, effect) => {
  const runs = parseEmphasis(c.scene.text).map((r) => ({ ...r, t: smart(r.t) }));
  const style = (isEm) => (isEm ? `font-style:italic;color:${ACCENT};` : '');
  if (effect === 'word-push') {
    const words = runs.flatMap((r) => r.t.split(/\s+/).filter(Boolean).map((w) => ({ w, em: r.em })));
    // The engine centres a word-push line (it shifts earlier words by half the width of each later one). A left-aligned title
    // must not travel that far, so each word's piece is a zero-width box (the engine reads its width as 0) holding the real
    // glyphs as overflow; a plain sibling keeps the space in the flow. The effect becomes: each word slides in a little, in turn.
    const size = c.W * c.tokens.title.size;
    return words.map((w, k) => {
      const room = Math.ceil(w.w.length * size * 0.7) + 30;
      return `<span style="position:relative;display:inline-block;white-space:pre;${k < words.length - 1 ? 'margin-right:0.22em' : ''}"><span style="${style(w.em)}visibility:hidden">${esc(w.w)}</span><span data-p="w${k}" data-pad="${room}" style="${style(w.em)}position:absolute;left:0;top:0;width:0;white-space:pre">${esc(w.w)}</span></span>`;
    }).join('');
  }
  if (effect === 'micro-scale-fade') return `<span data-p="all" data-pad="14" style="display:inline-block">${em(c.scene.text)}</span>`;
  // soft-blur-in: one piece per glyph, glyphs of a word kept together so a long title wraps between words
  const chars = runs.flatMap((r) => Array.from(r.t).map((ch) => ({ c: ch, em: r.em })));
  let out = '', word = '';
  const flush = () => { if (word) { out += `<span style="display:inline-block;white-space:nowrap">${word}</span>`; word = ''; } };
  chars.forEach((ch, k) => {
    if (!ch.c.trim()) { flush(); out += ' '; return; }
    word += `<span data-p="c${k}" data-pad="44" style="${style(ch.em)}display:inline-block;white-space:pre">${esc(ch.c)}</span>`;
  });
  flush();
  return out;
};

export default {
  name: 'editorial',
  extends: 'studio',
  description: 'Type and stillness: warm paper, ink, hairline rules, a serif with a mono, one vermilion accent.',
  suits: 'Changelogs, weekly updates and explanations led by words: calm, typographic, no gradients.',

  palette: {
    background: PAPER,
    foreground: INK,
    accent: ACCENT,
    onAccent: PAPER,
    tagColors: { Before: BRICK, After: GREEN },     // every other tag is ink (tagFallback)
    tagFallback: INK,
    danger: ACCENT,
  },
  fonts: {
    text: { family: 'Newsreader', weights: [400, 500, 600], fallback: "Georgia, 'Times New Roman', serif" },
    display: { family: null, weights: [400, 500, 600], fallback: SERIF },
    mono: { family: 'DM Mono', weights: [400, 500], fallback: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" },
  },

  canvas: { matte: PAPER, model: 'shared', background: { kind: 'css' } },
  post: { dither: 1.5, grain: 0.013, grainSize: 1.1, vignette: 0, vignetteSoftness: 0.6 },

  window: {
    maxWidth: 0.85, maxHeight: 0.69, top: 0.135, align: 'left', margin: L,
    radius: 0.0035,
    fill: '#ffffff',
    // the hairline is the shadow list's own 1 px spread ring, outside the recording's edge: the engine's border token is keyed by size only, so two equal split boxes would share one
    shadow: `0 0 0 1px rgba(28,27,25,0.88),0 1px 2px rgba(28,27,25,0.07),0 6px 18px rgba(28,27,25,0.05)`,
    shadowPad: 40,
    border: null,
    highlight: null, glow: null, drift: null, tilt: 0, tiltJitter: 0, jitter: false,
  },
  split: { gap: 0.022, width: 1 - 2 * L, height: 0.62, top: 0.22, labelSize: 0.0125, labelRise: 0.05 },

  caption: {
    variant: 'plain', placement: 'under', align: 'left', size: 0.0188, offset: 0.075,
    enter: 'fade', delay: 0.12, exit: 0.22, rise: 0.38,
    color: INK, weight: 400,
    plain: { shadow: null, rule: null, ruleColor: RULE },
    tag: { style: 'word', weight: 500 },
  },

  title: {
    size: 0.074, weight: 400, align: 'left', padLeft: L, measure: 'glyph',
    subtitleSize: 0.0125, subtitleWeight: 400, subtitleOpacity: 1, subtitleEnter: 'fade', gap: 0.012,
    tracking: { 'word-push': -0.022, 'micro-scale-fade': -0.022, 'soft-blur-in': -0.022 },
  },
  card: { width: 1286, shadowPad: 380 },
  list: { width: 1286, gap: 34, titleSize: 88, subtitleSize: 24, itemSize: 48, itemGap: 0, itemEnter: 'slide', numbered: true },

  callout: {
    mark: 'ring', pad: 9, radius: 8, ringWidth: 2.5, ringColor: INK, dash: 0, fillAlpha: 0,
    dimAlpha: 0.7, dimColor: PAPER, scaleIn: 0.985, forSec: 2.5, enterSec: 0.3, exitSec: 0.25,
    chip: { size: 22, weight: 500, padY: 7, padX: 12, radius: 3, background: PAPER, color: INK },
  },

  motion: {
    spring: { damping: 30, stiffness: 150, mass: 1 },            // overdamped: arrives without a bounce, settles in about 0.5 s
    card: { rise: 18, rows: [0.1, 0.24, 0.38], alpha: [1, 1, 1] },
    list: { headRise: 16, start: 0.3, step: 0.15, dx: 0 },
    split: { stagger: 5, rise: 14 },
    text: {
      // frames are output frames (60 fps): a 1-frame stagger sweeps a line in about a third of a second, left to right, line after line
      softBlur: { stagger: 1, rise: 26, blur: 0, frames: 34, riseFrames: 34, ease: [0.16, 1, 0.3, 1] },
      microScale: { frames: 20, from: 0.988, ease: [0.16, 1, 0.3, 1] },
      wordPush: { reveal: 5, slide: 16, over: 0.25, char: 0.5, space: 0, gap: 7, accel: 0.8 },
      subtitle: { from: 0.05, to: 0.55, rise: 10 },
    },
  },
  camera: { ease: { type: 'bezier', curve: [0.5, 0, 0.2, 1] }, motionBlur: null },

  transition: {
    default: 'page-slide', sec: 0.6, stepped: false,
    params: {
      zoomBlur: { scaleIn: 0.975, scaleOut: 1.025, sigma: 5 },
      focusPull: { bright: 1, brightIn: 1 },
    },
    custom: {
      // A page turned, gently: the old page lifts a few percent and fades, the new one settles up from below.
      'page-slide': {
        sec: 0.6,
        glsl: `
float eo(float t){ t = clamp(t, 0., 1.); return 1. - pow(1. - t, 3.); }
float eio(float t){ t = clamp(t, 0., 1.); return t * t * (3. - 2. * t); }
vec4 pick(bool from, vec2 uv){ if (uv.y < 0. || uv.y > 1.) return vec4(0.); return from ? getFrom(uv) : getTo(uv); }
vec4 transition(vec2 uv){
  float p = uProgress, d = 0.045;
  float a = clamp(p / 0.55, 0., 1.), b = clamp((p - 0.4) / 0.6, 0., 1.);
  vec4 f = pick(true, uv + vec2(0., d * eio(a))) * (1. - eio(a));
  vec4 t = pick(false, uv - vec2(0., d * (1. - eo(b)))) * eo(b);
  return f + t;
}`,
      },
      // push-through, quietened: the old page eases a few percent closer as it fades, the new one settles from slightly far.
      'push-through': {
        sec: 0.8,
        glsl: `
float eo(float t){ t = clamp(t, 0., 1.); return 1. - pow(1. - t, 3.); }
float eio(float t){ t = clamp(t, 0., 1.); return t * t * (3. - 2. * t); }
vec2 zoom(vec2 uv, float s){ return (uv - .5) / s + .5; }
vec4 transition(vec2 uv){
  float p = uProgress;
  float a = clamp(p / 0.55, 0., 1.), b = clamp((p - 0.4) / 0.6, 0., 1.);
  vec4 f = getFrom(zoom(uv, 1. + .06 * eio(a))) * (1. - eio(a));
  vec4 t = getTo(zoom(uv, .96 + .04 * eo(b))) * eo(b);
  return f + t;
}`,
      },
    },
  },

  build: {
    // ---------------------------------------------------------------- the running header
    furniture: (c) => (c.sceneType === 'clip' || c.sceneType === 'image' ? { html: header(c, 0, 0) } : null),   // engine edit: furniture is now offered on every scene type; the card, list and title builders carry their own copy

    // ---------------------------------------------------------------- title
    title: (c) => {
      const { W, H, u, scene } = c;
      const effect = scene.effect ?? 'soft-blur-in';
      const len = stripEmphasis(scene.text ?? '').length;
      const size = W * (len <= 26 ? 0.074 : len <= 42 ? 0.062 : 0.05);
      const left = W * L;
      const sub = has(scene.subtitle)
        ? `<div data-p="sub" data-pad="8" style="width:${px(W - 2 * left)};font-family:${mono(c)};font-size:${px(24 * u)};line-height:1.3;color:${MUTED};letter-spacing:0.01em;padding-bottom:${px(22 * u)};border-bottom:${px(2 * u)} solid ${RULE};margin-bottom:${px(34 * u)}">${em(scene.subtitle, 'ink')}</div>`
        : '';
      const html = `<div class="af" style="justify-content:flex-end;padding:0 ${px(left)} ${px(H * 0.2)} ${px(left)};font-family:${serif(c)}">
        ${sub}
        <div style="font-size:${px(size)};line-height:1.04;font-weight:${c.style.title.weight};color:${INK};letter-spacing:-0.022em;text-wrap:balance;max-width:${px(W - 2 * left)};font-variation-settings:'opsz' 72">${titleSpans(c, effect)}</div>
      </div>`;
      return { html, css: faces() };
    },

    // ---------------------------------------------------------------- issue: a typographic block, no card
    issue: (c) => {
      const { W, u, scene } = c;
      const left = W * L, k = c.style.card;
      const meta = [scene.source, scene.id].filter(has).map(esc);
      const status = has(scene.status) ? `<span style="color:${INK}">${esc(scene.status)}</span>` : '';
      const top = c.H * HANG;
      const html = `<div class="af" style="font-family:${serif(c)}">
        <div id="card" style="position:absolute;left:${px(left)};top:${px(top)};width:${px(k.width * u)};padding:${px(22 * u)} 0 ${px(40 * u)} 0;border-bottom:${px(2 * u)} solid ${RULE};display:flex;flex-direction:column;gap:${px(34 * u)}">
          ${header(c, -left, -top)}
          <div style="display:flex;justify-content:space-between;align-items:baseline;padding-bottom:${px(20 * u)};border-bottom:${px(2 * u)} solid ${RULE};font-family:${mono(c)};font-size:${px(23 * u)};line-height:1.3;color:${MUTED}">
            <span>${meta.join(`<span style="padding:0 ${px(12 * u)}">/</span>`)}</span>${status}
          </div>
          ${has(scene.title) ? `<div class="piece" data-p="title" data-pad="8" style="font-size:${px(80 * u)};line-height:1.06;font-weight:400;letter-spacing:-0.018em;color:${INK};text-wrap:balance;font-variation-settings:'opsz' 72">${em(scene.title, 'ink')}</div>` : ''}
          ${scene.quote ? `<div class="piece" data-p="quote" data-pad="8" style="border-left:${px(3 * u)} solid ${ACCENT};padding-left:${px(30 * u)};font-size:${px(44 * u)};line-height:1.3;font-style:italic;font-weight:400;color:${INK};text-wrap:pretty">“${em(scene.quote, 'roman')}”</div>` : ''}
          ${scene.reporter ? `<div class="piece" data-p="reporter" data-pad="8" style="font-family:${mono(c)};font-size:${px(23 * u)};line-height:1.3;color:${MUTED}">${em(scene.reporter, 'ink')}</div>` : ''}
        </div></div>`;
      return { html, css: faces() };
    },

    // ---------------------------------------------------------------- list
    list: (c) => {
      const { W, u, scene } = c, k = c.style.list;
      const left = W * L;
      const rule = `${px(2 * u)} solid ${RULE}`;
      const items = scene.items ?? [];
      const top = c.H * HANG;
      const html = `<div class="af" style="font-family:${serif(c)}">
        <div style="position:absolute;left:${px(left)};top:${px(top)};width:${px(k.width * u)};display:flex;flex-direction:column;gap:${px(k.gap * u)}">
          ${has(scene.title) || has(scene.subtitle) ? `<div data-p="head" data-pad="${Math.ceil(c.W * 0.2)}" style="position:relative">
            ${header(c, -left, -top)}
            ${has(scene.subtitle) ? `<div style="font-family:${mono(c)};font-size:${px(k.subtitleSize * u)};line-height:1.3;color:${MUTED};margin-bottom:${px(14 * u)}">${em(scene.subtitle, 'ink')}</div>` : ''}
            ${has(scene.title) ? `<div style="font-size:${px(k.titleSize * u)};line-height:1.04;font-weight:400;letter-spacing:-0.022em;color:${INK};text-wrap:balance;font-variation-settings:'opsz' 72">${em(scene.title)}</div>` : ''}
          </div>` : '<div></div>'}
          <div style="display:flex;flex-direction:column">
            ${items.map((it, n) => `<div data-p="i${n}" data-pad="4" style="display:flex;align-items:baseline;gap:${px(36 * u)};padding:${px(22 * u)} 0 ${px(24 * u)} 0;border-top:${rule};${n === items.length - 1 ? `border-bottom:${rule};` : ''}">
              <span style="font-family:${mono(c)};font-size:${px(24 * u)};color:${MUTED};min-width:${px(52 * u)};font-variant-numeric:tabular-nums;font-feature-settings:'zero' 0">${pad2(n + 1)}</span>
              <span style="font-size:${px(k.itemSize * u)};line-height:1.15;font-weight:400;color:${INK};letter-spacing:-0.01em;text-wrap:pretty">${em(it, 'ink')}</span></div>`).join('')}
          </div></div></div>`;
      return { html, css: faces() };
    },

    // ---------------------------------------------------------------- caption: tag in mono, sentence in serif
    caption: (c) => {
      const { W, u, pos, tag, text, size, scene } = c;
      const color = onPaper(c.color);
      const full = scene.frame === 'full' && scene.type === 'clip';
      const left = full ? W * L : pos.padLeft;
      const tagHtml = tag ? `<span style="flex:none;font-family:${mono(c)};font-size:${px(22 * u)};font-weight:500;letter-spacing:0.01em;line-height:1;color:${color};transform:translateY(-${px(size * 0.04)})">${esc(tag)}</span>` : '';
      // a full-bleed recording has no paper under the caption: give it a sheet of its own
      const sheet = full ? `background:${PAPER};padding:${px(size * 0.5)} ${px(size * 0.75)};border:${px(2 * u)} solid ${INK};border-radius:${px(3 * u)};` : '';
      const wrapCss = full ? `${pos.css};display:flex;align-items:flex-end;justify-content:flex-start;padding-left:${px(left)}` : `${pos.css};display:flex;align-items:flex-start;justify-content:flex-start;padding-left:${px(left)};padding-top:${px(30 * u)}`;
      const html = `<div style="position:absolute;${wrapCss}">
        <div id="pill" style="display:flex;align-items:baseline;gap:${px(size * 0.75)};${sheet}font-family:${serif(c)};font-size:${px(size)};font-weight:400;line-height:1.3;color:${INK};letter-spacing:-0.005em">
          ${tagHtml}<span data-type style="display:block;max-width:${px(size * 24)};text-wrap:balance;white-space:pre-line">${em(text)}</span>
        </div></div>`;
      return { html, css: faces() };
    },

    // ---------------------------------------------------------------- callout label: a paper chip with a hairline
    calloutChip: (c) => {
      const { s, label } = c, k = c.style.callout.chip;
      return {
        html: `<div id="chip" style="position:absolute;left:20px;top:20px;padding:${px(k.padY * s)} ${px(k.padX * s)};border-radius:${px(k.radius * s)};background:${PAPER};border:${px(1.5 * s)} solid ${INK};color:${INK};font-family:${mono(c)};font-size:${px(k.size * s)};font-weight:${k.weight};letter-spacing:-0.015em;line-height:1.2;max-width:${px(380 * s)};text-wrap:balance">${em(label, 'ink')}</div>`,
      };
    },
  },
};
