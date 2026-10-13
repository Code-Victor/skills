// sketch: a teammate's annotated photo board. The recording is the one smooth
// thing, a photograph pinned to cream paper; everything around it is drawn by
// hand and moves in held poses (10 a second, seeded jitter, never smooth).
//
// Direction and numbers adapted from remocn's "paper" kit (MIT, github.com/kapishdima/remocn):
// stop-motion clock and jitter, handwrite (Caveat, per-character slant and baseline),
// brush ribbons with pressure and grain, scribble-circle, ink-arrow, ink-underline,
// paper-sticker, check-list, marker-highlight, polaroid. The path maths and the
// hand-written pieces below are re-implemented for this engine's HTML+SVG builders.
//
// What this file does, in order: utilities and Caveat's measured advance widths
// (so Node can lay text out exactly), the brush (variable-width ribbons with a
// pencil grain filter), the hand-made primitives (scribble circle, arrow,
// underline, tick, wobbly box, marker highlight, paper), the builders, then the
// style tokens. `lab` is exported for the primitive test sheet only.
import { parseEmphasis, emChars, emWords, esc } from '../layout.js';

// ------------------------------------------------------------------ palette
const PAPER = '#F5F3EE';      // the board
const NOTE = '#FBFAF6';       // sticker / note paper
const FRAME = '#FDFCF8';      // the photo print
const INK = '#26242C';
const RED = '#D8503A';        // red pencil: marks
const RED_TXT = '#BE3F2A';    // the same red, deep enough for text (4.5:1 on the paper)
const OLIVE = '#6F7F35';      // ticks
const OLIVE_TXT = '#5B6A2A';
const SHADOW = '0 12px 30px rgba(38,36,44,0.18), 0 3px 7px rgba(38,36,44,0.12)';   // remocn's print shadow x1.5 (1920)

// ------------------------------------------------------------------ utilities
const hashStr = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } h ^= h >>> 13; h = Math.imul(h, 2246822519); return (h ^ (h >>> 16)) >>> 0; };
const rng = (seed) => { let a = (typeof seed === 'string' ? hashStr(seed) : seed) >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const hr = (seed, lo, hi) => lo + rng(seed)() * (hi - lo);
const n2 = (v) => Math.round(v * 100) / 100;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// Caveat's advance widths (em x 1000), measured in Chrome with kerning and ligatures off,
// which is exactly how this file sets type (one inline-block per character).
const GLYPHS = "0123456789 !\"#$%&'()*+,-./:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~’‘“”–—…éèàüöäñç·•";
const A600 = [450,450,450,450,450,439,464,447,450,442,242,210,237,559,450,600,564,117,330,330,363,446,198,326,198,330,198,198,446,446,446,374,643,508,522,475,584,532,462,492,570,406,312,505,426,726,612,502,467,495,542,492,458,482,490,720,524,504,522,330,330,330,446,446,353,443,441,361,399,331,297,361,470,193,210,371,175,566,456,359,378,377,360,347,331,370,331,517,343,341,315,330,330,330,446,117,117,267,267,446,566,594,325,325,437,370,353,437,450,355,187,187];
const A700 = [450,450,450,450,450,434,471,446,450,438,242,210,237,559,450,600,564,117,330,330,363,446,198,326,198,330,198,198,446,446,446,374,643,511,523,477,587,534,466,494,574,409,315,508,426,729,619,505,468,492,544,495,458,482,490,720,524,504,522,330,330,330,446,446,353,446,444,364,402,334,300,364,473,196,213,374,178,569,459,362,378,377,360,350,331,370,331,517,343,341,315,330,330,330,446,117,117,267,267,446,566,594,325,325,437,370,353,437,450,355,187,187];
const ADV = (() => { const m6 = {}, m7 = {}; [...GLYPHS].forEach((g, i) => { m6[g] = A600[i] / 1000; m7[g] = A700[i] / 1000; }); return { 600: m6, 700: m7 }; })();
const adv = (ch, weight = 700) => (weight >= 650 ? ADV[700] : ADV[600])[ch] ?? 0.42;
const FONT = { asc: 0.96, desc: 0.3, xh: 0.365, cap: 0.723 };
/** Width of a string in px (no kerning: one box per character). */
const measure = (s, size, weight = 700, track = 0) => [...String(s)].reduce((w, ch) => w + (adv(ch, weight) + track) * size, 0);

/** Greedy word wrap on measured widths: lines of plain strings (spaces between words dropped at breaks). */
const wrapWords = (words, size, maxW, weight, track = 0, firstIndent = 0) => {
  const sp = measure(' ', size, weight, track), lines = [[]]; let w = firstIndent;
  for (const word of words) {
    const ww = measure(word, size, weight, track);
    const cur = lines[lines.length - 1];
    if (cur.length && w + sp + ww > maxW) { lines.push([word]); w = ww; } else { w += (cur.length ? sp : 0) + ww; cur.push(word); }
  }
  return lines.map((l) => l.join(' '));
};
/** Same, but balanced: when it wraps, the lines come out near equal rather than one full and one orphan. */
const wrapBalanced = (text, size, maxW, weight, track = 0, indent = 0) => {
  const words = String(text).split(/\s+/).filter(Boolean);
  let lines = wrapWords(words, size, maxW, weight, track, indent);
  if (lines.length < 2) return lines;
  let lo = Math.max(measure(words.reduce((a, b) => (b.length > a.length ? b : a), ''), size, weight, track), 0), hi = maxW;
  for (let i = 0; i < 14; i++) {   // shrink the measure while the line count holds
    const mid = (lo + hi) / 2, t = wrapWords(words, size, mid, weight, track, indent);
    if (t.length <= lines.length) { lines = t; hi = mid; } else lo = mid;
  }
  return lines;
};

// ------------------------------------------------------------------ the brush
// Variable-width ribbon along a spine (remocn's brushRibbon, with a pressure profile
// and a slow wobble in the width), drawn through a grain filter so the edge is not
// vector-clean and the fill breaks up like pencil on paper.
const normalAt = (pts, i) => { const a = pts[i - 1] ?? pts[i], b = pts[i + 1] ?? pts[i]; const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1; return { x: -dy / l, y: dx / l }; };
const curve = (pts) => pts.slice(0, -1).map((p1, i) => {
  const p0 = pts[i - 1] ?? p1, p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
  return `C${n2(p1.x + (p2.x - p0.x) / 6)} ${n2(p1.y + (p2.y - p0.y) / 6)},${n2(p2.x - (p3.x - p1.x) / 6)} ${n2(p2.y - (p3.y - p1.y) / 6)},${n2(p2.x)} ${n2(p2.y)}`;
}).join('');
/** profile(t) -> 0..1 gives the pressure at fraction t of the whole stroke; `progress` draws only the first part. */
const ribbon = (spine, { width, profile, progress = 1, seed = 'r' }) => {
  const N = spine.length, drawn = clamp(Math.round(progress * (N - 1)) + 1, 2, N), r = rng(`${seed}:w`), ph = r() * 6.28, ph2 = r() * 6.28;
  const L = [], R = [];
  for (let i = 0; i < drawn; i++) {
    const t = i / (N - 1), wob = 1 + 0.1 * Math.sin(ph + t * 14) + 0.06 * Math.sin(ph2 + t * 31);
    const h = (width / 2) * profile(t) * wob, nr = normalAt(spine, i);
    L.push({ x: spine[i].x + nr.x * h, y: spine[i].y + nr.y * h });
    R.push({ x: spine[i].x - nr.x * h, y: spine[i].y - nr.y * h });
  }
  const back = R.slice().reverse();
  const cap = (p, h) => `<circle cx="${n2(p.x)}" cy="${n2(p.y)}" r="${n2(h)}"/>`;
  const h0 = Math.hypot(L[0].x - R[0].x, L[0].y - R[0].y) / 2, h1 = Math.hypot(L[drawn - 1].x - R[drawn - 1].x, L[drawn - 1].y - R[drawn - 1].y) / 2;
  return `<path d="M${n2(L[0].x)} ${n2(L[0].y)}${curve(L)}L${n2(back[0].x)} ${n2(back[0].y)}${curve(back)}Z"/>${cap(spine[0], h0)}${cap(spine[drawn - 1], h1)}`;
};
const sampleCubic = (a, b, c, d, n = 32) => Array.from({ length: n }, (_, i) => { const t = i / (n - 1), u = 1 - t; return { x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x, y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y }; });
const sampleLine = (a, b, n = 8) => Array.from({ length: n }, (_, i) => ({ x: a.x + (b.x - a.x) * i / (n - 1), y: a.y + (b.y - a.y) * i / (n - 1) }));
/** A polyline walked by a shaky hand: `sub` points per side, each off the line by a seeded amount. */
const shaky = (pts, { sub = 6, amp = 1, seed = 'p' } = {}) => {
  const out = [], r = rng(`${seed}:s`);
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k], b = pts[k + 1], dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
    for (let i = 0; i < sub; i++) { const t = i / sub, bow = Math.sin(Math.PI * t) * amp * 0.5, e = (r() - 0.5) * amp * 0.5; out.push({ x: a.x + dx * t + nx * (bow + e), y: a.y + dy * t + ny * (bow + e) }); }
  }
  out.push(pts[pts.length - 1]);
  return out;
};

