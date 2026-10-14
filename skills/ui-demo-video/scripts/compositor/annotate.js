// Hand-drawn annotations for every style (Node only): a circle round the thing that changed,
// an underline or highlight for text, a box for a region, a bracket for a group, a strike or a
// cross for what was removed, and an arrow from a short label, drawn on like a pen.
//
// The geometry is Rough Notation's (MIT, (c) 2020 Preet Shihn, github.com/rough-stuff/rough-notation)
// on the generator of rough.js (MIT, (c) 2019 Preet Shihn, github.com/rough-stuff/rough), ported
// below with the same seeded generator, the same random offsets, bowing and double strokes, the
// ellipse that starts a little inside itself and overlaps its own start, and the same draw-on:
// every path drawn one after another, each with a share of the duration in proportion to its
// length and its own ease-out (CSS `ease-out`), iterations in sequence. Two changes for video:
// the circle is sized to enclose the target (Rough Notation's sits inside the padded box, which
// cuts the corners of a button), and its radius jitter is capped in px so a big circle cannot dip
// into what it circles. No runtime dependency.
//
// Determinism: Chrome's GPU raster draws the edges of SVG paths a level or two differently from one
// launch to the next, so nothing here is an SVG. Each stroke is painted in this file into two PNGs
// that Chrome never rasterises (compose.mjs hands them to the compositor as they are):
//   colour  the ink and its casing, premultiplied after decode, at RES texels per output px;
//   time    for every texel, the moment (0..1 of the draw) the pen reaches it: the arc-length
//           fraction along its path, mapped through the path's start, share and ease-out. 16 bits
//           in R (high) and G (low), opaque. The shader shows a texel once the draw has reached it,
//           so one picture draws itself on at any frame rate.
// The mark keeps its stroke width on screen while the camera zooms: it is painted once per zoom
// level the callout meets (levels 8 % apart, the same seed and the same structure, so a level change
// is a sub-pixel change of width) and the page picks the nearest. The arrow and label keep their size.

import zlib from 'node:zlib';
import { parseColor, contrast, ensureContrast, mix } from './color.js';
import { ID, esc, richHtml, sceneLayout, cameraPose } from './layout.js';
import { cameraTransform, makeCameraEase } from './motion.js';

export const RES = 2;                 // texels per output px
const LEVEL = 1.08;                   // zoom levels of the mark: 8 % apart (stroke width within 4 % of its size)
const MAX_LEVELS = 24;

