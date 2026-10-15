// Builds bench.html, the example explainer figure: a fictional serial vs
// parallel build drawn as a timing bench with the anatomy skill's kit, and
// app.html, the tiny page a hybrid demo records beside it. Run it with node;
// it writes both files next to itself.
//
// Anatomy is found at $ANATOMY_DIR, else in the usual skill folders.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { KINDS, LANES, RUNS, SAVED, SOURCE, STEPS, clock, words } from './model.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ANATOMY = [
  process.env.ANATOMY_DIR,
  join(homedir(), '.claude/skills/anatomy'),
  join(homedir(), '.claude-work/skills/anatomy'),
  join(homedir(), '.agents/skills/anatomy'),
].filter(Boolean).find((dir) => existsSync(join(dir, 'kit/iso-kit.mjs')));
if (!ANATOMY) {
  console.error('The anatomy skill was not found (looked at $ANATOMY_DIR, ~/.claude/skills, ~/.claude-work/skills and ~/.agents/skills).');
  console.error('Install it with: npx skills add wheresryan22/anatomy -g -a claude-code');
  process.exit(1);
}
const load = (file) => import(pathToFileURL(join(ANATOMY, file)).href);
const k = await load('kit/iso-kit.mjs');
const G = await load('kit/lathe.mjs');
const { kitScript } = await load('scripts/inline-kit.mjs');
// The figure contract, inlined like the kit.
const HOOK = readFileSync(join(HERE, '../../scripts/figure-hook.js'), 'utf8').replace(/^export /gm, '');

// ---------------------------------------------------------------------------
// The world: x is build time along the bench, y runs from the back rail to
// the front ruler, z is up. Units are about a pixel of the real bench.
// ---------------------------------------------------------------------------
const S = 1.35; // world units per build second
const X = (t) => t * S;
const T0 = 0; // the gantry waits at 0:00, its heads over the first plates
const END = RUNS.serial; // the clock stops when the last lane is done
const T1 = END + 3; // and the last lamp and gate settle
const LANE_Y = { build: -48, checks: -20, serial: 16 };
const HEIGHT_OF = { boot: 1.2, setup: 2.6, check: 4, build: 4, test: 4 };
const BED_TOP = 2;
const BLOCK_H = 7;
const PLATE_D = 10;
const BED_D = 14;

const BASE = { x: -92, y: -90, w: X(END) + 130, d: 151, r: 10 };
const BASE_H = 10;
const FOOT_H = 5;
const RAIL = { x: X(T0) - 18, y: -82, w: X(END) - X(T0) + 34, d: 5, r: 1 };
const RULER = { x: X(0) - 10, y: 43, w: X(END) + 16, d: 10, r: 1.2 };
const RULER_H = 7.5;
const LABEL = { x: -80, y: 42, w: 36, d: 13, r: 1.4 };

// The gantry: a tower on the back rail, an arm over every lane, a head per
// lane and a pointer on the ruler. Built at x = 0 and moved along x.
const COL = [0, -79.5];
const COL_TOP = 40;
const ARM_Z = 38.5;
const ARM_H = 3.5;
const POINTER_Y = RULER.y + 3;
const ARM = { x: -2.6, y: -74.5, w: 5.2, d: POINTER_Y + 2.5 + 74.5, r: 1 };
const SLEEVE_Z = 24;
const TIP_Z = 7.2;
const TIP_H = 1.4;
const ROD_TOP = 25;
const LIFT = 15; // a head lifts this far into its sleeve when its lane is done

// The gates: one per run, just past its last lane. A lamp per lane lights as
// that lane finishes; the bar lifts when every lane of the run is done.
const GATE_POST = 16;
const BOOM_Z = 3;
const BOOM_H = 3.4;
const BOOM_LIFT = 9;
const GATES = [
  { id: 'parallel', x: X(RUNS.parallel) + 20, posts: [[-62, 'build'], [-6, 'checks']], at: RUNS.parallel },
  { id: 'serial', x: X(RUNS.serial) + 20, posts: [[4, null], [26, 'serial']], at: RUNS.serial },
];

const MARKS = [
  { id: 'setup-done', t: STEPS.start[1] + STEPS.install[1], anchor: '[data-part="gantry"]', label: 'Every machine installs first' },
  { id: 'checks-done', t: lane('checks').end, anchor: '[data-tail="checks"]', label: `Parallel 2 done at ${clock(lane('checks').end)}` },
  { id: 'gate-open', t: RUNS.parallel, anchor: '[data-gate="parallel"]', label: `Parallel run done: ${clock(RUNS.parallel)}` },
  { id: 'serial-done', t: RUNS.serial, anchor: '[data-gate="serial"]', label: `Serial run done: ${clock(RUNS.serial)}` },
  { id: 'saved', t: T1, anchor: '[data-part="saved"]', label: `${words(SAVED)} saved`, poster: true },
];

function lane(id) {
  return LANES.find((item) => item.id === id);
}

// ---------------------------------------------------------------------------
// Camera: azimuth 66 to show the long side, a little above the usual 30.
// ---------------------------------------------------------------------------
const AZIMUTH = 66;
const ELEVATION = 36;
const PAD = 8;
const EXTREMES = [
  ...k.boxCorners(BASE, -BASE_H - FOOT_H, 0),
  [X(T0) - 8, COL[1] - 5, COL_TOP + 9],
  [X(END) + 8, COL[1] - 5, COL_TOP + 9],
  ...GATES.map((gate) => [gate.x + 3, gate.posts[1][0] + 3, GATE_POST + 2]),
];
const unit = { origin: [0, 0], scale: 1, azimuth: AZIMUTH, elevation: ELEVATION };
const flat = EXTREMES.map((point) => k.iso(point, unit));
const spanX = Math.max(...flat.map(([x]) => x)) - Math.min(...flat.map(([x]) => x));
const spanY = Math.max(...flat.map(([, y]) => y)) - Math.min(...flat.map(([, y]) => y));
const HEIGHT = 440;
const WIDTH = Math.round((HEIGHT - PAD * 2) * (spanX / spanY) + PAD * 2);
const P = k.fitProjection(EXTREMES, WIDTH, HEIGHT, { pad: PAD, azimuth: AZIMUTH, elevation: ELEVATION });

