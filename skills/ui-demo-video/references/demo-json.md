# demo.json and the runner

`demo.json` is the one file you write. `scripts/demo.mjs demo.json` reads it,
records what is out of date, renders the video and delivers the copies. This
page is the complete reference for both. Steps are in `steps.md`, scene
options in `scenes.md`.

## A complete example

`examples/quick-fix.demo.json` is a full one. This is a smaller one with
every part in it:

```json
{
  "name": "invite-fix",
  "url": "http://localhost:3000",
  "capture": { "hideFloating": true, "keep": "[data-sonner-toaster]" },
  "takes": {
    "before": {
      "url": "/team",
      "setup": "./reset-demo-data.sh",
      "steps": [
        { "wait": 1.2 },
        { "click": { "text": "Invite teammate" }, "dur": 0.8 },
        { "camera": "wide", "waitFor": { "selector": "[role=dialog]" } },
        { "click": { "selector": "input[aria-label='Email address']" } },
        { "type": "jordan.lee+demo@example.com", "cps": 22 },
        { "click": { "text": "Send invite" }, "dur": 0.7 },
        { "wait": 1.8 },
        { "move": { "x": 900, "y": 640 }, "dur": 0.8 }
      ]
    },
    "after": {
      "url": "/team",
      "setup": "./reset-demo-data.sh",
      "steps": [
        { "wait": 1.2 },
        { "click": { "text": "Invite teammate" }, "dur": 0.8 },
        { "camera": "wide", "waitFor": { "selector": "[role=dialog]" } },
        { "click": { "selector": "input[aria-label='Email address']" } },
        { "type": "jordan.lee+demo@example.com", "cps": 22 },
        { "click": { "text": "Send invite" }, "dur": 0.7 },
        { "waitFor": { "selector": "[data-sonner-toast]" } },
        { "mark": "sent-toast", "target": { "selector": "[data-sonner-toast]" } },
        { "wait": 1.8 },
        { "move": { "x": 900, "y": 640 }, "dur": 0.8 }
      ]
    }
  },
  "transition": "zoom-blur",
  "transitions": ["focus-pull", null, "push-through", null],
  "scenes": [
    { "type": "title", "text": "Invites now confirm", "subtitle": "ACME-101", "durationSec": 3.4 },
    { "type": "issue", "source": "Linear", "id": "ACME-101", "status": "Fixed",
      "title": "I sent an invite but nothing told me it worked",
      "quote": "I clicked Send invite and the dialog just closed.",
      "reporter": "Reported by Riley", "durationSec": 7 },
    { "type": "clip", "take": "before", "tag": "Before", "durationSec": 7,
      "autoCamera": true, "caption": "The dialog closes with no sign it worked" },
    { "type": "clip", "take": "after", "tag": "After", "durationSec": 7,
      "autoCamera": true, "caption": "A toast confirms the invite went out",
      "callouts": [{ "mark": "sent-toast", "label": "Invite sent" }] },
    { "type": "list", "title": "Shipped in PR #101", "durationSec": 5,
      "items": ["Toast after sending an invite"] }
  ]
}
```

```bash
node scripts/demo.mjs init ~/Downloads/invite-fix-demo --url http://localhost:3000 --name invite-fix
node scripts/demo.mjs ~/Downloads/invite-fix-demo/demo.json
```

`init` writes a valid starter with two takes and five scenes. Edit it, then
run the second command, as often as you like.

A callout names a `mark` from the take and a short `label`; it is drawn by
hand round the marked thing, a circle unless `"style"` names another
(`underline` or `highlight` for text, `box` for a region, `bracket` for a
group, `strike` or `cross` for what was removed, or the older `ring` and
`spotlight`). `"side": "below"` places the label, `"arrow": false` drops the
arrow, `"brackets": ["left"]` picks a bracket's sides. `scenes.md` has the
details.

## Top-level keys

