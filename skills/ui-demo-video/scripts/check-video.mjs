#!/usr/bin/env node
// Validate a video.json (or an authored demo.json) before a render.
//
//   node scripts/check-video.mjs <video.json | demo.json> [--public <dir>] [--static] [--style <name>]
//
// A render takes minutes; a bad trim, a missing clip or a camera key past the
// end of its scene only shows up at the end of it. This takes a second. Exit
// code 1 on any error; warnings don't fail.
//
//   - a video.json is checked against the files it points at (clips, trims,
//     aspects, generated camera moves);
//   - a demo.json (the authored file demo.mjs runs, see references) is checked
//     statically, with no clips and no browser: every problem at once, so the
//     file can be fixed in one pass before anything is recorded;
//   - --static checks a video.json without looking at any file;
//   - --style <name> checks the camera as that style frames it (compose.mjs --style).
//
// The checks are plain functions (checkSpec, checkDemo) so demo.mjs runs the
// same ones in-process.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CAMERA_MODES, DEMO_KEYS, KNOWN_TRANSITIONS, SAFE_NAME, SCENE_KEYS, STEP_KEYS, TAKE_KEYS, THEME_KEYS, TOP_KEYS,
  CALLOUT_KEYS, CALLOUT_STYLES, CALLOUT_SIDES, BRACKET_SIDES,
  fillTiming, gapSec, isNote, resolveSpec, sceneSpans, styleName, takesUsed, STYLE_KEYS,
} from './spec-lib.mjs';
import { STYLES, TOKEN_GROUPS, flatten, resolveStyle, styleNames, unknownStyleMessage } from './compositor/styles/index.js';
import { cameraPose, sceneLayout, stripEmphasis } from './compositor/layout.js';
import { cameraTransform, makeCameraEase } from './compositor/motion.js';

// Reading speed: 20 characters a second is the ceiling Netflix sets for adult
// subtitles (15 to 17 reads comfortably); anything needs about 1.5 s.
const CPS = 20;
// Captions follow subtitle practice (Netflix, BBC, DCMP): at most 42 characters a line,
// two lines, about 17 characters a second. The story belongs on title, issue and list cards.
const CAPTION_LINE = 42, CAPTION_LINES = 2, CAPTION_CPS = 17;
const SCENES = new Set(Object.keys(SCENE_KEYS));

// Keys the file may carry that nothing reads are almost always typos
// ("duration" for "durationSec"), which silently do nothing.
const unknown = (obj, allowed, at, out, level = 'errors') => {
  for (const k of Object.keys(obj ?? {}))
    if (!allowed.includes(k) && !isNote(k)) out[level].push(`${at}: unknown key "${k}"${closest(k, allowed)}`);
};
const closest = (k, allowed) => {
  const low = k.toLowerCase();
  const near = allowed.find((a) => a.toLowerCase() === low || a.toLowerCase().startsWith(low) || low.startsWith(a.toLowerCase()));
  return near ? ` (did you mean "${near}"?)` : '';
};

const probeCache = new Map();
const media = (path) => {
  if (probeCache.has(path)) return probeCache.get(path);
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height:format=duration', '-of', 'json', path]).toString();
  const j = JSON.parse(out);
  const m = { w: j.streams[0].width, h: j.streams[0].height, dur: +j.format.duration };
  probeCache.set(path, m);
  return m;
};