const at = (point) => k.iso(point, P);
const Sd = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
// A transform that lays text or shapes on any plane: u along the line, v down it.
const planeMatrix = (origin, u, v) => {
  const o = at(origin);
  const a = at([origin[0] + u[0], origin[1] + u[1], origin[2] + u[2]]);
  const b = at([origin[0] + v[0], origin[1] + v[1], origin[2] + v[2]]);
  const n = (value) => Math.round(value * 1000) / 1000;
  return `matrix(${n(a[0] - o[0])} ${n(a[1] - o[1])} ${n(b[0] - o[0])} ${n(b[1] - o[1])} ${n(o[0])} ${n(o[1])})`;
};

// ---------------------------------------------------------------------------
// Plates. One function draws a plate here and, inlined, in the page, where a
// plate being laid is redrawn at the width the clock has reached.
// ---------------------------------------------------------------------------
function plateSvg(K, P, plan, kind, height, z) {
  if (plan.w < 0.25) return '';
  const shape = { ...plan, r: Math.min(plan.r, plan.w / 2) };
  const top = z + height;
  if (kind === 'boot') return K.solidSvg(K.slabOf(shape, z, height, P, 2), { tone: 'lo', crease: 'none' });
  if (kind === 'setup') {
    const ribs = [];
    for (let x = shape.x + 1.5; x < shape.x + shape.w - 0.9; x += 1.8) ribs.push(K.lineOnTop([x, shape.y], [x, shape.y + shape.d], top, P));
    return K.solidSvg(K.slabOf(shape, z, height, P, 2, 0.3), { tone: 'mid' }) + K.lineSvg(ribs.join(''), { tone: 'faint' });
  }
  const groove = shape.w > 4 ? K.lineSvg(K.planOutline(K.insetPlan(shape, 1.2), top, P, 2), { tone: 'faint' }) : '';
  return K.solidSvg(K.slabOf(shape, z, height, P, 2, 0.4), { tone: 'hi', crease: 'lo' }) + groove;
}

// The time-saved inlay on the ruler, from the parallel finish to the clock.
function savedSvg(K, P, x0, x1, y, d, z) {
  if (x1 - x0 < 0.3) return '';
  return K.solidSvg(K.slabOf({ x: x0, y, w: x1 - x0, d, r: Math.min(0.6, (x1 - x0) / 2) }, z, 0.7, P, 2), { tone: 'hi', crease: 'lo' });
}

const plateOf = (laneItem, step) => {
  const w = (step.t1 - step.t0) * S - 0.4;
  return { x: X(step.t0) + 0.2, y: LANE_Y[laneItem.id] - PLATE_D / 2, w, d: PLATE_D, r: 0.8 };
};

// ---------------------------------------------------------------------------
// Base: plate on feet, groove, corner screws, the label plate and the ruler.
// ---------------------------------------------------------------------------
function base() {
  const out = [`<path class="iso-halo" d="${k.haloOf(BASE, -BASE_H - FOOT_H, BASE_H, P)}"/>`];
  for (const [x, y] of byDepth(k.corners(BASE, 26))) {
    out.push(Sd(k.cylinder(x, y, 7.5, -BASE_H - FOOT_H, 1.6, P, 28), { tone: 'lo' }));
    out.push(Sd(k.cylinder(x, y, 5.8, -BASE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: 'mid' }));
  }
  out.push(Sd(k.slabOf(BASE, -BASE_H, BASE_H, P, 8, 1.6), { tone: 'mid' }));
  out.push(L(k.planOutline(k.insetPlan(BASE, 5), 0, P), { tone: 'faint' }));
  const screws = k.corners(BASE, 10);
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(''), { tone: 'lo' }));
  out.push(D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));

  // Label plate: three rule lines stand for the printed spec.
  out.push(Sd(k.slabOf(LABEL, 0, 0.8, P, 4), { tone: 'lo', crease: 'none' }));
  out.push(L(k.planOutline(k.insetPlan(LABEL, 1.6), 0.8, P, 4), { tone: 'faint' }));
  [22, 15, 18].forEach((len, index) => {
    const y = LABEL.y + 4 + index * 2.6;
    out.push(L(k.lineOnTop([LABEL.x + 4.5, y], [LABEL.x + 4.5 + len, y], 0.8, P), { tone: 'lo', free: true }));
  });
  out.push(D([at([LABEL.x + LABEL.w - 3, LABEL.y + 3, 0.8]), at([LABEL.x + LABEL.w - 3, LABEL.y + LABEL.d - 3, 0.8])], { size: 0.45 }));
  return out.join('');
}

// The monogram stands in for a brand mark: a letter in a roundel, burned into
// the bench (a ragged scorch under a darker charred core).
function burn() {
  const [cx, cy] = [X(172), -34];
  const shapes = '<circle r="19" fill="none" stroke-width="1.6"/><circle r="15.6" fill="none" stroke-width="0.6"/><text y="0.5" text-anchor="middle" dominant-baseline="central" font-size="21" font-weight="700">B</text>';
  return [
    '<defs><filter id="bench-scorch" x="-30%" y="-30%" width="160%" height="160%"><feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="2" seed="7" result="noise"/><feDisplacementMap in="SourceGraphic" in2="noise" scale="2.4" result="ragged"/><feMorphology in="ragged" operator="dilate" radius="0.7" result="wide"/><feGaussianBlur in="wide" stdDeviation="1.4"/></filter>',
    '<filter id="bench-char" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="1" seed="3" result="grain"/><feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -0.6 1.25" result="speck"/><feComposite in="SourceGraphic" in2="speck" operator="in"/></filter></defs>',
    `<g class="bench-burn" data-part="monogram" transform="${k.topMatrix([cx, cy], 0, P, 'x')}">`,
    `<g class="halo" filter="url(#bench-scorch)">${shapes}</g>`,
    `<g class="core" filter="url(#bench-char)">${shapes}</g>`,
    '</g>',
  ].join('');
}

