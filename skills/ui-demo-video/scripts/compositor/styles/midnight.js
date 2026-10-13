// midnight: depth and light. A dark stage with one lit object on it: the recording
// is the only bright thing, everything else recedes. Near-black ground with a very
// slow muted blue-violet mesh that pools softly behind the window (never a stripe,
// never a blob), a dark-glass card and caption, a big tight Geist title that
// resolves out of blur, a quiet Geist Mono subtitle, a spring camera that never
// overshoots, and slow transitions. One accent (a cool pale blue), sentence case,
// solid text, no glow behind text.
//
// Credits. The look follows remocn's "premium" kit (MIT, remocn.dev): the backdrop
// palette (#12121a #232338 #3a3a5c #52527a on #050709), soft-blur-in and
// focus-blur-resolve timings, the glass-code-block card (1 px gradient ring, 60 %
// panel, 6 % inset highlight, 0 50px 120px shadow) and the grain-dissolve transition's
// shape (a grainy noise threshold between two blurred scenes). The GLSL below is
// written for this style (a domain-warped value-noise field under a radial scrim).
import { stripEmphasis, emChars } from '../layout.js';
import { titleSpans } from '../plan.js';
import { parseColor } from '../color.js';

const ACCENT = '#9bc8dd';       // remocn's release-teaser accent: a desaturated sky blue (L 0.82, C 0.06): it reads as cool white next to the blue-violet greys and never fights the app's own colours
const FG = '#f1f3f8';           // off-white with a hair of blue: pure white on near-black is harsh on video
const GROUND = '#050709';

// ---- helpers ---------------------------------------------------------------
const lum = (c) => { const k = parseColor(c); if (!k) return null; const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(k[0]) + 0.7152 * f(k[1]) + 0.0722 * f(k[2]); };
/** A text colour that holds 4.5:1 even on the lightest glass (a caption over a white recording): mixes an unreadable one toward white. */
const lift = (c, floor = 0.42) => {
  const k = parseColor(c); const L = lum(c);
  if (!k || L === null || L >= floor) return c;
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const m = k.slice(0, 3).map((v) => Math.round(v + (255 - v) * t));
    const col = `rgb(${m.join(',')})`;
    if (lum(col) >= floor) return col;
  }
  return '#ffffff';
};
/** A tag colour the spec brought in: its hue is kept only as a trace (60 % toward the neutral tag grey), so the frame still has one accent; then lifted to be legible. */
const OWN_TAGS = new Set(['#9bc8dd', '#aeb3c6', '#d7dae6']);
const tame = (c) => {
  const k = parseColor(c);
  if (!k || OWN_TAGS.has(String(c).toLowerCase())) return lift(c);
  const n = [0xd7, 0xda, 0xe6], m = k.slice(0, 3).map((v, i) => Math.round(v * 0.4 + n[i] * 0.6));
  return lift(`rgb(${m.join(',')})`);
};
const MONO_TRACK = '0.01em';

// ---- background -----------------------------------------------------------
// Own GLSL: a domain-warped, rotated value-noise field (3 octaves) read through the
// four-step blue-violet ramp, multiplied by an elliptical gaussian pool behind where
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

// ---- the grain dissolve (act breaks) ----------------------------------------
// remocn's grain-dissolve, rebuilt as a pure function of the two layers: the old scene
// blurs and melts away through a low-frequency noise threshold with a fine grain on
// the edge, the new one resolves out of blur behind it. It is slow (2.2 s here; remocn's is
// 2.5 s) so it suits an act break, not every cut.
const GRAIN_DISSOLVE = `
float gh(vec2 p){ vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float gn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(gh(i), gh(i + vec2(1., 0.)), f.x), mix(gh(i + vec2(0., 1.)), gh(i + vec2(1., 1.)), f.x), f.y); }
float gf(vec2 p){ return .55 * gn(p) + .3 * gn(p * 2.1 + 3.7) + .15 * gn(p * 4.3 + 9.1); }
vec4 gblur(bool from, vec2 uv, float r){
  if (r < .4) return from ? getFrom(uv) : getTo(uv);
  vec4 s = vec4(0.); float tw = 0.; vec2 px = r / uRes;
  for (int i = 0; i < 12; i++) { float a = float(i) * 2.39996, d = sqrt((float(i) + .5) / 12.);
    vec2 o = vec2(cos(a), sin(a)) * d * px; float w = 1. - .5 * d;
    s += (from ? getFrom(uv + o) : getTo(uv + o)) * w; tw += w; }
  return s / tw;
}
vec4 transition(vec2 uv){
  float p = uProgress, e = p * p * (3. - 2. * p), k = uRes.y / 1080.;
  float n = gf(uv * vec2(uRes.x / uRes.y, 1.) * 3.2);
  float g = gh(floor(uv * uRes / (2. * k)) + floor(p * 24.));
  float t = e * 1.7 - .35 - (n - .5) * 1.0 - g * .12;
  float vis = smoothstep(0., .4, t);
  vec4 a = gblur(true, uv, 20. * k * smoothstep(0., .6, e));
  vec4 b = gblur(false, uv, 20. * k * (1. - smoothstep(.4, 1., e)));
  return a * (1. - vis) * (1. - smoothstep(.55, 1., e)) + b * vis;
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
    const bar = lift(style.palette.tagColors?.Before ?? style.palette.danger, 0.3);
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
          ${items.map((it, n) => `<div data-p="i${n}" data-pad="8" style="display:flex;align-items:center;gap:${22 * u}px;padding:${18 * u}px 0;${n === 0 ? `border-top:1px solid rgba(255,255,255,0.1);` : ''}border-bottom:1px solid rgba(255,255,255,0.1);font-size:${k.itemSize * u}px;font-weight:500;letter-spacing:-0.01em;color:${fg};line-height:1.25">${icon}<span>${c.rich(it)}</span></div>`).join('')}
        </div></div></div>` };
  },

  // The caption: dark glass, wraps (balanced) instead of overflowing, a mono tag whose colour is lifted to stay readable.
  caption: (c) => {
    const k = c.style.caption, p = k.glass, size = c.size, u = c.u, pos = c.pos;
    const tag = c.tag ? `<span style="color:${tame(c.color)};font-family:${c.font('mono')};font-weight:500;font-size:0.84em;letter-spacing:${MONO_TRACK};flex-shrink:0">${c.esc(c.tag)}</span>` : '';
    return { html: `<div style="position:absolute;${pos.css};display:flex;align-items:center;justify-content:${pos.align};padding-left:${pos.padLeft}px">
      <div id="pill" style="display:inline-flex;align-items:center;gap:${size * 0.75}px;max-width:${c.W * 0.78}px;padding:${size * 0.62}px ${size * 1.15}px;border-radius:${p.radius * u}px;box-shadow:inset 0 0 0 1px ${p.border},inset 0 1px 0 rgba(255,255,255,0.07);font-family:${c.font('text')};font-size:${size}px;font-weight:${k.weight};line-height:1.32;letter-spacing:-0.005em;color:${k.color}">
        ${tag}<span data-type style="text-wrap:balance">${c.rich(c.text)}</span></div></div>` };
  },
};

