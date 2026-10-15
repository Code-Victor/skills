#!/usr/bin/env node
// Record an HTML figure frame by frame into a clip: an explainer made from an
// anatomy figure (or any page that calls figureHook()) instead of a screen
// recording. Needs Node 22+, ffmpeg and Chrome.
//
//   node capture-figure.mjs --page <file.html> --out clips/<take>.mp4 [--viewport 1920x1080] [--dpr 1.5] [--fps 60]
//     [--timeline <json>] [--duration s] [--marks <json>] [--steps <json>] [--seed n] [--transitions off|on]
//     [--crf n] [--jpeg-quality n] [--encoder x264] [--draft] [--preview 2,8,20 --preview-dir <dir>]
//     [--hash-frames <file>] [--workers n] [--json]
//
// A figure runs in one of two modes, picked by the page:
//   hook   the page keeps the figure contract (scripts/figure-hook.js):
//          window.__figure with frame(t, dt). Video frame i is at v = i / fps
//          seconds and shows figure time t, from --timeline (a monotone cubic
//          through [[videoSec, figureT], ...]) or, with only --duration,
//          running evenly over the figure's range. For each frame the recorder
//          calls frame(t, dt), with dt = 1/fps after the first, so springs
//          settle the same way on every run.
//   clock  the page has no hook (any anatomy figure as it comes). The recorder
//          installs figure-clock.js before the page's own scripts and loads it
//          again, so the page's own loop runs on a virtual clock: figure time
//          is virtual seconds since load (the video second, or --timeline),
//          and timers, rAF, Date, performance.now, CSS and Web Animations and
//          a seeded Math.random all follow it. --steps drive it with timed
//          pointer and key input.
// Either way each frame then waits for two painted frames, is screenshot and
// streamed into ffmpeg (capture-encode.mjs: H.264, yuv420p, TV range).
//
// It runs its own headless Chrome on a throwaway profile, removed when it
// exits, whatever happens: no window, no focus change, nothing left on a port.
// The page sees window.__figureRecording = true before its own scripts run,
// so it can stay still until the first frame.
//
// Writes <out>, <out>.events.json (each mark as a `mark` event, so
// auto-camera.mjs and callouts treat it like a `mark` step) and
// <out>.sheet.png. Every run ends with one line: `saved <file> ...` or
// `FAILED: <reason>` (--json prints a one-line JSON summary instead). Exit
// codes: 0 ok, 1 failed, 2 usage, 4 no Chrome.
//
// Options:
//   --viewport 1920x1080   CSS pixels; the page lays itself out to fill them
//   --dpr 1.5              device pixel ratio: frames are viewport * dpr
//   --fps 60               frames per video second
//   --timeline <json>      [[videoSec, figureT], ...]: videoSec starts at 0 and
//                          rises, figureT never falls (a repeat is a hold that
//                          motion eases into). The last videoSec is the length
//   --duration <sec>       the length when there is no timeline
//   --marks <json>         marks [{ id, t, anchor?, label?, poster?, look? }] in
//                          figure time, added to the page's (these win on an id)
//   --steps <json>         clock mode: timed input, [{ at: <video sec>, move |
//                          click: [x, y] fractions, dur?, key, mark, anchor?, label?, look? }]
//   --seed 1               clock mode: the seed for Math.random
//   --transitions off      clock mode: CSS transitions off (default) or on
//   --draft                quick review frames: 30 fps, dpr 1, JPEG quality 80
//   --preview 2,8,20       step through, but only save PNG stills at these video
//                          seconds into --preview-dir; nothing is encoded
//   --hash-frames <file>   the SHA-1 of every screenshot, one a line, to prove
//                          two runs are the same
//   --crf 14 --jpeg-quality 95 --encoder x264   as capture.mjs
//   --allow-temp           allow --out under /tmp or a session scratchpad
//   --json                 print a one-line JSON summary instead of the last line
//   --timeline, --marks and --steps take inline JSON or a JSON file.
//
// A recording warns when its frames stay byte for byte the same for more than
// 2.5 s of video while figure time moves: the page is not drawing from the
// time it is given. A hold (figure time standing still) never warns.
//
// Not written yet: --workers (seekable figures in several tabs at once). It
// plugs into the frame loop below.

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openTab, sleep } from './capture-cdp.mjs';
import { startEncoder, writeSheet } from './capture-encode.mjs';
import { monotone } from './figure-hook.js';

const T0 = Date.now();

// ---------------------------------------------------------------- arguments

const BOOLEAN = new Set(['draft', 'json', 'allow-temp']);
const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const key = argv[i].replace(/^--/, '');
  const next = argv[i + 1];
  if (BOOLEAN.has(key) || next === undefined || next.startsWith('--')) {
    args[key] = true;
  } else {
    args[key] = next;
    i++;
  }
}

