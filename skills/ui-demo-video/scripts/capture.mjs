#!/usr/bin/env node
// Record crisp, smooth clips and stills of a web page through the Chrome
// DevTools Protocol. Needs Node 22+ (global WebSocket) and ffmpeg.
//
//   node capture.mjs shot  --url <url> --out shot.png [--wait 3]
//   node capture.mjs clip  --url <url> --out clip.mp4 --duration 6 [--steps steps.json]
//   node capture.mjs clip  --url <url> --steps steps.json --dry-run
//   node capture.mjs scout --url <url> [--steps partial.json] [--out shot.png]
//
// Run scripts/chrome.sh first (a headless Chrome nobody sees, or any Chrome
// started with --remote-debugging-port). Each run opens its own background tab
// and closes it after, whatever happens. Nothing here takes focus or raises a
// window: the tab is created with Target.createTarget {background: true} and
// Page.bringToFront is never called.
//
// How a clip stays sharp and smooth:
//   - 2x device pixels, high-quality JPEG screencast frames (--lossless for
//     PNG). Frames stream straight into ffmpeg as they arrive; there are no
//     frame files and no encode pass at the end.
//   - The page's clock runs --slow times slower while Chrome paints, so it can
//     keep up at 2x; frames are re-timed back to real speed afterwards.
//     Everything driven by timers, rAF, CSS or Web Animations slows together.
//     --slow auto (the default) measures how fast this Chrome paints and picks
//     the smallest slowdown that still gives about 60 distinct frames per video
//     second. Network does NOT slow down, so use --slow 1 when real waiting
//     time is the point of the clip (a spinner that hangs for 8 seconds).
//   - A drawn cursor, because screencasts don't include the OS pointer. It
//     turns into a hand over links and buttons, an I-beam over text fields,
//     and leaves a soft ripple where it clicks. It follows this script's own
//     coordinates, never the page's mouse events, so a real mouse over a
//     visible window cannot move it.
//   - Every clip also writes <out>.events.json: where and when each click,
//     typing run, key, scroll and mark happened, in video seconds and as
//     fractions of the frame, plus the cursor's path. scripts/auto-camera.mjs
//     turns it into camera moves and callouts, the way a screen-recording
//     editor auto-zooms.
//
// Every run ends with one line: `saved <file> ...` or `FAILED: <reason>`
// (--json prints a one-line JSON summary instead). Exit codes: 0 ok, 1 failed
// (bad step, missing target, empty take), 2 usage, 3 not signed in or sent to
// another origin (run scripts/chrome.sh --login <url>), 4 no Chrome.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { openTab, otherPages, sleep } from './capture-cdp.mjs';
import { startEncoder } from './capture-encode.mjs';
import { TOOLBAR, cachedRate, pickSlow, screenSize, storeRate } from './capture-env.mjs';
import { HIDE_SELECTORS, clockScript, cursorScript, hideScript, query } from './capture-page.mjs';

const T0 = Date.now();

// ---------------------------------------------------------------- arguments

const BOOLEAN = new Set([
  'allow-temp', 'sheet', 'hide-floating', 'mobile', 'no-cursor', 'no-ripple', 'dark', 'dry-run', 'json',
  'lossless', 'no-guard', 'recalibrate', 'allow-redirect',
]);
const [mode, ...rest] = process.argv.slice(2);
const args = {};
for (let i = 0; i < rest.length; i++) {
  const key = rest[i].replace(/^--/, '');
  const next = rest[i + 1];
  if (BOOLEAN.has(key) || next === undefined || next.startsWith('--')) {
    args[key] = true;
  } else {
    args[key] = next;
    i++;
  }
}