function ruler() {
  const out = [Sd(k.slabOf(RULER, 0, RULER_H, P, 3, 0.5), { tone: 'mid' })];
  // A tick every 5 s, a long one every minute, rooted on the back edge.
  const ticks = k.topTicks(X(0), X(END), 5 * S, 12, RULER.y, RULER_H, [2, 3.8], P);
  out.push(L(ticks.minor, { tone: 'lo' }), L(ticks.major, { tone: 'hi' }));
  out.push(D([at([RULER.x + 2.4, RULER.y + 7.5, RULER_H]), at([RULER.x + RULER.w - 2.4, RULER.y + 7.5, RULER_H])], { size: 0.45 }));
  // Minutes engraved on the front face, under their long ticks.
  for (let minute = 0; minute * 60 <= END; minute++) {
    const transform = k.sideMatrix([X(minute * 60), RULER.y + RULER.d], RULER_H, P, 'left');
    out.push(`<g class="bench-num">${faceText(transform, `${minute}:00`, { size: 6.2, y: (RULER_H + 4.5) / 2 })}</g>`);
  }
  return out.join('');
}

function rail() {
  const out = [Sd(k.slabOf(RAIL, 0, 3, P, 3, 0.4), { tone: 'mid' })];
  out.push(L(k.lineOnTop([RAIL.x, RAIL.y + 2.5], [RAIL.x + RAIL.w, RAIL.y + 2.5], 3, P), { tone: 'faint' }));
  for (const x of [RAIL.x - 5, RAIL.x + RAIL.w]) {
    out.push(Sd(k.slabOf({ x, y: RAIL.y - 2, w: 5, d: 9, r: 1.2 }, 0, 6, P, 3, 0.5), { tone: 'mid' }));
    out.push(D([at([x + 2.5, RAIL.y + 0.2, 6]), at([x + 2.5, RAIL.y + 4.8, 6])], { size: 0.45 }));
  }
  return out.join('');
}

// ---------------------------------------------------------------------------
// Lanes: a nameplate, a start block, a bed, a plate per step, an end stop.
// ---------------------------------------------------------------------------
// The nameplate sits left of the strip the parked arm hides (about 5 to 27
// units behind the heads), so the names read from the first frame.
const NAME = { x: -82, w: 50, d: 10, back: 9, lip: 1.4 };
const MACHINE = { x: -27, w: 23, h: 9 };
const faceText = (transform, text, { size, tone = 'hi', anchor = 'middle', y }) =>
  `<text class="iso-face-text" data-tone="${tone}" transform="${transform}" y="${y.toFixed(2)}" font-size="${size}" text-anchor="${anchor}">${text}</text>`;