/** Grain + rough edge for a pencil or marker stroke. `box` = [x, y, w, h] of the filter region in user space. */
const pencil = (id, { rough = 1.6, grain = 1, seed = 1, box = [-50, -50, 2000, 1200], freq = 0.045 } = {}) => `<filter id="${id}" filterUnits="userSpaceOnUse" x="${box[0]}" y="${box[1]}" width="${box[2]}" height="${box[3]}" color-interpolation-filters="sRGB">
<feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="2" seed="${seed}" result="n1"/>
<feDisplacementMap in="SourceGraphic" in2="n1" scale="${n2(rough)}" xChannelSelector="R" yChannelSelector="G" result="d"/>
<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${seed + 5}" result="n2"/>
<feColorMatrix in="n2" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 ${n2(-3 * grain)} ${n2(1.2 + 1.25 * grain)}" result="m"/>
<feComposite in="d" in2="m" operator="in"/></filter>`;
/** A light edge wobble for ink on type (no grain): the pen bleeds a little. */
const inkBleed = (id, { rough = 1.2, seed = 3 } = {}) => `<filter id="${id}" x="-5%" y="-10%" width="110%" height="120%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="${seed}" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="${n2(rough)}" xChannelSelector="R" yChannelSelector="G"/></filter>`;

/** Wrap strokes (ribbons) in a group with the grain filter. `ops` is the ribbons' markup. */
const stroke = (id, color, ops, o = {}) => `<defs>${pencil(id, o)}</defs><g fill="${color}" fill-opacity="${o.alpha ?? 0.92}" filter="url(#${id})">${ops}</g>`;

// ------------------------------------------------------------------ hand-made primitives
const ellipsePt = (a, b, n, th) => { const c = Math.cos(th), s = Math.sin(th); return { x: a * Math.sign(c) * Math.abs(c) ** (2 / n), y: b * Math.sign(s) * Math.abs(s) ** (2 / n) }; };

/**
 * remocn's scribble-circle: an ellipse with seeded wobble that overshoots its own start
 * (laps > 1 and a radius that drifts, so the end crosses the beginning instead of closing it).
 * Returns the spine in the local frame (centre 0,0) and a function that draws a fraction of it.
 */
const scribbleSpine = ({ rx, ry, seed = 'c', laps = 1.16, n = 2.5, points = 76 }) => {
  const r = rng(`${seed}:circle`), th0 = -2.35 + (r() - 0.5) * 0.9, dir = r() < 0.5 ? 1 : -1;
  const p1 = r() * 6.28, p2 = r() * 6.28, p4 = r() * 6.28, p5 = r() * 6.28, drift = 0.05 + r() * 0.035, cx = (r() - 0.5) * 0.04, cy = (r() - 0.5) * 0.04, tilt = (r() - 0.5) * 0.12;
  const cnt = Math.ceil(laps * points), rn = rng(`${seed}:noise`), ct = Math.cos(tilt), st = Math.sin(tilt);
  return Array.from({ length: cnt }, (_, i) => {
    const t = i / (cnt - 1), th = th0 + dir * laps * Math.PI * 2 * t;
    // egg-shaped (angle harmonics: the same on every lap), a drift in size along the stroke, and a little tremor
    const k = 0.965 + drift * t + 0.034 * Math.sin(th + p4) + 0.024 * Math.sin(2 * th + p5) + 0.016 * Math.sin(p1 + t * 9) + 0.01 * Math.sin(p2 + t * 23) + (rn() - 0.5) * 0.012;
    const q = ellipsePt(rx * k, ry * k, n, th), x = q.x + cx * rx * (0.5 + t), y = q.y + cy * ry * (0.5 + t);
    return { x: x * ct - y * st, y: x * st + y * ct };
  });
};
const circleProfile = (t) => (0.2 + 0.8 * smooth(0, 0.58, t)) * (1 - 0.4 * smooth(0.9, 1, t));
const scribbleCircle = ({ w, h, width, color = RED, progress = 1, seed = 'c', laps, n, id = 'sc', margin }) => {
  const m = margin ?? width * 0.75, rx = w / 2 - m, ry = h / 2 - m;
  const spine = scribbleSpine({ rx, ry, seed, laps, n }).map((p) => ({ x: p.x + w / 2, y: p.y + h / 2 }));
  return stroke(id, color, ribbon(spine, { width, profile: circleProfile, progress, seed }), { rough: width * 0.45, seed: 1 + (hashStr(seed) % 90), grain: 0.9, box: [-40, -40, w + 80, h + 80] });
};