// ------------------------------------------------------------------ rough.js, ported (MIT, Preet Shihn)
class Random {
  constructor(seed) { this.seed = seed; }
  next() { return this.seed ? ((2 ** 31 - 1) & (this.seed = Math.imul(48271, this.seed))) / 2 ** 31 : 0.5; }   // seed 0 never reaches here (seedOf)
}
/** rough-notation's getOptions: 'single' | 'double' | 'highlight'. */
const roughOpts = (seed, type, over = {}) => ({
  maxRandomnessOffset: 2, roughness: type === 'highlight' ? 3 : 1.5, bowing: 1, curveTightness: 0, curveFitting: 0.95, curveStepCount: 9,
  disableMultiStroke: type !== 'double', preserveVertices: false, seed, randomizer: null, ...over,
});
const random = (o) => { if (!o.randomizer) o.randomizer = new Random(o.seed); return o.randomizer.next(); };
const _offset = (min, max, o, gain = 1) => o.roughness * gain * (random(o) * (max - min) + min);
const _offsetOpt = (x, o, gain = 1) => _offset(-x, x, o, gain);
function _line(x1, y1, x2, y2, o, move, overlay) {
  const lengthSq = (x1 - x2) ** 2 + (y1 - y2) ** 2, length = Math.sqrt(lengthSq);
  const gain = length < 200 ? 1 : length > 500 ? 0.4 : -0.0016668 * length + 1.233334;
  let offset = o.maxRandomnessOffset || 0;
  if (offset * offset * 100 > lengthSq) offset = length / 10;
  const halfOffset = offset / 2, divergePoint = 0.2 + random(o) * 0.2;
  let midDispX = (o.bowing * o.maxRandomnessOffset * (y2 - y1)) / 200, midDispY = (o.bowing * o.maxRandomnessOffset * (x1 - x2)) / 200;
  midDispX = _offsetOpt(midDispX, o, gain); midDispY = _offsetOpt(midDispY, o, gain);
  const ops = [], randomHalf = () => _offsetOpt(halfOffset, o, gain), randomFull = () => _offsetOpt(offset, o, gain), pv = o.preserveVertices;
  if (move) {
    if (overlay) ops.push({ op: 'move', data: [x1 + (pv ? 0 : randomHalf()), y1 + (pv ? 0 : randomHalf())] });
    else ops.push({ op: 'move', data: [x1 + (pv ? 0 : _offsetOpt(offset, o, gain)), y1 + (pv ? 0 : _offsetOpt(offset, o, gain))] });
  }
  const r = overlay ? randomHalf : randomFull;
  ops.push({ op: 'bcurveTo', data: [
    midDispX + x1 + (x2 - x1) * divergePoint + r(), midDispY + y1 + (y2 - y1) * divergePoint + r(),
    midDispX + x1 + 2 * (x2 - x1) * divergePoint + r(), midDispY + y1 + 2 * (y2 - y1) * divergePoint + r(),
    x2 + (pv ? 0 : r()), y2 + (pv ? 0 : r()),
  ] });
  return ops;
}
const _doubleLine = (x1, y1, x2, y2, o) => { const o1 = _line(x1, y1, x2, y2, o, true, false); return o.disableMultiStroke ? o1 : o1.concat(_line(x1, y1, x2, y2, o, true, true)); };
const line = (x1, y1, x2, y2, o) => _doubleLine(x1, y1, x2, y2, o);
const linearPath = (pts, close, o) => {
  const n = pts.length;
  if (n > 2) {
    const ops = [];
    for (let i = 0; i < n - 1; i++) ops.push(..._doubleLine(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], o));
    if (close) ops.push(..._doubleLine(pts[n - 1][0], pts[n - 1][1], pts[0][0], pts[0][1], o));
    return ops;
  }
  return n === 2 ? line(pts[0][0], pts[0][1], pts[1][0], pts[1][1], o) : [];
};
const rectangle = (x, y, w, h, o) => linearPath([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true, o);
function _curve(points, o) {
  const len = points.length, ops = [];
  if (len > 3) {
    const s = 1 - o.curveTightness;
    ops.push({ op: 'move', data: [points[1][0], points[1][1]] });
    for (let i = 1; i + 2 < len; i++) {
      const p = points[i];
      ops.push({ op: 'bcurveTo', data: [
        p[0] + (s * points[i + 1][0] - s * points[i - 1][0]) / 6, p[1] + (s * points[i + 1][1] - s * points[i - 1][1]) / 6,
        points[i + 1][0] + (s * points[i][0] - s * points[i + 2][0]) / 6, points[i + 1][1] + (s * points[i][1] - s * points[i + 2][1]) / 6,
        points[i + 1][0], points[i + 1][1],
      ] });
    }
  }
  return ops;
}
function _computeEllipsePoints(increment, cx, cy, rx, ry, offset, overlap, o) {
  const all = [], radOffset = _offsetOpt(0.5, o) - Math.PI / 2;
  all.push([_offsetOpt(offset, o) + cx + 0.9 * rx * Math.cos(radOffset - increment), _offsetOpt(offset, o) + cy + 0.9 * ry * Math.sin(radOffset - increment)]);
  const endAngle = Math.PI * 2 + radOffset - 0.01;
  for (let a = radOffset; a < endAngle; a += increment) all.push([_offsetOpt(offset, o) + cx + rx * Math.cos(a), _offsetOpt(offset, o) + cy + ry * Math.sin(a)]);
  all.push([_offsetOpt(offset, o) + cx + rx * Math.cos(radOffset + Math.PI * 2 + overlap * 0.5), _offsetOpt(offset, o) + cy + ry * Math.sin(radOffset + Math.PI * 2 + overlap * 0.5)]);
  all.push([_offsetOpt(offset, o) + cx + 0.98 * rx * Math.cos(radOffset + overlap), _offsetOpt(offset, o) + cy + 0.98 * ry * Math.sin(radOffset + overlap)]);
  all.push([_offsetOpt(offset, o) + cx + 0.9 * rx * Math.cos(radOffset + overlap * 0.5), _offsetOpt(offset, o) + cy + 0.9 * ry * Math.sin(radOffset + overlap * 0.5)]);
  return all;
}
/** generateEllipseParams + ellipseWithParams. `stepCount` (optional) pins the number of points, so every zoom level of one
 * circle draws the same random sequence (rough.js derives it from the size). Returns the ops and the step count used. */
const ellipse = (x, y, w, h, o, stepCount) => {
  const psq = Math.sqrt(Math.PI * 2 * Math.sqrt(((w / 2) ** 2 + (h / 2) ** 2) / 2));
  const steps = stepCount ?? Math.ceil(Math.max(o.curveStepCount, (o.curveStepCount / Math.sqrt(200)) * psq));
  const increment = (Math.PI * 2) / steps, fit = 1 - o.curveFitting;
  let rx = Math.abs(w / 2), ry = Math.abs(h / 2);
  rx += _offsetOpt(rx * fit, o); ry += _offsetOpt(ry * fit, o);
  let ops = _curve(_computeEllipsePoints(increment, x, y, rx, ry, 1, increment * _offset(0.1, _offset(0.4, 1, o), o), o), o);
  if (!o.disableMultiStroke && o.roughness !== 0) ops = ops.concat(_curve(_computeEllipsePoints(increment, x, y, rx, ry, 1.5, 0, o), o));
  return { ops, steps };
};

// ------------------------------------------------------------------ ops -> polylines
const cubicPts = (p0, c1, c2, p3) => {
  const est = Math.hypot(c1[0] - p0[0], c1[1] - p0[1]) + Math.hypot(c2[0] - c1[0], c2[1] - c1[1]) + Math.hypot(p3[0] - c2[0], p3[1] - c2[1]);
  const n = Math.max(3, Math.min(400, Math.ceil(est / 1.5))), out = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p3[1]]);
  }
  return out;
};
/** rough-notation's opsToPath: every `move` starts a new path. Each path becomes a polyline [[x, y], ...]. */
const opsToPaths = (opLists) => {
  const paths = []; let cur = null;
  for (const ops of opLists) for (const { op, data } of ops) {
    if (op === 'move') { if (cur?.length > 1) paths.push(cur); cur = [[data[0], data[1]]]; }
    else if (op === 'bcurveTo') cur.push(...cubicPts(cur[cur.length - 1], [data[0], data[1]], [data[2], data[3]], [data[4], data[5]]));
    else if (op === 'lineTo') cur.push([data[0], data[1]]);
  }
  if (cur?.length > 1) paths.push(cur);
  return paths;
};

// ------------------------------------------------------------------ Rough Notation's annotations
export const ANNOTATIONS = ['circle', 'box', 'underline', 'highlight', 'bracket', 'strike', 'cross'];
export const BRACKET_SIDES = ['left', 'right', 'top', 'bottom'];
/** The ellipse round a rect (half sizes p, q): the same margin e on both axes, with the rect's corners on it, plus `extra`. */
const enclosing = (p, q, extra) => {
  let lo = 0, hi = Math.max(p, q) * 2 + 1;
  for (let i = 0; i < 50; i++) { const e = (lo + hi) / 2; if ((p / (p + e)) ** 2 + (q / (q + e)) ** 2 > 1) lo = e; else hi = e; }
  return { a: p + hi + extra, b: q + hi + extra };
};
/**
 * The paths of one annotation round `rect` ({ x, y, w, h }, px), in drawing order: renderAnnotation's switch.
 * opts: padding (px), iterations, brackets, seed, stepCount (circle: pin the point count), capPx (the circle's radius jitter cap).
 * Returns { paths: [[[x, y]...]...], width (highlight: the band's width, else null), steps }.
 */