function nameplate(laneItem) {
  const y = LANE_Y[laneItem.id] - NAME.d / 2;
  const F = G.frameOf([NAME.x, y, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
  const out = [Sd(G.prismOf(F, [[0, 0], [NAME.d, 0], [NAME.d, NAME.lip], [0, NAME.back]], 0, NAME.w, P), { tone: 'mid' })];
  // The name sits on the sloped face, which looks straight at the reader.
  const slope = Math.hypot(NAME.d, NAME.back - NAME.lip);
  const down = [0, NAME.d / slope, (NAME.lip - NAME.back) / slope];
  const origin = [NAME.x + NAME.w / 2, y, NAME.back];
  out.push(`<g class="bench-name">${faceText(planeMatrix(origin, [1, 0, 0], down), laneItem.name.toUpperCase(), { size: 6, y: slope / 2 + 2.1 })}</g>`);
  const screw = (u) => at([NAME.x + u, y + down[1] * 2, NAME.back + down[2] * 2]);
  out.push(D([screw(2.4), screw(NAME.w - 2.4)], { size: 0.45 }));
  return out.join('');
}

function laneSvg(laneItem) {
  const y = LANE_Y[laneItem.id];
  const end = X(laneItem.end);
  const out = [`<g data-lane="${laneItem.id}">`, nameplate(laneItem)];
  // The machine that runs the lane: a case with a vent grid and a status
  // lamp that glows while the lane runs.
  const box = { x: MACHINE.x, y: y - BED_D / 2, w: MACHINE.w, d: BED_D, r: 1.6 };
  out.push(Sd(k.slabOf(box, 0, MACHINE.h, P, 4, 0.6), { tone: 'mid', inner: L(k.sideSeam(box, 2.4, P, 4), { tone: 'faint' }) }));
  const vent = { x: box.x + 3, y: box.y + 3, w: 11, d: 8, r: 1 };
  out.push(L(k.planOutline(vent, MACHINE.h, P, 3), { tone: 'lo' }));
  out.push(D(k.dotGrid(vent.x + 1.5, vent.y + 2, 5, 3, 2, MACHINE.h, P), { size: 0.5, tone: 'mid' }));
  const led = [box.x + box.w - 4.2, y + 2.6];
  const ledLens = k.ring(led[0], led[1], 1.1, MACHINE.h + 0.6, P, 20);
  out.push(Sd(k.cylinder(led[0], led[1], 1.6, MACHINE.h, 0.6, P, 20), { tone: 'mid' }));
  out.push(`<g data-led="${laneItem.id}"><path class="led-glow" d="${k.ring(led[0], led[1], 3.4, MACHINE.h + 0.6, P, 24)}" opacity="0"/><path class="lamp-lens" d="${ledLens}"/><path class="led-on" d="${ledLens}" opacity="0"/></g>`);
  out.push(D([at([box.x + 2, box.y + box.d - 2, MACHINE.h]), at([box.x + box.w - 2, box.y + 2, MACHINE.h])], { size: 0.45 }));
  const bed = { x: MACHINE.x + MACHINE.w, y: y - BED_D / 2, w: end + 3 - (MACHINE.x + MACHINE.w) - 1.5, d: BED_D, r: 1.2 };
  out.push(Sd(k.slabOf(bed, 0, BED_TOP, P, 3, 0.4), { tone: 'mid' }));
  // The last work step and clean up, with the end stop: the lane's finish.
  const tail = laneItem.steps.length - 2;
  laneItem.steps.forEach((step, index) => {
    if (index === tail) out.push(`<g data-tail="${laneItem.id}">`);
    const plan = plateOf(laneItem, step);
    out.push(`<g class="k-${step.kind}" data-step="${step.id}"><g class="ghost" data-ghost>${plateSvg(k, P, plan, step.kind, HEIGHT_OF[step.kind], BED_TOP)}</g><g data-fill></g></g>`);
  });
  const stop = { x: end + 1.5, y: y - BED_D / 2, w: 5, d: BED_D, r: 1.2 };
  out.push(Sd(k.slabOf(stop, 0, BLOCK_H, P, 3, 0.5), { tone: 'mid' }));
  out.push(D([at([stop.x + 2.5, stop.y + 2.2, BLOCK_H]), at([stop.x + 2.5, stop.y + stop.d - 2.2, BLOCK_H])], { size: 0.45 }));
  out.push('</g></g>');
  return out.join('');
}

// ---------------------------------------------------------------------------
// Gates: two posts on foot plates with a lamp on each lane's post, and a bar
// between them, across the lanes, that lifts when the run is done.
// ---------------------------------------------------------------------------
function post(x, y, lamp) {
  const out = [Sd(k.slabOf({ x: x - 3.2, y: y - 3.2, w: 6.4, d: 6.4, r: 1 }, 0, 1.2, P, 3, 0.3), { tone: 'mid' })];
  out.push(D([at([x + 2.2, y - 2, 1.2]), at([x + 2.2, y + 2, 1.2])], { size: 0.4 }));
  out.push(Sd(k.cylinder(x, y, 2, 1.2, GATE_POST - 1.2, P, 24), { tone: 'mid', crease: 'none', inner: L([2.2, 9.5].map((z) => k.sideArc(x, y, 2, z, P, 16)).join(''), { tone: 'faint' }) }));
  out.push(Sd(k.cylinder(x, y, 2.6, GATE_POST, 1.4, P, 24), { tone: 'mid' }));
  const z = GATE_POST + 1.4;
  if (!lamp) return out.join('') + D([at([x, y, z])], { size: 0.5 });
  const lens = k.ring(x, y, 1.7, z, P, 28);
  out.push(`<g data-lamp="${lamp}"><path class="lamp-glow" d="${k.ring(x, y, 5.2, z, P, 32)}" opacity="0"/><path class="lamp-lens" d="${lens}"/><path class="lamp-on" d="${lens}" opacity="0"/></g>`);
  return out.join('');
}

function gateSvg(gate) {
  const [[y0, lamp0], [y1, lamp1]] = gate.posts;
  const out = [`<g data-gate="${gate.id}">`, post(gate.x, y0, lamp0)];
  const boom = { x: gate.x - 1.4, y: y0 + 2, w: 2.8, d: y1 - y0 - 4, r: 0.8 };
  const bands = [];
  for (let y = boom.y + 3.5; y < boom.y + boom.d - 2; y += 3.5) bands.push(k.lineOnTop([boom.x, y], [boom.x + boom.w, y], BOOM_Z + BOOM_H, P));
  out.push(`<g data-boom="${gate.id}">${Sd(k.slabOf(boom, BOOM_Z, BOOM_H, P, 2, 0.3), { tone: 'hi', crease: 'lo' })}${L(bands.join(''), { tone: 'mid' })}</g>`);
  out.push(post(gate.x, y1, lamp1), '</g>');
  return out.join('');
}

// ---------------------------------------------------------------------------
// The gantry: tower (drawn before the lanes) and the arm with its heads and
// pointer (drawn after them).
// ---------------------------------------------------------------------------
function tower() {
  const out = [`<path class="iso-halo" d="${k.haloOf({ x: -6.5, y: COL[1] - 6, w: 13, d: 12, r: 2 }, 3, 0.1, P)}" style="filter:blur(3px)"/>`];
  const carriage = { x: -6.5, y: COL[1] - 5, w: 13, d: 10, r: 1.6 };
  out.push(Sd(k.slabOf(carriage, 3, 4, P, 4, 0.5), { tone: 'mid' }));
  out.push(D([[-4.6, carriage.y + carriage.d - 1.6], [4.6, carriage.y + carriage.d - 1.6], [-4.6, carriage.y + 1.6], [4.6, carriage.y + 1.6]].map(([x, y]) => at([x, y, 7])), { size: 0.4 }));
  out.push(Sd(k.cylinder(COL[0], COL[1], 4.2, 7, 2, P, 28), { tone: 'mid' }));
  out.push(Sd(k.cylinder(COL[0], COL[1], 3, 9, COL_TOP - 9, P, 28), { tone: 'mid', crease: 'none', inner: L([18, 28].map((z) => k.sideArc(COL[0], COL[1], 3, z, P, 16)).join(''), { tone: 'faint' }) }));
  const head = { x: -5, y: COL[1] - 5, w: 10, d: 10, r: 1.6 };
  out.push(Sd(k.slabOf(head, COL_TOP - 4, 10, P, 4, 0.6), { tone: 'mid' }));
  out.push(D(k.corners(head, 2).map(([x, y]) => at([x, y, COL_TOP + 6])), { size: 0.4 }));
  out.push(Sd(k.cylinder(0, COL[1], 2.4, COL_TOP + 6, 2.2, P, 20), { tone: 'mid' }));
  out.push(L(k.knurl(0, COL[1], 2.4, COL_TOP + 6, COL_TOP + 8.2, 18, P), { tone: 'lo' }));
  return out.join('');
}

function head(id) {
  const y = LANE_Y[id];
  const moving = [
    Sd(k.cylinder(0, y, 0.7, TIP_Z + TIP_H, ROD_TOP - TIP_Z - TIP_H, P, 16), { tone: 'hi', crease: 'none' }),
    Sd(k.cylinder(0, y, 1.5, TIP_Z, TIP_H, P, 20), { tone: 'hi' }),
  ].join('');
  const sleeve = Sd(k.cylinder(0, y, 1.9, SLEEVE_Z, ARM_Z - SLEEVE_Z, P, 20), { tone: 'mid', inner: L(k.sideArc(0, y, 1.9, SLEEVE_Z + 1.6, P, 14), { tone: 'faint' }) });
  return `<g data-head="${id}">${moving}</g>${sleeve}`;
}

function arm() {
  const out = [];
  out.push(Sd(k.cylinder(0, POINTER_Y, 0.7, RULER_H + 1, ARM_Z - RULER_H - 1, P, 16), { tone: 'hi', crease: 'none', lit: true }));
  out.push(Sd(k.cylinder(0, POINTER_Y, 1.4, RULER_H, 1, P, 18), { tone: 'hi', lit: true }));
  out.push(Sd(k.slabOf(ARM, ARM_Z, ARM_H, P, 3, 0.4), { tone: 'mid' }));
  out.push(D([...Object.values(LANE_Y), POINTER_Y].map((y) => at([0, y + 3.2, ARM_Z + ARM_H])), { size: 0.4, tone: 'lo' }));
  return out.join('');
}

// The pointer's mark across the ruler, under the gantry's foot.
const pointerLine = L(k.lineOnTop([0, RULER.y], [0, RULER.y + RULER.d], RULER_H, P), { tone: 'lit' });

// ---------------------------------------------------------------------------
// Assemble, back to front. The gates are taller than the heads, so each one
// is drawn before or after the gantry depending on which side of it it is.
// ---------------------------------------------------------------------------
const gantryAt = (t) => k.translateAlong(P, [X(t), 0, 0]);
const BACK_TO_FRONT = [...LANES].sort((a, b) => LANE_Y[a.id] - LANE_Y[b.id]);
const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label: `A timing bench for a build, with ${SOURCE.toLowerCase()}. Distance along the bench is time, one long ruler tick per minute. The front lane is the serial run: one machine does every step in turn and finishes at ${clock(RUNS.serial)}. The two lanes behind it are the parallel run: two machines start together, each installs, then one compiles while the other lints, type checks and runs the tests. The parallel run ends when its slower lane does, at ${clock(RUNS.parallel)}, and the bare bench after it is the ${words(SAVED)} saved. A gantry sweeps along the bench as the clock and lays each plate as its step runs; a lamp lights as each lane finishes and each run's gate lifts when its last lane is done.`,
  body: [
    base(),
    burn(),
    rail(),
    `<g data-part="tower" transform="${gantryAt(T0)}">${tower()}</g>`,
    BACK_TO_FRONT.map(laneSvg).join(''),
    ruler(),
    '<g data-part="saved" class="k-saved"></g>',
    '<g data-slot="before"></g>',
    `<g data-part="gantry" transform="${gantryAt(T0)}">${pointerLine}${BACK_TO_FRONT.map((item) => head(item.id)).join('')}${arm()}</g>`,
    `<g data-slot="after">${GATES.map(gateSvg).join('')}</g>`,
  ],
});