const USAGE = `Usage:
  capture-figure.mjs --page <file.html> --out <clip.mp4> [--viewport 1920x1080] [--dpr 1.5] [--fps 60]
    (--timeline <json> | --duration <sec>) [--marks <json>] [--steps <json>] [--seed n] [--transitions off|on]
    [--draft] [--hash-frames <file>] [--json]
  capture-figure.mjs --page <file.html> (--timeline <json> | --duration <sec>) --preview 2,8,20 --preview-dir <dir>
Read the top of this file for every option.`;
const usage = (msg) => {
  if (msg) console.error(`FAILED: ${msg}`);
  console.error(USAGE);
  process.exit(2);
};

const PREVIEW = typeof args.preview === 'string';
if (typeof args.page !== 'string' || (typeof args.out !== 'string' && !PREVIEW)) usage();
const page = resolve(args.page);
if (!existsSync(page) || !statSync(page).isFile()) usage(`--page ${page} does not exist`);
// Inline JSON, or the name of a JSON file.
const jsonArg = (name) => {
  const v = args[name];
  if (v === undefined) return undefined;
  try {
    if (typeof v !== 'string') throw new Error('it needs a value');
    return JSON.parse(/^\s*[[{]/.test(v) ? v : readFileSync(v, 'utf8'));
  } catch (e) {
    usage(`--${name} must be JSON or a JSON file (${e.message})`);
  }
};
const num = (name, def, ok, what) => {
  const v = args[name] === undefined ? def : +args[name];
  if (!(Number.isFinite(v) && ok(v))) usage(`--${name} must be ${what} (got ${args[name]})`);
  return v;
};

const DRAFT = !!args.draft;
const [vw, vh] = String(args.viewport ?? '1920x1080').split('x').map(Number);
if (![vw, vh].every((n) => Number.isInteger(n) && n >= 100 && n <= 8192)) usage(`--viewport must be WIDTHxHEIGHT in CSS pixels, like 1920x1080 (got ${args.viewport})`);
// A draft is for judging timing, not pixels: half the frames, a third fewer pixels a side.
const dpr = DRAFT ? 1 : num('dpr', 1.5, (v) => v >= 1 && v <= 3, 'a number from 1 to 3');
const fps = DRAFT ? 30 : num('fps', 60, (v) => v > 0 && v <= 120, 'frames a second, up to 120');
const jpegQuality = DRAFT ? 80 : num('jpeg-quality', 95, (v) => v >= 1 && v <= 100, 'a number from 1 to 100');
const crf = num('crf', 14, (v) => v >= 0 && v <= 51, 'an x264 crf from 0 to 51');
const encoder = String(args.encoder ?? 'x264');
const workers = num('workers', 1, (v) => Number.isInteger(v) && v >= 1, 'a whole number of tabs');

const timeline = jsonArg('timeline') ?? null;
if (timeline !== null) {
  const ok = Array.isArray(timeline) && timeline.length >= 2 &&
    timeline.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite));
  if (!ok) usage('--timeline must be [[videoSec, figureT], ...] with at least two points');
  if (timeline[0][0] !== 0) usage(`--timeline must start at video second 0 (it starts at ${timeline[0][0]})`);
  for (let i = 1; i < timeline.length; i++) {
    if (!(timeline[i][0] > timeline[i - 1][0])) usage(`--timeline video seconds must rise: ${timeline[i - 1][0]} then ${timeline[i][0]}`);
    if (timeline[i][1] < timeline[i - 1][1]) usage(`--timeline figure time must never fall: ${timeline[i - 1][1]} then ${timeline[i][1]} (repeat a value to hold)`);
  }
  if (args.duration !== undefined) usage('give --timeline or --duration, not both (the timeline sets the length)');
}
const lengthSec = timeline ? timeline.at(-1)[0] : num('duration', NaN, (v) => v > 0, 'seconds (or give --timeline)');
const argMarks = jsonArg('marks') ?? [];
if (!Array.isArray(argMarks) || !argMarks.every((m) => m && typeof m.id === 'string' && Number.isFinite(m.t)))
  usage('--marks must be [{ "id": "name", "t": <figure time> }, ...]');
const figureSteps = jsonArg('steps') ?? [];
if (!Array.isArray(figureSteps)) usage('--steps must be a list of { "at": <sec>, ... }');
const fraction = (p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && n >= 0 && n <= 1);
figureSteps.forEach((s, j) => {
  const at = `--steps item ${j} (${JSON.stringify(s)})`;
  if (!s || typeof s !== 'object' || !(typeof s.at === 'number' && s.at >= 0)) usage(`${at} needs "at", the video second it happens`);
  const acts = ['move', 'click', 'key', 'mark'].filter((k) => k in s);
  if (acts.length !== 1) usage(`${at} needs one of move, click, key or mark`);
  if (('move' in s && !fraction(s.move)) || ('click' in s && !fraction(s.click))) usage(`${at}: move and click are [x, y] in fractions of the viewport, like [0.3, 0.55]`);
  if ('key' in s && !(typeof s.key === 'string' && s.key)) usage(`${at}: key is a key name, like "ArrowRight"`);
  if ('mark' in s && !(typeof s.mark === 'string' && s.mark)) usage(`${at}: mark is the mark's id`);
  if ('dur' in s && !(typeof s.dur === 'number' && s.dur >= 0)) usage(`${at}: dur is seconds`);
});
const seed = num('seed', 1, Number.isInteger, 'a whole number');
const transitions = String(args.transitions ?? 'off');
if (!['off', 'on'].includes(transitions)) usage(`--transitions must be off or on (got ${transitions})`);