/** remocn's ink-arrow: a bowed shaft with a hand-drawn head (two arms), pose by pose. */
const inkArrow = ({ from, to, width, color = RED, shaft = 1, armL = 0, armR = 0, bow = 0.3, seed = 'a', id = 'ar', box }) => {
  const dx = to.x - from.x, dy = to.y - from.y, d = Math.hypot(dx, dy) || 1, nx = -dy / d, ny = dx / d, r = rng(`${seed}:arrow`), wob = d * 0.05;
  const at = (t) => ({ x: from.x + dx * t + nx * bow * d + (r() - 0.5) * 2 * wob, y: from.y + dy * t + ny * bow * d + (r() - 0.5) * 2 * wob });
  const c1 = at(0.3), c2 = at(0.7);
  const spine = sampleCubic(from, c1, c2, to, 36);
  let ops = ribbon(spine, { width, profile: (t) => 0.3 + 0.7 * smooth(0, 0.5, t), progress: shaft, seed });
  // the head: two arms from just past the tip, back along the shaft's last direction
  const ex = to.x - c2.x, ey = to.y - c2.y, el = Math.hypot(ex, ey) || 1, bx = -ex / el, by = -ey / el, reach = Math.max(width * 2.8, d * 0.26);
  const arm = (a) => ({ x: to.x + reach * (bx * Math.cos(a) - by * Math.sin(a)), y: to.y + reach * (bx * Math.sin(a) + by * Math.cos(a)) });
  const apex = { x: to.x + (ex / el) * reach * 0.1, y: to.y + (ey / el) * reach * 0.1 };
  const armOps = (tip, p, k) => (p > 0 ? ribbon(shaky(sampleLine(apex, tip, 3), { sub: 4, amp: width * 0.35, seed: `${seed}:arm${k}` }), { width: width * 0.9, profile: (t) => 1 - 0.55 * t, progress: p, seed: `${seed}${k}` }) : '');
  ops += armOps(arm(0.72), armL, 'l') + armOps(arm(-0.72), armR, 'r');
  return stroke(id, color, ops, { rough: width * 0.4, seed: 2 + (hashStr(seed) % 90), grain: 0.85, box: box ?? [-300, -300, 2400, 1600] });
};

/** remocn's ink-underline, swashed: a long stroke that lifts toward the end, and a short second stroke under it. */
const underlineSpine = (x0, x1, y, seed, thick) => {
  const r = rng(`${seed}:ul`), tilt = (r() - 0.35) * thick * 1.6, w = x1 - x0, wob = (r() - 0.5) * thick * 1.2;
  return sampleCubic({ x: x0, y: y + thick * 0.2 }, { x: x0 + w * 0.3, y: y + wob }, { x: x0 + w * 0.7, y: y - wob * 0.6 }, { x: x1, y: y - tilt }, 44);
};
const underlineOps = (x0, x1, y, thick, seed, progress = 1) => {
  let ops = ribbon(underlineSpine(x0, x1, y, seed, thick), { width: thick, profile: (t) => 0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, t * 1.15)) * 0.9 + 0.1 * t, progress, seed });
  const w = x1 - x0, y2 = y + thick * 1.25;
  ops += ribbon(underlineSpine(x0 + w * 0.22, x0 + w * 0.8, y2, `${seed}b`, thick * 0.85), { width: thick * 0.7, profile: (t) => 0.45 + 0.55 * Math.sin(Math.PI * clamp(t * 1.2)), progress: clamp((progress - 0.15) / 0.85), seed: `${seed}b` });
  return ops;
};

/** A hand-wobbled square (about `size`), strokes of `width`; the start overshoots the last corner. */
const wobblyBox = ({ size, width, color = INK, seed = 'b', id = 'bx', progress = 1, ox = 0, oy = 0 }) => {
  const r = rng(`${seed}:box`), nud = () => (r() - 0.5) * size * 0.1, lo = size * 0.08, hi = size - lo;
  const c = [[lo + nud(), lo + nud()], [hi + nud(), lo + nud()], [hi + nud(), hi + nud()], [lo + nud(), hi + nud()], [lo + nud() - 2, lo + size * 0.12]];
  const pts = c.map(([x, y]) => ({ x: x + ox, y: y + oy }));
  const spine = shaky(pts, { sub: 7, amp: size * 0.07, seed });
  return stroke(id, color, ribbon(spine, { width, profile: (t) => 0.7 + 0.3 * Math.sin(Math.PI * t) + 0.1, progress, seed }), { rough: width * 0.5, seed: 4, grain: 0.7, alpha: 0.9, box: [-30 + ox, -30 + oy, size + 60, size + 60] });
};
/** remocn's tick path, in `parts` poses from nothing to the whole mark (parts 1..2: down-stroke, then the long up-stroke). */
const tickOps = (size, width, seed, progress = 1, ox = 0, oy = 0) => {
  const r = rng(`${seed}:tick`), j = () => (r() - 0.5) * size * 0.06;
  const pts = [{ x: size * 0.2 + j(), y: size * 0.54 + j() }, { x: size * 0.42 + j(), y: size * 0.8 + j() }, { x: size * 0.92 + j(), y: size * 0.08 + j() }].map((p) => ({ x: p.x + ox, y: p.y + oy }));
  return ribbon(shaky(pts, { sub: 9, amp: size * 0.04, seed }), { width, profile: (t) => 0.8 + 0.3 * Math.sin(Math.PI * t), progress, seed });
};

/** The highlighter behind a word: a ragged-ended slab, a hair off level, in the tag colour. Returns an svg sized w x h. */
const markerSlab = (w, h, color, seed, alpha = 0.4) => {
  const r = rng(`${seed}:mk`), ex = h * 0.12, top = h * 0.2, bot = h * 0.9, sk = (r() - 0.5) * h * 0.06;
  const P = [[-ex + r() * 4, top + r() * 3 + sk], [w * 0.5, top - 1 + r() * 3], [w + ex - r() * 3, top + 2 + r() * 3 - sk], [w + ex + 3, (top + bot) / 2 + r() * 3], [w + ex - r() * 4, bot - r() * 3 - sk], [w * 0.5, bot + r() * 3], [-ex + r() * 3, bot - 2 + r() * 3 + sk], [-ex - 3, (top + bot) / 2 + r() * 3]];
  const d = `M${P.map((p) => `${n2(p[0])} ${n2(p[1])}`).join('L')}Z`;
  const id = `mk${hashStr(seed) % 9999}`;
  return `<svg width="${n2(w + ex * 2 + 10)}" height="${n2(h)}" viewBox="${n2(-ex - 5)} 0 ${n2(w + ex * 2 + 10)} ${n2(h)}" style="max-width:none;position:absolute;left:${n2(-ex - 5)}px;top:0;overflow:visible;mix-blend-mode:multiply"><defs>${pencil(id, { rough: h * 0.05, grain: 0.35, seed: 6, box: [-ex - 20, -10, w + ex * 2 + 40, h + 20], freq: 0.06 })}</defs><path d="${d}" fill="${color}" fill-opacity="${alpha}" filter="url(#${id})"/></svg>`;
};

