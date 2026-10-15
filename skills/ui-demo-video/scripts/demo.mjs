#!/usr/bin/env node
// One file in, one finished demo video out.
//
//   node scripts/demo.mjs init <dir> [--url http://localhost:3000] [--name my-demo] [--style <name>]
//   node scripts/demo.mjs init <dir> --figure [--name my-demo]   (an explainer from a figure page)
//   node scripts/demo.mjs <demo.json> [options]
//
// You write demo.json (a video.json plus the takes to record, see
// examples/quick-fix.demo.json). This script does the rest, and only the part
// that changed since last time:
//
//   1 validate   every static problem in the file, all at once, no browser
//   2 chrome     make sure the background Chrome is up (scripts/chrome.sh)
//   3 plan       which takes need recording: clip missing, take changed, --retake
//   4 rehearse   dry-run those takes; a bad selector stops here, in
//                seconds, with the closest candidates, before any slow recording
//   5 record     record them, one at a time (each take's `setup` command first)
//   6 camera     write build/video.json and run auto-camera on it
//   7 check      trims against the real clip lengths, aspects, files
//   8 render     scripts/compose.mjs: the whole video on the GPU, in seconds
//   9 deliver    PR copy, captions, chapters, poster, frozen/black scan
//  10 summary    seconds per stage, what was reused, warnings, what to look at
//
// A take with "source": "figure" is an HTML figure, not a screen: it is
// recorded frame by frame by capture-figure.mjs in a Chrome of its own, so it
// needs no background Chrome, rehearsal or setup, and its fingerprint covers
// the page and the files beside it (edit the figure and it records again).
//
// Next to demo.json it keeps:
//   clips/<take>.mp4 (+ .events.json, .sheet.png) and clips/<take>.take.json,
//   a fingerprint of everything that defines the take;
//   build/video.json (the resolved spec; demo.json is never rewritten),
//   build/steps/<take>.json, build/logs/<stage>.log;
//   out/<name>.mp4, out/<name>-pr.mp4, .vtt, .srt, -chapters.txt, -poster.png,
//   out/<name>-sheet.png (a contact sheet of the finished video: look at it).
// A comparison run (--styles) adds out/styles/<style>.mp4, out/<name>-styles.png
// (one row per style, the same moments in every row) and out/<name>-styles.html
// (a local page to flip between the styles at full size).
//
// Options:
//   --retake <a,b|all>   record these takes again even if nothing changed.
//                        NEEDED after you change the APP: the take fingerprint
//                        covers the spec (url, steps, options), not your code.
//   --takes <a,b>        record only these takes, then stop (for recording
//                        "before" takes on an old branch, then switching).
//   --only <stage>       capture | render | deliver: run just that part
//   --no-deliver         stop after render
//   --style <name>       render in this visual style for this run (the file is not
//                        edited; demo.json can carry "style": "<name>" itself). An
//                        unknown name stops at validate with the valid names
//   --styles <a,b|all>   compare looks on your own demo: capture, camera and check
//                        run once (nothing is recorded twice), then the demo is
//                        rendered once per style, one after another, into
//                        out/styles/<style>.mp4, with a comparison sheet and a picker
//                        page. No delivery (no PR copy per style). Works with
//                        --only render on an existing build. Needs two or more styles
//   --stale-ok           render even if a clip's take changed or its take.json is
//                        missing (normally that stops with the take's name)
//   --no-rehearse        skip the dry run
//   --max-mb 10          size cap for the PR copy
//   --gif <start:dur>    also a GIF excerpt, e.g. 12:6
//   --draft              record figure takes quick, for review rounds: 30 fps,
//                        DPR 1, JPEG quality 80. Their take.json says draft, and
//                        the next run without --draft records them again
//   --workers n          tabs that record one seekable figure take at once
//                        (default half the cores, at most 4; 1 = one tab). A
//                        figure that is not seekable always uses one
//   --port 9222          Chrome's debugging port
//   --parallel 1         takes rehearsed and recorded at once. Recording is
//                        limited by the CPU, so more than 1 only helps on an
//                        idle machine (three at once measured slower than one
//                        after another), and takes that share state a `setup`
//                        resets (one database, one account) must stay at 1
//   --json               print the result as one JSON object (progress on stderr)
//   --force              work in a folder under /tmp (macOS empties those on
//                        restart; a whole day of recordings was lost that way)
//
// Testing only: UI_DEMO_COMPOSE=<script> runs that renderer instead of
// compose.mjs (it must take the same flags).
//
// Exit codes: 0 done, 1 a stage failed (its name is printed), 2 usage, 3 the
// page needs a sign-in (run scripts/chrome.sh --login <url>).
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDemo, checkSpec } from './check-video.mjs';
import { chooseMoments, makeSheet, pickerHtml } from './style-picker.mjs';
import { resolveStyle } from './compositor/styles/index.js';
import { CAPTURE_OPTIONS, SAFE_NAME, captureArgs, clipPath, fillTiming, resolveSpec, styleName, takeHash, takeSpec, takesUsed } from './spec-lib.mjs';

const T0 = Date.now();
const HERE = dirname(fileURLToPath(import.meta.url));
const secs = (t0 = T0) => +((Date.now() - t0) / 1000).toFixed(1);

// ---------------------------------------------------------------- arguments

