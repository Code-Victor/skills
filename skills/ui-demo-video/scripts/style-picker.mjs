// The two things a style comparison leaves behind, for demo.mjs --styles:
//
//   chooseMoments(spec)   the five or six moments of a video worth comparing,
//                         picked from its timeline and camera moves so every
//                         style is looked at at the same instants
//   makeSheet(...)        out/<name>-styles.png: one row per style, one cell
//                         per moment, the style on the left and the time on top
//   pickerHtml(...)       out/<name>-styles.html: a local page that plays the
//                         renders at full size and flips between them
//
// No side effects on import, no dependencies: ffmpeg cuts the frames, a
// headless Chrome (no window, no focus) lays the sheet out and photographs it.
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { sceneSpans } from './spec-lib.mjs';

// ---------------------------------------------------------------- moments

// The zoom the camera has at second t of a clip scene. `moves` are keyframes
// {atSec, zoom?}; a keyframe without a zoom means 1. Between two keyframes
// the camera glides, so a time is only "wide" when both neighbours are wide
// and only "zoomed" once it is past the arrival (see zoomedAt below).
const keyZoom = (k) => (typeof k?.zoom === 'number' ? k.zoom : 1);
const isWideAt = (moves, t) => {
  if (!moves?.length) return true;
  const before = [...moves].reverse().find((k) => k.atSec <= t);
  const after = moves.find((k) => k.atSec > t);
  return keyZoom(before) <= 1.02 && (!after || keyZoom(after) <= 1.02 || after.atSec - t > 1.2);
};

// [{ t, key, label }] in time order, 4 to 6 of them. `t` is seconds on the
// finished timeline. A moment that does not exist in this video (no zoom, no
// transition) is left out rather than faked.
export const chooseMoments = (spec) => {
  const { spans, totalSec } = sceneSpans(spec);
  const out = [];
  const add = (t, key, label) => out.push({ t: +Math.max(0, Math.min(totalSec - 0.1, t)).toFixed(2), key, label });
  const first = (pred) => spans.findIndex(({ scene }) => pred(scene));

  // The title, once its text has settled: past the entrance, before the exit.
  const ti = first((s) => s.type === 'title');
  if (ti >= 0) add(spans[ti].start + Math.min(2, (spans[ti].end - spans[ti].start) * 0.65), 'title', 'title');

  // The first card (an issue, a list, a before/after): in its first seconds.
  const ci = first((s) => s.type === 'issue' || s.type === 'split' || (s.type === 'list' && ti >= 0));
  if (ci >= 0 && ci !== spans.length - 1) add(spans[ci].start + Math.min(2.5, (spans[ci].end - spans[ci].start) * 0.5), 'card', 'first card');

  // A clip while wide: the first clip with a stretch where the camera rests at 1.
  let best;
  for (const [i, { scene, start, end }] of spans.entries()) {
    if (scene.type !== 'clip' && scene.type !== 'image') continue;
    const dur = end - start;
    for (let t = 0.8; t <= dur - 0.8; t += 0.25) {
      if (!isWideAt(scene.moves, t)) continue;
      const score = Math.abs(t - dur * 0.4);
      if (!best || (best.i === i && score < best.score)) best = { i, t: start + t, score };
    }
    if (best) break;
  }
  if (best) add(best.t, 'wide', 'clip, wide');

  // A clip while zoomed in on an action: just after the camera arrives at the
  // deepest zoom the camera data has.
  let deep;
  for (const { scene, start } of spans) {
    if (scene.type !== 'clip' && scene.type !== 'image') continue;
    const m = scene.moves ?? [];
    m.forEach((k, j) => {
      if (keyZoom(k) >= 1.3 && (!deep || keyZoom(k) > deep.zoom + 0.05)) deep = { zoom: keyZoom(k), t: start + k.atSec + Math.min(0.35, ((m[j + 1]?.atSec ?? k.atSec + 0.7) - k.atSec) / 2) };
    });
  }
  if (deep) add(deep.t, 'zoom', `clip, zoomed ${deep.zoom.toFixed(1)}x`);

  // The middle of a transition, preferring one that touches a clip.
  const gaps = [];
  for (let i = 0; i + 1 < spans.length; i++) {
    const overlap = spans[i].end - spans[i + 1].start;
    if (overlap > 0.1) gaps.push({ i, overlap, clip: spans[i].scene.type === 'clip' || spans[i + 1].scene.type === 'clip' });
  }
  const g = gaps.find((x) => x.clip) ?? gaps[0];
  if (g) add(spans[g.i + 1].start + g.overlap / 2, 'transition', 'mid-transition');

  // The end card, settled.
  const li = spans.length - 1;
  if (li > 0) add(Math.min(spans[li].end - 0.5, spans[li].start + (spans[li].end - spans[li].start) * 0.7), 'end', 'end card');

  // Time order; two moments within 0.4 s of each other are one moment.
  out.sort((a, b) => a.t - b.t);
  return out.filter((m, i) => i === 0 || m.t - out[i - 1].t >= 0.4);
};

