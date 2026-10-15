// The figure contract (version 1) that capture-figure.mjs records: a page that
// calls figureHook() can be stepped frame by frame into a clip. No imports, so
// a figure's build can inline this file into its own <script type="module">.
//
//   figureHook({ range, marks, seekable, step, draw, stop, ready }) -> window.__figure
//
//   range     [t0, t1] in the figure's own units (CI seconds, turns, anything)
//   draw(t)   render figure time t, synchronously
//   step(dt, t) advance springs and other motion by dt real seconds, towards
//             the state at figure time t; called in substeps of at most 1/60 s,
//             before draw(t). Leave it out when the figure has no motion of its own.
//   seekable  true only when draw(t) alone gives the right picture for any t,
//             in any order (no springs): the recorder may then split the work.
//   marks     [{ id, t, anchor?, label?, poster?, look? }], named moments in figure time
//   stop()    called once, before the first frame: cancel your own
//             requestAnimationFrame loop, tour timers and listeners.
//   ready     an optional promise (fonts, images, a WebGL warm-up) to wait for.
//
// `recording` is true when the recorder loaded the page: don't start the idle
// tour or any timer then, so every recording starts from the same state.

export const recording = typeof window !== 'undefined' && !!window.__figureRecording;

export function figureHook({ range, marks = [], seekable = false, step, draw, stop, ready } = {}) {
  if (!Array.isArray(range) || range.length !== 2 || !(range[1] >= range[0])) throw new Error('figureHook: range must be [t0, t1] with t1 >= t0');
  if (typeof draw !== 'function') throw new Error('figureHook: draw(t) is required');
  let driven = false;
  const fig = {
    version: 1,
    range: [range[0], range[1]],
    marks,
    seekable: !!seekable,
    get driven() { return driven; },
    // t: figure time. dt: real (video) seconds since the last frame; 0 on the
    // first frame and whenever the recorder renders frames out of order.
    frame(t, dt = 0) {
      if (!driven) {
        driven = true;
        stop?.();
      }
      if (!fig.seekable && step && dt > 0) {
        const n = Math.ceil(dt * 60 - 1e-9);
        for (let i = 0; i < n; i++) step(dt / n, t);
      }
      return draw(t);
    },
  };
  fig.ready = Promise.resolve(ready)
    .then(() => (typeof document !== 'undefined' && document.fonts ? document.fonts.ready : null))
    .then(() => { if (!driven) draw(fig.range[0]); });
  window.__figure = fig;
  return fig;
}

// Fritsch-Carlson monotone cubic through keys [[x, y], ...] (x strictly
// rising, y never falling): a repeated y is a hold that motion eases into.
export function monotone(keys) {
  const n = keys.length, d = [], m = new Array(n).fill(0);
  if (n === 1) return () => keys[0][1];
  for (let i = 0; i < n - 1; i++) d.push((keys[i + 1][1] - keys[i][1]) / (keys[i + 1][0] - keys[i][0]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (2 * d[i - 1] * d[i]) / (d[i - 1] + d[i]);
  return (x) => {
    if (x <= keys[0][0]) return keys[0][1];
    for (let i = 0; i < n - 1; i++) {
      const [x0, y0] = keys[i], [x1, y1] = keys[i + 1];
      if (x > x1) continue;
      const h = x1 - x0, s = (x - x0) / h;
      const h00 = 2 * s ** 3 - 3 * s ** 2 + 1, h10 = s ** 3 - 2 * s ** 2 + s, h01 = -2 * s ** 3 + 3 * s ** 2, h11 = s ** 3 - s ** 2;
      return h00 * y0 + h10 * h * m[i] + h01 * y1 + h11 * h * m[i + 1];
    }
    return keys[n - 1][1];
  };
}