const DRY = !!args['dry-run'];
const needsOut = mode === 'shot' || (mode === 'clip' && !DRY);
if (!['shot', 'clip', 'scout'].includes(mode) || !args.url || (needsOut && !args.out)) {
  console.error(`Usage:
  capture.mjs shot  --url <url> --out <file.png> [--wait 3]
  capture.mjs clip  --url <url> --out <file.mp4> --duration <sec> [--steps steps.json]
  capture.mjs clip  --url <url> --steps steps.json --dry-run
  capture.mjs scout --url <url> [--steps partial.json] [--out shot.png]

Options:
  --port 9222            Chrome remote-debugging port
  --width --height       viewport in CSS px. Default: what this screen shows in
                         a maximized browser window, so takes match the app
                         as you see it. Set both for a fixed size (1440 900)
  --scale 2              device pixel ratio (frames are width*scale wide). The
                         browser must run at that scale too: chrome.sh does
                         (SCALE=3 scripts/chrome.sh for phone takes)
  --allow-temp           allow --out under /tmp or a session scratchpad
                         (emptied on restart; recordings there get lost)
  --slow auto            clock dilation for clips: auto measures this Chrome
                         and picks the smallest that paints ~60 distinct
                         frames per video second; a number forces it
                         (1 = real time)
  --fps 60 --crf 14      output frame rate and x264 quality (lower = better)
  --lossless             PNG screencast frames instead of JPEG (slower)
  --jpeg-quality 95      JPEG quality of the screencast frames
  --encoder x264         x264 (veryfast), x264-faster, x264-slow or vt
                         (VideoToolbox, macOS)
  --steps <file.json>    scripted cursor / clicks / typing (see references/steps.md)
  --dry-run              rehearse the steps at full speed, nothing recorded:
                         every target is resolved; on a miss it prints the step,
                         the nearest candidates and a screenshot, and fails
  --hide "<css>"         extra selectors to hide (dev overlays, cookie banners)
  --setup "<js>"         run once on the page's origin before recording, not
                         recorded: reset app state so every take starts the
                         same (awaits promises, e.g. a fetch that reverts data)
  --sheet                also write <out>.sheet.png, a 1-per-second contact
                         sheet, for reviewing the take without opening it
  --hide-floating        also hide small fixed-position widgets (dev toolbars,
                         chat bubbles); keeps anything inside --keep
  --keep "<css>"         container whose floating children must stay visible
  --redact "<css>"       blur these elements in every frame (names, emails,
                         another customer's data). Steps can add more.
  --cursor-scale 1.25    size of the drawn cursor (1 = 22px at 1x)
  --mobile               phone emulation: touch, a 390x844 viewport unless
                         --width/--height say otherwise (pair with --scale 3)
  --no-cursor            don't draw the cursor
  --no-ripple            no click ripple
  --no-guard             let the page see the real mouse (default: pointer
                         events the script didn't send are dropped)
  --allow-redirect       don't stop when the page ends on another origin
  --json                 print a one-line JSON summary instead of the last line
  --dark                 emulate prefers-color-scheme: dark`);
  process.exit(2);
}

const port = +(args.port ?? 9222);
let width = +(args.width ?? 0);
let height = +(args.height ?? 0);
const scale = +(args.scale ?? 2);
const slowArg = args.slow === undefined || args.slow === true ? 'auto' : String(args.slow);
const AUTO = mode === 'clip' && !DRY && slowArg === 'auto';
let SLOW = mode === 'clip' && !DRY ? (AUTO ? 5 : Math.max(1, +slowArg || 1)) : 1;
const fps = +(args.fps ?? 60);
const crf = +(args.crf ?? 14);
const encoder = String(args.encoder ?? 'x264');
const lossless = !!args.lossless;
const jpegQuality = +(args['jpeg-quality'] ?? 95);
const out = args.out ? resolve(args.out) : null;
// Recordings can't be re-rendered, only re-recorded, so never write them
// where a restart deletes them: /tmp, macOS's per-user temp, or an agent's
// session scratchpad.
const TEMP = /^(\/private)?\/tmp\/|^(\/private)?\/var\/folders\/|\/scratchpad\//;
if (out && mode !== 'scout' && TEMP.test(out) && !args['allow-temp']) {
  console.error(`--out ${out} is in a temporary folder that is emptied on restart.
Record into a folder that lasts, e.g. ~/Downloads/<name>-demo/clips/ (or pass --allow-temp for a throwaway take).`);
  process.exit(2);
}
let steps = [];
if (args.steps) {
  try {
    steps = JSON.parse(readFileSync(args.steps, 'utf8'));
  } catch (e) {
    console.error(`FAILED: cannot read --steps ${args.steps}: ${e.message}`);
    process.exit(2);
  }
}
const cursorScale = +(args['cursor-scale'] ?? 1.25);
const REDACT = typeof args.redact === 'string' ? args.redact : '';
const HIDE = [...HIDE_SELECTORS, ...(typeof args.hide === 'string' ? [args.hide] : [])].join(', ');
const durationSec = +(args.duration ?? 0);
const cursorOn = mode === 'clip' && !DRY && !args['no-cursor'];

// ---------------------------------------------------------------- finishing

const say = (...a) => (args.json ? console.error : console.log)(...a);
const warnings = [];
const warn = (msg) => {
  warnings.push(msg);
  console.error(`warning: ${msg}`);
};
const wallSec = () => (Date.now() - T0) / 1000;

let tab = null;
let sink = null;
let ending = false;

// Whatever happens, the tab goes away and ffmpeg dies with it.
const cleanup = async () => {
  try { sink?.abort(); } catch {}
  if (tab) await tab.close().catch(() => {});
};
const die = async (reason, code = 1) => {
  if (ending) return;
  ending = true;
  await cleanup();
  if (args.json) console.log(JSON.stringify({ ok: false, error: reason, code, wallSec: +wallSec().toFixed(1) }));
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

// ---------------------------------------------------------------- connect

try {
  tab = await openTab(port, { width, height });
} catch (e) {
  await die(e.code === 'NO_CHROME' ? e.message : `could not open a tab: ${e.message}`, e.code === 'NO_CHROME' ? 4 : 1);
}
const { send } = tab;
tab.on((m) => {
  if (m.method === 'Inspector.targetCrashed') die('the page crashed');
});

// Exceptions inside the page are reported, never swallowed: a step whose eval
// throws otherwise looks exactly like one that ran and did nothing.
const evaluate = async (expression, label = 'eval', { fatal = false } = {}) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r?.exceptionDetails) {
    const d = r.exceptionDetails;
    const msg = `${label} threw: ${d.exception?.description?.split('\n')[0] ?? d.text}`;
    if (fatal) throw new Error(msg);
    warn(msg);
  }
  return r?.result?.value;
};
const ask = (op, arg) => evaluate(query(op, arg), `page query ${op}`);

