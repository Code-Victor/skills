// Remotion's motion maths, ported so the compositor moves things exactly as
// the Remotion template does: interpolate(), Easing.bezier(), spring() (its
// stepped physics, not a closed form), and the template's camera.
// Pure functions, no DOM: Node and the page both import this file.

// ---------------------------------------------------------------- easing
// Same solver as remotion/src/bezier.ts (Newton steps with a bisection fallback).
export const bezier = (x1, y1, x2, y2) => {
  if (x1 === y1 && x2 === y2) return (t) => t;
  const A = (a, b) => 1 - 3 * b + 3 * a;
  const B = (a, b) => 3 * b - 6 * a;
  const C = (a) => 3 * a;
  const calc = (t, a, b) => ((A(a, b) * t + B(a, b)) * t + C(a)) * t;
  const slope = (t, a, b) => 3 * A(a, b) * t * t + 2 * B(a, b) * t + C(a);
  const solveX = (x) => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const s = slope(t, x1, x2);
      if (s === 0) break;
      t -= (calc(t, x1, x2) - x) / s;
    }
    if (Math.abs(calc(t, x1, x2) - x) > 1e-7) {
      let lo = 0, hi = 1;
      t = x;
      for (let i = 0; i < 40; i++) {
        const v = calc(t, x1, x2) - x;
        if (Math.abs(v) < 1e-7) break;
        if (v > 0) hi = t; else lo = t;
        t = (lo + hi) / 2;
      }
    }
    return t;
  };
  return (x) => (x <= 0 ? 0 : x >= 1 ? 1 : calc(solveX(x), y1, y2));
};
export const Easing = {
  in: (f) => f,
  out: (f) => (t) => 1 - f(1 - t),
  quad: (t) => t * t,
  cubic: (t) => t * t * t,
  bezier,
};

// ---------------------------------------------------------------- interpolate
// Remotion's interpolate(): piecewise linear over the stops, the easing applied
// to each segment, clamped at both ends unless told otherwise.
export const interpolate = (x, input, output, opts = {}) => {
  const { easing = (t) => t, clamp = true } = opts;
  if (x <= input[0] && clamp) return output[0];
  if (x >= input[input.length - 1] && clamp) return output[output.length - 1];
  let i = 1;
  while (i < input.length - 1 && x > input[i]) i++;
  const a = input[i - 1], b = input[i];
  const k = easing((x - a) / (b - a));
  return output[i - 1] + (output[i] - output[i - 1]) * k;
};

// ---------------------------------------------------------------- spring
// remotion/src/spring/spring-utils.ts: one analytic step per frame, carrying
// velocity over. Heavily damped springs (damping 200) land in about a second.
const SPRING_DEFAULT = { damping: 10, mass: 1, stiffness: 100 };
const springTables = new Map();
const springTable = (fps, cfg) => {
  const key = `${fps}/${cfg.damping}/${cfg.mass}/${cfg.stiffness}`;
  let t = springTables.get(key);
  if (!t) springTables.set(key, (t = { current: [], velocity: [], last: { current: 0, velocity: 0, ts: 0 }, cfg, fps }));
  return t;
};
const springAt = (frame, fps, config = {}) => {
  const cfg = { ...SPRING_DEFAULT, ...config };
  const tbl = springTable(fps, cfg);
  const f = Math.max(0, Math.floor(frame));
  while (tbl.current.length <= f) {
    const k = tbl.current.length, now = (k / fps) * 1000;
    const { current, velocity, ts } = tbl.last;
    const dt = Math.min(now - ts, 64) / 1000;
    const v0 = -velocity, x0 = 1 - current;
    const c = cfg.damping, m = cfg.mass, st = cfg.stiffness;
    const zeta = c / (2 * Math.sqrt(st * m)), w0 = Math.sqrt(st / m), w1 = w0 * Math.sqrt(1 - zeta ** 2);
    let pos, vel;
    if (zeta < 1) {
      const env = Math.exp(-zeta * w0 * dt), s = Math.sin(w1 * dt), co = Math.cos(w1 * dt);
      const frag = env * (s * ((v0 + zeta * w0 * x0) / w1) + x0 * co);
      pos = 1 - frag;
      vel = zeta * w0 * frag - env * (co * (v0 + zeta * w0 * x0) - w1 * x0 * s);
    } else {
      const env = Math.exp(-w0 * dt);
      pos = 1 - env * (x0 + (v0 + w0 * x0) * dt);
      vel = env * (v0 * (dt * w0 - 1) + dt * x0 * w0 * w0);
    }
    tbl.last = { current: pos, velocity: vel, ts: now };
    tbl.current.push(pos);
  }
  return tbl.current[f];
};
/** Frames a spring needs to settle within `threshold` (Remotion's measureSpring). */
export const measureSpring = (fps, config = {}, threshold = 0.005) => {
  let frame = 0;
  while (Math.abs(springAt(frame, fps, config) - 1) >= threshold) frame++;
  let finished = frame;
  for (let i = 0; i < 20; i++) {
    frame++;
    if (Math.abs(springAt(frame, fps, config) - 1) >= threshold) { i = 0; finished = frame + 1; }
  }
  return finished;
};
/** spring({ frame, fps, config, durationInFrames }) from 0 to 1. */
export const spring = ({ frame, fps, config = {}, durationInFrames }) => {
  let f = frame;
  if (durationInFrames !== undefined) {
    f = frame / (durationInFrames / measureSpring(fps, config));
    if (frame > durationInFrames) return 1;
  }
  return springAt(f, fps, config);
};