export const notationPaths = (type, rect, { padding = 5, iterations = 2, brackets = ['right'], seed = 1, stepCount, capPx = 5, inkWidth = 4 } = {}) => {
  const P = [padding, padding, padding, padding], o = roughOpts(seed, 'single'), ops = [];
  let width = null, steps = null;
  const alt = (fn) => { for (let i = 0; i < iterations; i++) ops.push(i % 2 ? fn(true) : fn(false)); };
  switch (type) {
    case 'underline': { const y = rect.y + rect.h + P[2]; alt((back) => (back ? line(rect.x + rect.w, y, rect.x, y, o) : line(rect.x, y, rect.x + rect.w, y, o))); break; }
    case 'strike': { const y = rect.y + rect.h / 2; alt((back) => (back ? line(rect.x + rect.w, y, rect.x, y, o) : line(rect.x, y, rect.x + rect.w, y, o))); break; }
    case 'box': {
      const x = rect.x - P[3], y = rect.y - P[0], w = rect.w + P[1] + P[3], h = rect.h + P[0] + P[2];
      for (let i = 0; i < iterations; i++) ops.push(rectangle(x, y, w, h, o));
      break;
    }
    case 'bracket': {
      const lx = rect.x - P[3] * 2, rx = rect.x + rect.w + P[1] * 2, ty = rect.y - P[0] * 2, by = rect.y + rect.h + P[2] * 2;
      for (const br of brackets) {
        const pts = br === 'bottom' ? [[lx, rect.y + rect.h], [lx, by], [rx, by], [rx, rect.y + rect.h]]
          : br === 'top' ? [[lx, rect.y], [lx, ty], [rx, ty], [rx, rect.y]]
          : br === 'left' ? [[rect.x, ty], [lx, ty], [lx, by], [rect.x, by]]
          : br === 'right' ? [[rect.x + rect.w, ty], [rx, ty], [rx, by], [rect.x + rect.w, by]] : null;
        if (pts) ops.push(linearPath(pts, false, o));
      }
      break;
    }
    case 'cross': {
      const x = rect.x, y = rect.y, x2 = x + rect.w, y2 = y + rect.h;
      alt((back) => (back ? line(x2, y2, x, y, o) : line(x, y, x2, y2, o)));
      alt((back) => (back ? line(x, y2, x2, y, o) : line(x2, y, x, y2, o)));
      break;
    }
    case 'circle': {
      // enclose the padded rect; the radius jitter (curveFitting) is capped to capPx so a big circle cannot dip into it
      const p = rect.w / 2 + P[1], q = rect.h / 2 + P[0], { a, b } = enclosing(p, q, inkWidth / 2 + 2);
      const fit = (r) => Math.min(0.05, capPx / (1.5 * Math.max(r, 1)));
      const d = roughOpts(seed, 'double', { curveFitting: 1 - fit(Math.max(a, b)) }), s = roughOpts(seed, 'single', { curveFitting: 1 - fit(Math.max(a, b)) });
      const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2, full = Math.floor(iterations / 2), single = iterations - full * 2;
      for (let i = 0; i < full; i++) { const e = ellipse(cx, cy, a * 2, b * 2, d, stepCount); steps = e.steps; ops.push(e.ops); }
      for (let i = 0; i < single; i++) { const e = ellipse(cx, cy, a * 2, b * 2, s, stepCount); steps = e.steps; ops.push(e.ops); }
      break;
    }
    case 'highlight': {
      const oh = roughOpts(seed, 'highlight'), y = rect.y + rect.h / 2;
      width = rect.h * 0.95;
      for (let i = 0; i < iterations; i++) ops.push(i % 2 ? line(rect.x + rect.w, y, rect.x, y, oh) : line(rect.x, y, rect.x + rect.w, y, oh));
      break;
    }
    default: throw new Error(`internal: unknown annotation "${type}"`);
  }
  return { paths: opsToPaths(ops), width, steps };
};

// ------------------------------------------------------------------ the arrow (sketch's ink-arrow, generalised)
const seededRng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
/**
 * An arrow from `tail` to `tip` (px): a shaft bowed toward the corner (tip.x, tail.y), so it leaves the label sideways and
 * comes down onto the mark, then a hand-drawn head (two arms from the apex). Paths with their share of the draw.
 */
export const arrowPaths = (tail, tip, { head = 15, bow = 0.22, seed = 1 } = {}) => {
  const r = seededRng(seed), dx = tip[0] - tail[0], dy = tip[1] - tail[1], d = Math.hypot(dx, dy) || 1, nx = -dy / d, ny = dx / d;
  const side = Math.sign((tip[0] - (tail[0] + tip[0]) / 2) * nx + (tail[1] - (tail[1] + tip[1]) / 2) * ny) || 1;
  const b = side * bow * d, wob = d * 0.02, j = () => (r() - 0.5) * 2 * wob;
  const c1 = [tail[0] + dx * 0.3 + nx * b + j(), tail[1] + dy * 0.3 + ny * b + j()], c2 = [tail[0] + dx * 0.72 + nx * b * 0.55 + j(), tail[1] + dy * 0.72 + ny * b * 0.55 + j()];
  const shaft = [tail, ...cubicPts(tail, c1, c2, tip)];
  const ex = tip[0] - c2[0], ey = tip[1] - c2[1], el = Math.hypot(ex, ey) || 1, bx = -ex / el, by = -ey / el;
  const reach = Math.min(head, d * 0.45);
  const arm = (ang, k) => {
    const len = reach * (0.92 + r() * 0.16), a = ang + (r() - 0.5) * 0.12;
    const end = [tip[0] + len * (bx * Math.cos(a) - by * Math.sin(a)), tip[1] + len * (bx * Math.sin(a) + by * Math.cos(a))];
    const mid = [(tip[0] + end[0]) / 2 + (r() - 0.5) * reach * 0.12, (tip[1] + end[1]) / 2 + (r() - 0.5) * reach * 0.12];
    return [tip, ...cubicPts(tip, mid, mid, end)];
  };
  return [{ pts: shaft, t0: 0, t1: 0.7 }, { pts: arm(0.55, 0), t0: 0.7, t1: 0.85 }, { pts: arm(-0.55, 1), t0: 0.85, t1: 1 }];
};

