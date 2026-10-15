// The truth behind the example figure. Every number here is FICTIONAL: step
// times invented for a made-up project, chosen to be easy to read, not
// measured from any real build. Every number the figure (and app.html) shows
// comes from this file.

export const SOURCE = 'Fictional step times, invented for this example';

// Kinds of step. A plate takes its kind's colour in every lane, and the
// legend lists them in this order.
export const KINDS = {
  boot: 'Start machine, clean up',
  setup: 'Install dependencies',
  check: 'Lint and type check',
  build: 'Compile',
  test: 'Tests',
};

// Each step once: [kind, seconds, what it does].
export const STEPS = {
  start: ['boot', 5, 'Start the machine, check out'],
  install: ['setup', 25, 'Install dependencies'],
  lint: ['check', 15, 'Lint'],
  types: ['check', 30, 'Type check'],
  compile: ['build', 95, 'Compile'],
  tests: ['test', 45, 'Unit tests'],
  clean: ['boot', 5, 'Clean up'],
};

// Today one machine runs every step in turn. Split, two machines start
// together and each runs its own share; both still start up and install.
const PLAN = [
  { id: 'build', name: 'Parallel 1', run: 'parallel', steps: ['start', 'install', 'compile', 'clean'] },
  { id: 'checks', name: 'Parallel 2', run: 'parallel', steps: ['start', 'install', 'lint', 'types', 'tests', 'clean'] },
  { id: 'serial', name: 'Serial', run: 'serial', steps: ['start', 'install', 'lint', 'types', 'compile', 'tests', 'clean'] },
];

// Lanes back to front, with each step's start and end in seconds.
export const LANES = PLAN.map((lane) => {
  let at = 0;
  const steps = lane.steps.map((id) => {
    const [kind, seconds, label] = STEPS[id];
    const step = { id, kind, label, t0: at, t1: at + seconds };
    at += seconds;
    return step;
  });
  return { ...lane, steps, end: at };
});

const endOf = (run) => Math.max(...LANES.filter((lane) => lane.run === run).map((lane) => lane.end));

// A run is done when its last lane is done.
export const RUNS = {
  parallel: endOf('parallel'), // 130 s
  serial: endOf('serial'), // 220 s
};
export const SAVED = RUNS.serial - RUNS.parallel; // 90 s

// 130 -> "2:10" (the clock), and "2 m 10 s" (prose).
export const clock = (seconds) => {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
export const words = (seconds) => {
  const s = Math.max(0, Math.round(seconds));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} m ${s % 60} s`;
};