let previewAt = [];
let previewDir = null;
if (PREVIEW) {
  previewAt = args.preview.split(',').map((s) => s.trim()).filter(Boolean);
  if (!previewAt.length || !previewAt.every((s) => Number.isFinite(+s) && +s >= 0)) usage(`--preview must be video seconds like 2,8,20 (got ${args.preview})`);
  previewDir = args['preview-dir'] ? resolve(String(args['preview-dir'])) : args.out ? dirname(resolve(args.out)) : null;
  if (!previewDir) usage('--preview needs --preview-dir <dir> (where the stills go)');
}

const out = !PREVIEW ? resolve(args.out) : null;
// Written under this name and renamed when the take is whole: a failed take
// leaves nothing behind.
const tmpOut = out ? join(dirname(out), `.${basename(out, extname(out))}.${process.pid}.part${extname(out) || '.mp4'}`) : null;
// Recordings can't be re-rendered, only re-recorded: never where a restart deletes them.
const TEMP = /^(\/private)?\/tmp\/|^(\/private)?\/var\/folders\/|\/scratchpad\//;
if (out && TEMP.test(out) && !args['allow-temp']) {
  console.error(`--out ${out} is in a temporary folder that is emptied on restart.
Record into a folder that lasts, e.g. ~/Downloads/<name>-demo/clips/ (or pass --allow-temp for a throwaway take).`);
  process.exit(2);
}
const hashFile = typeof args['hash-frames'] === 'string' ? resolve(args['hash-frames']) : null;

// ---------------------------------------------------------------- finishing

const say = (...a) => (args.json ? console.error : console.log)(...a);
const warnings = [];
const warn = (msg) => {
  if (warnings.includes(msg)) return;
  warnings.push(msg);
  console.error(`warning: ${msg}`);
};
const wallSec = () => (Date.now() - T0) / 1000;

let chrome = null; // { proc, profile }: our own Chrome, gone by the time we exit
let tab = null;
let sink = null;
let ending = false;

const stopChrome = async () => {
  if (!chrome) return;
  const { proc, profile } = chrome;
  chrome = null;
  if (proc.exitCode === null && proc.signalCode === null) {
    const exited = new Promise((r) => proc.once('exit', () => r(true)));
    try { proc.kill('SIGTERM'); } catch {}
    if (!(await Promise.race([exited, sleep(3000).then(() => false)]))) {
      try { proc.kill('SIGKILL'); } catch {}
      await Promise.race([exited, sleep(1000)]);
    }
  }
  // Its helpers (renderer, GPU) follow it out a moment later; any still up
  // after a second are stopped, so none writes into the profile once it is gone.
  const helpers = ['-f', `user-data-dir=${profile}`];
  for (let i = 0; i < 10 && spawnSync('pgrep', helpers).status === 0; i++) await sleep(100);
  spawnSync('pkill', ['-KILL', ...helpers]);
  for (let i = 0; i < 10; i++) {
    try {
      rmSync(profile, { recursive: true, force: true });
      if (!existsSync(profile)) break;
    } catch {}
    await sleep(200);
  }
};
// Whatever happens, the tab goes away, ffmpeg dies and Chrome goes with its profile.
const cleanup = async () => {
  try { sink?.abort(); } catch {}
  if (tmpOut) rmSync(tmpOut, { force: true });
  if (tab) await tab.close().catch(() => {});
  await stopChrome();
};
const die = async (reason, code = 1) => {
  if (ending) return;
  ending = true;
  await cleanup();
  if (args.json) console.log(JSON.stringify({ ok: false, error: reason, code, warnings, wallSec: +wallSec().toFixed(1) }));
  else console.error(`FAILED: ${reason}`);
  process.exit(code);
};
const succeed = async (line, summary) => {
  if (ending) return;
  ending = true;
  await cleanup();
  if (args.json) console.log(JSON.stringify({ ok: true, ...summary, warnings, wallSec: +wallSec().toFixed(1) }));
  else console.log(line);
  process.exit(0);
};
for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) process.on(sig, () => die(`interrupted (${sig})`, code));
process.on('unhandledRejection', (e) => die(e?.message ?? String(e)));
process.on('uncaughtException', (e) => die(e?.message ?? String(e)));
// Last resort for an exit nobody planned: no Chrome or profile outlives us.
process.on('exit', () => {
  if (!chrome) return;
  try { chrome.proc.kill('SIGKILL'); } catch {}
  spawnSync('pkill', ['-KILL', '-f', `user-data-dir=${chrome.profile}`]);
  try { rmSync(chrome.profile, { recursive: true, force: true }); } catch {}
});

// ---------------------------------------------------------------- chrome

