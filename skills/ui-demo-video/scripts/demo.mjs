#!/usr/bin/env node
// One file in, one finished demo video out.
//
//   node scripts/demo.mjs init <dir> [--url http://localhost:3000] [--name my-demo]
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
// Next to demo.json it keeps:
//   clips/<take>.mp4 (+ .events.json, .sheet.png) and clips/<take>.take.json,
//   a fingerprint of everything that defines the take;
//   build/video.json (the resolved spec; demo.json is never rewritten),
//   build/steps/<take>.json, build/logs/<stage>.log;
//   out/<name>.mp4, out/<name>-pr.mp4, .vtt, .srt, -chapters.txt, -poster.png,
//   out/<name>-sheet.png (a contact sheet of the finished video: look at it).
//
// Options:
//   --retake <a,b|all>   record these takes again even if nothing changed.
//                        NEEDED after you change the APP: the take fingerprint
//                        covers the spec (url, steps, options), not your code.
//   --takes <a,b>        record only these takes, then stop (for recording
//                        "before" takes on an old branch, then switching).
//   --only <stage>       capture | render | deliver: run just that part
//   --no-deliver         stop after render
//   --no-rehearse        skip the dry run
//   --max-mb 10          size cap for the PR copy
//   --gif <start:dur>    also a GIF excerpt, e.g. 12:6
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
// Exit codes: 0 done, 1 a stage failed (its name is printed), 2 usage, 3 the
// page needs a sign-in (run scripts/chrome.sh --login <url>).
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDemo, checkSpec } from './check-video.mjs';
import { CAPTURE_OPTIONS, SAFE_NAME, captureArgs, clipPath, resolveSpec, takeHash, takeSpec, takesUsed } from './spec-lib.mjs';

const T0 = Date.now();
const HERE = dirname(fileURLToPath(import.meta.url));
const secs = (t0 = T0) => +((Date.now() - t0) / 1000).toFixed(1);

// ---------------------------------------------------------------- arguments

const VALUE = new Set(['retake', 'takes', 'only', 'max-mb', 'gif', 'port', 'parallel', 'url', 'name']);
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
  demo.mjs init <dir> [--url <base>] [--name <name>] [--force]
  demo.mjs <demo.json> [--retake a,b|all] [--takes a,b] [--only capture|render|deliver]
                       [--no-deliver] [--no-rehearse] [--max-mb 10] [--gif start:dur]
                       [--port 9222] [--parallel 1] [--json] [--force]