/**
 * Check a video spec.
 *   pub    folder the spec's relative paths are under (default: cwd)
 *   files  false = static only: no file is opened, and what auto-camera
 *          writes (moves, callout boxes) is not required yet
 *   demo   the spec is an authored demo.json: scenes may say `take` for `src`,
 *          and authoring keys are allowed
 *   style  a style name that replaces the spec's (compose.mjs --style), for the camera check
 * Returns { errors, warnings, totalSec, scenes }.
 */
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? stripEmphasis(v) : '');
const wrongShape = (e) => ({ errors: [`something in this file has the wrong shape, so it could not be checked (${e.message})`], warnings: [], totalSec: 0, scenes: 0 });
export function checkSpec(spec, opts = {}) {
  if (!isObj(spec)) return { errors: ['the file must hold one JSON object (got ' + (spec === null ? 'null' : Array.isArray(spec) ? 'a list' : typeof spec) + ')'], warnings: [], totalSec: 0, scenes: 0 };
  try {
    return checkSpecInner(spec, opts);
  } catch (e) {
    return wrongShape(e);
  }
}
// A callout circles something the viewer should see: if the camera is elsewhere
// for more than this long while it shows (its box mostly off the frame), say so.
const OFF_FRAME_SEC = 0.3;
/**
 * Seconds a callout's box is mostly (more than half) outside what the viewer sees, under the scene's
 * camera: the window in inside mode, the frame in fill mode (through the fill camera). Sampled at 30 Hz.
 */
export const calloutOffFrame = (spec, style, scene, c) => {
  const W = spec.width ?? 1920, H = spec.height ?? 1080, fps = spec.fps ?? 60, ease = makeCameraEase(style.camera?.ease);
  const lay = sceneLayout({ ...spec, width: W, height: H }, style, scene);
  if (!lay) return 0;
  const view = lay.view, [x, y, w, h] = c.box, from = c.atSec, to = c.atSec + (c.forSec ?? style.callout?.forSec ?? 2.5), step = 1 / 30;
  let off = 0;
  for (let t = from; t < to - 1e-9; t += step) {
    const { cam, xf } = cameraPose({ ...spec, width: W, height: H }, style, scene, t * fps, fps, ease);
    let b, see;
    if (xf) {
      b = [xf.tx + xf.z * (view.left + x * view.w), xf.ty + xf.z * (view.top + y * view.h), xf.z * w * view.w, xf.z * h * view.h];
      see = [0, 0, W, H];
    } else {
      const k = cameraTransform(cam, view.w, view.h);
      b = [view.left + k.tx + x * view.w * k.z, view.top + k.ty + y * view.h * k.z, w * view.w * k.z, h * view.h * k.z];
      see = [view.left, view.top, view.w, view.h];
    }
    const ix = Math.max(0, Math.min(b[0] + b[2], see[0] + see[2]) - Math.max(b[0], see[0]));
    const iy = Math.max(0, Math.min(b[1] + b[3], see[1] + see[3]) - Math.max(b[1], see[1]));
    if (ix * iy < 0.5 * b[2] * b[3]) off += step;
  }
  return off;
};

