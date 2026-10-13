#!/usr/bin/env node
// Everything to hand over after a render, plus an automated check of it.
//
//   node scripts/deliver.mjs <demo.mp4> --spec <video.json> [options]
//
//   --out <dir>        where to write (default: next to the video)
//   --max-mb 10        size cap for the PR copy (GitHub: 10 MB on free plans)
//   --gif 12:6         also a GIF of 6 s starting at 12 s (keep GIFs short)
//   --poster 8.5       poster frame time (default: a third into the first "After" clip)
//   --encoder x264|vt  how to encode the PR copy (default: x264, the faster one on
//                      a busy Mac; vt = VideoToolbox, used automatically when
//                      this ffmpeg has no libx264)
//   --no-scan          skip the frozen / black scan of the master
//   --json             print one line of JSON instead of the report
//
// Writes <name>-pr.mp4, <name>.vtt, <name>.srt, <name>-chapters.txt,
// <name>-poster.png (and <name>.gif). Then scans the master for frozen or
// black stretches inside clip scenes, which usually mean a trim ran past the
// end of a recording or a take lost its frames.
//
// Speed: the PR copy, the poster, the GIF and the scan run at the same time,
// the PR copy is one encode pass (a quality target with a bitrate ceiling worked
// out from --max-mb and the duration, so it fits the first time almost always),
// and a master that already fits is copied, not re-encoded.
import { spawn } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { sceneSpans } from './spec-lib.mjs';