// ---------------------------------------------------------------- page setup

await send('Page.enable');
await send('Runtime.enable');
await send('Inspector.enable').catch(() => {});

// In headless the page must not be able to tell: no "Headless" in the user
// agent or in userAgentData (chrome.sh also passes --user-agent).
if (tab.headless) {
  const full = (tab.info.Browser.match(/\/([\d.]+)/) ?? [])[1] ?? '0.0.0.0';
  const major = full.split('.')[0];
  const brands = (v) => [
    { brand: 'Chromium', version: v }, { brand: 'Google Chrome', version: v }, { brand: 'Not-A.Brand', version: '99' },
  ];
  await send('Emulation.setUserAgentOverride', {
    userAgent: tab.info['User-Agent'].replace('HeadlessChrome', 'Chrome'),
    userAgentMetadata: {
      brands: brands(major), fullVersionList: brands(full),
      platform: process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : 'Linux',
      platformVersion: '15.0.0', architecture: process.arch === 'arm64' ? 'arm' : 'x86', model: '',
      mobile: false, bitness: '64', wow64: false,
    },
  });
}

// The viewport the app has in a maximized window on this screen: the screen's
// usable area less the browser's own toolbars. Headless has no real window to
// measure, so the OS says (capture-env.mjs). A fixed size (the old 1440x900)
// lays the app out narrower than the person sees it on a bigger display.
if (args.mobile) {
  width ||= 390;
  height ||= 844;
}
if (!width || !height) {
  const s = screenSize();
  width ||= s.w;
  height ||= Math.max(300, s.h - TOOLBAR);
  say(`viewport ${width}x${height} at ${scale}x: this screen, browser maximized (--width/--height to change)`);
}
await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: !!args.mobile });
if (args.mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
if (args.dark) await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: hideScript({ hide: HIDE, redact: REDACT, floating: args['hide-floating'], keep: args.keep }),
});
// Keeps the page "focused" (rAF, :focus, caret) without raising anything.
await send('Emulation.setFocusEmulationEnabled', { enabled: true });

// ---------------------------------------------------------------- navigation

const loadPage = async (url, limitMs = 20000) => {
  let done;
  const loaded = new Promise((r) => (done = r));
  const h = (m) => {
    if (m.method === 'Page.loadEventFired') done(true);
  };
  tab.on(h);
  const timer = setTimeout(() => done(false), limitMs);
  const nav = await send('Page.navigate', { url });
  if (nav.errorText) {
    clearTimeout(timer);
    tab.off(h);
    await die(`could not load ${url}: ${nav.errorText}${/REFUSED/.test(nav.errorText) ? ' (is the dev server running?)' : ''}`);
  }
  const ok = await loaded;
  clearTimeout(timer);
  tab.off(h);
  if (!ok) warn(`${url} had not finished loading after ${limitMs / 1000} s; carrying on`);
};

const SIGNIN_NAMED = /(^|[/.-])(sign-?in|log-?in|login|signin|sso|auth|authorize|oauth2?|accounts)([/.?-]|$)/i;
// Stop early, and say how to fix it, when the profile is not signed in: the
// page ended on another origin, or on an obvious sign-in page.
const checkSession = async (requested, when = 'after load') => {
  const here = await ask('signin');
  if (!here?.url) return;
  const want = new URL(requested);
  const got = new URL(here.url);
  const fix = `Run scripts/chrome.sh --login ${requested}, sign in, then run scripts/chrome.sh again to go back to background mode.`;
  if (got.origin !== want.origin && !args['allow-redirect'])
    await die(`the page ended on ${got.origin}${got.pathname} instead of ${want.origin} ${when}. That is usually a sign-in redirect. ${fix}`, 3);
  const asked = SIGNIN_NAMED.test(want.pathname);
  if (!asked && got.pathname !== want.pathname && (here.named || here.pw))
    await die(`${got.href} looks like a sign-in page. ${fix}`, 3);
};

// ---------------------------------------------------------------- stills

if (mode === 'shot') {
  await loadPage(args.url);
  await sleep(+(args.wait ?? 3) * 1000);
  await checkSession(args.url);
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(out, Buffer.from(data, 'base64'));
  const leaked = await evaluate('window.__cap_hide_check ? __cap_hide_check() : 0');
  if (leaked) warn(`${leaked} dev overlay element(s) are still visible; pass --hide "<css>" for them`);
  await succeed(`saved ${out} (${width * scale}x${height * scale}, wall ${wallSec().toFixed(1)}s)`, { file: out, width, height });
}

// ---------------------------------------------------------------- steps

// A step that could not run. `target` is what it pointed at, so the report can
// list what is on screen instead.
class StepError extends Error {
  constructor(index, step, message, target = null) {
    super(message);
    this.index = index;
    this.step = step;
    this.target = target;
  }
}