function checkSpecInner(spec, { pub = '.', files = true, demo = false, style: styleFlag } = {}) {
  const out = { errors: [], warnings: [] };
  const { errors, warnings } = out;
  const probe = (src) => media(join(pub, src));

  unknown(spec, demo ? [...TOP_KEYS, ...DEMO_KEYS] : TOP_KEYS, 'spec', out, demo ? 'errors' : 'warnings');
  const cameraOk = (v, at) => {
    const m = typeof v === 'string' ? v : isObj(v) ? v.mode : undefined;
    if (v !== undefined && !CAMERA_MODES.includes(m)) errors.push(`${at}: camera must be "fill" or "inside" (or { "mode": "fill" }); got ${JSON.stringify(v)}`);
    if (isObj(v)) unknown(v, ['mode'], `${at} camera`, out, 'warnings');
  };
  cameraOk(spec.camera, 'spec');
  unknown(spec.theme, THEME_KEYS, 'theme', out, demo ? 'errors' : 'warnings');
  // The look: "style": "midnight" or { "preset": "midnight", "overrides": { "post": { "grain": 0.02 } } }
  let styleTransitions = [];
  if (spec.style !== undefined) {
    const st = spec.style, name = typeof st === 'string' ? st : isObj(st) ? (st.preset ?? 'studio') : null;
    if (name === null) errors.push('style: a name like "midnight" or { "preset": "midnight", "overrides": { ... } }');
    else if (!STYLES[name]) errors.push(`style: ${unknownStyleMessage(name)}`);
    else {
      if (isObj(st)) {
        unknown(st, STYLE_KEYS, 'style', out);
        if (st.overrides !== undefined && !isObj(st.overrides)) errors.push('style.overrides must be an object of tokens, e.g. { "post": { "grain": 0.02 } }');
        else unknown(st.overrides, TOKEN_GROUPS, 'style.overrides', out, 'warnings');
      }
      styleTransitions = Object.keys(flatten(name).transition?.custom ?? {});
    }
  }
  if (!Array.isArray(spec.scenes) || !spec.scenes.length) {
    errors.push('spec has no scenes');
    return { ...out, totalSec: 0, scenes: 0 };
  }
  // A demo.json fills these in; a video.json must carry them.
  // For a style other than studio, theme and transitions are the style's unless the author wrote them.
  const styled = (styleName(spec) ?? 'studio') !== 'studio' && STYLES[styleName(spec)];
  if (styled && isObj(spec.theme) && (spec.theme.background !== undefined || spec.theme.foreground !== undefined))
    warnings.push(`theme.background / theme.foreground are ignored under style "${styleName(spec)}" (the style owns its ground and text colour); use "style": { "preset": "${styleName(spec)}", "overrides": { "palette": { ... } } }`);
  if (!demo) for (const k of ['width', 'height', 'fps', 'theme', 'transition', 'transitionSec'])
    if (spec[k] === undefined && !(styled && ['theme', 'transition', 'transitionSec'].includes(k))) errors.push(`spec: missing "${k}"`);

  // Transitions of the wrong shape are reported, then replaced by the default
  // so the timeline sums below cannot throw.
  const okTransition = (t, at) => {
    const o = typeof t === 'string' ? { type: t } : t;
    if (!isObj(o) || typeof o.type !== 'string') { errors.push(`${at}: a transition is a name like "fade" or { "type": "fade", "sec": 0.5 }`); return false; }
    if (!KNOWN_TRANSITIONS.has(o.type) && !styleTransitions.includes(o.type)) { errors.push(`${at}: unknown transition "${o.type}"`); return false; }
    if ('sec' in o && !(typeof o.sec === 'number' && o.sec >= 0)) { errors.push(`${at}: transition sec must be a number of seconds`); return false; }
    return true;
  };
  let tspec = { fps: 60, ...spec };
  if (styled) { try { tspec = fillTiming(tspec, resolveStyle(spec)); } catch { /* a bad style is reported above */ } }
  if (spec.transition !== undefined && !okTransition(spec.transition, 'transition')) tspec.transition = 'zoom-blur';
  if (spec.transitionSec !== undefined && !(typeof spec.transitionSec === 'number' && spec.transitionSec >= 0)) {
    errors.push('transitionSec must be a number of seconds');
    tspec.transitionSec = 0.5;
  }
  if (!(typeof tspec.fps === 'number' && tspec.fps > 0)) { errors.push('fps must be a positive number'); tspec.fps = 60; }
  tspec.transitions = Array.isArray(spec.transitions)
    ? spec.transitions.map((t, i) => (t === null || t === undefined || okTransition(t, `gap after scene ${i}`) ? t : null))
    : undefined;
  tspec.scenes = spec.scenes.map((s) => (isObj(s) && Number.isFinite(s.durationSec) ? s : { durationSec: 0 }));
  const gap = (i) => gapSec(tspec, i);
  if (Array.isArray(spec.transitions)) {
    const gaps = spec.scenes.length - 1;
    if (spec.transitions.length > gaps)
      errors.push(`transitions has ${spec.transitions.length} entries but ${spec.scenes.length} scenes have ${gaps} gaps (index i is the gap after scene i)`);
  } else if (spec.transitions !== undefined) errors.push('transitions must be a list');

  const readable = (at, text, visibleSec) => {
    if (!text || typeof text !== 'string') return;
    text = stripEmphasis(text); // *word* markers are not read
    const need = Math.max(1.5, text.length / CPS);
    if (visibleSec < need)
      warnings.push(`${at}: "${text.slice(0, 40)}" is on screen ${visibleSec.toFixed(1)}s, needs about ${need.toFixed(1)}s to read`);
  };
  // a caption: short lines, two at most, read at about 17 characters a second (a line break in the text starts a new line)
  const caption = (at, text, visibleSec) => {
    if (!text || typeof text !== 'string') return readable(at, text, visibleSec);
    const plain = stripEmphasis(text), lines = plain.split('\n'), long = Math.max(...lines.map((l) => l.trim().length));
    const cut = `"${plain.slice(0, 40).replace(/\n/g, ' / ')}${plain.length > 40 ? '...' : ''}"`;
    if (lines.length > CAPTION_LINES || Math.ceil(long / CAPTION_LINE) * lines.length > CAPTION_LINES)
      warnings.push(`${at}: caption ${cut} runs past ${CAPTION_LINES} lines of ${CAPTION_LINE} characters; split it into timed captions or put the story on a title, issue or list card`);
    else if (long > CAPTION_LINE)
      warnings.push(`${at}: caption ${cut} is ${long} characters on one line (keep a line to ${CAPTION_LINE}); shorten it or split it into timed captions`);
    const cps = plain.replace(/\s+/g, ' ').trim().length / Math.max(0.1, visibleSec);
    if (cps > CAPTION_CPS) warnings.push(`${at}: caption ${cut} asks for ${cps.toFixed(0)} characters a second over ${visibleSec.toFixed(1)}s (about ${CAPTION_CPS} reads comfortably)`);
    readable(at, text, visibleSec);
  };
  const exists = (at, src, what = 'file') => {
    if (files && !existsSync(join(pub, src))) {
      errors.push(`${at}: missing ${what} ${join(pub, src)}`);
      return false;
    }
    return true;
  };
  // `ref` is the object that names the media: the scene, or a split's side.
  const clipFile = (at, ref, sec, rate = 1, aspect) => {
    if (ref !== undefined && !isObj(ref)) return errors.push(`${at}: must be an object`);
    const { src, take, trimStartSec: trim } = ref ?? {};
    if ((src !== undefined && typeof src !== 'string') || (take !== undefined && typeof take !== 'string')) return errors.push(`${at}: src and take must be text`);
    if (!src && !(demo && take)) return errors.push(`${at}: needs ${demo ? '"take" (or "src")' : '"src"'}`);
    if (demo && take && src) return errors.push(`${at}: has both take "${take}" and src; use one`);
    if (!src) return;
    if (!exists(at, src) || !files) return;
    const m = probe(src);
    const still = /\.(png|jpe?g|webp)$/i.test(src);
    const end = (trim ?? 0) + sec * rate;
    if (!still && end > m.dur + 0.05)
      errors.push(`${at}: trim ${trim ?? 0}s + ${sec}s${rate !== 1 ? ` x${rate}` : ''} = ${end.toFixed(2)}s, clip is ${m.dur.toFixed(2)}s (the last frame would freeze)`);
    if (aspect && Math.abs(m.w / m.h - aspect) > 0.02)
      errors.push(`${at}: aspect ${aspect} but the clip is ${m.w}x${m.h} (${(m.w / m.h).toFixed(3)})`);
  };

  spec.scenes.forEach((s, i) => {
    if (!isObj(s)) return errors.push(`scene ${i}: must be an object, got ${s === null ? 'null' : Array.isArray(s) ? 'a list' : typeof s}`);
    const at = `scene ${i}${s.caption ? ` ("${str(s.caption).slice(0, 40)}")` : s.text ? ` ("${str(s.text)}")` : s.title ? ` ("${str(s.title).slice(0, 40)}")` : ''}`;
    if (!SCENES.has(s.type)) return errors.push(`${at}: unknown scene type "${s.type}"`);
    unknown(s, demo && (s.type === 'clip' || s.type === 'image') ? [...SCENE_KEYS[s.type], 'take'] : SCENE_KEYS[s.type], at, out, demo ? 'errors' : 'warnings');
    if (!(s.durationSec > 0)) return errors.push(`${at}: durationSec must be a positive number of seconds`);
    if (i > 0) {
      const g = gap(i - 1);
      const prev = spec.scenes[i - 1];
      if (isObj(prev) && g > Math.min(prev.durationSec, s.durationSec) / 2)
        warnings.push(`${at}: its transition (${g.toFixed(2)}s) eats over half a scene`);
    }
    if (typeof s.voiceover?.src === 'string') exists(at, s.voiceover.src, 'voiceover');
    if (s.type === 'title') {
      if (!s.text) errors.push(`${at}: a title scene needs text`);
      if (s.durationSec < 1.6) warnings.push(`${at}: under 1.6s, the text reveal won't settle`);
      return;
    }
    if (s.type === 'issue') {
      if (!s.title) errors.push(`${at}: an issue scene needs a title`);
      readable(at, `${s.title ?? ''} ${s.quote ?? ''}`, s.durationSec - 0.8);
      return;
    }
    if (s.type === 'list') {
      if (!s.title) errors.push(`${at}: a list scene needs a title (template/src/types.ts requires it)`);
      if (!Array.isArray(s.items) || !s.items.length) errors.push(`${at}: a list scene needs items (a list of text)`);
      const settle = 0.45 + (Array.isArray(s.items) ? s.items.length : 0) * 0.16;
      if (s.durationSec < settle + 1.5) warnings.push(`${at}: the last item lands at ${settle.toFixed(1)}s; give it ${(settle + 1.5).toFixed(1)}s or more`);
      return;
    }
    if (s.type === 'split') {
      clipFile(`${at} before`, s.before, s.durationSec, 1, files ? s.aspect : undefined);
      clipFile(`${at} after`, s.after, s.durationSec, 1, files ? s.aspect : undefined);
      caption(at, s.caption, s.durationSec - 0.6);
      return;
    }
    // clip and image
    clipFile(at, s, s.durationSec, s.playbackRate ?? 1, files ? s.aspect : undefined);
    cameraOk(s.camera, at);
    if (s.camera !== undefined && s.frame === 'full') warnings.push(`${at}: camera has no effect on a full-bleed scene (the recording already fills the frame)`);
    if (demo && s.type === 'image' && s.take) errors.push(`${at}: an image scene shows a still; give it "src" (a png or jpg), not a take`);
    if (files && s.autoCamera && s.movesFrom !== 'auto-camera')
      errors.push(`${at}: has autoCamera but no generated moves; run scripts/auto-camera.mjs on this file`);
    if (typeof s.moves === 'string') errors.push(`${at}: moves must be a list of keyframes`);
    for (const mv of Array.isArray(s.moves) ? s.moves.filter(isObj) : []) {
      if (mv.atSec < 0 || mv.atSec > s.durationSec + 0.01)
        errors.push(`${at}: camera key at ${mv.atSec}s is outside the scene (0 to ${s.durationSec}s)`);
      if ((mv.zoom ?? 1) > 2.2) warnings.push(`${at}: zoom ${mv.zoom} will look soft even from a 2x capture`);
      for (const k of ['x', 'y']) if (mv[k] !== undefined && (mv[k] < 0 || mv[k] > 1))
        errors.push(`${at}: camera ${k}=${mv[k]} must be a fraction 0..1`);
    }
    if (s.callouts !== undefined && !Array.isArray(s.callouts)) errors.push(`${at}: callouts must be a list`);
    // A callout drawn where the camera is not looking circles nothing the viewer sees.
    if (Array.isArray(s.moves) && s.moves.length && Array.isArray(s.callouts) && Number.isFinite(s.durationSec)) {
      let st = null;
      try { st = resolveStyle(spec, styleFlag); } catch { /* a bad style is reported above */ }
      for (const c of st ? s.callouts : []) {
        if (!isObj(c) || !Array.isArray(c.box) || c.box.length !== 4 || !Number.isFinite(c.atSec) || !s.moves.every(isObj)) continue;
        const off = calloutOffFrame(spec, st, s, c), len = c.forSec ?? st.callout?.forSec ?? 2.5;
        if (off > OFF_FRAME_SEC + 1e-9)
          warnings.push(`${at}: callout${c.mark ? ` "${c.mark}"` : c.label ? ` "${c.label}"` : ''} is mostly outside the frame for ${off.toFixed(1)}s of its ${(+len).toFixed(1)}s: the camera is elsewhere while it shows. Let auto-camera frame it (a callout's mark is always a camera target), or move it or the camera keys`);
      }
    }
    for (const c of Array.isArray(s.callouts) ? s.callouts : []) {
      if (!isObj(c)) { errors.push(`${at}: a callout is an object like { "mark": "toast" }`); continue; }
      const name = c.mark ? ` "${c.mark}"` : '';
      unknown(c, CALLOUT_KEYS, `${at}: callout${name}`, out, 'warnings');
      if (c.style !== undefined && !CALLOUT_STYLES.includes(c.style)) errors.push(`${at}: callout${name} style "${c.style}" is not one of ${CALLOUT_STYLES.join(', ')}`);
      if (c.brackets !== undefined) {
        const sides = Array.isArray(c.brackets) ? c.brackets : [c.brackets];
        if (!sides.length || sides.some((b) => !BRACKET_SIDES.includes(b))) errors.push(`${at}: callout${name} brackets must be one or more of ${BRACKET_SIDES.join(', ')}`);
        if ((c.style ?? 'circle') !== 'bracket') warnings.push(`${at}: callout${name} has brackets but its style is "${c.style ?? 'circle'}" (brackets only shape "style": "bracket")`);
      }
      if (c.arrow !== undefined && typeof c.arrow !== 'boolean') errors.push(`${at}: callout${name} arrow must be true or false`);
      if (c.side !== undefined && !CALLOUT_SIDES.includes(c.side)) errors.push(`${at}: callout${name} side "${c.side}" is not one of ${CALLOUT_SIDES.join(', ')}`);
      if (c.label !== undefined && typeof c.label !== 'string') errors.push(`${at}: callout${name} label must be text`);
      if ((c.arrow !== undefined || c.side !== undefined) && !c.label) warnings.push(`${at}: callout${name} has ${c.arrow !== undefined ? 'arrow' : 'side'} but no label (they place the label)`);
      // A mark is placed and timed by auto-camera, so before it has run only
      // a callout with neither a mark nor a box is wrong.
      if (!c.mark && !c.box) errors.push(`${at}: callout has no mark and no box`);
      if (files && !c.box) errors.push(`${at}: callout${name} has no box; give one or run scripts/auto-camera.mjs to resolve its mark`);
      if (c.atSec === undefined) {
        if (files || !c.mark) errors.push(`${at}: callout${name} has no atSec; give one or run scripts/auto-camera.mjs to resolve its mark`);
      } else if (c.atSec < 0 || c.atSec > s.durationSec) errors.push(`${at}: callout at ${c.atSec}s is outside the scene`);
    }
    if (s.captions !== undefined && !Array.isArray(s.captions)) errors.push(`${at}: captions must be a list of { atSec, text }`);
    if (Array.isArray(s.captions) && s.captions.length && s.captions.every(isObj)) {
      const cs = [...s.captions].sort((a, b) => a.atSec - b.atSec);
      cs.forEach((c, j) => {
        if (!c.text) errors.push(`${at}: caption ${j} has no text`);
        if (c.atSec < 0 || c.atSec >= s.durationSec) errors.push(`${at}: caption at ${c.atSec}s is outside the scene`);
        const until = j + 1 < cs.length ? cs[j + 1].atSec : s.durationSec;
        caption(at, c.text, until - c.atSec - 0.6);
      });
    } else caption(at, s.caption, s.durationSec - 0.6);
  });
  if (typeof spec.music?.src === 'string') exists('music', spec.music.src);
  const stages = spec.scenes.filter((s) => s?.frame === 'stage').length;
  if (stages > 2) warnings.push(`${stages} stage scenes: keep the 3D shot for one or two hero moments`);
  if (typeof spec.theme?.logo?.src === 'string') exists('theme.logo', spec.theme.logo.src);
  const totalSec = sceneSpans(tspec).totalSec;
  if (totalSec > 90) warnings.push(`total ${totalSec.toFixed(1)}s: most demos land at 45 to 60s, a fix plus a tour under 90; trim a beat`);
  return { ...out, totalSec, scenes: spec.scenes.length };
}

