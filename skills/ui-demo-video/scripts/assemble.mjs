#!/usr/bin/env node
// Quick path: turn a video.json (same format as the Remotion template) into
// an mp4 with ffmpeg alone. Seconds to render instead of minutes, no npm
// install. Backgrounds, frames and captions are drawn by headless Chrome, so
// they use real CSS (gradients, shadows, web fonts) with no Python or
// ffmpeg-drawtext dependency.
//
//   node assemble.mjs video.json --out demo.mp4 [--clips ./public] [--scale 1.5]
//
// Supported: title and flat clip scenes, fade and cut transitions. Issue and
// list cards become titles, images become stills, timed captions show the
// first one; split scenes and camera moves need the Remotion template.
// "zoom-blur" falls back to fade and "stage" frames fall back to flat here;
// render the Remotion template when you want those.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const specPath = argv.find((a) => !a.startsWith('--'));
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
if (!specPath) {
  console.error('Usage: assemble.mjs video.json --out demo.mp4 [--clips <dir>] [--scale 1.5] [--crf 16]');
  process.exit(1);
}

const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const out = resolve(opt('out', 'demo.mp4'));
const clipsDir = resolve(opt('clips', join(dirname(resolve(specPath)), '..', 'public')));
const scale = +opt('scale', '1.5');
const crf = opt('crf', '16');
const W = Math.round((spec.width * scale) / 2) * 2;
const H = Math.round((spec.height * scale) / 2) * 2;
const fps = spec.fps;
const work = join(tmpdir(), `ui-demo-video-${process.pid}`);
mkdirSync(work, { recursive: true });

const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'ignore', 'inherit'] });
// Headless Chrome logs harmless display warnings on stderr; keep it quiet.
const runQuiet = (cmd, args) => execFileSync(cmd, args, { stdio: 'ignore' });

// ------------------------------------------------------------ Chrome drawing

const findChrome = () => {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  const found = candidates.find((c) => c && existsSync(c));
  if (!found) throw new Error('Chrome not found. Set CHROME_PATH.');
  return found;
};
const CHROME = findChrome();

const FONT = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700&display=block">`;
const BASE_CSS = `*{margin:0;box-sizing:border-box}html,body{width:${W}px;height:${H}px;overflow:hidden;background:transparent;font-family:Inter,-apple-system,"SF Pro Text",system-ui,sans-serif;-webkit-font-smoothing:antialiased}`;

let drawn = 0;
const draw = (body, css = '') => {
  const n = drawn++;
  const html = join(work, `draw-${n}.html`);
  const png = join(work, `draw-${n}.png`);
  writeFileSync(html, `<!doctype html><html><head>${FONT}<style>${BASE_CSS}${css}</style></head><body>${body}</body></html>`);
  runQuiet(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--default-background-color=00000000', '--virtual-time-budget=4000',
    `--window-size=${W},${H}`, `--screenshot=${png}`, pathToFileURL(html).href,
  ]);
  return png;
};

// Same layout as the Remotion template: the recording sits in the top ~80%
// at its own aspect ratio, the caption gets the band underneath.
const frameBox = (aspect) => {
  const h = Math.min(H * 0.8, (W * 0.9) / aspect);
  const w = h * aspect;
  const even = (v) => Math.round(v / 2) * 2;
  return { w: even(w), h: even(h), left: even((W - w) / 2), top: even(H * 0.055) };
};

const radius = W * 0.008;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const captionHtml = (scene, top) => {
  const size = W * 0.0135;
  const tagColor = (scene.tag && spec.theme.tagColors?.[scene.tag]) || '#6ebeff';
  return `<div style="position:absolute;left:0;right:0;top:${top}px;bottom:0;display:flex;align-items:center;justify-content:center">
    <div style="display:inline-flex;align-items:center;gap:${size * 0.7}px;padding:${size * 0.55}px ${size * 1.05}px;border-radius:999px;background:rgba(17,17,20,.92);box-shadow:0 1px 0 rgba(255,255,255,.06) inset,0 8px 24px rgba(0,0,0,.18);font-size:${size}px;font-weight:500;line-height:1.2;color:#fff;white-space:nowrap">
      ${scene.tag ? `<span style="color:${tagColor};font-weight:600">${esc(scene.tag)}</span>` : ''}<span>${esc(scene.caption)}</span>
    </div></div>`;
};

// ------------------------------------------------------------ scenes

const segment = (i) => join(work, `seg-${i}.mp4`);
const encode = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '10', '-pix_fmt', 'yuv420p', '-r', String(fps)];
// Caption / title fade in after a beat and out at the end.
const fadeInOut = (d, delay = 0.25) =>
  `fade=t=in:st=${delay}:d=0.35:alpha=1,fade=t=out:st=${Math.max(0, d - 0.35)}:d=0.35:alpha=1`;

const background = draw('', `body{background:${spec.theme.background}}`);