// Steps run on page time: "wait": 1 waits one second of page time.
const takeClock = { start: Date.now() };
const pageNow = () => (Date.now() - takeClock.start) / 1000 / SLOW;
const pageUntil = async (t) => {
  const ms = (t - pageNow()) * 1000 * SLOW;
  if (ms > 1) await sleep(ms);
};
// A dry run rehearses at full speed: waits shrink, glides become one move.
const pageSleep = (sec) => sleep(DRY || mode === 'scout' ? Math.min(sec * 200, 500) : sec * 1000 * SLOW);
const rehearse = DRY || mode === 'scout';
// Missed targets are waited for in wall time, bounded.
const findLimitMs = () => (rehearse ? 3000 : Math.min(5 * SLOW, 10) * 1000);

const events = [];
const path = []; // the drawn cursor, sample by sample
const motion = []; // [wall start, wall end] of every stretch the cursor was moving
let pos = [0, 0];
let pressed = false;
let shape = 'arrow';
const log = (type, data = {}) => events.push({ type, wall: Date.now() / 1000, ...data });
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

// The pointer: the drawn cursor is told where it is by this script, in the
// same breath as the synthetic event is dispatched.
const mouse = async (type, x, y) => {
  const call = type === 'mouseMoved' ? 'move' : type === 'mousePressed' ? 'down' : 'up';
  if (type === 'mousePressed') pressed = true;
  if (type === 'mouseReleased') pressed = false;
  if (cursorOn) {
    const r = await send('Runtime.evaluate', {
      expression: `window.__cap_cursor_api ? __cap_cursor_api.${call}(${x}, ${y}) : null`, returnByValue: true,
    }).catch(() => null);
    if (typeof r?.result?.value === 'string') shape = r.result.value;
    // About 60 samples a second is plenty for drawing it again later.
    const now = Date.now() / 1000;
    const prev = path.at(-1);
    if (!prev || type !== 'mouseMoved' || shape !== prev.shape || (now - prev.wall) / SLOW >= 0.0155)
      path.push({ wall: now, x, y, shape, pressed });
  }
  await send('Input.dispatchMouseEvent', {
    type, x, y,
    button: type === 'mouseMoved' ? 'none' : 'left',
    clickCount: type === 'mouseMoved' ? 0 : 1,
  });
};

// A point from {x, y} or {selector, at: [fx, fy]}, where fractions are of the
// element's box and may go outside 0..1 to point around it.
// Elements that mount a beat later (a sheet sliding in, a menu opening) are
// waited for, up to 5 s of page time but never more than 10 s of wall time.
const describe = (p) => (p.text ? `text "${p.text}"` : p.selector ? `selector ${p.selector}` : JSON.stringify(p));
const resolveBox = async (p, op = 'point') => {
  if (!p || (!p.selector && !p.text)) return null;
  const until = Date.now() + findLimitMs();
  for (;;) {
    const r = await ask(op, p);
    if (op === 'box') {
      if (r) return r;
    } else {
      if (r?.bad) throw new StepError(-1, null, `invalid selector ${p.selector}: ${r.bad}`, p);
      if (r?.box) return r.box;
    }
    if (Date.now() > until)
      throw new StepError(-1, null, p.text ? `no visible element with text "${p.text}"` : `no visible element for selector ${p.selector}`, p);
    await sleep(100);
  }
};
const resolvePoint = async (p) => {
  if (p.selector || p.text) {
    const box = await resolveBox(p);
    if (p.text) return [box[0] + box[2] / 2, box[1] + box[3] / 2];
    const [fx, fy] = p.at ?? [0.5, 0.5];
    return [box[0] + box[2] * fx, box[1] + box[3] * fy];
  }
  return [p.x, p.y];
};

const STEP_MS = 8;
const moveTo = async ([x, y], sec) => {
  const [x0, y0] = pos;
  if (rehearse) {
    pos = [x, y];
    return mouse('mouseMoved', x, y);
  }
  // A step every STEP_MS of page time, twice per output frame, so a step lands
  // in every 1/60 s slot even when one runs late. The glide follows the clock,
  // not a step count: a slow round trip costs a frame, never length.
  const w0 = Date.now() / 1000;
  const t0 = pageNow();
  for (;;) {
    const e = (pageNow() - t0) / sec;
    const k = ease(Math.min(1, e));
    pos = [x0 + (x - x0) * k, y0 + (y - y0) * k];
    await mouse('mouseMoved', ...pos);
    if (e >= 1) break;
    await pageUntil(t0 + (Math.floor(((pageNow() - t0) * 1000) / STEP_MS) + 1) * STEP_MS / 1000);
  }
  motion.push([w0, Date.now() / 1000]);
};

const click = async (box = null) => {
  log('click', { x: pos[0], y: pos[1], box });
  await mouse('mousePressed', ...pos);
  await pageSleep(0.09);
  await mouse('mouseReleased', ...pos);
};