`demo.json` is a `video.json` plus four keys (and `style`, below). Any other key is an error
(`validate` suggests the nearest real one), except notes: a key that starts
with `_` or `$`, or is called `comment` or `notes`, is ignored.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `name` | string | the file name without `.demo.json`, else the folder name | Names the outputs (`out/<name>.mp4`). Letters, digits, dots, dashes and underscores; it must start with a letter or digit |
| `url` | string | none | Base URL. A take's relative `url` is resolved against it. Must be a full URL such as `http://localhost:3000` |
| `capture` | object | `{}` | Recording options shared by every take (next section). A take's own value wins |
| `takes` | object | `{}` | Take name to take. Names follow the same character rule as `name`, because they name the clip files |
| `scenes` | list | required | The scenes. Types and options: `scenes.md` |
| `style` | string or object | `studio` | The look of the video: `"midnight"`, or `{ "preset": "midnight", "overrides": { "caption": { "size": 0.022 } } }`. See "Style" below and `styles.md` |
| `camera` | `"fill"` or `"inside"` (or `{ "mode": ... }`) | the style's | How a zoom frames the recordings: `fill` grows the whole window until the recording fills the frame (`studio`, `midnight`), `inside` crops inside a fixed window (`editorial`, `terminal`, `sketch`). A clip or image scene may set its own. See `styles.md` |
| `theme`, `transition`, `transitionSec`, `transitions`, `music` | | see below | The same as in a `video.json` |
| `width`, `height`, `fps` | number | 1920, 1080, 60 | The size and frame rate of the finished video (not of the recording) |

A take that no scene uses is a warning (it would be recorded for nothing).
A scene that names a take that is not defined is an error.

### Style

`"style"` is a name (`studio`, `midnight`, `editorial`, `terminal`, `sketch`)
or an object with `preset` (a name, default `studio`) and `overrides` (tokens
merged over the style, listed in `scripts/compositor/styles/README.md`).
`node scripts/compose.mjs --list-styles` lists the names. An unknown name,
or a `style` of any other shape, is a `validate` error that lists the valid
names; an override group that does not exist is a warning with the nearest
match. A `--style <name>` on the command line beats the file, for that run only.

Precedence between `style` and `theme`:

- `studio`: `theme.background`, `foreground`, `accent` and `tagColors` all
  apply, as below.
- Any other style owns the ground and the text colour. `theme.background` and
  `theme.foreground` are ignored, with a warning. Change them with
  `"overrides": { "palette": { "background": "...", "foreground": "..." } }`
  (for a style with a shader ground, the `canvas` tokens).
- `theme.accent`, `theme.tagColors` and `theme.logo` still apply under every
  style, each style adapting the colours to its ground (`terminal` keeps its
  own green accent whatever you give).
- A `transition`, `transitions` or `transitionSec` you write is used as
  written. Without them, the style's own default applies.

### Defaults the runner fills in

The runner writes `build/video.json` from `demo.json`; `demo.json` itself is
never changed. For `studio` (or no `style`) it adds the table below. For any
other style it adds only `width`, `height` and `fps`: it writes no `theme`,
`transition` or `transitionSec`, so the renderer can tell what you chose from
what is a default, and the style supplies the rest. It adds:

| Key | Default |
|---|---|
| `width`, `height`, `fps` | 1920, 1080, 60 |
| `transition` | `zoom-blur` |
| `transitionSec` | 0.5 |
| `theme.background` | a pale radial gradient (`radial-gradient(120% 90% at 50% 0%, #f5f6fb 0%, #e4e7f2 100%)`) |
| `theme.foreground` | `#111114` |
| `theme.accent` | `#3b6bff` |
| `theme.tagColors` | `{ "Before": "#e5484d", "After": "#3b6bff" }` |

`theme` is merged one level deep: give `background` and the rest stay. But
`tagColors` is replaced whole, so if you add a `"Tour"` colour, list
`Before` and `After` again.

On each scene that has a `take`, it sets `src` to `clips/<take>.mp4` and
removes `take`. A scene with a take and no `aspect` gets the recording's own
width over height, from the take's `take.json` (or its events file); a scene
that names a file with `src` is left without one, and the renderer reads the
shape from the file. `auto-camera` then writes `moves` and callout boxes into the same
file. `transitions` has no default: a gap without an entry uses
`transition`.