// The quick path approximates the richer scene types; the Remotion template
// renders them properly.
const approximate = (scene, i) => {
  if (scene.type === 'split') throw new Error(`scene ${i}: split scenes need the Remotion template (scripts/new-remotion.sh)`);
  if (scene.type === 'issue') {
    console.warn(`scene ${i}: issue card drawn as a title in the quick path`);
    return { ...scene, type: 'title', text: scene.title, subtitle: [scene.id, scene.quote].filter(Boolean).join(': ') };
  }
  if (scene.type === 'list') {
    console.warn(`scene ${i}: list drawn as a title in the quick path`);
    return { ...scene, type: 'title', text: scene.title, subtitle: scene.items.join(' · ') };
  }
  if (scene.captions?.length) {
    console.warn(`scene ${i}: only the first of its timed captions shows in the quick path`);
    return { ...scene, caption: scene.captions[0].text, tag: scene.captions[0].tag ?? scene.tag };
  }
  return scene;
};

spec.scenes.map(approximate).forEach((scene, i) => {
  const d = scene.durationSec;
  if (scene.type === 'title') {
    const title = draw(
      `<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${W * 0.008}px;color:${spec.theme.foreground}">
        <div style="font-size:${W * 0.042}px;font-weight:600;letter-spacing:-0.035em">${esc(scene.text)}</div>
        ${scene.subtitle ? `<div style="font-size:${W * 0.0155}px;font-weight:500;opacity:.6">${esc(scene.subtitle)}</div>` : ''}
      </div>`,
    );
    run('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-loop', '1', '-t', String(d), '-i', background,
      '-loop', '1', '-t', String(d), '-i', title,
      '-filter_complex', `[1]format=rgba,${fadeInOut(d, 0.15)}[t];[0][t]overlay=0:0,format=yuv420p`,
      ...encode, segment(i),
    ]);
    return;
  }

  if (scene.frame === 'stage') console.warn(`scene ${i}: "stage" frame needs the Remotion template; using flat`);
  const box = frameBox(scene.aspect);
  const src = join(clipsDir, scene.src);
  if (!existsSync(src)) throw new Error(`scene ${i}: missing clip ${src}`);

  // Shadowed card under the recording, and a rounded mask for its corners.
  const card = draw(
    `<div style="position:absolute;left:${box.left}px;top:${box.top}px;width:${box.w}px;height:${box.h}px;border-radius:${radius}px;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.06),0 ${W * 0.0125}px ${W * 0.036}px rgba(0,0,0,.22)"></div>`,
    `body{background:${spec.theme.background}}`,
  );
  const mask = draw(
    `<div style="position:absolute;left:0;top:0;width:${box.w}px;height:${box.h}px;border-radius:${radius}px;background:#fff"></div>`,
    'body{background:#000}',
  );
  const caption = scene.caption ? draw(captionHtml(scene, box.top + box.h)) : null;

  const rate = scene.playbackRate ?? 1;
  const still = scene.type === 'image';
  const inputs = [
    '-loop', '1', '-t', String(d), '-i', card,
    ...(still ? ['-loop', '1', '-t', String(d), '-i', src] : ['-ss', String(scene.trimStartSec ?? 0), '-t', String(d * rate), '-i', src]),
    '-loop', '1', '-t', String(d), '-i', mask,
  ];
  let graph =
    `[1]${rate !== 1 ? `setpts=PTS/${rate},` : ''}fps=${fps},scale=${box.w}:${box.h}:flags=lanczos,format=rgba,tpad=stop_mode=clone:stop_duration=${d}[v];` +
    `[2]crop=${box.w}:${box.h}:0:0,format=gray[m];[v][m]alphamerge[rv];` +
    `[0][rv]overlay=${box.left}:${box.top}:shortest=1[base]`;
  if (caption) {
    inputs.push('-loop', '1', '-t', String(d), '-i', caption);
    graph += `;[3]format=rgba,${fadeInOut(d)}[c];[base][c]overlay=0:0,format=yuv420p`;
  } else {
    graph += ';[base]format=yuv420p';
  }
  run('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', graph, '-t', String(d), ...encode, segment(i)]);
});

// ------------------------------------------------------------ join

const gap = (i) => (spec.transitions?.[i] ?? spec.transition) === 'cut' ? 'cut' : 'fade';
const t = spec.transitionSec;
const inputs = spec.scenes.flatMap((_, i) => ['-i', segment(i)]);
const parts = [];
let label = '[0:v]';
let length = spec.scenes[0].durationSec;
spec.scenes.slice(1).forEach((scene, k) => {
  const i = k + 1;
  const next = `[j${i}]`;
  if (gap(k) === 'cut') {
    parts.push(`${label}settb=AVTB[a${i}];[${i}:v]settb=AVTB[b${i}];[a${i}][b${i}]concat=n=2:v=1:a=0${next}`);
    length += scene.durationSec;
  } else {
    parts.push(`${label}settb=AVTB[a${i}];[${i}:v]settb=AVTB[b${i}];[a${i}][b${i}]xfade=transition=fade:duration=${t}:offset=${(length - t).toFixed(3)}${next}`);
    length += scene.durationSec - t;
  }
  label = next;
});
parts.push(`${label}fade=t=in:st=0:d=0.3,fade=t=out:st=${(length - 0.4).toFixed(3)}:d=0.4,format=yuv420p[out]`);

run('ffmpeg', [
  '-y', '-loglevel', 'error', ...inputs,
  '-filter_complex', parts.join(';'), '-map', '[out]',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', crf, '-profile:v', 'high', '-pix_fmt', 'yuv420p',
  '-r', String(fps), '-movflags', '+faststart', out,
]);
rmSync(work, { recursive: true, force: true });
console.log(`saved ${out} (${W}x${H}, ${length.toFixed(1)}s)`);
