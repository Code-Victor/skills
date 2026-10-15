// A virtual clock for figures with no hook (clock mode of capture-figure.mjs).
// Injected with Page.addScriptToEvaluateOnNewDocument before any page script,
// so the page only ever sees virtual time and the recorder steps it frame by
// frame. A classic script, no imports.
//
//   window.__vclock.advanceTo(ms)  move virtual time forward, never back
//   window.__vclock.now()          virtual ms (what performance.now() says)
//   window.__vclock.paint()        resolves after two real frames: the page has painted
//   window.__vclock.stats()        counters, to show which time sources a page used
//
// Options: globalThis.__vclockConfig = { seed = 1, transitions = 'off' }, set
// by the recorder in the same injected source.
//
// It replaces requestAnimationFrame, performance.now, Date.now and new Date(),
// the timers, requestIdleCallback and Math.random (seeded), and pins CSS
// animations, CSS transitions, Web Animations and SVG SMIL to virtual time.
// Nothing else on the page changes. Only the top frame is virtual.

(() => {
  if (window !== window.top || window.__vclock) return;
  const cfg = globalThis.__vclockConfig || {};
  const STEP = 1000 / 60; // longest substep: anatomy clamps dt at 1/30 s, so 1/60 keeps motion true
  const EPOCH = Date.UTC(2026, 0, 1); // videos never show the real date
  const GUARD = 10000; // timer callbacks per substep before the rest wait for the next one

  // The originals: paint() needs real frames, and errors need a real task.
  const nativeRaf = window.requestAnimationFrame.bind(window);
  const nativeSetTimeout = window.setTimeout.bind(window);
  const NativeDate = window.Date;
  const report = typeof window.reportError === 'function'
    ? window.reportError.bind(window)
    : (e) => nativeSetTimeout(() => { throw e; });
  // A throwing callback must not stop the clock; it still reaches the console.
  const call = (fn, args) => {
    try { fn.apply(window, args); } catch (e) { report(e); }
  };

  let time = 1000;
  const n = {
    substeps: 0, rafCallbacks: 0, timersFired: 0, randomCalls: 0, performanceNow: 0,
    dateNow: 0, animations: 0, smilRoots: 0, loopGuard: 0,
  };

  // ---------------------------------------------------------------- frames

  // A queue flushed once per substep with the virtual timestamp.
  let frameId = 0;
  const frames = new Map(); // id -> callback, in request order
  window.requestAnimationFrame = function requestAnimationFrame(cb) {
    if (typeof cb !== 'function') throw new TypeError("Failed to execute 'requestAnimationFrame' on 'Window': parameter 1 is not of type 'Function'.");
    frames.set(++frameId, cb);
    return frameId;
  };
  window.cancelAnimationFrame = function cancelAnimationFrame(id) {
    frames.delete(Number(id));
  };
  const flushFrames = () => {
    // Only what was queued before the flush: callbacks queued now wait for the
    // next substep, as they would wait for the next frame.
    for (const id of [...frames.keys()]) {
      const cb = frames.get(id);
      if (!cb) continue; // cancelled by an earlier callback
      frames.delete(id);
      n.rafCallbacks++;
      call(cb, [time]);
    }
  };

  // ---------------------------------------------------------------- timers

  // A min-heap on (due, order of scheduling): ties fire in the order they were set.
  const heap = [];
  const timers = new Map(); // id -> entry; a cleared timer is simply gone from here
  let timerId = 0, seq = 0, nesting = 0;
  const before = (a, b) => a.due < b.due || (a.due === b.due && a.seq < b.seq);
  const swap = (i, j) => { const x = heap[i]; heap[i] = heap[j]; heap[j] = x; };
  const push = (e) => {
    heap.push(e);
    for (let i = heap.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (!before(heap[i], heap[p])) break;
      swap(i, p);
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && before(heap[l], heap[m])) m = l;
        if (r < heap.length && before(heap[r], heap[m])) m = r;
        if (m === i) break;
        swap(i, m);
        i = m;
      }
    }
    return top;
  };
  // HTML's rule: past five nested levels a timer waits at least 4 ms. It also
  // keeps a zero-delay chain from spinning forever inside one substep.
  const schedule = (e, delay) => {
    delay = Math.max(0, Number(delay) || 0);
    if (nesting > 5 && delay < 4) delay = 4;
    e.due = time + delay;
    e.seq = ++seq;
    e.nest = nesting + 1;
    push(e);
  };
  const addTimer = (handler, delay, args, repeat) => {
    const fn = typeof handler === 'function' ? handler : () => (0, eval)(String(handler));
    const e = { id: ++timerId, fn, args, every: repeat ? delay : null };
    timers.set(e.id, e);
    schedule(e, delay);
    return e.id;
  };
  const clear = (id) => { timers.delete(Number(id)); };
  window.setTimeout = function setTimeout(handler, timeout = 0, ...args) {
    return addTimer(handler, timeout, args, false);
  };
  window.setInterval = function setInterval(handler, timeout = 0, ...args) {
    return addTimer(handler, timeout, args, true);
  };
  window.clearTimeout = function clearTimeout(id) { clear(id); };
  window.clearInterval = function clearInterval(id) { clear(id); };
  // Idle callbacks are zero-delay timers with a fixed, generous deadline.
  window.requestIdleCallback = function requestIdleCallback(cb) {
    const deadline = { didTimeout: false, timeRemaining: () => 50 };
    return addTimer(() => cb(deadline), 0, [], false);
  };
  window.cancelIdleCallback = function cancelIdleCallback(id) { clear(id); };

  // Every timer due by `end`, in order, including ones they set that are also
  // due. Each fires at its own due time, so performance.now() inside reads true.
  const fireTimers = (end) => {
    let fired = 0;
    while (heap.length && heap[0].due <= end) {
      const e = pop();
      if (timers.get(e.id) !== e) continue; // cleared
      if (++fired > GUARD) {
        n.loopGuard++;
        push(e); // it keeps its place; the next substep carries on
        break;
      }
      time = Math.max(time, e.due);
      if (e.every === null) timers.delete(e.id);
      nesting = e.nest;
      n.timersFired++;
      call(e.fn, e.args);
      if (e.every !== null && timers.get(e.id) === e) schedule(e, e.every);
      nesting = 0;
    }
    time = Math.max(time, end);
  };

  // ---------------------------------------------------------------- now, Date, random

  performance.now = function now() {
    n.performanceNow++;
    return time;
  };

  const epochNow = () => EPOCH + time;
  // Date with arguments is the real one; without, it is the virtual now.
  // Same prototype, so instanceof Date and subclasses keep working.
  const VDate = function Date(...args) {
    if (!args.length) n.dateNow++;
    if (!new.target) return new NativeDate(epochNow()).toString();
    return Reflect.construct(NativeDate, args.length ? args : [epochNow()], new.target);
  };
  Object.defineProperty(VDate, 'length', { value: 7 });
  VDate.prototype = NativeDate.prototype;
  VDate.parse = NativeDate.parse;
  VDate.UTC = NativeDate.UTC;
  VDate.now = function now() {
    n.dateNow++;
    return epochNow();
  };
  Object.defineProperty(NativeDate.prototype, 'constructor', { value: VDate, writable: true, configurable: true });
  window.Date = VDate;

  // mulberry32: small, fast and the same sequence for the same seed.
  let state = Math.floor(Number(cfg.seed ?? 1)) >>> 0;
  Math.random = function random() {
    n.randomCalls++;
    state = (state + 0x6d2b79f5) | 0;
    let r = Math.imul(state ^ (state >>> 15), 1 | state);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };

  // ---------------------------------------------------------------- CSS, Web Animations, SMIL

  // Transitions off: an adopted sheet, so no element is added to the page.
  let sheet = null;
  if (cfg.transitions !== 'on') {
    sheet = new CSSStyleSheet();
    sheet.replaceSync('*, *::before, *::after { transition: none !important; }');
  }
  const keepSheet = () => {
    if (sheet && !document.adoptedStyleSheets.includes(sheet)) document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  };
  keepSheet();

  // Each animation starts the first time it is seen, is paused, and is set to
  // virtual time by hand (times its playback rate). One past its end is
  // finished instead, so its end event and `finished` promise still fire.
  const seen = new WeakMap(); // animation -> { base, since, rate, set, off }
  const syncAnimations = () => {
    for (const a of document.getAnimations()) {
      if (!(a.timeline instanceof DocumentTimeline)) continue; // scroll-driven: not time
      const end = a.effect ? a.effect.getComputedTiming().endTime : Infinity;
      let s = seen.get(a);
      if (!s) {
        const rate = a.playbackRate;
        seen.set(a, (s = { base: rate < 0 && end < Infinity ? end : 0, since: time, rate, set: null, off: false }));
        n.animations++;
      } else if (s.off) continue;
      // The page seeked it or played it again: carry on from where it is now.
      if (s.set !== null && Math.abs((a.currentTime ?? 0) - s.set) > 0.01) {
        s.base = a.currentTime ?? 0;
        s.since = time;
      }
      if (a.playbackRate !== s.rate) {
        s.base += (time - s.since) * s.rate;
        s.since = time;
        s.rate = a.playbackRate;
      }
      const t = s.base + (time - s.since) * s.rate;
      try {
        if ((s.rate > 0 && t >= end) || (s.rate < 0 && t <= 0)) {
          if (a.playState !== 'finished') a.finish();
        } else {
          if (a.playState !== 'paused') a.pause();
          a.currentTime = t;
        }
        s.set = a.currentTime;
      } catch (e) {
        s.off = true; // once, not every substep
        report(e);
      }
    }
  };

  // SMIL runs on each outermost <svg>'s own clock: pause it and set it.
  const SVG = 'http://www.w3.org/2000/svg';
  const smil = ['animate', 'set', 'animateMotion', 'animateTransform'].map((tag) => document.getElementsByTagNameNS(SVG, tag));
  const roots = new Map(); // outermost <svg> -> virtual start
  const syncSmil = () => {
    for (const list of smil) {
      for (const el of list) {
        let svg = el.ownerSVGElement;
        if (!svg) continue;
        while (svg.ownerSVGElement) svg = svg.ownerSVGElement;
        if (!roots.has(svg)) {
          roots.set(svg, time);
          n.smilRoots++;
        }
      }
    }
    for (const [svg, start] of roots) {
      svg.pauseAnimations();
      svg.setCurrentTime((time - start) / 1000);
    }
  };

  const syncAll = () => {
    keepSheet();
    syncAnimations();
    syncSmil();
  };

  // ---------------------------------------------------------------- the clock

  // Substeps of at most 1/60 s. In each: the timers due by its end, then the
  // frame queue, then the animations. It runs synchronously, so promise
  // callbacks the page queues on the way run once it returns.
  const advanceTo = (ms) => {
    ms = Number(ms);
    if (!Number.isFinite(ms)) throw new TypeError(`__vclock.advanceTo: ${ms} is not a time in ms`);
    if (ms < time - 1e-6) throw new RangeError(`__vclock.advanceTo(${ms}): time only moves forward (it is ${time})`);
    const from = time, span = ms - from;
    const steps = span > 1e-6 ? Math.ceil(span / STEP - 1e-6) : 0;
    for (let i = 1; i <= steps; i++) {
      n.substeps++;
      fireTimers(i === steps ? ms : from + (span * i) / steps);
      flushFrames();
      syncAll();
    }
    // A hold still pins animations the page started since the last frame.
    if (!steps) syncAll();
    return time;
  };

  // The real rAF: the recorder waits on it before a screenshot. Repeatable
  // pixels also need Chrome started with --disable-partial-raster.
  const paint = () => new Promise((done) => nativeRaf(() => nativeRaf(() => done())));

  const stats = () => ({ now: time, ...n, pendingTimers: timers.size, pendingFrames: frames.size });

  Object.defineProperty(window, '__vclock', {
    value: Object.freeze({ now: () => time, advanceTo, paint, stats }),
    enumerable: false,
  });
})();