// ---------------------------------------------------------------------------
// The live page: draw(t) is a pure function of build time t, so the recorder
// can render any frame in any order. Opened normally, an idle tour plays it.
// ---------------------------------------------------------------------------
const DATA = {
  S, T0, T1, END, BED_TOP, LIFT, BOOM_LIFT,
  PARALLEL: RUNS.parallel,
  SAVED_PLAN: { y: RULER.y + 5.2, d: 3.9, z: RULER_H },
  RULER_Y: RULER.y + 5,
  RULER_Z: RULER_H,
  LANES: LANES.map((item) => ({ id: item.id, end: item.end, steps: item.steps.map((step) => ({ id: step.id, kind: step.kind, t0: step.t0, t1: step.t1, h: HEIGHT_OF[step.kind], plan: plateOf(item, step) })) })),
  GATES: GATES.map((gate) => ({ id: gate.id, x: gate.x, at: gate.at })),
  EVENTS: [...new Set([T0, 0, ...MARKS.map((mark) => mark.t), T1])].sort((a, b) => a - b),
};

const live = `
${HOOK}
const P = ${JSON.stringify(P)};
const B = ${JSON.stringify(DATA)};
const MARKS = ${JSON.stringify(MARKS)};
const K = { slabOf, solidSvg, lineSvg, lineOnTop, planOutline, insetPlan };
const plateSvg = ${plateSvg.toString()};
const savedSvg = ${savedSvg.toString()};
const clockOf = ${clock.toString()};
const ease01 = (x) => { const v = Math.min(1, Math.max(0, x)); return v * v * (3 - 2 * v); };
const clampT = (t) => Math.min(B.T1, Math.max(B.T0, t));
const stage = document.querySelector('.iso-stage');
const svgEl = stage.querySelector('svg');
const $ = (selector) => svgEl.querySelector(selector);
const tower = $('[data-part="tower"]');
const gantry = $('[data-part="gantry"]');
const savedEl = $('[data-part="saved"]');
const slots = { before: $('[data-slot="before"]'), after: $('[data-slot="after"]') };
const plates = B.LANES.flatMap((lane) => lane.steps.map((step) => {
  const el = $('[data-lane="' + lane.id + '"] [data-step="' + step.id + '"]');
  return { ...step, ghost: el.querySelector('[data-ghost]'), fill: el.querySelector('[data-fill]'), drawn: -1 };
}));
const heads = B.LANES.map((lane) => ({ end: lane.end, el: $('[data-head="' + lane.id + '"]'), lift: -1 }));
const lamps = B.LANES.map((lane) => ({ end: lane.end, el: $('[data-lamp="' + lane.id + '"]'), on: -1 }));
const leds = B.LANES.map((lane) => ({ end: lane.end, el: $('[data-led="' + lane.id + '"]'), on: -1 }));
const gates = B.GATES.map((gate) => ({ ...gate, el: $('[data-gate="' + gate.id + '"]'), boom: $('[data-boom="' + gate.id + '"]'), lift: -1, slot: 'after' }));
const readout = { clock: document.querySelector('[data-readout]'), parallel: document.querySelector('[data-run="parallel"]'), serial: document.querySelector('[data-run="serial"]'), saved: document.querySelector('[data-run="saved"]') };
let drawnX = null, drawnSaved = -1;
const write = (el, text) => { if (el && el.textContent !== text) el.textContent = text; };

function draw(time) {
  const t = clampT(time);
  const gx = Math.min(t, B.END) * B.S;
  if (gx !== drawnX) {
    drawnX = gx;
    const move = translateAlong(P, [gx, 0, 0]);
    tower.setAttribute('transform', move);
    gantry.setAttribute('transform', move);
  }
  for (const plate of plates) {
    const w = Math.round(Math.min(plate.plan.w, Math.max(0, (t - plate.t0) * B.S - 0.2)) * 100) / 100;
    if (w === plate.drawn) continue;
    plate.drawn = w;
    plate.fill.innerHTML = plateSvg(K, P, { ...plate.plan, w }, plate.kind, plate.h, B.BED_TOP);
    const full = w >= plate.plan.w;
    if (full) plate.ghost.setAttribute('display', 'none');
    else plate.ghost.removeAttribute('display');
  }
  for (const head of heads) {
    const lift = Math.round(ease01((t - head.end) / 2.5) * B.LIFT * 100) / 100;
    if (lift === head.lift) continue;
    head.lift = lift;
    head.el.setAttribute('transform', translateAlong(P, [0, 0, lift]));
  }
  for (const lamp of lamps) {
    const on = Math.round(ease01((t - lamp.end) / 0.8) * 1000) / 1000;
    if (on === lamp.on) continue;
    lamp.on = on;
    lamp.el.querySelector('.lamp-on').setAttribute('opacity', String(on));
    lamp.el.querySelector('.lamp-glow').setAttribute('opacity', String(on * 0.55));
  }
  for (const led of leds) {
    // A machine's lamp glows while its lane runs.
    const on = Math.round(ease01(t / 0.6) * (1 - ease01((t - led.end) / 0.6)) * 1000) / 1000;
    if (on === led.on) continue;
    led.on = on;
    led.el.querySelector('.led-on').setAttribute('opacity', String(on));
    led.el.querySelector('.led-glow').setAttribute('opacity', String(on * 0.5));
  }
  let reorder = false;
  for (const gate of gates) {
    const lift = Math.round(ease01((t - gate.at - 0.3) / 2.2) * B.BOOM_LIFT * 100) / 100;
    if (lift !== gate.lift) {
      gate.lift = lift;
      gate.boom.setAttribute('transform', translateAlong(P, [0, 0, lift]));
    }
    const slot = gate.x > gx ? 'after' : 'before';
    if (slot !== gate.slot) reorder = true;
    gate.slot = slot;
  }
  if (reorder) for (const gate of gates) slots[gate.slot].append(gate.el);
  const savedTo = Math.round(Math.min(B.END, Math.max(B.PARALLEL, t)) * B.S * 100) / 100;
  if (savedTo !== drawnSaved) {
    drawnSaved = savedTo;
    savedEl.innerHTML = savedSvg(K, P, B.PARALLEL * B.S, savedTo, B.SAVED_PLAN.y, B.SAVED_PLAN.d, B.SAVED_PLAN.z);
  }
  const now = Math.max(0, Math.min(t, B.END));
  write(readout.clock, clockOf(now));
  write(readout.parallel, t >= B.PARALLEL ? clockOf(B.PARALLEL) : 'running');
  write(readout.serial, t >= B.END ? clockOf(B.END) : 'running');
  write(readout.saved, t > B.PARALLEL ? clockOf(Math.min(t, B.END) - B.PARALLEL) : '0:00');
  const phase = t < 0 ? 'ready' : t < B.PARALLEL ? 'both runs running' : t < B.END ? 'parallel run done, serial running' : 'both runs done';
  if (stage.getAttribute('aria-valuetext') !== phase) stage.setAttribute('aria-valuetext', phase);
}

// Idle tour, hover to scrub and arrow keys: all of it only picks a time.
const still = matchMedia('(prefers-reduced-motion: reduce)');
let shown = still.matches ? B.T1 : B.T0, goal = shown, touring = !still.matches, phase = 'wait', hold = 1.2;
let frame = 0, last = 0, visible = false, idleTimer = 0, observer = null, stopped = false;
const speedAt = (t) => (B.EVENTS.some((e) => Math.abs(t - e) < 6 && e > 0) ? 16 : 46);
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  if (touring) {
    if (phase === 'wait') { hold -= dt; if (hold <= 0) phase = 'play'; }
    else if (phase === 'play') { goal = Math.min(B.T1, goal + dt * speedAt(goal)); if (goal >= B.T1) { phase = 'end'; hold = 3; } }
    else if (phase === 'end') { hold -= dt; if (hold <= 0) { phase = 'rewind'; goal = B.T0; } }
    else if (phase === 'rewind' && Math.abs(shown - B.T0) < 0.5) { phase = 'wait'; hold = 1.2; }
  }
  const tau = phase === 'rewind' ? 0.3 : 0.08;
  shown = still.matches ? goal : shown + (goal - shown) * (1 - Math.exp(-dt / tau));
  if (Math.abs(goal - shown) < 0.01) shown = goal;
  draw(shown);
  frame = visible && !stopped && (touring || shown !== goal) ? requestAnimationFrame(tick) : 0;
}
const run = () => { if (!frame && visible && !stopped) { last = 0; frame = requestAnimationFrame(tick); } };
const steer = (to) => {
  if (stopped) return;
  touring = false;
  goal = clampT(to);
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { touring = !still.matches; phase = 'play'; run(); }, 3600);
  run();
};
function stop() {
  stopped = true;
  touring = false;
  cancelAnimationFrame(frame);
  frame = 0;
  clearTimeout(idleTimer);
  if (observer) observer.disconnect();
}

const fig = figureHook({ range: [B.T0, B.T1], marks: MARKS, seekable: true, draw, stop });
draw(shown);
if (!recording) {
  // The hook draws its first frame once fonts load; live, keep what is shown.
  fig.ready.then(() => { if (!stopped) draw(shown); });
  observer = new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; if (visible) run(); }, { rootMargin: '120px 0px' });
  observer.observe(stage);
  const { sinA, cosA, k: unitK } = cameraOf(P);
  stage.addEventListener('pointermove', (event) => {
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(svgEl.getScreenCTM().inverse());
    // The time on the ruler under the pointer.
    const x = ((point.x - P.origin[0]) / unitK + B.RULER_Y * cosA) / sinA;
    steer(x / B.S);
  });
  stage.addEventListener('keydown', (event) => {
    let to = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') to = B.EVENTS.find((e) => e > goal + 0.01) ?? B.T1;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') to = [...B.EVENTS].reverse().find((e) => e < goal - 0.01) ?? B.T0;
    if (event.key === 'Home') to = B.T0;
    if (event.key === 'End') to = B.T1;
    if (to === null) return;
    event.preventDefault();
    steer(to);
  });
}
`;