// The same places chrome.sh looks, CHROME_PATH first.
const findChrome = () => {
  const onPath = (n) => {
    const r = spawnSync('sh', ['-c', `command -v ${n}`], { encoding: 'utf8' });
    return r.status === 0 ? r.stdout.trim() : null;
  };
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ];
  for (const c of candidates) if (c && existsSync(c)) return c;
  for (const n of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const c = onPath(n);
    if (c) return c;
  }
  return null;
};

// A headless Chrome of our own on a fresh profile. Software GL (SwiftShader)
// and CPU raster give the same pixels on every run. Resolves to its port.
const launchChrome = async () => {
  const bin = findChrome();
  if (!bin) return die('Chrome not found. Set CHROME_PATH to its binary.', 4);
  const profile = mkdtempSync(join(tmpdir(), 'ui-demo-figure-'));
  const proc = spawn(bin, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check',
    '--allow-file-access-from-files', `--force-device-scale-factor=${dpr}`, '--disable-gpu-rasterization',
    // Raster whole tiles: partial raster redraws only what changed, so edges depend on the frames drawn before.
    '--disable-partial-raster',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', `--window-size=${vw},${vh}`,
    // A fresh profile would otherwise start fetching components and an on-device model.
    '--disable-component-update',
    '--disable-features=OptimizationGuideModelDownloading,OnDeviceModelPerformanceParams,OnDeviceModelBackgroundDownload',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  chrome = { proc, profile };
  let err = '';
  proc.stderr.on('data', (d) => { if (err.length < 8000) err += d; });
  proc.on('error', (e) => { err += e.message; });
  // Chrome writes the port it picked into the profile.
  for (let i = 0; i < 200 && proc.exitCode === null; i++) {
    try {
      const port = +readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0];
      if (port > 0) return port;
    } catch {}
    await sleep(100);
  }
  return die(`Chrome did not start (${bin}): ${err.trim().split('\n').slice(-3).join(' | ') || 'no DevToolsActivePort after 20 s'}`, 4);
};

// Open a tab on our Chrome. On a loaded machine Chrome writes its port a
// while before its DevTools endpoint answers, so a miss is tried again for up
// to CONNECT_MS while Chrome is still running.
const CONNECT_MS = 30000;
const connect = async (port, opts) => {
  const until = Date.now() + CONNECT_MS;
  for (;;) {
    try {
      return await openTab(port, opts);
    } catch (e) {
      const alive = chrome && chrome.proc.exitCode === null && chrome.proc.signalCode === null;
      if (e.code !== 'NO_CHROME') return die(`could not open a tab: ${e.message}`);
      if (!alive) return die(`Chrome exited before its DevTools endpoint on port ${port} answered`, 4);
      if (Date.now() > until) return die(`Chrome started (port ${port}) but its DevTools endpoint did not answer within ${CONNECT_MS / 1000} s; the machine may be overloaded`, 4);
      await sleep(500);
    }
  }
};

// ---------------------------------------------------------------- page

// Exceptions inside the page are errors here: a frame that threw drew nothing.
const evaluate = async (expression, label = 'eval') => {
  const r = await tab.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r?.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error(`${label} threw: ${d.exception?.description?.split('\n')[0] ?? d.text}`);
  }
  return r?.result?.value;
};

let pageErrors = 0;
const pageError = (msg) => {
  if (++pageErrors <= 5) warn(`the page ${msg}`);
  else if (pageErrors === 6) warn('the page reported more errors; open it in a browser and clear its console');
};

// Pinned size and scale, motion allowed (reduced motion would still a figure),
// and the recording flag before any page script runs.
const preparePage = async () => {
  const { send } = tab;
  tab.on((m) => {
    if (m.method === 'Inspector.targetCrashed') die('the page crashed');
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      pageError(`threw: ${d.exception?.description?.split('\n')[0] ?? d.text}`);
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
      pageError(`logged an error: ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200)}`);
  });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Inspector.enable').catch(() => {});
  await send('Emulation.setDeviceMetricsOverride', { width: vw, height: vh, deviceScaleFactor: dpr, mobile: false });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  // Keeps the page "focused" (rAF, :focus) without raising anything.
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__figureRecording = true;' });
};

const loadPage = async () => {
  let done;
  const loaded = new Promise((r) => (done = r));
  const h = (m) => {
    if (m.method === 'Page.loadEventFired') done(true);
  };
  tab.on(h);
  const timer = setTimeout(() => done(false), 30000);
  const nav = await tab.send('Page.navigate', { url: pathToFileURL(page).href });
  if (nav.errorText) {
    clearTimeout(timer);
    tab.off(h);
    return die(`could not load ${page}: ${nav.errorText}`);
  }
  const ok = await loaded;
  clearTimeout(timer);
  tab.off(h);
  if (!ok) warn('the page had not finished loading after 30 s; carrying on');
  await evaluate('document.fonts.ready.then(() => true)', 'document.fonts.ready');
  const size = await evaluate('[document.documentElement.scrollWidth, document.documentElement.scrollHeight]');
  if (size && (size[0] > vw + 1 || size[1] > vh + 1))
    warn(`the page is ${size[0]}x${size[1]} CSS px but the viewport is ${vw}x${vh}: it must lay itself out to fit, or the frame shows only its top left`);
};