## Capture options

Recording options go under `capture` for every take, or on a take for one.
Each maps to a `capture.mjs` flag; `scripts/capture.mjs --help` lists them
too. A value of `false` or `null` counts as not set. A list is joined with
`, ` (useful for `hide`).

| Option | Type | Default | Does | Flag |
|---|---|---|---|---|
| `hide` | CSS | none | Hide these elements, in addition to the built-in dev overlays (Next.js, Vite, webpack, Agentation) | `--hide` |
| `hideFloating` | bool | false | Also hide small fixed-position widgets (dev toolbars, chat bubbles). This hides toasts too | `--hide-floating` |
| `keep` | CSS | none | Container whose floating children stay visible under `hideFloating` | `--keep` |
| `redact` | CSS | none | Blur these elements in every frame. A `redact` step adds more from that point on | `--redact` |
| `dark` | bool | false | Emulate `prefers-color-scheme: dark` | `--dark` |
| `mobile` | bool | false | Phone emulation: touch, a 390x844 viewport unless `width` and `height` say otherwise | `--mobile` |
| `width`, `height` | number | what this screen shows in a maximized browser window | Viewport in CSS pixels. Set both for a fixed size | `--width`, `--height` |
| `scale` | number | 2 | Device pixel ratio of the frames. The browser must run at that scale too: `SCALE=3 scripts/chrome.sh` | `--scale` |
| `cursorScale` | number | 1.25 | Size of the drawn cursor | `--cursor-scale` |
| `slow` | `"auto"` or number | `auto` | Clock slowdown while recording. `auto` measures how fast this Chrome paints (about 2 seconds, remembered for an hour) and takes the smallest slowdown that gives about 60 distinct frames a second. `1` is real time | `--slow` |
| `noCursor` | bool | false | Do not draw the cursor | `--no-cursor` |
| `noRipple` | bool | false | No click ripple | `--no-ripple` |
| `lossless` | bool | false | PNG screencast frames instead of JPEG (slower) | `--lossless` |
| `allowRedirect` | bool | false | Do not stop when the page ends on another origin | `--allow-redirect` |
| `fps` | number | 60 | Frame rate of the clip | `--fps` |
| `crf` | number | 14 | x264 quality, lower is better | `--crf` |
| `jpegQuality` | number | 95 | JPEG quality of the screencast frames | `--jpeg-quality` |
| `encoder` | string | `x264` | `x264`, `x264-faster`, `x264-slow` or `vt` (VideoToolbox, macOS) | `--encoder` |

The rehearsal leaves out the options that only matter while recording:
`slow`, `lossless`, `fps`, `crf`, `jpegQuality` and `encoder`.

`capture.mjs` flags with no key in `demo.json`: `--no-guard` (let the page
see the real mouse), `--recalibrate` (measure the paint rate again),
`--port` (use the runner's `--port`) and `--allow-temp` (use the runner's
`--force`). Use `"slow": 1` when real waiting time is the point of a take: the
slowed clock does not slow the network.

## Takes

A take is one recording: a URL, the steps to run on it, and options.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `url` | string | top-level `url` | Where to start. Relative paths resolve against the top-level `url`. One of the two is required |
| `steps` | list | `[]` | What the cursor does (`steps.md`). A take with no steps records the page sitting still, and warns |
| `duration` | seconds | estimated | The least the clip may run. A clip runs to the end of its steps or to `duration`, whichever is later, so this is a floor and the steps decide the length |
| `setup` | shell command | none | Runs in the demo folder (through `sh -c`) before the page loads, for every rehearsal and every recording. Reset data or seed a user here. Exit non-zero stops the stage. Time limit 5 minutes |
| `pageSetup` | JavaScript | none | Runs once in the page after it loads, not recorded. Awaits promises, so a `fetch` that reverts data works. The recording then reloads the page, so what it sets must live outside the page (storage, a server) |
| `rehearse` | bool | true | `false` skips the rehearsal of this take (see below) |
| any capture option | | from `capture` | Overrides the shared value |