// ---------------------------------------------------------------- the sheet

export const findChrome = () => {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  ];
  const fixed = candidates.find((c) => c && existsSync(c));
  if (fixed) return fixed;
  for (const n of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const r = spawnSync('which', [n], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  }
  return undefined;
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const CELL_W = 640; // at least 640 px wide, so a cell can actually be judged
const LABEL_W = 190;
const GAP = 14;
const HEAD_H = 30;

// styles: [{ name, file }]; run(log, cmd, args, opts) is demo.mjs's own child
// runner (log file, process group, timeout) and resolves { code, text }.
// Returns { ok: true, moments } or { ok: false, error }.
export const makeSheet = async ({ styles, moments, out, workDir, run, aspect = 16 / 9, label = '' }) => {
  mkdirSync(workDir, { recursive: true });
  const cellH = Math.round(CELL_W / aspect / 2) * 2;
  // One ffmpeg per style: the same file opened once per moment, one frame each.
  for (const s of styles) {
    const args = ['-v', 'error', '-y'];
    const ms = s.moments ?? moments;
    for (const m of ms) args.push('-ss', String(m.t), '-i', s.file);
    ms.forEach((m, k) => args.push('-map', `${k}:v:0`, '-frames:v', '1', '-vf', `scale=${CELL_W}:${cellH}`, '-q:v', '2', join(workDir, `${s.name}-${k}.jpg`)));
    const r = await run(`sheet-${s.name}`, 'ffmpeg', args, { timeoutSec: 120 });
    if (r.code !== 0) return { ok: false, error: `ffmpeg could not cut frames from ${s.file}: ${r.text.trim().split('\n').slice(-2).join(' | ')}` };
  }
  const W = GAP + LABEL_W + moments.length * (CELL_W + GAP);
  const H = GAP + 44 + styles.length * (HEAD_H + cellH + GAP);
  const rows = styles.map((s) => `<div class="name" style="height:${HEAD_H + cellH}px"><span>${esc(s.name)}</span></div>${(s.moments ?? moments).map((m, k) =>
    `<figure><figcaption><b>${m.t.toFixed(1)} s</b> <i>${esc(m.label)}</i></figcaption><img width="${CELL_W}" height="${cellH}" src="${esc(`${s.name}-${k}.jpg`)}"></figure>`).join('')}`).join('');
  const html = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;background:#141416;color:#e6e6ea;font:500 15px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif}
.top{padding:${GAP}px ${GAP}px 0;height:30px;font-size:17px;font-weight:600;color:#9a9aa3}
.grid{display:grid;grid-template-columns:${LABEL_W}px repeat(${moments.length},${CELL_W}px);gap:${GAP}px;padding:${GAP}px;align-items:start}
.name{box-sizing:border-box;display:flex;align-items:center;font-size:26px;font-weight:700;letter-spacing:-.01em;padding-top:${HEAD_H}px;overflow-wrap:anywhere}
figure{margin:0}figcaption{height:${HEAD_H}px;display:flex;align-items:baseline;gap:10px;font-size:15px}
figcaption b{font-size:20px;font-weight:700;font-variant-numeric:tabular-nums}figcaption i{font-style:normal;color:#9a9aa3}
img{display:block;border-radius:4px;background:#000}
</style><div class="top">${esc(label)}</div><div class="grid">${rows}</div>`;
  const htmlFile = join(workDir, 'sheet.html');
  writeFileSync(htmlFile, html);

  const chrome = findChrome();
  if (!chrome) return { ok: false, error: 'no Chrome found to lay out the sheet (set CHROME_PATH)' };
  const profile = mkdtempSync(join(workDir, 'profile-'));
  mkdirSync(dirname(out), { recursive: true });
  rmSync(out, { force: true });
  try {
    // Headless: no window, no focus. A little extra height, cropped after.
    const r = await run('sheet-chrome', chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
      '--force-device-scale-factor=1', `--user-data-dir=${profile}`, `--window-size=${W},${H + 200}`, '--virtual-time-budget=8000',
      `--screenshot=${out}`, pathToFileURL(htmlFile).href], { timeoutSec: 90 });
    if (!existsSync(out) || !statSync(out).size) return { ok: false, error: `Chrome did not write the sheet (exit ${r.code}): ${r.text.trim().split('\n').slice(-2).join(' | ')}` };
    const crop = await run('sheet-crop', 'ffmpeg', ['-v', 'error', '-y', '-i', out, '-vf', `crop=${W}:${H}:0:0`, '-update', '1', '-frames:v', '1', `${out}.tmp.png`], { timeoutSec: 60 });
    if (crop.code === 0 && existsSync(`${out}.tmp.png`)) {
      rmSync(out, { force: true });
      renameSync(`${out}.tmp.png`, out);
    }
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
  return { ok: true, moments, width: W, height: H };
};

// ---------------------------------------------------------------- the picker

// styles: [{ name, file (absolute), description, suits }]. The page sits at
// `htmlPath` and refers to the videos by relative path, so the folder can be
// moved or zipped as a whole. No network, no modules, no fetch: it opens from
// file:// in Chrome and Safari.
export const pickerHtml = ({ title, htmlPath, styles, fps = 60 }) => {
  const data = {
    fps,
    styles: styles.map((s) => ({
      name: s.name,
      src: relative(dirname(resolve(htmlPath)), resolve(s.file)).split('/').map(encodeURIComponent).join('/'),
      description: s.description || '',
      suits: s.suits || '',
    })),
  };
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
html,body{margin:0;height:100%;background:#0f0f11;color:#c9c9cf;font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
body,main{display:flex;flex-direction:column}
main{flex:1;min-height:0}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
#stage{position:relative;flex:1;min-height:0;background:#000}
#stage video{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:contain;visibility:hidden;background:#000}
#stage video.on{visibility:visible}
#seek{display:block;width:100%;margin:0;height:18px;accent-color:#c9c9cf;cursor:pointer;flex:none;background:#0f0f11}
#bar{flex:none;padding:6px 16px 12px;display:flex;flex-direction:column;gap:8px;background:#0f0f11}
#row{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center}
#tabs{display:flex;flex-wrap:wrap;gap:4px;align-items:center}
button{font:inherit;color:#b4b4bc;background:none;border:1px solid transparent;border-radius:6px;padding:4px 10px;min-height:28px;cursor:pointer}
button:focus-visible,#seek:focus-visible{outline:2px solid #e6e6ea;outline-offset:2px}
#tabs button b{font-weight:600;color:#8d8d96;margin-right:6px}
#tabs button[aria-checked="true"]{color:#f1f1f4;border-color:#5a5a63;background:#1c1c21}
#tabs button[aria-checked="true"] b{color:#c9c9cf}
#play{border-color:#3a3a41;color:#e6e6ea;min-width:72px}
#time{margin-left:auto;font-variant-numeric:tabular-nums;color:#9a9aa3}
#info{display:flex;flex-wrap:wrap;gap:2px 18px;min-height:19px}
#info b{color:#f1f1f4;font-weight:600}
#keys{color:#9a9aa3;font-size:12px}
#keys kbd{font:inherit;color:#c9c9cf}
#err{color:#e0897a}
</style></head><body>
<main>
<h1 class="sr">${esc(title)}</h1>
<div id="stage"></div>
<input id="seek" type="range" min="0" max="1" step="1" value="0" aria-label="Position in the video">
<div id="bar">
  <div id="row"><div id="tabs" role="radiogroup" aria-label="Style"></div><button id="play" type="button">Play</button><span id="time"></span></div>
  <div id="info" aria-live="polite"><b id="iname"></b><span id="idesc"></span><span id="isuits"></span><span id="err"></span></div>
  <div id="keys"><kbd>1</kbd>-<kbd>9</kbd> style &nbsp; <kbd>&larr;</kbd> <kbd>&rarr;</kbd> previous / next style &nbsp; <kbd>space</kbd> play / pause &nbsp; <kbd>,</kbd> <kbd>.</kbd> one frame back / forward &nbsp; <kbd>Home</kbd> start</div>
</div>
</main>
<script>
(function () {
  var D = ${json};
  var S = D.styles, FPS = D.fps || 60, cur = 0, vids = [], tabs = [], scrubbing = false;
  var stage = document.getElementById('stage'), tabsEl = document.getElementById('tabs'), timeEl = document.getElementById('time');
  var seekEl = document.getElementById('seek'), playEl = document.getElementById('play'), errEl = document.getElementById('err');

  // The styles are a radio group: one Tab stop, arrow keys move between them (and so do 1-9 anywhere on the page).
  S.forEach(function (s, i) {
    var v = document.createElement('video');
    v.src = s.src; v.preload = 'auto'; v.playsInline = true; v.muted = i !== 0; v.controls = false;
    v.setAttribute('aria-label', s.name + ' render');
    v.addEventListener('error', function () { errEl.textContent = 'cannot load ' + s.src; });
    v.addEventListener('ended', function () { syncOthers(v.currentTime); });
    v.addEventListener('loadedmetadata', function () { if (i === cur) setRange(); });
    v.addEventListener('click', toggle);
    stage.appendChild(v); vids.push(v);
    var b = document.createElement('button');
    b.type = 'button'; b.setAttribute('role', 'radio');
    b.innerHTML = '<b aria-hidden="true">' + (i < 9 ? i + 1 : '') + '</b>';
    b.appendChild(document.createTextNode(s.name));
    b.addEventListener('click', function () { select(i); });
    tabsEl.appendChild(b); tabs.push(b);
  });
  vids[0].classList.add('on');

  function active() { return vids[cur]; }
  function playing() { return !active().paused && !active().ended; }
  // Paused videos are kept on the same frame, so a flip shows the new style
  // at once; while playing, the new one is seeked and shown when it lands.
  function syncOthers(t) {
    vids.forEach(function (v, i) { if (i !== cur && Math.abs(v.currentTime - t) > 0.0005) v.currentTime = t; });
  }
  function setRange() { var d = active().duration; if (d) seekEl.max = String(Math.max(1, Math.round(d * FPS) - 1)); }
  function render() {
    var s = S[cur];
    tabs.forEach(function (b, i) { b.setAttribute('aria-checked', i === cur ? 'true' : 'false'); b.tabIndex = i === cur ? 0 : -1; });
    document.getElementById('iname').textContent = s.name;
    document.getElementById('idesc').textContent = s.description;
    document.getElementById('isuits').textContent = s.suits ? 'Suits: ' + s.suits : '';
    setRange();
  }
  function select(i, focus) {
    if (i < 0 || i >= S.length) return;
    if (focus) tabs[i].focus();
    if (i === cur) return;
    var old = vids[cur], nu = vids[i], t = old.currentTime, was = playing();
    old.pause(); old.muted = true; nu.muted = false;
    cur = i; render();
    function show() { vids.forEach(function (v) { v.classList.toggle('on', v === nu); }); if (was) nu.play(); }
    if (Math.abs(nu.currentTime - t) <= 0.0005 && nu.readyState >= 2) show();
    else {
      var done = false;
      var go = function () { if (done) return; done = true; nu.removeEventListener('seeked', go); show(); };
      nu.addEventListener('seeked', go);
      nu.currentTime = t;
      setTimeout(go, 400);
    }
  }
  function toggle() {
    var v = active();
    if (playing()) { v.pause(); syncOthers(v.currentTime); }
    else { if (v.ended || v.currentTime >= v.duration - 0.01) v.currentTime = 0; v.play(); }
  }
  function seek(t) {
    var v = active(), d = v.duration || 0;
    t = Math.max(0, Math.min(d ? d - 0.5 / FPS : t, t));
    v.currentTime = t; syncOthers(t);
  }
  function step(dir) {
    var v = active();
    if (playing()) v.pause();
    var n = Math.floor(v.currentTime * FPS + 1e-6);
    seek((n + dir + 0.5) / FPS);
  }
  playEl.addEventListener('click', toggle);
  // The position is a native slider: arrows step a frame, Page Up/Down and Home/End jump, dragging scrubs.
  seekEl.addEventListener('input', function () { scrubbing = true; if (playing()) active().pause(); seek((+seekEl.value + 0.5) / FPS); });
  seekEl.addEventListener('change', function () { scrubbing = false; });
  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var k = e.key, onSlider = e.target === seekEl, onRadio = tabs.indexOf(e.target) >= 0;
    if (onSlider && (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown' || k === 'Home' || k === 'End' || k === 'PageUp' || k === 'PageDown')) return;
    if (e.target.tagName === 'BUTTON' && !onRadio && (k === ' ' || k === 'Enter')) return;
    if (k >= '1' && k <= '9') { select(+k - 1, onRadio); }
    else if (k === 'ArrowRight' || (onRadio && k === 'ArrowDown')) select((cur + 1) % S.length, onRadio);
    else if (k === 'ArrowLeft' || (onRadio && k === 'ArrowUp')) select((cur + S.length - 1) % S.length, onRadio);
    else if (k === ' ') toggle();
    else if (k === ',') step(-1);
    else if (k === '.') step(1);
    else if (k === 'Home') seek(0);
    else return;
    e.preventDefault();
  });
  function fmt(t) { var m = Math.floor(t / 60); return m + ':' + (t - m * 60).toFixed(2).padStart(5, '0'); }
  var last = '';
  function tick() {
    var v = active(), d = v.duration || 0, p = playing();
    var text = fmt(v.currentTime) + ' / ' + fmt(d) + '  frame ' + Math.floor(v.currentTime * FPS + 1e-6);
    if (text !== last) {
      last = text; timeEl.textContent = text;
      if (!scrubbing) seekEl.value = String(Math.floor(v.currentTime * FPS + 1e-6));
      seekEl.setAttribute('aria-valuetext', fmt(v.currentTime) + ' of ' + fmt(d));
    }
    var label = p ? 'Pause' : 'Play';
    if (playEl.textContent !== label) playEl.textContent = label;
    requestAnimationFrame(tick);
  }
  render(); tick();
})();
</script></body></html>
`;
};