// ------------------------------------------------------------------ timing (rough-notation's draw-on)
const pathLen = (pts) => { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; };
/** Each path's start and end as fractions of the whole draw: durations in proportion to length, one after another. */
export const drawTimes = (paths) => {
  const lens = paths.map(pathLen), total = lens.reduce((a, b) => a + b, 0) || 1;
  let at = 0;
  return paths.map((pts, i) => { const t0 = at; at += lens[i] / total; return { pts, t0, t1: i === paths.length - 1 ? 1 : at }; });
};
// CSS ease-out is cubic-bezier(0, 0, 0.58, 1). A texel `f` of the way along its path is reached at time easeOut^-1(f) of the
// path's share; a lookup table of that inverse (x(s) where y(s) = f), so a texel costs one interpolation.
const EASE_INV = (() => {
  const n = 2048, out = new Float64Array(n + 1);
  const X = (s) => 3 * (1 - s) * s * s * 0.58 + s * s * s, Y = (s) => 3 * s * s - 2 * s * s * s;
  for (let i = 0; i <= n; i++) {
    const f = i / n; let lo = 0, hi = 1;
    for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (Y(m) < f) lo = m; else hi = m; }
    out[i] = X((lo + hi) / 2);
  }
  return out;
})();
const easeInv = (f) => { const x = Math.min(1, Math.max(0, f)) * (EASE_INV.length - 1), i = Math.floor(x); return i >= EASE_INV.length - 1 ? 1 : EASE_INV[i] + (EASE_INV[i + 1] - EASE_INV[i]) * (x - i); };

// ------------------------------------------------------------------ the painter
/**
 * Paint strokes over the part `box` = [x0, y0, w, h] (px) at RES texels a px. Each stroke { pts, t0, t1, width, cap: 'round' | 'butt' }.
 * ink { rgb (0..1), alpha }, casing { rgb, alpha, width } (an outline under every stroke) or null.
 * Coverage is exact from the distance to the polyline (a 1-texel box filter); where strokes overlap the ink is their union
 * (one pen, no darker crossings). A texel appears when the first stroke that covers at least half of it gets there; a texel
 * only grazed (an edge, the casing) takes the time of the stroke that covers it most.
 * Returns { W, H, rgba (premultiplied, Float32), time (Float32 0..1) }.
 */
export const paintStrokes = (box, strokes, ink, casing, res = RES) => {
  const [bx, by, bw, bh] = box, W = Math.max(1, Math.ceil(bw * res)), H = Math.max(1, Math.ceil(bh * res)), N = W * H;
  const inkC = new Float32Array(N), casC = new Float32Array(N), score = new Float32Array(N).fill(-1), T = new Float32Array(N).fill(1), core = new Float32Array(N).fill(2);
  const sd = new Float32Array(N), sf = new Float32Array(N), seen = new Uint8Array(N), touched = new Int32Array(N);
  const cw = casing ? casing.width : 0;
  for (const s of strokes) {
    const pts = s.pts, half = s.width / 2, reach = half + cw + 1.5 / res + 0.5, butt = s.cap === 'butt';
    const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = cum[cum.length - 1] || 1, last = pts.length - 2;
    let nt = 0;
    for (let k = 0; k <= last; k++) {
      const ax = pts[k][0], ay = pts[k][1], dx = pts[k + 1][0] - ax, dy = pts[k + 1][1] - ay, l2 = dx * dx + dy * dy, sl = Math.sqrt(l2);
      if (l2 < 1e-12) continue;
      const ix0 = Math.max(0, Math.floor((Math.min(ax, ax + dx) - reach - bx) * res)), ix1 = Math.min(W - 1, Math.ceil((Math.max(ax, ax + dx) + reach - bx) * res));
      const iy0 = Math.max(0, Math.floor((Math.min(ay, ay + dy) - reach - by) * res)), iy1 = Math.min(H - 1, Math.ceil((Math.max(ay, ay + dy) + reach - by) * res));
      for (let iy = iy0; iy <= iy1; iy++) {
        const py = by + (iy + 0.5) / res;
        for (let ix = ix0; ix <= ix1; ix++) {
          const px = bx + (ix + 0.5) / res, raw = ((px - ax) * dx + (py - ay) * dy) / l2;
          let t = raw, d;
          if (butt && ((k === 0 && raw < 0) || (k === last && raw > 1))) {
            // a flat end: the distance across the stroke, and how far past its end the texel is
            const perp = Math.abs((px - ax) * dy - (py - ay) * dx) / sl, past = (raw < 0 ? -raw : raw - 1) * sl;
            d = Math.max(perp, half + past); t = raw < 0 ? 0 : 1;
          } else {
            t = raw < 0 ? 0 : raw > 1 ? 1 : raw;
            const qx = ax + t * dx - px, qy = ay + t * dy - py; d = Math.sqrt(qx * qx + qy * qy);
          }
          if (d >= reach) continue;
          const i = iy * W + ix;
          if (!seen[i]) { seen[i] = 1; touched[nt++] = i; sd[i] = d; sf[i] = (cum[k] + t * sl) / total; }
          else if (d < sd[i]) { sd[i] = d; sf[i] = (cum[k] + t * sl) / total; }
        }
      }
    }
    const span = s.t1 - s.t0;
    for (let n = 0; n < nt; n++) {
      const i = touched[n], d = sd[i]; seen[i] = 0;
      const c = Math.min(1, Math.max(0, (half - d) * res + 0.5)), cc = cw ? Math.min(1, Math.max(0, (half + cw - d) * res + 0.5)) : 0;
      const ti = s.t0 + span * easeInv(sf[i]), sc = c > 0 ? 1 + c : cc;
      if (c >= 0.5 && ti < core[i]) core[i] = ti;
      if (sc > score[i] || (sc === score[i] && ti < T[i])) { score[i] = sc; T[i] = ti; }
      if (c > inkC[i]) inkC[i] = c;
      if (cc > casC[i]) casC[i] = cc;
    }
  }
  const rgba = new Float32Array(N * 4), [ir, ig, ib] = ink.rgb, ia = ink.alpha ?? 1, [cr, cg, cb] = casing?.rgb ?? [0, 0, 0], ca = casing?.alpha ?? 0;
  for (let i = 0; i < N; i++) {
    if (core[i] <= 1) T[i] = core[i];
    const a1 = inkC[i] * ia, a2 = casC[i] * ca * (1 - a1), o = i * 4;
    rgba[o] = ir * a1 + cr * a2; rgba[o + 1] = ig * a1 + cg * a2; rgba[o + 2] = ib * a1 + cb * a2; rgba[o + 3] = a1 + a2;
  }
  return { W, H, rgba, time: T };
};