When `duration` is left out, the runner estimates it from the steps, the way
`capture.mjs` would: 1 second, plus every `wait`, plus the glide of each
`move` and `click` (`dur`, else 0.8 and 0.6), plus typing at `cps` (14
by default), plus each `scroll` (`dur`, else 0.8), plus 0.5 for each
`waitFor`, plus 1 more, rounded up, and never under 3. The estimate is a
floor too, and it is part of the take fingerprint.

The viewport defaults to what the person's screen shows in a maximized
browser window, so layouts match what they see. Pin `width` and `height` for
a fixed size.

### Rehearse

Before recording, every take that needs recording is run once with
`capture.mjs --dry-run`: the same steps, at full speed, nothing recorded.
Waits shrink to a fifth (half a second at most), glides become one move,
typing is instant. A target that is missing, hidden or still moving fails
the stage in seconds, with the closest matches, instead of after a slow
recording.

A rehearsal is real: it clicks, so a take that changes data needs a `setup`
that resets it, or `"rehearse": false`. (A `setup` runs before the rehearsal
and again before the recording.) Skip all rehearsals with `--no-rehearse`.
What a rehearsal cannot check: timing, that the click hit the element you
meant, what the result looks like.

## Scenes that use takes

| Scene | How it names a recording |
|---|---|
| `clip` | `"take": "after"`, or `"src": "clips/x.mp4"` for an existing file. Not both |
| `split` | `"before": { "take": "old" }` and `"after": { "take": "new" }` (each side also takes `src`, `trimStartSec` and `label`) |
| `image` | `"src"` only. An image is a still; a `take` is an error. Make one with `capture.mjs shot` |

Two scenes can use the same take with different `trimStartSec`. The auto
camera, captions, callouts, trims and order are all outside the take
fingerprint: changing them records nothing.

## Using an existing recording

Put the MP4 in the demo folder and name it with `src`, relative to that
folder:

```json
{ "type": "clip", "src": "clips/walkthrough.mp4", "durationSec": 8,
  "tag": "After", "caption": "The new settings page" }
```

- Leave `aspect` out: the renderer reads the shape from the file. If you do
  write one and it does not match the file, the `check` stage says so.
- With no `<file>.events.json` next to it, leave `autoCamera` off (it fails
  the `camera` stage) and write `moves` by hand.
- A file that is not one of this skill's recordings (another codec, a
  variable frame rate) is converted once to a proxy in `out/.compose-cache/`;
  the first render with it is slower.
- Nothing needs recording, so a `demo.json` with no `takes` runs without a
  browser. `examples/before-after.video.json` is a spec of this kind.

## The folder

Everything lives next to `demo.json`:

```
demo.json                      yours; never rewritten
clips/<take>.mp4               the recording
clips/<take>.mp4.events.json   where and when things happened (steps.md)
clips/<take>.mp4.sheet.png     one frame a second, to review the take
clips/<take>.take.json         the fingerprint and how the take came out
build/video.json               the resolved spec, camera moves included
build/steps/<take>.json        the steps as handed to capture.mjs
build/logs/<stage>.log         output of each child (record-<take>.log, ...)
build/miss/<take>/             screenshot of a rehearsal that missed
out/<name>.mp4                 the 1080p60 master
out/<name>-pr.mp4              the copy that fits --max-mb
out/<name>.vtt, .srt           captions on the real timeline
out/<name>-chapters.txt        chapters
out/<name>-poster.png          poster frame
out/<name>-sheet.png           contact sheet of the finished video
out/styles/<style>.mp4         with --styles: the video in each style
out/<name>-styles.png          with --styles: one row per style, same moments
out/<name>-styles.html         with --styles: a local page to flip between them
build/styles/<style>.video.json  with --styles: the spec each style rendered
out/<name>.gif                 only with --gif
out/.compose-cache/            proxies of clips the renderer could not read
```

