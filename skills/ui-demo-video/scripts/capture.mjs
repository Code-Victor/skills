#!/usr/bin/env node
// Record crisp, smooth clips and stills of a web page through the Chrome
// DevTools Protocol. Needs Node 22+ (global WebSocket) and ffmpeg.
//
//   node capture.mjs shot --url <url> --out shot.png [--wait 3]
//   node capture.mjs clip --url <url> --out clip.mp4 --duration 6 [--steps steps.json]
//
// Run scripts/chrome.sh first (or any Chrome started with
// --remote-debugging-port). Each run opens its own tab and closes it after.
//
// How a clip stays sharp and smooth:
//   - 2x device pixels, lossless PNG frames (JPEG smears thin lines and text).
//   - The page's clock runs --slow times slower while Chrome paints, so it can
//     keep up at 2x; frames are re-timed back to real speed afterwards.
//     Everything driven by timers, rAF, CSS or Web Animations slows together.
//     Network does NOT slow down, so use --slow 1 when real waiting time is
//     the point of the clip (a spinner that hangs for 8 seconds).
//   - A drawn cursor, because screencasts don't include the OS pointer. It
//     turns into a hand over links and buttons, an I-beam over text fields,
//     and leaves a soft ripple where it clicks.
//   - Every clip also writes <out>.events.json: where and when each click,
//     typing run, key, scroll and mark happened, in video seconds and as
//     fractions of the frame. scripts/auto-camera.mjs turns it into camera
//     moves and callouts, the way a screen-recording editor auto-zooms.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// ---------------------------------------------------------------- arguments

const [mode, ...rest] = process.argv.slice(2);
const args = {};
for (let i = 0; i < rest.length; i++) {
  const key = rest[i].replace(/^--/, '');
  const next = rest[i + 1];
  if (next === undefined || next.startsWith('--')) {
    args[key] = true;
  } else {
    args[key] = next;
    i++;
  }
}

if (!['shot', 'clip'].includes(mode) || !args.url || !args.out) {
  console.error(`Usage:
  capture.mjs shot --url <url> --out <file.png> [--wait 3]
  capture.mjs clip --url <url> --out <file.mp4> --duration <sec> [--steps steps.json]

Options:
  --port 9222            Chrome remote-debugging port
  --width --height       viewport in CSS px. Default: what this screen shows in
                         a maximized browser window, so takes match the app
                         as you see it. Set both for a fixed size (1440 900)
  --scale 2              device pixel ratio (frames are width*scale wide)
  --allow-temp           allow --out under /tmp or a session scratchpad
                         (emptied on restart; recordings there get lost)
  --slow 5               clock dilation for clips (1 = real time)
  --fps 60 --crf 12      output frame rate and x264 quality (lower = better)
  --steps <file.json>    scripted cursor / clicks / typing (see references/steps.md)
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
  --dark                 emulate prefers-color-scheme: dark`);
  process.exit(1);
}

const port = +(args.port ?? 9222);
// Set once the tab is open (measured from the screen unless given).
let width = +(args.width ?? 0);
let height = +(args.height ?? 0);
const scale = +(args.scale ?? 2);
const SLOW = mode === 'clip' ? Math.max(1, +(args.slow ?? 5)) : 1;
const fps = +(args.fps ?? 60);
const crf = String(args.crf ?? 12);
const out = resolve(args.out);
// Recordings can't be re-rendered, only re-recorded, so never write them
// where a restart deletes them: /tmp, macOS's per-user temp, or an agent's
// session scratchpad.
const TEMP = /^(\/private)?\/tmp\/|^(\/private)?\/var\/folders\/|\/scratchpad\//;
if (TEMP.test(out) && !args['allow-temp']) {
  console.error(`--out ${out} is in a temporary folder that is emptied on restart.
Record into a folder that lasts, e.g. ~/Downloads/<name>-demo/clips/ (or pass --allow-temp for a throwaway take).`);
  process.exit(1);
}
const steps = args.steps ? JSON.parse(readFileSync(args.steps, 'utf8')) : [];
const cursorScale = +(args['cursor-scale'] ?? 1.25);
const REDACT = typeof args.redact === 'string' ? args.redact : '';