/** Fine paper fibre as a tiled CSS background image (an svg image of fractal noise: it never moves, and it hides with its element). */
const noiseUrl = ({ seed = 1, opacity = 0.1, freq = 0.8, tile = 256 } = {}) => {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${tile}' height='${tile}'><filter id='n' x='0' y='0' width='100%' height='100%' color-interpolation-filters='sRGB'><feTurbulence type='fractalNoise' baseFrequency='${freq}' numOctaves='3' seed='${seed}' stitchTiles='stitch'/><feColorMatrix type='matrix' values='0 0 0 0 0.15  0 0 0 0 0.14  0 0 0 0 0.17  0 0 0 -1.6 1.05'/></filter><rect width='100%' height='100%' filter='url(#n)' opacity='${opacity}'/></svg>`;
  const enc = encodeURIComponent(svg).replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/'/g, '%27');   // safe inside style="..." and an unquoted url()
  return `url(data:image/svg+xml,${enc})`;
};
const GRAIN = noiseUrl({ seed: 7, opacity: 0.1 });
const PAPER_CSS = `${GRAIN},#FAF8F3`;     // a touch lighter under the grain, which darkens it to about #F5F3EE

// ------------------------------------------------------------------ hand-set type
const charSpan = (ch, i, o) => {
  const r = rng(`${o.seed}:${i}`), rot = (r() * 2 - 1) * (o.slant ?? 3), dy = (r() * 2 - 1) * (o.base ?? 1.5);
  const a = adv(ch, o.weight), wpx = n2((a + (o.track ?? 0)) * o.size), lh = n2(o.size * (o.lh ?? 1.2));
  const color = o.colorOf ? o.colorOf(i) : o.color;
  return `<span style="display:inline-block;width:${wpx}px;height:${lh}px;line-height:${lh}px;color:${color};transform:translateY(${n2(dy)}px) rotate(${n2(rot)}deg);transform-origin:${n2(wpx / 2)}px ${n2(lh * 0.7)}px">${esc(ch)}</span>`;
};
/** One line of hand-set text: per-character slant and baseline wobble from a seed. `chars` = array of { c, em }. */
const handLine = (chars, o) => {
  const accent = o.accent ?? RED_TXT;
  return `<div style="display:flex;white-space:pre;height:${n2(o.size * (o.lh ?? 1.2))}px;font-family:${o.family};font-weight:${o.weight};font-size:${n2(o.size)}px">${chars.map((ch, i) => charSpan(ch.c, (o.i0 ?? 0) + i, { ...o, color: ch.em ? accent : o.color })).join('')}</div>`;
};
const toChars = (text) => emChars(text);
const plain = (text) => parseEmphasis(text).map((r) => r.t).join('');
/** Chars of a plain string, with emphasis flags kept, for lines that were wrapped on the plain text. */
const sliceChars = (chars, lines) => {
  let k = 0; const out = [];
  for (const ln of lines) {
    while (k < chars.length && chars[k].c === ' ' && out.length && out[out.length - 1].end) k++;
    const part = []; let m = 0;
    while (m < ln.length && k < chars.length) { part.push(chars[k]); k++; m++; }
    out.push({ chars: part, end: true });
    while (k < chars.length && chars[k].c === ' ') k++;
  }
  return out;
};
const lineWidth = (chars, size, weight, track = 0) => chars.reduce((w, ch) => w + (adv(ch.c, weight) + track) * size, 0);

/**
 * An invisible row of characters the "type" entrance measures: it reveals left to right at the glyph
 * edges of THIS row (a wrapped text has one row per line, which the engine would reveal line by line
 * with the clip jumping back; one sweep along the longest line reveals them all together instead).
 * `lead` = widths of invisible spacers before the text (a checkbox, a tag).
 */
const sweepRow = ({ lead = [], text = '', size, weight, left = 0, top = 0, track = 0 }) => {
  const sp = lead.map((w) => `<span style="display:inline-block;width:${n2(w)}px;text-align:right;font-size:1px;line-height:1">.</span>`).join('');
  const t = [...text].map((ch) => `<span style="display:inline-block;width:${n2((adv(ch, weight) + track) * size)}px;font-size:${n2(size)}px;line-height:1.2">${esc(ch)}</span>`).join('');
  return `<div data-type aria-hidden="true" style="position:absolute;left:${n2(left)}px;top:${n2(top)}px;display:flex;white-space:pre;color:transparent;font-family:inherit;font-weight:${weight}">${sp}${t}</div>`;
};

// ------------------------------------------------------------------ exports for the primitive sheet
export const lab = { INK, RED, RED_TXT, OLIVE, PAPER, NOTE, FRAME, SHADOW, scribbleCircle, inkArrow, underlineOps, stroke, wobblyBox, tickOps, markerSlab, noiseUrl, handLine, toChars, measure, wrapBalanced, rng, hashStr, ribbon, shaky, sampleLine, inkBleed, pencil };

// ------------------------------------------------------------------ builders
const FAM = (c) => c.font('text');
const strokeW = (c) => c.u * 7.5 * 2;            // the pencil mark's peak width in the 2x callout capture (7.5 u at 1x)

/* ---- the photo print: a frame, a taller strip, a hairline round the picture, paper fibre ---- */
const windowBuilder = (c) => {
  const { box, view, insets: ins, scene, u } = c;
  
  const edge = scene && (ins.t > 0 || ins.b > 0)
    ? `<div style="position:absolute;left:${n2(view.left - box.left - 1)}px;top:${n2(view.top - box.top - 1)}px;width:${n2(view.w + 2)}px;height:${n2(view.h + 2)}px;box-shadow:0 0 0 1px rgba(38,36,44,0.2)"></div>` : '';
  return { html: `<div style="position:absolute;inset:0;background-image:${noiseUrl({ seed: 11, opacity: 0.1 })}"></div>${edge}` };
};

/* ---- captions: written in the strip of the print ---- */
const markerColor = (tag, given) => {
  const g = String(given ?? '').toLowerCase();
  if ([RED, RED_TXT].some((k) => k.toLowerCase() === g)) return RED;
  if ([OLIVE, OLIVE_TXT].some((k) => k.toLowerCase() === g)) return OLIVE;
  if (/^(before|bug|broken|old|problem|issue|wrong|regression)/i.test(tag ?? '')) return RED;
  if (/^(after|fix|fixed|new|now|done|result)/i.test(tag ?? '')) return OLIVE;
  return INK;
};
const captionBuilder = (c) => {
  const { pos, tag, text, u } = c, st = c.style.caption, color = markerColor(tag, c.color);
  const sw = /width:([\d.]+)px/.exec(pos.css), shh = /height:([\d.]+)px/.exec(pos.css);
  const strip = pos.key.startsWith('s') && sw;                         // the print's own strip, else floating over a full-bleed picture
  const availW = strip ? +sw[1] - 64 * u : c.W * 0.7, baseSize = c.size, weight = 700, gap = 0.34;
  const tagW = (sz) => (tag ? measure(tag, sz, weight) + sz * (gap + 0.3) : 0);
  const chars = toChars(text), flat = plain(text);
  // fit: one line at 100%, 92% or 85%; else two balanced lines at 92%; else shrink toward 78% and cut with an ellipsis
  let size = baseSize, lines = null;
  for (const k of [1, 0.92, 0.85]) {
    const w = tagW(baseSize * k) + measure(flat, baseSize * k, weight);
    if (w <= availW) { size = baseSize * k; lines = [flat]; break; }
  }
  let body = flat;
  if (!lines) {
    for (const k of [0.92, 0.86, 0.8, 0.76]) {
      size = baseSize * k; lines = wrapBalanced(flat, size, availW - tagW(size), weight);
      if (lines.length <= 2) break;
    }
    if (lines.length > 2) { lines = lines.slice(0, 2); lines[1] = lines[1].replace(/\s*\S*$/, '') + '…'; }
  }
  const lh = 1.12, lineH = size * lh, parts = sliceChars(chars, lines.map((l) => l.replace(/…$/, '')));
  const family = FAM(c), seed = `cap:${tag}:${flat}`;
  const o = { family, weight, size, color: INK, seed, slant: 2.2, base: size * 0.022, lh };
  const indent = tagW(size);
  const tagHtml = tag ? `<div style="position:relative;display:inline-block;margin-right:${n2(size * (gap + 0.3))}px;height:${n2(lineH)}px">${markerSlab(measure(tag, size, weight), lineH, color, `${seed}:tag`)}<div style="position:relative">${handLine(toChars(tag), { ...o, seed: `${seed}:t`, color: INK })}</div></div>` : '';
  const rows = parts.map((p, k) => {
    const lineChars = lines[k].endsWith('…') && k === parts.length - 1 ? [...p.chars, { c: '…', em: false }] : p.chars;
    return `<div style="display:flex;align-items:flex-start;height:${n2(lineH)}px;${k > 0 ? `padding-left:${n2(indent)}px` : ''}">${k === 0 ? tagHtml : ''}${handLine(lineChars, { ...o, i0: parts.slice(0, k).reduce((a, q) => a + q.chars.length, 0) })}</div>`;
  }).join('');
  // the sweep follows the longest line (tag included on the first)
  const widths = lines.map((l, k) => measure(l, size, weight) + (k === 0 ? tagW(size) : indent));
  const longest = widths.indexOf(Math.max(...widths));
  const lead = longest === 0 ? (tag ? [measure(tag, size, weight), size * (gap + 0.3)] : []) : [indent];
  const sweep = sweepRow({ lead: lead.length ? lead : [], text: lines[longest].replace(/…$/, ''), size, weight, left: 0, top: 0 });
  const padX = strip ? 0 : size * 0.9, padY = strip ? 0 : size * 0.38;
  const noteBg = strip ? '' : `background:${NOTE};border:1px solid rgba(38,36,44,0.45);border-radius:${3 * u}px;padding:${padY}px ${padX}px;box-shadow:inset 0 -3px 0 rgba(38,36,44,0.12);transform:rotate(${n2(hr(seed, -1.2, 1.2))}deg);`;
  const pill = `<div id="pill" style="position:relative;font-family:${family};${noteBg}">${rows}${sweep}</div>`;
  const wrapStyle = strip
    ? `position:absolute;${pos.css};display:flex;align-items:center;justify-content:flex-start;padding-left:${n2(34 * u)}px`
    : `position:absolute;${pos.css};display:flex;align-items:center;justify-content:center`;
  return { html: `<div style="${wrapStyle}">${pill}</div>` };
};

/* ---- callout label: a scrap of paper with the words on it ---- */
const chipBuilder = (c) => {
  const { label, s } = c, size = 38 * s, seed = `chip:${label}`, rot = hr(seed, -1.8, 1.4);
  const chars = toChars(label), wdt = lineWidth(chars, size, 700);
  const o = { family: FAM(c), weight: 700, size, color: INK, seed, slant: 1.8, base: size * 0.02, lh: 1.15 };
  const ulw = Math.min(wdt, size * 8);
  const ul = `<svg width="${n2(ulw + 20)}" height="${n2(size * 0.5)}" viewBox="0 0 ${n2(ulw + 20)} ${n2(size * 0.5)}" style="max-width:none;position:absolute;left:${n2(size * 0.4)}px;bottom:${n2(size * 0.05)}px;overflow:visible">${stroke('cu', RED, underlineOps(2, ulw, size * 0.18, size * 0.1, seed), { rough: size * 0.04, seed: 3, grain: 0.8, box: [-20, -20, ulw + 60, size] })}</svg>`;
  return { html: `<div id="chip" style="position:absolute;left:20px;top:20px;padding:${n2(size * 0.22)}px ${n2(size * 0.42)}px ${n2(size * 0.4)}px;background:${NOTE};border:1px solid rgba(38,36,44,0.5);border-bottom-width:3px;border-radius:${2.5 * s}px;transform:rotate(${n2(rot)}deg);white-space:nowrap">${handLine(chars, o)}${ul}</div>` };
};

/* ---- callout mark: scribble circle drawn on in 10 poses, then an ink arrow from the label ---- */
const CIRCLE_POSES = 10, ARROW_AT = 8, ARROW_SHAFT = 3;
const markBuilder = (c) => {
  const { w, h, callout } = c, sw = strokeW(c), seed = `mark:${Math.round(w)}x${Math.round(h)}:${(callout.box ?? []).map((v) => Math.round(v * 1000)).join(',')}`;
  const below = (callout.box?.[1] ?? 1) < 0.18, r = rng(`${seed}:arrow`);
  const m = sw * 0.75, rx = w / 2 - m, ry = h / 2 - m, n = 2.5;
  // where the arrow lands: on the circle's top-left (or bottom-left when the label sits below), pushed out a little
  const th = below ? 2.25 : -2.25, tip0 = ellipsePt(rx * 1.0, ry * 1.0, n, th);
  const gapOut = sw * 0.9, len = Math.hypot(tip0.x, tip0.y) || 1;
  const to = { x: w / 2 + tip0.x * (1 + gapOut / len), y: h / 2 + tip0.y * (1 + gapOut / len) };
  const from = { x: Math.max(sw * 1.2, to.x - Math.max(w * 0.2, sw * 7)) + (r() - 0.5) * sw, y: below ? h - sw * 0.3 : sw * 0.3 };
  const poses = [], labelled = !!callout.label, POSES = labelled ? ARROW_AT + ARROW_SHAFT + 2 : CIRCLE_POSES;
  for (let k = 0; k < POSES; k++) {
    const cp = clamp((k + 1) / CIRCLE_POSES);
    const shaft = k < ARROW_AT ? 0 : clamp((k - ARROW_AT + 1) / ARROW_SHAFT), aL = k >= ARROW_AT + ARROW_SHAFT ? 1 : 0, aR = k >= ARROW_AT + ARROW_SHAFT + 1 ? 1 : 0;
    const arrow = shaft > 0 && labelled ? inkArrow({ from, to, width: sw * 0.7, shaft, armL: aL, armR: aR, bow: below ? -0.22 : 0.22, seed, id: 'ma', box: [-40, -40, w + 80, h + 80] }) : '';
    poses.push(`<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="max-width:none;position:absolute;left:0;top:0;overflow:visible">${scribbleCircle({ w, h, width: sw, progress: cp, seed, id: 'mc', margin: m, n })}${arrow}</svg>`);
  }
  return { html: poses[0], poses };
};

/* ---- title: hand-written on, an ink underline under it, the subtitle on a sticker ---- */
const titleBuilder = (c) => {
  const { W, H, u, scene, style } = c, effect = scene.effect ?? 'soft-blur-in', family = c.font('display'), weight = 700;
  const tokSize = W * style.title.size, chars = emChars(scene.text), flat = chars.map((x) => x.c).join(''), seed = `title:${flat}`;
  const oBase = { family, weight, color: INK, seed, slant: 2.6, base: 0.012, lh: 1.2 };
  let size = tokSize, lines = [], layout;                                   // layout: [{ chars|words, width }]
  if (effect === 'word-push') {
    // one row: the engine slides the words in along it, so it cannot wrap; the gap between words must be the engine's own
    const words = emWords(scene.text), gapPx = 0.22 * tokSize;
    const fit = (sz) => words.reduce((a, wd) => a + measure(wd.w, sz, weight), 0) + gapPx * (words.length - 1);
    while (fit(size) > W * 0.9 && size > tokSize * 0.4) size *= 0.96;
    let x = 0;
    layout = [{ words: words.map((wd) => { const wpx = measure(wd.w, size, weight), o = { ...wd, x, wpx }; x += wpx + gapPx; return o; }), width: fit(size), gapPx }];
  } else {
    const wrap = (sz) => wrapBalanced(flat, sz, W * 0.84, weight);
    lines = wrap(size);
    while (lines.length > 2 && size > tokSize * 0.5) { size *= 0.94; lines = wrap(size); }
    let k = 0; layout = [];
    for (const ln of lines) {
      while (k < chars.length && chars[k].c === ' ') k++;
      const row = [];
      for (let m = 0; m < ln.length && k < chars.length; m++, k++) row.push({ ...chars[k], k });
      layout.push({ chars: row, width: lineWidth(row, size, weight) });
    }
  }
  const lh = size * 1.2, th = size * 0.045, ulY = lh * 0.93 + size * 0.2, ulId = `tu${hashStr(seed) % 9999}`, last = layout.length - 1;
  // The underline of the last line is one stroke, cut in up to three slices. The engine moves only the pieces it
  // knows (a title has no extra piece, and cannot play poses), so each slice rides on a character near the end of
  // the line: the stroke is laid as the last word is written. (Per-character slices would jitter apart on the
  // clock; three long ones read as the pen lifting.)
  const plan = (count) => {
    if (count <= 1) return [{ idx: 0, f0: 0, f1: 1 }];
    const idx = [...new Set([Math.round(0.5 * (count - 1)), Math.round(0.8 * (count - 1)), count - 1])];
    return idx.map((i, n) => ({ idx: i, f0: n / idx.length, f1: (n + 1) / idx.length }));
  };
  const slicePad = (width, cx, f0) => { const x0 = -size * 0.08, x1 = width + size * 0.1; return Math.ceil(Math.max(44, cx - (x0 + (x1 - x0) * f0) + 40, x1 - cx + 40)); };
  const ulSlice = (width, cx, f0, f1) => {
    const fid = `${ulId}s${Math.round(f0 * 100)}`;
    const ov = 12, x0 = -size * 0.08, x1 = width + size * 0.1, a = x0 + (x1 - x0) * f0 - (f0 > 0 ? ov : 0), b = x0 + (x1 - x0) * f1 + (f1 < 1 ? ov : 0);
    return `<svg width="${n2(b - a)}" height="${n2(lh * 1.5)}" viewBox="${n2(a)} 0 ${n2(b - a)} ${n2(lh * 1.5)}" style="max-width:none;position:absolute;left:${n2(a - cx)}px;top:0;overflow:hidden;pointer-events:none">${stroke(fid, RED, underlineOps(x0, x1, ulY, th, seed), { rough: th * 0.5, seed: 9, grain: 0.8, box: [x0 - 40, 0, x1 - x0 + 80, lh * 1.6] })}</svg>`;
  };
  let block;
  if (effect === 'word-push') {
    const L = layout[0], sl = plan(L.words.length), at = Object.fromEntries(sl.map((q) => [q.idx, q]));
    block = `<div style="display:flex;white-space:nowrap;height:${n2(lh)}px">${L.words.map((wd, j) => {
      const q = at[j];
      return `<div data-p="w${j}" data-pad="${q ? slicePad(L.width, wd.x, q.f0) : 40}" style="position:relative;height:${n2(lh)}px;${j < L.words.length - 1 ? `margin-right:${n2(L.gapPx)}px` : ''}">${handLine([...wd.w].map((ch) => ({ c: ch, em: wd.em })), { ...oBase, size, i0: j * 40 })}${q ? ulSlice(L.width, wd.x, q.f0, q.f1) : ''}</div>`;
    }).join('')}</div>`;
  } else if (effect === 'micro-scale-fade') {
    block = `<div data-p="all" data-pad="40" style="display:inline-block;padding-bottom:${n2(lh * 0.32)}px">${layout.map((L, li) => `<div style="position:relative;display:flex;justify-content:center;height:${n2(lh)}px"><div style="position:relative">${handLine(L.chars, { ...oBase, size })}${li === last ? ulSlice(L.width, 0, 0, 1) : ''}</div></div>`).join('')}</div>`;
  } else {
    const lastChars = layout[last].chars.filter((ch) => ch.c.trim()), sl = plan(lastChars.length), at = Object.fromEntries(sl.map((q) => [lastChars[q.idx].k, q]));
    block = `<div>${layout.map((L, li) => `<div style="display:flex;justify-content:center;height:${n2(lh)}px">${L.chars.map((ch, j) => {
      if (!ch.c.trim()) return `<span style="display:inline-block;width:${n2(adv(' ', weight) * size)}px"></span>`;
      const cx = L.chars.slice(0, j).reduce((s, q) => s + adv(q.c, weight) * size, 0), q = li === last ? at[ch.k] : null;
      return `<span data-p="c${ch.k}" data-pad="${q ? slicePad(L.width, cx, q.f0) : 44}" style="position:relative;display:inline-block">${handLine([ch], { ...oBase, size, i0: ch.k })}${q ? ulSlice(L.width, cx, q.f0, q.f1) : ''}</span>`;
    }).join('')}</div>`).join('')}</div>`;
  }
  const sub = scene.subtitle !== undefined && String(scene.subtitle) !== '' ? (() => {
    const ss = Math.round(W * 0.027), tilt = hr(`${seed}:sub`, -2.2, 2.2), sch = toChars(String(scene.subtitle));
    return `<div data-p="sub" data-pad="16" style="margin-top:${n2(size * 0.28)}px;padding:${n2(ss * 0.28)}px ${n2(ss * 0.7)}px ${n2(ss * 0.4)}px;background:${NOTE};border:1px solid rgba(38,36,44,0.55);border-radius:${3 * u}px;box-shadow:0 3px 7px rgba(38,36,44,0.16);transform:rotate(${n2(tilt)}deg);will-change:transform;white-space:nowrap">${handLine(sch, { family, weight: 600, size: ss, color: INK, seed: `${seed}:s`, slant: 1.8, base: 0.4, lh: 1.15 })}</div>`;
  })() : '';
  return { html: `<div class="af" style="align-items:center;justify-content:center;padding-bottom:${n2(H * 0.04)}px">${block}${sub}</div>` };
};

/* ---- hand-set text blocks that the engine reveals with the "type" entrance ---- */
const normText = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();
/** A piece of written text (card line, list item): wrapped on measured widths, with a sweep row so the reveal runs along the longest line. */
const textPiece = ({ name, text, size, weight = 600, maxW, color = INK, seed, family, lead = [], leadW = 0, pad = 8, lh = 1.16, style = '', extra = '' }) => {
  const norm = normText(text), chars = toChars(norm), flat = plain(norm);
  const lines = wrapBalanced(flat, size, maxW - leadW, weight), parts = sliceChars(chars, lines), lineH = size * lh;
  const o = { family, weight, size, color, seed, slant: 2.4, base: size * 0.02, lh };
  const rows = parts.map((p, k) => `<div style="margin-left:${n2(leadW)}px;height:${n2(lineH)}px">${handLine(p.chars, { ...o, i0: parts.slice(0, k).reduce((a, q) => a + q.chars.length, 0) })}</div>`).join('');
  const longest = lines.map((l) => measure(l, size, weight)).reduce((bi, w, i, a) => (w > a[bi] ? i : bi), 0);
  const sweep = sweepRow({ lead, text: lines[longest], size, weight, left: leadW, top: 0 });
  return { html: `<div class="piece" data-p="${name}" data-pad="${pad}" style="position:relative;height:${n2(lines.length * lineH)}px;${style}">${extra}${rows}${sweep}</div>`, height: lines.length * lineH, lines: lines.length };
};

/* ---- the issue: a sticky note taped to the board ---- */
const tapeHtml = (u, seed, left, top, w = 150, rot = -3) => {
  const r = rng(`${seed}:tape`), h = 44 * u, teeth = (side) => Array.from({ length: 7 }, (_, i) => `${side ? 100 - (r() * 2.4) : r() * 2.4}% ${n2((i / 6) * 100)}%`);
  const left_ = teeth(0), right_ = teeth(1).reverse();
  return `<div style="position:absolute;left:${left};top:${n2(top * u)}px;width:${n2(w * u)}px;height:${n2(h)}px;transform:translateX(-50%) rotate(${rot}deg);background:rgba(206,198,176,0.62);box-shadow:0 1px 2px rgba(38,36,44,0.12);clip-path:polygon(${[...left_, ...right_].join(',')})"></div>`;
};
const issueBuilder = (c) => {
  const { u, scene, style } = c, K = style.card, family = FAM(c), seed = `issue:${scene.id}:${scene.title}`;
  const width = K.width * u, padX = K.padX * u, padY = K.padY * u, inner = width - padX * 2;
  const sign = hashStr(seed) % 2 ? 1 : -1, tilt = sign * hr(`${seed}:tilt`, 1.2, 2.4);
  const has = (v) => v !== undefined && v !== null && String(v) !== '';
  const metaSize = 40 * u;
  const meta = (txt, color, w = 600) => `<span style="font-weight:${w};color:${color}">${esc(txt)}</span>`;
  let status = '';
  if (has(scene.status)) {
    const st = 42 * u, tw = measure(scene.status, st, 700), bw = tw + 58 * u, bh = st * 1.55;
    status = `<span style="position:relative;display:inline-block;margin-left:auto;width:${n2(bw)}px;height:${n2(bh)}px"><svg width="${n2(bw)}" height="${n2(bh)}" viewBox="0 0 ${n2(bw)} ${n2(bh)}" style="max-width:none;position:absolute;left:0;top:0;overflow:visible">${scribbleCircle({ w: bw, h: bh, width: 5 * u, color: OLIVE, seed: `${seed}:st`, id: 'is', margin: 5 * u, laps: 1.12 })}</svg><span style="position:absolute;left:0;right:0;top:0;height:${n2(bh)}px;display:flex;align-items:center;justify-content:center">${handLine(toChars(String(scene.status)), { family, weight: 700, size: st, color: OLIVE_TXT, seed: `${seed}:status`, slant: 2, base: 0.5, lh: 1.1 })}</span></span>`;
  }
  const metaRow = has(scene.source) || has(scene.id) || has(scene.status)
    ? `<div style="display:flex;align-items:center;gap:${14 * u}px;height:${n2(metaSize * 1.7)}px;font-size:${n2(metaSize)}px;font-family:${family}">${has(scene.source) ? handLine(toChars(String(scene.source)), { family, weight: 600, size: metaSize, color: 'rgba(38,36,44,0.66)', seed: `${seed}:src`, slant: 2, base: 0.5, lh: 1.15 }) : ''}${has(scene.id) ? handLine(toChars(String(scene.id)), { family, weight: 700, size: metaSize, color: INK, seed: `${seed}:id`, slant: 2, base: 0.5, lh: 1.15 }) : ''}${status}</div>` : '';
  const title = has(scene.title) ? textPiece({ name: 'title', text: scene.title, size: 74 * u, weight: 700, maxW: inner, seed: `${seed}:t`, family, lh: 1.12, pad: 10 }) : null;
  const barW = 34 * u, qSize = 52 * u;
  const quote = scene.quote ? textPiece({ name: 'quote', text: `“${normText(scene.quote)}”`, size: qSize, weight: 600, maxW: inner, leadW: barW, seed: `${seed}:q`, family, lh: 1.14, pad: 10 }) : null;
  const bar = quote ? (() => {
    const bh = quote.height, bw = 14 * u, spine = shaky([{ x: bw / 2, y: 2 }, { x: bw / 2 + 1.5 * u, y: bh - 2 }], { sub: 9, amp: 3 * u, seed: `${seed}:bar` });
    return `<svg width="${n2(bw)}" height="${n2(bh)}" viewBox="0 0 ${n2(bw)} ${n2(bh)}" style="max-width:none;position:absolute;left:0;top:0;overflow:visible">${stroke('qb', RED, ribbon(spine, { width: 6 * u, profile: (t) => 0.75 + 0.25 * Math.sin(Math.PI * t), seed }), { rough: 2 * u, seed: 5, grain: 0.7, box: [-20, -20, bw + 40, bh + 40] })}</svg>`;
  })() : '';
  const reporter = scene.reporter ? textPiece({ name: 'reporter', text: scene.reporter, size: 44 * u, weight: 600, maxW: inner, color: 'rgba(38,36,44,0.82)', seed: `${seed}:r`, family, lh: 1.16, pad: 10 }) : null;
  const q = quote ? quote.html.replace('class="piece"', 'class="piece"').replace(/(<div class="piece"[^>]*>)/, `$1${bar}`) : '';
  const html = `<div class="af" style="align-items:center;justify-content:center;font-family:${family}">
    <div id="card" style="position:relative;width:${n2(width)}px;padding:${n2(padY)}px ${n2(padX)}px ${n2(padY * 0.9)}px;border-radius:${3 * u}px;background:${noiseUrl({ seed: 21, opacity: 0.1 })},${NOTE};border:1px solid rgba(38,36,44,0.55);box-shadow:${SHADOW};transform:rotate(${n2(tilt)}deg);display:flex;flex-direction:column;gap:${n2(18 * u)}px">
      ${tapeHtml(u, seed, '50%', -26, 170, -2.5)}
      ${metaRow}${title?.html ?? ''}${q}${reporter?.html ?? ''}
    </div></div>`;
  return { html };
};

/* ---- the list: a hand-drawn check-list ---- */
const listBuilder = (c) => {
  const { u, scene, style } = c, K = style.list, family = FAM(c), seed = `list:${scene.title}:${(scene.items ?? []).join('|')}`;
  const width = K.width * u, size = 68 * u, B = size * 0.78, gapX = size * 0.42, has = (v) => v !== undefined && v !== null && String(v) !== '';
  const hs = 112 * u, sub = 50 * u;
  const headTitle = has(scene.title) ? (() => {
    const ch = toChars(normText(scene.title)), w = lineWidth(ch, hs, 700), th = hs * 0.045, ulY = hs * 1.12;
    return `<div style="position:relative;height:${n2(hs * 1.36)}px;width:${n2(w)}px">${handLine(ch, { family, weight: 700, size: hs, color: INK, seed: `${seed}:h`, slant: 2.6, base: 1, lh: 1.2 })}<svg width="${n2(w + 30)}" height="${n2(hs * 0.5)}" viewBox="${-10} ${n2(hs * 0.9)} ${n2(w + 30)} ${n2(hs * 0.5)}" style="max-width:none;position:absolute;left:-10px;top:${n2(hs * 0.9)}px;overflow:visible">${stroke('lu', RED, underlineOps(-4, w + 6, ulY, th, seed), { rough: th * 0.5, seed: 9, grain: 0.8, box: [-60, hs * 0.8, w + 160, hs * 0.8] })}</svg></div>`;
  })() : '';
  const headSub = has(scene.subtitle) ? `<div style="margin-top:${n2(sub * 0.1)}px;opacity:0.72">${handLine(toChars(normText(scene.subtitle)), { family, weight: 600, size: sub, color: INK, seed: `${seed}:s`, slant: 2, base: 0.8, lh: 1.2 })}</div>` : '';
  const head = headTitle || headSub ? `<div data-p="head" data-pad="30" style="align-self:flex-start">${headTitle}${headSub}</div>` : '';
  const items = (scene.items ?? []).map((it, k) => {
    const sd = `${seed}:${k}`, boxSvg = `<svg width="${n2(B + 14 * u)}" height="${n2(B + 14 * u)}" viewBox="0 0 ${n2(B + 14 * u)} ${n2(B + 14 * u)}" style="max-width:none;position:absolute;left:0;top:0;overflow:visible">${wobblyBox({ size: B, width: 4.5 * u, seed: sd, id: `lb${k}`, ox: 2 * u, oy: 6 * u })}${stroke(`lt${k}`, OLIVE, tickOps(B, 6.4 * u, sd, 1, 2 * u, 6 * u), { rough: 3 * u, seed: 4, grain: 0.7, box: [-40, -40, B + 120, B + 120] })}</svg>`;
    const lead = Array.from({ length: 8 }, () => (B + gapX) / 8);
    const tp = textPiece({ name: `i${k}`, text: it, size, weight: 600, maxW: width, leadW: B + gapX, seed: sd, family, lead, pad: 12, lh: 1.2, extra: `<div style="position:absolute;left:0;top:${n2(size * 0.1)}px;width:${n2(B)}px;height:${n2(B)}px">${boxSvg}</div>` });
    return tp.html;
  }).join('');
  return { html: `<div class="af" style="align-items:center;justify-content:center;font-family:${family}"><div style="width:max-content;max-width:${n2(width)}px;display:flex;flex-direction:column;gap:${n2(K.gap * u)}px">${head}<div style="display:flex;flex-direction:column;gap:${n2(K.itemGap * u * 1.2)}px">${items}</div></div></div>` };
};

// ------------------------------------------------------------------ transitions (GLSL, stepped)
// The paper swap: the outgoing scene is nudged and turned a fraction of a degree for two poses, then a hard cut,
// then the incoming one settles from `settle` to 1 over two poses. Progress arrives already held between poses.
const swap = ({ settle = 1.03, shift = 1, dir = 0 } = {}) => ({ sec: 0.5, stepped: true, glsl: `
float hh(float n){ return fract(sin(n * 91.345 + 17.1) * 43758.5453); }
vec4 transition(vec2 uv){
  float p = uProgress, asp = uRes.x / uRes.y;
  vec2 c = vec2(.5);
  if (p < .2) return getFrom(uv);
  if (p < .6) {
    float k = floor(p * 10. + .5);
    vec2 d = vec2((hh(k) - .5) * 2. * .0065 * ${shift.toFixed(2)} + ${dir.toFixed(3)} * .012, (hh(k + 7.) - .5) * 2. * .0085);
    float a = (hh(k + 13.) - .5) * 2. * .0095;
    vec2 q = uv - c; q.x *= asp;
    q = mat2(cos(a), -sin(a), sin(a), cos(a)) * q; q.x /= asp;
    vec2 s = q + c - d;
    if (s.x < 0. || s.y < 0. || s.x > 1. || s.y > 1.) return vec4(0.);
    return getFrom(s) * (1. - .035 * hh(k + 3.));
  }
  float t = (p - .6) / .4, sc = mix(${settle.toFixed(3)}, 1., t);
  vec2 s = (uv - c) / sc + c;
  if (s.x < 0. || s.y < 0. || s.x > 1. || s.y > 1.) return vec4(0.);
  return getTo(s);
}` });
const dissolve3 = { sec: 0.5, stepped: true, glsl: `
vec4 transition(vec2 uv){
  float m = clamp(floor(uProgress * 5. + .001) / 4., 0., 1.);     // held at 0, 1/4, 1/2, 3/4, 1: a dissolve in three poses
  return mix(getFrom(uv), getTo(uv), m);
}` };
const TRANSITIONS = {
  'paper-swap': swap(),
  'zoom-blur': swap(),
  'focus-pull': swap({ settle: 1.02, shift: 0.8 }),
  'push-through': swap({ settle: 1.06 }),
  'whip-pan': swap({ shift: 1.3, dir: 1 }),
  fade: dissolve3,
};

export { titleBuilder, windowBuilder, captionBuilder, chipBuilder, markBuilder, issueBuilder, listBuilder };

// ------------------------------------------------------------------ the style (tokens come after the builders are proven)
export default {
  name: 'sketch',
  extends: 'studio',
  description: 'Hand and imperfection: a photo pinned to cream paper, annotated by hand in held poses.',
  suits: 'Bug-fix before/afters, where circling the bug by hand says it fastest.',
  palette: { background: PAPER_CSS, foreground: INK, accent: RED_TXT, onAccent: NOTE, tagColors: { Before: RED, After: OLIVE, Tour: INK }, tagFallback: INK, danger: RED },
  fonts: {
    text: { family: 'Caveat', weights: [600, 700], fallback: "'Segoe Print', 'Bradley Hand', cursive" },
    display: { family: 'Caveat', weights: [600, 700], fallback: "'Segoe Print', 'Bradley Hand', cursive" },
    mono: { family: 'Caveat', weights: [600, 700], fallback: "'Segoe Print', 'Bradley Hand', cursive" },
  },
  canvas: { matte: PAPER, model: 'shared', background: { kind: 'css' } },
  window: { maxWidth: 0.9, maxHeight: 0.88, top: 0.035, radius: 0.0031, fill: FRAME, shadow: SHADOW, shadowPad: 60, insets: [24, 24, 138, 24], tilt: 0, tiltJitter: 1.3, jitter: true, border: { width: 22, color: FRAME } },
  caption: { variant: 'plain', placement: 'slot', align: 'left', size: 0.026, enter: 'type', typeCps: 16, caret: 'none', delay: 0.3, exit: 0.2 },
  build: { title: titleBuilder, issue: issueBuilder, list: listBuilder, window: windowBuilder, caption: captionBuilder, calloutChip: chipBuilder, calloutMark: markBuilder },
  title: { size: 0.075, weight: 700, measure: 'glyph', subtitleOpacity: 1 },
  card: { width: 1060, padX: 64, padY: 56, shadowPad: 80, rowEnter: 'type' },
  list: { width: 1180, gap: 26, itemGap: 16, itemEnter: 'type' },
  split: { labelSize: 0.024, labelRise: 0.085 },
  callout: { mark: 'ring', pad: 56, dimAlpha: 0.2, dimColor: INK, forSec: 2.5, enterSec: 0.2, exitSec: 0.2 },
  motion: {
    spring: { damping: 70, stiffness: 1000, mass: 1 }, poseRate: 10,
    clock: { poses: 10, seed: 63420, jitterPx: 1.5, jitterDeg: 0.32 },
    card: { rise: 0, rows: [0.15, 0.45, 0.65], alpha: [1, 1, 1] },
    list: { headRise: 0, start: 0.7, step: 0.62, dx: 0 },
    text: { softBlur: { stagger: 3, rise: 0, blur: 0, frames: 0.01, riseFrames: 0.01, ease: [0.22, 1, 0.36, 1] }, microScale: { frames: 9, from: 1.03, ease: [0.32, 0.72, 0, 1] }, subtitle: { from: 1.4, to: 1.5, rise: 0 } },
  },
  camera: { ease: { type: 'bezier', curve: [0.45, 0, 0.25, 1] }, motionBlur: null },
  transition: { default: 'paper-swap', sec: 0.5, stepped: true, custom: TRANSITIONS },
};