// A step is one object with the keys references/steps.md lists. Mistakes here
// cost a whole slowed-down take, so catch what can be caught by reading.
const checkSteps = (at, steps, out) => {
  if (!Array.isArray(steps)) return out.errors.push(`${at}: steps must be a list`);
  const target = (t) => t === true || (t && typeof t === 'object' && (('x' in t && 'y' in t) || t.selector || t.text));
  steps.forEach((s, i) => {
    const sa = `${at} step ${i}`;
    if (!s || typeof s !== 'object' || Array.isArray(s)) return out.errors.push(`${sa}: a step is an object like { "wait": 1 }`);
    unknown(s, STEP_KEYS, sa, out);
    if (!Object.keys(s).some((k) => ['wait', 'waitFor', 'move', 'click', 'type', 'key', 'scroll', 'eval', 'mark', 'camera', 'redact'].includes(k)))
      out.errors.push(`${sa}: does nothing (no wait, click, type, ...)`);
    if ('wait' in s && !(s.wait >= 0)) out.errors.push(`${sa}: wait must be seconds`);
    if ('click' in s && !target(s.click)) out.errors.push(`${sa}: click needs true or a target { selector | text | x,y }`);
    if ('move' in s && !target(s.move) || s.move === true) out.errors.push(`${sa}: move needs a target { selector | text | x,y }`);
    if (s.mark && !(target(s.target) && s.target !== true)) out.errors.push(`${sa}: mark "${s.mark}" needs a target { selector | text }`);
    if ('waitFor' in s && !(s.waitFor && (s.waitFor.selector || s.waitFor.text))) out.errors.push(`${sa}: waitFor needs { selector } or { text }`);
    if ('type' in s && typeof s.type !== 'string') out.errors.push(`${sa}: type must be a string`);
    if ('scroll' in s && typeof s.scroll !== 'number') out.errors.push(`${sa}: scroll must be a number of px`);
    if ('camera' in s && s.camera !== 'wide') out.errors.push(`${sa}: camera only supports "wide"`);
  });
};