// Framework dev overlays that never belong in a demo.
const HIDE = [
  'nextjs-portal',
  '[data-nextjs-toast]',
  '[data-nextjs-dev-tools-button]',
  'vite-error-overlay',
  '#webpack-dev-server-client-overlay',
  '[data-nextjs-dev-overlay]',
  // Agentation's feedback toolbar (a common dev-only annotation widget).
  '[data-feedback-toolbar]',
  ...(typeof args.hide === 'string' ? [args.hide] : []),
].join(', ');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- CDP

const base = `http://127.0.0.1:${port}`;
let target;
try {
  target = await (await fetch(`${base}/json/new?about:blank`, { method: 'PUT' })).json();
} catch {
  console.error(`No Chrome on port ${port}. Start one with scripts/chrome.sh.`);
  process.exit(1);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
let nextId = 0;
const pending = new Map();
const listeners = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  } else listeners.forEach((fn) => fn(m));
};
await new Promise((r) => (ws.onopen = r));

const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++nextId;
    pending.set(id, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });

const closeTab = async () => {
  try { ws.close(); } catch {}
  await fetch(`${base}/json/close/${target.id}`).catch(() => {});
};

// ---------------------------------------------------------------- page setup

const hideScript = `(() => {
  const css = ${JSON.stringify(
    `${HIDE} { display: none !important; }` +
      (REDACT ? ` ${REDACT} { filter: blur(7px) !important; }` : ''),
  )};
  const add = () => {
    if (document.getElementById('__cap_hide')) return;
    // This runs before <html> exists on a new document. Without the guard the
    // first call threw, which also skipped every listener below, so the rule
    // was never added at all.
    const root = document.head || document.documentElement;
    if (!root) return;
    const s = document.createElement('style');
    s.id = '__cap_hide';
    s.textContent = css;
    root.appendChild(s);
  };
  add();
  document.addEventListener('DOMContentLoaded', add);
  // Frameworks that manage <head> (Next.js hydration) remove tags they did
  // not render, which silently brought the overlays back mid-take. Re-add
  // the rule whenever it goes missing.
  new MutationObserver(add).observe(document, { childList: true, subtree: true });
  if (${!!args['hide-floating']}) {
    const keep = ${JSON.stringify(typeof args.keep === 'string' ? args.keep : '')};
    setInterval(() => {
      for (const el of document.querySelectorAll('body *')) {
        if (el.id === '__cap_cursor' || getComputedStyle(el).position !== 'fixed') continue;
        if (keep && el.closest(keep)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 140 && r.height < 140) el.style.visibility = 'hidden';
      }
    }, 150);
  }
})();`;

// Everything that tells time, slowed by N. rAF callbacks get the slowed
// timestamp so animation libraries see a consistent clock.
const clockScript = (n) => `(() => {
  const N = ${n};
  const pn = performance.now.bind(performance), p0 = pn();
  performance.now = () => p0 + (pn() - p0) / N;
  const dn = Date.now, d0 = dn();
  Date.now = () => d0 + (dn() - d0) / N;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf(() => cb(performance.now()));
  const st = window.setTimeout.bind(window), si = window.setInterval.bind(window);
  window.setTimeout = (fn, ms = 0, ...a) => st(fn, ms * N, ...a);
  window.setInterval = (fn, ms = 0, ...a) => si(fn, ms * N, ...a);
})();`;

