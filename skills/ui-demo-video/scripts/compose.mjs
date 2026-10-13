#!/usr/bin/env node
// The fast renderer: composites a whole video.json into a finished MP4 on the
// GPU, inside a headless Chrome nobody sees, at 100+ frames per second.
//
//   node scripts/compose.mjs <video.json> --out <demo.mp4> [options]
//
//   --clips <dir>        folder the `src` paths are relative to (default: next to video.json)
//   --sheet <png>        also write a contact sheet of the finished video (about 12 frames, labelled)
//   --still <sec>        write one full-size frame at that time (with --still-out <png>)
//   --bitrate 24M        target H.264 bitrate (default 24M; the encoder is variable-rate)
//   --software           encode in software (slower; also what happens when no GPU encoder exists)
//   --proxy              transcode every clip to a compositor-friendly proxy first (testing)
//   --json               print one line of JSON instead of the human summary
//
// How it works. Text, cards, captions and window shadows are real HTML/CSS:
// Chrome lays each one out and captures it over the DevTools protocol into a
// transparent PNG (once per distinct piece). Then one WebGL2 page decodes the
// recordings with WebCodecs, moves and blurs those pieces and the recordings
// on the GPU exactly as the Remotion template would, and encodes the result
// with the hardware H.264 encoder. Node only serves files, captures the HTML
// pieces, and muxes the encoded chunks (plus audio) with ffmpeg.
// The look follows template/src (scenes.tsx and friends); compositor/ has the
// pieces: timeline.js, motion.js, plan.js, scenes.js, gl.js, decode.js, main.js.
//
// No npm dependencies: Node 22+, Chrome, ffmpeg and ffprobe.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jobsFor, baseCss } from './compositor/plan.js';
import { NATURAL_SEC, TRANSITIONS, resolveGap, sceneSpans, totalFrames } from './compositor/timeline.js';

const T0 = Date.now();
const here = path.dirname(fileURLToPath(import.meta.url));
const HOME_CACHE = path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'ui-demo-video');
const SOFT_GL = !!process.env.COMPOSE_SOFTGL;

// ------------------------------------------------------------ arguments
const argv = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) { positional.push(a); continue; }
  const k = a.slice(2);
  if (['software', 'json', 'proxy', 'verbose'].includes(k)) flags[k] = true;
  else flags[k] = argv[++i];
}
const JSON_OUT = !!flags.json;
const say = (...a) => (JSON_OUT ? console.error(...a) : console.log(...a));
const note = (...a) => console.error(...a);
const warnings = [];
const warn = (msg) => { warnings.push(msg); note(`warning: ${msg}`); };
class Failed extends Error {}
const fail = (msg) => { throw new Failed(msg); };

if (!positional[0] || (!flags.out && flags.still === undefined) || flags.help) {
  console.error('usage: compose.mjs <video.json> --out <file.mp4> [--clips dir] [--sheet png] [--still sec --still-out png] [--bitrate 24M] [--software] [--json]');
  process.exit(2);
}
const parseBitrate = (s = '24M') => {
  const m = /^(\d+(?:\.\d+)?)([kKmM]?)$/.exec(String(s));
  if (!m) fail(`bad --bitrate "${s}" (try 24M)`);
  return Math.round(+m[1] * ({ k: 1e3, m: 1e6 }[m[2].toLowerCase()] ?? 1));
};

// ------------------------------------------------------------ cleanup
// Whatever happens, Chrome and the server stop, by PID.
const cleanups = [];
let cleaned = false;
const cleanupSync = () => {
  if (cleaned) return;
  cleaned = true;
  for (const fn of cleanups.splice(0).reverse()) { try { fn(); } catch {} }
};
process.on('exit', cleanupSync);
const bail = (e) => {
  const msg = e instanceof Failed ? e.message : `${e?.stack || e}`;
  cleanupSync();
  if (JSON_OUT) console.log(JSON.stringify({ ok: false, error: msg, warnings }));
  console.error(`FAILED: ${msg}`);
  process.exit(1);
};
process.on('uncaughtException', bail);
process.on('unhandledRejection', bail);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { cleanupSync(); process.exit(130); });