// ------------------------------------------------------------------ PNG
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, c]); };
/** An 8-bit RGBA PNG (no colour chunks, so it is decoded exactly as written). `px(i)` -> [r, g, b, a] bytes for pixel i. */
const png = (W, H, px) => {
  const stride = W * 4 + 1, raw = Buffer.alloc(stride * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = px(y * W + x), o = y * stride + 1 + x * 4; raw[o] = v[0]; raw[o + 1] = v[1]; raw[o + 2] = v[2]; raw[o + 3] = v[3]; }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
};
const b8 = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255);
/** The two pictures of a painted canvas: colour (straight alpha; the page premultiplies on decode) and time (16 bits in R, G). */
export const toPngs = (cv) => ({
  color: png(cv.W, cv.H, (i) => { const a = cv.rgba[i * 4 + 3]; return a <= 0 ? [0, 0, 0, 0] : [b8(cv.rgba[i * 4] / a), b8(cv.rgba[i * 4 + 1] / a), b8(cv.rgba[i * 4 + 2] / a), b8(a)]; }),
  time: png(cv.W, cv.H, (i) => { const v = Math.round(Math.min(1, Math.max(0, cv.time[i])) * 65535); return [v >> 8, v & 255, 0, 255]; }),
});

// ------------------------------------------------------------------ ink, per style
const rgbOf = (css, style) => { const c = parseColor(css) ?? style.rgb?.[css]; return c ? [c[0] / 255, c[1] / 255, c[2] / 255, c[3] ?? 1] : null; };
const hexOf = (css, style) => { const c = parseColor(css) ?? style.rgb?.[css]; return c ? `#${c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}` : null; };
/**
 * The pen a style draws with: its colour (the accent unless callout.ink.color names one), width and casing.
 * casing 'auto': a thin outline of the opposite luminance when the ink alone would fall under 3:1 (WCAG 1.4.11)
 * on a white page (a pale ink gets a dark casing) or on a black one (a dark ink gets a light one).
 */
export const inkOf = (style, u) => {
  const K = style.callout, I = K.ink ?? {}, colorCss = I.color ?? style.palette.accent, hex = hexOf(colorCss, style) ?? '#3b6bff';
  const rgb = rgbOf(hex, style);
  let casing = null;
  if (I.casing === 'auto' || I.casing === undefined) {
    const onWhite = contrast(hex, '#ffffff'), onBlack = contrast(hex, '#000000');
    if (onWhite < 3) casing = { color: I.casingDark ?? '#0b0d12', alpha: I.casingAlpha ?? 0.9 };
    else if (onBlack < 3) casing = { color: I.casingLight ?? '#ffffff', alpha: I.casingAlpha ?? 0.9 };
  } else if (I.casing) casing = { color: I.casing.color, alpha: I.casing.alpha ?? 0.9, width: I.casing.width };
  if (casing) casing = { ...casing, rgb: rgbOf(casing.color, style), width: (casing.width ?? I.casingWidth ?? 1.5) * u };
  return { hex, rgb, alpha: I.alpha ?? 1, width: (I.width ?? 4.5) * u, casing };
};
/** The highlight's band: the ink (or callout.highlight.color) laid on by multiplying, strong enough that white under it falls to `lightness`. */
export const highlightOf = (style, ink) => {
  const H = style.callout.highlight ?? {}, hex = H.color ? hexOf(H.color, style) ?? ink.hex : ink.hex;
  let a = H.alpha ?? null;
  if (a === null) {
    const target = H.lightness ?? 0.7;   // relative luminance of white under the band
    a = 0.6;
    for (let k = 0.08; k <= 0.95; k += 0.01) { const L = contrast(mix('#ffffff', hex, k), '#000000'); if ((L * 0.05 - 0.05) <= target) { a = k; break; } }
  }
  return { hex, rgb: rgbOf(hex, style), alpha: a };
};