// The cursor re-attaches itself on every move: frameworks that hydrate the
// whole document (React on <html>) remove nodes they didn't render.
const cursorScript = `(() => {
  // Arrow, hand and I-beam, picked from the CSS cursor under the pointer,
  // the way the real pointer would change.
  const S = ${cursorScale};
  const shapes = {
    arrow: [22, 28, 2, 2, '<path d="M2 2 L2 22 L7.5 17 L11 25.5 L14.5 24 L11 15.8 L18.5 15.8 Z" fill="black" stroke="white" stroke-width="1.6" stroke-linejoin="round"/>'],
    hand: [24, 28, 9, 2, '<path d="M9.5 2.6c1.2 0 2 .9 2 2v7.1l.9-.1c1 0 1.7.6 1.9 1.4l.6-.1c1 0 1.7.6 1.9 1.5h.4c1.1 0 2 .9 2 2v4.2c0 3.6-2.7 6.4-6.2 6.4h-2.6c-2 0-3.6-1-4.7-2.6l-3.4-5.1c-.6-.9-.4-2 .4-2.6.8-.6 1.9-.5 2.6.2l2.2 2.2V4.6c0-1.1.9-2 2-2z" fill="white" stroke="black" stroke-width="1.5" stroke-linejoin="round"/>'],
    text: [12, 24, 6, 12, '<path d="M2.5 2.5c1.8 0 2.9.6 3.5 1.6.6-1 1.7-1.6 3.5-1.6M6 4.1v15.8M2.5 21.5c1.8 0 2.9-.6 3.5-1.6.6 1 1.7 1.6 3.5 1.6M4 12h4" fill="none" stroke="white" stroke-width="3.4" stroke-linecap="round"/><path d="M2.5 2.5c1.8 0 2.9.6 3.5 1.6.6-1 1.7-1.6 3.5-1.6M6 4.1v15.8M2.5 21.5c1.8 0 2.9-.6 3.5-1.6.6 1 1.7 1.6 3.5 1.6M4 12h4" fill="none" stroke="black" stroke-width="1.5" stroke-linecap="round"/>'],
  };
  let c, shape = '', last = null;
  const ensure = () => {
    if (!c) {
      c = document.createElement('div');
      c.id = '__cap_cursor';
      c.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;display:none;filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.35));transition:scale 90ms ease-out;transform-origin:0 0';
    }
    if (!c.isConnected) (document.body || document.documentElement).appendChild(c);
    return c;
  };
  const setShape = (name) => {
    if (name === shape) return;
    shape = name;
    const [w, h, hx, hy] = shapes[name];
    const el = ensure();
    el.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w * S + '" height="' + h * S + '" viewBox="0 0 ' + w + ' ' + h + '">' + shapes[name][4] + '</svg>';
    // Keep the hotspot where it was when the shape changes in place.
    if (last) el.style.translate = (last[0] - hx * S) + 'px ' + (last[1] - hy * S) + 'px';
  };
  const kind = (x, y) => {
    const el = document.elementFromPoint(x, y);
    const cur = el ? getComputedStyle(el).cursor : 'auto';
    if (cur === 'pointer') return 'hand';
    if (cur === 'text' || (el && el.matches('input:not([type=checkbox]):not([type=radio]), textarea, [contenteditable=""], [contenteditable=true]'))) return 'text';
    return 'arrow';
  };
  // The page can change under a still pointer (a button that disappears
  // after its click); re-check the shape the way the OS pointer would.
  setInterval(() => {
    if (last && c && c.style.display === 'block') setShape(kind(last[0], last[1]));
  }, 120);
  addEventListener('mousemove', (e) => {
    last = [e.clientX, e.clientY];
    setShape(kind(e.clientX, e.clientY));
    const el = ensure();
    const [, , hx, hy] = shapes[shape];
    el.style.display = 'block';
    el.style.translate = (e.clientX - hx * S) + 'px ' + (e.clientY - hy * S) + 'px';
  }, true);
  addEventListener('mousedown', (e) => {
    ensure().style.scale = '0.86';
    if (!${!args['no-ripple']}) return;
    // A soft ring where the click landed: reads on video, gone in 450 ms.
    const r = document.createElement('div');
    r.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;left:' + e.clientX + 'px;top:' + e.clientY + 'px;width:' + 34 * S + 'px;height:' + 34 * S + 'px;margin:' + -17 * S + 'px 0 0 ' + -17 * S + 'px;border-radius:50%;background:rgba(59,107,255,.16);box-shadow:0 0 0 2px rgba(59,107,255,.55)';
    (document.body || document.documentElement).appendChild(r);
    // Driven by rAF on performance.now(), which the slowed clock patches:
    // element.animate() isn't slowed and would be gone in one frame.
    const born = performance.now();
    const tick = () => {
      const k = Math.min(1, (performance.now() - born) / 480);
      const e = 1 - Math.pow(1 - k, 3);
      r.style.scale = String(0.35 + 0.65 * e);
      r.style.opacity = String(1 - k * k);
      if (k < 1) requestAnimationFrame(tick); else r.remove();
    };
    requestAnimationFrame(tick);
  }, true);
  addEventListener('mouseup', () => { ensure().style.scale = '1'; }, true);
})();`;

await send('Page.enable');
await send('Runtime.enable');

