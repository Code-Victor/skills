// The frame loop, in the headless Chrome page.
//
//   decode (WebCodecs) -> draw (WebGL2, scenes.js) -> encode (WebCodecs) -> POST to compose.mjs
//
// compose.mjs sends one manifest (spec, clip packet tables, where each
// captured HTML piece lives) and receives H.264 chunks back. The page never
// shows anything; it only needs a GPU context.
import { GL } from './gl.js';
import { ClipSource, dropFile } from './decode.js';
import { Scenes } from './scenes.js';
import { activeScenes, sceneSpans } from './timeline.js';
import { setStyleHash } from './layout.js';

const now = () => performance.now();
const post = (path, body, headers = {}) => fetch(path, { method: 'POST', body, headers });
const log = (...a) => post('/log', a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')).catch(() => {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LEAD = 50;   // open a scene's decoder this many frames before it starts

async function run() {
  const m = await (await fetch('/manifest.json')).json();
  const { W, H, fps, spec, style } = m;
  setStyleHash(style.hash);
  spec.style = style;   // timeline.js reads the style's own transitions from the spec
  const FRAME_US = 1e6 / fps;
  const spans = sceneSpans(spec, fps);
  const N = m.frames;
  const stats = { warnings: [], decodeFallbacks: [] };

  // ---- GL and the captured HTML pieces ----
  const canvas = new OffscreenCanvas(W, H);
  const gl = new GL(canvas, W, H);
  const stills = new Map();
  await Promise.all(Object.entries(m.stills).map(async ([id, s]) => {
    const blob = await (await fetch(s.file)).blob();
    const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'premultiply', colorSpaceConversion: 'none' });
    stills.set(id, { ...s, tex: gl.still(bmp, s.filter) });
    bmp.close();
  }));
  const images = new Map();
  await Promise.all(spec.scenes.map(async (sc, i) => {
    if (sc.type !== 'image') return;
    const blob = await (await fetch(m.images[sc.src])).blob();
    const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'premultiply' });
    images.set(i, gl.still(bmp)); bmp.close();
  }));
  const scenes = new Scenes({ gl, spec, style, fps, W, H, stills, images });

  // ---- encoder ----
  const still = m.mode === 'still';
  const encConf = { codec: 'avc1.640034', width: W, height: H, framerate: fps, bitrate: m.bitrate, bitrateMode: 'variable',
    hardwareAcceleration: m.software ? 'prefer-software' : 'prefer-hardware', latencyMode: 'quality', avc: { format: 'annexb' } };
  let enc = null, encInfo = {};
  if (!still) {
    let sup = await VideoEncoder.isConfigSupported(encConf);
    if (!sup.supported && !m.software) {
      stats.warnings.push('hardware H.264 encoding is not available here; encoding in software (slower)');
      encConf.hardwareAcceleration = 'prefer-software';
      sup = await VideoEncoder.isConfigSupported(encConf);
    }
    if (!sup.supported) throw new Error('this Chrome cannot encode H.264 1080p (VideoEncoder.isConfigSupported was false)');
    encInfo = { hardware: encConf.hardwareAcceleration };
  }
  let pending = [], pendingBytes = 0, seq = 0, sendChain = Promise.resolve(), encError = null, chunks = 0;
  const flushPending = () => {
    if (!pending.length) return;
    const blob = new Blob(pending), s = seq++;
    pending = []; pendingBytes = 0;
    sendChain = sendChain.then(() => post('/chunks', blob, { 'x-seq': String(s) }));
  };
  let dequeue = null;
  if (!still) {
    enc = new VideoEncoder({
      output: (chunk) => {
        const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b);
        chunks++; pending.push(b); pendingBytes += b.length;
        if (pendingBytes > 1 << 20) flushPending();
      },
      error: (e) => { encError = e; dequeue?.(); },
    });
    enc.ondequeue = () => dequeue?.();
    enc.configure(encConf);
  }

  // ---- clip sources per scene ----
  const needs = (sc) => {
    if (sc.type === 'clip') return { main: { src: sc.src, trim: sc.trimStartSec ?? 0, rate: sc.playbackRate ?? 1 } };
    if (sc.type === 'split') return { before: { src: sc.before.src, trim: sc.before.trimStartSec ?? 0, rate: 1 }, after: { src: sc.after.src, trim: sc.after.trimStartSec ?? 0, rate: 1 } };
    return {};
  };
  // After the last scene that plays a file, let its bytes go.
  const lastUse = {};
  spec.scenes.forEach((sc, i) => Object.values(needs(sc)).forEach((d) => { lastUse[d.src] = i; }));
  const rt = spec.scenes.map(() => ({ opened: null, src: {}, tex: {}, closed: false }));
  const openScene = (i, atFrame) => {
    const r = rt[i];
    if (r.opened) return r.opened;
    const local = Math.max(0, atFrame - spans[i].start);
    r.opened = Promise.all(Object.entries(needs(spec.scenes[i])).map(async ([key, nd]) => {
      const c = m.clips[nd.src];
      const s = new ClipSource({ name: nd.src, url: c.url, meta: c.meta, startUs: (nd.trim + (local / fps) * nd.rate) * 1e6, forceSoftware: m.forceSoftwareDecode, log });
      await s.open();
      r.src[key] = s; r.tex[key] = gl.texture('linear');
    }));
    return r.opened;
  };
  const closeScene = (i) => {
    const r = rt[i];
    if (r.closed) return;
    r.closed = true;
    for (const d of Object.values(needs(spec.scenes[i]))) if (lastUse[d.src] === i) dropFile(m.clips[d.src].url);
    for (const s of Object.values(r.src)) { if (s.fellBack) stats.decodeFallbacks.push(s.name); stats.decodeWaitMs = (stats.decodeWaitMs || 0) + s.waitMs; s.close(); }
    r.src = {};
  };

  const clipIdx = spec.scenes.map((_, k) => k).filter((k) => Object.keys(needs(spec.scenes[k])).length);
  const ambientLoads = new Map();
  const ambientFor = async (i, n, frames) => {
    const own = frames[i].main ?? frames[i].before;
    if (own) return own;
    const prev = clipIdx.filter((k) => k < i).pop();
    const firstKey = (k) => Object.keys(needs(spec.scenes[k]))[0];
    if (prev !== undefined && rt[prev].tex[firstKey(prev)]?.last) return rt[prev].tex[firstKey(prev)];   // hold the clip before: its last frame
    const next = clipIdx.find((k) => k > i);
    if (next === undefined) return undefined;
    // one load per clip however many scenes ask at once (two decoders reads on one source would fight)
    if (!ambientLoads.has(next)) ambientLoads.set(next, (async () => {
      await openScene(next, n);
      const key = firstKey(next), tex = rt[next].tex[key];
      if (!tex.last) gl.video(tex, await rt[next].src[key].get(needs(spec.scenes[next])[key].trim * 1e6));
      return tex;
    })());
    return ambientLoads.get(next);
  };

  // ---- frame loop ----
  const first = still ? m.stillFrame : 0, last = still ? m.stillFrame + 1 : N;
  const hashes = [];   // m.hashFrames: a SHA-1 of the canvas pixels of every frame, taken just before the encoder sees it (determinism checks)
  const t0 = now();
  const st = { decode: 0, draw: 0, vframe: 0, backpressure: 0, encode: 0 };
  let lastProgress = t0;
  for (let n = first; n < last; n++) {
    spans.forEach((sp, i) => { if (n >= sp.start - LEAD && n < sp.end && !rt[i].opened && Object.keys(needs(spec.scenes[i])).length) openScene(i, n); if (n >= sp.end) closeScene(i); });
    const active = activeScenes(spec, spans, n, fps);
    let t = now();
    const frames = {};
    await Promise.all(active.map(async (a) => {
      const sc = spec.scenes[a.i], nd = needs(sc);
      frames[a.i] = {};
      if (sc.type === 'image') { frames[a.i].main = images.get(a.i); return; }
      if (!Object.keys(nd).length) return;
      await openScene(a.i, n);
      await Promise.all(Object.entries(nd).map(async ([key, d]) => {
        const f = await rt[a.i].src[key].get((d.trim + (a.local / fps) * d.rate) * 1e6);
        gl.video(rt[a.i].tex[key], f);
        frames[a.i][key] = rt[a.i].tex[key];
      }));
    }));
    // ambient background: every active scene needs a recording frame to take its colours from (its own, or the nearest clip's)
    if (style.canvas.background.kind === 'ambient') await Promise.all(active.map(async (a) => { frames[a.i].ambient = await ambientFor(a.i, n, frames); }));
    st.decode += now() - t;

    t = now();
    scenes.frame(active, frames, n);
    scenes.logo(n);
    st.draw += now() - t;

    if (still) {
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      await post('/still-out', blob);
      break;
    }
    if (m.hashFrames) {
      const g = gl.gl, px = new Uint8Array(W * H * 4);
      g.bindFramebuffer(g.FRAMEBUFFER, null); g.readPixels(0, 0, W, H, g.RGBA, g.UNSIGNED_BYTE, px);
      hashes.push([...new Uint8Array(await crypto.subtle.digest('SHA-1', px))].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join(''));
    }
    t = now();
    const vf = new VideoFrame(canvas, { timestamp: Math.round(n * FRAME_US), duration: Math.round(FRAME_US) });
    st.vframe += now() - t;
    t = now();
    while (enc.encodeQueueSize > 3 && !encError) await new Promise((r) => { dequeue = r; setTimeout(r, 50); });
    if (encError) throw new Error('encoder failed: ' + encError);
    st.backpressure += now() - t;
    enc.encode(vf, { keyFrame: n % 120 === 0 });
    vf.close();
    if (now() - lastProgress > 1500) { lastProgress = now(); post('/progress', String(n + 1)); }
  }
  if (!still) {
    await enc.flush();
    if (encError) throw new Error('encoder failed: ' + encError);
    flushPending();
    await sendChain;
    await post('/chunks-end', '');
  }
  spans.forEach((_, i) => closeScene(i));
  const wallMs = now() - t0;
  await post('/done', JSON.stringify({ ok: true, frames: last - first, wallMs: Math.round(wallMs), chunks, st: Object.fromEntries(Object.entries(st).map(([k, v]) => [k, Math.round(v)])),
    renderer: gl.renderer, enc: encInfo, hashes, warnings: stats.warnings, decodeFallbacks: stats.decodeFallbacks, decodeWaitMs: Math.round(stats.decodeWaitMs || 0) }));
}

run().catch((e) => post('/done', JSON.stringify({ ok: false, fatal: String(e && e.message || e), stack: String(e && e.stack || '').slice(0, 1500), badClip: e && e.clip })));
window.addEventListener('unhandledrejection', (e) => post('/done', JSON.stringify({ ok: false, fatal: 'unhandled: ' + String(e.reason && e.reason.message || e.reason) })));
