// editorial: type and stillness. A magazine page that happens to contain a screen
// recording. Flat warm paper with a fine static grain, ink type, rules instead of
// shadows, one vermilion accent, Newsreader (serif, with its italic and optical
// sizes) and DM Mono for word labels. The page has two columns on one left-hung
// grid: the main column (the recording, the issue, the list) and a narrow margin
// column to its right, where captions, the issue's meta and the list's kicker sit
// as margin notes under a hairline. A running header (the video's title, a folio)
// is the page furniture.
//
// Credits: the title entrance and card/list rises follow remocn's
// line-by-line-slide and staggered-fade-up numbers (MIT, github.com/remocn).
import { esc, has, parseEmphasis, stripEmphasis, sceneLayout } from '../layout.js';

// ------------------------------------------------------------ palette
const PAPER = '#F5F1E8';
const INK = '#1C1B19';
const MUTED = '#625E56';                    // muted ink, 5.7:1 on paper
const RULE = 'rgba(28,27,25,0.16)';         // a hairline: ink at 16%
const NOTE_RULE = 'rgba(28,27,25,0.55)';    // the rule above a margin note: stronger, it is a signpost
const ACCENT = '#C23B1E';                   // vermilion, deepened until it reads 4.7:1 on paper
const BRICK = '#9C2D18';                    // Before
const GREEN = '#2B6A43';                    // After

// ------------------------------------------------------------ grid (all fractions of W unless noted)
const L = 0.05;                             // the page margin: header, title, card, list, window, notes share it
const MAIN = 0.74;                          // the main column (the recording is at most this wide)
const GAP = 40;                             // u between the columns

// Tag and accent colours somebody else chose are inked once, here: pulled a little toward the ink so they sit on paper, then deepened until they read 4.5:1.
const inked = (c, t, pull = 0.28) => {
  if (t.luminance(c) === null) return c;
  let out = t.mix(c, INK, pull);
  for (let i = 0; i < 20 && t.contrast(out, t.ground) < 4.5; i++) out = t.mix(out, INK, 0.1);
  return out;
};

