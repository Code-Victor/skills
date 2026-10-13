#!/usr/bin/env node
// Validate a video.json against the files it points at, before a render.
//
//   node scripts/check-video.mjs <video.json> [--public <dir>]
//
// A Remotion render takes minutes; a bad trim, a missing clip or a camera key
// past the end of its scene only shows up at the end of it. This takes a
// second. Exit code 1 on any error; warnings don't fail.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const [file, ...rest] = process.argv.slice(2);
if (!file) {
  console.error('usage: check-video.mjs <video.json> [--public <dir>]');
  process.exit(2);
}
const flag = (n) => {
  const i = rest.indexOf(`--${n}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
const spec = JSON.parse(readFileSync(file, 'utf8'));
// Default: a Remotion project (src/video.json -> ../public), else next to the file.
const guess = resolve(dirname(file), '..', 'public');
const pub = resolve(flag('public') ?? (existsSync(guess) ? guess : dirname(file)));

const NATURAL = { 'whip-pan': 26 / 30, 'push-through': 40 / 30, 'focus-pull': 46 / 30 };
const KNOWN = new Set(['zoom-blur', 'fade', 'cut', 'whip-pan', 'push-through', 'focus-pull']);
const errors = [];
const warnings = [];
const probe = new Map();

const media = (src) => {
  if (probe.has(src)) return probe.get(src);
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height:format=duration', '-of', 'json', join(pub, src)]).toString();
  const j = JSON.parse(out);
  const m = { w: j.streams[0].width, h: j.streams[0].height, dur: +j.format.duration };
  probe.set(src, m);
  return m;
};

const gap = (i) => {
  const t = spec.transitions?.[i] ?? spec.transition;
  const o = typeof t === 'string' ? { type: t } : t;
  if (!KNOWN.has(o.type)) errors.push(`gap after scene ${i}: unknown transition "${o.type}"`);
  return o.type === 'cut' ? 0 : (o.sec ?? NATURAL[o.type] ?? spec.transitionSec);
};

// Reading speed: 20 characters a second is the ceiling Netflix sets for adult
// subtitles (15 to 17 reads comfortably); anything needs about 1.5 s.
const CPS = 20;
const readable = (at, text, visibleSec) => {
  if (!text) return;
  const need = Math.max(1.5, text.length / CPS);
  if (visibleSec < need)
    warnings.push(`${at}: "${text.slice(0, 40)}" is on screen ${visibleSec.toFixed(1)}s, needs about ${need.toFixed(1)}s to read`);
};
const clipFile = (at, src, trim, sec, rate = 1, aspect) => {
  if (!src) return errors.push(`${at}: missing src`);
  if (!existsSync(join(pub, src))) return errors.push(`${at}: missing file ${join(pub, src)}`);
  if (/\.(png|jpe?g|webp)$/i.test(src)) return;
  const m = media(src);
  const end = (trim ?? 0) + sec * rate;
  if (end > m.dur + 0.05)
    errors.push(`${at}: trim ${trim ?? 0}s + ${sec}s${rate !== 1 ? ` x${rate}` : ''} = ${end.toFixed(2)}s, clip is ${m.dur.toFixed(2)}s (the last frame would freeze)`);
  if (aspect && Math.abs(m.w / m.h - aspect) > 0.02)
    errors.push(`${at}: aspect ${aspect} but the clip is ${m.w}x${m.h} (${(m.w / m.h).toFixed(3)})`);
};
const SCENES = new Set(['title', 'clip', 'issue', 'split', 'image', 'list']);

let total = 0;
spec.scenes.forEach((s, i) => {
  const at = `scene ${i}${s.caption ? ` ("${s.caption.slice(0, 40)}")` : s.text ? ` ("${s.text}")` : s.title ? ` ("${s.title.slice(0, 40)}")` : ''}`;
  total += s.durationSec;
  if (i > 0) {
    const g = gap(i - 1);
    total -= g;
    const prev = spec.scenes[i - 1];
    if (g > Math.min(prev.durationSec, s.durationSec) / 2)
      warnings.push(`${at}: its transition (${g.toFixed(2)}s) eats over half a scene`);
  }
  if (!SCENES.has(s.type)) return errors.push(`${at}: unknown scene type "${s.type}"`);
  if (s.voiceover && !existsSync(join(pub, s.voiceover.src))) errors.push(`${at}: missing voiceover ${s.voiceover.src}`);
  if (s.type === 'title') {
    if (s.durationSec < 1.6) warnings.push(`${at}: under 1.6s, the text reveal won't settle`);
    return;
  }
  if (s.type === 'issue') {
    if (!s.title) errors.push(`${at}: an issue scene needs a title`);
    readable(at, `${s.title ?? ''} ${s.quote ?? ''}`, s.durationSec - 0.8);
    return;
  }
  if (s.type === 'list') {
    if (!s.items?.length) errors.push(`${at}: a list scene needs items`);
    const settle = 0.45 + (s.items?.length ?? 0) * 0.16;
    if (s.durationSec < settle + 1.5) warnings.push(`${at}: the last item lands at ${settle.toFixed(1)}s; give it ${(settle + 1.5).toFixed(1)}s or more`);
    return;
  }
  if (s.type === 'split') {
    clipFile(`${at} before`, s.before?.src, s.before?.trimStartSec, s.durationSec, 1, s.aspect);
    clipFile(`${at} after`, s.after?.src, s.after?.trimStartSec, s.durationSec, 1, s.aspect);
    readable(at, s.caption, s.durationSec - 0.6);
    return;
  }
  // clip and image
  clipFile(at, s.src, s.trimStartSec, s.durationSec, s.playbackRate ?? 1, s.aspect);
  if (s.autoCamera && s.movesFrom !== 'auto-camera')
    errors.push(`${at}: has autoCamera but no generated moves; run scripts/auto-camera.mjs on this file`);
  if (typeof s.moves === 'string') errors.push(`${at}: moves must be a list of keyframes`);
  for (const mv of Array.isArray(s.moves) ? s.moves : []) {
    if (mv.atSec < 0 || mv.atSec > s.durationSec + 0.01)
      errors.push(`${at}: camera key at ${mv.atSec}s is outside the scene (0 to ${s.durationSec}s)`);
    if ((mv.zoom ?? 1) > 2.2) warnings.push(`${at}: zoom ${mv.zoom} will look soft even from a 2x capture`);
    for (const k of ['x', 'y']) if (mv[k] !== undefined && (mv[k] < 0 || mv[k] > 1))
      errors.push(`${at}: camera ${k}=${mv[k]} must be a fraction 0..1`);
  }
  for (const c of s.callouts ?? []) {
    if (!c.box) errors.push(`${at}: callout${c.mark ? ` "${c.mark}"` : ''} has no box; give one or run scripts/auto-camera.mjs to resolve its mark`);
    if (c.atSec === undefined)
      errors.push(`${at}: callout${c.mark ? ` "${c.mark}"` : ''} has no atSec; give one or run scripts/auto-camera.mjs to resolve its mark`);
    else if (c.atSec < 0 || c.atSec > s.durationSec) errors.push(`${at}: callout at ${c.atSec}s is outside the scene`);
  }
  if (s.captions?.length) {
    const cs = [...s.captions].sort((a, b) => a.atSec - b.atSec);
    cs.forEach((c, j) => {
      if (c.atSec < 0 || c.atSec >= s.durationSec) errors.push(`${at}: caption at ${c.atSec}s is outside the scene`);
      const until = j + 1 < cs.length ? cs[j + 1].atSec : s.durationSec;
      readable(at, c.text, until - c.atSec - 0.6);
    });
  } else readable(at, s.caption, s.durationSec - 0.6);
});
if (spec.music && !existsSync(join(pub, spec.music.src))) errors.push(`music: missing file ${spec.music.src}`);
const stages = spec.scenes.filter((s) => s.frame === 'stage').length;
if (stages > 2) warnings.push(`${stages} stage scenes: keep the 3D shot for one or two hero moments`);
if (spec.theme?.logo && !existsSync(join(pub, spec.theme.logo.src)))
  errors.push(`theme.logo: missing file ${join(pub, spec.theme.logo.src)}`);
if (total > 90) warnings.push(`total ${total.toFixed(1)}s: most demos land at 45 to 60s, a fix plus a tour under 90; trim a beat`);

for (const w of warnings) console.log(`warn  ${w}`);
for (const e of errors) console.log(`error ${e}`);
console.log(`${spec.scenes.length} scenes, ${total.toFixed(1)}s, ${errors.length} errors, ${warnings.length} warnings`);
process.exit(errors.length ? 1 : 0);