// ------------------------------------------------------------------ the plan of one callout
const hashStr = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } h ^= h >>> 13; h = Math.imul(h, 2246822519); return (h ^ (h >>> 16)) >>> 0; };
const seedOf = (s) => (hashStr(s) % (2 ** 31 - 2)) + 1;
/** Where the callout's target is on screen while it shows: [{ t, S (zoom of the recording on screen), r: { x, y, w, h }, vis: { x0, y0, x1, y1 } }]. */
const lifetime = (spec, style, scene, c) => {
  const lay = sceneLayout(spec, style, scene), v = lay.view, fps = spec.fps ?? 60, ease = makeCameraEase(style.camera?.ease), W = spec.width, H = spec.height;
  const t0 = c.atSec, dur = c.forSec ?? style.callout.forSec ?? 2.5, n = Math.max(2, Math.ceil(dur * 30)), out = [];
  for (let k = 0; k <= n; k++) {
    const t = t0 + (dur * k) / n, { cam, xf } = cameraPose(spec, style, scene, t * fps, fps, ease);
    let S, at, vis;
    if (xf) {
      S = xf.z; at = (a, b) => [xf.tx + xf.z * (v.left + a * v.w), xf.ty + xf.z * (v.top + b * v.h)];
      vis = { x0: Math.max(0, xf.tx + xf.z * v.left), y0: Math.max(0, xf.ty + xf.z * v.top), x1: Math.min(W, xf.tx + xf.z * (v.left + v.w)), y1: Math.min(H, xf.ty + xf.z * (v.top + v.h)) };
    } else {
      const ct = cameraTransform(cam, v.w, v.h); S = ct.z; at = (a, b) => [v.left + ct.tx + a * v.w * ct.z, v.top + ct.ty + b * v.h * ct.z];
      vis = { x0: Math.max(0, v.left), y0: Math.max(0, v.top), x1: Math.min(W, v.left + v.w), y1: Math.min(H, v.top + v.h) };
    }
    const [x0, y0] = at(c.box[0], c.box[1]), [x1, y1] = at(c.box[0] + c.box[2], c.box[1] + c.box[3]);
    out.push({ t, S, r: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, vis });
  }
  return { samples: out, view: v };
};
const levelOf = (S) => Math.round(Math.log(Math.max(1e-3, S)) / Math.log(LEVEL));
/** Extents of painted paths beyond the rect (px, outward positive) along the four axes through its middle. */
const extents = (paths, rect, half) => {
  const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2, bandX = Math.max(6, rect.w * 0.05), bandY = Math.max(6, rect.h * 0.08);
  let top = -Infinity, bottom = -Infinity, left = -Infinity, right = -Infinity;
  for (const p of paths) for (const [x, y] of p) {
    if (Math.abs(x - cx) < bandX) { top = Math.max(top, rect.y - y); bottom = Math.max(bottom, y - (rect.y + rect.h)); }
    if (Math.abs(y - cy) < bandY) { left = Math.max(left, rect.x - x); right = Math.max(right, x - (rect.x + rect.w)); }
  }
  const f = (v) => Math.max(0, Number.isFinite(v) ? v + half : 0);
  return { above: f(top), below: f(bottom), left: f(left), right: f(right) };
};
/** The label's size before Chrome lays it out: an estimate (the page uses the real size; this only decides where it fits). */
const labelEstimate = (style, text, u, W) => {
  const L = style.callout.label, size = (L.size ?? 34) * u, chars = String(text).length + String(L.prefix ?? '').length;
  const maxW = (L.maxWidth ?? 0.3) * W, one = chars * (L.em ?? 0.5) * size, lines = Math.max(1, Math.ceil(one / maxW));
  const w = Math.min(maxW, one / lines * (lines > 1 ? 1.12 : 1)) + 2 * (L.padX ?? 12) * u, h = lines * size * (L.lineHeight ?? 1.15) + 2 * (L.padY ?? 4) * u;
  return { w: w * 1.1, h: h * 1.05 };
};
const SIDES = ['above', 'below', 'right', 'left'];
/**
 * The arrow and label as one unit hung from the anchor A on the mark's edge: tail T, and the point P where the label
 * attaches by its `attach` edge (lm: left-middle, rm, bm: bottom-middle, tm). Screen px relative to A.
 */
const unitAt = (side, dir, len, gap, arrow) => {
  if (!arrow) return side === 'above' ? { T: [0, 0], P: [0, -gap], attach: 'bm' } : side === 'below' ? { T: [0, 0], P: [0, gap], attach: 'tm' } : side === 'right' ? { T: [0, 0], P: [gap, 0], attach: 'lm' } : { T: [0, 0], P: [-gap, 0], attach: 'rm' };
  if (side === 'above' || side === 'below') {
    const sy = side === 'above' ? -1 : 1, T = [dir * 0.46 * len, sy * 0.8 * len];
    return { T, P: [T[0] + dir * gap, T[1]], attach: dir > 0 ? 'lm' : 'rm' };
  }
  const sx = side === 'right' ? 1 : -1, T = [sx * 0.82 * len, dir * 0.48 * len];
  return { T, P: [T[0] + sx * gap, T[1]], attach: sx > 0 ? 'lm' : 'rm' };
};
const labelRect = (P, attach, w, h) => (attach === 'lm' ? { x: P[0], y: P[1] - h / 2, w, h } : attach === 'rm' ? { x: P[0] - w, y: P[1] - h / 2, w, h } : attach === 'bm' ? { x: P[0] - w / 2, y: P[1] - h, w, h } : { x: P[0] - w / 2, y: P[1], w, h });
const anchorAt = (side, r, a) => (side === 'above' ? [r.x + r.w / 2, r.y - a] : side === 'below' ? [r.x + r.w / 2, r.y + r.h + a] : side === 'left' ? [r.x - a, r.y + r.h / 2] : [r.x + r.w + a, r.y + r.h / 2]);
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const overflow = (b, v) => Math.max(0, v.x - b.x) + Math.max(0, b.x + b.w - (v.x + v.w)) + Math.max(0, v.y - b.y) + Math.max(0, b.y + b.h - (v.y + v.h));
const union = (...bs) => { const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y)); return { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y }; };
const has = (v) => v !== undefined && v !== null && String(v) !== '';

/** A colour over white and over black: the one of the two the text has the least contrast with (a translucent plate's worst case). */
const worstGround = (css, text, style) => {
  const c = parseColor(css) ?? style.rgb?.[css];
  if (!c) return null;
  const a = c[3] ?? 1, over = (g) => `#${[0, 1, 2].map((i) => Math.round(c[i] * a + g * (1 - a)).toString(16).padStart(2, '0')).join('')}`;
  const w = over(255), b = over(0);
  return (contrast(text, w) ?? 21) <= (contrast(text, b) ?? 21) ? w : b;
};
/**
 * The label's colours: its text (callout.label.color, else the ink) lifted until it reads 4.5:1 on its plate (WCAG 1.4.3),
 * the plate's worst case over white or black, or the glass tint over white (the lightest a glass can get).
 */
