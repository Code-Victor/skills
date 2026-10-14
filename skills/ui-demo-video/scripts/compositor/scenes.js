// Scene by scene: turns "scene i at local frame f" into GPU draws. A port of
// the template's scenes.tsx, Caption.tsx, Callouts.tsx, Logo.tsx and the
// remocn text and transition components, with the same numbers (layout,
// easing, springs, timing) as the default style; a style's tokens change them.
// Text and cards are not drawn here: they arrive as textures captured from
// real HTML (plan.js) and are only moved, faded and blurred.
//
// Two frame models (style.canvas.model):
//   "scene"  every scene paints its own background; a transition mixes two whole
//            scenes over the matte colour (the original look: the dip is white).
//   "shared" ONE background is drawn per frame, scenes draw their content with
//            alpha over it, and a transition composites scene CONTENT over that
//            background, so a dark style never flashes white and an animated
//            background never pulses.

import { Easing, bezier, cameraAt, cameraTransform, fillTransform, interpolate, makeCameraEase, seeded, spring } from './motion.js';
import { ID, accentOf, cameraModeOf, calloutKind, chipKey, chipSide, effectOf, emChars, emWords, has, captionPos, markScale, markSize, placeOf, radiusOf, sceneLayout, shellTag, splitBoxes, tagColorOf } from './layout.js';
import { rgb01 } from './color.js';
import { backgroundParams, backgroundProgram, transitionProgram } from './shaders.js';

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const snap = (b) => {
  const x0 = Math.round(b.left), y0 = Math.round(b.top), x1 = Math.round(b.left + b.w), y1 = Math.round(b.top + b.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};
const hstr = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h | 0; };
// 2D affines { a, b, c, d, tx, ty }: x' = a x + c y + tx, y' = b x + d y + ty
const I = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
const mul = (A, B) => ({ a: A.a * B.a + A.c * B.b, b: A.b * B.a + A.d * B.b, c: A.a * B.c + A.c * B.d, d: A.b * B.c + A.d * B.d, tx: A.a * B.tx + A.c * B.ty + A.tx, ty: A.b * B.tx + A.d * B.ty + A.ty });
const about = (cx, cy, rad, s = 1) => { const co = Math.cos(rad) * s, si = Math.sin(rad) * s; return { a: co, b: si, c: -si, d: co, tx: cx - co * cx + si * cy, ty: cy - si * cx - co * cy }; };
const deg = Math.PI / 180;

// ---------------------------------------------------------------- transitions
// The remocn presentations, as plain numbers: how a scene looks at progress p
// while entering or exiting. sigma = blur radius in px, scale about the centre,
// translate in px, brightness multiplier. `params` are the style's
// transition.params (the defaults are the original numbers).
const SOFT = bezier(0.42, 0, 0.58, 1);
const outQuad = Easing.out(Easing.quad), outCubic = Easing.out(Easing.cubic);
export const effectFor = (gap, entering, p, W, H, params = {}) => {
  const fx = { opacity: 1, sx: 1, sy: 1, tx: 0, ty: 0, sigma: 0, bright: 1 };
  const zb = { scaleIn: 0.9, scaleOut: 1.12, sigma: 16, ...params.zoomBlur };
  const fp = { bright: 1.3, brightIn: 1.25, sigma: 16, scaleOut: 1.05, scaleIn: 0.97, ...params.focusPull };
  const pt = { scale: 2.4, scaleIn: 0.68, settle: 1.02, sigma: 14, sigmaIn: 0.7, ...params.pushThrough };
  const wp = { travel: 1.1, stretch: 0.12, blur: 24, ...params.whipPan };
  switch (gap.type) {
    case 'zoom-blur': {
      if (entering) { fx.opacity = p; fx.sx = fx.sy = zb.scaleIn + p * (1 - zb.scaleIn); fx.sigma = p < 1 ? (1 - p) * zb.sigma : 0; }
      else { fx.opacity = 1 - p; fx.sx = fx.sy = 1 + p * (zb.scaleOut - 1); fx.sigma = p * zb.sigma; }
      break;
    }
    case 'fade': fx.opacity = entering ? p : 1; break;
    case 'focus-pull': {
      if (!entering) {
        fx.opacity = interpolate(p, [0.42, 0.68], [1, 0], { easing: SOFT });
        fx.sx = fx.sy = interpolate(p, [0, 0.6], [1, fp.scaleOut], { easing: SOFT });
        fx.sigma = interpolate(p, [0.05, 0.55], [0, fp.sigma], { easing: Easing.quad });
        fx.bright = interpolate(p, [0.1, 0.55], [1, fp.bright]);
      } else {
        fx.opacity = interpolate(p, [0.32, 0.52], [0, 1]);
        fx.sx = fx.sy = interpolate(p, [0.35, 1], [fp.scaleIn, 1], { easing: outCubic });
        fx.sigma = interpolate(p, [0.35, 0.9], [fp.sigma, 0], { easing: outQuad });
        fx.bright = interpolate(p, [0.4, 0.85], [fp.brightIn, 1]);
      }
      break;
    }
    case 'push-through': {
      if (!entering) {
        fx.opacity = interpolate(p, [0.4, 0.62], [1, 0], { easing: SOFT });
        fx.sx = fx.sy = interpolate(p, [0, 0.65], [1, pt.scale], { easing: Easing.cubic });
        fx.sigma = interpolate(p, [0.15, 0.6], [0, pt.sigma]);
      } else {
        fx.opacity = interpolate(p, [0.3, 0.5], [0, 1]);
        fx.sx = fx.sy = interpolate(p, [0.3, 0.88, 1], [pt.scaleIn, pt.settle, 1], { easing: outCubic });
        fx.sigma = interpolate(p, [0.3, 0.75], [pt.sigma * pt.sigmaIn, 0]);
      }
      break;
    }
    case 'whip-pan': {
      const dir = gap.direction ?? 'left';
      const travel = interpolate(p, [0, 1], [0, 1], { easing: bezier(0.7, 0, 0.2, 1) });
      const velocity = Math.sin(Math.PI * travel);
      const horizontal = dir === 'left' || dir === 'right';
      const sign = dir === 'left' || dir === 'up' ? -1 : 1;
      const offset = (entering ? travel - 1 : travel) * wp.travel * sign;     // travel: 1.1 = 110% of the frame
      const stretch = 1 + velocity * wp.stretch;
      if (horizontal) { fx.tx = offset * W; fx.sx = stretch; } else { fx.ty = offset * H; fx.sy = stretch; }
      fx.sigma = velocity * wp.blur;
      break;
    }
  }
  return fx;
};