// Characters at a human pace: about 14 a second, a little uneven (the
// unevenness is fixed, so retakes match), with a breath after spaces.
const typeText = async (text, cps = 14) => {
  const box = await ask('focused');
  if (!box) warn(`type "${text.slice(0, 20)}": nothing has focus, so the text goes nowhere (click the field first)`);
  log('type-start', { box, text });
  let due = pageNow();
  for (const [i, ch] of [...text].entries()) {
    await send('Input.insertText', { text: ch });
    const jitter = 0.7 + ((i * 37) % 11) / 18;
    due += (1 / cps) * jitter * (ch === ' ' ? 1.6 : 1);
    await pageUntil(due);
  }
  log('type-end', { box });
};

// Wait for a selector or text to appear (or go away). The timeout is page
// time, but it is bounded in wall time: a miss costs seconds, not a minute.
const waitFor = async ({ selector, text, state = 'visible', timeout = 8 }) => {
  const wallMs = (rehearse ? Math.min(timeout, 5) : Math.min(timeout * SLOW, 30)) * 1000;
  const until = Date.now() + wallMs;
  for (;;) {
    const seen = await ask('seen', { selector, text });
    if (state === 'hidden' ? !seen : seen) return;
    if (Date.now() > until) {
      throw new StepError(-1, null,
        `waitFor ${selector ?? `text "${text}"`} (${state}) did not happen within ${timeout} s of page time (${(wallMs / 1000).toFixed(0)} s of wall time)`,
        selector || text ? { selector, text } : null);
    }
    await sleep(100);
  }
};

const runSteps = async () => {
  for (const [i, s] of steps.entries()) {
    try {
      // Tell auto-camera to pull back out here (a panel or page opens). Logged
      // before the step's wait, so the pull-out starts with the change.
      if (s.camera === 'wide') log('wide');
      if (s.wait) await pageSleep(s.wait);
      if (s.waitFor) await waitFor(s.waitFor);
      if (s.redact)
        await evaluate(`document.querySelectorAll(${JSON.stringify(s.redact)}).forEach((e) => (e.style.filter = 'blur(7px)'))`);
      // "look": false records where something is (for a callout) without
      // drawing the camera to it, e.g. a toast while the shot stays wide.
      if (s.mark) {
        const target = s.target ?? s.move ?? s.click ?? {};
        const box = target.selector || target.text ? await resolveBox(target, 'box') : null;
        log('mark', { label: s.mark, box, ...(s.look === false ? { look: false } : {}) });
      }
      if (s.move) await moveTo(await resolvePoint(s.move), s.dur ?? 0.8);
      if (s.click) {
        const target = typeof s.click === 'object' ? s.click : null;
        if (target) await moveTo(await resolvePoint(target), s.dur ?? 0.6);
        await click(target && (target.selector || target.text) ? await resolveBox(target, 'box').catch(() => null) : null);
      }
      if (s.type) {
        if (s.instant || rehearse) {
          if (!(await ask('focused'))) warn(`step ${i}: nothing has focus, so the text goes nowhere (click the field first)`);
          await send('Input.insertText', { text: s.type });
        } else await typeText(s.type, s.cps);
      }
      if (s.key) {
        log('key', { key: s.key });
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: s.key });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: s.key });
      }
      if (s.scroll) {
        log('scroll', { x: pos[0], y: pos[1], dy: s.scroll });
        const w0 = Date.now() / 1000;
        const t0 = pageNow();
        const dur = s.dur ?? 0.8;
        let sent = 0;
        for (;;) {
          const f = rehearse ? 1 : Math.min(1, (pageNow() - t0) / dur);
          const dy = s.scroll * f - sent;
          sent += dy;
          await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: pos[0], y: pos[1], deltaX: 0, deltaY: dy });
          if (f >= 1) break;
          await pageUntil(t0 + (Math.floor(((pageNow() - t0) * 1000) / STEP_MS) + 1) * STEP_MS / 1000);
        }
        if (!rehearse) motion.push([w0, Date.now() / 1000]);
      }
      if (s.eval) await evaluate(s.eval, `step ${i} eval`, { fatal: !!s.fatal });
    } catch (e) {
      if (e instanceof StepError) {
        e.index = i;
        e.step = s;
        throw e;
      }
      throw new StepError(i, s, e.message);
    }
  }
};

// What a failed step leaves behind: which step, what it wanted, what is on
// screen that looks like it, and a screenshot.
const reportStep = async (e) => {
  const lines = [`step ${e.index}: ${JSON.stringify(e.step)}`, `  ${e.message}`];
  if (e.target && (e.target.selector || e.target.text)) {
    const cands = await ask('candidates', e.target).catch(() => []);
    if (cands?.length) {
      lines.push('  closest visible elements:');
      for (const c of cands)
        lines.push(`    ${c.role.padEnd(14)} ${JSON.stringify(c.name).padEnd(34)} ${JSON.stringify(c.target)}  [${c.box.join(', ')}]`);
    } else lines.push('  nothing visible looks like it');
  }
  const shotPath = out && mode !== 'scout' ? `${out}.miss.png` : join(process.cwd(), 'capture-miss.png');
  try {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(shotPath, Buffer.from(data, 'base64'));
    lines.push(`  screenshot: ${shotPath}`);
  } catch {}
  console.error(lines.join('\n'));
};

// ---------------------------------------------------------------- dry run, scout

