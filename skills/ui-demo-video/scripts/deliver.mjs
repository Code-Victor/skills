#!/usr/bin/env node
// Everything to hand over after a render, plus an automated check of it.
//
//   node scripts/deliver.mjs <demo.mp4> --spec <video.json> [options]
//
//   --out <dir>        where to write (default: next to the video)
//   --max-mb 10        size cap for the PR copy (GitHub: 10 MB on free plans)
//   --gif 12:6         also a GIF of 6 s starting at 12 s (keep GIFs short)
//   --poster 8.5       poster frame time (default: a third into the first "After" clip)
//
// Writes <name>-pr.mp4, <name>.vtt, <name>.srt, <name>-chapters.txt,
// <name>-poster.png (and <name>.gif). Then scans the master for frozen or
// black stretches inside clip scenes, which usually mean a trim ran past the
// end of a recording or a take lost its frames.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const [input, ...rest] = process.argv.slice(2);
const flag = (n) => {
  const i = rest.indexOf(`--${n}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
if (!input || !flag('spec')) {
  console.error('usage: deliver.mjs <demo.mp4> --spec <video.json> [--out dir] [--max-mb 10] [--gif start:dur] [--poster sec]');
  process.exit(2);
}
const video = resolve(input);
const spec = JSON.parse(readFileSync(flag('spec'), 'utf8'));
const outDir = resolve(flag('out') ?? dirname(video));
const name = basename(video).replace(/\.mp4$/, '');
const maxMb = +(flag('max-mb') ?? 10);
const ff = (...a) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...a], { stdio: ['ignore', 'ignore', 'pipe'] });
const probe = (f) =>
  JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_type', '-of', 'json', f]).toString(),
  );

// ---------------------------------------------------------------- timeline
// The same sums as the template's timeline.ts: a transition overlaps the two
// scenes it joins.
const NATURAL = { 'whip-pan': 26 / 30, 'push-through': 40 / 30, 'focus-pull': 46 / 30 };
const gapSec = (i) => {
  const t = spec.transitions?.[i] ?? spec.transition;
  const o = typeof t === 'string' ? { type: t } : t;
  return o.type === 'cut' ? 0 : (o.sec ?? NATURAL[o.type] ?? spec.transitionSec);
};
let cursor = 0;
const spans = spec.scenes.map((s, i) => {
  if (i > 0) cursor -= gapSec(i - 1);
  const span = { start: cursor, end: cursor + s.durationSec, scene: s };
  cursor = span.end;
  return span;
});

// Cues mirror what is on screen: titles, the issue, list items and captions,
// with the caption pill's own entrance and exit.
const cues = [];
for (const { start, end, scene: s } of spans) {
  const add = (from, to, text) => text && cues.push({ from: Math.max(0, from), to: Math.max(from + 0.5, to), text });
  if (s.type === 'title') add(start + 0.3, end - 0.3, [s.text, s.subtitle].filter(Boolean).join('\n'));
  else if (s.type === 'issue') add(start + 0.3, end - 0.3, [s.id && `${s.source ?? ''} ${s.id}`.trim(), s.title, s.quote && `“${s.quote}”`].filter(Boolean).join('\n'));
  else if (s.type === 'list') add(start + 0.3, end - 0.3, [s.title, ...s.items].join('\n'));
  else if (s.captions?.length) {
    const cs = [...s.captions].sort((a, b) => a.atSec - b.atSec);
    cs.forEach((c, j) => add(start + c.atSec + 0.25, start + (cs[j + 1]?.atSec ?? s.durationSec) - 0.35, [c.tag ?? s.tag, c.text].filter(Boolean).join(': ')));
  } else add(start + 0.25, end - 0.35, [s.tag, s.caption].filter(Boolean).join(': '));
}
const stamp = (t, sep) => {
  const ms = Math.round(t * 1000);
  const h = String(Math.floor(ms / 3.6e6)).padStart(2, '0');
  const m = String(Math.floor((ms % 3.6e6) / 6e4)).padStart(2, '0');
  const sec = String(Math.floor((ms % 6e4) / 1000)).padStart(2, '0');
  return `${h}:${m}:${sec}${sep}${String(ms % 1000).padStart(3, '0')}`;
};
writeFileSync(join(outDir, `${name}.vtt`), `WEBVTT\n\n${cues.map((c) => `${stamp(c.from, '.')} --> ${stamp(c.to, '.')}\n${c.text}`).join('\n\n')}\n`);
writeFileSync(join(outDir, `${name}.srt`), `${cues.map((c, i) => `${i + 1}\n${stamp(c.from, ',')} --> ${stamp(c.to, ',')}\n${c.text}`).join('\n\n')}\n`);

// Chapters: scenes with a `chapter`, or each title and issue card.
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const chapters = spans
  .map(({ start, scene: s }) => ({ start, label: s.chapter ?? (s.type === 'title' ? s.text : s.type === 'issue' ? 'The problem' : null) }))
  .filter((c, i, all) => c.label && c.label !== all[i - 1]?.label);
writeFileSync(join(outDir, `${name}-chapters.txt`), `${chapters.map((c) => `${mmss(c.start)} ${c.label}`).join('\n')}\n`);

// ---------------------------------------------------------------- poster
// The result sells the video, so prefer the first "After" clip over a
// "Before" one; a clip's middle is usually mid-action, so take a third in.
const isClip = (s) => s.scene.type === 'clip' || s.scene.type === 'split';
const posterSpan = spans.find((s) => isClip(s) && /after/i.test(s.scene.tag ?? '')) ?? spans.find(isClip);
const posterAt = +(flag('poster') ?? (posterSpan ? posterSpan.start + (posterSpan.end - posterSpan.start) / 3 : 1));
ff('-ss', String(posterAt), '-i', video, '-frames:v', '1', join(outDir, `${name}-poster.png`));

// ---------------------------------------------------------------- PR copy
const info = probe(video);
const duration = +info.format.duration;
const hasAudio = info.streams.some((s) => s.codec_type === 'audio');
const pr = join(outDir, `${name}-pr.mp4`);
const audioArgs = hasAudio ? ['-c:a', 'aac', '-b:a', '128k'] : ['-an'];
const common = ['-c:v', 'libx264', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', ...audioArgs];
// Try a quality-based encode at 1080p first; most demos fit.
ff('-i', video, '-vf', 'scale=1920:-2:flags=lanczos', '-crf', '24', ...common, pr);
let mb = statSync(pr).size / 1048576;
if (mb > maxMb) {
  // Over the cap: two passes at the bitrate that fits, at 1600 wide.
  const kbps = Math.floor(((maxMb * 0.94 * 8192) / duration) - (hasAudio ? 128 : 0));
  const passlog = join(outDir, `.${name}-pass`);
  const vf = ['-vf', 'scale=1600:-2:flags=lanczos'];
  ff('-i', video, ...vf, '-c:v', 'libx264', '-preset', 'slow', '-b:v', `${kbps}k`, '-pass', '1', '-passlogfile', passlog, '-an', '-f', 'mp4', '/dev/null');
  ff('-i', video, ...vf, '-b:v', `${kbps}k`, '-pass', '2', '-passlogfile', passlog, ...common, pr);
  mb = statSync(pr).size / 1048576;
}

// ---------------------------------------------------------------- GIF
const gif = flag('gif');
if (gif) {
  const [from, len] = gif.split(':').map(Number);
  // A palette per clip, error-diffusion dither only where pixels change:
  // smaller and cleaner than ffmpeg's default for UI.
  ff('-ss', String(from), '-t', String(len), '-i', video, '-vf',
    'fps=15,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle',
    '-loop', '0', join(outDir, `${name}.gif`));
}

// ---------------------------------------------------------------- QA
// Long stills inside clip scenes are the usual sign of a trim past the end of
// a recording; black frames, of a take that lost its paint.
const { stderr: log } = spawnSync(
  'ffmpeg',
  ['-v', 'info', '-i', video, '-vf', 'freezedetect=n=0.0015:d=2.5,blackdetect=d=0.25:pix_th=0.08', '-an', '-f', 'null', '-'],
  { encoding: 'utf8' },
);
const sceneAt = (t) => spans.find((s) => t >= s.start && t < s.end)?.scene;
const issues = [];
for (const m of log.matchAll(/freeze_start: ([\d.]+)[\s\S]*?freeze_duration: ([\d.]+)/g)) {
  const s = sceneAt(+m[1] + 0.1);
  if (s && (s.type === 'clip' || s.type === 'split')) issues.push(`still for ${(+m[2]).toFixed(1)}s from ${(+m[1]).toFixed(1)}s in a clip scene (${s.caption ?? s.src ?? ''})`);
}
for (const m of log.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)) issues.push(`black from ${(+m[1]).toFixed(1)}s to ${(+m[2]).toFixed(1)}s`);

console.log(`PR copy   ${pr} (${mb.toFixed(1)} MB${mb > maxMb ? `, still over ${maxMb} MB: shorten the cut` : ''})`);
console.log(`captions  ${join(outDir, `${name}.vtt`)} and .srt (${cues.length} cues)`);
console.log(`chapters  ${join(outDir, `${name}-chapters.txt`)}`);
console.log(`poster    ${join(outDir, `${name}-poster.png`)} (at ${posterAt.toFixed(1)}s)`);
if (gif) console.log(`gif       ${join(outDir, `${name}.gif`)}`);
console.log(issues.length ? `check     ${issues.length} to look at:\n  - ${issues.join('\n  - ')}` : 'check     no frozen or black stretches in clip scenes');
