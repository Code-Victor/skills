// sketch: a teammate's annotated photo board. The recording is the one smooth
// thing, a photograph pinned to cream paper; everything around it is drawn by
// hand and moves in held poses (10 a second, seeded jitter, never smooth).
//
// Direction and numbers adapted from remocn's "paper" kit (MIT, github.com/kapishdima/remocn):
// stop-motion clock and jitter, handwrite (Caveat, per-character slant and baseline),
// brush ribbons with pressure, scribble-circle, ink-arrow, ink-underline, paper-sticker,
// check-list, marker-highlight, polaroid. The path maths and the hand-drawn pieces below
// are re-implemented for this engine's HTML builders.
//
// Determinism: every mark and every turned sheet of paper is painted HERE, in Node, into a PNG,
// and Chrome only places the picture. Chrome's GPU raster anti-aliases paths, SVG masks, filters
// and turned boxes a few levels differently from one launch to the next (the same piece captured
// six times came out in up to three versions; with GPU raster off, in one), so nothing captured
// uses an SVG filter, an SVG path or a turned box. What Chrome still draws is text (glyphs come
// from a CPU-rasterised atlas and repeat exactly), level boxes and level tiled backgrounds.
// Roughness is geometry: ribbons whose outline is jittered from a seed, a lighter second pass, and
// a grain mask of seeded dots; the paper fibre is two seeded tiles at sizes with no common factor.
//
// In order: palette, utilities and Caveat's measured advance widths (so Node can lay text out
// exactly), PNG writing and the paper fibre, the painter, the brush, the hand-made primitives,
// hand-set type, the builders, the transitions, the style tokens. `lab` is for the primitive sheet.
import zlib from 'node:zlib';
import { parseEmphasis, emChars, emWords, esc, splitBoxes, sceneLayout } from '../layout.js';
import { cameraAt, cameraTransform, makeCameraEase } from '../motion.js';
import { parseColor } from '../color.js';

// ------------------------------------------------------------------ palette
const PAPER = '#F5F3EE';      // the board
const NOTE = '#FBFAF6';       // note and sticker paper
const FRAME = '#FDFCF8';      // the photo print
const INK = '#26242C';
const RED = '#BE3F2A';        // red pencil: the default accent, marks and text (4.8:1 on the board)
const OLIVE = '#6F7F35';      // ticks
const OLIVE_TXT = '#5B6A2A';  // olive deep enough for text (5.4:1)
const TAPE = 'rgba(214,206,182,0.66)';
const SHADOW = '0 12px 30px rgba(38,36,44,0.18), 0 3px 7px rgba(38,36,44,0.12)';   // remocn's print shadow x1.5 (1920), for level boxes
const PAPER_SHADOW = [{ dy: 12, blur: 15, alpha: 0.18 }, { dy: 3, blur: 3.5, alpha: 0.12 }];   // the same shadow as gaussians (sigma = CSS blur / 2)
// Tags are coloured by name: these, and (in mapTag) any tag a spec colours, by the same rule.
const RED_TAGS = ['Before', 'Bug', 'Broken', 'Old', 'Problem', 'Issue', 'Wrong', 'Regression'];
const OLIVE_TAGS = ['After', 'Fix', 'Fixed', 'New', 'Now', 'Done', 'Result'];
const TAGS = { ...Object.fromEntries(RED_TAGS.map((t) => [t, RED])), ...Object.fromEntries(OLIVE_TAGS.map((t) => [t, OLIVE_TXT])), Tour: INK };
const tagByName = (name) => (new RegExp(`^(${RED_TAGS.join('|')})`, 'i').test(name) ? RED : new RegExp(`^(${OLIVE_TAGS.join('|')})`, 'i').test(name) ? OLIVE_TXT : INK);

// ------------------------------------------------------------------ utilities
const hashStr = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } h ^= h >>> 13; h = Math.imul(h, 2246822519); return (h ^ (h >>> 16)) >>> 0; };
const rng = (seed) => { let a = (typeof seed === 'string' ? hashStr(seed) : seed) >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const hr = (seed, lo, hi) => lo + rng(seed)() * (hi - lo);
const n2 = (v) => Math.round(v * 100) / 100;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const has = (v) => v !== undefined && v !== null && String(v) !== '';

// Caveat's advance widths (em x 1000), measured in Chrome with kerning and ligatures off,
// which is exactly how this file sets type (one inline-block per character).
const GLYPHS = "0123456789 !\"#$%&'()*+,-./:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~’‘“”–—…éèàüöäñç·•";
const A600 = [450,450,450,450,450,439,464,447,450,442,242,210,237,559,450,600,564,117,330,330,363,446,198,326,198,330,198,198,446,446,446,374,643,508,522,475,584,532,462,492,570,406,312,505,426,726,612,502,467,495,542,492,458,482,490,720,524,504,522,330,330,330,446,446,353,443,441,361,399,331,297,361,470,193,210,371,175,566,456,359,378,377,360,347,331,370,331,517,343,341,315,330,330,330,446,117,117,267,267,446,566,594,325,325,437,370,353,437,450,355,187,187];
const A700 = [450,450,450,450,450,434,471,446,450,438,242,210,237,559,450,600,564,117,330,330,363,446,198,326,198,330,198,198,446,446,446,374,643,511,523,477,587,534,466,494,574,409,315,508,426,729,619,505,468,492,544,495,458,482,490,720,524,504,522,330,330,330,446,446,353,446,444,364,402,334,300,364,473,196,213,374,178,569,459,362,378,377,360,350,331,370,331,517,343,341,315,330,330,330,446,117,117,267,267,446,566,594,325,325,437,370,353,437,450,355,187,187];
const ADV = (() => { const m6 = {}, m7 = {}; [...GLYPHS].forEach((g, i) => { m6[g] = A600[i] / 1000; m7[g] = A700[i] / 1000; }); return { 600: m6, 700: m7 }; })();
const adv = (ch, weight = 700) => (weight >= 650 ? ADV[700] : ADV[600])[ch] ?? 0.42;
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
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2, t = wrapWords(words, size, mid, weight, track, indent);
    if (t.length <= lines.length) { lines = t; hi = mid; } else lo = mid;
  }
  return lines;
};

// ------------------------------------------------------------------ PNG, and the paper fibre (tiles written here, from a seed)
const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const pngChunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
/** A PNG data URI from rows of bytes: `ch` channels per pixel (2: grey+alpha, 4: RGBA), `px(x, y, out, o)` writes them. */
const pngUri = (w, h, ch, px) => {
  const stride = w * ch + 1, raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) { raw[y * stride] = 0; for (let x = 0; x < w; x++) px(x, y, raw, y * stride + 1 + x * ch); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = ch === 4 ? 6 : 4;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw, { level: 6 })), pngChunk('IEND', Buffer.alloc(0))]);
  return `data:image/png;base64,${png.toString('base64')}`;
};
/**
 * Paper fibre: seeded noise softened over a 3x3 (grain rather than static), a few faint short fibres,
 * wrapped so it tiles. Alpha only (ink grey 40). Two of these at sizes with no common factor are laid over
 * each other, so the pattern only repeats every few tens of thousands of pixels.
 */
const fibreTile = (seed, T, level) => {
  const r = rng(`fibre:${seed}:${T}`), v = new Float32Array(T * T), s = new Float32Array(T * T);
  for (let i = 0; i < v.length; i++) v[i] = r() + r() + r() - 1.5;
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    let a = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) a += v[((y + dy + T) % T) * T + ((x + dx + T) % T)] * (dx === 0 && dy === 0 ? 2 : 1);
    s[y * T + x] = a / 10;
  }
  const fib = new Float32Array(T * T), nf = Math.round(T * T / 3600);
  for (let k = 0; k < nf; k++) {
    let x = r() * T, y = r() * T; const th = r() * Math.PI, len = 5 + r() * 14, st = 0.5, str = 0.35 + r() * 0.5;
    for (let d = 0; d < len; d += st) { x += Math.cos(th) * st; y += Math.sin(th) * st; const i = ((Math.round(y) % T + T) % T) * T + ((Math.round(x) % T + T) % T); fib[i] = Math.max(fib[i], str); }
  }
  const a = new Uint8Array(T * T);
  for (let i = 0; i < a.length; i++) a[i] = clamp(Math.round((3 + s[i] * 15 + fib[i] * 9) * level), 0, 40);
  return { T, a, uri: pngUri(T, T, 2, (x, y, b, o) => { b[o] = 40; b[o + 1] = a[y * T + x]; }) };
};
const BOARD_TILES = [fibreTile(7, 256, 1), fibreTile(8, 181, 1)];
const CARD_TILES = [fibreTile(21, 211, 0.85), fibreTile(22, 157, 0.85)];
const CARD_GRAIN = CARD_TILES.map((t) => `url(${t.uri})`).join(',');     // for level paper (prints): CSS tiles
const PAPER_CSS = `${BOARD_TILES.map((t) => `url(${t.uri})`).join(',')},#FAF8F3`;   // a touch lighter under the fibre, which darkens it to about #F5F3EE
/** The card fibre's alpha (0..1) at a point of a sheet, as the two CSS tiles would lay it (the first on top). */
const fibreAt = (x, y) => { let k = 1; for (const t of CARD_TILES) k *= 1 - t.a[((Math.floor(y) % t.T + t.T) % t.T) * t.T + ((Math.floor(x) % t.T + t.T) % t.T)] / 255; return 1 - k; };

