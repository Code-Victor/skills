// Scene by scene: turns "scene i at local frame f" into GPU draws. A port of
// the template's scenes.tsx, Caption.tsx, Callouts.tsx, Logo.tsx and the
// remocn text and transition components, with the same numbers (layout,
// easing, springs, timing). Text and cards are not drawn here: they arrive
// as textures captured from real HTML (plan.js) and are only moved, faded
// and blurred.

import { Easing, bezier, cameraAt, cameraTransform, interpolate, spring } from './motion.js';
import { ID, accentOf, has, bandTop, sceneBox, splitBoxes, tagColorOf } from './plan.js';

const SPRING = { damping: 200 };
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const hex = (c) => {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})/i.exec(c || '');
  let h = m ? m[1] : '3b6bff';
  if (h.length === 3) h = [...h].map((x) => x + x).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
};
const snap = (b) => {
  const x0 = Math.round(b.left), y0 = Math.round(b.top), x1 = Math.round(b.left + b.w), y1 = Math.round(b.top + b.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

// ---------------------------------------------------------------- transitions
// The remocn presentations, as plain numbers: how a scene looks at progress p
// while entering or exiting. sigma = blur radius in px, scale about the centre,
// translate in px, brightness multiplier.
const SOFT = bezier(0.42, 0, 0.58, 1);
const outQuad = Easing.out(Easing.quad), outCubic = Easing.out(Easing.cubic);
export const effectFor = (gap, entering, p, W, H) => {
  const fx = { opacity: 1, sx: 1, sy: 1, tx: 0, ty: 0, sigma: 0, bright: 1 };
  switch (gap.type) {
    case 'zoom-blur': {
      if (entering) { fx.opacity = p; fx.sx = fx.sy = 0.9 + p * 0.1; fx.sigma = p < 1 ? (1 - p) * 16 : 0; }
      else { fx.opacity = 1 - p; fx.sx = fx.sy = 1 + p * 0.12; fx.sigma = p * 16; }
      break;
    }
    case 'fade': fx.opacity = entering ? p : 1; break;
    case 'focus-pull': {
      if (!entering) {
        fx.opacity = interpolate(p, [0.42, 0.68], [1, 0], { easing: SOFT });
        fx.sx = fx.sy = interpolate(p, [0, 0.6], [1, 1.05], { easing: SOFT });
        fx.sigma = interpolate(p, [0.05, 0.55], [0, 16], { easing: Easing.quad });
        fx.bright = interpolate(p, [0.1, 0.55], [1, 1.3]);
      } else {
        fx.opacity = interpolate(p, [0.32, 0.52], [0, 1]);
        fx.sx = fx.sy = interpolate(p, [0.35, 1], [0.97, 1], { easing: outCubic });
        fx.sigma = interpolate(p, [0.35, 0.9], [16, 0], { easing: outQuad });
        fx.bright = interpolate(p, [0.4, 0.85], [1.25, 1]);
      }
      break;
    }
    case 'push-through': {
      if (!entering) {
        fx.opacity = interpolate(p, [0.4, 0.62], [1, 0], { easing: SOFT });
        fx.sx = fx.sy = interpolate(p, [0, 0.65], [1, 2.4], { easing: Easing.cubic });
        fx.sigma = interpolate(p, [0.15, 0.6], [0, 14]);
      } else {
        fx.opacity = interpolate(p, [0.3, 0.5], [0, 1]);
        fx.sx = fx.sy = interpolate(p, [0.3, 0.88, 1], [0.68, 1.02, 1], { easing: outCubic });
        fx.sigma = interpolate(p, [0.3, 0.75], [14 * 0.7, 0]);
      }
      break;
    }
    case 'whip-pan': {
      const dir = gap.direction ?? 'left';
      const travel = interpolate(p, [0, 1], [0, 1], { easing: bezier(0.7, 0, 0.2, 1) });
      const velocity = Math.sin(Math.PI * travel);
      const horizontal = dir === 'left' || dir === 'right';
      const sign = dir === 'left' || dir === 'up' ? -1 : 1;
      const offset = (entering ? travel - 1 : travel) * 1.1 * sign;     // 110% of the frame
      const stretch = 1 + velocity * 0.12;
      if (horizontal) { fx.tx = offset * W; fx.sx = stretch; } else { fx.ty = offset * H; fx.sy = stretch; }
      fx.sigma = velocity * 24;
      break;
    }
  }
  return fx;
};

export class Scenes {
  /**
   * R: { gl, spec, fps, W, H, stills: Map(id -> {tex,x,y,w,h,bx,by,bw,bh}), images: Map(sceneIndex -> tex) }
   */
  constructor(R) { this.R = R; this.spec = R.spec; this.gl = R.gl; this.W = R.W; this.H = R.H; this.fps = R.fps; this.u = R.W / 1920; this.cur = null; }

  still(id) {
    const s = this.R.stills.get(id);
    if (!s) throw new Error(`internal: missing captured piece "${id}"`);
    return s;
  }
  /** Draw a captured piece at its natural place, moved by (dx, dy), faded, and optionally scaled about its element's centre. */
  piece(id, o = {}) {
    if ((o.opacity ?? 1) <= 0.001) return;
    const s = this.still(id), sc = o.scale ?? 1;
    let r = { x: s.x + (o.dx ?? 0), y: s.y + (o.dy ?? 0), w: s.w, h: s.h };
    if (sc !== 1) {
      const cx = s.bx + s.bw / 2 + (o.dx ?? 0), cy = s.by + s.bh / 2 + (o.dy ?? 0);
      r = { x: cx + (r.x - cx) * sc, y: cy + (r.y - cy) * sc, w: r.w * sc, h: r.h * sc };
    }
    this.gl.quad(s.tex, r, { opacity: o.opacity ?? 1, sigma: o.sigma ?? 0 });
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

  // ---------------------------------------------------------------- captions
  caption(top, tag, text, lf, dur) {
    const size = this.W * 0.0135;
    const enter = spring({ frame: lf - Math.round(0.25 * this.fps), fps: this.fps, config: SPRING });
    const exit = interpolate(lf, [dur - Math.round(0.35 * this.fps), dur], [1, 0]);
    this.piece(ID.pill(top, tag, tagColorOf(this.spec, tag), text), { opacity: enter * exit, dy: (1 - enter) * size * 0.8 });
  }
  captions(scene, local) {
    const total = Math.round(scene.durationSec * this.fps), top = bandTop(this.spec, scene);
    if (scene.type === 'clip' && scene.captions?.length) {
      const sorted = [...scene.captions].sort((a, b) => a.atSec - b.atSec);
      sorted.forEach((c, i) => {
        const from = Math.round(c.atSec * this.fps);
        const to = i + 1 < sorted.length ? Math.round(sorted[i + 1].atSec * this.fps) : total;
        if (local >= from && local < Math.max(from + 1, to)) this.caption(top, c.tag ?? scene.tag, c.text, local - from, Math.max(1, to - from));
      });
    } else if (scene.caption) this.caption(top, scene.tag, scene.caption, local, total);
  }

  // ---------------------------------------------------------------- recordings
  /**
   * One recording (a video frame or a still) in its window, with the camera
   * pushing in inside the window and the callouts riding with it.
   * Returns nothing; draws background, shell, window, callouts.
   */
  recording(scene, local, tex, mode) {
    const { gl, spec, W, H, u } = this, box = sceneBox(spec, scene), full = mode === 'full';
    const win = snap(box), radius = full ? 0 : W * 0.008;
    const cam = cameraTransform(cameraAt(scene.moves, local, this.fps), box.w, box.h);
    if (!full) gl.quad(this.still(ID.shell(box, W * 0.008)).tex, this.rectOf(ID.shell(box, W * 0.008)));
    // cover-fit the recording to the box, then the camera: output px -> source px
    const sc = Math.max(box.w / tex.w, box.h / tex.h), pp = 1 / (cam.z * sc);
    const off = [(tex.w - box.w / sc) / 2, (tex.h - box.h / sc) / 2];
    const dx = win.x - box.left, dy = win.y - box.top;
    gl.window(tex, win, radius, [off[0] - cam.tx * pp + dx * pp, off[1] - cam.ty * pp + dy * pp], [pp, pp]);
    this.callouts(scene, local, box, win, radius, cam);
  }
  rectOf(id) { const s = this.still(id); return { x: s.x, y: s.y, w: s.w, h: s.h }; }

  callouts(scene, local, box, win, winR, cam) {
    const { gl, fps, u } = this, accent = accentOf(this.spec), rgb = hex(accent);
    for (const c of scene.callouts ?? []) {
      if (!c.box || c.atSec === undefined) continue;
      const from = Math.round(c.atSec * fps), to = from + Math.round((c.forSec ?? 2.5) * fps);
      if (local < from - 1 || local > to + 1) continue;
      const enter = spring({ frame: local - from, fps, config: SPRING, durationInFrames: Math.round(0.35 * fps) });
      const exit = interpolate(local, [to - Math.round(0.25 * fps), to], [1, 0]);
      const o = enter * exit;
      const [x, y, bw, bh] = c.box, z = cam.z, pad = 8 * u;
      const left = box.left + cam.tx + x * box.w * z - pad, top = box.top + cam.ty + y * box.h * z - pad;
      const bwid = bw * box.w * z + pad * 2, bhgt = bh * box.h * z + pad * 2;
      const sc = 0.96 + 0.04 * enter, spot = c.style === 'spotlight';
      gl.scissor(win);
      gl.callout(win, winR, {
        cx: left + bwid / 2, cy: top + bhgt / 2, hw: (bwid / 2) * sc, hh: (bhgt / 2) * sc, radius: 10 * u * sc, ring: 2.5 * u * sc,
        opacity: o, fillA: spot ? 0 : 0x14 / 255, dimA: spot ? 0.42 * o : 0, accent: rgb,
      });
      if (c.label) {
        const s = this.still(ID.chip(c.label, accent)), below = y < 0.18;
        const cw = s.bw, ch = s.bh;
        const cy = (below ? top + bhgt + 10 * u : top - 10 * u - ch) + (1 - enter) * 6 * u * (below ? -1 : 1);
        gl.quad(s.tex, { x: left - (s.bx - s.x), y: cy - (s.by - s.y), w: s.w, h: s.h }, { opacity: o });
      }
      gl.scissor(null);
    }
  }

  // ---------------------------------------------------------------- scene types
  clip(scene, local, frames) {
    const mode = scene.frame === 'stage' ? 'flat' : scene.frame ?? 'flat';
    this.background();
    this.recording(scene, local, frames.main, mode);
    this.captions(scene, local);
  }
  image(scene, local, frames) {
    this.background();
    this.recording(scene, local, frames.main, 'flat');
    this.captions(scene, local);
  }
  split(scene, local, frames) {
    const { gl, W, H, fps } = this, boxes = splitBoxes(W, H, scene.aspect);
    this.background();
    const labels = [scene.before.label ?? 'Before', scene.after.label ?? 'After'];
    [0, 1].forEach((i) => {
      const enter = spring({ frame: local - i * 4, fps, config: SPRING });
      if (has(labels[i])) this.piece(ID.piece(this.index, `l${i}`), { opacity: enter });
      const b = boxes[i], tex = frames[i === 0 ? 'before' : 'after'];
      this.group(enter, 0, (1 - enter) * 16, () => {
        gl.quad(this.still(ID.shell(b, W * 0.008)).tex, this.rectOf(ID.shell(b, W * 0.008)));
        const win = snap(b), sc = Math.max(b.w / tex.w, b.h / tex.h), pp = 1 / sc;
        gl.window(tex, win, W * 0.008, [(tex.w - b.w / sc) / 2 + (win.x - b.left) * pp, (tex.h - b.h / sc) / 2 + (win.y - b.top) * pp], [pp, pp]);
      });
    });
    this.captions(scene, local);
  }
  issue(scene, local) {
    const { fps, u } = this, i = this.index;
    this.background();
    const s = (delay) => spring({ frame: local - Math.round(delay * fps), fps, config: SPRING });
    const s0 = s(0);
    this.group(s0, 0, (1 - s0) * 14 * u, () => {
      this.piece(ID.card(i));
      const rise = (name, delay, alpha = 1) => { const v = s(delay); this.piece(ID.piece(i, name), { opacity: v * alpha, dy: (1 - v) * 14 * u }); };
      if (has(scene.title)) rise('title', 0.15);
      if (has(scene.quote)) rise('quote', 0.45, 0.85);
      if (has(scene.reporter)) rise('reporter', 0.65, 0.55);
    });
  }
  list(scene, local) {
    const { fps, u } = this, i = this.index;
    this.background();
    const at = (delay) => spring({ frame: local - Math.round(delay * fps), fps, config: SPRING });
    const h = at(0);
    if (has(scene.title) || has(scene.subtitle)) this.piece(ID.piece(i, 'head'), { opacity: h, dy: (1 - h) * 14 * u });
    (scene.items ?? []).forEach((_, k) => { const v = at(0.45 + k * 0.16); this.piece(ID.piece(i, `i${k}`), { opacity: v, dx: (1 - v) * -18 * u }); });
  }
  title(scene, local) {
    const { fps, W } = this, i = this.index, effect = scene.effect ?? 'soft-blur-in';
    this.background();
    const speed = 30 / fps;
    if (!has(scene.text)) { /* nothing to reveal */ }
    else if (effect === 'word-push') this.wordPush(scene, i, local * speed);
    else if (effect === 'micro-scale-fade') {
      const e = bezier(0.32, 0.72, 0, 1), f = local * speed;
      this.piece(ID.piece(i, 'all'), { opacity: interpolate(f, [0, 18], [0, 1], { easing: e }), scale: interpolate(f, [0, 18], [0.96, 1], { easing: e }) });
    } else {
      // soft-blur-in gets no speed correction in the template: its counts run in output frames
      const e = bezier(0.22, 1, 0.36, 1);
      Array.from(scene.text).forEach((c, k) => {
        if (!c.trim()) return;
        const l = local - k;
        const blur = interpolate(l, [0, 27], [12, 0], { easing: e });
        this.piece(ID.piece(i, `c${k}`), { opacity: interpolate(l, [0, 27], [0, 1], { easing: e }), dy: interpolate(l, [0, 9], [16, 0], { easing: e }), sigma: blur });
      });
    }
    if (has(scene.subtitle)) {
      const sub = interpolate(local, [0.7 * fps, 1.2 * fps], [0, 1]);
      this.piece(ID.piece(i, 'sub'), { opacity: sub * 0.6, dy: (1 - sub) * 8 });
    }
  }
  wordPush(scene, i, f) {
    const words = scene.text.trim().split(/\s+/).filter(Boolean), size = this.W * 0.042;
    const REVEAL = 2, SLIDE = 12, OVER = 0.5, CHAR = 0.5, SPACE = 0.22, wordGap = 10, accel = 0.8;
    const revealFrame = (n) => (wordGap * (1 - accel ** n)) / (1 - accel);
    const push = Easing.out(Easing.cubic), drive = bezier(0.15, 0.7, 0.25, 1);
    let lineX = interpolate(f, [0, SLIDE], [-OVER * size, 0], { easing: drive });
    for (let j = 1; j < words.length; j++) {
      const wordWidth = (words[j].length * CHAR + SPACE) * size;
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

  // ---------------------------------------------------------------- the frame
  /** Draw scene `a` with the effects of the transitions it is in, composited onto the target. */
  composited(a, frames, enterFx, exitFx) {
    const { gl, W, H } = this;
    if (!enterFx && !exitFx) { this.scene(a.i, a.local, frames); return; }
    const content = gl.fbo('content');
    gl.target(content); gl.clear(0, 0, 0, 0); this.cur = content;
    this.scene(a.i, a.local, frames);
    const final = this.final;
    const apply = (src, fx, dst) => {
      let s = src;
      if (fx.sigma > 0.3) {
        const t1 = gl.fbo('tmp1'), t2 = gl.fbo('tmp2');
        gl.blur(s, t1, fx.sigma, true); gl.blur(t1, t2, fx.sigma, false); s = t2;
      }
      gl.target(dst);
      if (dst) gl.clear(0, 0, 0, 0);
      const w = W * fx.sx, h = H * fx.sy;
      gl.quad(s.tex, { x: (W - w) / 2 + fx.tx, y: (H - h) / 2 + fx.ty, w, h }, { fbo: true, opacity: fx.opacity, bright: fx.bright });
    };
    if (enterFx && exitFx) { apply(content, enterFx, gl.fbo('chain')); apply(gl.fbo('chain'), exitFx, final); }
    else apply(content, enterFx || exitFx, final);
    gl.target(final); this.cur = final;
  }

  /** Output frame n: every active scene (with transitions), then the logo above everything. */
  frame(active, frames, final) {
    const { gl, spec, W, H } = this;
    this.final = final; this.cur = final;
    gl.target(final); gl.clear(1, 1, 1, 1);   // Remotion renders over a white page, so transitions fade through white
    for (const a of active) {
      const enterFx = a.enter !== null ? effectFor(a.enterGap, true, a.enter, W, H) : null;
      const exitFx = a.exit !== null ? effectFor(a.exitGap, false, a.exit, W, H) : null;
      this.composited(a, frames[a.i], enterFx, exitFx);
    }
    gl.target(final); this.cur = final;
  }
  logo(n) {
    const logo = this.spec.theme.logo;
    if (!logo) return;
    const { fps, W, H } = this, k = W / 1920, h = (logo.height ?? 34) * k, pad = 44 * k;
    const opacity = (logo.opacity ?? 0.9) * interpolate(n, [0.3 * fps, 0.9 * fps], [0, 1]);
    if (opacity <= 0.001) return;
    const s = this.still(ID.logo(logo.src, h));
    const corner = logo.corner ?? 'bottom-right';
    const w = s.bw;
    const x = corner.endsWith('right') ? W - pad - w : pad;
    const y = corner.startsWith('bottom') ? H - pad * (H / W) * 1.6 - h : pad * (H / W) * 1.6;
    this.gl.quad(s.tex, { x: x - (s.bx - s.x), y: y - (s.by - s.y), w: s.w, h: s.h }, { opacity });
  }
}