// The viewport the app has in a maximized window on this screen: the screen's
// usable area less the browser's own toolbars. A fixed size (the old 1440x900)
// lays the app out narrower than the person sees it on a bigger display.
if (args.mobile) {
  width ||= 390;
  height ||= 844;
}
if (!width || !height) {
  const r = await send('Runtime.evaluate', {
    expression: '({ w: screen.availWidth, h: screen.availHeight, bar: outerHeight - innerHeight })',
    returnByValue: true,
  });
  const m = r?.result?.value ?? {};
  const bar = m.bar > 0 && m.bar < 200 ? m.bar : 87;
  width ||= m.w > 0 ? m.w : 1440;
  height ||= m.h > bar ? m.h - bar : 900;
  console.log(`viewport ${width}x${height} at ${scale}x: this screen, browser maximized (--width/--height to change)`);
}
await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: !!args.mobile });
if (args.mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
if (args.dark) await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
await send('Page.addScriptToEvaluateOnNewDocument', { source: hideScript });

// ---------------------------------------------------------------- stills

if (mode === 'shot') {
  await send('Page.navigate', { url: args.url });
  await sleep(+(args.wait ?? 3) * 1000);
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(out, Buffer.from(data, 'base64'));
  await closeTab();
  console.log('saved', out);
  process.exit(0);
}

// ---------------------------------------------------------------- clips

if (!args.duration) {
  console.error('clip needs --duration <seconds>');
  await closeTab();
  process.exit(1);
}
const durationSec = +args.duration;

if (SLOW > 1) await send('Page.addScriptToEvaluateOnNewDocument', { source: clockScript(SLOW) });
if (!args['no-cursor']) await send('Page.addScriptToEvaluateOnNewDocument', { source: cursorScript });
await send('Animation.enable');
await send('Animation.setPlaybackRate', { playbackRate: 1 / SLOW });
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await send('Page.bringToFront');

// Steps run on page time: "wait": 1 waits one second of page time.
const pageSleep = (sec) => sleep(sec * 1000 * SLOW);
// Exceptions inside the page are reported, never swallowed: a step whose eval
// throws otherwise looks exactly like one that ran and did nothing.
const evaluate = async (expression, label = 'eval') => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r?.exceptionDetails) {
    const d = r.exceptionDetails;
    console.error(`${label} threw: ${d.exception?.description?.split('\n')[0] ?? d.text}`);
  }
  return r?.result?.value;
};
const mouse = (type, x, y) =>
  send('Input.dispatchMouseEvent', {
    type, x, y,
    button: type === 'mouseMoved' ? 'none' : 'left',
    clickCount: type === 'mouseMoved' ? 0 : 1,
  });

let pos = [width * 0.9, height * 0.92];

// The take's timeline, for scripts/auto-camera.mjs. Wall-clock seconds now,
// converted to video seconds once the first frame's timestamp is known.
const events = [];
const log = (type, data = {}) => events.push({ type, wall: Date.now() / 1000, ...data });
// The box of what a target points at, so a zoom can frame the whole control.
const boxOf = async (p) => {
  if (!p || (!p.selector && !p.text)) return null;
  return evaluate(`(() => {
    const want = ${JSON.stringify(p.text ?? null)};
    const shown = (e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const el = want
      ? [...document.querySelectorAll('button, a, [role], label, span, div, p, h1, h2, h3, h4, h5, h6, li, td, th, strong, em, code')]
          .filter((e) => e.textContent.trim() === want && shown(e))
          .sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width)[0]
      : [...document.querySelectorAll(${JSON.stringify(p.selector ?? '')})].find(shown);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return [r.x, r.y, r.width, r.height];
  })()`);
};
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

// A point from {x, y} or {selector, at: [fx, fy]}, where fractions are of the
// element's box and may go outside 0..1 to point around it.
// Elements that mount a beat later (a sheet sliding in, a menu opening) are
// waited for, up to 5s of page time, instead of failing the take at once.
const resolvePoint = async (p) => {
  for (let tries = 0; ; tries++) {
    try {
      return await resolveOnce(p);
    } catch (e) {
      if (tries >= 50 || (!p.selector && !p.text)) throw e;
      await pageSleep(0.1);
    }
  }
};
const resolveOnce = async (p) => {
  if (p.selector) {
    // The first match that is on screen: hidden tabs and closed panels often
    // hold a twin of the target with no box.
    const box = await evaluate(`(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(p.selector)})].find((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      if (!el) return null;
      // An option further down a list must be scrolled to before it is
      // clicked; "nearest" leaves anything already in view alone.
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const r = el.getBoundingClientRect();
      return [r.x, r.y, r.width, r.height];
    })()`);
    if (!box) throw new Error(`No element for selector ${p.selector}`);
    const [fx, fy] = p.at ?? [0.5, 0.5];
    return [box[0] + box[2] * fx, box[1] + box[3] * fy];
  }
  if (p.text) {
    const box = await evaluate(`(() => {
      const want = ${JSON.stringify(p.text)};
      const el = [...document.querySelectorAll('button, a, [role], label, span, div, p, h1, h2, h3, h4, h5, h6, li, td, th, strong, em, code')]
        .filter((e) => e.textContent.trim() === want)
        .filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        })
        .sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width)[0];
      if (!el) return null;
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const r = el.getBoundingClientRect();
      return [r.x, r.y, r.width, r.height];
    })()`);
    if (!box) throw new Error(`No visible element with text "${p.text}"`);
    return [box[0] + box[2] / 2, box[1] + box[3] / 2];
  }
  return [p.x, p.y];
};

