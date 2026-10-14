// midnight: depth and light. A dark stage with one lit object on it: the recording
// is the only bright thing, everything else recedes. Near-black ground with a very
// slow muted graphite mesh that pools softly behind the window (never a stripe,
// never a blob), a dark-glass card and caption, a big tight Geist title that
// resolves out of blur, a quiet Geist Mono subtitle, a spring camera that never
// overshoots, and slow transitions. One accent (a cool pale blue), sentence case,
// solid text, no glow behind text.
//
// Credits. The look follows remocn's "premium" kit (MIT, remocn.dev): the backdrop
// palette (#12121a #232338 #3a3a5c #52527a on #050709), soft-blur-in and
// focus-blur-resolve timings, the glass-code-block card (1 px gradient ring, 60 %
// panel, 6 % inset highlight, 0 50px 120px shadow). The GLSL below is
// written for this style (a domain-warped value-noise field under a radial scrim).
import { stripEmphasis, emChars } from '../layout.js';
import { titleSpans } from '../plan.js';

const ACCENT = '#9bc8dd';       // remocn's release-teaser accent: a desaturated sky blue (L 0.82, C 0.06): it reads as cool white next to the graphite greys and never fights the app's own colours
const FG = '#f1f3f8';           // off-white with a hair of blue: pure white on near-black is harsh on video
const GROUND = '#050709';

// ---- helpers ---------------------------------------------------------------
const MONO_TRACK = '0.01em';

// ---- background -----------------------------------------------------------
// Own GLSL: a domain-warped, rotated value-noise field (3 octaves) read through the
// four-step graphite ramp (cool greys on the accent's hue, never violet), multiplied by an elliptical gaussian pool behind where
// the window sits. The pool is the radial scrim: light in the middle, falling to the
// ground at the edges, so there is nothing to see as a band. uP: 0 level (how far up
// the ramp the brightest point climbs), 1 drift (noise units a second).
const BACKGROUND_GLSL = `
float h21(vec2 p){ vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * f * (f * (f * 6. - 15.) + 10.);
  return mix(mix(h21(i), h21(i + vec2(1., 0.)), f.x), mix(h21(i + vec2(0., 1.)), h21(i + vec2(1., 1.)), f.x), f.y); }
float fbm(vec2 p){ float a = .5, s = 0.; mat2 m = mat2(.8, .6, -.6, .8); for (int i = 0; i < 3; i++) { s += a * vn(p); p = m * p * 2.03 + 7.1; a *= .5; } return s / .875; }
vec3 ramp(float x){ x = clamp(x, 0., 1.) * 4.;
  vec3 c = mix(uCol[0], uCol[1], clamp(x, 0., 1.));
  c = mix(c, uCol[2], clamp(x - 1., 0., 1.)); c = mix(c, uCol[3], clamp(x - 2., 0., 1.)); return mix(c, uCol[4], clamp(x - 3., 0., 1.)); }
vec3 background(vec2 uv, vec2 px, float t){
  float asp = uRes.x / uRes.y, s = t * uP[1];
  vec2 p = (uv - .5) * vec2(asp, 1.) * 1.45;
  vec2 q = vec2(fbm(p * .8 + vec2(0., s)), fbm(p * .8 + vec2(5.2, 1.3) - vec2(s, 0.)));
  float f = smoothstep(.2, .8, fbm(p * .85 + 1.1 * q + vec2(s * .6, 0.)));
  vec2 e = (uv - vec2(.5, .46)) / vec2(.6, .54);
  float pool = exp(-dot(e, e) * 1.45);
  float lvl = pool * (.68 + .32 * f) * uP[0];
  return ramp(lvl);
}`;