// Sets the page up the way a take would find it, without recording.
const warmUp = async () => {
  await loadPage(args.url);
  await checkSession(args.url);
  if (typeof args.setup === 'string') {
    await sleep(600);
    const result = await evaluate(args.setup, 'setup');
    console.error(`setup: ${JSON.stringify(result) ?? 'done'}`);
  }
};

if (DRY || mode === 'scout') {
  await warmUp();
  pos = [width * 0.9, height * 0.92];
  try {
    await runSteps();
  } catch (e) {
    if (!(e instanceof StepError)) throw e;
    await reportStep(e);
    await die(`step ${e.index} failed: ${e.message}`);
  }
  if (DRY) {
    const n = steps.length;
    await succeed(`dry run OK: ${n} step${n === 1 ? '' : 's'} ran and every target resolved (${wallSec().toFixed(1)}s)`,
      { dryRun: true, steps: n });
  }
  // scout: one call, everything an agent needs to write a steps file.
  await sleep(500);
  const found = await ask('scout', { max: 80 });
  const shotPath = out ?? join(tmpdir(), `scout-${process.pid}.png`);
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(shotPath, Buffer.from(data, 'base64'));
  const rows = found.items.map((c) => {
    const [x, y, w, h] = c.box;
    return `${c.role.slice(0, 16).padEnd(16)} ${JSON.stringify(c.name).slice(0, 40).padEnd(40)} ${JSON.stringify(c.target).padEnd(46)} [${x},${y} ${w}x${h}]`;
  });
  if (args.json) console.error(rows.join('\n'));
  else {
    console.log(`${found.title || '(untitled)'}  ${found.url}  viewport ${found.view[0]}x${found.view[1]}`);
    console.log('role             visible text or name                     step target (paste into a step)                [x,y wxh]');
    console.log(rows.join('\n'));
    if (found.more) console.log(`... and ${found.more} more`);
  }
  await succeed(`saved ${shotPath} (${found.items.length} interactive elements, wall ${wallSec().toFixed(1)}s)`,
    { file: shotPath, elements: found.items });
}

// ---------------------------------------------------------------- clips

if (!durationSec) await die('clip needs --duration <seconds>', 2);

// One screencast, streamed to ffmpeg: frames are stamped in page time (their
// own timestamps divided by the slowdown) and handed over as they arrive.
// Returns what the take needs afterwards.
const startSink = ({ file, nullOut = false }) => {
  const times = [];
  let enc = null;
  let t0 = null;
  let lastT = -1;
  let size = null;
  let failure = null;
  let chain = Promise.resolve();
  let dropped = 0;
  const onFrame = (m) => {
    if (m.method !== 'Page.screencastFrame') return;
    const { data, metadata, sessionId } = m.params;
    const buf = Buffer.from(data, 'base64');
    const mine = (chain = chain.then(async () => {
      if (failure) return;
      if (t0 === null) t0 = metadata.timestamp;
      const t = (metadata.timestamp - t0) / SLOW;
      // Frames can arrive a few ms out of order (seen right after a --setup
      // navigation); a stale one cannot be shown after a newer one.
      if (t <= lastT) { dropped++; return; }
      if (!enc) {
        size = imageSize(buf);
        enc = startEncoder({ out: file, w: size[0], h: size[1], fps, crf, encoder, png: lossless, nullOut });
      }
      lastT = t;
      times.push(t);
      await enc.push(buf, t);
    }).catch((e) => { failure = e; }));
    // The ack is what lets Chrome send the next frame, so it waits for ffmpeg
    // to have taken this one: backpressure, not a growing queue.
    mine.then(() => send('Page.screencastFrameAck', { sessionId }).catch(() => {}));
  };
  tab.on(onFrame);
  return {
    times,
    get t0() { return t0; },
    get size() { return size; },
    get dropped() { return dropped; },
    async begin() {
      await send('Page.startScreencast', {
        format: lossless ? 'png' : 'jpeg',
        ...(lossless ? {} : { quality: jpegQuality }),
        maxWidth: Math.round(width * scale), maxHeight: Math.round(height * scale),
        everyNthFrame: 1,
        // Chrome sends at most this many frames before it needs an ack; the
        // default of 3 starves the pipeline (measured: roughly 35 versus 55
        // frames a second).
        maxFramesInFlight: 8,
      });
    },
    async end(endSec) {
      await send('Page.stopScreencast').catch(() => {});
      await chain;
      tab.off(onFrame);
      if (failure) throw failure;
      if (enc) await enc.finish(endSec);
    },
    abort() { try { enc?.abort(); } catch {} },
  };
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
  return [Math.round(width * scale), Math.round(height * scale)];
};