// ---------------------------------------------------------------------------
// The page: title and legend on top, the bench, the run results and the
// clock below. It fills the viewport; captions are the video's job.
// ---------------------------------------------------------------------------
const PALETTE = {
  boot: { top: '#F1F1EF', s: ['#CFCFCC', '#D9D9D6', '#E2E2DF', '#EAEAE7'], hi: '#5B5B60', mid: '#8A8A8F', lo: '#ABABAF', faint: '#C8C8CB' },
  setup: { top: '#FFF2D9', s: ['#E9BC6E', '#F0C987', '#F6D7A1', '#FAE4BD'], hi: '#8C5509', mid: '#B97C27', lo: '#DCAE63', faint: '#EACB92' },
  check: { top: '#F1ECFF', s: ['#BFB2EC', '#CCC1F1', '#D9CFF6', '#E5DEFA'], hi: '#5136B2', mid: '#7863D0', lo: '#AA9BE4', faint: '#C8BEEF' },
  build: { top: '#E8F0FF', s: ['#ADC3F1', '#BECFF5', '#CEDBF8', '#DDE6FC'], hi: '#294CAF', mid: '#5275D2', lo: '#8EA6E6', faint: '#B2C4F0' },
  test: { top: '#FFEAF3', s: ['#EBABC8', '#F1BCD4', '#F6CCDF', '#FADBE9'], hi: '#A9276F', mid: '#CC5996', lo: '#E398BE', faint: '#EFB9D4' },
  saved: { top: '#DDF4F4', s: ['#9CD3D3', '#AFDCDC', '#C2E5E5', '#D3EDED'], hi: '#0E6B6E', mid: '#36908F', lo: '#7BBFBF', faint: '#A6D6D6' },
};
const tokens = ({ top, s, hi, mid, lo, faint }) => [`--anatomy-top:${top}`, `--anatomy-paper:${s[3]}`, ...s.map((value, index) => `--anatomy-shade-${index}:${value}`), `--anatomy-hi:${hi}`, `--anatomy-mid:${mid}`, `--anatomy-lo:${lo}`, `--anatomy-faint:${faint}`].join(';');