const VALUE = new Set(['retake', 'takes', 'only', 'max-mb', 'gif', 'port', 'parallel', 'workers', 'url', 'name', 'style', 'styles']);
const argv = process.argv.slice(2);
const pos = [];
const opt = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) pos.push(a);
  else {
    const k = a.slice(2);
    if (VALUE.has(k)) opt[k] = argv[++i];
    else opt[k] = true;
  }
}
const USAGE = `usage:
  demo.mjs init <dir> [--url <base>] [--name <name>] [--style <name>] [--force]
  demo.mjs init <dir> --figure [--name <name>] [--style <name>] [--force]
  demo.mjs <demo.json> [--retake a,b|all] [--takes a,b] [--only capture|render|deliver]
                       [--style <name> | --styles a,b,c|all]
                       [--no-deliver] [--no-rehearse] [--max-mb 10] [--gif start:dur]
                       [--draft] [--workers n] [--port 9222] [--parallel 1] [--json] [--force]
Read the top of this file for the stages and the folder layout. After you change
the APP (not demo.json) use --retake: the fingerprint cannot see your code.`;
if (opt.help || opt.h || !pos.length) {
  console.log(USAGE);
  process.exit(opt.help || opt.h ? 0 : 2);
}
for (const k of ['style', 'styles']) {
  if (k in opt && (!opt[k] || opt[k] === true || String(opt[k]).startsWith('--'))) {
    console.error(`--${k} needs a value${k === 'styles' ? ' (a comma list of style names, or all)' : ' (a style name)'}`);
    process.exit(2);
  }
}
if (opt.style && opt.styles) {
  console.error('--style renders one look, --styles compares several: use one of them');
  process.exit(2);
}
// Tabs per seekable figure take: half the cores, at most 4.
const WORKERS = opt.workers === undefined ? Math.min(4, Math.max(1, Math.floor(availableParallelism() / 2))) : +opt.workers;
if (!(Number.isInteger(WORKERS) && WORKERS >= 1)) {
  console.error(`--workers must be a whole number of tabs, 1 or more (got ${opt.workers}); 1 records every figure take in one tab`);
  process.exit(2);
}
const JSON_OUT = !!opt.json;
const say = (...a) => (JSON_OUT ? console.error : console.log)(...a);

// ---------------------------------------------------------------- folders

// macOS empties /tmp and the per-user temp folders on restart, and agent
// scratchpads live there. Clips can't be re-rendered, only re-recorded.
const isTemp = (dir) => {
  let real = dir;
  try { real = realpathSync(dir); } catch {}
  return /^\/(private\/)?tmp(\/|$)|^\/(private\/)?var\/folders\/|\/scratchpad(\/|$)/.test(real) || /^\/(private\/)?tmp(\/|$)/.test(dir);
};
const refuseTemp = (dir) => {
  if (isTemp(dir) && !opt.force) {
    console.error(`${dir} is in a temporary folder that macOS empties on restart, and recordings there get lost.
Work somewhere that lasts, e.g. ~/Downloads/<name>-demo/ (or pass --force for a throwaway run).`);
    process.exit(2);
  }
};

// ---------------------------------------------------------------- styles

// The renderer names its visual styles (compose.mjs --list-styles --json). A
// renderer that predates them answers with a usage error: then there is one
// style, `studio`, and no --style flag is passed.
const COMPOSE = process.env.UI_DEMO_COMPOSE ? resolve(process.env.UI_DEMO_COMPOSE) : join(HERE, 'compose.mjs');
const listStyles = () => {
  const r = spawnSync(process.execPath, [COMPOSE, '--list-styles', '--json'], { encoding: 'utf8', timeout: 30000 });
  const parse = (t) => { try { return JSON.parse(t); } catch { return undefined; } };
  const text = (r.stdout ?? '').trim();
  const v = r.status === 0 ? (parse(text) ?? parse(text.split('\n').reverse().find((l) => l.startsWith('[')) ?? '')) : undefined;
  if (Array.isArray(v) && v.length && v.every((x) => x && typeof x.name === 'string' && SAFE_NAME.test(x.name))) {
    return { legacy: false, styles: v.map((x) => ({ name: x.name, description: x.description ?? '', suits: x.suits ?? '' })) };
  }
  return { legacy: true, styles: [{ name: 'studio', description: '', suits: '' }] };
};
const unknownStyle = (n, known) => `style "${n}" is not one of this renderer's styles (valid: ${known.styles.map((x) => x.name).join(', ')})${known.legacy ? '; this renderer has no named styles yet' : ''}`;
// Only a renderer that lists its styles takes --style; the old one has one look.
const styleFlag = (n) => (known && !known.legacy && n ? ['--style', n] : []);
const styleOf = (d) => styleName(d);

// ---------------------------------------------------------------- init