const T0 = Date.now();
const [input, ...rest] = process.argv.slice(2);
const flag = (n) => {
  const i = rest.indexOf(`--${n}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
if (!input || !flag('spec')) {
  console.error('usage: deliver.mjs <demo.mp4> --spec <video.json> [--out dir] [--max-mb 10] [--gif start:dur] [--poster sec] [--encoder x264|vt] [--no-scan] [--json]');
  process.exit(2);
}
const JSON_OUT = rest.includes('--json');
const video = resolve(input);
const spec = JSON.parse(readFileSync(flag('spec'), 'utf8'));
const outDir = resolve(flag('out') ?? dirname(video));
const name = basename(video).replace(/\.mp4$/, '');
const maxMb = +(flag('max-mb') ?? 10);
const MIB = 1048576;

// ffmpeg / ffprobe as promises. Resolves with the exit code and stderr so the
// caller decides; nothing is piped through anything that would hide a status.
const exec = (cmd, args) =>
  new Promise((done) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => done({ code: 127, err: e.message }));
    p.on('close', (code) => done({ code, err }));
  });
const ff = async (...a) => {
  const r = await exec('ffmpeg', ['-v', 'error', '-y', ...a]);
  if (r.code !== 0) throw new Error(`ffmpeg failed (${r.code}): ${r.err.trim().split('\n').slice(-3).join(' | ')}`);
};
const probe = async () => {
  const r = await new Promise((done) => {
    const p = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_type,codec_name,pix_fmt,width,height', '-of', 'json', video], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('close', (code) => done({ code, out }));
  });
  if (r.code !== 0) throw new Error(`cannot read ${video}`);
  return JSON.parse(r.out);
};
const timed = {};
const lap = async (label, fn) => {
  const t = Date.now();
  try {
    return await fn();
  } finally {
    timed[label] = +((Date.now() - t) / 1000).toFixed(1);
  }
};

// ---------------------------------------------------------------- timeline
// The same sums as the template's timeline.ts, in whole frames: a transition
// overlaps the two scenes it joins.
const { spans } = sceneSpans(spec);

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
const writeText = () => {
  writeFileSync(join(outDir, `${name}.vtt`), `WEBVTT\n\n${cues.map((c) => `${stamp(c.from, '.')} --> ${stamp(c.to, '.')}\n${c.text}`).join('\n\n')}\n`);
  writeFileSync(join(outDir, `${name}.srt`), `${cues.map((c, i) => `${i + 1}\n${stamp(c.from, ',')} --> ${stamp(c.to, ',')}\n${c.text}`).join('\n\n')}\n`);
  // Chapters: scenes with a `chapter`, or each title and issue card.
  const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  const chapters = spans
    .map(({ start, scene: s }) => ({ start, label: s.chapter ?? (s.type === 'title' ? s.text : s.type === 'issue' ? 'The problem' : null) }))
    .filter((c, i, all) => c.label && c.label !== all[i - 1]?.label);
  writeFileSync(join(outDir, `${name}-chapters.txt`), `${chapters.map((c) => `${mmss(c.start)} ${c.label}`).join('\n')}\n`);
};

// ---------------------------------------------------------------- poster
// The result sells the video, so prefer the first "After" clip over a
// "Before" one; a clip's middle is usually mid-action, so take a third in.
const isClip = (s) => s.scene.type === 'clip' || s.scene.type === 'split';
const posterSpan = spans.find((s) => isClip(s) && /after/i.test(s.scene.tag ?? '')) ?? spans.find(isClip);
const posterAt = +(flag('poster') ?? (posterSpan ? posterSpan.start + (posterSpan.end - posterSpan.start) / 3 : 1));

// ---------------------------------------------------------------- PR copy
// Which H.264 encoders this ffmpeg build has.
const hasX264 = await new Promise((done) => {
  const p = spawn('ffmpeg', ['-hide_banner', '-encoders'], { stdio: ['ignore', 'pipe', 'ignore'] });
  let o = '';
  p.stdout.on('data', (d) => (o += d));
  p.on('close', () => done({ x264: /libx264\b/.test(o), vt: /h264_videotoolbox/.test(o) }));
});

const makePrCopy = async (info) => {
  const duration = +info.format.duration;
  const v = info.streams.find((s) => s.codec_type === 'video');
  const audio = info.streams.find((s) => s.codec_type === 'audio');
  const pr = join(outDir, `${name}-pr.mp4`);
  const size = +info.format.size / MIB;
  // The master already fits and plays everywhere: copy it, with faststart.
  if (size <= maxMb * 0.97 && v.codec_name === 'h264' && v.pix_fmt === 'yuv420p' && v.width <= 1920 && (!audio || audio.codec_name === 'aac')) {
    await ff('-i', video, '-c', 'copy', '-movflags', '+faststart', pr);
    return { pr, mb: statSync(pr).size / MIB, mode: 'copy' };
  }
  const audioKbps = audio ? 128 : 0;
  const encoder = flag('encoder') ?? (hasX264.x264 ? 'x264' : 'vt');
  // 8388 kbit per MiB of one second; 0.92 leaves room for the container.
  let video_kbps = Math.floor((maxMb * 0.92 * 8388) / duration) - audioKbps;
  let attempt = 0;
  for (;;) {
    // Resolution follows the budget: 1080p when it is generous, smaller when
    // a long video leaves too little to keep text sharp.
    const w = video_kbps >= 1800 ? 1920 : video_kbps >= 1000 ? 1600 : 1280;
    const vf = ['-vf', `scale=${Math.min(w, v.width)}:-2:flags=lanczos`];
    const venc = encoder === 'vt'
      // VideoToolbox hits the bitrate it is given, so give it the budget.
      ? ['-c:v', 'h264_videotoolbox', '-b:v', `${video_kbps}k`, '-profile:v', 'high']
      // Quality first (crf 24), capped at the budget: easy footage stays small.
      : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-maxrate', `${video_kbps}k`, '-bufsize', `${video_kbps * 2}k`];
    await ff('-i', video, ...vf, ...venc, '-pix_fmt', 'yuv420p', '-movflags', '+faststart', ...(audio ? ['-c:a', 'aac', '-b:a', `${audioKbps}k`] : ['-an']), pr);
    const mb = statSync(pr).size / MIB;
    if (mb <= maxMb || attempt++ >= 1) return { pr, mb, mode: encoder === 'vt' ? 'videotoolbox' : 'x264', kbps: video_kbps };
    video_kbps = Math.floor(video_kbps * 0.72); // over the cap: one retry, lower
  }
};

// ---------------------------------------------------------------- GIF
const makeGif = async () => {
  const [from, len] = flag('gif').split(':').map(Number);
  // A palette per clip, error-diffusion dither only where pixels change:
  // smaller and cleaner than ffmpeg's default for UI.
  await ff('-ss', String(from), '-t', String(len), '-i', video, '-vf',
    'fps=15,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle',
    '-loop', '0', join(outDir, `${name}.gif`));
};

// ---------------------------------------------------------------- QA
// Long stills inside clip scenes are the usual sign of a trim past the end of
// a recording; black frames, of a take that lost its paint. A quarter of the
// frames at a small size is plenty to see either.
const scan = async () => {
  const r = await exec('ffmpeg', ['-v', 'info', '-i', video, '-vf',
    'fps=15,scale=480:-2:flags=fast_bilinear,freezedetect=n=0.0015:d=2.5,blackdetect=d=0.25:pix_th=0.08', '-an', '-f', 'null', '-']);
  const log = r.err;
  const sceneAt = (t) => spans.find((s) => t >= s.start && t < s.end)?.scene;
  const issues = [];
  for (const m of log.matchAll(/freeze_start: ([\d.]+)[\s\S]*?freeze_duration: ([\d.]+)/g)) {
    const s = sceneAt(+m[1] + 0.1);
    if (s && (s.type === 'clip' || s.type === 'split')) issues.push(`still for ${(+m[2]).toFixed(1)}s from ${(+m[1]).toFixed(1)}s in a clip scene (${s.caption ?? s.src ?? ''})`);
  }
  for (const m of log.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)) issues.push(`black from ${(+m[1]).toFixed(1)}s to ${(+m[2]).toFixed(1)}s`);
  return issues;
};

// ---------------------------------------------------------------- go
let result;
try {
  const info = await probe();
  const [pr, , , issues] = await Promise.all([
    lap('pr', () => makePrCopy(info)),
    lap('poster', () => ff('-ss', String(posterAt), '-i', video, '-frames:v', '1', join(outDir, `${name}-poster.png`))),
    flag('gif') ? lap('gif', makeGif) : null,
    rest.includes('--no-scan') ? [] : lap('scan', scan),
    lap('text', async () => writeText()),
  ]);
  result = {
    ok: true,
    pr: pr.pr, prMb: +pr.mb.toFixed(2), prMode: pr.mode, overCap: pr.mb > maxMb, maxMb,
    vtt: join(outDir, `${name}.vtt`), srt: join(outDir, `${name}.srt`), cues: cues.length,
    chapters: join(outDir, `${name}-chapters.txt`),
    poster: join(outDir, `${name}-poster.png`), posterAt: +posterAt.toFixed(1),
    gif: flag('gif') ? join(outDir, `${name}.gif`) : null,
    issues: issues ?? [], taskSec: timed, wallSec: +((Date.now() - T0) / 1000).toFixed(1),
  };
} catch (e) {
  if (JSON_OUT) console.log(JSON.stringify({ ok: false, error: e.message, wallSec: +((Date.now() - T0) / 1000).toFixed(1) }));
  else console.error(`FAILED: ${e.message}`);
  process.exit(1);
}

if (JSON_OUT) console.log(JSON.stringify(result));
else {
  console.log(`PR copy   ${result.pr} (${result.prMb.toFixed(1)} MB, ${result.prMode}${result.overCap ? `, still over ${maxMb} MB: shorten the cut` : ''})`);
  console.log(`captions  ${result.vtt} and .srt (${result.cues} cues)`);
  console.log(`chapters  ${result.chapters}`);
  console.log(`poster    ${result.poster} (at ${result.posterAt.toFixed(1)}s)`);
  if (result.gif) console.log(`gif       ${result.gif}`);
  console.log(result.issues.length ? `check     ${result.issues.length} to look at:\n  - ${result.issues.join('\n  - ')}` : 'check     no frozen or black stretches in clip scenes');
  console.log(`done      ${result.wallSec}s (${Object.entries(timed).map(([k, v]) => `${k} ${v}s`).join(', ')})`);
}