// ------------------------------------------------------------------ the painter (Node)
// A layer is { polys: [[{x, y}...]...], color, alpha, grain (0..1, pencil grain mask), seed, blur (gaussian sigma px),
// amount (x, y) => 0..1 per pixel }. Polygons fill by the non-zero rule (a ribbon that laps itself stays one stroke).
const SUBROWS = 5;
const spanAdd = (row, a, b, W) => {
  a = Math.max(0, a); b = Math.min(W, b); if (b <= a) return;
  const ia = Math.floor(a), ib = Math.floor(b);
  if (ia === ib) { row[ia] += b - a; return; }
  row[ia] += ia + 1 - a; for (let i = ia + 1; i < ib; i++) row[i] += 1; if (ib < W) row[ib] += b - ib;
};
/** Coverage 0..1 of polygons on a W x H grid whose top-left is (ox, oy): SUBROWS rows per pixel, exact coverage along each. */
const coverage = (W, H, polys, ox = 0, oy = 0) => {
  const cov = new Float32Array(W * H), E = [];
  for (const P of polys) {
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length], ay = a.y - oy, by = b.y - oy;
      if (ay === by) continue;
      const ax = a.x - ox, bx = b.x - ox;
      E.push(ay < by ? [ay, by, ax, (bx - ax) / (by - ay), 1] : [by, ay, bx, (ax - bx) / (ay - by), -1]);
    }
  }
  if (!E.length) return cov;
  E.sort((p, q) => p[0] - q[0]);
  const row = new Float32Array(W + 1), xs = [];
  let act = [], ei = 0;
  const y0 = Math.max(0, Math.floor(E[0][0])), y1 = Math.min(H, Math.ceil(E.reduce((m, e) => Math.max(m, e[1]), 0)));
  for (let py = y0; py < y1; py++) {
    row.fill(0); let any = false;
    for (let s = 0; s < SUBROWS; s++) {
      const sy = py + (s + 0.5) / SUBROWS;
      while (ei < E.length && E[ei][0] <= sy) act.push(E[ei++]);
      act = act.filter((e) => e[1] > sy);
      xs.length = 0;
      for (const e of act) xs.push([e[2] + (sy - e[0]) * e[3], e[4]]);
      xs.sort((p, q) => p[0] - q[0]);
      let w = 0, start = 0;
      for (const [x, d] of xs) { const pw = w; w += d; if (pw === 0 && w !== 0) start = x; else if (pw !== 0 && w === 0) { spanAdd(row, start, x, W); any = true; } }
    }
    if (any) for (let x = 0; x < W; x++) cov[py * W + x] = Math.min(1, row[x] / SUBROWS);
  }
  return cov;
};
/** A gaussian blur of an alpha map, in place (three box blurs; outside the grid is transparent). */
const blurAlpha = (a, W, H, sigma) => {
  const n = 3, wl0 = Math.floor(Math.sqrt((12 * sigma * sigma) / n + 1)), wl = wl0 % 2 ? wl0 : wl0 - 1, wu = wl + 2;
  const mIdeal = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  const tmp = new Float32Array(a.length);
  const pass = (src, dst, r, horiz) => {
    const L = horiz ? W : H, M = horiz ? H : W, st = horiz ? 1 : W, line = horiz ? W : 1, k = 1 / (2 * r + 1);
    for (let j = 0; j < M; j++) {
      const base = j * line; let acc = 0;
      for (let i = -r; i <= r; i++) if (i >= 0 && i < L) acc += src[base + i * st];
      for (let i = 0; i < L; i++) {
        dst[base + i * st] = acc * k;
        const add = i + r + 1, sub = i - r;
        if (add < L) acc += src[base + add * st];
        if (sub >= 0) acc -= src[base + sub * st];
      }
    }
  };
  for (let i = 0; i < n; i++) { const r = ((i < mIdeal ? wl : wu) - 1) / 2; if (r < 1) continue; pass(a, tmp, r, true); pass(tmp, a, r, false); }
};
/** The pencil grain as a 64 x 64 mask (1 = full ink): seeded dots that let the paper through, tiled in drawing space. */
const GRAIN_MASKS = new Map();
const grainMask = (seed, grain) => {
  const key = `${seed}|${grain}`;
  if (GRAIN_MASKS.has(key)) return GRAIN_MASKS.get(key);
  const r = rng(`pg:${seed}`), T = 64, m = new Float32Array(T * T).fill(1), n = Math.round(70 * grain);
  for (let i = 0; i < n; i++) {
    const w = 1 + Math.floor(r() * 2.6), h = 1 + Math.floor(r() * 2.2), g = Math.round(40 + r() * 110), x0 = Math.floor(r() * T), y0 = Math.floor(r() * T), v = ((g / 255 + 0.055) / 1.055) ** 2.4;
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) m[(y % T) * T + (x % T)] = v;
  }
  GRAIN_MASKS.set(key, m);
  return m;
};
/** Paint layers on a W x H canvas whose top-left is drawing point (ox, oy); premultiplied RGBA 0..1. */
const paint = (W, H, ox, oy, layers) => {
  const d = new Float32Array(W * H * 4);
  for (const L of layers) {
    if (!L || !L.polys?.length) continue;
    const cov = coverage(W, H, L.polys, ox, oy);
    if (L.blur) blurAlpha(cov, W, H, L.blur);
    const c = parseColor(L.color) ?? parseColor(RED), R = c[0] / 255, G = c[1] / 255, B = c[2] / 255, A = (L.alpha ?? 1) * (c[3] ?? 1);
    const gm = L.grain ? grainMask(L.seed ?? 'g', L.grain) : null;
    for (let y = 0; y < H; y++) {
      const gy = gm ? ((Math.floor(y + oy) % 64) + 64) % 64 * 64 : 0;
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        let k = cov[i];
        if (k <= 0) continue;
        if (gm) k *= gm[gy + ((Math.floor(x + ox) % 64) + 64) % 64];
        if (L.amount) k *= L.amount(x + ox + 0.5, y + oy + 0.5);
        k *= A;
        if (k <= 0) continue;
        const o = i * 4, q = 1 - k;
        d[o] = R * k + d[o] * q; d[o + 1] = G * k + d[o + 1] * q; d[o + 2] = B * k + d[o + 2] * q; d[o + 3] = k + d[o + 3] * q;
      }
    }
  }
  return { W, H, d };
};
const toPng = (cv) => pngUri(cv.W, cv.H, 4, (x, y, b, o) => {
  const i = (y * cv.W + x) * 4, a = cv.d[i + 3];
  if (a <= 0) { b[o] = b[o + 1] = b[o + 2] = b[o + 3] = 0; return; }
  b[o] = Math.round(clamp(cv.d[i] / a) * 255); b[o + 1] = Math.round(clamp(cv.d[i + 1] / a) * 255); b[o + 2] = Math.round(clamp(cv.d[i + 2] / a) * 255); b[o + 3] = Math.round(clamp(a) * 255);
});
const imgAt = (cv, left, top, style = '') => `<img src="${toPng(cv)}" style="position:absolute;left:${n2(left)}px;top:${n2(top)}px;width:${cv.W}px;height:${cv.H}px;max-width:none;${style}">`;
/**
 * Ink layers painted over the part [x0, y0, w, h] of drawing space, as an <img> for a container whose top-left is
 * drawing point (ox, oy). The picture lands on whole pixels of the container.
 */
const inkImg = (box, layers, { ox = 0, oy = 0, style = '' } = {}) => {
  const X = ox + Math.floor(box[0] - ox) - 2, Y = oy + Math.floor(box[1] - oy) - 2;
  const W = Math.ceil(box[0] + box[2] - X) + 2, H = Math.ceil(box[1] + box[3] - Y) + 2;
  return imgAt(paint(W, H, X, Y, layers), X - ox, Y - oy, style);
};
const roundRect = (x, y, w, h, r) => {
  const pts = [], c = [[x + w - r, y + r, -Math.PI / 2], [x + w - r, y + h - r, 0], [x + r, y + h - r, Math.PI / 2], [x + r, y + r, Math.PI]];
  for (const [cx, cy, a0] of c) for (let k = 0; k <= 4; k++) { const a = a0 + (k / 4) * (Math.PI / 2); pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }); }
  return pts;
};
/** A strip of masking tape with torn ends: centred on `cx`, top at `top`, turned `rot` degrees about its middle. */
const tapePoly = ({ seed, cx, top, w, h, rot }) => {
  const r = rng(`${seed}:tape`), side = (right) => Array.from({ length: 7 }, (_, i) => ({ x: right ? w - r() * 0.03 * w : r() * 0.03 * w, y: (i / 6) * h }));
  const P = [...side(false), ...side(true).reverse()], th = (rot * Math.PI) / 180, co = Math.cos(th), si = Math.sin(th);
  return P.map((p) => { const x = p.x - w / 2, y = p.y - h / 2; return { x: cx + x * co - y * si, y: top + h / 2 + x * si + y * co }; });
};
const tapeLayers = (poly) => [{ polys: [poly.map((p) => ({ x: p.x, y: p.y + 1 }))], color: INK, alpha: 0.12, blur: 1 }, { polys: [poly], color: TAPE }];
/**
 * A sheet of paper painted here: w x h with rounded corners, turned `rot` degrees and scaled `scale` about its centre
 * (as a CSS transform would), with the card fibre, a hairline edge, its shadows, tape ({ seed, cx, top, w, h, rot } in
 * sheet coordinates) and ink layers on it (sheet coordinates). `only: 'ink'` paints the ink alone, on the same turn
 * (a highlighter laid on later). An <img> for a w x h container; it spills over by `m` on every side.
 */