Read the top of this file for the stages and the folder layout. After you change
the APP (not demo.json) use --retake: the fingerprint cannot see your code.`;
if (opt.help || opt.h || !pos.length) {
  console.log(USAGE);
  process.exit(opt.help || opt.h ? 0 : 2);
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

// ---------------------------------------------------------------- init

if (pos[0] === 'init') {
  const dir = resolve(pos[1] ?? '.');
  refuseTemp(dir);
  const name = opt.name ?? (basename(dir).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+/, '') || 'demo');
  const file = join(dir, 'demo.json');
  if (existsSync(file) && !opt.force) {
    console.error(`${file} already exists (--force overwrites it)`);
    process.exit(2);
  }
  const starter = {
    name,
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
  writeFileSync(file, `${JSON.stringify(starter, null, 2)}\n`);
  const r = checkDemo(starter);
  console.log(`wrote ${file}  (${r.errors.length} errors, ${r.warnings.length} warnings)`);
  for (const m of [...r.errors, ...r.warnings]) console.log(`  ${m}`);
  console.log(`Edit the urls, steps and captions, then: node ${process.argv[1]} ${file}`);
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
let current = 'start';

const warn = (m) => { if (!warnings.includes(m)) warnings.push(m); };
const paths = {
  clips: join(dir, 'clips'), build: join(dir, 'build'), logs: join(dir, 'build', 'logs'),
  steps: join(dir, 'build', 'steps'), out: join(dir, 'out'),
};

// A stage failure ends the run: say which stage, what happened, and (with
// --json) the same as data. `code` lets a sign-in page exit 3.
const summary = { ok: false, demo: demoFile, stages, warnings, reused: [], recorded: [], outputs: {}, look: [] };
const fail = (stage, lines, code = 1) => {
  const msg = [].concat(lines).join('\n');
  summary.error = { stage, message: msg };
  summary.totalSec = secs();
  if (JSON_OUT) console.log(JSON.stringify(summary));
  else {
    for (const s of stages) console.error(`  ${s.name.padEnd(9)} ${String(s.sec).padStart(6)}s  ${s.note ?? ''}`);
    console.error(`FAILED at ${stage}: ${msg}`);
    if (warnings.length) console.error(`warnings (${warnings.length}):\n${warnings.map((w) => `  - ${w}`).join('\n')}`);
    console.error(`(${summary.totalSec}s${existsSync(paths.logs) ? `; logs in ${paths.logs}` : ''})`);
  }
  for (const c of children) try { c.kill('SIGTERM'); } catch {}
  process.exit(code);
};
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { for (const c of children) try { c.kill('SIGTERM'); } catch {} process.exit(130); });

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
    const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', fd2, fd2] });
    closeSync(fd2);
    children.add(p);
    let timedOut = false;
    const timer = timeoutSec ? setTimeout(() => { timedOut = true; p.kill('SIGTERM'); }, timeoutSec * 1000) : null;
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
const justCapture = only === 'capture' || (!only && !!opt.takes);
const doCapture = !only || only === 'capture' || !!opt.takes;
const doRender = !justCapture && (!only || only === 'render');
const doDeliver = !justCapture && !opt['no-deliver'] && (!only || only === 'deliver');
let name;
let used;
let takes;

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
  const r = checkDemo(demo);
  const extra = [];
  used = takesUsed(demo);
  const defined = Object.keys(demo?.takes && typeof demo.takes === 'object' ? demo.takes : {});
  for (const flagName of ['retake', 'takes']) {
    for (const n of list(opt[flagName])) if (n !== 'all' && !defined.includes(n)) extra.push(`--${flagName} "${n}" is not a take in demo.json (takes: ${defined.join(', ') || 'none'})`);
  }
  for (const w of r.warnings) warn(w);
  if (r.errors.length || extra.length) {
    return fail('validate', [`${r.errors.length + extra.length} problem${r.errors.length + extra.length === 1 ? '' : 's'} in ${basename(demoFile)}:`,
      ...[...r.errors, ...extra].map((e) => `  - ${e}`)]);
  }
  name = demo.name || basename(demoFile).replace(/\.?demo\.json$|\.json$/, '');
  if (!SAFE_NAME.test(name)) name = basename(dir).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+/, '') || 'demo';
  takes = Object.fromEntries(used.map((n) => [n, takeSpec(demo, n)]));
  for (const d of Object.values(paths)) mkdirSync(d, { recursive: true });
  summary.name = name;
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
      else if (prev.hash !== takeHash(takes[n])) why[n] = 'take changed';
      else summary.reused.push(n);
    }
    toRecord = Object.keys(why);
    summary.plan = why;
    return [toRecord.length ? `record ${toRecord.map((n) => `${n} (${why[n]})`).join(', ')}` : 'record nothing',
      summary.reused.length ? `reuse ${summary.reused.join(', ')}` : ''].filter(Boolean).join('; ');
  });

  if (toRecord.length) {
    await stage('chrome', async () => {
      // Always through chrome.sh: it starts the background Chrome when none is
      // up, and when a --login window is open it takes the session back into
      // the background one. Recording in the login window would work, but the
      // point is that nothing shows on screen.
      const r = await run('chrome', join(HERE, 'chrome.sh'), [], { env: { PORT: String(port) }, timeoutSec: 90 });
      if (r.code !== 0) return fail('chrome', [`chrome.sh exited ${r.code}`, tail(r.text)]);
      return tail(r.text, 1).replace(/^Chrome /, '').replace(/ \(profile: .*$/, ')');
    });

    for (const n of toRecord) writeFileSync(stepsFile(n), `${JSON.stringify(takes[n].steps, null, 1)}\n`);

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
    const rehearsable = (n) => takes[n].steps.length && takes[n].rehearse !== false;
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

    await stage('record', async () => {
      let slots = Math.min(parallel, toRecord.length);
      const res = await pool(toRecord, parallel, async (n) => {
        rmSync(takeFile(n), { force: true }); // a failed take must never look reusable
        const s = await runSetup(n, `record-${n}`);
        if (!s.ok) return s;
        const t = takes[n];
        const r = await run(`record-${n}`, process.execPath,
          [join(HERE, 'capture.mjs'), ...captureArgs(t, { port, stepsFile: stepsFile(n), out: clipFile(n), allowTemp: !!opt.force }), '--json'],
          { timeoutSec: Math.max(300, t.duration * 25 + 120) });
        const j = lastJson(r.text);
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
      return `${toRecord.map((n) => `${n} ${res.get(n).j.wallSec}s`).join(', ')} (${slots} at a time)`;
    });
  } else {
    stages.push({ name: 'chrome', sec: 0, note: 'not needed' });
  }
}

if (justCapture) await finish();

// ---------------------------------------------------------------- 6-7 camera, check

let specPath = join(paths.build, 'video.json');
if (doRender) {
  await stage('camera', async () => {
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
    const spec = resolveSpec(demo, aspects);
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
  await stage('render', async () => {
    const r = await run('render', process.execPath, [join(HERE, 'compose.mjs'), specPath, '--out', master, '--clips', dir, '--sheet', sheet, '--json'], { timeoutSec: 1800 });
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
  if (doDeliver) await deliver(master);
}
if (only === 'deliver') {
  const master = join(paths.out, `${name}.mp4`);
  specPath = join(paths.build, 'video.json');
  if (!existsSync(master) || !existsSync(specPath)) fail('deliver', `nothing to deliver yet: needs ${master} and ${specPath} (run without --only first)`);
  await deliver(master);
}

async function deliver(master) {
  await stage('deliver', async () => {
    const args = [join(HERE, 'deliver.mjs'), master, '--spec', specPath, '--out', paths.out, '--max-mb', String(maxMb), '--json'];
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
  if (summary.outputs.sheet) looks.push(summary.outputs.sheet);
  const fresh = summary.recorded.length ? summary.recorded : (used ?? []);
  for (const n of fresh) if (looks.length < 3 && existsSync(`${clipFile(n)}.sheet.png`)) looks.push(`${clipFile(n)}.sheet.png`);
  summary.look = looks;
  if (JSON_OUT) {
    console.log(JSON.stringify(summary));
  } else {
    console.log(`\n${name ?? 'demo'}: done in ${summary.totalSec}s`);
    for (const s of stages) console.log(`  ${s.name.padEnd(9)} ${String(s.sec).padStart(6)}s  ${s.note}`);
    if (summary.reused.length) console.log(`  reused    ${summary.reused.join(', ')} (unchanged; --retake <name> after changing the app)`);
    if (warnings.length) console.log(`warnings (${warnings.length}):\n${warnings.map((w) => `  - ${w}`).join('\n')}`);
    const o = summary.outputs;
    if (Object.keys(o).length) console.log(`outputs:\n${Object.entries(o).map(([k, v]) => `  ${k.padEnd(9)} ${v}`).join('\n')}`);
    if (looks.length) console.log(`look at:\n${looks.map((l) => `  ${l}`).join('\n')}`);
  }
  process.exit(0);
}