// Legend chips are kit solids too, in the same colour tokens as the plates.
const CHIP_P = k.fitProjection(k.boxCorners({ x: 0, y: 0, w: 16, d: 10, r: 1 }, 0, 4), 30, 20, { pad: 1.5, azimuth: AZIMUTH, elevation: ELEVATION });
const chip = (kind) => `<svg class="bench-chip k-${kind}" viewBox="0 0 30 20" aria-hidden="true">${k.solidSvg(k.slabOf({ x: 0, y: 0, w: 16, d: 10, r: 1 }, 0, 4, CHIP_P, 2), { tone: 'hi', crease: 'lo' })}</svg>`;
const KEY = [
  ...Object.entries(KINDS).map(([kind, label]) => `<li>${chip(kind)}${label}</li>`),
  `<li><i class="bench-lamp"></i>Lane done</li>`,
  `<li>${chip('saved')}Time saved</li>`,
].join('');

const body = `<div class="bench">
<header class="bench-head"><div class="bench-title"><h1>Serial vs parallel build</h1><p>Fictional step times on one time axis</p></div><ul class="bench-key" aria-label="Key">${KEY}</ul></header>
<div class="iso-stage" tabindex="0" role="slider" aria-label="Build timing bench: arrow keys step through the run" aria-valuemin="${T0}" aria-valuemax="${T1}" aria-valuetext="ready">${svg}</div>
<footer class="bench-foot"><dl class="bench-runs"><div><dt>Parallel run</dt><dd data-run="parallel">running</dd></div><div><dt>Serial run</dt><dd data-run="serial">running</dd></div><div class="is-saved"><dt>Saved</dt><dd data-run="saved">0:00</dd></div></dl><div class="bench-clock"><span data-readout>0:00</span><small>elapsed</small></div></footer>
</div>`;