const paperImg = ({ w, h, rot = 0, scale = 1, radius = 3, color = NOTE, shadows = PAPER_SHADOW, edge = 0.3, fibre = 1, tapes = [], ink = [], m = 70, only = null }) => {
  const th = (rot * Math.PI) / 180, co = Math.cos(th) * scale, si = Math.sin(th) * scale, cx = w / 2, cy = h / 2, s2 = scale * scale;
  const T = (p) => ({ x: cx + (p.x - cx) * co - (p.y - cy) * si, y: cy + (p.x - cx) * si + (p.y - cy) * co });
  const map = (P) => P.map(T), sheet = map(roundRect(0, 0, w, h, radius)), layers = [];
  if (only !== 'ink') {
    for (const s of shadows) layers.push({ polys: [map(roundRect(0, s.dy, w, h, radius))], color: INK, alpha: s.alpha, blur: s.blur * scale });
    layers.push({ polys: [sheet], color });
    if (fibre) layers.push({ polys: [sheet], color: '#282828', amount: (x, y) => { const px = x - cx, py = y - cy; return fibreAt(cx + (px * co + py * si) / s2, cy + (-px * si + py * co) / s2) * fibre; } });
    if (edge) layers.push({ polys: [map(roundRect(-1, -1, w + 2, h + 2, radius + 1)), sheet.slice().reverse()], color: INK, alpha: edge });
    for (const tp of tapes) layers.push(...tapeLayers(map(tapePoly(tp))));
  }
  for (const L of ink) layers.push({ ...L, polys: L.polys.map(map) });
  const M = Math.ceil(m), W = Math.ceil(w) + 2 * M, H = Math.ceil(h) + 2 * M;
  return imgAt(paint(W, H, -M, -M, layers), -M, -M);
};