// ---- builders -------------------------------------------------------------
const build = {
  // The title: big, tight, wraps at word boundaries (the engine's own spans never break a line).
  title: (c) => {
    const { W, style, scene, fg } = c, t = style.title, effect = scene.effect ?? 'soft-blur-in';
    const text = stripEmphasis(scene.text ?? ''), n = Math.max(1, text.length);
    const base = W * t.size, maxW = W * 0.8, em = 0.5;          // 0.5 em a character: Geist at this tracking
    const track = t.tracking[effect] ?? -0.04;
    let size = base;
    if (effect === 'word-push') size = Math.max(W * 0.03, Math.min(base, (maxW * 1.12) / (n * em)));
    else if (Math.ceil((n * em * base) / maxW) > 2) size = Math.max(W * 0.034, (maxW * 2) / (n * em));
    let spans;
    if (effect === 'word-push') spans = titleSpans(c);
    else if (effect === 'micro-scale-fade') spans = `<span data-p="all" data-pad="32" style="display:inline-block;max-width:${maxW}px;text-wrap:balance">${c.rich(text === scene.text ? text : scene.text)}</span>`;
    else {
      // per glyph, grouped by word so a line can only break between words
      const chars = emChars(scene.text ?? '');
      const words = []; let cur = [];
      chars.forEach((ch, k) => { if (ch.c.trim()) cur.push({ ...ch, k }); else { if (cur.length) words.push(cur); cur = []; } });
      if (cur.length) words.push(cur);
      spans = words.map((w) => `<span style="display:inline-block;white-space:nowrap">${w.map((ch) => `<span data-p="c${ch.k}" data-pad="48" style="${ch.em ? `color:${c.accent};` : ''}display:inline-block;white-space:pre">${c.esc(ch.c)}</span>`).join('')}</span>`).join(' ');
    }
    const sub = c.has(scene.subtitle)
      ? `<div data-p="sub" data-pad="10" style="margin-top:${size * 0.34}px;font-family:${c.font('mono')};font-size:${W * t.subtitleSize}px;font-weight:400;letter-spacing:${MONO_TRACK};color:${fg};text-align:center;max-width:${maxW}px;line-height:1.35">${c.rich(scene.subtitle)}</div>` : '';
    return { html: `<div class="af" style="align-items:center;justify-content:center;font-family:${c.font('display')}">
      <div style="max-width:${maxW}px;text-align:center;font-size:${size}px;font-weight:${t.weight};line-height:1.06;letter-spacing:${track}em;color:${fg};${effect === 'word-push' ? 'white-space:nowrap;' : 'text-wrap:balance;'}">${spans}</div>${sub}</div>` };
  },

  // The issue card: remocn's dark glass. Gradient hairline ring, 60 % panel, inset top highlight, deep soft shadow.
  issue: (c) => {
    const { style, scene, fg, accent, u } = c, k = style.card, has = c.has;
    const bar = style.palette.tagColors?.Before ?? style.palette.danger;
    const mono = c.font('mono');
    const html = `<div class="af" style="align-items:center;justify-content:center;font-family:${c.font('text')}">
      <div id="card" style="position:relative;width:${k.width * u}px;padding:${k.padY * u}px ${k.padX * u}px;border-radius:${k.radius * u}px;background:rgba(10,10,12,0.62);box-shadow:inset 0 1px 0 rgba(255,255,255,0.06),0 ${50 * u}px ${120 * u}px rgba(0,0,0,0.55);display:flex;flex-direction:column;gap:${k.gap * u}px">
        <div style="position:absolute;inset:0;border-radius:inherit;padding:${Math.max(1, u)}px;background:linear-gradient(180deg,rgba(255,255,255,0.2),rgba(255,255,255,0.02) 55%,rgba(255,255,255,0));-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none"></div>
        ${has(scene.source) || has(scene.id) || has(scene.status) ? `<div style="display:flex;align-items:center;gap:${16 * u}px;font-family:${mono};font-size:${k.metaSize * u}px;font-weight:400;letter-spacing:${MONO_TRACK}">` : '<div>'}
          ${scene.source ? `<span style="color:${fg};opacity:0.62">${c.esc(scene.source)}</span>` : ''}
          ${scene.id ? `<span style="color:${fg}">${c.esc(scene.id)}</span>` : ''}
          ${scene.status ? `<span style="margin-left:auto;padding:${6 * u}px ${16 * u}px;border-radius:999px;background:${c.rgba(accent, k.statusAlpha)};box-shadow:inset 0 0 0 1px ${c.rgba(accent, 0.3)};color:${accent};font-family:${c.font('text')};font-size:${k.statusSize * u}px;font-weight:500">${c.esc(scene.status)}</span>` : ''}
        </div>
        ${has(scene.title) ? `<div class="piece" data-p="title" data-pad="12" style="font-size:${k.titleSize * u}px;font-weight:600;line-height:1.14;letter-spacing:-0.03em;color:${fg};text-wrap:balance">${c.rich(scene.title)}</div>` : ''}
        ${scene.quote ? `<div class="piece" data-p="quote" data-pad="12" style="border-left:${k.quoteBar * u}px solid ${bar};padding-left:${28 * u}px;font-size:${k.quoteSize * u}px;line-height:1.45;color:${fg}">“${c.rich(scene.quote)}”</div>` : ''}
        ${scene.reporter ? `<div class="piece" data-p="reporter" data-pad="12" style="font-family:${mono};font-size:${k.reporterSize * u}px;letter-spacing:${MONO_TRACK};color:${fg}">${c.rich(scene.reporter)}</div>` : ''}
      </div></div>`;
    return { html };
  },

  // The end list: a title, a quiet mono subtitle and hairline rows with a thin ring tick.
  list: (c) => {
    const { style, scene, fg, accent, u } = c, k = style.list, has = c.has;
    const icon = `<svg width="${k.iconSize * u}" height="${k.iconSize * u}" viewBox="0 0 24 24" style="flex-shrink:0"><circle cx="12" cy="12" r="10.8" fill="${c.rgba(accent, 0.08)}" stroke="${c.rgba(accent, 0.55)}" stroke-width="1.2"/><path d="M7.4 12.4l3 3 6.2-6.4" fill="none" stroke="${accent}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    const items = scene.items ?? [];
    return { html: `<div class="af" style="align-items:center;justify-content:center;font-family:${c.font('text')}">
      <div style="display:flex;flex-direction:column;gap:${k.gap * u}px;width:${k.width * u}px">
        ${has(scene.title) || has(scene.subtitle) ? '<div data-p="head" data-pad="12">' : '<div>'}
          ${has(scene.title) ? `<div style="font-family:${c.font('display')};font-size:${k.titleSize * u}px;font-weight:600;letter-spacing:-0.04em;color:${fg};line-height:1.08;text-wrap:balance">${c.rich(scene.title)}</div>` : ''}
          ${has(scene.subtitle) ? `<div style="${has(scene.title) ? `margin-top:${14 * u}px;` : ''}font-family:${c.font('mono')};font-size:${k.subtitleSize * u}px;letter-spacing:${MONO_TRACK};color:${fg};opacity:${k.subtitleOpacity}">${c.rich(scene.subtitle)}</div>` : ''}
        </div>
        <div style="display:flex;flex-direction:column">
          ${items.map((it, n) => `<div data-p="i${n}" data-pad="8" style="display:flex;align-items:center;gap:${28 * u}px;padding:${27 * u}px 0;${n === 0 ? `border-top:1px solid rgba(255,255,255,0.1);` : ''}border-bottom:1px solid rgba(255,255,255,0.1);font-size:${k.itemSize * u}px;font-weight:500;letter-spacing:-0.01em;color:${fg};line-height:1.25">${icon}<span>${c.rich(it)}</span></div>`).join('')}
        </div></div></div>` };
  },

  // The caption: dark glass, wraps (balanced) instead of overflowing, a mono tag whose colour is lifted to stay readable.
  caption: (c) => {
    const k = c.style.caption, p = k.glass, size = c.size, u = c.u, pos = c.pos;
    // After (the accent) is a filled chip, every other tag an outlined one: the difference is shape and fill, not a second hue
    const lit = c.tag && String(c.color).toLowerCase() === String(c.accent).toLowerCase();
    const tag = c.tag ? `<span style="${lit ? `background:${c.accent};color:${c.style.palette.onAccent};font-weight:600;` : `color:${c.color};box-shadow:inset 0 0 0 1px ${c.rgba(c.color, 0.5)};font-weight:500;`}font-family:${c.font('mono')};font-size:0.8em;letter-spacing:${MONO_TRACK};padding:0.14em 0.62em;border-radius:0.5em;flex-shrink:0;line-height:1.3">${c.esc(c.tag)}</span>` : '';
    return { html: `<div style="position:absolute;${pos.css};display:flex;align-items:center;justify-content:${pos.align};padding-left:${pos.padLeft}px">
      <div id="pill" style="display:inline-flex;align-items:center;gap:${size * 0.75}px;max-width:${c.W * 0.7}px;padding:${size * 0.62}px ${size * 1.15}px;border-radius:${p.radius * u}px;box-shadow:inset 0 0 0 1px ${p.border},inset 0 1px 0 rgba(255,255,255,0.07);font-family:${c.font('text')};font-size:${size}px;font-weight:${k.weight};line-height:1.32;letter-spacing:-0.005em;color:${k.color}">
        ${tag}<span data-type style="text-wrap:balance">${c.rich(c.text)}</span></div></div>` };
  },
};

export default {
  name: 'midnight',
  extends: 'studio',
  description: 'Depth and light: a near-black stage, a slow pool of cool grey light, a glass card and caption, one pale-blue accent.',
  suits: 'Launches, dark-mode products and anything that should feel calm and expensive.',

  palette: {
    background: GROUND,
    foreground: FG,
    accent: ACCENT,
    onAccent: GROUND,
    // One accent: After is lit, Before and Tour are neutral greys, not a second hue. All of them hold 4.5:1 on the dark glass.
    tagColors: { Before: '#c2c6d6', After: ACCENT, Tour: '#d7dae6' },
    tagFallback: '#d7dae6',
    danger: '#aeb3c6',
    // Colours a spec brings are kept as a trace only (92 % toward the neutral tag grey) so the frame keeps one accent, then lifted to 4.5:1
    // on the lightest glass a caption can sit on (a full-bleed white recording). A tag called After is the accent.
    mapAccent: (c, t) => t.ensureContrast(t.mix(c, ACCENT, 0.45), '#3e3f45', 4.5),   // a spec's accent is pulled partway to this style's own
    mapTag: (name, c, t) => (/^after$/i.test(name) ? t.palette.accent : t.ensureContrast(t.mix(c, '#d7dae6', 0.92), '#3e3f45', 4.5)),
  },
  logo: { filter: 'grayscale(1) invert(1) contrast(1.15)' },   // a dark logo on the dark ground: a quiet monochrome, no second hue
  fonts: {
    // Geist: tight, neutral, made for this size; Geist Mono for tags, ids and the subtitle.
    text: { family: 'Geist', weights: [400, 500, 600], fallback: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif" },
    display: { family: 'Geist', weights: [400, 500, 600], fallback: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif" },
    mono: { family: 'Geist Mono', weights: [400, 500], fallback: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
  },

  canvas: {
    matte: GROUND,
    model: 'shared',                                    // one background per frame; transitions pass through it, never through white
    background: {
      kind: 'shader', glsl: BACKGROUND_GLSL,
      colors: [GROUND, '#0e1215', '#1a2026', '#283139', '#384650'],   // remocn's premium backdrop, moved off violet: graphite on the accent's hue (oklch ~230), chroma under 0.03
      params: [0.55, 0.045],                             // level, drift (noise units a second)
    },
  },
  post: { dither: 2.5, grain: 0.014, grainSize: 1.4, vignette: 0.14, vignetteSoftness: 0.7 },

  window: {
    top: 0.05, maxHeight: 0.78,                         // leaves a roomy band for a two-line caption
    radius: 0.0105,
    fill: '#0b0c10',
    // lifted off the ground by offset and negative spread, no wide halo of black
    shadow: '0 50px 100px -24px rgba(0,0,0,0.7),0 18px 36px -14px rgba(0,0,0,0.5)',
    glow: { color: 'rgba(155,200,221,0.07)', blur: 220, spread: 12 },    // the screen lighting the room: wide, the accent's hue, under 12 % alpha
    shadowPad: 320,
    border: { width: 1, gradient: 'linear-gradient(180deg, rgba(255,255,255,0.2), rgba(255,255,255,0.03) 50%, rgba(255,255,255,0))' },
    highlight: { color: 'rgba(255,255,255,0.14)' },
    drift: { to: 1.028 },                               // no frame is static
  },

  caption: {
    variant: 'glass', placement: 'under', size: 0.0158, weight: 500, color: FG,
    enter: 'blur', blurPx: 10, blurSec: 0.42, delay: 0.3, exit: 0.4,
    // 78 % near-black: text stays above 4.5:1 even over a full-bleed white recording
    glass: { blur: 22, tint: 'rgba(8,9,12,0.78)', saturate: 1, border: 'rgba(255,255,255,0.12)', radius: 20, shadow: null },
    tag: { style: 'word', weight: 500 },
  },
  title: {
    size: 0.066, weight: 600, maxEnterSec: 0.95, subtitleSize: 0.0145, subtitleOpacity: 0.62, subtitleEnter: 'blur', measure: 'glyph',
    tracking: { 'word-push': -0.04, 'micro-scale-fade': -0.045, 'soft-blur-in': -0.045 },
  },
  card: {
    width: 1120, padX: 64, padY: 56, radius: 24, gap: 24,
    metaSize: 24, statusSize: 22, statusAlpha: 0.12, titleSize: 54, quoteSize: 32, reporterSize: 24,
    quoteBar: 3, shadowPad: 300, rowEnter: 'blur',
  },
  list: { width: 1240, gap: 46, titleSize: 88, subtitleSize: 28, subtitleOpacity: 0.62, itemSize: 44, iconSize: 40, itemEnter: 'blur' },
  callout: { ringWidth: 3.5, fillAlpha: 0.08, dimAlpha: 0.6, dimColor: '#030409', chip: { size: 24, weight: 600, padY: 8, padX: 16, radius: 999, background: null, color: null } },   // a filled accent chip like the lit After tag: one accent, whatever the spec brings

  motion: {
    card: { rise: 12, rows: [0.3, 0.55, 0.8], alpha: [1, 0.9, 0.74] },
    list: { headRise: 12, start: 0.5, step: 0.2, dx: 0 },
    text: {
      // remocn soft-blur-in: blur 12 to 0, rise 14 px, about 0.8 s on bezier(0.22,1,0.36,1); counts are output frames (tuned at 60 fps)
      softBlur: { stagger: 1, rise: 14, blur: 12, frames: 27, riseFrames: 9, staggerSec: 0.028, sec: 0.8, riseSec: 0.65, ease: [0.22, 1, 0.36, 1] },
      microScale: { frames: 18, from: 0.97, sec: 0.8, ease: [0.22, 1, 0.36, 1] },
      subtitle: { from: 0.7, to: 1.35, rise: 8 },
    },
  },
  camera: {
    ease: { type: 'spring', stiffness: 220, damping: 40, mass: 1 },   // overdamped: arrives without overshoot
    motionBlur: { shutter: 0.5, samples: 6 },
  },
  transition: {
    default: 'zoom-blur', sec: 0.7,
    params: {
      zoomBlur: { scaleIn: 0.96, scaleOut: 1.04, sigma: 10 },
      focusPull: { bright: 1.0, brightIn: 1.0, scaleOut: 1.04, scaleIn: 0.98, sigma: 14 },
      pushThrough: { scale: 1.1, scaleIn: 0.94, settle: 1.0, sigma: 10, sigmaIn: 0.6 },
      whipPan: { blur: 14, stretch: 0.06 },                    // the original's x1.3 is a flash on a dark ground
    },
  },
  build,
};