A failed recording leaves `clips/<take>.mp4.miss.png` where the step
failed, and no `take.json`, so it can never look reusable. Recordings are
written to a hidden `.part` file first and renamed when whole.

Work in a folder that survives a restart, such as `~/Downloads/<name>-demo/`.
The runner refuses `/tmp`, macOS's per-user temp folders and agent
scratchpads (exit code 2) because recordings there are lost on restart and
can only be recorded again. `--force` allows it for a throwaway run.

## The stages

Each run prints one line per stage with its seconds.

| Stage | Does | Fails when |
|---|---|---|
| `validate` | Reads `demo.json` and lists every static problem at once, with no browser | The file cannot be read (exit 2) or parsed; an unknown key anywhere; a bad `name` or `url`; a step that does nothing or lacks a target; a scene without its text, items or recording; a scene that uses an undefined take; `transitions` longer than the gaps; an unknown transition; a `camera` that is not `fill` or `inside`; `--retake` or `--takes` naming an unknown take |
| `plan` | Decides which takes need recording (below) | Never |
| `chrome` | Runs `scripts/chrome.sh` so the background browser is up, and takes a `--login` window's session back into it. Skipped when nothing records | `chrome.sh` exits non-zero (no Chrome found, set `CHROME_PATH`) |
| `rehearse` | Dry-runs the takes to record | A target is not found, not visible, or does not stop moving; a `waitFor` times out; an invalid selector; the page does not load; a sign-in page (exit 3); `setup` exits non-zero; over 2 minutes; an `eval` step with `"fatal": true` throws |
| `record` | Records the takes, one at a time unless `--parallel` says otherwise. A failed take stops later takes from starting; takes already finished are kept | The same as `rehearse`, plus an empty take (the tab never painted), a take far past its length (stuck step), a crashed page, or over the time limit (`duration` x 25 + 120 seconds, at least 5 minutes) |
| `camera` | Writes `build/video.json`, then runs `auto-camera.mjs` on it | A take used by a scene has no clip; `autoCamera` on a scene whose clip has no events file; a callout names a mark the events file does not have |
| `check` | `check-video.mjs` against the real files (it also warns when a callout shows for over 0.3 s where the camera is not looking) | A trim runs past the end of a clip; `aspect` does not match the clip; a file is missing; a callout has no box; a camera key outside its scene |
| `render` | `compose.mjs`: the whole video on the GPU, then the contact sheet | A file cannot be found or decoded even through a proxy; an unknown scene type or transition; no master was written |
| `deliver` | `deliver.mjs`: PR copy, captions, chapters, poster, GIF, frozen and black scan | ffmpeg fails. A frozen or black stretch, or a PR copy over the cap, is a warning, not a failure |

When a stage fails the run stops, prints `FAILED at <stage>:` with the
message, every warning so far, and where the logs are. The warnings that
matter most are in the summary at the end of a good run too:

- a take whose cursor "may look jerky" (the message gives the share of
  glide frames that repeated): something heavy was running, or the page is
  too heavy for 2x. Record it again on an idle machine, or raise `slow`
- `hideFloating` with toast-like words in the steps and no `keep`
- a caption that cannot be read in the time it is on screen (more than 17
  characters a second, or under 1.5 s), or longer than 42 characters a line
  or two lines. The check does not count the time `terminal` and `sketch`
  take to type or write a caption, so leave those a little longer
- a transition that eats more than half of a scene
- `frame: "stage"` (renders flat; see `remotion-remocn.md`)
- more than 90 s of video

## Reusing takes

The `plan` stage records a take when any of these is true:

| Reason shown | Meaning |
|---|---|
| `retake` | You passed `--retake` for it |
| `no clip yet` | The clip or its events file is missing or empty |
| `no take.json (not recorded by this tool)` | The clip is there but has no fingerprint |
| `take changed` | The fingerprint differs |