if (pos[0] === 'init') {
  const dir = resolve(pos[1] ?? '.');
  refuseTemp(dir);
  const name = opt.name ?? (basename(dir).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+/, '') || 'demo');
  const file = join(dir, 'demo.json');
  const figDir = join(dir, 'figure');
  const files = opt.figure ? [file, join(figDir, 'index.html'), join(figDir, 'figure-hook.js')] : [file];
  const there = files.filter((f) => existsSync(f));
  if (there.length && !opt.force) {
    console.error(`${there.join(', ')} already exist${there.length === 1 ? 's' : ''} (--force overwrites)`);
    process.exit(2);
  }
  if (opt.style) {
    const known = listStyles();
    if (!known.styles.some((x) => x.name === opt.style)) {
      console.error(unknownStyle(opt.style, known));
      process.exit(2);
    }
  }
  // An explainer: a stand-in figure page (a bar over figure time 0 to 10, a
  // marker on a spring, two marks), recorded frame by frame, with captions
  // timed to its marks.
  const figureStarter = {
    _note: 'A starter explainer. figure/index.html is a stand-in figure: replace it with your own (an anatomy build that calls figureHook(), see references/figure.md) and keep "page" pointing at it. Captions time themselves to the figure\'s marks with "atMark". Editing anything in figure/ records the take again on the next run.',
    name,
    style: opt.style ?? 'studio',
    takes: {
      figure: {
        source: 'figure',
        page: 'figure/index.html',
        _timeline: 'Video seconds to figure time: the bar fills from 0 to 10 over 4 s, easing out, then holds for 2 s while the marker settles.',
        timeline: [[0, 0], [4, 10], [6, 10]],
      },
    },
    scenes: [
      {
        type: 'clip', take: 'figure', durationSec: 6,
        captions: [
          { atMark: 'halfway', text: 'Halfway: five of ten' },
          { atMark: 'done', text: 'Full, and the marker settles' },
        ],
      },
      { type: 'list', title: 'Your figure, frame by frame', items: ['Swap in your own figure', 'Time captions to its marks'], durationSec: 4 },
    ],
  };
  const starter = opt.figure ? figureStarter : {
    name,
    ...(opt.style ? { style: opt.style } : {}),
    url: opt.url ?? 'http://localhost:3000',
    capture: { hideFloating: true },
    takes: {
      before: {
        url: '/',
        duration: 8,
        steps: [
          { wait: 1 },
          { click: { text: 'Export' }, dur: 0.8 },
          { wait: 1.5 },
          { move: { x: 900, y: 600 }, dur: 0.8 },
        ],
      },
      after: {
        url: '/',
        duration: 8,
        steps: [
          { wait: 1 },
          { click: { text: 'Export' }, dur: 0.8 },
          { mark: 'confirmation', target: { selector: '[role=dialog]' } },
          { wait: 1.5 },
          { move: { x: 900, y: 600 }, dur: 0.8 },
        ],
      },
    },
    transition: 'zoom-blur',
    transitions: ['focus-pull', null, 'push-through', null],
    scenes: [
      { type: 'title', text: 'Clearer exports', subtitle: 'ABC-123', durationSec: 3.4 },
      {
        type: 'issue', source: 'Linear', id: 'ABC-123', status: 'Fixed',
        title: 'Exporting gives no confirmation',
        quote: 'I click Export and nothing tells me it started.',
        reporter: 'Reported by Sam', durationSec: 7,
      },
      { type: 'clip', take: 'before', tag: 'Before', durationSec: 6, autoCamera: true, caption: 'Export gave no sign it had started' },
      {
        type: 'clip', take: 'after', tag: 'After', durationSec: 7, autoCamera: true,
        caption: 'A confirmation says what happens next',
        callouts: [{ mark: 'confirmation', label: 'New confirmation' }],
      },
      { type: 'list', title: 'Shipped in PR #123', items: ['Export confirmation', 'Clear next steps'], durationSec: 5 },
    ],
  };
  mkdirSync(dir, { recursive: true });
  if (opt.figure) {
    // The page carries its own copy of figure-hook.js, so it opens straight
    // from disk (a browser blocks module imports from file://).
    const hook = readFileSync(join(HERE, 'figure-hook.js'), 'utf8');
    const page = readFileSync(join(HERE, 'figure-starter.html'), 'utf8');
    const IMPORT = "import { figureHook, monotone, recording } from './figure-hook.js';";
    if (!page.includes(IMPORT)) throw new Error('figure-starter.html no longer imports figure-hook.js the way init expects');
    mkdirSync(figDir, { recursive: true });
    writeFileSync(join(figDir, 'figure-hook.js'), hook);
    writeFileSync(join(figDir, 'index.html'), page.replace(IMPORT, `// figure-hook.js, inlined (figure-hook.js next to this page is the same code).\n${hook.replace(/^export /gm, '').trim()}`));
  }
  writeFileSync(file, `${JSON.stringify(starter, null, 2)}\n`);
  const r = checkDemo(starter, { dir });
  console.log(`wrote ${file}${opt.figure ? ` and ${figDir}/` : ''}  (${r.errors.length} errors, ${r.warnings.length} warnings)`);
  for (const m of [...r.errors, ...r.warnings]) console.log(`  ${m}`);
  if (opt.figure) console.log(`Open ${join(figDir, 'index.html')} in a browser to see the figure play. Replace it with your own figure, then: node ${process.argv[1]} ${file}`);
  else console.log(`Edit the urls, steps and captions, then: node ${process.argv[1]} ${file}`);
  process.exit(r.errors.length ? 1 : 0);
}

// ---------------------------------------------------------------- run state

const demoFile = resolve(pos[0]);
const dir = dirname(demoFile);
const port = +(opt.port ?? 9222);
const parallel = Math.max(1, +(opt.parallel ?? 1));
const maxMb = +(opt['max-mb'] ?? 10);
const stages = []; // { name, sec, note }
const warnings = [];
const children = new Set();
// Every child runs in its own process group, so stopping it stops what it
// started too (a setup like `sleep 5; echo done` is a shell plus a child).
const killGroup = (p, sig = 'SIGTERM') => {
  try { process.kill(-p.pid, sig); } catch { try { p.kill(sig); } catch {} }
};
const killAll = () => { for (const c of children) killGroup(c); };
let current = 'start';

const warn = (m) => { if (!warnings.includes(m)) warnings.push(m); };
const paths = {
  clips: join(dir, 'clips'), build: join(dir, 'build'), logs: join(dir, 'build', 'logs'),
  steps: join(dir, 'build', 'steps'), out: join(dir, 'out'),
};

// A stage failure ends the run: say which stage, what happened, and (with
// --json) the same as data. `code` lets a sign-in page exit 3.
const summary = { ok: false, demo: demoFile, stages, warnings, reused: [], recorded: [], outputs: {}, look: [], style: null };
const fail = (stage, lines, code = 1) => {
  const msg = [].concat(lines).join('\n');
  summary.error = { stage, message: msg };
  summary.totalSec = secs();
  if (JSON_OUT) console.log(JSON.stringify(summary));
  else {
    for (const s of stages) console.error(`  ${s.name.padEnd(9)} ${String(s.sec).padStart(6)}s  ${s.note ?? ''}`);
    console.error(`FAILED at ${stage}: ${msg}`);
    if (warnings.length) console.error(`warnings (${warnings.length}):\n${warnings.map((w) => `  - ${w}`).join('\n')}`);
    if (summary.browser) console.error(summary.browser.note);
    console.error(`(${summary.totalSec}s${existsSync(paths.logs) ? `; logs in ${paths.logs}` : ''})`);
  }
  killAll();
  process.exit(code);
};
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { killAll(); process.exit(130); });
process.on('exit', killAll);

const stage = async (name, fn) => {
  current = name;
  const t = Date.now();
  say(`> ${name}`);
  let note;
  try {
    note = await fn();
  } catch (e) {
    // Anything unexpected is still a clean failure that names the stage.
    return fail(name, `unexpected error: ${e?.stack?.split('\n').slice(0, 3).join(' | ') ?? e}`);
  }
  const s = { name, sec: secs(t), note: note ?? '' };
  stages.push(s);
  say(`  ${name} ${s.sec}s${s.note ? `: ${s.note}` : ''}`);
  return note;
};