// How fast this Chrome paints at this size, in frames per wall second, through
// the real pipeline (ffmpeg included) with the null output. A tiny element
// repaints every frame, so every frame is a distinct one.
const measureRate = async () => {
  await evaluate(`(() => {
    const d = document.createElement('div');
    d.id = '__cap_probe';
    // Full-viewport and re-tinted every frame: the whole frame is repainted
    // and re-encoded, like the busiest moment of a take.
    d.style.cssText = 'position:fixed;inset:0;z-index:2147483640;pointer-events:none';
    (document.body || document.documentElement).appendChild(d);
    let k = 0;
    const tick = () => { d.style.background = 'rgba(128,128,128,' + (k++ % 2 ? 0.02 : 0.04) + ')'; requestAnimationFrame(tick); };
    tick();
  })()`);
  const savedSlow = SLOW;
  SLOW = 1;
  const probe = startSink({ file: '', nullOut: true });
  await probe.begin();
  await sleep(2200);
  const stamped = probe.times.slice();
  await probe.end(stamped.at(-1) ?? 0).catch(() => {});
  SLOW = savedSlow;
  await evaluate("document.getElementById('__cap_probe')?.remove()");
  const body = stamped.filter((t) => t > 0.4);
  if (body.length < 6) return 0;
  return (body.length - 1) / (body.at(-1) - body[0]);
};

const pickSlowFor = async () => {
  const cfg = { w: width, h: height, dsf: scale, format: lossless ? 'png' : `jpeg${jpegQuality}`, encoder, headless: tab.headless };
  const others = await otherPages(port, tab.targetId);
  let rate = !others.length && !args.recalibrate ? cachedRate(cfg) : null;
  let how = 'cached';
  if (!rate) {
    rate = await measureRate();
    how = 'measured';
    if (rate > 0 && !others.length) storeRate(cfg, rate);
  }
  const slow = pickSlow(rate);
  say(`slow ${slow}x (${how} ${rate.toFixed(0)} frames a second${others.length ? `, ${others.length} other tab(s) busy` : ''})`);
  return slow;
};

// Distinct painted frames per second of video, over the stretches where the
// cursor was moving (a still page paints nothing, and that is fine). Counted in
// output-frame slots, so it cannot exceed fps.
const distinctFps = (times, windows) => {
  const total = windows.reduce((a, [s, e]) => a + (e - s), 0);
  if (total < 0.4) return null;
  const slots = new Set();
  for (const t of times) {
    const slot = Math.round(t * fps);
    if (windows.some(([s, e]) => t >= s && t <= e)) slots.add(slot);
  }
  return Math.min(fps, slots.size / total);
};

let clockId = null;
let cursorId = null;
const tmpOut = out ? join(dirname(out), `.${basename(out, extname(out))}.${process.pid}.part${extname(out) || '.mp4'}`) : null;

const takeOnce = async () => {
  events.length = 0;
  path.length = 0;
  motion.length = 0;
  pos = [width * 0.9, height * 0.92];
  pressed = false;
  shape = 'arrow';
  if (clockId) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: clockId });
  if (cursorId) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: cursorId });
  clockId = cursorId = null;
  if (SLOW > 1) clockId = (await send('Page.addScriptToEvaluateOnNewDocument', { source: clockScript(SLOW) })).identifier;
  if (cursorOn)
    cursorId = (await send('Page.addScriptToEvaluateOnNewDocument', {
      source: cursorScript({ scale: cursorScale, ripple: !args['no-ripple'], guard: !args['no-guard'] && !args.mobile }),
    })).identifier;
  await send('Animation.enable');
  await send('Animation.setPlaybackRate', { playbackRate: 1 / SLOW });

  sink = startSink({ file: tmpOut });
  await sink.begin();
  takeClock.start = Date.now();
  await send('Page.navigate', { url: args.url });
  // A take that has not finished well past its length is stuck.
  const watchdog = setTimeout(() => die(`the take ran ${((Date.now() - takeClock.start) / 1000).toFixed(0)} s of wall time and is not finished (stuck step?)`),
    (durationSec * SLOW * 1.5 + 90) * 1000);
  const stepsRun = runSteps();
  stepsRun.catch(() => {});
  const failed = new Promise((_, rej) => stepsRun.catch(rej));
  try {
    await Promise.race([pageUntil(durationSec), failed]);
    await stepsRun;
  } catch (e) {
    clearTimeout(watchdog);
    if (e instanceof StepError) {
      await reportStep(e);
      await die(`step ${e.index} failed: ${e.message}`);
    }
    throw e;
  }
  clearTimeout(watchdog);
  const leaked = await evaluate('window.__cap_hide_check ? __cap_hide_check() : 0').catch(() => 0);
  if (leaked) warn(`${leaked} dev overlay element(s) were still visible at the end; pass --hide "<css>" for them`);
  await checkSession(args.url, 'at the end of the take');
  const nFrames = sink.times.length;
  const t0 = sink.t0;
  const endSec = Math.max((sink.times.at(-1) ?? 0) + 0.2, durationSec);
  if (nFrames > 2) await sink.end(endSec);
  else await sink.end(0).catch(() => {});
  await send('Animation.setPlaybackRate', { playbackRate: 1 });
  return { times: sink.times.slice(), t0, endSec, size: sink.size, dropped: sink.dropped };
};

// ---------------------------------------------------------------- run the take

await warmUp();
if (AUTO) SLOW = await pickSlowFor();