// ---------------------------------------------------------------- camera
// scenes.tsx: moves eases in and out; "holding" is two equal keyframes.
const CAMERA_EASE = bezier(0.65, 0, 0.35, 1);

/**
 * The easing of one camera move, from the style's `camera.ease` token:
 * { type: 'bezier', curve: [x1, y1, x2, y2] } or { type: 'spring', stiffness, damping, mass }.
 * A spring ease is the step response of that spring, stretched so it has settled
 * exactly when the move's time is up (the keyframe's atSec stays "arrive by").
 * Overdamped springs (e.g. 320 / 40 / 0.92, the open-source editors' camera) ease
 * out without overshoot; underdamped ones overshoot a little (the pan stays clamped).
 */
const easeCache = new Map();
export const makeCameraEase = (tok) => {
  if (!tok || tok.type !== 'spring') return tok?.curve ? bezier(...tok.curve) : CAMERA_EASE;
  const { stiffness = 320, damping = 40, mass = 0.92 } = tok, key = `${stiffness}/${damping}/${mass}`;
  if (easeCache.has(key)) return easeCache.get(key);
  const w0 = Math.sqrt(stiffness / mass), z = damping / (2 * Math.sqrt(stiffness * mass));
  const step = (t) => {                     // unit step response, x(0) = 0, x(inf) = 1
    if (z < 1) { const wd = w0 * Math.sqrt(1 - z * z); return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + (z * w0 / wd) * Math.sin(wd * t)); }
    if (z === 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
    const s = Math.sqrt(z * z - 1), r1 = -w0 * (z - s), r2 = -w0 * (z + s);
    return 1 - (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1);
  };
  let T = 0.05;
  while (T < 10 && Math.abs(1 - step(T)) > 0.002) T += 1 / 240;
  const end = step(T);
  const f = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : step(u * T) / end);
  easeCache.set(key, f);
  return f;
};

// ---------------------------------------------------------------- seeded noise
// Deterministic "random": the same seed and keys always give the same number
// (the paper style's per-pose jitter). Never Math.random.
export const seeded = (seed, ...keys) => {
  let h = (seed >>> 0) ^ 0x9e3779b9;
  for (const k of keys) { h = Math.imul(h ^ (Number(k) | 0), 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; }
  return () => { h = (h + 0x6d2b79f5) | 0; let t = Math.imul(h ^ (h >>> 15), 1 | h); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};

export const cameraAt = (moves, frame, fps, ease = CAMERA_EASE) => {
  const keys = [...(moves ?? [])].sort((a, b) => a.atSec - b.atSec);
  const at = (k) => ({ x: k.x ?? 0.5, y: k.y ?? 0.5, zoom: k.zoom ?? 1 });
  if (keys.length === 0) return { x: 0.5, y: 0.5, zoom: 1 };
  const t = frame / fps;
  if (t <= keys[0].atSec) return at(keys[0]);
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i].atSec) {
      const a = at(keys[i - 1]), b = at(keys[i]);
      const k = ease((t - keys[i - 1].atSec) / Math.max(0.001, keys[i].atSec - keys[i - 1].atSec));
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, zoom: a.zoom + (b.zoom - a.zoom) * k };
    }
  }
  return at(keys[keys.length - 1]);
};

/** Camera -> the window-local translation and scale (the Camera div's transform). */
export const cameraTransform = (cam, w, h) => {
  const z = Math.max(1, cam.zoom);
  return {
    z,
    tx: Math.min(0, Math.max(w - w * z, w / 2 - cam.x * w * z)),
    ty: Math.min(0, Math.max(h - h * z, h / 2 - cam.y * h * z)),
  };
};
