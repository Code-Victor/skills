#!/usr/bin/env node
// Direct the camera from what happened in each take, the way Screen Studio
// auto-zooms: push in as the cursor acts, hold while it works, pan between
// nearby actions, pull back out when it moves on. Also turns `mark` steps
// into callouts.
//
//   node scripts/auto-camera.mjs <video.json> [--public <dir>] [--dry]
//
// Reads <public>/<src>.events.json for each clip, e.g. clips/after.mp4.events.json
// (capture.mjs writes it next to the clip; demo.mjs keeps clips and events in
// the demo folder's clips/ and passes the demo folder as <public>).
// <public> defaults to ../public of the video.json, else its own folder.
// Edits video.json in place, only for:
//   - clip and split scenes: sets `aspect` to the take's own shape.
//   - clip scenes with "autoCamera": true or { options }: writes `moves`
//     and tags them "movesFrom": "auto-camera". Re-running regenerates them.
//     To hand-tune a scene, delete its "autoCamera" key and edit `moves`.
//   - callouts with "mark": "<label>": sets `box`, `atSec` and `forSec` from
//     the mark step with that label, every run. It shows `delaySec` (0) after
//     the mark, for up to `maxSec` (2.5), and ends just after the next click
//     or key: that usually changes what the callout circles. When the camera
//     has to move to it first, it starts as the camera arrives instead.
//
// Cause and effect: a mark that follows a click or typing in the same shot is
// that action's result (a toast, a saved row). The camera stays on the action
// for `see` seconds (its own feedback: the press, the spinner), then moves to
// the result and holds it for the callout's time (or `hold`). When the two fit
// one view (within `reach`, and both boxes inside the view at the shot's zoom)
// it frames both instead of moving. A mark a callout uses is always framed,
// whatever its `look`; `"look": false` keeps the camera off a mark only when
// no callout uses it. A pan to something more than a view away takes `farSec`
// (the renderer flies it on a smooth pan-zoom path that pulls out on the way).
//
// autoCamera options (all optional). Defaults follow Cap, the open-source
// Screen Studio alternative (2x auto zoom, merge clicks under 2.5 s apart,
// ignore the last second), a little gentler for dense product UI:
//   zoom      1.8   push-in for a single click or a small control
//   maxZoom   2.0   never tighter than this (2x captures go soft past ~2.2)
//   minZoom   1.3   a push-in smaller than this reads as a wobble; skipped
//   lead      0.6   seconds the push-in starts before the action
//   hold      2.0   seconds it stays after the last action in a shot
//   gap       2.5   actions closer than this in time share one shot...
//   reach     0.3   ...if they are also within this fraction of the frame
//   pad       2.4   a marked or typed box fills 1/pad of the frame
//   outSec    0.8   length of the pull back to the full frame
//   tail      1.0   actions in the scene's last second don't zoom
//   minHold   1.0   a shot that can't hold this long is skipped (a twitch)
//   minActions 1    2 = never zoom on a lone click (Cursorful's rule)
//   endWide   true  finish the scene on the full frame when there is time
//   see       0.6   seconds on an action before moving to its result
//   farSec    0.7   length of a pan to a spot more than one view away
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const [file, ...rest] = process.argv.slice(2);
if (!file) {
  console.error('usage: auto-camera.mjs <video.json> [--public <dir>] [--dry]');
  process.exit(2);
}
const flag = (n) => {
  const i = rest.indexOf(`--${n}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
const dry = rest.includes('--dry');
const spec = JSON.parse(readFileSync(file, 'utf8'));
const guess = resolve(dirname(file), '..', 'public');
const pub = resolve(flag('public') ?? (existsSync(guess) ? guess : dirname(file)));

const DEFAULTS = {
  zoom: 1.8, maxZoom: 2.0, minZoom: 1.3, lead: 0.6, hold: 2.0,
  gap: 2.5, reach: 0.3, pad: 2.4, outSec: 0.8, tail: 1.0, minHold: 1.0, minActions: 1, endWide: true,
  see: 0.6, farSec: 0.7,
};
const CALLOUT_LEAD = 0.2;   // a callout the camera moves to starts this long before the camera lands
const round = (v, n = 3) => +v.toFixed(n);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const loadEvents = (src) => {
  const f = join(pub, `${src}.events.json`);
  if (!existsSync(f)) return null;
  return JSON.parse(readFileSync(f, 'utf8'));
};

// What the camera should look at: a centre, and a box when we know one.
const focusOf = (e) => {
  const b = e.box;
  if (b) return { t: e.t, cx: b[0] + b[2] / 2, cy: b[1] + b[3] / 2, box: b, kind: e.type };
  return { t: e.t, cx: e.x, cy: e.y, box: null, kind: e.type };
};

// How far in a box can be framed: it fills about 1/pad of the view. A bare
// click has no box, so it gets the default push-in.
const fitZoom = (box, o) => (box ? 1 / Math.max(box[2] * o.pad, box[3] * o.pad * 1.6) : o.zoom);
const dist = (a, b) => Math.hypot(a.cx - b.cx, (a.cy - b.cy) / 1.6);
// More than one view apart at this zoom (along x or y): a far pan.
const far = (a, b, zoom) => Math.max(Math.abs(a.cx - b.cx), Math.abs(a.cy - b.cy)) > 1 / zoom;
const ACTIONS = new Set(['click', 'type-start', 'type-end']);
// The box around two looks (a bare click is a point).
const union = (a, b) => {
  const r = (f) => (f.box ? [f.box[0], f.box[1], f.box[0] + f.box[2], f.box[1] + f.box[3]] : [f.cx, f.cy, f.cx, f.cy]);
  const [p, q] = [r(a), r(b)];
  const x0 = Math.min(p[0], q[0]), y0 = Math.min(p[1], q[1]), x1 = Math.max(p[2], q[2]), y1 = Math.max(p[3], q[3]);
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, box: [x0, y0, x1 - x0, y1 - y0] };
};

/**
 * Shots: runs of actions the camera stays pushed in for. It follows each
 * action inside a shot (Screen Studio pans with the cursor rather than
 * reframing), and starts a new shot after a pause, a break, or a far jump
 * that isn't quick enough to just pan across.
 */
const shotsFrom = (items, breaks, dur, o) => {
  const shots = [];
  for (const it of items) {
    const last = shots.at(-1);
    const prev = last?.items.at(-1);
    const broken = prev && breaks.some((t) => t > prev.t && t <= it.t);
    const late = prev && it.t - prev.t > o.gap;
    const farAndSlow = prev && dist(it, prev) > o.reach && it.t - prev.t > 1.2;
    if (last && !broken && !late && !farAndSlow) last.items.push(it);
    else shots.push({ items: [it] });
  }
  shots.forEach((s) => {
    s.start = s.items[0].t;
    s.end = s.items.at(-1).t;
    s.zoom = clamp(Math.min(o.zoom, ...s.items.map((i) => fitZoom(i.box, o))), 1, o.maxZoom);
    s.nextBreak = breaks.find((t) => t > s.start);
    // The latest a hold can run: the scene's end, just before a break.
    s.limit = Math.min(dur, s.nextBreak !== undefined ? s.nextBreak - 0.05 : Infinity);
  });
  // A hold never runs into the next shot's push-in.
  shots.forEach((s, i) => {
    const next = shots[i + 1];
    if (next) s.limit = Math.min(s.limit, Math.max(s.end + 0.4, next.start - o.lead));
    s.holdEnd = Math.min(s.limit, s.end + o.hold);
    s.cut = s.nextBreak !== undefined && s.holdEnd >= s.nextBreak - 0.05 - 1e-9;
  });
  // Too shallow reads as a wobble; too short to hold reads as a twitch.
  return shots.filter(
    (s) => s.zoom >= o.minZoom && s.holdEnd - s.start >= o.minHold && s.items.length >= o.minActions,
  );
};

// Recording seconds to scene seconds: after the trim, and faster when the
// scene plays the recording at more than 1x.
const sceneTime = (scene) => (t) => (t - (scene.trimStartSec ?? 0)) / (scene.playbackRate ?? 1);

// A callout from a mark starts at the mark (plus delaySec), or later when the
// camera only gets there later (`from`), and lasts up to maxSec, ending just
// after the next click or key.
const markTimes = new WeakMap();   // callout -> { at, next, dur } in scene seconds
const timeCallout = (c, from = -Infinity) => {
  const { at, next, dur } = markTimes.get(c);
  const atSec = Math.max(at, Math.min(from, dur - 1.2));
  const until = Math.min(atSec + (c.maxSec ?? 2.5), next + 0.2, dur);
  c.atSec = round(atSec);
  c.forSec = round(Math.max(1.2, until - atSec), 2);
};
const calloutEnd = (c) => c.atSec + c.forSec;

const movesFor = (scene, ev, o, callouts) => {
  const toScene = sceneTime(scene);
  const dur = scene.durationSec;
  // Typing counts from where it starts until where it ends; a mark is a
  // place to look, not an action, but it still draws the camera, and one a
  // callout uses always does.
  const items = ev.events
    .filter((e) => ['click', 'type-start', 'type-end', 'mark'].includes(e.type))
    .filter((e) => e.look !== false || callouts.some((c) => c.mark === e.label))
    .filter((e) => e.box || e.x !== undefined)
    .map((e) => ({ ...focusOf(e), callouts: e.type === 'mark' ? callouts.filter((c) => c.mark === e.label) : [] }))
    .map((f) => ({ ...f, t: toScene(f.t) }))
    .filter((f) => f.t >= -o.lead && f.t <= dur - o.tail)
    .sort((a, b) => a.t - b.t);
  // A scroll, or a `"camera": "wide"` step (a drawer or page opening), means
  // the view changes under the camera: never stay zoomed across one.
  const breaks = ev.events.filter((e) => e.type === 'scroll' || e.type === 'wide').map((e) => toScene(e.t));

  const shots = shotsFrom(items, breaks, dur, o);
  const keys = [{ atSec: 0, zoom: 1 }];
  const at = (k) => {
    const t = round(clamp(k.atSec, 0, dur));
    if (t <= keys.at(-1).atSec) keys.pop();
    keys.push({ ...k, atSec: t });
  };
  const here = (i, z) => ({ x: round(i.cx), y: round(i.cy), zoom: round(z, 2) });
  shots.forEach((s, i) => {
    const next = shots[i + 1];
    const prevKey = keys.at(-1);
    const zoomedIn = (prevKey.zoom ?? 1) > 1;
    const inAt = Math.max(prevKey.atSec, s.start - o.lead);
    // Stay where we are until the move starts.
    if (!zoomedIn && inAt > prevKey.atSec) at({ atSec: inAt, ...pick(prevKey) });
    // lastAct: when the last action at the camera's spot happened (typing ends after it starts)
    let lastKey = null, lastAct = -Infinity, holdEnd = s.holdEnd;
    const hold = (it, arrive) => {   // a result with a callout holds for the callout's time
      if (it.callouts.length) holdEnd = Math.max(holdEnd, arrive + o.minHold, ...it.callouts.map(calloutEnd));
    };
    for (const it of s.items) {
      // Actions in the same spot don't need a move of their own.
      if (lastKey && dist(it, lastKey) < 0.04) {
        if (ACTIONS.has(it.kind)) lastAct = Math.max(lastAct, it.t);
        hold(it, it.t);
        continue;
      }
      if (lastKey && ACTIONS.has(lastKey.kind) && it.kind === 'mark') {
        // An action's result: frame both when they fit one view, else stay on
        // the action for `see` seconds, then move to the result.
        const cause = lastKey, both = union(cause, it);
        if (dist(it, cause) <= o.reach && both.box[2] <= 0.85 / s.zoom && both.box[3] <= 0.85 / s.zoom) {
          Object.assign(keys.at(-1), here(both, s.zoom));
          lastKey = { ...both, kind: 'mark' };
          hold(it, it.t);
          continue;
        }
        const pan = far(cause, it, s.zoom) ? o.farSec : 0.45;
        const arrive = Math.max(Math.max(keys.at(-1).atSec, lastAct) + o.see + pan, it.t);
        if (arrive > s.limit) break;
        at({ atSec: arrive - pan, ...here(cause, s.zoom) });
        at({ atSec: arrive, ...here(it, s.zoom) });
        for (const c of it.callouts) timeCallout(c, arrive - CALLOUT_LEAD);
        holdEnd = Math.max(holdEnd, arrive + o.hold * (it.callouts.length ? 0 : 1));
        hold(it, arrive);
        lastKey = it;
        continue;
      }
      // A pan inside a shot to a spot more than a view away takes farSec (a
      // pan on from the last shot already has `lead`).
      const move = lastKey ? (far(lastKey, it, s.zoom) ? o.farSec : 0.3) : 0.35;
      const arrive = Math.max(keys.at(-1).atSec + move, it.t);
      if (arrive > Math.min(s.limit, holdEnd)) break;
      at({ atSec: arrive, ...here(it, s.zoom) });
      for (const c of it.callouts) timeCallout(c, arrive - CALLOUT_LEAD);
      hold(it, arrive);
      lastKey = it;
      lastAct = ACTIONS.has(it.kind) ? it.t : -Infinity;
    }
    holdEnd = Math.min(s.limit, holdEnd);
    const cut = s.nextBreak !== undefined && holdEnd >= s.nextBreak - 0.05 - 1e-9;
    at({ atSec: holdEnd, ...here(lastKey ?? s.items[0], s.zoom) });
    // Pull out after a break, at the end, or before a far-off next shot;
    // otherwise pan straight on to it.
    const panOn = next && !cut && next.start - o.lead - holdEnd < o.outSec + 0.4;
    if (!panOn) at({ atSec: holdEnd + (cut ? o.outSec * 0.75 : o.outSec), zoom: 1 });
  });
  const last = keys.at(-1);
  if ((last.zoom ?? 1) > 1 && o.endWide && dur - last.atSec >= o.outSec + 0.3) {
    at({ atSec: last.atSec + o.outSec, zoom: 1 });
  }
  return keys;
};
const pick = (k) => ({ ...(k.x !== undefined ? { x: k.x, y: k.y } : {}), zoom: k.zoom ?? 1 });

let changed = 0;
for (const [i, scene] of spec.scenes.entries()) {
  if (scene.type !== 'clip' && scene.type !== 'split') continue;
  const src = scene.src ?? scene.after?.src;
  const ev = src ? loadEvents(src) : null;
  // The window's shape comes from the take itself, so a recording made at the
  // screen's own size never gets squeezed into a hand-typed aspect.
  const measured = ev?.width && ev?.height ? round(ev.width / ev.height) : null;
  if (measured && Math.abs((scene.aspect ?? 0) - measured) > 0.005) {
    scene.aspect = measured;
    changed++;
    console.log(`scene ${i} (${src}): aspect ${measured} (${ev.width}x${ev.height})`);
  }
  // Callouts first: the camera frames what they circle, and may start them later.
  const marked = [];
  for (const c of scene.callouts ?? []) {
    if (!c.mark) continue;
    const m = ev?.events.find((e) => e.type === 'mark' && e.label === c.mark);
    if (!m?.box) {
      console.error(`scene ${i}: no mark "${c.mark}" with a box in ${src}.events.json`);
      process.exitCode = 1;
      continue;
    }
    const toScene = sceneTime(scene);
    const next = ev.events.find((e) => (e.type === 'click' || e.type === 'key') && e.t > m.t);
    markTimes.set(c, { at: Math.max(0, toScene(m.t) + (c.delaySec ?? 0)), next: next ? toScene(next.t) : Infinity, dur: scene.durationSec });
    c.box = m.box;
    timeCallout(c);
    marked.push(c);
    changed++;
  }
  if (scene.autoCamera && scene.type === 'clip') {
    if (!ev) {
      console.error(`scene ${i}: no ${src}.events.json in ${pub}; recapture it with capture.mjs (it writes ${src}.events.json next to the clip), or keep the file beside the clip in ${pub}`);
      process.exitCode = 1;
      continue;
    }
    const o = { ...DEFAULTS, ...(typeof scene.autoCamera === 'object' ? scene.autoCamera : {}) };
    scene.moves = movesFor(scene, ev, o, marked);
    scene.movesFrom = 'auto-camera';
    changed++;
    console.log(`scene ${i} (${src}): ${scene.moves.length} camera keys`);
  }
}
if (dry) console.log(JSON.stringify(spec.scenes.map((s) => s.moves ?? null), null, 1));
else if (changed) {
  writeFileSync(file, `${JSON.stringify(spec, null, 2)}\n`);
  console.log(`wrote ${file}`);
} else console.log('nothing to direct: add "autoCamera": true to a clip scene, or "mark" to a callout');
