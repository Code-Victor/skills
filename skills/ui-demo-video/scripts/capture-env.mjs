// Things capture.mjs learns about the machine and remembers between runs:
// the screen's usable size and how fast this Chrome can paint. Both live under
// ~/.cache/ui-demo-video/. Nothing here is shared between concurrent takes
// except these two small files, written by rename so a reader never sees half.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

const dir = join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'ui-demo-video');
const readJson = (name) => {
  try { return JSON.parse(readFileSync(join(dir, name), 'utf8')); } catch { return null; }
};
const writeJson = (name, value) => {
  try {
    mkdirSync(dir, { recursive: true });
    const tmp = join(dir, `.${name}.${process.pid}.${Date.now()}`);
    writeFileSync(tmp, JSON.stringify(value));
    renameSync(tmp, join(dir, name));
  } catch {}
};

// What the browser's own toolbars take from a maximized window (the old code
// measured it from a real window: outerHeight - innerHeight, 87 on macOS).
export const TOOLBAR = 87;

// The screen's usable area (menu bar and Dock excluded), as a maximized
// browser window would have it. Headless Chrome has no real window to ask, so
// ask the OS: JXA on macOS, 1440x900 elsewhere.
export function screenSize() {
  const hit = readJson('screen.json');
  if (hit && Date.now() - hit.at < 3600e3) return hit;
  let w = 0, h = 0;
  if (platform() === 'darwin') {
    try {
      const out = execFileSync('osascript', ['-l', 'JavaScript', '-e',
        'ObjC.import("AppKit"); const f = $.NSScreen.mainScreen.visibleFrame; JSON.stringify([f.size.width, f.size.height])'],
      { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
      [w, h] = JSON.parse(out.trim());
    } catch {}
  } else if (platform() === 'linux') {
    try {
      const out = execFileSync('xrandr', ['--current'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] });
      const m = out.match(/current (\d+) x (\d+)/);
      if (m) [w, h] = [+m[1], +m[2]];
    } catch {}
  }
  const ok = w >= 400 && h > TOOLBAR + 200;
  const size = { w: ok ? Math.round(w) : 1440, h: ok ? Math.round(h) : 900 + TOOLBAR, measured: ok, at: Date.now() };
  if (ok) writeJson('screen.json', size);
  return size;
}

// Paint-rate calibration, per configuration (frame size, format, encoder,
// headless or not). A measurement taken while other takes were running is
// never stored: it says nothing about a quiet machine.
const calKey = (c) => [c.w, c.h, c.dsf, c.format, c.encoder, c.headless ? 'h' : 'w'].join(':');
export function cachedRate(c, maxAgeMs = 3600e3) {
  const hit = readJson('calibration.json')?.[calKey(c)];
  return hit && Date.now() - hit.at < maxAgeMs ? hit.rate : null;
}
export function storeRate(c, rate) {
  const all = readJson('calibration.json') ?? {};
  all[calKey(c)] = { rate: +rate.toFixed(1), at: Date.now() };
  writeJson('calibration.json', all);
}

// The smallest slowdown (in halves) that paints at least `target` distinct
// frames per video second given `rate` frames per wall second. Headroom keeps
// a busy moment from tipping a take under the line.
export function pickSlow(rate, target = 60, headroom = 1.5) {
  if (!(rate > 0)) return 5;
  const raw = (target * headroom) / rate;
  return Math.min(10, Math.max(1, Math.ceil(raw * 2) / 2));
}