// ------------------------------------------------------------ small helpers
const px = (v) => `${Math.round(v * 100) / 100}px`;
let ACC = ACCENT;                           // the (mapped) accent of the builder that is running
const wrap = (fn) => (c) => { ACC = c.accent; return fn(c); };
/** Straight quotes and apostrophes become typographer's quotes. */
const smart = (t) => t
  .replace(/(^|[\s([{—])"/g, '$1“').replace(/"/g, '”')
  .replace(/(^|[\s([{—])'/g, '$1‘').replace(/'/g, '’');
const SERIF_NUMS = "font-variant-numeric:lining-nums tabular-nums;font-feature-settings:'lnum','tnum'";
/** Figures inside mono labels are set in the serif's lining figures (DM Mono's zero is slashed, which reads technical). */
const nums = (s, c) => s.replace(/\d+/g, (d) => `<span style="font-family:${serif(c)};${SERIF_NUMS};font-size:1.08em;letter-spacing:0.02em">${d}</span>`);
/** Emphasis markup as typography. 'accent': italic in the accent. 'ink': italic in ink. 'roman': upright inside italic text. `post` maps the escaped text of a run. */
const em = (text, mode = 'accent', post = (s) => s) => parseEmphasis(text).map((r) => {
  const t = post(esc(smart(r.t)));
  if (!r.em) return t;
  if (mode === 'roman') return `<span style="font-style:normal;font-weight:500">${t}</span>`;
  return `<span style="font-style:italic;${mode === 'accent' ? `color:${ACC}` : ''}">${t}</span>`;
}).join('');
const pad2 = (n) => String(n).padStart(2, '0');
const mono = (c) => c.font('mono');
const serif = (c) => c.font('display');
const css = '*{font-kerning:normal;text-rendering:geometricPrecision}';
/** Where a block of height h (u) hangs: centred in the page below the header, a little above centre. A rough estimate of the height is enough; long content simply starts higher. */
const hangTop = (c, h) => Math.max(c.H * 0.13, 80 * c.u + (c.H - 80 * c.u - h * c.u) / 2 - c.H * 0.04);
const lines = (len, perLine) => Math.max(1, Math.ceil(len / perLine));

/** Glyph and word spans for the two per-piece title effects, and the single wrapped piece for lines and type; `*emphasis*` is italic in the accent. */
const titleSpans = (c, effect) => {
  const runs = parseEmphasis(c.scene.text).map((r) => ({ ...r, t: smart(r.t) }));
  const style = (isEm) => (isEm ? `font-style:italic;color:${ACC};` : '');
  if (effect === 'lines' || effect === 'type') return `<span data-p="all" data-pad="16" data-type style="display:block;max-width:${px(c.W * (c.style.title.maxWidth ?? 0.72))};white-space:normal;text-wrap:balance">${em(c.scene.text)}</span>`;
  if (effect === 'word-push') {
    // the same words the engine counts (a run split on white space), each knowing whether a space follows it in the source
    const words = [];
    for (const r of runs) for (const tok of r.t.split(/(\s+)/)) {
      if (!tok) continue;
      if (/^\s+$/.test(tok)) { if (words.length) words[words.length - 1].sp = true; } else words.push({ w: tok, em: r.em, sp: false });
    }
    // Each word's piece is a zero-width box (the engine reads its width as 0) holding the glyphs as overflow, so a left-aligned
    // line does not travel the engine's centring distance; a plain sibling keeps the space in the flow.
    const size = c.W * c.style.title.size;
    return words.map((w, k) => {
      const room = Math.ceil(w.w.length * size * 0.7) + 30;
      return `<span style="position:relative;display:inline-block;white-space:pre;${w.sp && k < words.length - 1 ? 'margin-right:0.22em' : ''}"><span style="${style(w.em)}visibility:hidden">${esc(w.w)}</span><span data-p="w${k}" data-pad="${room}" style="${style(w.em)}position:absolute;left:0;top:0;width:0;white-space:pre">${esc(w.w)}</span></span>`;
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

/** A margin-note column: where it starts (x) and how wide it is, for a scene's window. */
const noteBox = (c, lay) => {
  const { W, u } = c;
  const x = lay.outer.left + lay.outer.w + GAP * u;
  return { x, w: W - W * L - x, top: lay.outer.top, h: lay.outer.h };
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
    mapAccent: (c, t) => inked(c, t),
    mapTag: (name, c, t) => inked(c, t),
  },
  fonts: {
    // one family, two roles: the optical-size axis is left to the browser ('6..72'), so the display cut sets titles and the text cut sets captions
    text: { family: 'Newsreader', weights: [400, 500, 600], italic: true, opsz: '6..72', fallback: "Georgia, 'Times New Roman', serif" },
    display: { family: 'Newsreader', weights: [400, 500, 600], italic: true, opsz: '6..72', fallback: "Georgia, 'Times New Roman', serif" },
    mono: { family: 'DM Mono', weights: [400, 500], fallback: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" },
  },

  canvas: { matte: PAPER, model: 'shared', background: { kind: 'css' } },
  post: { dither: 1.5, grain: 0.013, grainSize: 1.1, grainClock: 'static', vignette: 0, vignetteSoftness: 0.6 },

  window: {
    maxWidth: MAIN, maxHeight: 0.79, top: 0.115, align: 'left', margin: L,
    radius: 0.0035,
    fill: '#ffffff',
    // the hairline is the shadow list's own 1 px spread ring, outside the recording's edge
    shadow: `0 0 0 1px rgba(28,27,25,0.88),0 1px 2px rgba(28,27,25,0.07),0 6px 18px rgba(28,27,25,0.05)`,
    shadowPad: 40,
    border: null, highlight: null, glow: null, drift: null, tilt: 0, tiltJitter: 0, jitter: false,
  },
  split: { gap: 0.022, width: 1 - 2 * L, height: 0.62, top: 0.2, labelSize: 0.0125, labelRise: 0.05 },

  caption: {
    variant: 'plain', placement: 'under', align: 'left', size: 0.0156, offset: 0.075,
    enter: 'fade', delay: 0.12, exit: 0.22, rise: 0.45,
    color: INK, weight: 400,
    plain: { shadow: null, rule: null, ruleColor: RULE },
    tag: { style: 'word', weight: 500 },
  },

  title: {
    size: 0.074, weight: 400, align: 'left', padLeft: L, measure: 'glyph',
    enter: 'lines', maxEnterSec: 1.4, maxWidth: 0.72, lineHeight: 1.08,
    lines: { stagger: 0.09, sec: 0.7, rise: 1, ease: [0.16, 1, 0.3, 1], fade: false },     // a pure mask reveal: each line rises out of its own band
    subtitleSize: 0.0125, subtitleWeight: 400, subtitleOpacity: 1, subtitleEnter: 'fade', gap: 0.012,
    tracking: { 'word-push': -0.022, 'micro-scale-fade': -0.022, 'soft-blur-in': -0.022, lines: -0.022, type: -0.022 },
  },
  card: { width: 1728, shadowPad: 8 },
  list: { width: 1728, gap: 34, titleSize: 96, subtitleSize: 22, itemSize: 50, itemGap: 0, itemEnter: 'slide', numbered: true },

  callout: {
    mark: 'ring', pad: 9, radius: 8, ringWidth: 2.5, ringColor: INK, dash: 0, fillAlpha: 0,
    dimAlpha: 0.7, dimColor: PAPER, scaleIn: 0.985, forSec: 2.5, enterSec: 0.3, exitSec: 0.25,
    chip: { size: 22, weight: 500, padY: 7, padX: 12, radius: 3, background: PAPER, color: INK },
  },

  motion: {
    spring: { damping: 30, stiffness: 150, mass: 1 },            // overdamped: arrives without a bounce, settles in about 0.5 s
    card: { rise: 18, rows: [0.1, 0.24, 0.38], alpha: [1, 1, 1] },
    list: { headRise: 16, start: 0.3, step: 0.15, dx: 0, dy: 18 },
    split: { stagger: 5, rise: 14 },
    text: {
      softBlur: { stagger: 1, rise: 26, blur: 0, frames: 34, riseFrames: 34, ease: [0.16, 1, 0.3, 1], staggerSec: 0.016, sec: 0.55, riseSec: 0.55 },
      microScale: { frames: 20, from: 0.988, ease: [0.16, 1, 0.3, 1], sec: 0.67 },
      wordPush: { reveal: 5, slide: 16, over: 0.25, char: 0.5, space: 0, gap: 7, accel: 0.8 },
      subtitle: { from: 0.05, to: 0.55, rise: 10 },
    },
  },
  camera: { mode: 'inside', ease: { type: 'bezier', curve: [0.5, 0, 0.2, 1] }, motionBlur: null },   // inside: the page is the identity, the zoom stays in its column

  transition: {
    default: 'page-slide', sec: 0.6, stepped: false,
    params: {
      zoomBlur: { scaleIn: 0.975, scaleOut: 1.025, sigma: 4 },
      focusPull: { bright: 1, brightIn: 1, sigma: 4, scaleOut: 1.03, scaleIn: 0.985 },
      pushThrough: { scale: 1.08, scaleIn: 0.94, settle: 1.005, sigma: 3, sigmaIn: 0.6 },
      whipPan: { travel: 1.05, stretch: 0.03, blur: 6 },
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
    },
  },

  build: {
    // ---------------------------------------------------------------- the running header (the engine draws it on every scene; the title page has none)
    furniture: wrap((c) => {
      if (c.sceneType === 'title') return null;
      const { W, u, spec, index } = c;
      const first = spec.scenes.find((s) => s.type === 'title');
      const name = stripEmphasis(first?.text ?? spec.title ?? '');
      const left = W * L, width = W - 2 * left;
      return {
        html: `<div style="position:absolute;left:${px(left)};width:${px(width)};top:${px(30 * u)};display:flex;justify-content:space-between;align-items:baseline;gap:${px(40 * u)};font-family:${serif(c)};font-size:${px(26 * u)};line-height:1.3;color:${MUTED}">
          <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-style:italic">${esc(smart(name))}</span>
          <span style="${SERIF_NUMS};white-space:nowrap;letter-spacing:0.02em">${pad2(index + 1)} / ${pad2(spec.scenes.length)}</span></div>
          <div style="position:absolute;left:${px(left)};width:${px(width)};top:${px(80 * u)};height:${px(2 * u)};background:${RULE}"></div>`,
        css,
      };
    }),

    // ---------------------------------------------------------------- title
    title: wrap((c) => {
      const { W, H, u, scene } = c;
      const effect = c.effect ?? scene.effect ?? c.style.title.enter ?? 'soft-blur-in';
      const len = stripEmphasis(scene.text ?? '').length;
      const size = W * (len <= 26 ? 0.078 : len <= 42 ? 0.066 : 0.054);
      const left = W * L;
      const sub = has(scene.subtitle)
        ? `<div data-p="sub" data-pad="8" style="width:${px(W - 2 * left)};font-family:${mono(c)};font-size:${px(24 * u)};line-height:1.3;color:${MUTED};letter-spacing:0.01em;padding-bottom:${px(22 * u)};border-bottom:${px(2 * u)} solid ${RULE};margin-bottom:${px(34 * u)}">${em(scene.subtitle, 'ink', (s) => nums(s, c))}</div>`
        : '';
      const html = `<div class="af" style="justify-content:flex-end;padding:0 ${px(left)} ${px(H * 0.2)} ${px(left)};font-family:${serif(c)}">
        ${sub}
        <div style="font-size:${px(size)};line-height:${c.style.title.lineHeight};font-weight:${c.style.title.weight};color:${INK};letter-spacing:-0.022em;${effect === 'lines' || effect === 'type' ? '' : `text-wrap:balance;max-width:${px(W * c.style.title.maxWidth)};`}">${titleSpans(c, effect)}</div>
      </div>`;
      return { html, css };
    }),

    // ---------------------------------------------------------------- issue: a typographic block on the page grid, no card
    issue: wrap((c) => {
      const { W, H, u, scene } = c;
      const left = W * L, main = W * MAIN, aside = W - 2 * left - main - GAP * u;
      const mainU = main / u, tl = lines(stripEmphasis(scene.title ?? '').length, mainU / (88 * 0.4)), ql = lines(stripEmphasis(scene.quote ?? '').length + 2, (mainU - 34) / (46 * 0.4));
      const top = hangTop(c, 70 + tl * 88 * 1.04 + (scene.quote ? 34 + ql * 46 * 1.28 : 0) + (scene.reporter ? 34 + 30 : 0));
      const rule = `${px(2 * u)} solid ${RULE}`;
      const line = (s) => `<div style="padding:${px(3 * u)} 0">${s}</div>`;
      const metaLines = [scene.source && esc(scene.source), scene.id && nums(esc(scene.id), c), scene.status && `<span style="color:${INK}">${nums(esc(scene.status), c)}</span>`].filter(Boolean).map(line).join('');
      const html = `<div class="af" style="font-family:${serif(c)}">
        <div id="card" style="position:absolute;left:${px(left)};top:${px(top)};width:${px(W - 2 * left)};display:flex;gap:${px(GAP * u)};padding:${px(26 * u)} 0 ${px(44 * u)} 0;border-top:${rule};border-bottom:${rule}">
          <div style="width:${px(main)};display:flex;flex-direction:column;gap:${px(34 * u)}">
            ${has(scene.title) ? `<div class="piece" data-p="title" data-pad="8" style="font-size:${px(88 * u)};line-height:1.04;font-weight:400;letter-spacing:-0.02em;color:${INK};text-wrap:balance">${em(scene.title, 'ink')}</div>` : ''}
            ${scene.quote ? `<div class="piece" data-p="quote" data-pad="8" style="border-left:${px(3 * u)} solid ${ACC};padding-left:${px(30 * u)};font-size:${px(46 * u)};line-height:1.28;font-style:italic;font-weight:400;color:${INK};text-wrap:pretty">“${em(scene.quote, 'roman')}”</div>` : ''}
            ${scene.reporter ? `<div class="piece" data-p="reporter" data-pad="8" style="font-family:${mono(c)};font-size:${px(23 * u)};line-height:1.3;color:${MUTED}">${em(scene.reporter, 'ink', (s) => nums(s, c))}</div>` : ''}
          </div>
          <div style="width:${px(aside)};font-family:${mono(c)};font-size:${px(22 * u)};line-height:1.4;color:${MUTED};padding-top:${px(6 * u)}">${metaLines}</div>
        </div></div>`;
      return { html, css };
    }),

    // ---------------------------------------------------------------- list
    list: wrap((c) => {
      const { W, H, u, scene } = c, k = c.style.list;
      const left = W * L, main = W * MAIN, aside = W - 2 * left - main - GAP * u;
      const rule = `${px(2 * u)} solid ${RULE}`;
      const items = scene.items ?? [];
      const mainU = main / u, tl = lines(stripEmphasis(scene.title ?? '').length, mainU / (k.titleSize * 0.4));
      const rowsH = items.reduce((a, it) => a + 46 + lines(stripEmphasis(it).length, (mainU - 92) / (k.itemSize * 0.4)) * k.itemSize * 1.12, 0);
      const top = hangTop(c, (scene.title ? tl * k.titleSize * 1.02 + k.gap : 0) + rowsH + 4);
      const side = has(scene.subtitle)
        ? `<div style="position:absolute;left:${px(main + GAP * u)};top:0;width:${px(aside)};font-family:${mono(c)};font-size:${px(k.subtitleSize * u)};line-height:1.4;color:${MUTED};border-top:${px(2 * u)} solid ${NOTE_RULE};padding-top:${px(16 * u)}">${em(scene.subtitle, 'ink', (s) => nums(s, c))}</div>`
        : '';
      const html = `<div class="af" style="font-family:${serif(c)}">
        <div style="position:absolute;left:${px(left)};top:${px(top)};width:${px(main)};display:flex;flex-direction:column;gap:${px(k.gap * u)}">
          ${has(scene.title) || has(scene.subtitle) ? `<div data-p="head" data-pad="${Math.ceil(W * 0.2)}" style="position:relative">
            ${side}
            ${has(scene.title) ? `<div style="font-size:${px(k.titleSize * u)};line-height:1.02;font-weight:400;letter-spacing:-0.024em;color:${INK};text-wrap:balance">${em(scene.title)}</div>` : ''}
          </div>` : '<div></div>'}
          <div style="display:flex;flex-direction:column">
            ${items.map((it, n) => `<div data-p="i${n}" data-pad="4" style="display:flex;align-items:baseline;gap:${px(36 * u)};padding:${px(22 * u)} 0 ${px(24 * u)} 0;border-top:${rule};${n === items.length - 1 ? `border-bottom:${rule};` : ''}">
              <span style="font-size:${px(28 * u)};color:${MUTED};min-width:${px(56 * u)};${SERIF_NUMS}">${pad2(n + 1)}</span>
              <span style="font-size:${px(k.itemSize * u)};line-height:1.12;font-weight:400;color:${INK};letter-spacing:-0.012em;text-wrap:pretty">${em(it, 'ink')}</span></div>`).join('')}
          </div></div></div>`;
      return { html, css };
    }),

    // ---------------------------------------------------------------- caption: a margin note beside the recording (under it on a split, on a sheet on a full-bleed recording)
    caption: wrap((c) => {
      const { W, u, pos, tag, text, color, scene, spec, style } = c;
      const plain = stripEmphasis(text).length;
      const tagHtml = (cls) => (tag ? `<div style="font-family:${mono(c)};font-size:${px(22 * u)};font-weight:500;letter-spacing:0.01em;line-height:1.2;color:${color};${cls}">${nums(esc(tag), c)}</div>` : '');
      const full = scene.frame === 'full' && scene.type === 'clip';

      if (full) {   // no paper under a full-bleed recording: the caption brings a sheet of its own
        const size = c.size * 1.15;
        const html = `<div style="position:absolute;${pos.css};display:flex;align-items:flex-end;justify-content:flex-start;padding-left:${px(W * L)}">
          <div id="pill" style="display:flex;align-items:baseline;gap:${px(size * 0.75)};background:${PAPER};padding:${px(size * 0.5)} ${px(size * 0.75)};border:${px(2 * u)} solid ${INK};border-radius:${px(3 * u)};font-family:${serif(c)};font-size:${px(size)};line-height:1.3;color:${INK}">
            ${tagHtml('flex:none')}<span data-type style="display:block;max-width:${px(size * 24)};text-wrap:balance;white-space:pre-line">${em(text)}</span></div></div>`;
        return { html, css };
      }
      if (scene.type === 'split') {   // under the pair of boxes, hung on the left box
        const size = c.size * 1.2;
        const html = `<div style="position:absolute;${pos.css};display:flex;align-items:flex-start;justify-content:flex-start;padding-left:${px(pos.padLeft)};padding-top:${px(30 * u)}">
          <div id="pill" style="display:flex;align-items:baseline;gap:${px(size * 0.75)};font-family:${serif(c)};font-size:${px(size)};line-height:1.3;color:${INK}">
            ${tagHtml('flex:none')}<span data-type style="display:block;max-width:${px(size * 26)};text-wrap:balance;white-space:pre-line">${em(text)}</span></div></div>`;
        return { html, css };
      }
      // clip and image: the margin column, top-aligned with the window
      const lay = sceneLayout(spec, style, scene), nb = noteBox(c, lay);
      // type size steps down with length (30, 28, 26, 24, then 22 px), so a long caption gets smaller type and more lines, never a clipped line
      let size = c.size;
      for (const s of [c.size, c.size * 0.93, c.size * 0.87, c.size * 0.8, 22 * u]) {
        size = s;
        const perLine = Math.max(8, Math.floor(nb.w / (s * 0.46)));
        if (Math.ceil(plain / perLine) * s * 1.3 + 90 * u < nb.h * 0.9) break;
      }
      const html = `<div style="position:absolute;left:${px(nb.x)};top:${px(nb.top)};width:${px(nb.w)}">
        <div id="pill" style="width:${px(nb.w)};border-top:${px(2 * u)} solid ${NOTE_RULE};padding-top:${px(18 * u)};font-family:${serif(c)};font-size:${px(size)};line-height:1.28;color:${INK};letter-spacing:-0.003em">
          ${tagHtml(`margin-bottom:${px(10 * u)}`)}<span data-type style="display:block;text-wrap:pretty;white-space:pre-line">${em(text)}</span></div></div>`;
      return { html, css };
    }),

    // ---------------------------------------------------------------- callout label: a paper chip with a hairline
    calloutChip: wrap((c) => {
      const { s, label } = c, k = c.style.callout.chip;
      return {
        html: `<div id="chip" style="position:absolute;left:20px;top:20px;padding:${px(k.padY * s)} ${px(k.padX * s)};border-radius:${px(k.radius * s)};background:${PAPER};border:${px(1.5 * s)} solid ${INK};color:${INK};font-family:${mono(c)};font-size:${px(k.size * s)};font-weight:${k.weight};letter-spacing:-0.015em;line-height:1.2;max-width:${px(380 * s)};text-wrap:balance">${em(label, 'ink', (t) => nums(t, c))}</div>`,
      };
    }),
  },
};