export const labelColors = (style, ink) => {
  const L = style.callout.label ?? {}, text0 = L.color ? hexOf(L.color, style) ?? ink.hex : ink.hex;
  const ground = L.plate === 'glass' ? worstGround(style.caption.glass?.tint ?? 'rgba(8,9,12,0.78)', text0, style) : L.plate?.background ? worstGround(L.plate.background, text0, style) : null;
  const text = ground ? ensureContrast(text0, ground, 4.5) : text0;
  const prefix = L.prefixColor ? (ground ? ensureContrast(hexOf(L.prefixColor, style) ?? L.prefixColor, ground, 4.5) : L.prefixColor) : text;
  return { text, prefix, ground, ratio: ground ? contrast(text, ground) : null };
};
/** The label as HTML (Chrome sets the text; its plate is a level box, which repeats exactly). */
const labelHtml = (style, text, u, W, font, colors) => {
  const L = style.callout.label ?? {}, size = (L.size ?? 34) * u, p = L.plate && L.plate !== 'glass' ? L.plate : null;
  const r2 = (v) => Math.round(v * 100) / 100;
  const box = `padding:${r2((L.padY ?? 4) * u)}px ${r2((L.padX ?? 12) * u)}px;border-radius:${r2((p?.radius ?? (L.plate === 'glass' ? L.radius ?? 14 : 0)) * u)}px;`
    + (p ? `background:${p.background};${p.shadow ? `box-shadow:${p.shadow};` : ''}${p.border ? `border:${r2(Math.max(1, (p.borderWidth ?? 1) * u))}px solid ${p.border};` : ''}` : '');
  const prefix = has(L.prefix) ? `<span style="color:${colors.prefix}">${esc(L.prefix)}</span>` : '';
  return `<div id="lbl" style="position:absolute;left:40px;top:40px;display:inline-block;max-width:${r2((L.maxWidth ?? 0.3) * W)}px;${box}font-family:${font(L.font ?? 'text')};font-size:${r2(size)}px;font-weight:${L.weight ?? 600};${L.italic ? 'font-style:italic;' : ''}line-height:${L.lineHeight ?? 1.15};letter-spacing:${L.tracking ?? 0}em;color:${colors.text};white-space:normal;text-wrap:balance;font-variant-ligatures:${L.ligatures === false ? 'none' : 'normal'}"><span data-type>${prefix}${richHtml(text, 'inherit')}</span></div>`;
};

/**
 * Everything one callout needs, painted and placed here. Writes `c._ann` (the page reads it) and returns the capture
 * jobs: one job of direct pictures (the mark at each zoom level, the arrow; Chrome never rasterises them) and the label's HTML.
 * kind: the annotation. builderMark: the style's calloutMark builder draws the mark itself (terminal's corner brackets).
 * font(role): the font stack of a role.
 */