/** A transition's direction as a unit vector, y down (left is the default). */
export const dirVec = (d = 'left') => ({ left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[d] ?? [-1, 0]);

const BLUR_EASE = bezier(0.25, 0.6, 0.3, 1);

export class Scenes {
  /**
   * R: { gl, spec, style, fps, W, H, stills: Map(id -> {tex,x,y,w,h,bx,by,bw,bh,cx?,poses?}), images: Map(sceneIndex -> tex) }
   */
  constructor(R) {
    this.R = R; this.spec = R.spec; this.style = R.style; this.gl = R.gl; this.W = R.W; this.H = R.H; this.fps = R.fps; this.u = R.W / 1920; this.cur = null;
    const st = this.style, rgb = st.rgb ?? {};
    this.rgb = (c) => rgb01(c, rgb);
    this.SPRING = st.motion.spring;
    this.clock = st.motion.clock;
    this.step = this.clock ? Math.max(1, Math.round(this.fps / this.clock.poses)) : 1;
    this.camEase = makeCameraEase(st.camera.ease);
    this.shared = st.canvas.model === 'shared';
    this.n = 0; this.ql = 0; this.pose = 0; this.poseT = 0;
    // extra pieces a builder asked for (pieces: { name: { at, enter, ... } }), by owner, in a fixed order
    this.extraIds = new Map();
    for (const [id, p] of [...R.stills.entries()].sort((x, y) => (x[1].meta?.z ?? 0) - (y[1].meta?.z ?? 0) || (x[0] < y[0] ? -1 : 1))) {
      if (!p.meta) continue;
      if (!this.extraIds.has(p.meta.owner)) this.extraIds.set(p.meta.owner, []);
      this.extraIds.get(p.meta.owner).push(id);
    }
  }
  /**
   * The overlay clock: the local frame, held for `step` frames when the style quantises (the recording itself never is).
   * The ticks are on the OUTPUT frame count (every multiple of `step`), not on each scene's own start, so two scenes
   * in a transition, the transition itself and the grain all change on the same frames (a scene begins on its first tick).
   */
  q(local) { return this.clock ? Math.max(0, local - (this.n % this.step)) : local; }

  still(id) {
    const s = this.R.stills.get(id);
    if (!s) throw new Error(`internal: missing captured piece "${id}"`);
    return s;
  }
  has(id) { return this.R.stills.has(id); }
  /**
   * Draw a captured piece at its natural place, moved by (dx, dy), faded, and optionally scaled about its element's centre.
   * o: opacity, dx, dy, scale, sigma (blur px), rot (radians, about the element's centre), pose (which captured pose),
   *    clipX (hide everything right of this x, px), jit (jitter strength; 0 turns the clock's jitter off), noJit.
   */
  piece(id, o = {}) {
    if ((o.opacity ?? 1) <= 0.001) return;
    const base = this.R.stills.get(id);
    let pose = o.pose;
    if (pose === undefined && base?.poses > 1) pose = this.poseIndex(base, this.poseT);   // a piece with a pose sequence plays it on the current piece clock
    const pid = pose !== undefined && this.has(`${id}@${pose}`) ? `${id}@${pose}` : id;
    const s = this.still(pid), sc = o.scale ?? 1;
    let dx = o.dx ?? 0, dy = o.dy ?? 0, rot = o.rot ?? 0;
    const ck = this.clock;
    if (ck && o.jit !== 0 && !o.noJit) {   // stop-motion: a fresh small shake each pose, from a seeded generator
      const r = seeded(ck.seed ?? 1, this.index ?? 0, hstr(id), this.pose), k = o.jit ?? 1;
      dx += (r() * 2 - 1) * (ck.jitterPx ?? 0) * k * this.u; dy += (r() * 2 - 1) * (ck.jitterPx ?? 0) * k * this.u; rot += (r() * 2 - 1) * (ck.jitterDeg ?? 0) * k * deg;
    }
    let r = { x: s.x + dx, y: s.y + dy, w: s.w, h: s.h };
    if (sc !== 1) {
      const cx = s.bx + s.bw / 2 + dx, cy = s.by + s.bh / 2 + dy;
      r = { x: cx + (r.x - cx) * sc, y: cy + (r.y - cy) * sc, w: r.w * sc, h: r.h * sc };
    }
    // clip: in the picture's own coordinates { x (hide right of it), y0, y1 (show only those rows), mask (also show them only inside that band of the screen, which stays put while the picture moves) }
    let clipX = o.clipX, clipY, maskY;
    if (o.clip) {
      const c = o.clip;
      if (c.x !== undefined) clipX = s.x + dx + c.x;
      if (c.y0 !== undefined || c.y1 !== undefined) {
        clipY = [s.y + dy + (c.y0 ?? -1e6), s.y + dy + (c.y1 ?? 1e6)];   // selects those rows of the picture, wherever it has been moved to
        if (c.mask) maskY = [s.y + (dy - (o.dy ?? 0)) + (c.y0 ?? -1e6), s.y + (dy - (o.dy ?? 0)) + (c.y1 ?? 1e6)];   // and only that band of the screen shows them
      }
    }
    const gl = this.gl, prev = gl.xf;
    if (rot) gl.setXf(mul(prev ?? I, about(s.bx + s.bw / 2 + dx, s.by + s.bh / 2 + dy, rot)));
    gl.quad(s.tex, r, { opacity: o.opacity ?? 1, sigma: o.sigma ?? 0, clipX, clipY, maskY });
    gl.setXf(prev);
  }
  /** Which pose of a pose sequence is showing `t` seconds in (`m`: { rate, loop } from a builder's piece settings). */
  poseIndex(s, t, m) {
    const n = s.poses, rate = m?.rate ?? this.style.motion.poseRate ?? this.clock?.poses ?? 10, k = Math.floor(Math.max(0, t) * rate);
    return m?.loop ? k % n : Math.min(n - 1, k);
  }
  background() { this.gl.quad(this.still(ID.bg()).tex, { x: 0, y: 0, w: this.W, h: this.H }); }

  /** Draw fn() into a separate layer, then lay that on the target with opacity and an offset: CSS opacity on a parent. */
  group(opacity, dx, dy, fn) {
    if (opacity >= 0.999 && Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return fn();
    if (opacity <= 0.001) return;
    const gl = this.gl, grp = gl.fbo('grp'), prev = this.cur;
    gl.target(grp); gl.clear(0, 0, 0, 0);
    this.cur = grp;
    fn();
    gl.target(prev); this.cur = prev;
    gl.quad(grp.tex, { x: dx, y: dy, w: this.W, h: this.H }, { opacity, fbo: true });
  }

  // ---------------------------------------------------------------- entrances
  /**
   * A piece appearing, t seconds after its start. `kind`: fade (the caller's own
   * look: `base` = { opacity, dx, dy }), rise, blur, type. `o.fade` multiplies the
   * opacity (an exit), `o.max` is the opacity it settles at.
   */
  appear(id, kind, t, base, o = {}) {
    const k = this.style.caption, max = o.max ?? 1, fade = o.fade ?? 1, u = this.u;
    if (t < 0) return;
    if (kind === 'blur') {
      const e = BLUR_EASE(clamp01(t / (o.sec ?? k.blurSec)));
      return this.piece(id, { opacity: e * max * fade, sigma: (1 - e) * (o.px ?? k.blurPx) * u, pose: o.pose });
    }
    if (kind === 'type') return this.typed(id, t, { ...o, max, fade });
    if (kind === 'rise' && o.riseUnits) {
      const e = Easing.out(Easing.cubic)(clamp01(t / (o.sec ?? 0.5)));
      return this.piece(id, { opacity: e * max * fade, dy: (1 - e) * o.riseUnits, pose: o.pose });
    }
    if (kind === 'pop') {   // scale up from `from` with a small overshoot, fading in over the first part
      const x = clamp01(t / (o.sec ?? 0.4)) - 1, e = 1 + 2.70158 * x * x * x + 1.70158 * x * x, from = o.from ?? 0.6;
      return this.piece(id, { opacity: clamp01(t / ((o.sec ?? 0.4) * 0.4)) * max * fade, scale: from + (1 - from) * e, pose: o.pose });
    }
    return this.piece(id, { ...base, opacity: (base.opacity ?? 1) * fade, pose: o.pose });
  }
  /**
   * Characters revealed in reading order by clipping the captured text at real glyph edges, line by line
   * (earlier lines whole, the current one up to the caret); a caret follows and blinks on a fixed clock.
   */
  typed(id, t, o = {}) {
    const s = this.still(id), cx = s.cx ?? [], n = cx.length, lines = s.lines ?? [], ln = s.ln ?? [], multi = lines.length > 1;
    const cps = o.cps ?? this.style.caption.typeCps;
    const shown = Math.min(n, Math.floor(t * cps));
    const done = shown >= n;
    const x0 = s.x + (o.dx ?? 0), y0 = s.y + (o.dy ?? 0), op = (o.max ?? 1) * (o.fade ?? 1);
    const L = shown > 0 ? (ln[shown - 1] ?? 0) : 0;
    const edge = shown <= 0 ? (s.cl ?? 0) : cx[shown - 1];
    if (shown > 0 || o.caret !== false) {
      const common = { opacity: op, dx: o.dx, dy: o.dy, pose: o.pose };
      if (!multi) this.piece(id, { ...common, clip: { x: edge + 0.5 } });
      else {
        const yTop = L === 0 ? -1e6 : (lines[L - 1].b + lines[L].t) / 2, yBot = L === lines.length - 1 ? 1e6 : (lines[L].b + lines[L + 1].t) / 2;
        if (L > 0) this.piece(id, { ...common, clip: { y0: -1e6, y1: yTop } });
        this.piece(id, { ...common, clip: { x: edge + 0.5, y0: yTop, y1: yBot } });
      }
    }
    const caret = o.caret ?? this.style.caption.caret;
    if (caret && caret !== 'none' && cx.length) {
      // blink: steady while typing, then on/off every 0.5 s counted from the last character
      const since = t - n / cps, on = !done || Math.floor(Math.max(0, since) * 2) % 2 === 0;
      if (on) {
        const u = this.u, top = multi ? lines[L].t : (s.cy0 ?? 0), bot = multi ? lines[L].b : (s.cy1 ?? 0);
        const ch = bot - top || 28 * u, w = caret === 'block' ? Math.max(8 * u, (cx[Math.min(shown, n - 1)] ?? edge) - (shown > 0 ? cx[shown - 1] : (s.cl ?? 0)) || 12 * u) : Math.max(2, 2.2 * u);
        const color = this.rgb(o.caretColor ?? this.style.caption.caretColor ?? this.style.palette.accent);
        this.gl.solid({ x: x0 + edge + (caret === 'bar' ? 1 : 0), y: y0 + top, w, h: ch }, color, op * (caret === 'block' ? 0.55 : 1));
      }
    }
  }
  /**
   * The extra pieces a builder returned for `owner` ("s<scene index>" for a title, card, list or split; a caption's
   * picture name for a caption), each starting `at` seconds after the owner's own clock `t`, with its own entrance.
   */
  extras(owner, t, o = {}) {
    const ids = this.extraIds.get(owner);
    if (!ids) return;
    const u = this.u, prev = this.poseT;
    for (const id of ids) {
      const m = this.R.stills.get(id).meta, tt = t - (m.at ?? 0);
      if (tt < 0) continue;
      let fade = o.fade ?? 1;
      if (m.until !== undefined) fade *= 1 - clamp01((t - m.until) / Math.max(0.001, m.exitSec ?? 0.25));
      const max = (m.opacity ?? 1) * fade;
      if (max <= 0.001) continue;
      this.poseT = tt;
      const kind = m.enter ?? 'fade', sec = m.sec ?? 0.35, e = clamp01(tt / sec);
      const pose = this.R.stills.get(id).poses > 1 ? this.poseIndex(this.R.stills.get(id), tt, m) : undefined;
      this.appear(id, kind, tt, { opacity: e * max }, { max, sec, from: m.from, px: m.px, cps: m.cps ?? 30, caret: m.caret ?? 'none', riseUnits: (m.rise ?? 14) * u, pose });
    }
    this.poseT = prev;
  }

  // ---------------------------------------------------------------- captions
  caption(scene, pos, tag, text, lf, dur) {
    const K = this.style.caption, size = this.W * K.size, color = tagColorOf(this.spec, this.style, tag);
    const id = ID.pill(pos.key, tag, color, text, `${K.variant}|${scene.type}`);
    const delay = Math.round(K.delay * this.fps);
    const enter = spring({ frame: lf - delay, fps: this.fps, config: this.SPRING });
    const exit = interpolate(lf, [dur - Math.round(K.exit * this.fps), dur], [1, 0]);
    if (K.variant === 'glass' && this.has(id)) {
      const s = this.still(id), o = K.enter === 'fade' || K.enter === 'rise' ? enter : clamp01((lf - delay) / (K.blurSec * this.fps));
      const dy = K.enter === 'fade' || K.enter === 'rise' ? (1 - enter) * size * K.rise : 0, op = o * exit;
      if (op > 0.001) this.glass({ x: s.bx, y: s.by + dy, w: s.bw, h: s.bh }, K.glass, op);
    }
    if (this.fillScrim > 0.001 && this.has(ID.fillScrim()) && this.has(id)) this.fillScrimFor(this.still(id), pos, enter * exit * this.fillScrim);
    const kind = K.enter;
    const t = (lf - delay) / this.fps, prevT = this.poseT;
    this.poseT = Math.max(0, t);   // a caption's pose sequence runs from its own start
    if (kind === 'fade') this.piece(id, { opacity: enter * exit, dy: (1 - enter) * size * K.rise });
    else this.appear(id, kind, t, { opacity: enter * exit, dy: (1 - enter) * size * K.rise }, { fade: exit, riseUnits: size * Math.max(K.rise, 1.6), sec: 0.5 });
    this.extras(id, t, { fade: exit });
    this.poseT = prevT;
  }
  captions(scene, local) {
    const total = Math.round(scene.durationSec * this.fps), ql = this.ql;
    const posOf = (cap) => captionPos(this.spec, this.style, scene, placeOf(scene, cap));   // bottom, or top when the action is under it (decided once per caption, in Node)
    if (scene.type === 'clip' && scene.captions?.length) {
      const sorted = [...scene.captions].sort((a, b) => a.atSec - b.atSec);
      sorted.forEach((c, i) => {
        const from = Math.round(c.atSec * this.fps);
        const to = i + 1 < sorted.length ? Math.round(sorted[i + 1].atSec * this.fps) : total;
        if (local >= from && local < Math.max(from + 1, to)) this.caption(scene, posOf(c), c.tag ?? scene.tag, c.text, ql - from, Math.max(1, to - from));
      });
    } else if (scene.caption) this.caption(scene, posOf(null), scene.tag, scene.caption, ql, total);
  }
  /**
   * Fill mode, a caption with no plate: a soft gradient from the nearer edge of the frame, behind the caption
   * `s` (its captured picture), at `opacity`. It comes in as the recording covers the caption's spot.
   */
  fillScrimFor(s, pos, opacity) {
    const { W, H } = this, g = this.still(ID.fillScrim()), prev = this.gl.xf;
    const top = pos.top !== null && pos.bottom === null && pos.top < H / 2;
    const h = Math.min(H, Math.max(g.h, (top ? s.by + s.bh : H - s.by) * 1.6));
    this.gl.setXf(null);
    this.gl.quad(g.tex, { x: 0, y: top ? 0 : H - h, w: W, h }, { opacity, fbo: top });   // fbo flips it: dark at the top edge
    this.gl.setXf(prev);
  }

  /** Captions, through the window group's tilt/drift when they sit in the shell's own slot. */
  slotCaptions(scene, local) {
    const g = this.style.caption.placement === 'slot' ? this.groupXf : null, gl = this.gl, prev = gl.xf;
    if (g) gl.setXf(prev ? mul(prev, g) : g);
    this.captions(scene, local);
    gl.setXf(prev);
  }
  /** A blurred, tinted copy of what is behind `box`, inside a rounded rectangle. Needs the frame in an FBO (style.needsMain). */
  glass(box, g, opacity) {
    const gl = this.gl, main = this.main, u = this.u;
    if (!main) return;
    const prev = gl.xf; gl.setXf(null);
    const sigma = g.blur * u, cur = this.cur;
    const A = gl.fbo('glassA', 4), A2 = gl.fbo('glassA2', 4);
    gl.blur(main, A, sigma, true); gl.blur(A, A2, sigma / 4, false);
    let B2 = null;
    if (cur && cur !== main) {
      const B = gl.fbo('glassB', 4); B2 = gl.fbo('glassB2', 4);
      gl.blur(cur, B, sigma, true); gl.blur(B, B2, sigma / 4, false);
    }
    gl.target(cur); gl.setXf(prev);
    const tint = this.rgb(g.tint), ta = (this.style.rgb?.[g.tint]?.[3]) ?? 0.35;
    const rad = g.radius >= 999 ? box.h / 2 : g.radius * u;
    gl.glass(A2, B2, box, rad, { opacity, saturate: g.saturate, tint: [tint[0] * ta, tint[1] * ta, tint[2] * ta, ta] });
  }

  // ---------------------------------------------------------------- recordings
  /** Where the camera is: window-local translation and scale, and the source mapping for the video shader. */
  cameraFor(scene, f, view, tex) {
    const cam = cameraTransform(cameraAt(scene.moves, f, this.fps, this.camEase), view.w, view.h);
    const sc = Math.max(view.w / tex.w, view.h / tex.h), pp = 1 / (cam.z * sc);
    const off = [(tex.w - view.w / sc) / 2, (tex.h - view.h / sc) / 2];
    return { cam, sc, pp, off };
  }
  /** The window group's affine: scene-long drift, a small constant tilt, and the quantised clock's per-pose shake (`shake` scales tilt and shake: fill mode fades them as the window covers the frame). */
  windowXf(scene, local, outer, shake = 1) {
    const w = this.style.window, ck = this.clock;
    if (!w.drift && !w.tilt && !w.tiltJitter && !(ck && w.jitter)) return null;
    const total = Math.max(1, Math.round(scene.durationSec * this.fps));
    let m = I;
    if (w.drift) m = mul(about(this.W / 2, this.H / 2, 0, interpolate(this.ql, [0, total], [1, w.drift.to])), m);
    let rot = (w.tilt ?? 0) * deg;
    if (w.tiltJitter) rot += (seeded(ck?.seed ?? 1, this.index, 77)() * 2 - 1) * w.tiltJitter * deg;
    let dx = 0, dy = 0;
    if (ck && w.jitter) { const r = seeded(ck.seed ?? 1, this.index, 91, this.pose); dx = (r() * 2 - 1) * ck.jitterPx * this.u; dy = (r() * 2 - 1) * ck.jitterPx * this.u; rot += (r() * 2 - 1) * ck.jitterDeg * deg; }
    if (shake !== 1) { rot *= shake; dx *= shake; dy *= shake; }
    if (rot) m = mul(about(outer.left + outer.w / 2, outer.top + outer.h / 2, rot), m);
    if (dx || dy) m = mul({ ...I, tx: dx, ty: dy }, m);
    return m;
  }
  /**
   * One recording (a video frame or a still) in its window, with the camera
   * pushing in inside the window and the callouts riding with it.
   * Draws shell, window, ring, callouts.
   */
  recording(scene, local, tex, mode) {
    if (mode !== 'full' && cameraModeOf(this.spec, this.style, scene) === 'fill') return this.filled(scene, local, tex);
    const { gl, spec, style, W } = this, lay = sceneLayout(spec, style, scene), full = mode === 'full';
    const view = lay.view, win = snap(view), radius = full ? 0 : radiusOf(style, W);
    const topR = lay.ins.t > 0 ? 0 : radius, botR = lay.ins.b > 0 ? 0 : radius;
    const { cam, pp, off } = this.cameraFor(scene, local, view, tex);
    const dx = win.x - view.left, dy = win.y - view.top;
    const origin = [off[0] - cam.tx * pp + dx * pp, off[1] - cam.ty * pp + dy * pp];
    // camera motion blur: average several camera poses between a moment ago and now
    let prev = null;
    const mb = style.camera.motionBlur;
    if (mb && !full) {
      const c0 = this.cameraFor(scene, local - (mb.shutter ?? 0.5), view, tex), o0 = [c0.off[0] - c0.cam.tx * c0.pp + dx * c0.pp, c0.off[1] - c0.cam.ty * c0.pp + dy * c0.pp];
      const move = Math.hypot((origin[0] - o0[0]) / pp, (origin[1] - o0[1]) / pp) + Math.abs(c0.pp / pp - 1) * Math.max(view.w, view.h) * 0.5;
      if (move > 0.4) prev = { origin: o0, perPx: [c0.pp, c0.pp], n: Math.min(mb.samples ?? 6, 12, Math.max(2, Math.ceil(move / 1.5))) };
    }
    const xf = this.windowXf(scene, local, lay.outer), prevXf = gl.xf;
    if (xf) gl.setXf(prevXf ? mul(prevXf, xf) : xf);
    const tag = shellTag(style, scene);
    if (!full) gl.quad(this.still(ID.shell(lay.outer, radiusOf(style, W), true, tag)).tex, this.rectOf(ID.shell(lay.outer, radiusOf(style, W), true, tag)));
    gl.window(tex, win, botR, origin, [pp, pp], 1, { topR, prev });
    this.scrim(scene, lay);
    if (!full && (style.window.border || style.window.highlight)) { const rid = ID.ring(lay.outer, radiusOf(style, W)); gl.quad(this.still(rid).tex, this.rectOf(rid)); }
    this.callouts(scene, local, view, win, botR, topR, cam);
    this.groupXf = xf ? (prevXf ? mul(prevXf, xf) : xf) : null;   // captions placed in the shell's own slot ride with it
    gl.setXf(prevXf);
  }
  /**
   * Fill mode: the camera does not crop inside the window, it moves the WHOLE window (shell and its shadow,
   * the recording, the ring, the callouts) through fillTransform over the fixed background: the window grows
   * until the recording fills the frame. Radius and shadow grow with it; the corners square off as the first
   * side reaches the frame's edge and the ring fades with them, so no background shows at a covered edge.
   */
  filled(scene, local, tex) {
    const { gl, spec, style, W, H } = this, lay = sceneLayout(spec, style, scene), view = lay.view, win = snap(view), R = radiusOf(style, W);
    const pose = (f) => fillTransform(cameraAt(scene.moves, f, this.fps, this.camEase), view, W, H);
    const F = pose(local);
    this.fillNow = F.fill;
    const sc = Math.max(view.w / tex.w, view.h / tex.h), pp = 1 / sc;
    const origin = [(tex.w - view.w / sc) / 2 + (win.x - view.left) * pp, (tex.h - view.h / sc) / 2 + (win.y - view.top) * pp];
    // camera motion blur: the screen pixel's source under the camera a moment ago, as one more affine of the window pixel
    let prev = null;
    const mb = style.camera.motionBlur;
    if (mb) {
      const P = pose(local - (mb.shutter ?? 0.5));
      const move = Math.max(...[view.left, view.left + view.w].map((x) => Math.abs(F.tx - P.tx + (F.z - P.z) * x)), ...[view.top, view.top + view.h].map((y) => Math.abs(F.ty - P.ty + (F.z - P.z) * y)));
      if (move > 0.4) prev = {
        origin: [origin[0] + ((F.tx - P.tx + F.z * win.x) / P.z - win.x) * pp, origin[1] + ((F.ty - P.ty + F.z * win.y) / P.z - win.y) * pp],
        perPx: [pp * F.z / P.z, pp * F.z / P.z], n: Math.min(mb.samples ?? 6, 12, Math.max(2, Math.ceil(move / 1.5))),
      };
    }
    const Fm = { a: F.z, b: 0, c: 0, d: F.z, tx: F.tx, ty: F.ty };
    const outer = { left: F.tx + F.z * lay.outer.left, top: F.ty + F.z * lay.outer.top, w: F.z * lay.outer.w, h: F.z * lay.outer.h };
    const wx = this.windowXf(scene, local, outer, 1 - F.fill), X = wx ? mul(wx, Fm) : Fm, prevXf = gl.xf;
    gl.setXf(prevXf ? mul(prevXf, X) : X);
    const sid = ID.shell(lay.outer, R, true, shellTag(style, scene));
    gl.quad(this.still(sid).tex, this.rectOf(sid));
    const r = R * F.round, topR = lay.ins.t > 0 ? 0 : r, botR = lay.ins.b > 0 ? 0 : r;
    gl.window(tex, win, botR, origin, [pp, pp], 1, { topR, prev, pxScale: F.z });
    this.scrim(scene, lay);
    if ((style.window.border || style.window.highlight) && F.round > 0.001) { const rid = ID.ring(lay.outer, R); gl.quad(this.still(rid).tex, this.rectOf(rid), { opacity: F.round }); }
    this.callouts(scene, local, view, win, botR, topR, { z: 1, tx: 0, ty: 0 }, F.z);
    this.groupXf = wx ? (prevXf ? mul(prevXf, wx) : wx) : null;   // a caption in the shell's slot keeps the group's tilt but not the zoom: it stays put and readable
    gl.setXf(prevXf);
  }
  /** The soft gradient behind overlay captions (caption.scrim), fading in with the first caption and out with the last. */
  scrim(scene, lay) {
    const K = this.style.caption.scrim, C = this.style.caption;
    if (!K || !(scene.caption || scene.captions?.length)) return;
    const v = lay.view, hh = Math.round(v.h * (K.height ?? 0.3)), radius = lay.full || lay.ins.b > 0 ? 0 : radiusOf(this.style, this.W);
    const id = ID.scrim(v, hh, radius, `${K.color ?? '#000'}|${K.opacity ?? 0.6}`);
    if (!this.has(id)) return;
    const total = Math.round(scene.durationSec * this.fps), from = Math.round((scene.captions?.length ? Math.min(...scene.captions.map((c) => c.atSec)) : 0) * this.fps);
    const o = clamp01((this.ql - from) / (0.35 * this.fps)) * interpolate(this.ql, [total - Math.round(C.exit * this.fps), total], [1, 0]);
    if (o > 0.001) this.gl.quad(this.still(id).tex, this.rectOf(id), { opacity: o });
  }
  rectOf(id) { const s = this.still(id); return { x: s.x, y: s.y, w: s.w, h: s.h }; }

  /** Bounding box of a rect through the current group affine, for scissoring. */
  bounds(r) {
    const m = this.gl.xf;
    if (!m) return r;
    const pts = [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]].map(([x, y]) => [m.a * x + m.c * y + m.tx, m.b * x + m.d * y + m.ty]);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const x = Math.min(...xs) - 2, y = Math.min(...ys) - 2;
    return { x, y, w: Math.max(...xs) - x + 2, h: Math.max(...ys) - y + 2 };
  }

  /** `k`: screen px per window px when the whole window is drawn scaled (fill mode); pad, ring, radius and label keep their screen size. */
  callouts(scene, local, box, win, winR, topR, cam, k = 1) {
    const { gl, fps, u, style } = this, K = style.callout, accent = style.palette.accent, ql = this.ql, q = 1 / k;
    const ring = this.rgb(K.ringColor ?? accent), dim = this.rgb(K.dimColor), hasMark = style.builders?.includes('calloutMark');
    for (const [ci, c] of (scene.callouts ?? []).entries()) {
      if (!c.box || c.atSec === undefined) continue;
      const from = Math.round(c.atSec * fps), to = from + Math.round((c.forSec ?? K.forSec) * fps);
      if (local < from - 1 || local > to + 1) continue;
      if (c._ann) { this.annotate(c, c._ann, from, to, box, win, cam, k); continue; }   // a hand-drawn annotation (annotate.js)
      const kind = calloutKind(style, c);
      const enter = spring({ frame: ql - from, fps, config: this.SPRING, durationInFrames: Math.round(K.enterSec * fps) });
      const exit = interpolate(ql, [to - Math.round(K.exitSec * fps), to], [1, 0]);
      const o = enter * exit;
      const [x, y, bw, bh] = c.box, z = cam.z, pad = K.pad * u * q;
      const left = box.left + cam.tx + x * box.w * z - pad, top = box.top + cam.ty + y * box.h * z - pad;
      const bwid = bw * box.w * z + pad * 2, bhgt = bh * box.h * z + pad * 2;
      const sc = K.scaleIn + (1 - K.scaleIn) * enter, spot = c.style === 'spotlight';
      gl.scissor(this.bounds(win));
      gl.callout(win, winR, {
        cx: left + bwid / 2, cy: top + bhgt / 2, hw: (bwid / 2) * sc, hh: (bhgt / 2) * sc, radius: K.radius * u * sc * q, ring: hasMark ? 0 : K.ringWidth * u * sc * q,
        opacity: o, fillA: spot || hasMark ? 0 : K.fillAlpha, dimA: spot ? K.dimAlpha * o : 0, accent: ring, dim, dash: K.dash ?? 0, pxScale: k,
      }, topR);
      if (hasMark) {
        const m = markSize(box, c, u, K.pad), ms = markScale(m, this.W, this.H), id = ID.mark(Math.round(m.w * ms), Math.round(m.h * ms), kind);
        if (this.has(id)) {
          const s = this.still(id), n = s.poses ?? 1, rate = style.motion.poseRate ?? this.clock?.poses ?? 10;
          const pose = Math.min(n - 1, Math.floor(Math.max(0, ql - from) / fps * rate));   // on the overlay clock, like everything else
          const kx = bwid / s.bw, ky = bhgt / s.bh;
          const pid = this.has(`${id}@${pose}`) ? `${id}@${pose}` : id, ps = this.still(pid);
          gl.quad(ps.tex, { x: left - (ps.bx - ps.x) * kx, y: top - (ps.by - ps.y) * ky, w: ps.w * kx, h: ps.h * ky }, { opacity: o, ...(kind === 'highlight' ? { blend: 'multiply' } : {}) });
        }
      }
      if (c.label) {
        const below = chipSide(c) === 'below', s = this.still(ID.chip(c.label, accent, chipKey(style, this.index, ci, below ? 'below' : 'above')));
        const ch = s.bh * q;
        const cy = (below ? top + bhgt + 10 * u * q : top - 10 * u * q - ch) + (1 - enter) * 6 * u * q * (below ? -1 : 1);
        gl.quad(s.tex, { x: left - (s.bx - s.x) * q, y: cy - (s.by - s.y) * q, w: s.w * q, h: s.h * q }, { opacity: o });
      }
      gl.scissor(null);
    }
  }

  /**
   * A hand-drawn annotation, planned in Node (annotate.js wrote `A` = c._ann): the mark draws itself on (its texels appear
   * as the pen reaches them), then the arrow, then the label; all of it fades out together at the end. The mark is drawn
   * in window space so it follows the camera and the group's tilt, at the zoom level nearest the current zoom (its stroke
   * keeps its width on screen); the arrow and label are drawn in screen space at their own size, hung from the anchor on
   * the mark's edge, and moved inside the visible picture if the camera would take them past its edge.
   */
  annotate(c, A, from, to, box, win, cam, k) {
    const { gl, fps, u, style, W, H } = this, T = A.timing, ql = this.ql, t = (ql - from) / fps;
    if (t < 0) return;
    const exit = interpolate(ql, [to - Math.round(T.exitSec * fps), to], [1, 0]);
    if (exit <= 0.001) return;
    const m = gl.xf, sx = m ? Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) : 1, z = cam.z, res = A.res;
    const [x, y, bw, bh] = c.box;
    const r = { x: box.left + cam.tx + x * box.w * z, y: box.top + cam.ty + y * box.h * z, w: bw * box.w * z, h: bh * box.h * z };
    const S = z * sx;
    let lv = A.levels[0], best = Infinity;
    for (const l of A.levels) { const e = Math.abs(Math.log(S / l.S)); if (e < best) { best = e; lv = l; } }
    const bounds = this.bounds(win);
    gl.scissor(bounds);
    if (A.mark === 'builder') {
      // the style's own mark (terminal's corner brackets), drawn the way the older path draws it
      const K = style.callout, pad = K.pad * u / k, mk = markSize(box, c, u, K.pad), ms = markScale(mk, W, H), id = ID.mark(Math.round(mk.w * ms), Math.round(mk.h * ms), A.kind);
      if (this.has(id)) {
        const s0 = this.still(id), n = s0.poses ?? 1, rate = style.motion.poseRate ?? this.clock?.poses ?? 10;
        const pose = Math.min(n - 1, Math.floor(Math.max(0, ql - from) / fps * rate)), pid = this.has(`${id}@${pose}`) ? `${id}@${pose}` : id, ps = this.still(pid);
        const kx = (r.w + pad * 2) / s0.bw, ky = (r.h + pad * 2) / s0.bh;
        gl.quad(ps.tex, { x: r.x - pad - (ps.bx - ps.x) * kx, y: r.y - pad - (ps.by - ps.y) * ky, w: ps.w * kx, h: ps.h * ky }, { opacity: exit });
      }
    } else if (lv?.id) {
      const g = z / (lv.S * res);
      gl.ink(this.still(lv.id).tex, this.still(`${lv.id}#t`).tex, { x: r.x - lv.ox * g, y: r.y - lv.oy * g, w: lv.w * g, h: lv.h * g }, { opacity: exit, progress: clamp01(t / T.sec), blend: A.blend });
    }
    if (A.arrow || A.label) {
      const a = (lv?.a ?? 0) / sx, side = A.side;
      const ad = side === 'above' ? [r.x + r.w / 2, r.y - a] : side === 'below' ? [r.x + r.w / 2, r.y + r.h + a] : side === 'left' ? [r.x - a, r.y + r.h / 2] : [r.x + r.w + a, r.y + r.h / 2];
      let ax = m ? m.a * ad[0] + m.c * ad[1] + m.tx : ad[0], ay = m ? m.b * ad[0] + m.d * ad[1] + m.ty : ad[1];
      const L = A.label, ls = L ? this.still(L.id) : null;
      // the label's box, by the edge it hangs from
      let lx = 0, ly = 0;
      if (L) {
        const px = ax + L.P[0], py = ay + L.P[1];
        lx = L.attach === 'lm' ? px : L.attach === 'rm' ? px - ls.bw : px - ls.bw / 2;
        ly = L.attach === 'bm' ? py - ls.bh : L.attach === 'tm' ? py : py - ls.bh / 2;
      }
      // keep the unit inside what shows of the picture (the plan in Node avoids this; a camera move it could not avoid is caught here)
      const ar = A.arrow, boxes = [];
      if (ar) boxes.push({ x0: ax - ar.ax / res, y0: ay - ar.ay / res, x1: ax + (ar.w - ar.ax) / res, y1: ay + (ar.h - ar.ay) / res });
      if (L) boxes.push({ x0: lx, y0: ly, x1: lx + ls.bw, y1: ly + ls.bh });
      const mg = 4 * u, vx0 = Math.max(0, bounds.x) + mg, vy0 = Math.max(0, bounds.y) + mg, vx1 = Math.min(W, bounds.x + bounds.w) - mg, vy1 = Math.min(H, bounds.y + bounds.h) - mg;
      // while the camera has the anchor out of view, arrow and label fade (over 24 px of travel): they would point at nothing
      const off = Math.max(vx0 - ax, ax - vx1, vy0 - ay, ay - vy1, 0), seen = clamp01(1 - off / (24 * u)), op = exit * seen;
      const ux0 = Math.min(...boxes.map((b) => b.x0)), uy0 = Math.min(...boxes.map((b) => b.y0)), ux1 = Math.max(...boxes.map((b) => b.x1)), uy1 = Math.max(...boxes.map((b) => b.y1));
      const sdx = ux0 < vx0 ? vx0 - ux0 : ux1 > vx1 ? Math.max(vx1 - ux1, vx0 - ux0) : 0, sdy = uy0 < vy0 ? vy0 - uy0 : uy1 > vy1 ? Math.max(vy1 - uy1, vy0 - uy0) : 0;
      ax += sdx; ay += sdy; lx += sdx; ly += sdy;
      gl.setXf(null);
      if (ar && op > 0.001) gl.ink(this.still(ar.id).tex, this.still(`${ar.id}#t`).tex, { x: ax - ar.ax / res, y: ay - ar.ay / res, w: ar.w / res, h: ar.h / res }, { opacity: op, progress: clamp01((t - T.arrowAt) / Math.max(1e-3, T.arrowSec)) });
      const tl = t - T.labelAt;
      if (L && tl >= 0 && op > 0.001) {
        const e = Easing.out(Easing.cubic)(clamp01(tl / T.labelSec)), rise = (1 - e) * L.rise * (side === 'below' ? -1 : 1);
        if (L.glass) this.glass({ x: lx, y: ly + rise, w: ls.bw, h: ls.bh }, { ...style.caption.glass, radius: L.glass.radius }, e * op);
        if (L.enter === 'type') this.appear(L.id, 'type', tl, { opacity: op }, { dx: lx - ls.bx, dy: ly - ls.by, cps: L.cps, caret: 'none', fade: op });
        else this.piece(L.id, { opacity: e * op, dx: lx - ls.bx, dy: ly - ls.by + rise, noJit: true });
      }
      gl.setXf(m);
    }
    gl.scissor(null);
  }

  furniture(i) {
    const id = ID.piece(i, 'furn');
    if (this.has(id)) { const s = this.still(id); this.gl.quad(s.tex, { x: 0, y: 0, w: this.W, h: this.H }, { opacity: 1 }); }
  }

  // ---------------------------------------------------------------- scene types
  clip(scene, local, frames) {
    const mode = scene.frame === 'stage' ? 'flat' : scene.frame ?? 'flat';
    if (!this.shared) this.background();
    this.furniture(this.index);
    this.fillNow = 0;
    this.recording(scene, local, frames.main, mode);
    this.fillScrim = this.fillScrimLevel();
    this.slotCaptions(scene, local);
  }
  image(scene, local, frames) {
    if (!this.shared) this.background();
    this.furniture(this.index);
    this.fillNow = 0;
    this.recording(scene, local, frames.main, 'flat');
    this.fillScrim = this.fillScrimLevel();
    this.slotCaptions(scene, local);
  }
  /** Fill mode: how much of the scrim behind a plateless caption shows (none at rest, all once the recording covers more than about half the way). */
  fillScrimLevel() { const t = clamp01((this.fillNow - 0.35) / 0.3); return t * t * (3 - 2 * t); }
  split(scene, local, frames) {
    const { gl, W, H, fps, style } = this, boxes = splitBoxes(style, W, H, scene.aspect), ql = this.ql, R = radiusOf(style, W), M = style.motion.split;
    this.fillScrim = 0;
    if (!this.shared) this.background();
    this.furniture(this.index);
    const labels = [scene.before.label ?? 'Before', scene.after.label ?? 'After'];
    [0, 1].forEach((i) => {
      const enter = spring({ frame: ql - i * M.stagger, fps, config: this.SPRING });
      if (has(labels[i])) this.piece(ID.piece(this.index, `l${i}`), { opacity: enter });
      const b = boxes[i].outer, tex = frames[i === 0 ? 'before' : 'after'];
      this.group(enter, 0, (1 - enter) * M.rise, () => {
        gl.quad(this.still(ID.shell(b, R, true, 'split')).tex, this.rectOf(ID.shell(b, R, true, 'split')));
        const win = snap(b), sc = Math.max(b.w / tex.w, b.h / tex.h), pp = 1 / sc;
        gl.window(tex, win, R, [(tex.w - b.w / sc) / 2 + (win.x - b.left) * pp, (tex.h - b.h / sc) / 2 + (win.y - b.top) * pp], [pp, pp]);
        if (style.window.border || style.window.highlight) { const rid = ID.ring(b, R); gl.quad(this.still(rid).tex, this.rectOf(rid)); }
      });
    });
    this.captions(scene, local);
    this.extras(`s${this.index}`, ql / fps);
  }
  issue(scene, local) {
    const { fps, u, style } = this, i = this.index, ql = this.ql, M = style.motion.card, kind = style.card.rowEnter;
    if (!this.shared) this.background();
    this.furniture(i);
    const s = (delay) => spring({ frame: ql - Math.round(delay * fps), fps, config: this.SPRING });
    const s0 = s(0);
    this.group(s0, 0, (1 - s0) * M.rise * u, () => {
      this.piece(ID.card(i));
      const rise = (name, k) => {
        const delay = M.rows[k], alpha = M.alpha[k], v = s(delay);
        if (kind === 'rise') this.piece(ID.piece(i, name), { opacity: v * alpha, dy: (1 - v) * M.rise * u });
        else this.appear(ID.piece(i, name), kind, (ql - Math.round(delay * fps)) / fps, { opacity: v * alpha }, { max: alpha, cps: 40 });
      };
      if (has(scene.title)) rise('title', 0);
      if (has(scene.quote)) rise('quote', 1);
      if (has(scene.reporter)) rise('reporter', 2);
      this.extras(`s${i}`, ql / fps);
    });
  }
  list(scene, local) {
    const { fps, u, style } = this, i = this.index, ql = this.ql, M = style.motion.list, kind = style.list.itemEnter;
    if (!this.shared) this.background();
    this.furniture(i);
    const at = (delay) => spring({ frame: ql - Math.round(delay * fps), fps, config: this.SPRING });
    const h = at(0);
    if (has(scene.title) || has(scene.subtitle)) this.piece(ID.piece(i, 'head'), { opacity: h, dy: (1 - h) * M.headRise * u });
    (scene.items ?? []).forEach((_, k) => {
      const d = M.start + k * M.step, v = at(d);
      if (kind === 'slide') this.piece(ID.piece(i, `i${k}`), { opacity: v, dx: (1 - v) * M.dx * u, dy: (1 - v) * (M.dy ?? 0) * u });
      else this.appear(ID.piece(i, `i${k}`), kind, (ql - Math.round(d * fps)) / fps, { opacity: v }, { cps: 45 });
    });
    this.extras(`s${i}`, ql / fps);
  }
  title(scene, local) {
    const { fps, style } = this, i = this.index, effect = effectOf(style, scene), q0 = this.ql, T = style.motion.text, tk = style.title;
    if (!this.shared) this.background();
    this.furniture(i);
    const speed = 30 / fps, num = (v) => v !== undefined && v !== null;
    const chars = has(scene.text) ? emChars(scene.text) : [];
    const SB = T.softBlur, MS = T.microScale, P = T.wordPush;
    // timing in seconds when the style gives it (staggerSec, sec, riseSec ...), else the original frame counts
    const sbStag = num(SB.staggerSec) ? SB.staggerSec * fps : SB.stagger, sbFrames = num(SB.sec) ? SB.sec * fps : SB.frames, sbRise = num(SB.riseSec) ? SB.riseSec * fps : SB.riseFrames;
    const msFrames = num(MS.sec) ? MS.sec * 30 : MS.frames;
    const pw = (k) => (num(P.gapSec) ? P.gapSec * 30 : P.gap);
    const lines = effect === 'lines' && has(scene.text) ? this.still(ID.piece(i, 'all')).lines ?? [{ t: 0, b: 1 }] : null, LM = tk.lines ?? {};
    const lSec = LM.sec ?? 0.6, lStag = LM.stagger ?? 0.09;
    const typeCps = tk.typeCps ?? 24;
    // how long the whole entrance takes, so title.maxEnterSec can speed it up until it finishes in time
    let total = 0;
    if (has(scene.text)) {
      if (effect === 'word-push') { const nw = emWords(scene.text).length, accel = P.accel, rf = (n) => (pw() * (1 - accel ** n)) / (1 - accel); total = (rf(nw - 1) + 1 + (num(P.slideSec) ? P.slideSec * 30 : P.slide)) / 30; }
      else if (effect === 'micro-scale-fade') total = msFrames / 30;
      else if (effect === 'type') total = chars.length / typeCps;
      else if (effect === 'lines') total = (lines.length - 1) * lStag + lSec;
      else total = ((chars.length - 1) * sbStag + sbFrames) / fps;
    }
    const cap = tk.maxEnterSec, comp = num(cap) && cap > 0 && total > cap ? total / cap : 1;
    const ql = q0 * comp;
    if (!has(scene.text)) { /* nothing to reveal */ }
    else if (effect === 'word-push') this.wordPush(scene, i, ql * speed);
    else if (effect === 'micro-scale-fade') {
      const e = bezier(...MS.ease), f = ql * speed;
      this.piece(ID.piece(i, 'all'), { opacity: interpolate(f, [0, msFrames], [0, 1], { easing: e }), scale: interpolate(f, [0, msFrames], [MS.from, 1], { easing: e }) });
    } else if (effect === 'type') {
      this.typed(ID.piece(i, 'all'), ql / fps, { cps: typeCps, caret: tk.caret ?? 'bar', caretColor: tk.caretColor ?? undefined });
    } else if (effect === 'lines') {
      // one picture, drawn once per line inside that line's own band: the band stays put and the line rises into it from below
      const id = ID.piece(i, 'all'), ease = bezier(...(LM.ease ?? [0.22, 1, 0.36, 1])), t = ql / fps;
      lines.forEach((ln, k) => {
        const e = ease(clamp01((t - k * lStag) / lSec));
        if (e <= 0) return;
        const unit = (ln.b - ln.t) * 1.3, y0 = k === 0 ? -1e6 : (lines[k - 1].b + ln.t) / 2, y1 = k === lines.length - 1 ? ln.b + (ln.b - ln.t) * 0.25 : (ln.b + lines[k + 1].t) / 2;
        this.piece(id, { opacity: LM.fade === false ? 1 : clamp01(e * 2), dy: (1 - e) * (LM.rise ?? 1) * unit, clip: { y0, y1, mask: true } });
      });
    } else {
      // soft-blur-in gets no speed correction in the template: its counts run in output frames
      const e = bezier(...SB.ease);
      chars.forEach(({ c }, k) => {
        if (!c.trim()) return;
        const l = ql - k * sbStag;
        const blur = interpolate(l, [0, sbFrames], [SB.blur, 0], { easing: e });
        this.piece(ID.piece(i, `c${k}`), { opacity: interpolate(l, [0, sbFrames], [0, 1], { easing: e }), dy: interpolate(l, [0, sbRise], [SB.rise, 0], { easing: e }), sigma: blur });
      });
    }
    if (has(scene.subtitle)) {
      const S = T.subtitle, sub = interpolate(q0, [S.from * fps, S.to * fps], [0, 1]), op = style.title.subtitleOpacity;
      this.appear(ID.piece(i, 'sub'), style.title.subtitleEnter, (q0 - S.from * fps) / fps, { opacity: sub * op, dy: (1 - sub) * S.rise }, { max: op, sec: S.to - S.from });
    }
    this.extras(`s${i}`, q0 / fps);
  }
  wordPush(scene, i, f) {
    const { style } = this, words = emWords(scene.text).map((w) => w.w);
    const size = this.W * style.title.size, P = style.motion.text.wordPush;
    const n30 = (sec, frames) => (sec !== undefined && sec !== null ? sec * 30 : frames);   // seconds tokens, else frames at 30 fps
    const REVEAL = n30(P.revealSec, P.reveal), SLIDE = n30(P.slideSec, P.slide), OVER = P.over, CHAR = P.char, SPACE = P.space, wordGap = n30(P.gapSec, P.gap), accel = P.accel;
    const revealFrame = (n) => (wordGap * (1 - accel ** n)) / (1 - accel);
    const push = Easing.out(Easing.cubic), drive = bezier(0.15, 0.7, 0.25, 1);
    const measured = style.title.measure === 'glyph';
    let lineX = interpolate(f, [0, SLIDE], [-OVER * size, 0], { easing: drive });
    for (let j = 1; j < words.length; j++) {
      // 'glyph': the real width of the captured word (any font); 'estimate': the original's 0.5 em per character guess
      const wordWidth = measured ? this.still(ID.piece(i, `w${j}`)).bw + SPACE * size : (words[j].length * CHAR + SPACE) * size;
      const at = revealFrame(j);
      lineX += (wordWidth / 2) * (1 - interpolate(f, [at + 1, at + 1 + SLIDE], [0, 1], { easing: push }));
    }
    words.forEach((_, j) => {
      const at = revealFrame(j);
      const driven = j === 0 ? 1 : interpolate(f, [at, at + SLIDE], [0, 1], { easing: drive });
      this.piece(ID.piece(i, `w${j}`), { opacity: interpolate(f, [at, at + REVEAL], [0, 1]), dx: lineX + OVER * size * (1 - driven) });
    });
  }

  /** One scene's content at a local frame, into the current target. */
  scene(i, local, frames) {
    const scene = this.spec.scenes[i];
    this.index = i;
    this.ql = this.q(local); this.pose = this.clock ? Math.floor(this.n / this.step) : 0;
    this.poseT = this.ql / this.fps;   // the clock pose sequences play on (a caption sets its own)
    switch (scene.type) {
      case 'title': return this.title(scene, local);
      case 'issue': return this.issue(scene, local);
      case 'list': return this.list(scene, local);
      case 'split': return this.split(scene, local, frames);
      case 'image': return this.image(scene, local, frames);
      case 'clip': return this.clip(scene, local, frames);
      default: throw new Error(`scene ${i}: unknown scene type "${scene.type}"`);
    }
  }

  // ---------------------------------------------------------------- the background (shared model)
  sharedBackground(active, frames, n) {
    const { gl, style, W, H, fps, u } = this, bg = style.canvas.background;
    if (bg.kind === 'css') this.background();
    else if (bg.kind === 'shader') {
      const P = backgroundProgram(gl, bg), g = gl.gl;
      gl.use(P, gl.full());
      const cols = (bg.colors ?? []).slice(0, 6).flatMap((c) => this.rgb(c));
      while (cols.length < 18) cols.push(0);
      g.uniform1f(P.u.uTime, (n / fps) * (bg.timeScale ?? 1)); g.uniform3fv(P.u.uCol, cols); g.uniform1fv(P.u.uP, backgroundParams(bg, u));
      g.uniform1f(P.u.uNCol, Math.min(6, (bg.colors ?? []).length)); g.uniform1f(P.u.uFrame, this.noiseFrame());
      g.uniform1f(P.u.uDither, gl.float ? 0 : style.post.dither);    // 8-bit frames dither right here; half-float ones wait for the final pass
      gl.fill();
    } else if (bg.kind === 'ambient') {
      let any = false;
      for (const a of active) {
        const tex = frames[a.i]?.ambient;
        if (!tex || !tex.w) continue;
        this.ambient(tex, bg, a.enter !== null && !any ? 1 : a.enter !== null ? a.enter : 1);
        any = true;
      }
    }
  }
  /** The recording's own colours, blurred, enlarged, saturated and dimmed, as a background. */
  ambient(tex, bg, opacity) {
    const { gl, W, H, u } = this, small = gl.fbo('amb0', 8), s2 = gl.fbo('amb1', 8), target = this.cur;
    gl.setXf(null);
    gl.target(small); gl.clear(0, 0, 0, 1);
    const sc = Math.max(small.w / tex.w, small.h / tex.h), pp = 1 / sc;
    gl.window(tex, { x: 0, y: 0, w: small.w, h: small.h }, 0, [(tex.w - small.w / sc) / 2, (tex.h - small.h / sc) / 2], [pp, pp], 1, { maxK: 8 });
    const sigma = Math.max(1, ((bg.blur ?? 90) * u) / 8);
    gl.blur(small, s2, sigma, true); gl.blur(s2, small, sigma, false);
    gl.target(target);
    const s = bg.scale ?? 1.2, tint = this.rgb(bg.tint ?? '#000000'), ta = bg.tintAmount ?? 0;
    gl.grade(small.tex, { x: (W - W * s) / 2, y: (H - H * s) / 2, w: W * s, h: H * s }, { saturate: bg.saturate ?? 1.3, dim: bg.dim ?? 0.35, tint: [tint[0] * ta, tint[1] * ta, tint[2] * ta, ta], opacity });
  }

  // ---------------------------------------------------------------- the frame
  /** Draw scene `a` with the effects of the transitions it is in, composited onto `dst` (null: the canvas). */
  composited(a, frames, enterFx, exitFx, dst) {
    const { gl, W, H } = this;
    if (!enterFx && !exitFx) { this.scene(a.i, a.local, frames); return; }
    const content = gl.fbo('content');
    gl.target(content); gl.clear(0, 0, 0, 0); this.cur = content;
    this.scene(a.i, a.local, frames);
    const apply = (src, fx, to, clear) => {
      let s = src;
      if (fx.sigma > 0.3) {
        const t1 = gl.fbo('tmp1'), t2 = gl.fbo('tmp2');
        gl.blur(s, t1, fx.sigma, true); gl.blur(t1, t2, fx.sigma, false); s = t2;
      }
      gl.target(to);
      if (clear) gl.clear(0, 0, 0, 0);
      const w = W * fx.sx, h = H * fx.sy;
      gl.quad(s.tex, { x: (W - w) / 2 + fx.tx, y: (H - h) / 2 + fx.ty, w, h }, { fbo: true, opacity: fx.opacity, bright: fx.bright });
    };
    if (enterFx && exitFx) { apply(content, enterFx, gl.fbo('chain'), true); apply(gl.fbo('chain'), exitFx, dst, false); }
    else apply(content, enterFx || exitFx, dst, false);
    gl.target(dst); this.cur = dst;
  }
  /** The frame number the grain and dither noise are seeded with: every output frame (post.grainClock 'frame', the default), every clock pose ('pose'), or never moving ('static'). */
  noiseFrame() {
    const k = this.style.post.grainClock;
    return k === 'static' ? 0 : k === 'pose' ? Math.floor(this.n / this.step) : this.n;
  }
  /** Progress of a gap as the transition sees it: held between poses when the style (or the transition) steps. */
  stepP(p, gap) {
    if (!gap.stepped || !this.clock) return p;
    const frames = Math.max(1, Math.round(gap.sec * this.fps));
    return Math.max(0, Math.min(frames - 1, Math.round(p * frames)) - (this.n % this.step)) / frames;
  }
  /** A style's own transition: both scenes into layers, then its GLSL mixes them over the target. */
  customTransition(a, b, frames, dst) {
    const { gl, W, H, style } = this, gap = a.exitGap, P = style.transition.params;
    const A = gl.fbo('layerA'), B = gl.fbo('layerB');
    const enterFx = a.enter !== null && a.enterGap.type !== undefined && !a.enterGap.custom ? effectFor(a.enterGap, true, this.stepP(a.enter, a.enterGap), W, H, P) : null;
    gl.target(A); gl.clear(0, 0, 0, 0); this.cur = A; this.composited(a, frames[a.i], enterFx, null, A);
    gl.target(B); gl.clear(0, 0, 0, 0); this.cur = B;
    const exitFxB = b.exit !== null && !b.exitGap.custom ? effectFor(b.exitGap, false, this.stepP(b.exit, b.exitGap), W, H, P) : null;
    this.composited(b, frames[b.i], null, exitFxB, B);
    gl.target(dst); this.cur = dst;
    const prog = transitionProgram(gl, gap.type, gap.custom.glsl), g = gl.gl;
    gl.use(prog, gl.full());
    gl.bind(A.tex, 0); gl.bind(B.tex, 1); g.uniform1i(prog.u.uFrom, 0); g.uniform1i(prog.u.uTo, 1);
    g.uniform1f(prog.u.uProgress, this.stepP(b.enter ?? 0, gap));
    g.uniform2f(prog.u.uDir, ...dirVec(gap.direction));
    const pal = [style.canvas.matte, style.palette.foreground, style.palette.accent, style.callout.dimColor].flatMap((c) => this.rgb(c));
    g.uniform3fv(prog.u.uPal, pal);
    gl.fill();
    g.activeTexture(g.TEXTURE0);
  }

  /** Output frame n: every active scene (with transitions), then the logo above everything. */
  frame(active, frames, n) {
    const { gl, style, W, H } = this;
    this.n = n;
    const main = style.needsMain ? gl.fbo('main', 1, true) : null;
    this.main = main; this.final = main; this.cur = main;
    gl.target(main);
    const m = this.rgb(style.canvas.matte);
    gl.clear(m[0], m[1], m[2], 1);   // Remotion renders over a white page, so the original look fades through white; a style names its own matte
    if (this.shared) this.sharedBackground(active, frames, n);
    // the logo steps aside where the recording fills the frame: each scene's share, weighted by how much of it shows in a transition
    let sw = 0, sv = 0;
    for (const a of active) { const w = (a.enter ?? 1) * (1 - (a.exit ?? 0)); sw += w; sv += w * this.logoShare(a); }
    this.logoK = sw > 0 ? sv / sw : 1;
    const P = style.transition.params;
    for (let k = 0; k < active.length; k++) {
      const a = active[k];
      // a transition the style defines itself takes both scenes at once
      const b = active[k + 1];
      if (a.exitGap?.custom?.glsl && b && b.enterGap && b.enterGap.type === a.exitGap.type) { this.customTransition(a, b, frames, main); k++; continue; }
      const enterFx = a.enter !== null ? effectFor(a.enterGap, true, this.stepP(a.enter, a.enterGap), W, H, P) : null;
      const exitFx = a.exit !== null ? effectFor(a.exitGap, false, this.stepP(a.exit, a.exitGap), W, H, P) : null;
      this.composited(a, frames[a.i], enterFx, exitFx, main);
    }
    gl.target(main); this.cur = main;
    if (main) {
      const p = style.post;
      gl.target(null);
      gl.post(main.tex, n, { grainFrame: this.noiseFrame(), dither: p.dither, grain: p.grain, grainSize: p.grainSize * this.u, vignette: p.vignette, vignetteSoftness: p.vignetteSoftness });
      this.cur = null;
    }
  }
  /**
   * How much of the logo shows over scene `a`: all of it over cards, none over a full-bleed recording, and in fill
   * mode it steps aside as the window grows: gone by fill 0.35, about where the window's edge reaches the logo's corner,
   * so the mark never sits on the recording.
   */
  logoShare(a) {
    const scene = this.spec.scenes[a.i];
    if (scene.type !== 'clip' && scene.type !== 'image') return 1;
    const lay = sceneLayout(this.spec, this.style, scene);
    if (lay.full) return 0;
    if (cameraModeOf(this.spec, this.style, scene) !== 'fill') return 1;
    const t = clamp01(fillTransform(cameraAt(scene.moves, a.local, this.fps, this.camEase), lay.view, this.W, this.H).fill / 0.35);
    return 1 - t * t * (3 - 2 * t);
  }
  logo(n) {
    const logo = this.spec.theme.logo;
    if (!logo) return;
    const { fps, W, H } = this, k = W / 1920, h = (logo.height ?? 34) * k, pad = 44 * k;
    const opacity = (logo.opacity ?? 0.9) * interpolate(n, [0.3 * fps, 0.9 * fps], [0, 1]) * (this.logoK ?? 1);
    if (opacity <= 0.001) return;
    const s = this.still(ID.logo(logo.src, h, this.style));
    const corner = logo.corner ?? 'bottom-right';
    const w = s.bw, hh = this.style.logo?.plate ? s.bh : h;   // a plate makes the picture taller than the logo
    const x = corner.endsWith('right') ? W - pad - w : pad;
    const y = corner.startsWith('bottom') ? H - pad * (H / W) * 1.6 - hh : pad * (H / W) * 1.6;
    this.gl.quad(s.tex, { x: x - (s.bx - s.x), y: y - (s.by - s.y), w: s.w, h: s.h }, { opacity });
  }
}