export default {
  name: 'midnight',
  extends: 'studio',
  description: 'Depth and light: a near-black stage, a slow blue-violet pool of light, a glass card and caption, one pale-blue accent.',
  suits: 'Launches, dark-mode products and anything that should feel calm and expensive.',

  palette: {
    background: GROUND,
    foreground: FG,
    accent: ACCENT,
    onAccent: GROUND,
    // One accent: After is lit, Before and Tour are neutral greys, not a second hue. All of them hold 4.5:1 on the dark glass.
    tagColors: { Before: '#aeb3c6', After: ACCENT, Tour: '#d7dae6' },
    tagFallback: '#d7dae6',
    danger: '#aeb3c6',
  },
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
      colors: [GROUND, '#12121a', '#232338', '#3a3a5c', '#52527a'],   // remocn premium backdrop
      params: [0.5, 0.045],                             // level, drift (noise units a second)
    },
  },
  post: { dither: 2.5, grain: 0.014, grainSize: 1.4, vignette: 0.14, vignetteSoftness: 0.7 },

  window: {
    top: 0.05, maxHeight: 0.78,                         // leaves a roomy band for a two-line caption
    radius: 0.0105,
    fill: '#0b0c10',
    // lifted off the ground by offset and negative spread, no wide halo of black
    shadow: '0 50px 100px -24px rgba(0,0,0,0.7),0 18px 36px -14px rgba(0,0,0,0.5)',
    glow: { color: 'rgba(140,165,230,0.085)', blur: 220, spread: 12 },   // the screen lighting the room: wide, cool, under 12 % alpha
    shadowPad: 320,
    border: { width: 1, color: 'rgba(255,255,255,0.1)' },
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
    size: 0.06, weight: 600, subtitleSize: 0.0145, subtitleOpacity: 0.62, subtitleEnter: 'blur', measure: 'glyph',
    tracking: { 'word-push': -0.04, 'micro-scale-fade': -0.045, 'soft-blur-in': -0.045 },
  },
  card: {
    width: 1120, padX: 64, padY: 56, radius: 24, gap: 24,
    metaSize: 24, statusSize: 22, statusAlpha: 0.12, titleSize: 54, quoteSize: 32, reporterSize: 24,
    quoteBar: 3, shadowPad: 300, rowEnter: 'blur',
  },
  list: { width: 1100, gap: 34, titleSize: 68, subtitleSize: 26, subtitleOpacity: 0.62, itemSize: 36, iconSize: 32, itemEnter: 'blur' },
  callout: { ringWidth: 2.5, fillAlpha: 0.05, dimAlpha: 0.6, dimColor: '#030409', chip: { size: 24, weight: 600, padY: 8, padX: 16, radius: 999, background: 'rgba(8,9,12,0.92)', color: ACCENT } },

  motion: {
    card: { rise: 12, rows: [0.3, 0.55, 0.8], alpha: [1, 0.9, 0.74] },
    list: { headRise: 12, start: 0.5, step: 0.2, dx: 0 },
    text: {
      // remocn soft-blur-in: blur 12 to 0, rise 14 px, about 0.8 s on bezier(0.22,1,0.36,1); counts are output frames (tuned at 60 fps)
      softBlur: { stagger: 1, rise: 14, blur: 12, frames: 50, riseFrames: 42, ease: [0.22, 1, 0.36, 1] },
      microScale: { frames: 24, from: 0.97, ease: [0.22, 1, 0.36, 1] },
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
      zoomBlur: { scaleIn: 0.94, scaleOut: 1.07, sigma: 14 },
      focusPull: { bright: 1.02, brightIn: 1.02 },                    // the original's x1.3 is a flash on a dark ground
    },
    custom: { 'grain-dissolve': { sec: 2.2, stepped: false, glsl: GRAIN_DISSOLVE } },
  },
  build,
};