export const annotationJobs = (spec, style, scene, index, ci, c, { kind, builderMark = false, font }) => {
  const lay = sceneLayout(spec, style, scene);
  if (!lay || !c.box || c.atSec === undefined) return [];
  const W = spec.width, u = W / 1920, K = style.callout, ink = inkOf(style, u), AR = K.arrow ?? {}, D = K.draw ?? {}, LB = K.label ?? {};
  const pad = (K.ink?.padding ?? 5) * u, iterations = K.ink?.iterations ?? 2;
  const brackets = c.brackets ? [].concat(c.brackets) : (K.brackets ?? ['left', 'right']);
  const seed = seedOf(`${index}.${ci}|${c.box.map((v) => Math.round(v * 1e4)).join(',')}|${kind}|${brackets.join(',')}`);
  const { samples, view: v } = lifetime(spec, style, scene, c);
  const hl = kind === 'highlight' ? highlightOf(style, ink) : null, half = hl ? 0 : ink.width / 2 + (ink.casing?.width ?? 0);
  const direct = [], jobs = [];

  // ---- the mark: once per zoom level it meets; the level it draws on at goes first and pins the circle's point count
  const first = levelOf(samples[0].S), met = [...new Set(samples.map((s) => levelOf(s.S)))];
  met.sort((a, b) => Math.abs(a - first) - Math.abs(b - first));
  const levels = [];
  let steps;
  for (const L of met.slice(0, MAX_LEVELS)) {
    const S = LEVEL ** L, rect = { x: 0, y: 0, w: c.box[2] * v.w * S, h: c.box[3] * v.h * S };
    if (builderMark) { const e = (K.pad ?? 8) * u; levels.push({ L, S, ext: { above: e, below: e, left: e, right: e } }); continue; }
    const g = notationPaths(kind, rect, { padding: pad, iterations, brackets, seed, stepCount: steps, capPx: 5 * u, inkWidth: ink.width });
    if (steps === undefined && g.steps) steps = g.steps;
    const width = g.width ?? ink.width, m = width / 2 + (hl ? 0 : ink.casing?.width ?? 0) + 3;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of g.paths) for (const [x, y] of p) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const box = [Math.floor(x0 - m), Math.floor(y0 - m), Math.ceil(x1 - x0 + 2 * m) + 1, Math.ceil(y1 - y0 + 2 * m) + 1];
    const strokes = drawTimes(g.paths).map((p) => ({ ...p, width, cap: hl ? 'butt' : 'round' }));
    const cv = paintStrokes(box, strokes, hl ? { rgb: hl.rgb, alpha: hl.alpha } : ink, hl ? null : ink.casing), pics = toPngs(cv), id = ID.ann(index, ci, `m${L}`);
    direct.push({ id, png: pics.color, w: cv.W, h: cv.H }, { id: `${id}#t`, png: pics.time, w: cv.W, h: cv.H, nearest: true });
    levels.push({ L, S, id, ox: -box[0] * RES, oy: -box[1] * RES, w: cv.W, h: cv.H, ext: extents(g.paths, rect, half) });
  }
  levels.sort((a, b) => a.L - b.L);
  const nearest = (S) => { let best = levels[0], d = Infinity; for (const l of levels) { const e = Math.abs(Math.log(S / l.S)); if (e < d) { d = e; best = l; } } return best; };

  // ---- where the label goes: the first side (and lean) that keeps arrow and label inside what shows and off the mark, all the time it shows
  const hasLabel = has(c.label), arrowOn = hasLabel && c.arrow !== false;
  const len = (AR.length ?? 80) * u, gap = (AR.gap ?? 10) * u, lgap = (LB.gap ?? 8) * u, margin = (LB.margin ?? 12) * u;
  let place = null;
  if (hasLabel) {
    const est = labelEstimate(style, c.label, u, W), s0 = samples[0], cx = s0.r.x + s0.r.w / 2, cy = s0.r.y + s0.r.h / 2;
    const leanX = cx < (s0.vis.x0 + s0.vis.x1) / 2 ? [1, -1] : [-1, 1], leanY = cy < (s0.vis.y0 + s0.vis.y1) / 2 ? [1, -1] : [-1, 1];
    const sides = c.side ? [c.side] : SIDES, cands = sides.flatMap((side) => (side === 'above' || side === 'below' ? leanX : leanY).map((dir) => ({ side, dir })));
    for (const cand of cands) {
      const U = unitAt(cand.side, cand.dir, len, lgap, arrowOn);
      let bad = 0, worst = 0;
      for (const s of samples) {
        const lv = nearest(s.S), A = anchorAt(cand.side, s.r, lv.ext[cand.side] + gap);
        const lr = labelRect([A[0] + U.P[0], A[1] + U.P[1]], U.attach, est.w, est.h);
        const unit = union(lr, { x: Math.min(A[0], A[0] + U.T[0]) - 6 * u, y: Math.min(A[1], A[1] + U.T[1]) - 6 * u, w: Math.abs(U.T[0]) + 12 * u, h: Math.abs(U.T[1]) + 12 * u });
        const vis = { x: s.vis.x0 + margin, y: s.vis.y0 + margin, w: s.vis.x1 - s.vis.x0 - 2 * margin, h: s.vis.y1 - s.vis.y0 - 2 * margin };
        const mark = { x: s.r.x - lv.ext.left, y: s.r.y - lv.ext.above, w: s.r.w + lv.ext.left + lv.ext.right, h: s.r.h + lv.ext.above + lv.ext.below };
        const out = overflow(unit, vis), hit = overlaps(lr, mark);
        if (out > 0.5 || hit) bad++;
        worst = Math.max(worst, out + (hit ? 1e4 : 0));
      }
      const score = bad * 1e7 + worst;
      if (!place || score < place.score) place = { ...cand, U, score, bad };
      if (bad === 0) break;
    }
  }

  // ---- the arrow: from the label's side of the unit to the anchor (screen px, the anchor at 0, 0)
  let arrow = null;
  if (place && arrowOn) {
    const paths = arrowPaths(place.U.T, [0, 0], { head: (AR.head ?? 15) * u, bow: AR.bow ?? 0.22, seed: seed ^ 0x2545f491 });
    const width = (AR.width ?? (K.ink?.width ?? 4.5) * 0.8) * u, m = width / 2 + (ink.casing?.width ?? 0) + 3;
    const xs = paths.flatMap((p) => p.pts.map((q) => q[0])), ys = paths.flatMap((p) => p.pts.map((q) => q[1]));
    const box = [Math.floor(Math.min(...xs) - m), Math.floor(Math.min(...ys) - m), Math.ceil(Math.max(...xs) - Math.min(...xs) + 2 * m) + 1, Math.ceil(Math.max(...ys) - Math.min(...ys) + 2 * m) + 1];
    const cv = paintStrokes(box, paths.map((p) => ({ ...p, width, cap: 'round' })), ink, ink.casing), pics = toPngs(cv), id = ID.ann(index, ci, 'arrow');
    direct.push({ id, png: pics.color, w: cv.W, h: cv.H }, { id: `${id}#t`, png: pics.time, w: cv.W, h: cv.H, nearest: true });
    arrow = { id, ax: -box[0] * RES, ay: -box[1] * RES, w: cv.W, h: cv.H };
  }

  // ---- the label's HTML
  let label = null;
  if (place) {
    const colors = labelColors(style, ink), id = ID.ann(index, ci, 'label');
    jobs.push({ id, body: labelHtml(style, c.label, u, W, font, colors), css: '', shots: [{ id, rect: '#lbl', show: ['#lbl'], hide: [], pad: 16, chars: true }] });
    label = { id, attach: place.U.attach, P: place.U.P, enter: LB.enter ?? 'fade', cps: LB.cps ?? 40, rise: (LB.rise ?? 5) * u, glass: LB.plate === 'glass' ? { radius: LB.radius ?? 14 } : null, fits: place.bad === 0 };
  }

  const sec = D.sec ?? 0.8, arrowSec = arrow ? D.arrowSec ?? 0.28 : 0, arrowAt = arrow ? sec * 0.9 : sec;
  const side = place?.side ?? 'above';
  c._ann = {
    kind, res: RES, mark: builderMark ? 'builder' : 'levels', blend: hl ? 'multiply' : null, side,
    levels: levels.map((l) => ({ S: l.S, id: l.id, ox: l.ox, oy: l.oy, w: l.w, h: l.h, a: l.ext[side] + gap })),
    arrow, label,
    timing: { sec, arrowAt, arrowSec, labelAt: arrow ? arrowAt + arrowSec * 0.5 : sec * 0.85, labelSec: D.labelSec ?? 0.22, exitSec: D.exitSec ?? 0.2 },
  };
  if (direct.length) jobs.unshift({ id: ID.ann(index, ci, 'pics'), direct });
  return jobs;
};