let take;
let retriedSlower = false;
for (let attempt = 1; ; attempt++) {
  take = await takeOnce().catch(async (e) => {
    if (e instanceof StepError) throw e;
    await die(e?.message ?? String(e));
  });
  // A screencast occasionally delivers nothing (tab not composited yet): retry.
  if (take.times.length <= 2) {
    if (attempt >= 3) await die('empty take: the screencast produced no frames (tab not painting?)');
    console.error(`attempt ${attempt}: no frames, retrying`);
    continue;
  }
  const toVideo = (wall) => Math.max(0, (wall - take.t0) / SLOW);
  if (process.env.CAP_DEBUG) writeFileSync(process.env.CAP_DEBUG, JSON.stringify({ times: take.times, motion: motion.map(([s, e]) => [toVideo(s), toVideo(e)]) }));
  take.fpsDistinct = distinctFps(take.times, motion.map(([s, e]) => [toVideo(s), toVideo(e)]));
  // Never hand back a choppy clip silently.
  if (take.fpsDistinct !== null && take.fpsDistinct < 50 && AUTO && !retriedSlower) {
    retriedSlower = true;
    const slower = Math.min(10, Math.ceil(SLOW * (60 / Math.max(take.fpsDistinct, 8)) * 1.1 * 2) / 2);
    console.error(`only ${take.fpsDistinct.toFixed(0)} distinct frames per second at ${SLOW}x; retrying at ${slower}x`);
    rmSync(tmpOut, { force: true });
    SLOW = slower;
    continue;
  }
  break;
}

const [fw, fh] = [Math.round(take.size[0] / 2) * 2, Math.round(take.size[1] / 2) * 2];
const wantW = Math.round(width * scale);
if (take.size[0] < wantW * 0.98)
  warn(`frames are ${take.size[0]}px wide, not ${wantW}: this Chrome renders at ${(take.size[0] / width).toFixed(1)}x. ` +
    `Restart it at that scale (SCALE=${scale} scripts/chrome.sh --stop; SCALE=${scale} scripts/chrome.sh) or pass --scale ${(take.size[0] / width).toFixed(0)}`);
if (take.fpsDistinct !== null && take.fpsDistinct < 58)
  warn(`only ${take.fpsDistinct.toFixed(0)} distinct frames per second of motion: the clip may look choppy${AUTO ? '' : ' (try --slow auto, or a larger --slow)'}`);
if (take.dropped) warn(`${take.dropped} stale screencast frame(s) dropped`);

renameSync(tmpOut, out);
const bytes = statSync(out).size;

// Times in video seconds; positions as fractions of the frame, so the file
// still lines up after any resize.
const toVideo = (wall) => Math.max(0, (wall - take.t0) / SLOW);
const nbox = (b) => (b ? [b[0] / width, b[1] / height, b[2] / width, b[3] / height].map((v) => +v.toFixed(4)) : null);
const timeline = events.map(({ wall, x, y, box, ...rest }) => ({
  ...rest,
  t: +toVideo(wall).toFixed(3),
  ...(x !== undefined ? { x: +(x / width).toFixed(4), y: +(y / height).toFixed(4) } : {}),
  ...(box !== undefined ? { box: nbox(box) } : {}),
}));
const cursor = path.map((p) => ({
  t: +toVideo(p.wall).toFixed(3), x: +(p.x / width).toFixed(4), y: +(p.y / height).toFixed(4), shape: p.shape, pressed: p.pressed,
}));
// The cursor path goes on one line a sample so the file stays readable.
const head = JSON.stringify({
  width, height, duration: +take.endSec.toFixed(3), fps, slow: SLOW,
  ...(take.fpsDistinct !== null ? { distinctFps: +take.fpsDistinct.toFixed(1) } : {}),
  events: timeline,
}, null, 1);
const eventsFile = `${out}.events.json`;
const eventsTmp = `${eventsFile}.${process.pid}.tmp`;
writeFileSync(eventsTmp, `${head.slice(0, -2)},\n "cursor": [\n${cursor.map((c) => `  ${JSON.stringify(c)}`).join(',\n')}\n ]\n}\n`);
renameSync(eventsTmp, eventsFile);
say(`events ${eventsFile} (${timeline.length} events, ${cursor.length} cursor samples)`);

if (args.sheet) {
  const cols = 5, rows = Math.ceil(take.endSec / cols);
  // Keyframes come every half second, so decoding only those is plenty for a
  // one-per-second sheet and takes a fraction of the time.
  spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-skip_frame', 'nokey', '-i', out,
    '-vf', `fps=1,scale=480:-1,tile=${cols}x${rows}`, '-frames:v', '1', `${out}.sheet.png`]);
  say(`sheet ${out}.sheet.png`);
}

const dist = take.fpsDistinct === null ? 'n/a' : take.fpsDistinct.toFixed(0);
await succeed(
  `saved ${out} (${fw}x${fh}, ${take.endSec.toFixed(1)}s, ${dist} distinct fps, slow ${SLOW}x, ${(bytes / 1e6).toFixed(1)} MB, wall ${wallSec().toFixed(1)}s)`,
  {
    file: out, events: eventsFile, width: fw, height: fh, durationSec: +take.endSec.toFixed(2),
    distinctFps: take.fpsDistinct === null ? null : +take.fpsDistinct.toFixed(1), paintedFrames: take.times.length, slow: SLOW, bytes,
  },
);