const CSS = `<style>
html,body{height:100%;overflow:hidden}
body{background:var(--anatomy-card);--anatomy-paper:var(--anatomy-card);--u:min(1vw,1.7778vh)}
.iso-page{width:100%;height:100%;margin:0}
.bench{display:grid;grid-template-rows:auto minmax(0,1fr) auto;width:100%;height:100%;padding:calc(var(--u)*2.4) calc(var(--u)*2.8) calc(var(--u)*2);gap:calc(var(--u)*0.6)}
.bench-head{display:flex;align-items:flex-start;justify-content:space-between;gap:calc(var(--u)*2)}
.bench-title h1{margin:0;font:600 max(18px,calc(var(--u)*1.75))/1.1 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--anatomy-strong);letter-spacing:-.01em}
.bench-title p{margin:calc(var(--u)*0.45) 0 0;font:400 max(13px,calc(var(--u)*1.02))/1.3 var(--anatomy-mono);color:var(--anatomy-muted)}
.bench-key{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:calc(var(--u)*0.55) calc(var(--u)*1.5);max-width:calc(var(--u)*56);margin:calc(var(--u)*0.2) 0 0;padding:0;list-style:none;font:400 max(13px,calc(var(--u)*1.12))/1.2 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--anatomy-text)}
.bench-key li{display:inline-flex;align-items:center;gap:calc(var(--u)*0.55);white-space:nowrap}
.bench-chip{width:max(18px,calc(var(--u)*1.7));height:max(12px,calc(var(--u)*1.13));flex:none;overflow:visible}
.bench-chip .iso-line{stroke-width:1.1px}
.bench-lamp{width:max(9px,calc(var(--u)*0.8));height:max(9px,calc(var(--u)*0.8));border-radius:50%;background:var(--bench-pass);box-shadow:0 0 0 calc(var(--u)*0.2) color-mix(in srgb,var(--bench-pass) 22%,transparent);margin:0 calc(var(--u)*0.45);flex:none}
.iso-stage{position:relative;min-height:0;display:flex;align-items:center;justify-content:center;outline:none;cursor:ew-resize}
.iso-stage:focus-visible{box-shadow:0 0 0 1px var(--anatomy-muted)}
.iso-stage .iso-svg{width:100%;height:100%;max-height:100%}
.bench-foot{display:flex;align-items:flex-end;justify-content:space-between;gap:calc(var(--u)*2)}
.bench-runs{display:flex;gap:calc(var(--u)*2.6);margin:0}
.bench-runs div{display:grid;gap:calc(var(--u)*0.3)}
.bench-runs dt{font:400 max(12px,calc(var(--u)*0.98))/1 var(--anatomy-mono);color:var(--anatomy-muted);letter-spacing:.03em}
.bench-runs dd{margin:0;font:500 max(16px,calc(var(--u)*1.6))/1 var(--anatomy-mono);color:var(--anatomy-strong);font-variant-numeric:tabular-nums}
.bench-runs .is-saved dd{color:var(--bench-saved)}
.bench-clock{display:flex;align-items:baseline;gap:calc(var(--u)*0.6)}
.bench-clock span{font:500 max(24px,calc(var(--u)*2.9))/1 var(--anatomy-mono);color:var(--anatomy-strong);font-variant-numeric:tabular-nums}
.bench-clock small{font:400 max(12px,calc(var(--u)*0.98))/1 var(--anatomy-mono);color:var(--anatomy-muted)}
.iso{--bench-pass:#2E9E62;--bench-run:#E8A33A;--bench-saved:${PALETTE.saved.hi};--burn-core:#3b2412;--burn-halo:#a06c40}
${Object.entries(PALETTE).map(([kind, set]) => `.k-${kind}{${tokens(set)}}`).join('\n')}
.ghost{opacity:.42}
.bench-name text{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;font-weight:650;letter-spacing:.08em}
.bench-num text{font-family:var(--anatomy-mono);font-weight:500;letter-spacing:.02em}
.bench-burn{mix-blend-mode:multiply;pointer-events:none}
.bench-burn circle{stroke:currentColor}
.bench-burn text{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;fill:currentColor}
.bench-burn .halo{color:var(--burn-halo);opacity:.22}
.bench-burn .core{color:var(--burn-core);opacity:.5}
.lamp-lens{fill:var(--anatomy-shade-1);stroke:var(--anatomy-mid);stroke-width:var(--anatomy-weight)}
.lamp-on{fill:var(--bench-pass);stroke:none}
.lamp-glow{fill:var(--bench-pass);stroke:none;filter:blur(2.5px)}
.led-on{fill:var(--bench-run);stroke:none}
.led-glow{fill:var(--bench-run);stroke:none;filter:blur(1.6px)}
[data-part="gantry"],[data-part="tower"],[data-gate]{pointer-events:none}
@media (max-aspect-ratio:4/3){.bench{--u:max(1vw,4px);grid-template-rows:auto auto auto;height:auto;min-height:100%;align-content:center}html,body{overflow:auto}.bench-head{flex-direction:column}.bench-key{justify-content:flex-start;max-width:none}.iso-stage .iso-svg{height:auto}.bench-foot{flex-wrap:wrap}}
@media (max-width:560px){.iso-stage{overflow:hidden}.iso-stage .iso-svg{width:112%;max-width:none;margin-left:-6%}}
</style>`;

const page = k.pageHtml({ title: 'Serial vs parallel build', theme: 'light', body: CSS + body, script: kitScript() + live });
writeFileSync(join(HERE, 'bench.html'), page);
console.log(`wrote bench.html, ${Math.round(page.length / 1024)} KB, viewBox ${WIDTH} x ${HEIGHT}`);

// ---------------------------------------------------------------------------
// app.html: the button a hybrid demo clicks. Its result comes from the model.
// ---------------------------------------------------------------------------
const app = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Build</title>
<style>
*{box-sizing:border-box}
html,body{height:100%;margin:0}
body{display:grid;place-items:center;background:#f6f6f3;color:#1a1a1d;font:16px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{width:min(520px,100% - 32px);padding:32px;border-radius:16px;background:#fff;box-shadow:0 0 0 1px #0000000f,0 12px 32px -12px #00000026}
h1{margin:0 0 4px;font-size:22px;font-weight:600;letter-spacing:-.01em}
p{margin:0;color:#6b6b70}
button{margin-top:24px;padding:12px 20px;border:0;border-radius:10px;background:#1a1a1d;color:#fff;font:inherit;font-weight:500;cursor:pointer}
button:disabled{background:#8a8a8f;cursor:default}
button:focus-visible{outline:2px solid #3e63dd;outline-offset:2px}
#result{min-height:30px;margin-top:20px;font-size:20px;font-weight:600;font-variant-numeric:tabular-nums}
#detail{min-height:24px;font-size:15px}
</style>
</head>
<body>
<main>
<h1>Build</h1>
<p>${LANES.filter((item) => item.run === 'parallel').length} machines in parallel. ${SOURCE}.</p>
<button id="run" type="button">Run build</button>
<div id="result" role="status" aria-live="polite"></div>
<p id="detail"></p>
</main>
<script>
const button = document.getElementById('run');
const result = document.getElementById('result');
const detail = document.getElementById('detail');
button.addEventListener('click', () => {
  button.disabled = true;
  result.textContent = 'Building\u2026';
  detail.textContent = '';
  setTimeout(() => {
    result.textContent = 'Built in ${words(RUNS.parallel)}';
    detail.textContent = '${words(SAVED)} faster than one machine (${words(RUNS.serial)})';
    button.disabled = false;
  }, 900);
});
</script>
</body>
</html>
`;
writeFileSync(join(HERE, 'app.html'), app);
console.log('wrote app.html');