// ------------------------------------------------------------------ the brush
// Variable-width ribbon along a spine (remocn's brushRibbon with a pressure profile and a slow wobble in the
// width). The spine is densified and the outline jittered from the seed, so the edge is hand-rough in geometry.
const normalAt = (pts, i) => { const a = pts[i - 1] ?? pts[i], b = pts[i + 1] ?? pts[i]; const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1; return { x: -dy / l, y: dx / l }; };
const densify = (pts, k) => { const out = []; for (let i = 0; i < pts.length - 1; i++) for (let j = 0; j < k; j++) { const t = j / k; out.push({ x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, y: pts[i].y + (pts[i + 1].y - pts[i].y) * t }); } out.push(pts[pts.length - 1]); return out; };
const disc = (p, r, n = 14) => Array.from({ length: n }, (_, i) => ({ x: p.x + r * Math.cos((i / n) * Math.PI * 2), y: p.y + r * Math.sin((i / n) * Math.PI * 2) }));
/** profile(t) -> 0..1 gives the pressure at fraction t of the whole stroke; `progress` draws only the first part (0 draws nothing). Polygons. */
const ribbon = (spine0, { width, profile, progress = 1, seed = 'r', rough = 0.08, dens = 3 }) => {
  if (progress <= 0) return [];
  const spine = densify(spine0, dens), N = spine.length, drawn = clamp(Math.round(progress * (N - 1)) + 1, 2, N), r = rng(`${seed}:w`), ph = r() * 6.28, ph2 = r() * 6.28;
  const L = [], R = [];
  for (let i = 0; i < drawn; i++) {
    const t = i / (N - 1), wob = 1 + 0.1 * Math.sin(ph + t * 14) + 0.06 * Math.sin(ph2 + t * 31);
    const h = (width / 2) * profile(t) * wob * (1 + (r() - 0.5) * rough * 2.4), nr = normalAt(spine, i), jl = (r() - 0.5) * width * rough, jr = (r() - 0.5) * width * rough;
    L.push({ x: spine[i].x + nr.x * (h + jl), y: spine[i].y + nr.y * (h + jl) });
    R.push({ x: spine[i].x - nr.x * (h + jr), y: spine[i].y - nr.y * (h + jr) });
  }
  const h0 = Math.hypot(L[0].x - R[0].x, L[0].y - R[0].y) / 2, h1 = Math.hypot(L[drawn - 1].x - R[drawn - 1].x, L[drawn - 1].y - R[drawn - 1].y) / 2;
  return [[...L, ...R.slice().reverse()], disc(spine[0], h0 * 0.9), disc(spine[drawn - 1], h1 * 0.9)];
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
/** One pencil stroke as a layer: the colour a little transparent, with the pencil grain. */
const stroke = (color, polys, o = {}) => ({ polys, color, alpha: o.alpha ?? 0.93, grain: o.grain ?? 0.8, seed: o.seed ?? 'g' });

// ------------------------------------------------------------------ hand-made primitives (each returns layers)
const ellipsePt = (a, b, n, th) => { const c = Math.cos(th), s = Math.sin(th); return { x: a * Math.sign(c) * Math.abs(c) ** (2 / n), y: b * Math.sign(s) * Math.abs(s) ** (2 / n) }; };

/**
 * remocn's scribble-circle: an ellipse with seeded wobble that overshoots its own start
 * (laps > 1 and a radius that drifts, so the end crosses the beginning instead of closing it).
 */
const scribbleSpine = ({ rx, ry, seed = 'c', laps = 1.16, n = 2.5, points = 76 }) => {
  const r = rng(`${seed}:circle`), th0 = -2.35 + (r() - 0.5) * 0.9, dir = r() < 0.5 ? 1 : -1;
  const p1 = r() * 6.28, p2 = r() * 6.28, p4 = r() * 6.28, p5 = r() * 6.28, drift = 0.05 + r() * 0.035, cx = (r() - 0.5) * 0.04, cy = (r() - 0.5) * 0.04, tilt = (r() - 0.5) * 0.12;
  const cnt = Math.ceil(laps * points), rn = rng(`${seed}:noise`), ct = Math.cos(tilt), st = Math.sin(tilt);
  return Array.from({ length: cnt }, (_, i) => {
    const t = i / (cnt - 1), th = th0 + dir * laps * Math.PI * 2 * t;
    const k = 0.965 + drift * t + 0.034 * Math.sin(th + p4) + 0.024 * Math.sin(2 * th + p5) + 0.016 * Math.sin(p1 + t * 9) + 0.01 * Math.sin(p2 + t * 23) + (rn() - 0.5) * 0.012;
    const q = ellipsePt(rx * k, ry * k, n, th), x = q.x + cx * rx * (0.5 + t), y = q.y + cy * ry * (0.5 + t);
    return { x: x * ct - y * st, y: x * st + y * ct };
  });
};
const circleProfile = (t) => (0.2 + 0.8 * smooth(0, 0.58, t)) * (1 - 0.4 * smooth(0.9, 1, t));
/** The circle in the box (0, 0, w, h), its stroke kept `margin` inside the edge; `ox`, `oy` move it. */
const scribbleCircle = ({ w, h, width, color = RED, progress = 1, seed = 'c', laps, n, margin, ox = 0, oy = 0 }) => {
  const m = margin ?? width * 0.75, rx = w / 2 - m, ry = h / 2 - m;
  // the drift and wobble push the loop past its nominal radius: fit what was drawn into the box (its picture is cut at the box)
  const raw = scribbleSpine({ rx, ry, seed, laps, n }), xs = raw.map((p) => p.x), ys = raw.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const spine = raw.map((p) => ({ x: ox + m + ((p.x - x0) / (x1 - x0 || 1)) * (w - 2 * m), y: oy + m + ((p.y - y0) / (y1 - y0 || 1)) * (h - 2 * m) }));
  // a lighter retrace: the hand goes round again over the same line, a little off it
  const trace = spine.map((p, i) => ({ x: p.x + Math.sin(i * 0.31 + 1) * width * 0.22, y: p.y + Math.cos(i * 0.27) * width * 0.22 }));
  return [stroke(color, ribbon(spine, { width, profile: circleProfile, progress, seed }), { seed }),
    stroke(color, ribbon(trace, { width: width * 0.4, profile: circleProfile, progress, seed: `${seed}t` }), { seed: `${seed}t`, grain: 1, alpha: 0.4 })];
};

/** remocn's ink-arrow: a bowed shaft with pressure, and a hand-drawn head (two arms). */
const inkArrow = ({ from, to, width, color = RED, shaft = 1, armL = 1, armR = 1, bow = 0.3, seed = 'a' }) => {
  const dx = to.x - from.x, dy = to.y - from.y, d = Math.hypot(dx, dy) || 1, nx = -dy / d, ny = dx / d, r = rng(`${seed}:arrow`), wob = d * 0.035;
  const at = (t) => ({ x: from.x + dx * t + nx * bow * d + (r() - 0.5) * 2 * wob, y: from.y + dy * t + ny * bow * d + (r() - 0.5) * 2 * wob });
  const c1 = at(0.3), c2 = at(0.72);
  const polys = ribbon(sampleCubic(from, c1, c2, to, 40), { width, profile: (t) => (0.4 + 0.6 * smooth(0, 0.3, t)) * (1 - 0.2 * smooth(0.8, 1, t)), progress: shaft, seed, rough: 0.1 });
  const ex = to.x - c2.x, ey = to.y - c2.y, el = Math.hypot(ex, ey) || 1, bx = -ex / el, by = -ey / el, reach = clamp(d * 0.22, width * 4.2, width * 7.5);
  const arm = (a) => ({ x: to.x + reach * (bx * Math.cos(a) - by * Math.sin(a)), y: to.y + reach * (bx * Math.sin(a) + by * Math.cos(a)) });
  const apex = { x: to.x + (ex / el) * width * 0.4, y: to.y + (ey / el) * width * 0.4 };
  const armPolys = (tip, p, k) => ribbon(shaky(sampleLine(apex, tip, 3), { sub: 4, amp: width * 0.3, seed: `${seed}:arm${k}` }), { width: width * 0.95, profile: (t) => 1 - 0.5 * t, progress: p, seed: `${seed}${k}`, rough: 0.1 });
  polys.push(...armPolys(arm(0.68 + (r() - 0.5) * 0.14), armL, 'l'), ...armPolys(arm(-0.68 + (r() - 0.5) * 0.14), armR, 'r'));
  return [stroke(color, polys, { seed })];
};

/** remocn's ink-underline, swashed: a long stroke with pressure that lifts toward the end, then a short lighter second stroke under it. */
const underlineSpine = (x0, x1, y, seed, thick) => {
  const r = rng(`${seed}:ul`), tilt = (r() - 0.35) * thick * 1.4, w = x1 - x0, wob = (r() - 0.5) * thick * 1.1;
  return sampleCubic({ x: x0, y: y + thick * 0.25 }, { x: x0 + w * 0.3, y: y + wob }, { x: x0 + w * 0.7, y: y - wob * 0.6 }, { x: x1, y: y - tilt }, 48);
};
/** `progress` 0..1 draws the first stroke, then the second. */
const underline = (color, x0, x1, y, thick, seed, progress = 1) => {
  const p1 = clamp(progress / 0.72), p2 = clamp((progress - 0.72) / 0.28), w = x1 - x0;
  const main = ribbon(underlineSpine(x0, x1, y, seed, thick), { width: thick, profile: (t) => (0.35 + 0.65 * smooth(0, 0.14, t)) * (1 - 0.6 * smooth(0.8, 1, t)), progress: p1, seed, rough: 0.13 });
  const second = ribbon(underlineSpine(x0 + w * 0.16, x0 + w * 0.7, y + thick * 1.45, `${seed}b`, thick * 0.8), { width: thick * 0.62, profile: (t) => (0.4 + 0.6 * smooth(0, 0.2, t)) * (1 - 0.65 * smooth(0.7, 1, t)), progress: p2, seed: `${seed}b`, rough: 0.15 });
  return [stroke(color, main, { seed }), stroke(color, second, { seed: `${seed}b`, grain: 1, alpha: 0.72 })];
};

/** A hand-wobbled square (about `size`), strokes of `width`; the start overshoots the last corner. */
const wobblyBox = ({ size, width, color = INK, seed = 'b', ox = 0, oy = 0 }) => {
  const r = rng(`${seed}:box`), nud = () => (r() - 0.5) * size * 0.1, lo = size * 0.08, hi = size - lo;
  const c = [[lo + nud(), lo + nud()], [hi + nud(), lo + nud()], [hi + nud(), hi + nud()], [lo + nud(), hi + nud()], [lo + nud() - 2, lo + size * 0.12]];
  const pts = c.map(([x, y]) => ({ x: x + ox, y: y + oy }));
  return [stroke(color, ribbon(shaky(pts, { sub: 7, amp: size * 0.07, seed }), { width, profile: (t) => 0.8 + 0.3 * Math.sin(Math.PI * t), seed }), { seed, grain: 0.6, alpha: 0.9 })];
};
/** remocn's tick, from nothing to the whole mark (progress 0..1: the short down-stroke, then the long up-stroke). */
const tick = ({ size, width, color = OLIVE, seed, progress = 1, ox = 0, oy = 0 }) => {
  const r = rng(`${seed}:tick`), j = () => (r() - 0.5) * size * 0.06;
  const pts = [{ x: size * 0.2 + j(), y: size * 0.5 + j() }, { x: size * 0.42 + j(), y: size * 0.8 + j() }, { x: size * 0.98 + j(), y: size * -0.02 + j() }].map((p) => ({ x: p.x + ox, y: p.y + oy }));
  return [stroke(color, ribbon(shaky(pts, { sub: 9, amp: size * 0.04, seed }), { width, profile: (t) => 0.75 + 0.35 * Math.sin(Math.PI * t), progress, seed }), { seed, grain: 0.6 })];
};
/** The highlighter behind a word w0 x h at (ox, oy): a ragged-ended slab, a hair off level, drawn `progress` of the way across. */
const markerSlab = ({ w0, h, color, seed, alpha = 0.34, progress = 1, ox = 0, oy = 0 }) => {
  if (progress <= 0) return [];
  const w = w0 * progress, r = rng(`${seed}:mk`), ex = h * 0.14, top = h * 0.16, bot = h * 0.92, sk = (r() - 0.5) * h * 0.06;
  const P = [[-ex + r() * 4, top + r() * 3 + sk], [w * 0.5, top - 1 + r() * 3], [w + ex - r() * 3, top + 2 + r() * 3 - sk], [w + ex + 3, (top + bot) / 2 + r() * 3], [w + ex - r() * 4, bot - r() * 3 - sk], [w * 0.5, bot + r() * 3], [-ex + r() * 3, bot - 2 + r() * 3 + sk], [-ex - 3, (top + bot) / 2 + r() * 3]];
  return [stroke(color, [P.map(([x, y]) => ({ x: x + ox, y: y + oy }))], { seed: `${seed}:m`, grain: 0.35, alpha })];
};

// ------------------------------------------------------------------ hand-set type
const charSpan = (ch, i, o) => {
  const r = rng(`${o.seed}:${i}`), rot = (r() * 2 - 1) * (o.slant ?? 3), dy = (r() * 2 - 1) * (o.base ?? 1.5);
  const a = adv(ch, o.weight), wpx = n2((a + (o.track ?? 0)) * o.size), lh = n2(o.size * (o.lh ?? 1.2));
  return `<span style="display:inline-block;width:${wpx}px;height:${lh}px;line-height:${lh}px;color:${o.color};transform:translateY(${n2(dy)}px) rotate(${n2(rot)}deg);transform-origin:${n2(wpx / 2)}px ${n2(lh * 0.7)}px">${esc(ch)}</span>`;
};
/** One line of hand-set text: per-character slant and baseline wobble from a seed. `chars` = array of { c, em }; emphasis takes `accent`. */
const handLine = (chars, o) => `<div style="display:flex;white-space:pre;height:${n2(o.size * (o.lh ?? 1.2))}px;font-family:${o.family};font-weight:${o.weight};font-size:${n2(o.size)}px">${chars.map((ch, i) => charSpan(ch.c, (o.i0 ?? 0) + i, { ...o, color: ch.em ? (o.accent ?? RED) : o.color })).join('')}</div>`;
const toChars = (text) => emChars(text);
const plain = (text) => parseEmphasis(text).map((r) => r.t).join('');
const normText = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();
/** Chars of a plain string, with emphasis flags kept, split to the lines that were wrapped on the plain text. */
const sliceChars = (chars, lines) => {
  let k = 0; const out = [];
  for (const ln of lines) {
    while (k < chars.length && chars[k].c === ' ') k++;
    const part = []; let m = 0;
    while (m < ln.length && k < chars.length) { part.push(chars[k]); k++; m++; }
    out.push(part);
  }
  return out;
};
const lineWidth = (chars, size, weight, track = 0) => chars.reduce((w, ch) => w + (adv(ch.c, weight) + track) * size, 0);
const FAM = (c) => c.font('text');
/**
 * A pose sequence as extra pieces, one per pose, each shown whole for `holds[k]` poses from `at` (the last one stays).
 * Each window ends exactly where the next begins, so on any clock tick exactly one pose shows. (Not one extra with
 * `poses`: this engine draws every captured pose of an extra at the same time.) `style` places each pose's element;
 * `z` orders them among the owner's extras. Returns { html, pieces } to splice into a builder's result.
 */
const poseSeq = (name, poseHtml, at, { rate = 10, holds = [], pad = 24, style = '', z } = {}) => {
  const pieces = {}; let t = at;
  const html = poseHtml.map((h, k) => {
    const next = t + (holds[k] ?? 1) / rate, last = k === poseHtml.length - 1;
    pieces[`${name}${k}`] = { at: t, enter: 'fade', sec: 0.0001, ...(z !== undefined ? { z } : {}), ...(last ? {} : { until: next, exitSec: 0.0001 }) };
    t = next;
    return `<div data-p="${name}${k}" data-pad="${pad}" style="${style}">${h}</div>`;
  }).join('');
  return { html, pieces };
};

// ------------------------------------------------------------------ exports for the primitive sheet
export const lab = { INK, RED, OLIVE, OLIVE_TXT, PAPER, NOTE, FRAME, PAPER_CSS, CARD_GRAIN, inkImg, paperImg, scribbleCircle, inkArrow, underline, wobblyBox, tick, markerSlab, handLine, toChars, measure, wrapBalanced, rng, hashStr };

// ------------------------------------------------------------------ builders
const strokeW = (c) => c.u * 7.5 * 2;            // the pencil mark's peak width in the 2x callout capture (7.5 u at 1x)

/* ---- the photo print: paper fibre and a hairline round the picture; a split's photos lie flat in prints drawn as furniture ---- */
const windowBuilder = (c) => {
  const { box, view, insets: ins, scene } = c;
  if (!scene) return { html: '', css: `.win{box-shadow:0 0 0 1px rgba(38,36,44,0.22) !important}` };
  const edge = ins.t > 0 || ins.b > 0
    ? `<div style="position:absolute;left:${n2(view.left - box.left - 1)}px;top:${n2(view.top - box.top - 1)}px;width:${n2(view.w + 2)}px;height:${n2(view.h + 2)}px;box-shadow:0 0 0 1px rgba(38,36,44,0.2)"></div>` : '';
  return { html: `<div style="position:absolute;inset:0;background-image:${CARD_GRAIN}"></div>${edge}` };
};

/* ---- captions: the tag laid on with a highlighter, then the words written into the strip of the print (or on a taped note) ---- */
/** Seconds a caption is on screen: from its own start to the next caption's, or the scene's length. */
const captionSpan = (scene, tag, text) => {
  const caps = scene?.type === 'clip' && scene.captions?.length ? [...scene.captions].sort((a, b) => a.atSec - b.atSec) : null;
  if (caps) {
    const i = caps.findIndex((x) => x.text === text && (x.tag ?? scene.tag) === tag);
    if (i >= 0) return (i + 1 < caps.length ? caps[i + 1].atSec : scene.durationSec) - caps[i].atSec;
  }
  return scene?.durationSec ?? 4;
};
const captionBuilder = (c) => {
  const { pos, tag, text, color, u, scene, style } = c;
  const sw = /width:([\d.]+)px/.exec(pos.css);
  const strip = pos.key.startsWith('s') && sw;                         // the print's own strip, else a note over the picture
  const floating = !strip;
  const availW = strip ? +sw[1] - 72 * u : c.W * 0.62, baseSize = c.size, weight = 700, tagGap = 0.5;
  const tagTextW = (sz) => (tag ? measure(tag, sz, weight) : 0), tagW = (sz) => (tag ? tagTextW(sz) + sz * tagGap : 0);
  const chars = toChars(normText(text)), flat = plain(normText(text));
  // fit: one line at 100%, 92% or 85%; else two balanced lines (the second hangs under the first, clear of the tag); else shrink toward 76% and cut with an ellipsis
  let size = baseSize, lines = null;
  for (const k of [1, 0.92, 0.85]) { if (tagW(baseSize * k) + measure(flat, baseSize * k, weight) <= availW) { size = baseSize * k; lines = [flat]; break; } }
  if (!lines) {
    for (const k of [0.92, 0.86, 0.8, 0.76]) { size = baseSize * k; lines = wrapBalanced(flat, size, availW - tagW(size), weight); if (lines.length <= 2) break; }
    if (lines.length > 2) { lines = lines.slice(0, 2); lines[1] = lines[1].replace(/\s*\S*$/, '') + '…'; }
  }
  const lh = 1.14, lineH = size * lh, indent = tagW(size), family = FAM(c), seed = `cap:${tag}:${flat}`;
  const parts = sliceChars(chars, lines.map((l) => l.replace(/…$/, '')));
  const o = { family, weight, size, color: INK, accent: c.accent, seed, slant: 2.2, base: size * 0.022, lh };
  const rowsW = Math.max(...parts.map((p, k) => lineWidth(p, size, weight) + (lines[k].endsWith('…') ? adv('…', weight) * size : 0)));
  const blockW = indent + rowsW, blockH = lines.length * lineH;
  // how fast the words are written: 16 characters a second, faster when that would not finish with time to read
  const tagSec = tag ? 0.3 : 0, n = flat.length, budget = Math.max(0.8, captionSpan(scene, tag, text) - (style.caption.delay ?? 0.3) - tagSec - 1.4);
  const cps = Math.round(clamp(n / budget, style.caption.typeCps ?? 16, 44) * 2) / 2;
  const rows = parts.map((p, k) => {
    const lc = lines[k].endsWith('…') ? [...p, { c: '…', em: false }] : p;
    return `<div style="height:${n2(lineH)}px;padding-left:${n2(indent)}px">${handLine(lc, { ...o, i0: parts.slice(0, k).reduce((a, q) => a + q.length, 0) })}</div>`;
  }).join('');
  // pieces, in drawing order: the note (the pill), the highlighter's three poses, the tag, the written words
  const pieces = { txt: { at: tagSec, enter: 'type', cps, caret: 'none', z: 3 } };
  const txt = `<div data-p="txt" data-pad="16" style="position:absolute;left:0;top:0;width:${n2(blockW)}px;height:${n2(blockH)}px"><div data-type>${rows}</div></div>`;
  const tg = tag ? `<div data-p="tg" data-pad="16" style="position:absolute;left:0;top:0;width:${n2(tagTextW(size))}px;height:${n2(lineH)}px">${handLine(toChars(tag), { ...o, seed: `${seed}:t` })}</div>` : '';
  if (tag) pieces.tg = { at: 0, enter: 'fade', sec: 0.0001, z: 2 };
  const tilt = floating ? hr(seed, -1.3, 1.3) : 0, padX = size * 0.75, padY = size * 0.32, noteW = blockW + padX * 2, noteH = blockH + padY * 2;
  const slabAt = (prog) => markerSlab({ w0: tagTextW(size), h: lineH, color, seed: `${seed}:tag`, alpha: color === INK ? 0.16 : 0.34, progress: prog, ox: floating ? padX : 0, oy: floating ? padY : 0 });
  const slabPose = (prog) => (floating
    ? paperImg({ w: noteW, h: noteH, rot: tilt, only: 'ink', ink: slabAt(prog), m: 24 })
    : inkImg([-lineH * 0.3, 0, tagTextW(size) + lineH * 0.6, lineH], slabAt(prog)));
  let slab = '';
  if (tag) {
    const seq = poseSeq('sl', [0.4, 0.78, 1].map(slabPose), 0, { pad: floating ? 24 : 12, z: 1, style: floating ? `position:absolute;left:0;top:0;width:${n2(noteW)}px;height:${n2(noteH)}px` : `position:absolute;left:0;top:0;width:${n2(tagTextW(size))}px;height:${n2(lineH)}px` });
    Object.assign(pieces, seq.pieces); slab = seq.html;
  }
  const inner = floating
    ? `<div style="position:relative;width:${n2(noteW)}px;height:${n2(noteH)}px"><div id="pill" style="position:absolute;left:0;top:0;width:${n2(noteW)}px;height:${n2(noteH)}px">${paperImg({ w: noteW, h: noteH, rot: tilt, radius: 3 * u, tapes: [{ seed, cx: noteW / 2, top: -14 * u, w: 132 * u, h: 36 * u, rot: hr(`${seed}:tp`, -4, 4) }] })}</div>${slab}<div style="position:absolute;left:0;top:0;width:${n2(noteW)}px;height:${n2(noteH)}px;transform:rotate(${n2(tilt)}deg)"><div style="position:absolute;left:${n2(padX)}px;top:${n2(padY)}px">${tg}${txt}</div></div></div>`
    : `<div style="position:relative;width:${n2(blockW)}px;height:${n2(blockH)}px"><div id="pill" style="position:absolute;left:0;top:0;width:2px;height:2px"></div>${slab}${tg}${txt}</div>`;
  const wrapStyle = strip
    ? `position:absolute;${pos.css};display:flex;align-items:center;justify-content:flex-start;padding-left:${n2(34 * u)}px`
    : `position:absolute;${pos.css};display:flex;align-items:center;justify-content:center`;
  return { html: `<div style="${wrapStyle};font-family:${family}">${inner}</div>`, pieces };
};

/* ---- callout label: a note on the open side, with a long arrow aimed at the circle ---- */
/**
 * Where the callout's box is on screen while it shows, from the scene's own camera moves: its typical width
 * (to aim the arrow) and the room to the right and above/below it inside the picture (the label is clipped to
 * the picture, and the engine puts the label's left edge at the box's left edge).
 */
const calloutRoom = (c) => {
  const { spec, style, scene, callout, u } = c, lay = scene ? sceneLayout(spec, style, scene) : null;
  const pad = (style.callout.pad ?? 8) * u, [x, y, w, h] = callout.box, fps = spec.fps ?? 60;
  if (!lay) return { bw: 240 * u, right: 600 * u, above: 300 * u, below: 300 * u };
  const v = lay.view, ease = makeCameraEase(style.camera?.ease), t0 = callout.atSec ?? 0, dur = callout.forSec ?? style.callout.forSec ?? 2.5;
  const S = [];
  for (let k = 0; k <= 10; k++) {
    const cam = cameraTransform(cameraAt(scene.moves, (t0 + 0.1 + (dur - 0.2) * (k / 10)) * fps, fps, ease), v.w, v.h);
    const left = v.left + cam.tx + x * v.w * cam.z - pad, top = v.top + cam.ty + y * v.h * cam.z - pad, bw = w * v.w * cam.z + pad * 2, bh = h * v.h * cam.z + pad * 2;
    const cx = left + bw / 2, cy = top + bh / 2;
    if (cx > v.left && cx < v.left + v.w && cy > v.top && cy < v.top + v.h) S.push({ bw, right: v.left + v.w - left, above: top - 10 * u - v.top, below: v.top + v.h - (top + bh + 10 * u) });
  }
  if (!S.length) S.push({ bw: w * v.w + pad * 2, right: v.w * (1 - x), above: y * v.h - pad - 10 * u, below: v.h * (1 - y - h) - pad - 10 * u });
  const bws = S.map((s) => s.bw).sort((a, b) => a - b);
  return { bw: bws[bws.length >> 1], right: Math.min(...S.map((s) => s.right)), above: Math.min(...S.map((s) => s.above)), below: Math.min(...S.map((s) => s.below)) };
};
const chipBuilder = (c) => {
  const { label, u, side, accent } = c, below = side === 'below', seed = `chip:${label}:${c.index}.${c.calloutIndex}`;
  const room = c.callout?.box ? calloutRoom(c) : { bw: 240 * u, right: 600 * u, above: 300 * u, below: 300 * u };
  const M = 18 * u, maxW = Math.max(160 * u, room.right - M * 2), family = FAM(c), weight = 700;
  const flat = plain(normText(label)), chars = toChars(normText(label)), tipX0 = clamp(room.bw * 0.34, 26 * u, 240 * u), gapX = 30 * u;
  // the label: one line beside the tip at 38, 34 or 30 u; else one line over it; else two lines (beside, then over); else two lines at 30 u
  const fits = (sz, ls, x0) => x0 + Math.max(...ls.map((l) => measure(l, sz, weight))) + sz * 0.84 <= maxW;
  const two = (sz) => wrapBalanced(flat, sz, measure(flat, sz, weight) * 0.6, weight), sizes = [38, 34, 30].map((k) => k * u);
  const tries = [
    ...sizes.map((sz) => [sz, [flat], 'right']), ...sizes.map((sz) => [sz, [flat], 'over']),
    ...sizes.map((sz) => [sz, two(sz), 'right']), ...sizes.map((sz) => [sz, two(sz), 'over']),
  ];
  const [size, lines, place] = tries.find(([sz, ls, pl]) => fits(sz, ls, pl === 'right' ? tipX0 + gapX : 0)) ?? [30 * u, two(30 * u), 'over'];
  const parts = sliceChars(chars, lines), lineH = size * 1.12, padX = size * 0.42, padY = size * 0.2;
  const noteW = Math.max(...parts.map((p) => lineWidth(p, size, weight))) + padX * 2, noteH = parts.length * lineH + padY * 2;
  const roomV = below ? room.below : room.above, band = clamp(roomV - noteH - M * 2, 56 * u, 118 * u);
  const noteX = place === 'right' ? M + tipX0 + gapX : M, tipX = M + tipX0;
  const W0 = Math.max(noteX + noteW, tipX + 30 * u) + M, H0 = noteH + band + M;
  const noteY = below ? H0 - M - noteH : M;
  const tip = { x: tipX, y: below ? 3 * u : H0 - 3 * u };
  const tail = place === 'right'
    ? { x: noteX + 4 * u, y: below ? noteY + noteH * 0.35 : noteY + noteH * 0.65 }
    : { x: noteX + Math.min(noteW * 0.62, Math.max(noteW * 0.3, tipX - noteX + 70 * u)), y: below ? noteY - 5 * u : noteY + noteH + 5 * u };
  // bow toward the corner (tip.x, tail.y), so the arrow leaves the note sideways and comes down onto the circle
  const dx = tip.x - tail.x, dy = tip.y - tail.y, d = Math.hypot(dx, dy) || 1, mid = { x: (tip.x + tail.x) / 2, y: (tip.y + tail.y) / 2 };
  const bow = Math.sign((-dy / d) * (tip.x - mid.x) + (dx / d) * (tail.y - mid.y) || 1) * (place === 'right' ? 0.24 : 0.14);
  const rot = hr(seed, -1.6, 1.6);
  const o = { family, weight, size, color: INK, accent, seed, slant: 1.8, base: size * 0.02, lh: 1.12 };
  const rows = parts.map((p, k) => handLine(p, { ...o, i0: k * 50 })).join('');
  const note = `<div style="position:absolute;left:${n2(noteX)}px;top:${n2(noteY)}px;width:${n2(noteW)}px;height:${n2(noteH)}px">${paperImg({ w: noteW, h: noteH, rot, radius: 2.5 * u, shadows: [{ dy: 3, blur: 4, alpha: 0.18 }], m: 24 })}<div style="position:absolute;inset:0;padding:${n2(padY)}px ${n2(padX)}px;transform:rotate(${n2(rot)}deg);white-space:nowrap">${rows}</div></div>`;
  const arrow = inkImg([0, 0, W0, H0], inkArrow({ from: tail, to: tip, width: 5.6 * u, color: accent, bow, seed }));
  return { html: `<div id="chip" style="position:absolute;left:20px;top:20px;width:${n2(W0)}px;height:${n2(H0)}px;font-family:${family}">${arrow}${note}</div>` };
};

/* ---- callout mark: a scribble circle drawn on in 10 poses ---- */
const CIRCLE_POSES = 10;
const markBuilder = (c) => {
  const { w, h, callout } = c, sw = strokeW(c), seed = `mark:${Math.round(w)}x${Math.round(h)}:${(callout.box ?? []).map((v) => Math.round(v * 1000)).join(',')}`;
  const poses = Array.from({ length: CIRCLE_POSES }, (_, k) => inkImg([0, 0, w, h], scribbleCircle({ w, h, width: sw, color: c.accent, progress: (k + 1) / CIRCLE_POSES, seed, margin: sw * 0.75, n: 2.5 })));
  // every pose is in the first HTML too (hidden), so each picture is decoded before the engine swaps the poses in
  return { html: `${poses[0]}<div style="position:absolute;left:0;top:0;opacity:0">${poses.slice(1).join('')}</div>`, poses };
};

/* ---- title: hand-written on, an ink underline drawn on in poses after it, then a sticker slapped on ---- */
const UL_POSES = 5;
const titleBuilder = (c) => {
  const { W, H, u, scene, style, accent } = c, effect = scene.effect ?? style.title.enter ?? 'soft-blur-in', family = c.font('display'), weight = 700;
  const tokSize = W * style.title.size, chars = emChars(scene.text), flat = chars.map((x) => x.c).join(''), seed = `title:${flat}`;
  const T = style.motion.text, tk = style.title;
  let size = tokSize, layout, writeSec;
  if (effect === 'word-push') {
    const words = emWords(scene.text), gapPx = () => 0.22 * size;
    const fit = (sz) => words.reduce((a, wd) => a + measure(wd.w, sz, weight), 0) + 0.22 * sz * (words.length - 1);
    while (fit(size) > W * 0.9 && size > tokSize * 0.4) size *= 0.96;
    let x = 0;
    layout = [{ words: words.map((wd) => { const wpx = measure(wd.w, size, weight), o = { ...wd, x, wpx }; x += wpx + gapPx(); return o; }), width: fit(size), gapPx: gapPx() }];
    const P = T.wordPush, gap = P.gapSec != null ? P.gapSec * 30 : P.gap, rf = (n) => (gap * (1 - P.accel ** n)) / (1 - P.accel);
    writeSec = (rf(words.length - 1) + 1 + (P.slideSec != null ? P.slideSec * 30 : P.slide)) / 30;
  } else {
    const wrap = (sz) => wrapBalanced(flat, sz, W * 0.84, weight);
    let lines = wrap(size);
    while (lines.length > 2 && size > tokSize * 0.5) { size *= 0.94; lines = wrap(size); }
    let k = 0; layout = [];
    for (const ln of lines) {
      while (k < chars.length && chars[k].c === ' ') k++;
      const row = [];
      for (let m = 0; m < ln.length && k < chars.length; m++, k++) row.push({ ...chars[k], k });
      layout.push({ chars: row, width: lineWidth(row, size, weight) });
    }
    const SB = T.softBlur, MS = T.microScale, LM = tk.lines ?? {};
    writeSec = effect === 'micro-scale-fade' ? (MS.sec != null ? MS.sec : MS.frames / 30)
      : effect === 'type' ? chars.length / (tk.typeCps ?? 24)
      : effect === 'lines' ? (layout.length - 1) * (LM.stagger ?? 0.09) + (LM.sec ?? 0.6)
      : (chars.length - 1) * (SB.staggerSec ?? 0.05) + (SB.sec ?? 0.03);
  }
  if (tk.maxEnterSec && writeSec > tk.maxEnterSec) writeSec = tk.maxEnterSec;     // the engine speeds the writing up the same way
  const oBase = { family, weight, color: INK, accent, seed, slant: 2.6, base: size * 0.016, lh: 1.2 };
  const lh = size * 1.2, last = layout.length - 1, lastW = layout[last].width, wrapW = Math.max(...layout.map((l) => l.width));
  let block;
  if (effect === 'word-push') {
    const L = layout[0];
    block = `<div style="display:flex;white-space:nowrap;height:${n2(lh)}px">${L.words.map((wd, j) => `<div data-p="w${j}" data-pad="40" style="position:relative;height:${n2(lh)}px;${j < L.words.length - 1 ? `margin-right:${n2(L.gapPx)}px` : ''}">${handLine([...wd.w].map((ch) => ({ c: ch, em: wd.em })), { ...oBase, size, i0: j * 40 })}</div>`).join('')}</div>`;
  } else if (effect === 'micro-scale-fade' || effect === 'type' || effect === 'lines') {
    // one picture: the engine scales it, types it line by line, or lifts each line into its band
    block = `<div data-p="all" data-pad="40" ${effect === 'micro-scale-fade' ? '' : 'data-type '}style="width:${n2(wrapW)}px">${layout.map((L) => `<div style="display:flex;justify-content:center;height:${n2(lh)}px">${handLine(L.chars, { ...oBase, size, i0: L.chars[0]?.k ?? 0 })}</div>`).join('')}</div>`;
  } else {
    block = `<div>${layout.map((L) => `<div style="display:flex;justify-content:center;height:${n2(lh)}px">${L.chars.map((ch) => (ch.c.trim() ? `<span data-p="c${ch.k}" data-pad="44" style="position:relative;display:inline-block">${handLine([ch], { ...oBase, size, i0: ch.k })}</span>` : `<span style="display:inline-block;width:${n2(adv(' ', weight) * size)}px"></span>`)).join('')}</div>`).join('')}</div>`;
  }
  // the underline: extra pieces whose poses draw it on once the writing is done
  const th = size * 0.065, x0 = -size * 0.1, x1 = lastW + size * 0.12, ulH = lh * 0.75, ulTop = last * lh + lh * 0.8, ulLeft = (wrapW - lastW) / 2 + x0, ulY = lh * 0.13 + th;
  const ulPose = (p) => inkImg([x0 - 20, 0, x1 - x0 + 40, ulH], underline(accent, x0, x1, ulY, th, seed, p), { ox: x0 });
  const ulAt = writeSec + 0.1;
  const ul = poseSeq('ul', Array.from({ length: UL_POSES }, (_, k) => ulPose((k + 1) / UL_POSES)), ulAt, { pad: 30, style: `position:absolute;left:${n2(ulLeft)}px;top:${n2(ulTop)}px;width:${n2(x1 - x0)}px;height:${n2(ulH)}px` });
  const pieces = { ...ul.pieces };
  // the subtitle: a paper sticker slapped on as the underline finishes: 1.12 for two poses, then 1
  let sticker = '';
  if (has(scene.subtitle)) {
    const ss = Math.round(W * 0.026), tilt = hr(`${seed}:sub`, -2.4, 2.4), sch = toChars(normText(scene.subtitle));
    const sw = lineWidth(sch, ss, 600) + ss * 1.5, shh = ss * 1.2 + ss * 0.62, padS = Math.ceil(sw * 0.07 + 30);
    const face = (sc) => `${paperImg({ w: sw, h: shh, rot: tilt, scale: sc, radius: 3 * u, shadows: [{ dy: 3 * sc, blur: 4 * sc, alpha: n2(0.13 + 0.06 * (sc - 1) * 8) }], m: padS })}<div style="position:absolute;left:0;top:0;width:${n2(sw)}px;height:${n2(shh)}px;padding:${n2(ss * 0.31)}px ${n2(ss * 0.75)}px 0;transform:rotate(${n2(tilt)}deg) scale(${sc});white-space:nowrap">${handLine(sch, { family, weight: 600, size: ss, color: INK, accent, seed: `${seed}:s`, slant: 1.8, base: ss * 0.02, lh: 1.15 })}</div>`;
    const stk = poseSeq('stk', [face(1.12), face(1)], ulAt + 0.3, { holds: [2, 1], pad: padS, style: `position:absolute;left:0;top:0;width:${n2(sw)}px;height:${n2(shh)}px` });
    Object.assign(pieces, stk.pieces);
    sticker = `<div style="position:relative;margin-top:${n2(size * 0.42)}px;width:${n2(sw)}px;height:${n2(shh)}px">${stk.html}</div><div data-p="sub" data-pad="0" style="position:absolute;left:0;top:0;width:2px;height:2px"></div>`;
  }
  return { html: `<div class="af" style="align-items:center;justify-content:center;padding-bottom:${n2(H * 0.03)}px"><div style="position:relative">${block}${ul.html}</div>${sticker}</div>`, pieces };
};

/* ---- hand-set text pieces (card lines, list items): written on with the engine's multi-line type ---- */
const textPiece = ({ name, text, size, weight = 600, maxW, color = INK, accent, seed, family, leadW = 0, pad = 8, lh = 1.16, extra = '', cls = 'piece' }) => {
  const norm = normText(text), chars = toChars(norm), flat = plain(norm);
  const lines = wrapBalanced(flat, size, maxW - leadW, weight), parts = sliceChars(chars, lines), lineH = size * lh;
  const o = { family, weight, size, color, accent, seed, slant: 2.4, base: size * 0.02, lh };
  const rows = parts.map((p, k) => `<div style="margin-left:${n2(leadW)}px;height:${n2(lineH)}px">${handLine(p, { ...o, i0: parts.slice(0, k).reduce((a, q) => a + q.length, 0) })}</div>`).join('');
  return { html: `<div class="${cls}" data-p="${name}" data-pad="${pad}" style="position:relative;height:${n2(lines.length * lineH)}px">${extra}<div data-type>${rows}</div></div>`, height: lines.length * lineH, n: flat.length };
};
/** An empty stand-in for a fixed piece the engine always draws (the real text is an extra piece with its own timing). */
const standIn = (name) => `<div class="piece" data-p="${name}" data-pad="0" style="position:absolute;left:0;top:0;width:2px;height:2px"></div>`;

/* ---- the issue: a note taped to the board, written line by line ---- */
const issueBuilder = (c) => {
  const { u, scene, style, accent } = c, K = style.card, family = FAM(c), seed = `issue:${scene.id}:${scene.title}`;
  const width = K.width * u, padX = K.padX * u, padY = K.padY * u, inner = width - padX * 2, gap = 18 * u;
  const sign = hashStr(seed) % 2 ? 1 : -1, tilt = sign * hr(`${seed}:tilt`, 0.9, 1.6);
  const red = style.palette.tagColors?.Before ?? style.palette.danger;
  const metaSize = 40 * u, metaH = metaSize * 1.7, hasMeta = has(scene.source) || has(scene.id) || has(scene.status);
  let status = '', statusInk = [];
  if (has(scene.status)) {
    // the status is circled on the paper itself (painted with it); its words sit in the same place on the turned content
    const st = 40 * u, bw = measure(scene.status, st, 700) + 58 * u, bh = st * 1.55, sx = width - padX - bw, sy = padY + (metaH - bh) / 2;
    statusInk = scribbleCircle({ w: bw, h: bh, width: 5 * u, color: OLIVE, seed: `${seed}:st`, margin: 5 * u, laps: 1.12, ox: sx, oy: sy });
    status = `<div style="position:absolute;left:${n2(sx)}px;top:${n2(sy)}px;width:${n2(bw)}px;height:${n2(bh)}px;display:flex;align-items:center;justify-content:center">${handLine(toChars(String(scene.status)), { family, weight: 700, size: st, color: OLIVE_TXT, seed: `${seed}:status`, slant: 2, base: 0.5, lh: 1.1 })}</div>`;
  }
  const metaRow = hasMeta
    ? `<div style="display:flex;align-items:center;gap:${14 * u}px;height:${n2(metaH)}px;flex-shrink:0;font-size:${n2(metaSize)}px">${has(scene.source) ? handLine(toChars(String(scene.source)), { family, weight: 600, size: metaSize, color: 'rgba(38,36,44,0.72)', seed: `${seed}:src`, slant: 2, base: 0.5, lh: 1.15 }) : ''}${has(scene.id) ? handLine(toChars(String(scene.id)), { family, weight: 700, size: metaSize, color: INK, seed: `${seed}:id`, slant: 2, base: 0.5, lh: 1.15 }) : ''}</div>` : '';
  const title = has(scene.title) ? textPiece({ name: 'title', text: scene.title, size: 74 * u, weight: 700, maxW: inner, seed: `${seed}:t`, family, accent, lh: 1.12, pad: 10 }) : null;
  // the quote and the reporter are written after the title, one after the other (extra pieces with their own start and speed)
  const barW = 34 * u, qSize = 52 * u, pieces = {};
  const quote = has(scene.quote) ? textPiece({ name: 'q', text: `“${normText(scene.quote)}”`, size: qSize, weight: 600, maxW: inner, leadW: barW, seed: `${seed}:q`, family, accent, lh: 1.14, pad: 10, cls: '' }) : null;
  const reporter = has(scene.reporter) ? textPiece({ name: 'rep', text: scene.reporter, size: 42 * u, weight: 600, maxW: inner, color: 'rgba(38,36,44,0.84)', seed: `${seed}:r`, family, accent, lh: 1.16, pad: 10, cls: '' }) : null;
  const titleCps = 40, start = style.motion.card.rows[0] ?? 0.35, titleEnd = start + (title ? title.n / titleCps : 0);
  const budgetEnd = (scene.durationSec ?? 6) - 1.3;
  const qAt = titleEnd + 0.25, repN = reporter ? reporter.n : 0;
  const qCps = quote ? clamp(quote.n / Math.max(0.6, budgetEnd - qAt - 0.2 - repN / 40), 30, 70) : 30;
  if (quote) pieces.q = { at: qAt, enter: 'type', cps: Math.round(qCps), caret: 'none' };
  if (reporter) pieces.rep = { at: quote ? qAt + quote.n / Math.round(qCps) + 0.2 : qAt, enter: 'type', cps: 40, caret: 'none' };
  let bar = '';
  if (quote) {
    const bh = quote.height, bw = 14 * u, spine = shaky([{ x: bw / 2, y: 2 }, { x: bw / 2 + 1.5 * u, y: bh - 2 }], { sub: 9, amp: 3 * u, seed: `${seed}:bar` });
    bar = inkImg([-8, -8, bw + 16, bh + 16], [stroke(red, ribbon(spine, { width: 6 * u, profile: (t) => 0.75 + 0.25 * Math.sin(Math.PI * t), seed }), { seed, grain: 0.7 })]);
  }
  const q = quote ? quote.html.replace(/(<div class=""[^>]*>)/, `$1${bar}`) : '';
  // the card's height, laid out here so the paper can be painted to size
  const rowsH = [hasMeta ? metaH : null, title?.height, quote?.height, reporter?.height].filter((v) => v != null);
  const cardH = padY + rowsH.reduce((a, b) => a + b, 0) + gap * Math.max(0, rowsH.length - 1) + padY * 0.9;
  const paper = paperImg({ w: width, h: cardH, rot: tilt, radius: 3 * u, tapes: [{ seed, cx: width / 2, top: -26 * u, w: 170 * u, h: 44 * u, rot: -2.5 }], ink: statusInk, m: 90 });
  return {
    html: `<div class="af" style="align-items:center;justify-content:center;font-family:${family}">
    <div id="card" style="position:relative;width:${n2(width)}px;height:${n2(cardH)}px">${paper}
      <div style="position:absolute;left:0;top:0;width:${n2(width)}px;height:${n2(cardH)}px;padding:${n2(padY)}px ${n2(padX)}px ${n2(padY * 0.9)}px;transform:rotate(${n2(tilt)}deg);display:flex;flex-direction:column;gap:${n2(gap)}px">
        ${metaRow}${status}${title?.html ?? ''}${q}${reporter?.html ?? ''}${quote ? standIn('quote') : ''}${reporter ? standIn('reporter') : ''}
      </div></div></div>`,
    pieces,
  };
};

/* ---- the list: a hand-drawn check-list; each item is written, then ticked in three strokes ---- */
const listBuilder = (c) => {
  const { u, scene, style, accent } = c, K = style.list, M = style.motion.list, family = FAM(c), seed = `list:${scene.title}:${(scene.items ?? []).join('|')}`;
  const width = K.width * u, size = 66 * u, B = size * 0.78, gapX = size * 0.42;
  const hs = 108 * u, sub = 48 * u, pieces = {};
  let headTitle = '', hul = '';
  if (has(scene.title)) {
    // the heading's underline is its own pieces (beside the heading, not in it), drawn on in poses
    const ch = toChars(normText(scene.title)), w = lineWidth(ch, hs, 700), th = hs * 0.06, ulH = hs * 0.5, x0 = -8 * u, x1 = w + 10 * u;
    const ulPose = (p) => inkImg([x0 - 16, 0, x1 - x0 + 32, ulH], underline(accent, x0, x1, th * 1.6, th, seed, p), { ox: x0 });
    const seq = poseSeq('hul', Array.from({ length: UL_POSES }, (_, k) => ulPose((k + 1) / UL_POSES)), 0.35, { pad: 24, style: `position:absolute;left:${n2(x0)}px;top:${n2(hs * 1.02)}px;width:${n2(x1 - x0)}px;height:${n2(ulH)}px` });
    Object.assign(pieces, seq.pieces);
    headTitle = `<div style="position:relative;height:${n2(hs * 1.36)}px;width:${n2(w)}px">${handLine(ch, { family, weight: 700, size: hs, color: INK, accent, seed: `${seed}:h`, slant: 2.6, base: hs * 0.012, lh: 1.2 })}</div>`;
    hul = seq.html;
  }
  const headSub = has(scene.subtitle) ? `<div style="margin-top:${n2(sub * 0.1)}px;opacity:0.74">${handLine(toChars(normText(scene.subtitle)), { family, weight: 600, size: sub, color: INK, accent, seed: `${seed}:s`, slant: 2, base: sub * 0.02, lh: 1.2 })}</div>` : '';
  const head = headTitle || headSub ? `<div style="align-self:flex-start;position:relative"><div data-p="head" data-pad="30">${headTitle}${headSub}</div>${hul}</div>` : '';
  const itemCps = 45;   // the engine writes list items at this speed
  const items = (scene.items ?? []).map((it, k) => {
    const sd = `${seed}:${k}`, bs = B + 14 * u, ox = 2 * u, oy = 6 * u;
    const boxImg = inkImg([-8, -8, bs + 16, bs + 16], wobblyBox({ size: B, width: 4.2 * u, seed: sd, ox, oy }));
    const tp = textPiece({ name: `i${k}`, text: it, size, weight: 600, maxW: width, leadW: B + gapX, seed: sd, family, accent, pad: 12, lh: 1.2, extra: `<div style="position:absolute;left:0;top:${n2(size * 0.1)}px;width:${n2(B)}px;height:${n2(B)}px">${boxImg}</div>` });
    const tickPose = (p) => inkImg([-12, -12, bs + 24, bs + 24], tick({ size: B, width: 6.6 * u, seed: sd, progress: p, ox, oy }));
    const seq = poseSeq(`tk${k}x`, [0.34, 0.7, 1].map(tickPose), M.start + k * M.step + tp.n / itemCps + 0.1, { pad: 16, style: `position:absolute;left:0;top:${n2(size * 0.1)}px;width:${n2(bs)}px;height:${n2(bs)}px` });
    Object.assign(pieces, seq.pieces);
    return `<div style="position:relative;height:${n2(tp.height)}px">${tp.html}${seq.html}</div>`;
  }).join('');
  return { html: `<div class="af" style="align-items:center;justify-content:center;font-family:${family}"><div style="width:max-content;max-width:${n2(width)}px;display:flex;flex-direction:column;gap:${n2(K.gap * u)}px">${head}<div style="display:flex;flex-direction:column;gap:${n2(K.itemGap * u * 1.2)}px">${items}</div></div></div>`, pieces };
};

/* ---- furniture: the split's two prints, and the print's own paper behind a full-bleed picture ---- */
const furnitureBuilder = (c) => {
  const { W, H, u, scene, style } = c;
  // full bleed: we have leaned into the print, so the paper that shows past its tilted edge is the print's own
  if (c.sceneType === 'clip' && scene.frame === 'full') return { html: `<div style="position:absolute;inset:0;background-image:${CARD_GRAIN};background-color:${FRAME}"></div>` };
  if (c.sceneType !== 'split') return null;
  // two level prints (the engine draws a split's recordings level), a strip under each for its tag, taped to the board
  const boxes = splitBoxes(style, W, H, scene.aspect), P = 20 * u, S = style.split;
  const prints = boxes.map(({ outer: b }, i) => {
    const labelTop = b.top - H * S.labelRise, labelH = W * S.labelSize * 1.35, bottom = Math.max(b.top + b.h + 40 * u, labelTop + labelH + 18 * u);
    const tp = tapePoly({ seed: `split:${i}`, cx: b.left - P + (b.w + P * 2) * (i ? 0.7 : 0.3), top: b.top - P - 16 * u, w: 112 * u, h: 34 * u, rot: hr(`split:${i}:r`, -5, 5) });
    const xs = tp.map((p) => p.x), ys = tp.map((p) => p.y);
    return `<div style="position:absolute;left:${n2(b.left - P)}px;top:${n2(b.top - P)}px;width:${n2(b.w + P * 2)}px;height:${n2(bottom - b.top + P)}px;border-radius:${n2(3 * u)}px;background-image:${CARD_GRAIN};background-color:${FRAME};box-shadow:0 0 0 1px rgba(38,36,44,0.08),${SHADOW}"></div>`
      + inkImg([Math.min(...xs) - 4, Math.min(...ys) - 4, Math.max(...xs) - Math.min(...xs) + 8, Math.max(...ys) - Math.min(...ys) + 10], tapeLayers(tp));
  }).join('');
  return { html: prints };
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

export { titleBuilder, windowBuilder, captionBuilder, chipBuilder, markBuilder, issueBuilder, listBuilder, furnitureBuilder };

// ------------------------------------------------------------------ the style
const SPLIT_H = 0.44;   // the split's prints are height-bound for any recording up to about 16:9, so the tag under each lands in its strip
export default {
  name: 'sketch',
  extends: 'studio',
  description: 'Hand and imperfection: a photo pinned to cream paper, annotated by hand in held poses.',
  suits: 'Bug-fix before/afters, where circling the bug by hand says it fastest.',
  palette: {
    background: PAPER_CSS, foreground: INK, accent: RED, onAccent: NOTE,
    tagColors: TAGS, tagFallback: INK, danger: RED,
    // a spec's colours are pulled onto this palette once, here: tags go red, olive or ink by their name;
    // the accent becomes the pencil (circles, arrows, underlines, emphasis), deepened toward ink until it reads on the board
    mapTag: (name) => tagByName(name),
    mapAccent: (c, t) => t.ensureContrast(t.mix(c, INK, 0.22), PAPER, 4.5),
  },
  fonts: {
    text: { family: 'Caveat', weights: [600, 700], fallback: "'Segoe Print', 'Bradley Hand', cursive" },
    display: { family: 'Caveat', weights: [600, 700], fallback: "'Segoe Print', 'Bradley Hand', cursive" },
    mono: { family: 'Caveat', weights: [600, 700], fallback: "'Segoe Print', 'Bradley Hand', cursive" },
  },
  canvas: { matte: PAPER, model: 'shared', background: { kind: 'css' } },
  window: { maxWidth: 0.9, maxHeight: 0.91, top: 0.026, radius: 0.0031, fill: FRAME, shadow: SHADOW, shadowPad: 60, insets: [22, 22, 124, 22], tilt: 0, tiltJitter: 0.8, jitter: true },
  caption: { variant: 'plain', placement: 'slot', align: 'left', size: 0.026, enter: 'fade', rise: 0, typeCps: 16, caret: 'none', delay: 0.3, exit: 0.017 },
  build: { title: titleBuilder, issue: issueBuilder, list: listBuilder, window: windowBuilder, caption: captionBuilder, calloutChip: chipBuilder, calloutMark: markBuilder, furniture: furnitureBuilder },
  title: { size: 0.075, weight: 700, measure: 'glyph', subtitleOpacity: 1, subtitleEnter: 'fade', maxEnterSec: 1.5, typeCps: 24, caret: 'none' },
  card: { width: 1060, padX: 64, padY: 56, shadowPad: 96, rowEnter: 'type' },
  list: { width: 1180, gap: 26, itemGap: 16, itemEnter: 'type' },
  split: { width: 0.9, height: SPLIT_H, top: 0.13, gap: 0.045, labelSize: 0.026, labelRise: -(SPLIT_H + 0.018) },
  callout: { mark: 'ring', pad: 44, dimAlpha: 0.2, dimColor: INK, scaleIn: 1, forSec: 2.5, enterSec: 0.02, exitSec: 0.017 },
  motion: {
    // stop motion: every entrance is a cut on a pose (a spring that settles within one frame), nothing glides
    spring: { stiffness: 360000, damping: 1200, mass: 1 }, poseRate: 10,
    clock: { poses: 10, seed: 63420, jitterPx: 1.0, jitterDeg: 0.08 },
    card: { rise: 0, rows: [0.35, 0.35, 0.35], alpha: [1, 1, 1] },
    list: { headRise: 0, start: 0.5, step: 0.72, dx: 0, dy: 0 },
    split: { stagger: 0, rise: 0 },
    text: { softBlur: { stagger: 3, rise: 0, blur: 0, frames: 0.01, riseFrames: 0.01, staggerSec: 0.05, sec: 0.001, riseSec: 0.001, ease: [0.22, 1, 0.36, 1] }, microScale: { frames: 9, from: 1.03, ease: [0.32, 0.72, 0, 1] }, subtitle: { from: 0, to: 0.05, rise: 0 } },
  },
  camera: { ease: { type: 'bezier', curve: [0.45, 0, 0.25, 1] }, motionBlur: null },
  transition: { default: 'paper-swap', sec: 0.5, stepped: true, custom: TRANSITIONS },
};