// A module script can call figureHook() a moment after load (after an await).
const detectMode = async () => {
  for (let i = 0; i < 20; i++) {
    if (await evaluate("typeof window.__figure?.frame === 'function'")) return 'hook';
    await sleep(50);
  }
  return 'clock';
};

// ---------------------------------------------------------------- modes

// A mode drives the page through the frames:
//   prepare()          once the page has loaded: check it, return { range, marks, seekable }
//   advance(t, dt, v)  put figure time t on the page (dt: video seconds since the
//                      last frame; v: this frame's video second)
//   paint()            resolve once that frame is on screen, ready for a screenshot
// Hook mode calls the page's own window.__figure. Clock mode (no hook) runs
// the page's own loop on a virtual clock that figure-clock.js installs before
// the page loads; advance() moves it on.
const READY_MS = 20000;
const hookMode = {
  name: 'hook',
  async prepare() {
    const info = await evaluate(`Promise.race([
      Promise.resolve(window.__figure.ready).then(() => 'ok'),
      new Promise((r) => setTimeout(() => r('timeout'), ${READY_MS})),
    ]).then((ready) => {
      const f = window.__figure;
      const marks = Array.isArray(f.marks) ? f.marks.map((m) => ({ id: m.id, t: m.t, anchor: m.anchor, label: m.label, poster: m.poster, look: m.look })) : [];
      return { ready, version: f.version, range: f.range, seekable: f.seekable === true, marks };
    })`, 'window.__figure.ready');
    if (info.ready !== 'ok') return die(`window.__figure.ready did not resolve within ${READY_MS / 1000} s (fonts, images or a warm-up that never finishes?)`);
    if (info.version !== 1) return die(`window.__figure.version is ${JSON.stringify(info.version)}; this recorder reads version 1 (build the page with scripts/figure-hook.js)`);
    const r = info.range;
    if (!Array.isArray(r) || r.length !== 2 || !r.every(Number.isFinite) || r[1] < r[0])
      return die(`window.__figure.range must be [t0, t1] with t1 >= t0 (got ${JSON.stringify(r)})`);
    const bad = info.marks.find((m) => typeof m.id !== 'string' || !Number.isFinite(m.t));
    if (bad) return die(`a mark on the page needs an id and a figure time t (got ${JSON.stringify(bad)})`);
    return info;
  },
  advance: (t, dt) => evaluate(`Promise.resolve(window.__figure.frame(${t}, ${dt})).then(() => true)`, `window.__figure.frame(${t}, ${dt})`),
  paint: () => evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))', 'paint'),
};

// Clock mode: figure-clock.js replaces the page's time sources (rAF, timers,
// performance.now, Date, Math.random, CSS and Web Animations) before any
// page script runs, so the page is loaded again with it. Virtual time starts
// at 1000 ms, so figure time t (virtual seconds since load) is 1000 + 1000 t.
const CLOCK_SOURCE = readFileSync(new URL('./figure-clock.js', import.meta.url), 'utf8');

// figureSteps: input at fixed video seconds. A step fires on the first frame
// whose video second reaches its `at`. A move with `dur` glides once a frame,
// with capture.mjs's ease, from where the pointer was (a first move, with
// nothing before it, jumps). A click is a move, a press and a release; a key
// is a key down and up. No cursor is drawn. Clicks and keys are logged as
// events the way capture.mjs logs them (a click at x, y in fractions of the
// frame with no box; a key by name), so the auto-camera follows them; a move
// logs nothing. Mark steps are logged with the other marks (see main).
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const inputEvents = [];
const figureInput = () => {
  const todo = figureSteps.map((s, i) => ({ ...s, i })).filter((s) => !('mark' in s)).sort((a, b) => a.at - b.at || a.i - b.i);
  let pos = null;
  let glide = null;
  const mouse = (type, [x, y]) => tab.send('Input.dispatchMouseEvent', {
    type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: type === 'mouseMoved' ? 0 : 1,
  });
  const px = ([fx, fy]) => [fx * vw, fy * vh];
  // Sends what is due at video second v. True when it sent anything.
  return async (v) => {
    let sent = false;
    while (todo.length && todo[0].at <= v + 1e-9) {
      const s = todo.shift();
      if (s.move) {
        const to = px(s.move);
        if (s.dur > 0 && pos) glide = { from: pos, to, at: s.at, dur: s.dur };
        else {
          glide = null;
          pos = to;
          await mouse('mouseMoved', pos);
          sent = true;
        }
      } else if (s.click) {
        glide = null;
        pos = px(s.click);
        inputEvents.push({ type: 'click', t: +v.toFixed(3), x: +s.click[0].toFixed(4), y: +s.click[1].toFixed(4), box: null });
        await mouse('mouseMoved', pos);
        await mouse('mousePressed', pos);
        await mouse('mouseReleased', pos);
        sent = true;
      } else if (s.key) {
        inputEvents.push({ type: 'key', key: s.key, t: +v.toFixed(3) });
        await tab.send('Input.dispatchKeyEvent', { type: 'keyDown', key: s.key });
        await tab.send('Input.dispatchKeyEvent', { type: 'keyUp', key: s.key });
        sent = true;
      }
    }
    if (glide) {
      const k = ease(Math.min(1, Math.max(0, (v - glide.at) / glide.dur)));
      pos = [glide.from[0] + (glide.to[0] - glide.from[0]) * k, glide.from[1] + (glide.to[1] - glide.from[1]) * k];
      await mouse('mouseMoved', pos);
      sent = true;
      if (v >= glide.at + glide.dur - 1e-9) glide = null;
    }
    return sent;
  };
};