// ------------------------------------------------------------ tools
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
  const fixed = candidates.find((c) => c && fs.existsSync(c));
  if (fixed) return fixed;
  // Same discovery as chrome.sh: then look on PATH.
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const r = spawnSync('which', [name], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  }
  return undefined;
};
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28, timeout: 15 * 60_000, ...opts });
  if (r.error?.code === 'ETIMEDOUT') fail(`${cmd} took longer than 15 minutes; giving up`);
  if (r.error) fail(`${cmd} could not start: ${r.error.message}`);
  if (r.status !== 0) fail(`${cmd} failed: ${(r.stderr || '').trim().split('\n').slice(-4).join(' | ')}`);
  return r.stdout;
};
const runAsync = (cmd, args) => new Promise((resolve, reject) => {
  const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const timer = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, 15 * 60_000);
  p.on('close', () => clearTimeout(timer));
  let err = '';
  p.stderr.on('data', (d) => (err += d));
  p.on('error', reject);
  p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} failed: ${err.trim().split('\n').slice(-3).join(' | ')}`))));
});

// ------------------------------------------------------------ the spec
const specPath = path.resolve(positional[0]);
if (!fs.existsSync(specPath)) fail(`video.json not found: ${specPath}`);
let spec;
try { spec = JSON.parse(fs.readFileSync(specPath, 'utf8')); } catch (e) { fail(`video.json is not valid JSON: ${e.message}`); }
const clipsDir = path.resolve(flags.clips ?? path.dirname(specPath));
spec.width ??= 1920; spec.height ??= 1080; spec.fps ??= 60;
spec.theme ??= {};
spec.theme.background ??= '#ffffff'; spec.theme.foreground ??= '#111114';
spec.transition ??= 'zoom-blur'; spec.transitionSec ??= 0.45;
if (!Array.isArray(spec.scenes) || !spec.scenes.length) fail('video.json has no scenes');
const KNOWN = ['clip', 'image', 'split', 'title', 'issue', 'list'];
spec.scenes.forEach((s, i) => { if (!KNOWN.includes(s.type)) fail(`scene ${i}: unknown scene type "${s.type}" (expected one of ${KNOWN.join(', ')})`); });
// Optional text that is absent or empty draws nothing: drop empty list items and empty timed captions up front.
const filled = (v) => v !== undefined && v !== null && String(v) !== '';
for (const sc of spec.scenes) {
  if (sc.type === 'list') sc.items = (sc.items ?? []).filter(filled);
  if (sc.type === 'clip' && sc.captions) sc.captions = sc.captions.filter((c) => filled(c?.text));
}
const checkTransition = (t, where) => { const type = typeof t === 'string' ? t : t?.type; if (!TRANSITIONS.includes(type)) fail(`${where}: unknown transition "${type}" (expected one of ${TRANSITIONS.join(', ')})`); };
checkTransition(spec.transition, 'transition');
(spec.transitions ?? []).forEach((t, i) => t && checkTransition(t, `transitions[${i}]`));

const W = spec.width, H = spec.height, FPS = spec.fps;
const N = totalFrames(spec, FPS);
if (!(N > 0)) fail('the scenes add up to zero frames (check durationSec on every scene)');
const DURATION = N / FPS;
const spans = sceneSpans(spec, FPS);
spec.scenes.forEach((s, i) => {
  if (i < spec.scenes.length - 1 && resolveGap(spec, i).sec * FPS > Math.min(s.durationSec, spec.scenes[i + 1].durationSec) * FPS)
    warn(`scene ${i}/${i + 1}: the transition is longer than a scene it joins`);
});

// ------------------------------------------------------------ media
const mediaFiles = []; // index -> absolute path, served as /media/<index>
const mediaIndex = new Map();
const mediaUrl = (abs) => {
  if (!mediaIndex.has(abs)) { mediaIndex.set(abs, mediaFiles.length); mediaFiles.push(abs); }
  return `/media/${mediaIndex.get(abs)}`;
};
const resolveSrc = (src, where) => {
  for (const base of [clipsDir, path.dirname(specPath), process.cwd()]) {
    const p = path.resolve(base, src);
    if (fs.existsSync(p)) return p;
  }
  return fail(`${where}: file not found: ${path.resolve(clipsDir, src)}`);
};

// What each scene plays: [where, src, trimStartSec, rate, seconds of source needed]
const videoUses = [];
const imageSrcs = new Set();
spec.scenes.forEach((s, i) => {
  if (s.type === 'clip') videoUses.push({ where: `scene ${i} (clip)`, src: s.src, trim: s.trimStartSec ?? 0, need: (s.trimStartSec ?? 0) + s.durationSec * (s.playbackRate ?? 1), scene: s });
  if (s.type === 'split') for (const k of ['before', 'after']) videoUses.push({ where: `scene ${i} (split ${k})`, src: s[k].src, trim: s[k].trimStartSec ?? 0, need: (s[k].trimStartSec ?? 0) + s.durationSec, scene: s[k], split: s });
  if (s.type === 'image') imageSrcs.add(s.src);
  if (s.type === 'clip' && s.frame === 'stage')
    warn(`scene ${i}: frame "stage" (tilted 3D) is not supported by this renderer; drawn as a flat window. Use scripts/render.sh (Remotion) for the tilted look.`);
});
for (const u of videoUses) { if (!u.src) fail(`${u.where}: no "src"`); u.abs = resolveSrc(u.src, u.where); }
spec.scenes.forEach((s, i) => { if (s.type === 'image') { if (!s.src) fail(`scene ${i} (image): no "src"`); resolveSrc(s.src, `scene ${i} (image)`); } });
if (spec.theme.logo) resolveSrc(spec.theme.logo.src, 'theme.logo');

// ------------------------------------------------------------ probing
const readMoov = (file) => {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size, head = Buffer.alloc(16);
    let pos = 0;
    while (pos + 8 <= size) {
      fs.readSync(fd, head, 0, 16, pos);
      let len = head.readUInt32BE(0);
      const type = head.toString('latin1', 4, 8);
      if (len === 1) len = Number(head.readBigUInt64BE(8));
      if (len === 0) len = size - pos;
      if (type === 'moov') { const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, pos); return b; }
      if (len < 8) break;
      pos += len;
    }
  } finally { fs.closeSync(fd); }
  return null;
};

const probeClip = (file) => {
  const j = JSON.parse(run('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'packet=pts_time,dts_time,pos,size,flags:stream=codec_name,profile,width,height,pix_fmt,r_frame_rate,avg_frame_rate,duration,nb_frames',
    '-of', 'json', file]));
  const st = j.streams?.[0];
  if (!st) fail(`${file} has no video stream`);
  const pk = (j.packets ?? []).map((p) => ({ pts: Math.round(+p.pts_time * 1e6), dts: Math.round(+p.dts_time * 1e6), pos: +p.pos, size: +p.size, key: String(p.flags).includes('K') }));
  const info = { file, codec: st.codec_name, profile: st.profile, width: st.width, height: st.height, pixFmt: st.pix_fmt, packets: pk };
  const [a, b] = String(st.avg_frame_rate).split('/').map(Number);
  info.fps = b ? a / b : +st.r_frame_rate;
  info.reasons = [];
  if (st.codec_name !== 'h264') info.reasons.push(`codec ${st.codec_name} is not H.264`);
  if (!['yuv420p', 'yuvj420p'].includes(st.pix_fmt)) info.reasons.push(`pixel format ${st.pix_fmt}`);
  if (!pk.length || pk.some((p) => !Number.isFinite(p.pos) || !Number.isFinite(p.pts))) info.reasons.push('packet table unreadable');
  if (pk.length) {
    let minPts = Infinity;
    for (const p of pk) if (p.pts < minPts) minPts = p.pts;
    pk.forEach((p) => (p.pts -= minPts));
    const sorted = pk.map((p) => p.pts).sort((x, y) => x - y);
    const d = sorted.slice(1).map((v, i) => v - sorted[i]).filter((v) => v > 0).sort((x, y) => x - y);
    const med = d[Math.floor(d.length / 2)] || 1;
    info.durationSec = (sorted[sorted.length - 1] + med) / 1e6;
    if (d.length > 3 && (d[d.length - 1] > med * 1.6 || d[0] < med * 0.6)) info.reasons.push('variable frame rate');
    info.hasB = pk.some((p, i) => i > 0 && p.pts < pk[i - 1].pts);
    info.key = pk.filter((p) => p.key).length;
  }
  if (!info.reasons.length) {
    const moov = readMoov(file);
    const i = moov ? moov.indexOf('avcC') : -1;
    if (i < 4) info.reasons.push('no avcC description');
    else {
      const size = moov.readUInt32BE(i - 4), avcC = moov.subarray(i + 4, i - 4 + size);
      info.codecString = 'avc1.' + [...avcC.subarray(1, 4)].map((x) => x.toString(16).padStart(2, '0')).join('');
      info.avcC = avcC.toString('base64');
    }
  }
  return info;
};


const usedProxies = new Set(), proxyDirs = new Set();
const proxyFor = async (file, info) => {
  const dir = path.join(path.dirname(path.resolve(flags.out ?? flags['still-out'] ?? '.')), '.compose-cache');
  fs.mkdirSync(dir, { recursive: true });
  proxyDirs.add(dir);
  const st = fs.statSync(file);
  const out = path.join(dir, `${path.basename(file).replace(/\.[^.]+$/, '')}-${st.size}-${Math.round(st.mtimeMs)}-proxy.mp4`);
  if (!fs.existsSync(out)) {
    note(`transcoding ${path.basename(file)} to a compositor-friendly proxy (${info.reasons.join(', ') || 'forced'})`);
    const scale = info.width > 3840 ? ['-vf', 'scale=3840:-2'] : ['-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2'];
    const tmp = out + '.part.mp4';
    await runAsync('ffmpeg', ['-y', '-v', 'error', '-i', file, '-an', ...scale, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-bf', '0', '-g', '30', '-pix_fmt', 'yuv420p',
      '-r', String(FPS), '-fps_mode', 'cfr', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-movflags', '+faststart', tmp]);
    fs.renameSync(tmp, out);
  }
  usedProxies.add(out);
  return out;
};

const clips = new Map(); // src -> { info, abs }
const tProbe = Date.now();
{
  const uniq = [...new Map(videoUses.map((u) => [u.src, u])).values()];
  for (const u of uniq) {
    let info = probeClip(u.abs), abs = u.abs;
    if (flags.proxy || info.reasons.length) {
      if (info.reasons.length) warn(`${u.src}: ${info.reasons.join(', ')}; using a transcoded proxy`);
      const reasons = info.reasons;
      abs = await proxyFor(u.abs, info);
      info = probeClip(abs);
      if (info.reasons.length) fail(`${u.src}: the transcoded proxy is unreadable too (${info.reasons.join(', ')})`);
      info.proxyOf = u.abs; info.proxyReasons = reasons;
    }
    clips.set(u.src, { info, abs, original: u.abs });
  }
}
for (const u of videoUses) {
  const c = clips.get(u.src);
  if (c.info.durationSec && u.need > c.info.durationSec + 0.05)
    warn(`${u.where}: the recording is ${c.info.durationSec.toFixed(2)} s but the scene needs ${u.need.toFixed(2)} s; the last frame is held`);
}
// Fill in aspect when the spec leaves it out.
spec.scenes.forEach((s, i) => {
  if (s.type === 'clip' && !s.aspect) { const c = clips.get(s.src).info; s.aspect = c.width / c.height; }
  if (s.type === 'split' && !s.aspect) { const c = clips.get(s.before.src).info; s.aspect = c.width / c.height; }
  if (s.type === 'image' && !s.aspect) s.aspect = 16 / 9;
});

// ------------------------------------------------------------ fonts
// Inter, fetched once from Google Fonts and kept on disk, so renders work
// offline afterwards. If it cannot be had, Chrome falls back to a system font.
const fontsDir = path.join(HOME_CACHE, 'fonts');
const ensureFonts = async () => {
  const css = path.join(fontsDir, 'inter.css');
  if (fs.existsSync(css)) return true;
  try {
    fs.mkdirSync(fontsDir, { recursive: true });
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
    const res = await fetch('https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700&display=block', { headers: { 'user-agent': ua }, signal: AbortSignal.timeout(6000) });
    let text = await res.text();
    if (!res.ok || !text.includes('@font-face')) throw new Error(`HTTP ${res.status}`);
    // keep the latin subset only (what the Remotion template loads)
    const blocks = text.split('/* ').slice(1).filter((b) => b.startsWith('latin */')).map((b) => b.slice(b.indexOf('@font-face')));
    text = blocks.join('\n');
    const urls = [...new Set([...text.matchAll(/url\((https:[^)]+)\)/g)].map((m) => m[1]))];
    await Promise.all(urls.map(async (u, i) => {
      const f = `inter-${i}.woff2`;
      fs.writeFileSync(path.join(fontsDir, f), Buffer.from(await (await fetch(u, { signal: AbortSignal.timeout(10000) })).arrayBuffer()));
      text = text.split(u).join(`/fonts/${f}`);
    }));
    fs.writeFileSync(css, text);
    return true;
  } catch (e) {
    warn(`Inter could not be downloaded (${e.message}); text uses a system font instead`);
    return false;
  }
};

// ------------------------------------------------------------ server
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-'));
cleanups.push(() => fs.rmSync(workDir, { recursive: true, force: true }));
const stillFiles = []; // captured pieces, served as /still/<n>.png
let resolveManifest, manifestReady;
let resolveDone, rejectDone, done;
// One render attempt = one manifest and one "done" message from the page.
const newAttempt = () => {
  manifestReady = new Promise((r) => (resolveManifest = r));
  done = new Promise((res, rej) => { resolveDone = res; rejectDone = rej; });
  done.catch(() => {});
};
newAttempt();
const h264Path = path.join(workDir, 'video.h264');
let h264 = null, chunkSeq = 0, chunkBytes = 0, seqErrors = 0, lastProgress = Date.now(), progressFrame = 0;
let stillOutPath = null, stillsHtml = '';
const sheetFiles = new Map();
const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.json': 'application/json' };
const sendFile = (res, file) => {
  const st = fs.statSync(file);
  res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'content-length': st.size, 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
};
const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x');
    if (req.method === 'GET') {
      let m;
      if (u.pathname === '/stills.html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(stillsHtml); }
      if (u.pathname === '/' || u.pathname === '/index.html') return sendFile(res, path.join(here, 'compositor', 'index.html'));
      if ((m = u.pathname.match(/^\/compositor\/([\w.-]+\.js)$/)) && fs.existsSync(path.join(here, 'compositor', m[1]))) return sendFile(res, path.join(here, 'compositor', m[1]));
      if (u.pathname === '/manifest.json') { const mf = await manifestReady; res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(mf)); }
      if ((m = u.pathname.match(/^\/still\/(\d+)\.png$/)) && stillFiles[+m[1]]) { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(stillFiles[+m[1]]); }
      if ((m = u.pathname.match(/^\/media\/(\d+)$/)) && mediaFiles[+m[1]]) return sendFile(res, mediaFiles[+m[1]]);
      if ((m = u.pathname.match(/^\/fonts\/([\w.-]+)$/)) && fs.existsSync(path.join(fontsDir, m[1]))) return sendFile(res, path.join(fontsDir, m[1]));
      if ((m = u.pathname.match(/^\/sheet\/([\w.-]+)$/)) && sheetFiles.has(m[1])) return sendFile(res, sheetFiles.get(m[1]));
      res.writeHead(404); return res.end();
    }
    const chunks = [];
    for await (const d of req) chunks.push(d);
    const body = Buffer.concat(chunks);
    if (u.pathname === '/chunks') {
      h264 ??= fs.createWriteStream(h264Path);
      if (+req.headers['x-seq'] !== chunkSeq) { seqErrors++; rejectDone(new Failed(`encoded chunk ${req.headers['x-seq']} arrived where ${chunkSeq} was expected`)); }
      chunkSeq = +req.headers['x-seq'] + 1; chunkBytes += body.length;
      h264.write(body);
    } else if (u.pathname === '/chunks-end') { if (h264) await new Promise((r) => h264.end(r)); }
    else if (u.pathname === '/log') note('[page]', body.toString());
    else if (u.pathname === '/progress') { lastProgress = Date.now(); progressFrame = +body.toString(); if (!JSON_OUT && process.stderr.isTTY) process.stderr.write(`\r  ${progressFrame}/${N} frames `); }
    else if (u.pathname === '/still-out') fs.writeFileSync(stillOutPath, body);
    else if (u.pathname === '/done') resolveDone(JSON.parse(body.toString()));
    res.writeHead(200); res.end('ok');
  } catch (e) { try { res.writeHead(500); res.end(String(e)); } catch {} }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
cleanups.push(() => server.close());
const origin = `http://127.0.0.1:${server.address().port}`;