const moveTo = async ([x, y], sec) => {
  const [x0, y0] = pos;
  const n = Math.max(1, Math.round((sec * 1000) / 16));
  for (let i = 1; i <= n; i++) {
    const k = ease(i / n);
    pos = [x0 + (x - x0) * k, y0 + (y - y0) * k];
    await mouse('mouseMoved', ...pos);
    await pageSleep(0.016);
  }
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
  const box = await evaluate(`(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const r = el.getBoundingClientRect();
    return [r.x, r.y, r.width, r.height];
  })()`);
  log('type-start', { box, text });
  for (const [i, ch] of [...text].entries()) {
    await send('Input.insertText', { text: ch });
    const jitter = 0.7 + ((i * 37) % 11) / 18;
    await pageSleep((1 / cps) * jitter * (ch === ' ' ? 1.6 : 1));
  }
  log('type-end', { box });
};

// Wait for a selector or text to appear (or go away), in page time.
const waitFor = async ({ selector, text, state = 'visible', timeout = 8 }) => {
  const probe = `(() => {
    const want = ${JSON.stringify(text ?? null)};
    const shown = (e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
    };
    const el = want
      ? [...document.querySelectorAll('body *')].find((e) => e.childElementCount === 0 && e.textContent.trim() === want && shown(e))
      : [...document.querySelectorAll(${JSON.stringify(selector ?? '')})].find(shown);
    return Boolean(el);
  })()`;
  for (let t = 0; t < timeout; t += 0.1) {
    const seen = await evaluate(probe);
    if (state === 'hidden' ? !seen : seen) return;
    await pageSleep(0.1);
  }
  console.error(`waitFor ${selector ?? text} (${state}) timed out after ${timeout}s`);
};

const runSteps = async () => {
  for (const [i, s] of steps.entries()) {
    // Tell auto-camera to pull back out here (a panel or page opens). Logged
    // before the step's wait, so the pull-out starts with the change.
    if (s.camera === 'wide') log('wide');
    if (s.wait) await pageSleep(s.wait);
    if (s.waitFor) await waitFor(s.waitFor);
    if (s.redact)
      await evaluate(`document.querySelectorAll(${JSON.stringify(s.redact)}).forEach((e) => (e.style.filter = 'blur(7px)'))`);
    // "look": false records where something is (for a callout) without
    // drawing the camera to it, e.g. a toast while the shot stays wide.
    if (s.mark) log('mark', { label: s.mark, box: await boxOf(s.target ?? s.move ?? s.click ?? {}), ...(s.look === false ? { look: false } : {}) });
    if (s.move) await moveTo(await resolvePoint(s.move), s.dur ?? 0.8);
    if (s.click) {
      const target = typeof s.click === 'object' ? s.click : null;
      if (target) await moveTo(await resolvePoint(target), s.dur ?? 0.6);
      await click(target ? await boxOf(target) : null);
    }
    if (s.type) {
      if (s.instant) await send('Input.insertText', { text: s.type });
      else await typeText(s.type, s.cps);
    }
    if (s.key) {
      log('key', { key: s.key });
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: s.key });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: s.key });
    }
    if (s.scroll) {
      log('scroll', { x: pos[0], y: pos[1], dy: s.scroll });
      const n = Math.max(1, Math.round(((s.dur ?? 0.8) * 1000) / 16));
      for (let i = 0; i < n; i++) {
        await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: pos[0], y: pos[1], deltaX: 0, deltaY: s.scroll / n });
        await pageSleep(0.016);
      }
    }
    if (s.eval) await evaluate(s.eval, `step ${i} eval`);
  }
};