let input = null;
let clockMs = 1000;
const clockMode = {
  name: 'clock',
  async prepare() {
    // A background tab is hidden, even headless, and a hidden page gets no
    // real frames: no paint() and no IntersectionObserver. This Chrome is
    // headless and ours alone, so nothing rises and no focus moves.
    await tab.send('Page.bringToFront');
    await tab.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__vclockConfig = ${JSON.stringify({ seed, transitions })};\n${CLOCK_SOURCE}`,
    });
    await loadPage();
    if (!(await evaluate("typeof window.__vclock?.advanceTo === 'function'"))) return die('the virtual clock (figure-clock.js) did not install in the page');
    if (await evaluate("typeof window.__figure?.frame === 'function'"))
      return die(`${basename(page)} set window.__figure more than a second after it loaded, so it was taken for a page without a hook. Call figureHook() as the page loads.`);
    // Two real frames before the first: the IntersectionObserver that starts
    // an anatomy figure's loop has reported by then.
    await clockMode.paint();
    input = figureInput();
    return { range: null, marks: [], seekable: false };
  },
  async advance(t, dt, v) {
    // Input first. Chrome hands pointer input to the page with its next real
    // frame, so one is painted before time moves on.
    if (await input(v)) await clockMode.paint();
    clockMs = Math.max(clockMs, 1000 + t * 1000);
    await evaluate(`window.__vclock.advanceTo(${clockMs})`, `__vclock.advanceTo(${clockMs})`);
  },
  paint: () => evaluate('window.__vclock.paint().then(() => true)', 'paint'),
  stats: () => evaluate('window.__vclock.stats()', '__vclock.stats()'),
};
const MODES = { hook: hookMode, clock: clockMode };

// ---------------------------------------------------------------- frames

const shot = async (format) => {
  const { data } = await tab.send('Page.captureScreenshot', {
    format, ...(format === 'jpeg' ? { quality: jpegQuality } : {}),
    clip: { x: 0, y: 0, width: vw, height: vh, scale: 1 },
  });
  return Buffer.from(data, 'base64');
};

// Width and height of a PNG or JPEG without decoding it.
const imageSize = (b) => {
  if (b[0] === 0x89) return [b.readUInt32BE(16), b.readUInt32BE(20)];
  for (let i = 2; i < b.length - 9;) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
};

// Where a mark's anchor is, as fractions of the frame.
const anchorBox = async (m) => {
  if (typeof m.anchor !== 'string' || !m.anchor) return null;
  const r = await evaluate(`(() => {
    let e;
    try { e = document.querySelector(${JSON.stringify(m.anchor)}); } catch (err) { return { bad: err.message }; }
    if (!e) return { missing: true };
    const b = e.getBoundingClientRect();
    return { box: [b.left, b.top, b.width, b.height] };
  })()`, `mark "${m.id}" anchor`);
  if (r.bad) { warn(`mark "${m.id}": anchor ${m.anchor} is not a valid selector (${r.bad})`); return null; }
  if (r.missing) { warn(`mark "${m.id}": nothing on the page matches anchor ${m.anchor}, so it has no box`); return null; }
  const [x, y, w, h] = r.box;
  if (!(w > 0 && h > 0)) { warn(`mark "${m.id}": anchor ${m.anchor} has no size at that frame, so it has no box`); return null; }
  return [x / vw, y / vh, w / vw, h / vh].map((v) => +v.toFixed(4));
};

const W = Math.round((vw * dpr) / 2) * 2, H = Math.round((vh * dpr) / 2) * 2;

// Step every frame in order. Recording: paint, screenshot and encode each one.
// Preview: paint and save a PNG only at the asked-for seconds (clock mode
// still paints wherever input goes in). Parallel capture would run this loop
// over a contiguous range of frames in each of several tabs.
const runFrames = async ({ mode, times, due }) => {
  const N = times.length;
  const events = [];
  const hashes = [];
  for (const s of previewAt) if (+s > (N - 1) / fps) warn(`--preview ${s}s is past the last frame (${((N - 1) / fps).toFixed(2)}s); that still shows the last frame`);
  const wanted = new Map(PREVIEW ? previewAt.map((s) => [Math.min(N - 1, Math.round(+s * fps)), s]) : []);
  const last = PREVIEW ? Math.max(...wanted.keys()) : N - 1;
  if (!PREVIEW) sink = startEncoder({ out: tmpOut, w: W, h: H, fps, crf, encoder });
  const t0 = Date.now();
  let shown = t0;
  for (let i = 0; i <= last; i++) {
    const v = i / fps;
    await mode.advance(times[i], i === 0 ? 0 : 1 / fps, v);
    if (PREVIEW && !wanted.has(i)) continue;
    await mode.paint();
    for (const m of due.get(i) ?? []) {
      const box = await anchorBox(m);
      events.push({
        type: 'mark', label: m.id, t: +v.toFixed(3), ...(box ? { box } : {}), ...(m.label ? { text: String(m.label) } : {}),
        ...(m.poster === true ? { poster: true } : {}), ...(m.look === false ? { look: false } : {}),
      });
    }
    const buf = await shot(PREVIEW ? 'png' : 'jpeg');
    if (i === 0) {
      const size = imageSize(buf);
      if (size && (Math.abs(size[0] - vw * dpr) > 2 || Math.abs(size[1] - vh * dpr) > 2))
        warn(`frames are ${size[0]}x${size[1]}, not ${Math.round(vw * dpr)}x${Math.round(vh * dpr)} (viewport ${vw}x${vh} at ${dpr}x); this Chrome ignores the scale`);
    }
    // Every frame is hashed (it is cheap): --hash-frames and the freeze check read them.
    hashes.push(createHash('sha1').update(buf).digest('hex'));
    if (PREVIEW) {
      const file = join(previewDir, `preview-${wanted.get(i)}s.png`);
      writeFileSync(file, buf);
      say(`still ${file}`);
    } else await sink.push(buf, v);
    if (Date.now() - shown > 5000) {
      shown = Date.now();
      say(`frame ${i + 1}/${N}, ${((shown - t0) / (i + 1)).toFixed(0)} ms a frame`);
    }
  }
  return { events, hashes, loopMs: Date.now() - t0, stepped: last + 1 };
};

// A figure that stops changing while its time moves on is not drawing from
// that time (hook mode: draw() reads something else; clock mode: the page
// waits on something the clock does not drive). Runs of byte-identical frames
// are measured in the video seconds where figure time moved, so a hold, where
// figure time stands still, never counts.
const FROZEN_SEC = 2.5;
const frozenRuns = (hashes, times) => {
  const runs = [];
  let from = 0;
  let moving = 0;
  for (let i = 1; i <= hashes.length; i++) {
    if (i < hashes.length && hashes[i] === hashes[i - 1]) {
      if (times[i] > times[i - 1] + 1e-9) moving++;
      continue;
    }
    if (moving / fps > FROZEN_SEC) runs.push([from, i - 1]);
    from = i;
    moving = 0;
  }
  return runs;
};
const warnFrozen = (hashes, times, clock) => {
  const runs = frozenRuns(hashes, times);
  const sec = (i) => +(i / fps).toFixed(2);
  const fig = (i) => +times[i].toFixed(3);
  for (const [a, b] of runs.slice(0, 3)) {
    warn(clock
      ? `the figure did not change from ${sec(a)}s to ${sec(b)}s although its clock ran (figure time ${fig(a)} to ${fig(b)}): is the page waiting on something the virtual clock does not drive (an iframe, its own pause, input)? To hold it on purpose, repeat a figure time in the timeline`
      : `the figure did not change from ${sec(a)}s to ${sec(b)}s although its time moved (figure time ${fig(a)} to ${fig(b)}): is draw() reading the time?`);
  }
  if (runs.length > 3) warn(`and ${runs.length - 3} more stretch(es) where the figure did not change although its time moved`);
};

// ---------------------------------------------------------------- run

const main = async () => {
  if (workers > 1) return die('parallel capture (--workers) is not implemented yet; leave --workers out to record in one tab', 2);
  if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) return die('ffmpeg not found on PATH');
  mkdirSync(PREVIEW ? previewDir : dirname(out), { recursive: true });

  const port = await launchChrome();
  tab = await connect(port);
  await preparePage();
  await loadPage();
  const modeName = await detectMode();
  const mode = MODES[modeName];
  const info = await mode.prepare();
  const clock = mode === clockMode;
  if (figureSteps.length && !clock) warn(`figureSteps only drive a page without a hook (clock mode); this page has one, so its ${figureSteps.length} step(s) are ignored`);

  // Figure time for every frame: the timeline, else evenly over the range so the
  // last frame shows the end (clock mode: the video second).
  const N = Math.max(1, Math.round(lengthSec * fps));
  const curve = timeline ? monotone(timeline) : null;
  let times;
  if (clock) times = Array.from({ length: N }, (_, i) => (curve ? curve(i / fps) : i / fps));
  else {
    const span = info.range[1] - info.range[0];
    const lastV = Math.max(1, N - 1) / fps;
    times = Array.from({ length: N }, (_, i) => (curve ? curve(i / fps) : info.range[0] + span * Math.min(1, i / fps / lastV)));
    if (timeline) {
      const lo = Math.min(...timeline.map((p) => p[1])), hi = Math.max(...timeline.map((p) => p[1]));
      if (lo < info.range[0] - 1e-9 || hi > info.range[1] + 1e-9)
        warn(`the timeline runs figure time ${lo} to ${hi}, outside the page's range [${info.range.join(', ')}]`);
    }
  }
  const range = info.range ?? [+times[0].toFixed(3), +times.at(-1).toFixed(3)];

  // Marks: the page's, then --marks (they win on the same id). Each fires on the
  // first frame whose figure time reaches it.
  const marks = new Map();
  for (const m of [...info.marks, ...argMarks]) marks.set(m.id, m);
  const due = new Map();
  for (const m of marks.values()) {
    const i = times.findIndex((t) => t >= m.t - 1e-9);
    if (i < 0) { warn(`mark "${m.id}" at figure time ${m.t} is never reached (the last frame shows ${+times.at(-1).toFixed(3)})`); continue; }
    due.set(i, [...(due.get(i) ?? []), m]);
  }
  const posters = [...marks.values()].filter((m) => m.poster === true);
  if (posters.length > 1) warn(`${posters.length} marks say poster: true (${posters.map((m) => m.id).join(', ')}); the first is the poster`);
  // Clock mode's steps fire on the first frame whose video second reaches them;
  // a mark step is logged there like any mark.
  if (clock) {
    for (const s of figureSteps) {
      const i = times.findIndex((_, k) => s.at <= k / fps + 1e-9);
      if (i < 0) { warn(`the figure step at ${s.at}s comes after the last frame (${((N - 1) / fps).toFixed(2)}s), so it never happens`); continue; }
      if (!('mark' in s)) continue;
      if (marks.has(s.mark)) warn(`mark "${s.mark}" is both in marks and a figure step; both are logged`);
      due.set(i, [...(due.get(i) ?? []), { id: s.mark, anchor: s.anchor, label: s.label, look: s.look }]);
    }
  }

  const r = await runFrames({ mode, times, due });
  if (hashFile) {
    mkdirSync(dirname(hashFile), { recursive: true });
    writeFileSync(hashFile, `${r.hashes.join('\n')}\n`);
  }
  const msPerFrame = +(r.loopMs / r.stepped).toFixed(1);
  // What the page asked of the virtual clock (timers, random numbers, animations).
  const clockStats = clock ? await clockMode.stats() : null;
  if (PREVIEW)
    return succeed(`saved ${previewAt.length} still(s) in ${previewDir} (stepped ${r.stepped} frames, ${msPerFrame} ms a frame, wall ${wallSec().toFixed(1)}s)`,
      { preview: previewAt.map((s) => join(previewDir, `preview-${s}s.png`)), frames: r.stepped, msPerFrame, mode: mode.name, ...(clockStats ? { clock: clockStats } : {}) });
  warnFrozen(r.hashes, times, clock);
  const distinct = new Set(r.hashes).size;

  await sink.finish(lengthSec);
  renameSync(tmpOut, out);
  const bytes = statSync(out).size;
  r.events.push(...inputEvents);
  r.events.sort((a, b) => a.t - b.t);
  const eventsFile = `${out}.events.json`;
  const eventsTmp = `${eventsFile}.${process.pid}.tmp`;
  writeFileSync(eventsTmp, `${JSON.stringify({
    width: W, height: H, duration: lengthSec, fps, slow: 1, events: r.events, cursor: [],
    figure: { mode: mode.name, range, timeline, dpr, viewport: [vw, vh], draft: DRAFT, seekable: info.seekable, ...(clock ? { seed, transitions } : {}) },
  }, null, 1)}\n`);
  renameSync(eventsTmp, eventsFile);
  const markCount = r.events.length - inputEvents.length;
  say(`events ${eventsFile} (${markCount} marks${inputEvents.length ? `, ${inputEvents.length} clicks and keys` : ''})`);
  const sheet = writeSheet(out, lengthSec);
  say(`sheet ${sheet}`);
  await succeed(
    `saved ${out} (${mode.name} mode, ${W}x${H}, ${lengthSec}s, ${N} frames at ${fps} fps, ${distinct} distinct, ${msPerFrame} ms a frame, ${(bytes / 1e6).toFixed(1)} MB, wall ${wallSec().toFixed(1)}s)`,
    {
      file: out, events: eventsFile, sheet, width: W, height: H, durationSec: lengthSec, fps, frames: N, distinctFrames: distinct,
      msPerFrame, mode: mode.name, draft: DRAFT, dpr, marks: markCount, ...(inputEvents.length ? { inputs: inputEvents.length } : {}), bytes, ...(hashFile ? { hashes: hashFile } : {}),
      ...(clockStats ? { clock: clockStats } : {}),
    },
  );
};

main().catch((e) => die(e?.message ?? String(e)));