The fingerprint (`clips/<take>.take.json`, field `hash`) is a hash of the
take's resolved URL, its `duration` (given or estimated), its `steps`, its
`setup`, its `pageSetup` and its capture options (the shared ones merged with
the take's, sorted). Change any of those and the take is recorded again.

It cannot see:

- **The app.** A fix in your code does not change `demo.json`. Use
  `--retake` after any change to the app, and whenever a recording looks
  wrong for a reason outside `demo.json`.
- What `setup` does: the fingerprint holds the command text, not the script
  behind it.
- Data on the server, the time of day, the Chrome version or the machine.
- `rehearse`, and anything in `scenes`, `theme`, `transitions` and the
  other video keys. Those are the cut; they never trigger a recording.

An option set to `false` is the same as an option left out.

## Running it

```bash
node scripts/demo.mjs <demo.json> [options]
node scripts/demo.mjs init <dir> [--url <base>] [--name <name>] [--style <name>] [--force]
```

| Option | Does |
|---|---|
| `--retake a,b` or `--retake all` | Record these takes even if nothing changed |
| `--takes a,b` | Record only these takes, then stop (no camera, render or delivery). For a "before" from another branch |
| `--only capture` | Stop after recording (the same as `--takes` with every take) |
| `--only render` | Skip recording; build the camera moves and render, then deliver |
| `--only deliver` | Only the delivery step, on the last master (`out/<name>.mp4` and `build/video.json` must exist) |
| `--no-deliver` | Stop after the render |
| `--style <name>` | Render in this style for this run; `demo.json` is not edited. An unknown name stops at `validate` |
| `--styles a,b` or `--styles all` | Compare looks (below). Needs two or more styles; not with `--style`, `--only capture`, `--only deliver` or `--takes` |
| `--stale-ok` | Render even if a clip's take changed or has no `take.json` (normally the `camera` stage stops and names the take) |
| `--no-rehearse` | Skip the dry run |
| `--max-mb 10` | Size cap for the PR copy |
| `--gif 12:6` | Also a GIF of 6 seconds starting at 12 |
| `--port 9222` | The Chrome debugging port (also handed to `chrome.sh`) |
| `--parallel 1` | Takes rehearsed and recorded at once. More than one is only faster on an idle machine, and takes that share a database or an account must stay at 1 |
| `--json` | Print the result as one JSON object on stdout; progress goes to stderr |
| `--force` | Allow a folder under `/tmp` |
| `--help` | Print the usage |

`init` refuses to overwrite a `demo.json` (`--force` does) and refuses a
temporary folder. `init --style <name>` writes `"style": "<name>"` into the
starter and refuses a name the renderer does not have.

### Comparing styles: `--styles`

`--styles all` (or a list of two or more names) validates, directs the camera
and checks once, so nothing is recorded twice, then renders the demo once per
style, one after another, each from its own resolved spec
(`build/styles/<style>.video.json`: transition lengths and camera moves follow
the style). It then writes a comparison sheet and a picker page, and delivers
nothing. It works with `--only render` on a finished build. The stages
are `render` (every style), `sheet` and `picker`; `deliver` is reported as
skipped. The sheet picks four to six moments from the timeline (the title, the
first card, a wide clip, a zoomed clip, a transition, the end card) and shows
the same ones in every row, each on that style's own timeline. The picker
page is not opened for you. See `styles.md` for how to use it and how to keep
the chosen style.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Done |
| 1 | A stage failed; its name is printed (and is in `error.stage` with `--json`) |
| 2 | Usage: no file, an unreadable file, a bad `--only`, a temporary folder, `init` over an existing file |
| 3 | The page needs a sign-in. Run `scripts/chrome.sh --login <url>`, log in, then run again |

Ctrl-C stops the children and exits 130.

### The sign-in handoff

`scripts/chrome.sh --login <url>` stops the background browser and opens a
normal window on the same profile. Someone logs in and leaves the window
open. The next `demo.mjs` run (or a plain `scripts/chrome.sh`) reads the
session out of the window, closes it, starts the background browser again
and puts the cookies back. This is the only time a window opens.

### `--json`

One line on stdout:

```json
{ "ok": true, "demo": "/path/demo.json", "name": "invite-fix",
  "stages": [{ "name": "validate", "sec": 0, "note": "5 scenes, 26.4s, 2 takes, 0 warnings" }],
  "warnings": [], "reused": ["before"], "recorded": ["after"],
  "plan": { "after": "take changed" },
  "outputs": { "master": "...", "sheet": "...", "pr": "...", "captions": "...",
               "srt": "...", "chapters": "...", "poster": "...", "gif": "..." },
  "look": ["...-sheet.png"], "style": "studio", "totalVideoSec": 26.4, "totalSec": 41.2 }
```

On failure `ok` is false and there is `"error": { "stage": "rehearse",
"message": "..." }` in place of the finished outputs. `gif` is there only
with `--gif`. `look` lists the images to open next: the finished contact
sheet first, then the contact sheets of the takes just recorded. `style` is
the style this run rendered in (`null` for a `--styles` run, `studio` when none is set). A `--styles` run
also has `styles` (a list of `{ name, file, sec }`), `renderSec`, `sheet`,
`moments` (the times and labels on the sheet), `picker`, and under `outputs`
the keys `styles` (the folder), `styleSheet` and `picker`.

## A "before" from another branch

The runner sees `demo.json`, not your code, so the old behaviour has to be
recorded while the old code is running:

1. On the new code, run `node scripts/demo.mjs demo.json --takes after`. It
   rehearses and records `after` and stops, which also proves its steps.
2. Check out the old code and restart the app. When only one port can sign
   in, switch the same checkout: stop the server, check out the old commit,
   rebuild what it imports, clear the framework cache (`.next`), restart.
3. Run `node scripts/demo.mjs demo.json --takes before`. It rehearses and
   records `before` and stops. (If a `before` clip was already recorded on
   the new code by mistake, add `--retake before`: nothing in `demo.json`
   changed, so the runner would otherwise reuse it.)
4. Switch back to the new code and restart.
5. Run `node scripts/demo.mjs demo.json`. Both clips are reused, so it only
   cuts, renders and delivers.

Do not edit the `before` take between step 3 and step 5: a changed step
records it again, against the new code.

## Running the pieces yourself

The runner is these scripts in a row. Each works alone, from the skill
folder, with the demo folder written out:

```bash
D=~/Downloads/<name>-demo
node scripts/capture.mjs clip --url <u> --out $D/clips/x.mp4 --duration 8 --steps steps.json --sheet
node scripts/capture.mjs clip --url <u> --steps steps.json --dry-run
node scripts/auto-camera.mjs $D/build/video.json --public $D
node scripts/check-video.mjs $D/build/video.json --public $D
node scripts/compose.mjs $D/build/video.json --clips $D --out $D/out/x.mp4 --sheet $D/out/x-sheet.png
node scripts/deliver.mjs $D/out/x.mp4 --spec $D/build/video.json --max-mb 10
```

`check-video.mjs` also takes a `demo.json` and then checks it statically (no
clips, no browser): the quickest way to validate while you write.
`compose.mjs --still <sec> --still-out <png>` writes one full-size frame, and
`--sheet <png>` a contact sheet.

### `capture.mjs` on its own

Every `capture.mjs` run ends with one line, `saved <file> (3600x2088, 9.5s,
75 distinct fps, slow 2x, 6.1 MB, wall 20.6s)` on success or
`FAILED: <reason>` on failure. With `--json` it prints one line of JSON
instead: `{ "ok": true, "file", "events", "width", "height", "durationSec",
"distinctFps", "frameCoverage", "heldFramePct", "longestHeldRun",
"paintedFrames", "slow", "bytes", "warnings", "wallSec" }`, or
`{ "ok": false, "error", "code", "wallSec" }`. Exit codes: 0 done, 1 failed
(a bad step, a missing target, an empty take), 2 usage (including `--out` in
a temporary folder), 3 not signed in or sent to another origin, 4 no Chrome
found. Each run opens its own background tab and closes it, whatever happens.