// Run a child with stdout and stderr both going to build/logs/<log>.log. The
// exit code is the child's own: nothing sits between it and us.
const run = (log, cmd, args, { env = {}, cwd = dir, timeoutSec = 0 } = {}) =>
  new Promise((done) => {
    mkdirSync(paths.logs, { recursive: true });
    const file = join(paths.logs, `${log}.log`);
    writeFileSync(file, `$ ${cmd} ${args.join(' ')}\n`);
    const fd2 = openSync(file, 'a');
    const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', fd2, fd2], detached: true });
    closeSync(fd2);
    children.add(p);
    let timedOut = false;
    const timer = timeoutSec ? setTimeout(() => {
      timedOut = true;
      killGroup(p);
      setTimeout(() => killGroup(p, 'SIGKILL'), 5000).unref(); // if it ignores SIGTERM
    }, timeoutSec * 1000) : null;
    p.on('error', (e) => { children.delete(p); done({ code: 127, file, text: `could not start ${cmd}: ${e.message}`, timedOut }); });
    p.on('close', (code, signal) => {
      clearTimeout(timer);
      children.delete(p);
      const text = readFileSync(file, 'utf8');
      done({ code: code ?? (signal ? 128 : 1), file, text, timedOut });
    });
  });
const tail = (text, n = 12) => text.trim().split('\n').slice(-n).join('\n');
const lastJson = (text) => {
  const line = text.trim().split('\n').reverse().find((l) => l.startsWith('{') && l.endsWith('}'));
  try { return line ? JSON.parse(line) : null; } catch { return null; }
};
// At most n workers at a time; with stopOnFail no new item starts after a failure.
const pool = async (items, n, worker, stopOnFail = false) => {
  const results = new Map();
  let next = 0;
  let stop = false;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (!stop && next < items.length) {
      const item = items[next++];
      const r = await worker(item);
      results.set(item, r);
      if (!r.ok && stopOnFail) stop = true;
    }
  }));
  return results;
};

// ---------------------------------------------------------------- 1 validate

refuseTemp(dir);
let demo;
const list = (v) => (v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : []);
const only = opt.only === true ? undefined : opt.only;
if (only && !['capture', 'render', 'deliver'].includes(only)) {
  console.error(`--only must be capture, render or deliver (got "${only}")`);
  process.exit(2);
}
if (only && only !== 'capture' && opt.takes) {
  console.error(`--takes chooses which takes to record, so it goes with --only capture (or alone), not --only ${only}`);
  process.exit(2);
}
const justCapture = only === 'capture' || (!only && !!opt.takes);
const compare = !!opt.styles;
if (compare && (justCapture || only === 'deliver')) {
  console.error('--styles renders the demo once per style, so it cannot go with --only capture, --only deliver or --takes');
  process.exit(2);
}
const styleNames = [...new Set(list(opt.styles))];
if (compare && styleNames.length < 2 && !styleNames.includes('all')) {
  console.error(`--styles compares two or more styles (got ${styleNames.length}); name them like --styles studio,ink or use --styles all. For one style use --style <name>`);
  process.exit(2);
}
const doCapture = !only || only === 'capture';
const doRender = !justCapture && (!only || only === 'render');
const doDeliver = !justCapture && !opt['no-deliver'] && (!only || only === 'deliver');
let name;
let used;
let takes;
let known; // { legacy, styles } once --style or --styles asked about styles

await stage('validate', () => {
  let raw;
  try {
    raw = readFileSync(demoFile, 'utf8');
  } catch (e) {
    return fail('validate', `cannot read ${demoFile}: ${e.message}`, 2);
  }
  try {
    demo = JSON.parse(raw);
  } catch (e) {
    return fail('validate', `${demoFile} is not valid JSON: ${e.message}`);
  }
  const r = checkDemo(demo, { dir });
  const extra = [];
  used = takesUsed(demo);
  const defined = Object.keys(demo?.takes && typeof demo.takes === 'object' ? demo.takes : {});
  for (const flagName of ['retake', 'takes']) {
    for (const n of list(opt[flagName])) if (n !== 'all' && !defined.includes(n)) extra.push(`--${flagName} "${n}" is not a take in demo.json (takes: ${defined.join(', ') || 'none'})`);
  }
  for (const w of r.warnings) warn(w);
  if (opt.style || compare) {
    known = listStyles();
    if (compare) {
      if (styleNames.includes('all')) styleNames.splice(0, styleNames.length, ...known.styles.map((x) => x.name));
      if (styleNames.length < 2) {
        return fail('validate', `--styles needs two or more styles to compare, and this renderer has ${known.styles.length} (${known.styles.map((x) => x.name).join(', ')})`, 2);
      }
    }
    for (const n of compare ? styleNames : [opt.style]) if (!known.styles.some((x) => x.name === n)) extra.push(unknownStyle(n, known));
  }
  if (r.errors.length || extra.length) {
    return fail('validate', [`${r.errors.length + extra.length} problem${r.errors.length + extra.length === 1 ? '' : 's'} in ${basename(demoFile)}:`,
      ...[...r.errors, ...extra].map((e) => `  - ${e}`)]);
  }
  name = demo.name || basename(demoFile).replace(/\.?demo\.json$|\.json$/, '');
  if (!SAFE_NAME.test(name)) name = basename(dir).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+/, '') || 'demo';
  takes = Object.fromEntries(used.map((n) => [n, takeSpec(demo, n, { dir, file: demoFile })]));
  // --draft: figure takes record quick (30 fps, DPR 1, JPEG 80). It is part of
  // their fingerprint, so a run without it records them again in full.
  if (opt.draft) for (const t of Object.values(takes)) if (t.source === 'figure') t.draft = true;
  for (const d of Object.values(paths)) mkdirSync(d, { recursive: true });
  summary.name = name;
  // The style this run renders in: the flag, else what demo.json says, else
  // the renderer's default. A comparison run has no single style.
  summary.style = compare ? null : (opt.style ?? styleOf(demo) ?? 'studio');
  return `${demo.scenes.length} scenes, ${r.totalSec.toFixed(1)}s, ${used.length} take${used.length === 1 ? '' : 's'}, ${r.warnings.length} warning${r.warnings.length === 1 ? '' : 's'}`;
});