// ------------------------------------------------------------ chrome
const CHROME = findChrome();
if (!CHROME) fail('Chrome not found. Install Google Chrome or set CHROME_PATH.');
const tLaunch = Date.now();
// One persistent profile (keeps Chrome's own caches warm). If another render is
// already using it, this one gets a throwaway profile instead of fighting over the lock.
const profileMain = path.join(HOME_CACHE, 'compose-profile');
const lockFile = profileMain + '.lock';
let profile = profileMain, lockOwned = false;
{
  fs.mkdirSync(HOME_CACHE, { recursive: true });
  let busy = false;
  if (fs.existsSync(lockFile)) {
    const pid = +fs.readFileSync(lockFile, 'utf8');
    try { process.kill(pid, 0); busy = pid !== process.pid; } catch {}
  }
  if (busy) { profile = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-profile-')); cleanups.push(() => fs.rmSync(profile, { recursive: true, force: true })); }
  else { fs.writeFileSync(lockFile, String(process.pid)); lockOwned = true; cleanups.push(() => fs.rmSync(lockFile, { force: true })); }
  fs.mkdirSync(profile, { recursive: true });
  fs.rmSync(path.join(profile, 'DevToolsActivePort'), { force: true });
}
const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--mute-audio', '--hide-scrollbars', '--force-device-scale-factor=1',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  '--disable-features=Translate,MediaRouter', `--window-size=${W},${H}`,
  ...(SOFT_GL ? ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : []), 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let chromeErr = '';
chrome.stderr.on('data', (d) => { chromeErr = (chromeErr + d).slice(-4000); });
let chromeExited = false, closing = false;
// If Chrome dies at any point the run fails at once; nothing waits on a dead browser.
chrome.on('exit', (code, sig) => {
  chromeExited = true;
  if (!closing) bail(new Failed(`Chrome exited unexpectedly (${sig ?? 'code ' + code})${chromeErr.trim() ? ': ' + chromeErr.trim().split('\n').slice(-2).join(' | ') : ''}`));
});
cleanups.push(() => { if (!chromeExited) { try { chrome.kill('SIGKILL'); } catch {} } });

const wsUrl = await (async () => {
  const f = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 200; i++) {
    if (chromeExited) fail('Chrome did not start: ' + chromeErr.trim().split('\n').slice(-2).join(' | '));
    if (fs.existsSync(f)) { const [port, p] = fs.readFileSync(f, 'utf8').trim().split('\n'); if (port && p) return `ws://127.0.0.1:${port}${p}`; }
    await new Promise((r) => setTimeout(r, 50));
  }
  return fail('Chrome did not open its debugging port');
})();