/**
 * Check an authored demo.json with no clips and no browser: the takes, the
 * steps, how scenes use them, then every static scene check. Returns the same
 * shape as checkSpec.
 */
export function checkDemo(demo) {
  if (!isObj(demo)) return { errors: ['the file must hold one JSON object (got ' + (demo === null ? 'null' : Array.isArray(demo) ? 'a list' : typeof demo) + ')'], warnings: [], totalSec: 0, scenes: 0 };
  try {
    return checkDemoInner(demo);
  } catch (e) {
    return wrongShape(e);
  }
}
function checkDemoInner(demo) {
  const out = { errors: [], warnings: [] };
  if (demo.name !== undefined && !SAFE_NAME.test(str(demo.name))) out.errors.push(`name "${demo.name}" must be letters, digits, dots, dashes or underscores (it names the output files)`);
  if (demo.url !== undefined) try { new URL(demo.url); } catch { out.errors.push(`url "${demo.url}" is not a full URL like http://localhost:3000`); }
  if (demo.capture !== undefined && !isObj(demo.capture)) out.errors.push('capture must be an object of options');
  else unknown(demo.capture, TAKE_KEYS.filter((k) => !['url', 'duration', 'steps', 'setup', 'pageSetup', 'rehearse'].includes(k)), 'capture', out);
  const takes = isObj(demo.takes) ? demo.takes : {};
  if (demo.takes !== undefined && !isObj(demo.takes)) out.errors.push('takes must be an object of name -> take');
  for (const [name, t] of Object.entries(takes)) {
    const at = `take "${name}"`;
    if (!SAFE_NAME.test(name)) out.errors.push(`${at}: use letters, digits, dots, dashes or underscores in take names (they name the clip files)`);
    if (!isObj(t)) { out.errors.push(`${at}: must be an object with url, duration and steps`); continue; }
    unknown(t, TAKE_KEYS, at, out);
    if (!t.url && !demo.url) out.errors.push(`${at}: no url (give the take one or set "url" at the top of the file)`);
    else try { new URL(t.url ?? '', demo.url); } catch { out.errors.push(`${at}: url "${t.url}" is not a URL`); }
    if (t.duration !== undefined && !(t.duration > 0)) out.errors.push(`${at}: duration must be seconds`);
    // --hide-floating hides small fixed-position widgets, and toasts are exactly that.
    const floating = t.hideFloating ?? demo.capture?.hideFloating;
    const keep = t.keep ?? demo.capture?.keep;
    if (floating && !keep && /toast|sonner|snackbar|notification/i.test(JSON.stringify(t.steps ?? [])))
      out.warnings.push(`${at}: hideFloating also hides toasts, which these steps look for; add "keep": "<css of the toast container>" or turn hideFloating off`);
    if (!Array.isArray(t.steps) || !t.steps.length) {
      if (t.steps !== undefined && !Array.isArray(t.steps)) out.errors.push(`${at}: steps must be a list`);
      else out.warnings.push(`${at}: no steps; it records the page sitting still`);
    } else checkSteps(at, t.steps, out);
  }
  const scenes = Array.isArray(demo.scenes) ? demo.scenes : [];
  const used = takesUsed(demo);
  for (const n of used) if (!(n in takes)) out.errors.push(`takes: "${n}" is used by a scene but not defined (defined: ${Object.keys(takes).join(', ') || 'none'})`);
  for (const n of Object.keys(takes)) if (!used.includes(n)) out.warnings.push(`take "${n}" is defined but no scene uses it (it would be recorded for nothing)`);
  scenes.forEach((s, i) => {
    if (isObj(s) && s.type === 'split') {
      for (const side of ['before', 'after'])
        if (!s[side]?.take && !s[side]?.src) out.errors.push(`scene ${i}: split needs ${side}.take (or ${side}.src)`);
    }
  });
  // checkSpec on the authored file already flags missing take/src; resolving
  // is only for the timeline total.
  const spec = checkSpec(demo, { demo: true, files: false });
  return { errors: [...out.errors, ...spec.errors], warnings: [...out.warnings, ...spec.warnings], totalSec: spec.totalSec, scenes: spec.scenes };
}