// ---------------------------------------------------------------- 2-5 capture

const clipFile = (n) => join(dir, clipPath(n));
const takeFile = (n) => join(paths.clips, `${n}.take.json`);
const readTake = (n) => { try { return JSON.parse(readFileSync(takeFile(n), 'utf8')); } catch { return null; } };
const stepsFile = (n) => join(paths.steps, `${n}.json`);
const allTake = list(opt.retake).includes('all');
const retake = new Set(allTake ? used : list(opt.retake));
let toRecord = [];

if (doCapture) {
  const limit = list(opt.takes);
  const wanted = used.filter((n) => !limit.length || limit.includes(n));

  await stage('plan', () => {
    const why = {};
    for (const n of wanted) {
      const prev = readTake(n);
      const have = existsSync(clipFile(n)) && existsSync(`${clipFile(n)}.events.json`) && statSync(clipFile(n)).size > 0;
      if (retake.has(n)) why[n] = 'retake';
      else if (!have) why[n] = 'no clip yet';
      else if (!prev) why[n] = 'no take.json (not recorded by this tool)';
      else if (prev.hash !== takeHash(takes[n])) {
        const draftOnly = takes[n].source === 'figure' && !!prev.draft !== !!takes[n].draft;
        why[n] = draftOnly ? (takes[n].draft ? 'draft' : 'full quality after a draft') : 'take changed';
      }
      else summary.reused.push(n);
    }
    toRecord = Object.keys(why);
    summary.plan = why;
    return [toRecord.length ? `record ${toRecord.map((n) => `${n} (${why[n]})`).join(', ')}` : 'record nothing',
      summary.reused.length ? `reuse ${summary.reused.join(', ')}` : ''].filter(Boolean).join('; ');
  });

  // Figure takes run a Chrome of their own; only screen takes need chrome.sh's.
  const isFigure = (n) => takes[n].source === 'figure';
  const screenTakes = toRecord.filter((n) => !isFigure(n));
  if (toRecord.length) {
    if (!screenTakes.length) stages.push({ name: 'chrome', sec: 0, note: 'not needed (figure takes run their own)' });
    else await stage('chrome', async () => {
      // Always through chrome.sh: it starts the background Chrome when none is
      // up, and when a --login window is open it takes the session back into
      // the background one. Recording in the login window would work, but the
      // point is that nothing shows on screen.
      const r = await run('chrome', join(HERE, 'chrome.sh'), [], { env: { PORT: String(port) }, timeoutSec: 90 });
      if (r.code !== 0) return fail('chrome', [`chrome.sh exited ${r.code}`, tail(r.text)]);
      summary.browser = {
        port, running: true,
        note: `the background browser is still running on port ${port}; stop it with ${port === 9222 ? '' : `PORT=${port} `}${join(HERE, 'chrome.sh')} --stop`,
      };
      return tail(r.text, 1).replace(/^Chrome /, '').replace(/ \(profile: .*$/, ')');
    });

    for (const n of screenTakes) writeFileSync(stepsFile(n), `${JSON.stringify(takes[n].steps, null, 1)}\n`);

    // The take's `setup` command (reset the data, seed the user) runs in the
    // demo folder right before the page loads.
    const runSetup = async (n, log) => {
      if (!takes[n].setup) return { ok: true };
      const r = await run(`${log}-setup`, 'sh', ['-c', takes[n].setup], { timeoutSec: 300 });
      return r.code === 0 ? { ok: true } : { ok: false, code: r.code, text: `setup failed (exit ${r.code}): ${tail(r.text, 6)}` };
    };
    const reportFailures = (st, failed) => {
      const lines = [];
      let code = 1;
      for (const [n, r] of failed) {
        if (r.code === 3 || /chrome\.sh --login/.test(r.text ?? '')) code = 3;
        lines.push(`take "${n}": ${r.text}`);
      }
      return fail(st, [`${failed.length} of ${toRecord.length} take${toRecord.length === 1 ? '' : 's'} failed:`, ...lines], code);
    };

    // A rehearsal really clicks. A take that changes data needs a `setup` that
    // resets it, or `"rehearse": false` so the recording is the first run.
    const rehearsable = (n) => !isFigure(n) && takes[n].steps.length && takes[n].rehearse !== false;
    if (!opt['no-rehearse'] && toRecord.some(rehearsable)) {
      await stage('rehearse', async () => {
        const todo = toRecord.filter(rehearsable);
        const res = await pool(todo, parallel, async (n) => {
          const s = await runSetup(n, `rehearse-${n}`);
          if (!s.ok) return s;
          const miss = join(paths.build, 'miss', n);
          mkdirSync(miss, { recursive: true });
          const r = await run(`rehearse-${n}`, process.execPath,
            [join(HERE, 'capture.mjs'), ...captureArgs(takes[n], { rehearse: true, port, stepsFile: stepsFile(n), allowTemp: !!opt.force })],
            { timeoutSec: 120, cwd: miss }); // a miss screenshot lands in build/miss/<take>/
          // The log holds the step, the target, the closest candidates and a
          // screenshot path; show it whole (it is short).
          const body = r.text.split('\n').slice(1).join('\n').trim().split('\n').slice(-40).join('\n');
          return { ok: r.code === 0, code: r.code, text: r.timedOut ? 'rehearsal timed out' : body };
        });
        const failed = [...res].filter(([, r]) => !r.ok);
        if (failed.length) return reportFailures('rehearse', failed);
        return `${todo.length} take${todo.length === 1 ? '' : 's'} rehearsed, every target found`;
      });
    }

    // A figure take: capture-figure.mjs steps the page frame by frame in a
    // Chrome of its own. No setup, no sign-in, no slow-down to pick. A frame
    // costs about 85 ms at dpr 1.5 (more pixels, more time), so the time
    // limit follows the frame count, with room for a busy machine.
    const recordFigure = async (n) => {
      const t = takes[n];
      const fps = +(t.options.fps ?? 60), frames = Math.round(t.duration * fps);
      const timeoutSec = Math.max(300, Math.ceil(frames * 0.085 * (t.dpr / 1.5) ** 2 * 4 + 120));
      const r = await run(`record-${n}`, process.execPath,
        [join(HERE, 'capture-figure.mjs'), ...captureArgs(t, { out: clipFile(n), allowTemp: !!opt.force, workers: WORKERS }), '--json'], { timeoutSec });
      const j = lastJson(r.text);
      if (r.code !== 0 || !j?.ok) {
        const why = r.timedOut ? `timed out after ${timeoutSec} s (killed by the runner; the machine may be overloaded, see build/logs)` : (j?.error ?? tail(r.text, 8));
        return { ok: false, code: r.code, text: why };
      }
      writeFileSync(takeFile(n), `${JSON.stringify({
        hash: takeHash(t), source: 'figure', page: relative(dir, t.page), duration: t.duration, recordedAt: new Date().toISOString(),
        width: j.width, height: j.height, durationSec: j.durationSec, fps: j.fps, frames: j.frames, msPerFrame: j.msPerFrame,
        wallSec: j.wallSec, mode: j.mode, workers: j.workers ?? 1, draft: !!j.draft,
      }, null, 1)}\n`);
      for (const w of j.warnings ?? []) warn(`take ${n}: ${w}`);
      return { ok: true, j };
    };

    await stage('record', async () => {
      let slots = Math.min(parallel, toRecord.length);
      const res = await pool(toRecord, parallel, async (n) => {
        rmSync(takeFile(n), { force: true }); // a failed take must never look reusable
        if (isFigure(n)) return recordFigure(n);
        const s = await runSetup(n, `record-${n}`);
        if (!s.ok) return s;
        const t = takes[n];
        const record = (extra = []) => run(`record-${n}`, process.execPath,
          [join(HERE, 'capture.mjs'), ...captureArgs(t, { port, stepsFile: stepsFile(n), out: clipFile(n), allowTemp: !!opt.force }), '--json', ...extra],
          { timeoutSec: Math.max(300, t.duration * 25 + 120) });
        // capture.mjs re-records a choppy take by itself, slower, from a fresh
        // page. It cannot re-run a `setup` command, so for a take that has one
        // the second pass happens here, after the setup has run again.
        let r = await record(t.setup ? ['--no-retry'] : []);
        let j = lastJson(r.text);
        if (t.setup && r.code === 0 && j?.ok && j.suggestedSlow && (t.options?.slow ?? 'auto') === 'auto') {
          say(`  take ${n} came out choppy; recording it again at slow ${j.suggestedSlow}`);
          const again = await runSetup(n, `record-${n}`);
          if (!again.ok) return again;
          r = await record(['--no-retry', '--slow', String(j.suggestedSlow)]);
          j = lastJson(r.text);
        }
        if (r.code !== 0 || !j?.ok) {
          const why = r.timedOut ? 'timed out (killed by the runner; the machine may be overloaded, see build/logs)' : (j?.error ?? tail(r.text, 8));
          return { ok: false, code: r.code, text: why };
        }
        writeFileSync(takeFile(n), `${JSON.stringify({
          hash: takeHash(t), url: t.url, duration: t.duration, recordedAt: new Date().toISOString(),
          width: j.width, height: j.height, durationSec: j.durationSec, distinctFps: j.distinctFps, slow: j.slow, wallSec: j.wallSec,
        }, null, 1)}\n`);
        for (const w of j.warnings ?? []) warn(`take ${n}: ${w}`);
        return { ok: true, j };
      }, true);
      const failed = [...res].filter(([, r]) => !r.ok);
      if (failed.length) return reportFailures('record', failed);
      summary.recorded = toRecord;
      slots = Math.min(slots, toRecord.length);
      const fig = (j) => ` (${j.frames} frames, ${j.msPerFrame} ms a frame, ${j.workers ?? 1} tab${(j.workers ?? 1) === 1 ? '' : 's'}${j.draft ? ', draft' : ''})`;
      const each = (n) => `${n} ${res.get(n).j.wallSec}s${isFigure(n) ? fig(res.get(n).j) : ''}`;
      return `${toRecord.map(each).join(', ')} (${slots} at a time)`;
    });
  } else {
    stages.push({ name: 'chrome', sec: 0, note: 'not needed' });
  }
}

if (justCapture) await finish();

// ---------------------------------------------------------------- 6-7 camera, check

let specPath = join(paths.build, 'video.json');
let allAspects = {};
if (doRender) {
  await stage('camera', async () => {
    // A clip is only trusted if the take that made it is still the take
    // demo.json describes: a failed re-record removes take.json and leaves the
    // old clip behind, and a changed step leaves a clip of the old steps.
    if (!opt['stale-ok']) {
      const stale = used.flatMap((n) => {
        const t = readTake(n);
        if (!t) return [`take "${n}": no take.json next to its clip (the last recording failed, or the clip was not recorded by this tool)`];
        if (t.hash !== takeHash(takes[n])) {
          if (t.source === 'figure' && !!t.draft !== !!takes[n].draft)
            return [`take "${n}": recorded ${t.draft ? 'as a draft; add --draft to render it' : 'in full; leave out --draft to render it'}`];
          return [`take "${n}": demo.json changed since it was recorded`];
        }
        return [];
      });
      if (stale.length) return fail('camera', [...stale, `Record ${stale.length === 1 ? 'it' : 'them'} (demo.mjs ${basename(demoFile)} --takes ${used.filter((n) => stale.some((m) => m.startsWith(`take "${n}"`))).join(',')}), or render the old clips anyway with --stale-ok`]);
    }
    const aspects = {};
    for (const n of used) {
      let w; let h;
      const t = readTake(n);
      if (t?.width) ({ width: w, height: h } = t);
      else {
        try { ({ width: w, height: h } = JSON.parse(readFileSync(`${clipFile(n)}.events.json`, 'utf8'))); } catch {}
      }
      if (w && h) aspects[n] = +(w / h).toFixed(3);
      else if (!existsSync(clipFile(n))) return fail('camera', `take "${n}" has no clip at ${clipFile(n)} (record it first: run without --only)`);
    }
    allAspects = aspects;
    // --style replaces demo.json's style in the resolved spec (the file itself is
    // never edited). The spec holds only what the author wrote for theme and
    // transitions when the style is not studio; the style supplies the rest.
    const spec = resolveSpec(demo, aspects, { style: opt.style });
    writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`);
    const r = await run('auto-camera', process.execPath, [join(HERE, 'auto-camera.mjs'), specPath, '--public', dir]);
    if (r.code !== 0) return fail('camera', [`auto-camera exited ${r.code}`, tail(r.text)]);
    const n = JSON.parse(readFileSync(specPath, 'utf8')).scenes.filter((s) => s.movesFrom === 'auto-camera').length;
    return `${n} scene${n === 1 ? '' : 's'} with generated camera moves`;
  });

  await stage('check', () => {
    const spec = JSON.parse(readFileSync(specPath, 'utf8'));
    const r = checkSpec(spec, { pub: dir, files: true });
    for (const w of r.warnings) warn(w);
    if (r.errors.length) return fail('check', [`${r.errors.length} problem${r.errors.length === 1 ? '' : 's'} against the real files:`, ...r.errors.map((e) => `  - ${e}`)]);
    summary.totalVideoSec = +r.totalSec.toFixed(1);
    return `${r.totalSec.toFixed(1)}s of video, ${r.warnings.length} warning${r.warnings.length === 1 ? '' : 's'}`;
  });

  // ---------------------------------------------------------------- 8 render
  const master = join(paths.out, `${name}.mp4`);
  const sheet = join(paths.out, `${name}-sheet.png`);
  if (compare) await compareStyles();
  else await stage('render', async () => {
    const r = await run('render', process.execPath, [COMPOSE, specPath, '--out', master, '--clips', dir, '--sheet', sheet, ...styleFlag(opt.style), '--json'], { timeoutSec: 1800 });
    const j = lastJson(r.text);
    if (r.code !== 0 || j?.ok === false) return fail('render', [`compose.mjs exited ${r.code}${j?.error ? `: ${j.error}` : ''}`, tail(r.text)]);
    for (const w of j?.warnings ?? []) warn(`render: ${w}`);
    const note = j ? `${j.frames} frames in ${j.wallSec}s (${j.renderFps} fps)` : 'done';
    if (!existsSync(master)) return fail('render', `the renderer reported success but ${master} does not exist`);
    // The contact sheet of the finished video, if the renderer did not make one.
    if (!existsSync(sheet) || statSync(sheet).mtimeMs < Date.now() - 60000) {
      const dur = +(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', master], { encoding: 'utf8' }).stdout || 0);
      const step = Math.max(2, dur / 24);
      const rows = Math.max(1, Math.ceil(dur / step / 5));
      const r = await run('sheet', 'ffmpeg', ['-v', 'error', '-y', '-i', master, '-vf', `fps=1/${step.toFixed(2)},scale=480:-1,tile=5x${rows}`, '-frames:v', '1', '-update', '1', sheet]);
      if (r.code !== 0) warn(`could not make ${sheet}: ${tail(r.text, 2)}`);
    }
    summary.outputs.master = master;
    summary.outputs.sheet = sheet;
    return note;
  });

  // ---------------------------------------------------------------- 9 deliver
  if (doDeliver && !compare) await deliver(master);
  else if (compare) stages.push({ name: 'deliver', sec: 0, note: 'skipped for a comparison run (no PR copy per style)' });
}
if (only === 'deliver') {
  const master = join(paths.out, `${name}.mp4`);
  specPath = join(paths.build, 'video.json');
  if (!existsSync(master) || !existsSync(specPath)) fail('deliver', `nothing to deliver yet: needs ${master} and ${specPath} (run without --only first)`);
  await deliver(master);
}

// Render the demo once per style into out/styles/<style>.mp4, one after the
// other (the encoder is the limit, so parallel renders would not be faster),
// then the comparison sheet and the picker page.
async function compareStyles() {
  const stylesDir = join(paths.out, 'styles');
  mkdirSync(stylesDir, { recursive: true });
  const done = [];
  const specs = {};
  await stage('render', async () => {
    for (const n of styleNames) {
      const t = Date.now();
      const file = join(stylesDir, `${n}.mp4`);
      rmSync(file, { force: true });
      // Each style renders its own resolved spec: the timeline (transition lengths) and camera follow that style.
      const sp = join(paths.build, 'styles', `${n}.video.json`);
      mkdirSync(dirname(sp), { recursive: true });
      writeFileSync(sp, `${JSON.stringify(resolveSpec(demo, allAspects, { style: n }), null, 2)}\n`);
      const cam = await run(`camera-${n}`, process.execPath, [join(HERE, 'auto-camera.mjs'), sp, '--public', dir]);
      if (cam.code !== 0) return fail('render', [`style "${n}": auto-camera exited ${cam.code}`, tail(cam.text)]);
      specs[n] = JSON.parse(readFileSync(sp, 'utf8'));
      const r = await run(`render-${n}`, process.execPath, [COMPOSE, sp, '--out', file, '--clips', dir, ...styleFlag(n), '--json'], { timeoutSec: 1800 });
      const j = lastJson(r.text);
      if (r.code !== 0 || j?.ok === false) return fail('render', [`style "${n}": compose.mjs exited ${r.code}${j?.error ? `: ${j.error}` : ''}`, tail(r.text)]);
      if (!existsSync(file)) return fail('render', `style "${n}": the renderer reported success but ${file} does not exist`);
      for (const w of j?.warnings ?? []) warn(`render (${n}): ${w}`);
      const sec = secs(t);
      say(`  ${n.padEnd(12)} ${String(sec).padStart(6)}s`);
      done.push({ name: n, file, sec });
    }
    summary.styles = done.map(({ name: n, file, sec }) => ({ name: n, file, sec }));
    summary.renderSec = +done.reduce((a, d) => a + d.sec, 0).toFixed(1);
    return `${done.length} styles, ${summary.renderSec}s in all (${done.map((d) => `${d.name} ${d.sec}s`).join(', ')})`;
  });

  const sheetFile = join(paths.out, `${name}-styles.png`);
  const pickerFile = join(paths.out, `${name}-styles.html`);
  const spec = JSON.parse(readFileSync(specPath, 'utf8'));
  await stage('sheet', async () => {
    // The same moments in every row, picked on each style's own timeline (its
    // transitions are a different length, so the same moment is at a different time).
    const timeline = (n) => (n === 'studio' ? specs[n] : fillTiming(specs[n], resolveStyle(specs[n])));
    const per = Object.fromEntries(done.map((d) => [d.name, chooseMoments(timeline(d.name))]));
    const keys = per[done[0].name].map((m) => m.key).filter((k) => done.every((d) => per[d.name].some((m) => m.key === k)));
    for (const d of done) d.moments = keys.map((k) => per[d.name].find((m) => m.key === k));
    const moments = done[0].moments;
    const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', done[0].file], { encoding: 'utf8' });
    const [w, h] = probe.stdout.trim().split(',').map(Number);
    const r = await makeSheet({
      styles: done, moments, out: sheetFile, workDir: join(paths.build, 'styles-sheet'), run,
      aspect: w && h ? w / h : 16 / 9, label: `${name}: ${done.map((d) => d.name).join(' / ')}`,
    });
    if (!r.ok) return fail('sheet', r.error);
    summary.sheet = sheetFile;
    summary.moments = moments;
    return `${moments.length} moments x ${done.length} styles (${moments.map((m) => `${m.t}s ${m.label}`).join(', ')})`;
  });
  await stage('picker', () => {
    const info = Object.fromEntries(known.styles.map((x) => [x.name, x]));
    writeFileSync(pickerFile, pickerHtml({
      title: `${name}: pick a style`, htmlPath: pickerFile, fps: spec.fps || 60,
      styles: done.map((d) => ({ ...d, description: info[d.name]?.description, suits: info[d.name]?.suits })),
    }));
    summary.picker = pickerFile;
    Object.assign(summary.outputs, { styles: stylesDir, styleSheet: sheetFile, picker: pickerFile });
    return `${pickerFile} (not opened; it is a local file for you to open)`;
  });
}

async function deliver(master) {
  await stage('deliver', async () => {
    const args = [join(HERE, 'deliver.mjs'), master, '--spec', specPath, '--public', dir, '--out', paths.out, '--max-mb', String(maxMb), '--json'];
    if (opt.gif) args.push('--gif', opt.gif);
    const r = await run('deliver', process.execPath, args, { timeoutSec: 600 });
    const j = lastJson(r.text);
    if (r.code !== 0 || !j?.ok) return fail('deliver', [`deliver.mjs exited ${r.code}${j?.error ? `: ${j.error}` : ''}`, tail(r.text)]);
    Object.assign(summary.outputs, { pr: j.pr, captions: j.vtt, srt: j.srt, chapters: j.chapters, poster: j.poster, ...(j.gif ? { gif: j.gif } : {}) });
    for (const i of j.issues) warn(`master: ${i}`);
    if (j.overCap) warn(`PR copy is ${j.prMb} MB, over ${maxMb} MB: shorten the cut`);
    return `PR copy ${j.prMb} MB (${j.prMode}), ${j.cues} caption cues, scan ${j.issues.length ? `${j.issues.length} to look at` : 'clean'}`;
  });
}

await finish();

// ---------------------------------------------------------------- 10 summary

async function finish() {
  summary.ok = true;
  summary.totalSec = secs();
  const looks = [];
  if (summary.sheet) looks.push(summary.sheet);
  if (summary.outputs.sheet) looks.push(summary.outputs.sheet);
  const fresh = summary.recorded.length ? summary.recorded : (used ?? []);
  for (const n of fresh) if (looks.length < 3 && existsSync(`${clipFile(n)}.sheet.png`)) looks.push(`${clipFile(n)}.sheet.png`);
  summary.look = looks;
  if (JSON_OUT) {
    console.log(JSON.stringify(summary));
  } else {
    console.log(`\n${name ?? 'demo'}: done in ${summary.totalSec}s`);
    for (const s of stages) console.log(`  ${s.name.padEnd(9)} ${String(s.sec).padStart(6)}s  ${s.note}`);
    if (summary.style && (opt.style || demo?.style !== undefined)) console.log(`  style     ${summary.style}${opt.style ? ' (from --style)' : ''}`);
    if (summary.styles) {
      console.log(`styles compared (${summary.renderSec}s of rendering, one after another):\n${summary.styles.map((d) => `  ${d.name.padEnd(12)} ${String(d.sec).padStart(6)}s  ${relative(dir, d.file)}`).join('\n')}`);
      console.log('  delivery was skipped: a comparison run makes no PR copy per style');
      const cmd = `node ${process.argv[1]} ${demoFile}`;
      console.log(`pick one: open ${summary.picker} in a browser (numbers or arrows flip styles, space plays).\nThen render the chosen one for real: ${cmd} --style <name>   (or put "style": "<name>" in demo.json)`);
    }
    if (summary.reused.length) console.log(`  reused    ${summary.reused.join(', ')} (unchanged; --retake <name> after changing the app)`);
    if (warnings.length) console.log(`warnings (${warnings.length}):\n${warnings.map((w) => `  - ${w}`).join('\n')}`);
    const o = summary.outputs;
    if (Object.keys(o).length) console.log(`outputs:\n${Object.entries(o).map(([k, v]) => `  ${k.padEnd(9)} ${v}`).join('\n')}`);
    if (looks.length) console.log(`look at:\n${looks.map((l) => `  ${l}`).join('\n')}`);
    if (summary.browser) console.log(summary.browser.note);
  }
  process.exit(0);
}