// A small DevTools client: one browser connection, pages as flat sessions.
let msgId = 0;
const pendingCalls = new Map();
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Failed('could not connect to Chrome')); setTimeout(() => rej(new Failed('Chrome did not accept the debugging connection within 15 s')), 15000); });
ws.onclose = () => {
  for (const { rej } of pendingCalls.values()) rej(new Failed('Chrome closed the debugging connection'));
  pendingCalls.clear();
  if (!closing) bail(new Failed('Chrome closed the debugging connection'));
};

const pageLogs = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pendingCalls.has(d.id)) { const { res, rej } = pendingCalls.get(d.id); pendingCalls.delete(d.id); d.error ? rej(new Error(`${d.error.message}`)) : res(d.result); }
  else if (d.method === 'Runtime.exceptionThrown') { const t = d.params.exceptionDetails; pageLogs.push(t.exception?.description || t.text); note('[page exception]', (t.exception?.description || t.text || '').slice(0, 500)); }
  else if (d.method === 'Runtime.consoleAPICalled' && flags.verbose) note('[console]', d.params.args.map((a) => a.value ?? a.description).join(' '));
};
const send = (method, params = {}, sessionId, timeoutMs = 60_000) => new Promise((res, rej) => {
  const id = ++msgId;
  const timer = setTimeout(() => { pendingCalls.delete(id); rej(new Failed(`Chrome did not answer ${method} within ${timeoutMs / 1000} s`)); }, timeoutMs);
  pendingCalls.set(id, { res: (v) => { clearTimeout(timer); res(v); }, rej: (e) => { clearTimeout(timer); rej(e); } });
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});
const openPage = async (url) => {
  const { targetId } = await send('Target.createTarget', { url });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);
  return { targetId, sessionId, call: (m, p) => send(m, p, sessionId) };
};
cleanups.push(() => { try { ws.close(); } catch {} });
const tLaunched = Date.now();