const record = async () => {
  const dir = `${out}.frames`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const frames = [];
  events.length = 0;
  let t0 = null;
  const onFrame = (m) => {
    if (m.method !== 'Page.screencastFrame') return;
    const { data, metadata, sessionId } = m.params;
    send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    if (t0 === null) t0 = metadata.timestamp;
    const f = join(dir, `f${String(frames.length).padStart(5, '0')}.png`);
    writeFileSync(f, Buffer.from(data, 'base64'));
    frames.push({ f, t: (metadata.timestamp - t0) / SLOW });
  };
  listeners.push(onFrame);

  await send('Page.startScreencast', { format: 'png', maxWidth: width * scale, maxHeight: height * scale, everyNthFrame: 1 });
  await send('Page.navigate', { url: args.url });
  const stepsDone = runSteps();
  await pageSleep(durationSec);
  await stepsDone;
  await send('Page.stopScreencast');
  await sleep(300);
  listeners.splice(listeners.indexOf(onFrame), 1);
  return { dir, frames, t0 };
};

// A failed take must not leave its tab behind: stray tabs pile up, compete for
// paint, and are easy to mistake for the live one.
const fail = async (e) => {
  console.error(e?.stack ?? String(e));
  await send('Animation.setPlaybackRate', { playbackRate: 1 }).catch(() => {});
  await closeTab();
  process.exit(1);
};
process.on('unhandledRejection', fail);

if (typeof args.setup === 'string') {
  await send('Page.navigate', { url: args.url });
  await sleep(4000);
  const result = await evaluate(args.setup, 'setup');
  console.error(`setup: ${JSON.stringify(result) ?? 'done'}`);
}

// A screencast occasionally delivers nothing (tab not composited yet): retry.
let take;
for (let attempt = 1; attempt <= 3; attempt++) {
  take = await record().catch(fail);
  if (take.frames.length > 2) break;
  console.error(`attempt ${attempt}: no frames, retrying`);
}
await send('Animation.setPlaybackRate', { playbackRate: 1 });
await closeTab();

const { dir, frames } = take;
// Screencast frames can arrive a few ms out of order (seen right after a
// --setup navigation), which gave negative durations and a list ffmpeg
// rejects. Order by timestamp; durations below are clamped too.
frames.sort((a, b) => a.t - b.t);
if (frames.length <= 2) {
  console.error('Screencast produced no frames. Is the Chrome window minimized?');
  process.exit(1);
}

// Chrome only sends a frame when something repaints, so each frame is held
// until the next one; the last is held to the end of the requested duration.
const end = Math.max(frames.at(-1).t + 0.2, durationSec);
const lines = [];
frames.forEach((fr, i) => {
  const next = frames[i + 1];
  lines.push(`file '${fr.f}'`, `duration ${Math.max(0.0001, (next ? next.t : end) - fr.t).toFixed(4)}`);
});
lines.push(`file '${frames.at(-1).f}'`);
writeFileSync(join(dir, 'list.txt'), lines.join('\n'));

// x264 needs even dimensions.
const W = Math.round((width * scale) / 2) * 2;
const H = Math.round((height * scale) / 2) * 2;
execFileSync('ffmpeg', [
  '-y', '-loglevel', 'error',
  '-f', 'concat', '-safe', '0', '-i', join(dir, 'list.txt'),
  '-vf', `fps=${fps},scale=${W}:${H}:flags=lanczos`,
  '-c:v', 'libx264', '-preset', 'slow', '-crf', crf, '-tune', 'animation',
  '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out,
]);
rmSync(dir, { recursive: true, force: true });
console.log(`saved ${out} (${W}x${H}, ${end.toFixed(1)}s, ${frames.length} painted frames)`);

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
writeFileSync(`${out}.events.json`, JSON.stringify({ width, height, duration: +end.toFixed(3), events: timeline }, null, 1));
console.log(`events ${out}.events.json (${timeline.length})`);
// Well under 60 painted frames per second of motion means the window lost
// focus or the page stalled; the take will look choppy.
if (args.sheet) {
  const cols = 5, rows = Math.ceil(end / cols);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', out,
    '-vf', `fps=1,scale=480:-1,tile=${cols}x${rows}`, '-frames:v', '1', `${out}.sheet.png`]);
  console.log(`sheet ${out}.sheet.png`);
}
