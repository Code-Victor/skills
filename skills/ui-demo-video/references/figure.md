# Explainer videos from anatomy figures

An explainer is a video of an animated figure, not of an app. The figure is
an isometric SVG page made with the third-party
[anatomy](https://github.com/wheresryan22/anatomy) skill. The recorder steps
the page one frame at a time into an ordinary clip, and a plain `clip` scene
plays it. So everything else keeps working: styles, cards, captions,
transitions, the auto-camera, callouts, music and delivery.

This page is the whole guide. The keys are also listed in `demo-json.md`, and
captions at marks in `scenes.md`.

## 1. When to use an explainer

Use one when the story is about how something works, not what a screen does:

- A build, a pipeline or a queue, and where the time goes.
- Before and after on one time axis: what a change saved.
- A system with parts that move: a request, a cache, a gate.
- Anything you would otherwise draw on a whiteboard and talk over.

A screen recording is better when the point is a real interface: a bug fix, a
new page, a flow someone will click through. If the viewer will need to find
the button, show the button.

An explainer needs real numbers. If you cannot say where each number comes
from, do not draw it to scale.

## 2. Sizing

Tell the person the estimate before you start. Anatomy's own sizes:

| Figure | What it is | Time to make |
|---|---|---|
| Figure | 40 to 80 parts, a few lanes or stages, one idea | 30 to 90 minutes |
| Hero | A rich scene with many parts and some 3D | 2 to 4 hours |

Most explainers need a Figure. The recording is cheap next to the drawing: a
40 s video takes a few minutes to record (section 8).

## 3. Workflow

1. **Truth.** Write `model.mjs`: the real numbers, each with its source, and
   everything the figure shows computed from them. The example is
   `examples/figure/model.mjs` (its numbers are fictional and say so).
2. **Figure.** Build the page with anatomy. Put the legend inside the frame
   and use a light theme. Anatomy stays the authority on drawing: use its
   skill for the page.
3. **Hook.** Wire the page to the recorder with `figureHook` (section 4).
4. **demo.json.** Write the figure take (`source`, `page`, `timeline`), add
   marks if the page has none, and write the scenes with captions at marks.
   `node scripts/demo.mjs init <dir> --figure --name <name>` writes a small
   working starter to copy from.
5. **Sketch, then draft.** Before a full recording, agree the beats:

   ```bash
   node scripts/capture-figure.mjs --page figure/bench.html --out clips/bench.mp4 \
     --timeline '[[0,0],[7,30],[20,130],[34,223],[39,223]]' \
     --preview 2,7,13,20,28,34 --preview-dir build/preview
   ```

   It steps every frame but saves only a still at each listed second
   (`preview-2s.png`, `preview-7s.png` and so on, in `--preview-dir`), and
   encodes nothing: a sketch sheet in a fraction of a recording. Show it, fix the beats, then run
   `node scripts/demo.mjs <demo.json> --draft` for review rounds: 30 fps,
   lower resolution, much faster (section 8). Collect every fix, edit once.
6. **The final run.** `node scripts/demo.mjs <demo.json>` with no flag. A
   draft take is recorded again at full quality, because the draft flag is
   part of the take's fingerprint.
7. **Review the sheet.** `out/<name>-sheet.png` and
   `clips/<take>.mp4.sheet.png`. Run the checklist in section 9.
8. **Deliver.** The same outputs as any demo (`SKILL.md`, section 6). The
   poster is the frame at the mark with `"poster": true`. With no such mark
   it is the frame half a second after the last mark (or the last frame, if
   that comes first). `deliver.mjs --poster <sec>` overrides both.

## 4. The contract and the keys

### The page: `window.__figure` (version 1)

The recorder looks for `window.__figure` after the page loads. A page that
has it is recorded in **hook mode**: the recorder calls the figure for each
frame. A page without it is recorded in **clock mode** (section 7).

```js
window.__figure = {
  version: 1,
  range: [t0, t1],       // the figure's own time, in its own units
  ready: Promise,        // resolves when fonts are loaded and the first draw is done
  frame(t, dt) {},       // draw figure time t
  seekable: false,       // true only if frame(t) is a pure function of t
  marks: [               // optional: named moments in figure time
    { id: 'gate-open', t: 130, anchor: '[data-gate="parallel"]', label: 'Parallel run done: 2:10', poster: false, look: true },
  ],
};
```

- **`range`** is in the figure's own units: CI seconds, turns, anything. The
  take's `timeline` maps video seconds to it.
- **`frame(t, dt)`** is called in non-decreasing `t`. **`dt` is real video
  seconds since the previous frame**: `1/fps` for every frame after the
  first, and `0` on the first frame. It is still called during holds, when
  `t` stands still, so springs keep settling. It must draw synchronously (or
  return a promise that resolves after drawing) and must not read the clock.
- **`seekable: true`** only if `frame(t)` gives the right picture for any `t`
  in any order, with `dt` ignored. A figure with springs is not seekable.
  A seekable figure can be recorded in parallel (section 8), and `dt` is `0`
  there.
- **Marks.** `anchor` is a CSS selector: at the mark's frame the recorder
  reads its bounding box for the event, so the camera and callouts can find
  it. No anchor, no box. A mark fires on the first frame whose figure time
  reaches `t`; one the timeline never reaches gets a warning and no event.
  `poster: true` on at most one mark picks the poster frame. `look: false` keeps the camera off a mark, as it does for a
  `mark` step. `label` is the mark's text.

A mark becomes an event in the clip's events file, the same as a `mark` step
in a screen recording: `{ type: 'mark', label: <id>, t: <video sec>, box?,
text?, poster?, look? }`. That is why `{ "mark": "<id>" }` callouts and the
auto-camera work with no extra setup.

**The page fills the viewport.** It lays itself out for the take's
`viewport` and keeps its legend inside. Captions are not part of the page:
they live in `demo.json` and the style draws them.

### `figureHook`

Do not write the object by hand. Copy `scripts/figure-hook.js` next to the
page (a build can inline it into a `<script type="module">`, as the example
does). It has no imports.

```js
import { figureHook, monotone, recording } from './figure-hook.js';

figureHook({
  range: [0, 223],
  marks: MARKS,
  seekable: false,
  step(dt, t) {},   // advance springs by dt real seconds, towards the state at figure time t
  draw(t) {},       // render figure time t, synchronously
  stop() {},        // called once, before the first frame
  ready,            // optional promise: images, a WebGL warm-up
});
```

- `draw(t)` is required. `step(dt, t)` is optional: leave it out when the
  figure has no motion of its own. The hook calls `step` in substeps of at
  most 1/60 s, before `draw(t)`, and skips it when the figure is seekable.
- `stop()` runs once, before the first frame. Cancel your own
  `requestAnimationFrame` loop, tour timers and listeners in it.
- `recording` is `true` when the recorder loaded the page (it sets
  `window.__figureRecording` before any page script runs). **When it is true,
  do not start the idle tour, a rAF loop or a timer.** Otherwise the frames
  before the first `frame()` call depend on how long the page took to load,
  and two recordings differ.
- `monotone(keys)` is the interpolator the recorder uses for timelines. It is
  exported so a page can use the same curve.

The worked example is `examples/figure/`: `model.mjs` (the numbers),
`build.mjs` (builds `bench.html` with anatomy's kit), `bench.html` (the built
page) and `NOTICE.md` (anatomy's licence, because the page inlines its kit).
Its hook call is one line near the end of `bench.html`: `range` is `[0, 223]`
(CI seconds), `seekable` is `true`, and the marks are:

| id | figure t (s) | Anchor |
|---|---|---|
| `setup-done` | 30 | the gantry |
| `checks-done` | 125 | the end of the second parallel lane |
| `gate-open` | 130 | the parallel run's gate |
| `serial-done` | 220 | the serial run's gate |
| `saved` | 223 | the "saved" label (the poster) |

### The take in demo.json

A take is a figure take when it has `"source": "figure"`:

```json
{
  "takes": {
    "bench": {
      "source": "figure",
      "page": "figure/bench.html",
      "timeline": [[0,0],[2.5,0],[7,30],[9,36],[13.5,100],[15.5,119],[17,125],
                   [20,130],[22.5,133],[24,133],[28.5,200],[30,214],[31.5,220],
                   [34,223],[39,223]]
    }
  },
  "scenes": [
    { "type": "clip", "take": "bench", "autoCamera": true,
      "captions": [
        { "atMark": "setup-done", "text": "Every machine installs first" },
        { "atMark": "gate-open", "text": "The parallel run finishes at 2:10" },
        { "atMark": "serial-done", "text": "The serial run takes until 3:40" }
      ],
      "callouts": [{ "mark": "gate-open", "label": "Done" }] }
  ]
}
```

The keys:

| Key | Type | Default | Notes |
|---|---|---|---|
| `source` | `"figure"` | none | Required to switch modes |
| `page` | string | none | Required. The HTML file, relative to the `demo.json` folder (or absolute). It must exist |
| `viewport` | `[w, h]` | `[1920, 1080]` | CSS pixels, pinned |
| `dpr` | number, 1 to 3 | `1.5` | Pinned device scale |
| `fps` | number | `60` | The usual capture option |
| `timeline` | `[[videoSec, figureT], ...]` | none | At least 2 points. `videoSec` starts at 0 and rises strictly; `figureT` never falls. The take's length is the last `videoSec`: the clip has `round(length * fps)` frames plus a copy of the last one that stamps the exact length (2340 + 1 frames for 39 s at 60 fps) |
| `duration` | number | none | Only when there is no `timeline` (a take needs one or the other, not both) |
| `marks` | `[{ id, t, anchor?, label?, poster?, look? }]` | `[]` | Extra marks in figure time, added to the page's. On the same `id` the `demo.json` mark replaces the page's whole, and its fields are not merged: repeat `anchor` and `label` if you still want them. Ids are unique within the take. Needed in clock mode |
| `figureSteps` | list | `[]` | Clock mode only (section 7) |
| `seed` | integer | `1` | Clock mode: seeds `Math.random` |
| `transitions` | `"off"` or `"on"` | `"off"` | Clock mode: CSS transitions |
| `crf`, `jpegQuality`, `encoder` | | as in `demo-json.md` | The usual capture options |

With only `duration`, figure time runs linearly over `range` (hook mode),
spread so the last frame shows the end of the range, or virtual seconds equal
video seconds (clock mode). The other capture options
(`width`, `scale`, `hide` and the rest) are errors on a figure take, and each
message says what to use instead (`demo-json.md` lists them).

A figure take is re-recorded when the page changes or any file in the page's
folder changes (section 10), or when its timeline, marks, steps, seed,
viewport, `dpr` or the draft flag change. Editing only a caption records
nothing.

## 5. Timeline craft

The `timeline` is the whole pacing. Each pair is a moment in the video and the
figure time it shows. The monotone curve between pairs means motion eases in
and out, and a repeated figure time is a hold: it slows into the hold and
stands still.

The example's timeline is 39 s:

```
[0,0] [2.5,0]        hold the empty bench for 2.5 s
[7,30] [9,36]        the setup lands at 7 s, then slows
[13.5,100] [15.5,119] [17,125]   the long middle: speed up, then ease into the first event
[20,130] [22.5,133] [24,133]     the key moment: slow, then hold 1.5 s
[28.5,200] [30,214] [31.5,220]   catch up to the serial run
[34,223] [39,223]    land, then hold 5 s
```

Rules that hold:

- **30 to 45 s.** Shorter is a teaser, longer loses people.
- **Slow into events, hold at the end.** A viewer reads a result after it
  lands, so give each event a beat of near stillness, and end on a hold of
  4 to 5 s with the result on screen.
- **Pace with the figure, never ahead.** The common failure is spending the
  whole build in the first half and idling after. Spread the events across the
  length, and check on the sheet that something is still moving at 60 per cent.
- **Captions 0.5 to 1.5 s ahead of their mark.** The viewer reads the line,
  then sees the thing happen. `leadSec` on an `atMark` caption defaults to
  0.6 (`scenes.md`). When you retime the timeline, `atMark` captions follow
  the marks; an `atSec` caption would not.
- **One idea per caption.** Under 42 characters a line, two lines at most. If
  a caption has "and" in it, split it into two marks.
- **Use the `--preview` sheet as a sketch.** One still per beat shows whether
  each beat has something to look at before you spend a full recording on it.

## 6. Figure craft for video

What made the first explainer work, in general terms:

- **Real numbers first, to scale.** Every length on the figure is its number.
  A plate that is twice as long took twice as long. The viewer can check it by
  eye, and the figure is true to its source.
- **One time axis for comparisons.** To compare before and after, or two
  plans, put both on the same ruler so the gap is visible without reading.
- **Colour by kind, the same colours everywhere.** If installing is blue in
  one lane it is blue in every lane. The legend lists the kinds once.
- **Empty space is the saving.** When a change makes something faster, show
  the time it freed as an empty stretch: an empty bench, a gap on the ruler.
  The viewer sees what was saved.
- **Nameplates on the lanes.** Name each lane on the figure itself, so a
  caption never has to say which one it means.
- **The brand mark from the real asset file, never redrawn.** If a logo
  appears, use the file. Any filter on it (a burn, a blur) goes over the
  real shape. The example uses a plain monogram, not a logo.
- **The legend is in the frame.** The legend is part of the figure, not a
  caption, so it is there when someone pauses the video.
- **No text smaller than 18 px at 1080p.** Muted video on a phone shrinks
  everything. Check the 1080p frame, not the page at your window size.
- **One thing moves at a time.** Several moving parts at once leave the eye
  nowhere to go. Move the thing the caption is about.

## 7. Clock mode

A figure with no hook is still recordable: any anatomy figure as it comes.
The recorder loads the page once to look for `window.__figure`. With none
after a second, it adds `scripts/figure-clock.js` and loads the page again,
so the clock is in place before any page script runs and the page only ever
sees virtual time. The page's own loop (its idle tour) then plays, and
`figureSteps` can steer it. Use it for an existing figure you do not want to
edit, or when the motion is the tour itself. Marks come from the take's
`marks` and mark steps, since the page has none.

**Figure time** is virtual seconds since load. With `duration` it is the
video second. With a `timeline` the curve drives the clock: a hold stops it,
so the whole page holds (springs too, unlike hook mode); a steeper stretch
runs the page faster; a timeline that starts after 0 plays the page that far
before the first frame. The clock moves in steps of at most 1/60 s, so a
figure's own dt clamp never slows its motion.

What the clock drives:

- `requestAnimationFrame` and `cancelAnimationFrame`
- `performance.now()`, `Date.now()` and `new Date()` (counted from 1 January
  2026, so a video never shows the real date)
- `setTimeout`, `setInterval`, their clear functions and
  `requestIdleCallback`, fired in order at their virtual times
- CSS animations, the Web Animations API and SVG (SMIL) animations: each
  starts the first time the clock sees it and is set to virtual time
- `Math.random`, from `seed` (default 1). The same seed gives the same video;
  another seed gives another run of the same figure
- CSS transitions are off (`"transitions": "off"`, the default), so a hover
  or class change snaps. With `"on"` they run, on virtual time like
  animations

What it does not drive, so keep it out of a clock-mode figure:

- **iframes.** Only the top page is virtual; a frame inside runs in real time.
- **An animation the page pauses itself** with `pause()` or
  `animation-play-state: paused` keeps playing: the clock pauses every
  animation to set its time, so it cannot tell yours apart.
- **`crypto.getRandomValues()` and `crypto.randomUUID()`** are not seeded.
- **`event.timeStamp`** and **`document.timeline.currentTime`** stay real.
- **Anything loaded after `load`** (a `fetch`, an image, a video, a worker)
  arrives in real time, so the frame it lands on can change between runs.
  The recorder waits for `load` and `document.fonts.ready` only. Keep the
  page self-contained.

**`figureSteps`** are input at fixed video seconds, not in sequence:

```json
"figureSteps": [
  { "at": 2.0, "move": [0.30, 0.55] },
  { "at": 3.0, "move": [0.70, 0.55], "dur": 4.0 },
  { "at": 8.0, "click": [0.5, 0.5] },
  { "at": 8.5, "key": "ArrowRight" },
  { "at": 12.0, "mark": "drawer-open", "anchor": ".drawer", "label": "The drawer opens" }
]
```

- A step fires on the first frame whose video second reaches `at`.
- Positions are fractions of the viewport.
- A `move` jumps. With `dur` it glides from where the pointer was, once a
  frame, with the same ease in and out as a cursor glide in a screen take.
  The first move has nowhere to glide from, so it jumps.
- A `click` moves there, then presses and releases the left button.
- A `key` is a key down and up (`ArrowRight`, `End`, `Enter`). It goes to the
  focused element, so click the figure first if it listens on its stage.
- A `mark` step logs a mark event like any mark, with the box of its
  `anchor` read once the frame has painted. `look: false` keeps the camera
  off it.
- No cursor is drawn, and clicks and keys are not logged as events, so the
  camera does not chase them. Add a mark step where you want it to look.

Limits:

- **No seeking.** Frames run in order from load, so a clock-mode take is
  always recorded on one worker.
- **WebGL needs SwiftShader.** The recorder starts Chrome with it, so the
  pixels match between runs. Record on the recorder, not in your own browser.
- **The viewport must hold the figure.** Anatomy pages are documents: some
  are taller than 1080 px and only the top shows. The recorder warns when
  the page is bigger than the viewport.
- Check determinism before you trust it (section 9): record twice with
  `--hash-frames` and compare.

## 8. Performance

Measured on an Apple Silicon laptop at DPR 1.5, 1920 by 1080 viewport
(2880 by 1620 frames):

| Run | Per frame | A 40 s, 60 fps video |
|---|---|---|
| Full | about 85 ms | about 3.5 minutes |
| `--draft` (30 fps, DPR 1, JPEG quality 80) | TODO(measure) | TODO(measure) |
| `--preview` (stills only, nothing encoded) | TODO(measure) | TODO(measure) |
| `--workers 4` (seekable figures) | TODO(measure) | TODO(measure) |

- **`--draft`** records figure takes at 30 fps, DPR 1 and JPEG quality 80
  (on `capture-figure.mjs` it overrides `--fps`, `--dpr` and
  `--jpeg-quality`). Use it for review rounds. Draft takes are marked
  `draft: true` in their `take.json`, and the flag is in the fingerprint, so
  the next run without `--draft` records them again at full quality.
- **`--preview 2,8,20 --preview-dir <dir>`** on `capture-figure.mjs` steps
  every frame up to the last second you list, saves a PNG only at those
  seconds, and encodes nothing. With no `--preview-dir` the stills go next to
  `--out`.
- **Parallel capture** is for figures with `"seekable": true` in their hook.
  `--workers n` on `capture-figure.mjs` splits the frames into `n` ranges in
  tabs of one Chrome, then encodes them in order. The frames are identical to
  a single worker's, so a parallel recording is the same video.
  A figure with springs is not seekable and runs on one worker.

Do not run a build or another render while recording: it slows frames and
risks a stall. Recording is one Chrome and one encode at a time.

## 9. Verification checklist

Before the final run:

- [ ] Anatomy's line check reports 0 floating ends:
  `node <anatomy>/scripts/lines.mjs figure/bench.html`.
- [ ] The figure's own audit, if its build has one (`node build.mjs --audit`).
- [ ] The page's console is clean when loaded.
- [ ] `recording` stops the idle tour, rAF loop and timers (section 4).
- [ ] The viewport contains the whole stage and the legend, with no scrollbar.
- [ ] Every number on the figure traces to `model.mjs`.

After recording:

- [ ] `clips/<take>.mp4` is H.264, yuv420p, TV range, at the fps you asked:
  `ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,pix_fmt,color_range,width,height,r_frame_rate -of default=nw=1 clips/<take>.mp4`
- [ ] The events file lists every mark you captioned, with a box on each one
  that has an anchor.
- [ ] On `out/<name>-sheet.png`: each caption sits before its mark, the camera
  is on what the caption names, something is still moving past the halfway
  point, and the end holds.
- [ ] No text under 18 px at 1080p. Look at one frame at full size:
  `node scripts/compose.mjs <demo folder>/build/video.json --clips <demo folder> --still 20 --still-out <demo folder>/f.png`.
- [ ] Clock mode: two runs give the same frame hashes. Run
  `capture-figure.mjs` twice with `--hash-frames a.txt` and `b.txt`, then
  `cmp a.txt b.txt`.
- [ ] The poster is the mark you meant.
- [ ] No private data, real names or logos you should not have.

## 10. Gotchas

- **Fonts.** The recorder waits for `document.fonts.ready` before the first
  frame. A font loaded later, by a script, can still pop in: add it to
  `ready`.
- **DPR.** The viewport is pinned and so is `dpr` (1.5 by default), because a
  figure's WebGL layer renders at `min(1.5, DPR)` and the SVG must match it.
  Frames are recorded at `viewport` times `dpr`, and the compositor scales
  them to the output size. Leave `dpr` at its default unless you have a reason.
- **The viewport must contain the stage.** The page lays out for the
  take's `viewport`. A figure sized for a laptop window will crop at
  1920 by 1080. Set `viewport` to what you designed for.
- **Never emulate reduced motion.** The recorder sets
  `prefers-reduced-motion: no-preference`. A figure that honours the reduce
  setting goes still, and the recording is a still image.
- **Order-independent frames.** The recorder starts Chrome with
  `--disable-partial-raster`, so a frame looks the same whatever was drawn
  before it. That is why parallel capture stays identical to sequential. You
  do not need to set it.
- **`file://` pages and the folder hash.** The page is loaded from disk, and
  the fingerprint covers the page and every regular file in its folder
  (not subfolders), so editing a stylesheet or an image beside it records
  again. It skips files over 20 MB, dotfiles, Markdown, video files, events,
  take and sheet files, and any `demo.json`. Put the page in its own
  folder (`figure/`), and keep big assets out of it, or the hash is slow.
- **A figure that does not change.** The recorder warns when frames stay
  the same, byte for byte, for more than 2.5 s of video while figure time
  moves: in hook mode `draw()` is not reading `t`; in clock mode the page is
  waiting on something the clock does not drive (section 7). A hold, where
  figure time stands still, never warns.
- **The runner does not open a window.** A figure take uses its own
  headless Chrome, so it does not need `scripts/chrome.sh` and cannot use the
  person's logged-in session. It is for self-contained pages.
- **Hybrid demos work.** A demo can have figure takes and screen takes
  together. `examples/hybrid.demo.json` does.