// ------------------------------------------------------------------- CLI

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [file, ...rest] = process.argv.slice(2);
  if (!file) {
    console.error('usage: check-video.mjs <video.json | demo.json> [--public <dir>] [--static] [--style <name>]');
    process.exit(2);
  }
  const flag = (n) => {
    const i = rest.indexOf(`--${n}`);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  let spec;
  try {
    spec = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`error ${file}: ${e.message}`);
    process.exit(1);
  }
  const demo = (isObj(spec) && DEMO_KEYS.some((k) => k in spec)) || /demo\.json$/.test(file) || (Array.isArray(spec?.scenes) && spec.scenes.some((s) => s?.take || s?.before?.take));
  let r;
  if (demo) r = checkDemo(spec);
  else {
    // Default: a Remotion project (src/video.json -> ../public), else next to the file.
    const guess = resolve(dirname(file), '..', 'public');
    const pub = resolve(flag('public') ?? (existsSync(guess) ? guess : dirname(file)));
    r = checkSpec(spec, { pub, files: !rest.includes('--static'), style: flag('style') });
  }
  for (const w of r.warnings) console.log(`warn  ${w}`);
  for (const e of r.errors) console.log(`error ${e}`);
  console.log(`${r.scenes} scenes, ${r.totalSec.toFixed(1)}s, ${r.errors.length} errors, ${r.warnings.length} warnings${demo ? ' (static check of a demo.json: no clips or browser involved)' : ''}`);
  process.exit(r.errors.length ? 1 : 0);
}