// The compositor page loads now and waits for its manifest while the stills are captured.
const compositor = await openPage(`${origin}/index.html`);

// ------------------------------------------------------------ stills
// Each job is a page of real HTML; each shot captures one element (with a
// margin for shadows and blur) as a transparent PNG.
const hasFonts = await ensureFonts();
const stills = {};
const tStills = Date.now();
const captureJobs = async (jobs) => {
  const shotCss = (s) =>
    `body *{visibility:hidden!important}` +
    `${s.show.map((x) => `${x},${x} *`).join(',')}{visibility:visible!important}` +
    (s.hide.length ? `${s.hide.map((x) => `${x}:not(#z),${x}:not(#z) *`).join(',')}{visibility:hidden!important}` : '');
  // Several tabs capture in parallel; each takes jobs off the same queue.
  const queue = [...jobs];
  const worker = async () => {
    const page = await openPage('about:blank');
    await page.call('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    await page.call('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    await page.call('Page.navigate', { url: `${origin}/stills.html` });
    for (let j; (j = queue.shift());) {
      const ok = await page.call('Runtime.evaluate', {
        awaitPromise: true, returnByValue: true,
        expression: `(async()=>{document.getElementById('jobcss').textContent=${JSON.stringify(j.css)};document.getElementById('root').innerHTML=${JSON.stringify(j.body)};document.body.offsetHeight;
          await document.fonts.ready; await Promise.all([...document.images].map(i=>i.decode().catch(()=>{})));
          await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); return true})()`,
      });
      if (ok.exceptionDetails) fail(`could not lay out "${j.id}": ${ok.exceptionDetails.exception?.description ?? ok.exceptionDetails.text}`);
      for (const s of j.shots) {
        const r = await page.call('Runtime.evaluate', {
          returnByValue: true,
          expression: `(()=>{document.getElementById('shotcss').textContent=${JSON.stringify(shotCss(s))};const e=document.querySelector(${JSON.stringify(s.rect)});if(!e)return null;const r=e.getBoundingClientRect();return {l:r.left,t:r.top,r:r.right,b:r.bottom}})()`,
        });
        const b = r.result.value;
        if (!b) fail(`captured piece "${s.id}" is missing from its page`);
        const pad = s.pad ?? 0;
        const x0 = s.full ? 0 : Math.max(0, Math.floor(b.l - pad)), y0 = s.full ? 0 : Math.max(0, Math.floor(b.t - pad));
        const x1 = s.full ? W : Math.min(W, Math.ceil(b.r + pad)), y1 = s.full ? H : Math.min(H, Math.ceil(b.b + pad));
        if (x1 <= x0 || y1 <= y0) fail(`captured piece "${s.id}" is off screen`);
        const shot = await page.call('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true, fromSurface: true, clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0, scale: 1 } });
        stillFiles.push(Buffer.from(shot.data, 'base64'));
        if (flags['dump-stills']) { fs.mkdirSync(flags['dump-stills'], { recursive: true }); fs.writeFileSync(path.join(flags['dump-stills'], `${stillFiles.length - 1}.png`), stillFiles[stillFiles.length - 1]); fs.appendFileSync(path.join(flags['dump-stills'], 'index.txt'), `${stillFiles.length - 1} ${s.id}\n`); }
        stills[s.id] = { file: `/still/${stillFiles.length - 1}.png`, x: x0, y: y0, w: x1 - x0, h: y1 - y0, bx: b.l, by: b.t, bw: b.r - b.l, bh: b.b - b.t };
      }
    }
    await send('Target.closeTarget', { targetId: page.targetId }).catch(() => {});
  };
  await Promise.all(Array.from({ length: Math.min(3, jobs.length) }, worker));
};
// The page the stills are laid out on (fonts from the local cache).
stillsHtml = `<!doctype html><meta charset="utf-8"><style>${baseCss(W, H)}</style>${hasFonts ? '<link rel="stylesheet" href="/fonts/inter.css">' : ''}<style id="jobcss"></style><style id="shotcss"></style><body><div id="root"></div></body>`;
// Logo files are served through /media like the recordings.
const jobs = jobsFor(spec, (src) => mediaUrl(resolveSrc(src, 'theme.logo')));
await captureJobs(jobs);
const tStillsDone = Date.now();

// ------------------------------------------------------------ the render
const bitrate = parseBitrate(flags.bitrate);
const stillMode = flags.still !== undefined && !flags.out;
if (flags.still !== undefined && !flags['still-out']) fail('--still needs --still-out <png>');
if (stillMode) stillOutPath = path.resolve(flags['still-out']);
const stillFrame = Math.min(N - 1, Math.max(0, Math.round(+flags.still * FPS)));

const buildManifest = () => ({
  W, H, fps: FPS, frames: N, spec, bitrate, software: !!flags.software, mode: stillMode ? 'still' : 'video', stillFrame,
  stills,
  clips: Object.fromEntries([...clips].map(([src, c]) => [src, {
    url: mediaUrl(c.abs),
    meta: { width: c.info.width, height: c.info.height, codec: c.info.codecString, avcC: c.info.avcC, hasB: c.info.hasB, packets: c.info.packets.map(({ pts, pos, size, key }) => ({ pts, pos, size, key })) },
  }])),
  images: Object.fromEntries([...imageSrcs].map((s) => [s, mediaUrl(resolveSrc(s, 'image'))])),
});

let tRender = Date.now(), result, attempt = 0, page = compositor;
for (;;) {
  lastProgress = Date.now();
  resolveManifest(buildManifest());
  const watchdog = setInterval(() => { if (Date.now() - lastProgress > 90_000) rejectDone(new Failed('the render stopped making progress for 90 s')); }, 5000);
  cleanups.push(() => clearInterval(watchdog));
  result = await done;
  clearInterval(watchdog);
  if (result.ok) break;
  // No WebGL2 or no H.264 encoder: try once with Chrome's software GL, then give up with a pointer to Remotion.
  if (/WebGL2|cannot encode H\.264/i.test(result.fatal)) {
    if (!SOFT_GL) {
      note(`warning: ${result.fatal}; retrying with Chrome's software GL`);
      cleanupSync();
      const r = spawnSync(process.execPath, process.argv.slice(1), { stdio: 'inherit', env: { ...process.env, COMPOSE_SOFTGL: '1' } });
      process.exit(r.status ?? 1);
    }
    fail(`this Chrome cannot run the GPU renderer (${/WebGL2/i.test(result.fatal) ? 'WebGL2 is missing even with software GL' : 'H.264 encoding is missing'}); use the Remotion renderer instead (scripts/new-remotion.sh, see references/remotion-remocn.md)`);
  }
  // A recording the decoder cannot read: transcode it to a clean proxy and try once more.
  const bad = [...clips.keys()].find((src) => result.fatal.includes(` ${src}`) && /decode|decoder/i.test(result.fatal));
  if (!bad || attempt++ > 0 || clips.get(bad).info.proxyOf) fail(`render failed in the page: ${result.fatal}${flags.verbose && result.stack ? '\n' + result.stack : ''}`);
  const c = clips.get(bad);
  warn(`${bad}: the decoder could not read it (${result.fatal.replace(/^.*?: /, '')}); using a transcoded proxy`);
  const abs = await proxyFor(c.original, { reasons: ['decode error'], width: c.info.width });
  const info = probeClip(abs);
  if (info.reasons.length) fail(`${bad}: the transcoded proxy is unreadable too (${info.reasons.join(', ')})`);
  info.proxyOf = c.original;
  clips.set(bad, { info, abs, original: c.original });
  await send('Target.closeTarget', { targetId: page.targetId }).catch(() => {});
  newAttempt(); h264?.destroy(); h264 = null; chunkSeq = 0; chunkBytes = 0; fs.rmSync(h264Path, { force: true });
  page = await openPage(`${origin}/index.html`);
  tRender = Date.now();
}
const tRendered = Date.now();
for (const w of result.warnings ?? []) warn(w);
if (result.decodeFallbacks?.length) warn(`hardware decode failed for ${[...new Set(result.decodeFallbacks)].join(', ')}; software decode took over`);

// ------------------------------------------------------------ mux (+ audio)
let outPath = null, muxMs = 0;
if (!stillMode) {
  outPath = path.resolve(flags.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const tMux = Date.now();
  const partPath = `${outPath}.part-${process.pid}.mp4`;
  cleanups.push(() => fs.rmSync(partPath, { force: true }));
  const inputs = ['-r', String(FPS), '-f', 'h264', '-i', h264Path];
  const filter = [];
  const audioLabels = [];
  let ai = 1;
  const music = spec.music;
  const vos = spec.scenes.flatMap((s, i) => (s.voiceover ? [{ vo: s.voiceover, i }] : []));
  if (music || vos.length) {
    const dip = Math.round(0.3 * FPS);
    const windows = vos.map(({ vo, i }) => ({ a: (spans[i].start + Math.round((vo.delaySec ?? 0) * FPS) - dip) / FPS, b: (spans[i].end + dip) / FPS }));
    if (music) {
      inputs.push('-stream_loop', '-1', '-i', resolveSrc(music.src, 'music'));
      const fi = music.fadeInSec ?? 1, fo = music.fadeOutSec ?? 2, vol = music.volume ?? 0.16, duck = music.duck ?? 0.35;
      // fade in/out as a straight line each; ducking ramps over 40 ms either side of the voiced windows
      const ramp = (t0, t1) => `clip((t-${t0.toFixed(3)})/0.04,0,1)*clip((${t1.toFixed(3)}-t)/0.04,0,1)`;
      const voiced = windows.length ? `min(1,${windows.map((w) => ramp(w.a, w.b)).join('+')})` : '0';
      const fade = `clip(min(${fi > 0 ? `t/${fi}` : '1'},${fo > 0 ? `(${DURATION.toFixed(3)}-t)/${fo}` : '1'}),0,1)`;
      const expr = `${vol}*${fade}*(1-(1-${duck})*${voiced})`;
      filter.push(`[${ai}:a]aresample=48000,aformat=channel_layouts=stereo,volume='${expr}':eval=frame[a${ai}]`);
      audioLabels.push(`[a${ai}]`); ai++;
    }
    for (const { vo, i } of vos) {
      inputs.push('-i', resolveSrc(vo.src, `scene ${i} voiceover`));
      const ms = Math.round(((spans[i].start + Math.round((vo.delaySec ?? 0) * FPS)) / FPS) * 1000);
      filter.push(`[${ai}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${vo.volume ?? 1},adelay=${ms}|${ms}[a${ai}]`);
      audioLabels.push(`[a${ai}]`); ai++;
    }
    filter.push(`${audioLabels.join('')}amix=inputs=${audioLabels.length}:normalize=0:duration=longest,apad[aout]`);
  }
  const args = ['-y', '-v', 'error', ...inputs];
  if (filter.length) args.push('-filter_complex', filter.join(';'), '-map', '0:v', '-map', '[aout]', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000');
  args.push('-c:v', 'copy', '-bsf:v', 'h264_metadata=video_full_range_flag=0:colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-t', DURATION.toFixed(4), '-movflags', '+faststart', '-f', 'mp4', partPath);
  try { run('ffmpeg', args); fs.renameSync(partPath, outPath); } catch (e) { fs.rmSync(partPath, { force: true }); throw e; }
  muxMs = Date.now() - tMux;
}

// ------------------------------------------------------------ still from a finished video, and the sheet
if (!stillMode && flags.still !== undefined) {
  if (!flags['still-out']) fail('--still needs --still-out <png>');
  run('ffmpeg', ['-y', '-v', 'error', '-ss', String(Math.min(DURATION - 1 / FPS, +flags.still)), '-i', outPath, '-frames:v', '1', path.resolve(flags['still-out'])]);
}
if (flags.sheet && !stillMode) {
  const count = Math.min(12, Math.max(9, Math.round(DURATION / 2.5)));
  const cols = count > 9 ? 3 : 3, rows = Math.ceil(count / cols), cellW = 640, cellH = Math.round((cellW * H) / W);
  const times = Array.from({ length: count }, (_, k) => Math.min(DURATION - 0.05, ((k + 0.5) / count) * DURATION));
  await Promise.all(times.map(async (t, k) => {
    const f = path.join(workDir, `sheet-${k}.jpg`);
    await runAsync('ffmpeg', ['-y', '-v', 'error', '-ss', t.toFixed(3), '-i', outPath, '-frames:v', '1', '-vf', `scale=${cellW}:${cellH}`, '-q:v', '3', f]);
    sheetFiles.set(`s${k}.jpg`, f);
  }));
  const sheetW = cols * cellW + (cols + 1) * 10, sheetH = rows * (cellH + 36) + rows * 10 + 10;
  const page = await openPage('about:blank');
  await page.call('Emulation.setDeviceMetricsOverride', { width: sheetW, height: sheetH, deviceScaleFactor: 1, mobile: false });
  await page.call('Page.navigate', { url: `${origin}/stills.html` });
  const html = `<style>html,body{width:auto;height:auto;overflow:visible}</style><div style="display:grid;grid-template-columns:repeat(${cols},${cellW}px);gap:10px;padding:10px;width:${sheetW}px;background:#1b1b1f;font:600 15px ${'Inter,system-ui,sans-serif'};color:#d8d8de">${
    times.map((t, k) => `<div style="height:${cellH + 26}px"><img src="/sheet/s${k}.jpg" style="width:${cellW}px;height:${cellH}px;display:block"><div style="padding-top:6px">${(t).toFixed(1)} s</div></div>`).join('')}</div>`;
  await page.call('Runtime.evaluate', { awaitPromise: true, expression: `(async()=>{document.getElementById('root').innerHTML=${JSON.stringify(html)};await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode()));return 1})()` });
  const shot = await page.call('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: sheetW, height: sheetH, scale: 1 } });
  fs.mkdirSync(path.dirname(path.resolve(flags.sheet)), { recursive: true });
  fs.writeFileSync(path.resolve(flags.sheet), Buffer.from(shot.data, 'base64'));
}

// ------------------------------------------------------------ shut down, report
// Housekeeping: proxies this run did not use and nobody has touched for a week.
for (const dir of new Set([...proxyDirs, path.join(path.dirname(path.resolve(flags.out ?? flags['still-out'] ?? '.')), '.compose-cache')])) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    try { if (f.endsWith('proxy.mp4') && !usedProxies.has(full) && Date.now() - fs.statSync(full).mtimeMs > 7 * 86400e3) fs.rmSync(full); } catch {}
  }
}
closing = true;
await send('Browser.close', {}, undefined, 5000).catch(() => {});
await new Promise((r) => { if (chromeExited) return r(); chrome.once('exit', r); setTimeout(r, 3000); });
cleanupSync();

const wallSec = (Date.now() - T0) / 1000;
const renderFps = stillMode ? 0 : N / ((tRendered - tRender) / 1000);
const timing = {
  probeAndProxy: (tLaunch - tProbe) / 1000, chromeLaunch: (tLaunched - tLaunch) / 1000, stills: (tStillsDone - tStills) / 1000,
  render: (tRendered - tRender) / 1000, mux: muxMs / 1000, total: wallSec,
};
if (stillMode) {
  if (JSON_OUT) console.log(JSON.stringify({ ok: true, still: stillOutPath, width: W, height: H, wallSec: +wallSec.toFixed(2), warnings }));
  else console.log(`saved ${stillOutPath} (${W}x${H}, frame ${stillFrame}, ${wallSec.toFixed(1)} s wall)`);
} else if (JSON_OUT) {
  console.log(JSON.stringify({
    ok: true, out: outPath, width: W, height: H, fps: FPS, frames: N, durationSec: +DURATION.toFixed(3), wallSec: +wallSec.toFixed(2), renderFps: +renderFps.toFixed(1), warnings,
    timing: Object.fromEntries(Object.entries(timing).map(([k, v]) => [k, +v.toFixed(2)])), renderer: result.renderer, encoder: result.enc?.hardware, bytes: chunkBytes,
  }));
} else {
  if (process.stderr.isTTY) process.stderr.write('\r' + ' '.repeat(40) + '\r');
  if (flags.verbose) note(JSON.stringify({ timing, page: result.st, renderer: result.renderer, enc: result.enc }));
  console.log(`saved ${outPath} (${W}x${H}, ${DURATION.toFixed(1)} s, ${Math.round(renderFps)} fps render, ${wallSec.toFixed(1)} s wall)`);
}
process.exit(0);
