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
//     or key: that usually changes what the callout circles.
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
};
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
    const cut = breaks.find((t) => t > s.start && t < s.end + o.hold);
    s.cut = cut !== undefined;
    s.holdEnd = Math.min(dur, s.cut ? cut - 0.05 : s.end + o.hold);
  });
  // A hold never runs into the next shot's push-in.
  shots.forEach((s, i) => {
    const next = shots[i + 1];
    if (next) s.holdEnd = Math.min(s.holdEnd, Math.max(s.end + 0.4, next.start - o.lead));
  });
  // Too shallow reads as a wobble; too short to hold reads as a twitch.
  return shots.filter(
    (s) => s.zoom >= o.minZoom && s.holdEnd - s.start >= o.minHold && s.items.length >= o.minActions,
  );
};

// Recording seconds to scene seconds: after the trim, and faster when the
// scene plays the recording at more than 1x.
const sceneTime = (scene) => (t) => (t - (scene.trimStartSec ?? 0)) / (scene.playbackRate ?? 1);

const movesFor = (scene, ev, o) => {
  const toScene = sceneTime(scene);
  const dur = scene.durationSec;
  // Typing counts from where it starts until where it ends; a mark is a
  // place to look, not an action, but it still draws the camera.
  const items = ev.events
    .filter((e) => ['click', 'type-start', 'type-end', 'mark'].includes(e.type) && e.look !== false)
    .filter((e) => e.box || e.x !== undefined)
    .map(focusOf)
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
    const zoomedIn = (keys.at(-1).zoom ?? 1) > 1;
    const inAt = Math.max(keys.at(-1).atSec, s.start - o.lead);
    // Stay where we are until the move starts.
    if (!zoomedIn && inAt > keys.at(-1).atSec) at({ atSec: inAt, ...pick(keys.at(-1)) });
    let lastKey = null;
    for (const it of s.items) {
      // Actions in the same spot don't need a move of their own.
      if (lastKey && dist(it, lastKey) < 0.04) continue;
      const arrive = Math.max(keys.at(-1).atSec + (lastKey ? 0.3 : 0.35), it.t);
      if (arrive > s.holdEnd) break;
      at({ atSec: arrive, ...here(it, s.zoom) });
      lastKey = it;
    }
    at({ atSec: s.holdEnd, ...here(lastKey ?? s.items[0], s.zoom) });
    // Pull out after a break, at the end, or before a far-off next shot;
    // otherwise pan straight on to it.
    const panOn = next && !s.cut && next.start - o.lead - s.holdEnd < o.outSec + 0.4;
    if (!panOn) at({ atSec: s.holdEnd + (s.cut ? o.outSec * 0.75 : o.outSec), zoom: 1 });
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
  if (scene.autoCamera && scene.type === 'clip') {
    if (!ev) {
      console.error(`scene ${i}: no ${src}.events.json in ${pub}; recapture it with capture.mjs (it writes ${src}.events.json next to the clip), or keep the file beside the clip in ${pub}`);
      process.exitCode = 1;
      continue;
    }
    const o = { ...DEFAULTS, ...(typeof scene.autoCamera === 'object' ? scene.autoCamera : {}) };
    scene.moves = movesFor(scene, ev, o);
    scene.movesFrom = 'auto-camera';
    changed++;
    console.log(`scene ${i} (${src}): ${scene.moves.length} camera keys`);
  }
  for (const c of scene.callouts ?? []) {
    if (!c.mark) continue;
    const m = ev?.events.find((e) => e.type === 'mark' && e.label === c.mark);
    if (!m?.box) {
      console.error(`scene ${i}: no mark "${c.mark}" with a box in ${src}.events.json`);
      process.exitCode = 1;
      continue;
    }
    const toScene = sceneTime(scene);
    const atSec = Math.max(0, toScene(m.t) + (c.delaySec ?? 0));
    const next = ev.events.find((e) => (e.type === 'click' || e.type === 'key') && e.t > m.t);
    const until = Math.min(atSec + (c.maxSec ?? 2.5), next ? toScene(next.t) + 0.2 : Infinity, scene.durationSec);
    c.box = m.box;
    c.atSec = round(atSec);
    c.forSec = round(Math.max(1.2, until - atSec), 2);
    changed++;
  }
}
if (dry) console.log(JSON.stringify(spec.scenes.map((s) => s.moves ?? null), null, 1));
else if (changed) {
  writeFileSync(file, `${JSON.stringify(spec, null, 2)}\n`);
  console.log(`wrote ${file}`);
} else console.log('nothing to direct: add "autoCamera": true to a clip scene, or "mark" to a callout');
