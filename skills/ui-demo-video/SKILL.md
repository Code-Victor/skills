---
name: ui-demo-video
description: Make product videos of a web app that look professionally edited (bug-fix before/afters with the reported issue, feature tours, changelogs, PR, Slack and team demos) from real recordings, in minutes. One demo.json holds the takes and the scenes, and one command rehearses, records, directs, renders and delivers. Records in a background browser (no window, no focus change) at 2x and true 60fps, with a cursor that changes shape and ripples on click, human typing and blur for private data. An auto-camera zooms the way Screen Studio does, from what happened in each take. Scenes include issue cards, side-by-side comparisons, timed captions, callouts, screenshots, end cards, music and narration. Renders the whole video on the GPU in seconds, then delivers a PR-sized copy, captions, chapters, a poster and an automated check. Use when asked for a demo video, before/after video, screen recording, walkthrough, GIF or mp4 of UI work, a video for Slack, a PR or the team, or to make an existing recording look better.
license: MIT
metadata:
  author: Hamzat Victor (@Code-Victor)
  homepage: https://hamz.at
  repository: https://github.com/Code-Victor/skills
  tags: video, screen-recording, demo, before-after, auto-zoom, captions, webcodecs, webgl, ffmpeg, chrome-devtools-protocol
---

# UI demo video

Turns UI work into a video worth posting, in minutes. You write one file,
`demo.json` (the takes to record and the scenes to cut them into), and run
one command. Recording happens in a background browser: no window opens and
nothing takes focus, so the person keeps working while it runs.

## The fast lane

Paths are relative to this skill's folder. Work in a folder that survives a
restart, such as `~/Downloads/<name>-demo/` (the runner refuses `/tmp` and
session scratchpads: macOS empties them, and recordings can only be
re-recorded).

```bash
scripts/chrome.sh                                   # the background browser, once
node scripts/capture.mjs scout --url <page>         # what's on the page, as ready-to-paste targets
node scripts/demo.mjs init ~/Downloads/<name>-demo --url <base url> --name <name>
#   ...edit ~/Downloads/<name>-demo/demo.json: the takes, then the scenes
node scripts/demo.mjs ~/Downloads/<name>-demo/demo.json
#   ...look at out/<name>-sheet.png, fix demo.json, run the same command again
```

The one command validates the file (every problem at once), rehearses each
take in seconds (a wrong target stops there, with the closest matches),
records, lets the auto-camera write the zooms and callouts, renders, delivers,
and prints what to look at. Run it again and it redoes only what changed: a
caption, a trim or a camera edit records nothing (measured: 22 seconds for a
34 second video).

What to expect for a 30 to 45 s video with three takes: about two minutes for
the first full run, half a minute for each round of edits. To stay there:

- **Scout each page once, then write every take and every scene in one go.**
- **Fix everything a failed run lists before running again.** Validation and
  rehearsal report all their problems together.
- **Review on the contact sheets**, collect every fix, edit once, run once.
- **`--retake <take>` only when the app changed or the take itself is
  wrong.** Captions, trims, camera, transitions and order never need one.

References, read when the task reaches them:

- `references/demo-json.md`: every key of `demo.json`, the folder layout, the
  runner's options, recording "before" on another branch.
- `references/steps.md`: every capture step, how targets resolve, scouting
  and rehearsing.
- `references/scenes.md`: scene types, clip options, the auto-camera,
  captions, callouts, music and narration.
- `references/styles.md`: the five visual styles, how to pick one, comparing
  them on your demo, overriding a token.
- `references/craft.md`: the research behind the defaults (pacing, before /
  after formats, delivery limits, anti-patterns), with sources.
- `references/remotion-remocn.md`: the optional Remotion renderer, for a
  tilted 3D product shot.

## Requirements

- Node 22+, ffmpeg, Google Chrome or Chromium. Nothing to install with npm.
- The first render in a style downloads that style's fonts once (it falls
  back to a system font offline).

## 1. Plan

Write the story first, in beats. Pick the shape:

| Shape | Beats | Length |
|---|---|---|
| **Fix** | Issue card, before, after, end card | Under 45 s |
| **Fix plus tour** | Title, issue card, before, after, 3 to 5 tour beats, end card | 75 to 90 s |
| **Feature tour** | Title, one clip per capability, end card | 45 to 60 s |
| **Changelog** | Title, a short clip per change, a list end card | 30 to 60 s |
| **Comparison** | Split scenes of old and new pages, then the detail | 30 to 45 s |

For each beat note: URL, what the cursor does, how long it needs, the caption.
Rules that hold for every shape:

- **One focal action per beat**, 4 to 12 s, one caption that says what it
  does for the user. Lead with the strongest moment; cut anything that only
  shows loading, travelling or thinking. First cuts run long; trim before you
  polish.
- **Before and after compare like with like**: the same URL, viewport, data
  and framing; "Before" and "After" labels; before first (or on the left).
- **Show the report.** For a fix, open with an `issue` card quoting the
  reporter (trimmed to the part that matters), so the before clip has a why.

### Data and privacy

The video shows whatever the app shows. Before recording:

- **Re-enact with stand-ins** rather than real people's records: a seeded
  user named for the role ("Jordan Lee"), in the same state as the real case.
  Put the reset in a script and name it as the take's `setup`, so every
  rehearsal and every recording starts the same.
- **Blur what must stay on screen**: `"redact": "<css>"` on the take, or a
  `redact` step.
- Nothing from another customer, ever. Check the take sheets for names,
  emails and IDs.
- External effects (emails, invitations, webhooks) are real, and a rehearsal
  really clicks. Use a plus address the person owns (`name+demo@...`), reset
  in `setup`, or give the take `"rehearse": false`, and clean up afterwards.

## 2. The browser, and scouting

`scripts/chrome.sh` starts a headless Chrome with its own profile on port
9222 (or does nothing if it is already up). Nothing appears on screen.

- **The app needs a login.** A run that lands on a sign-in page stops with
  exit code 3. Run `scripts/chrome.sh --login <url>`: this is the one time a
  window opens. Ask the person to log in there and tell you when they have;
  leave the window open. The next `demo.mjs` run (or a plain
  `scripts/chrome.sh`) takes the session, cookies included, back into the
  background browser and closes the window.
- **The app refuses headless Chrome** (a blank page, a bot check):
  `scripts/chrome.sh --stop`, then `scripts/chrome.sh --window`. A window
  opens once and is never focused again; the person's mouse can't reach the
  page being recorded.
- `scripts/chrome.sh --status` says which mode is up; `--stop` ends it. Stop
  it when the work is done.

Scout before writing steps:

```bash
node scripts/capture.mjs scout --url http://localhost:3000/customers --out scout.png
```

It prints every visible control with a target you can paste into a step
(`button "Add customer" {"text":"Add customer"}`,
`input:text "Search customers" {"selector":"input[aria-label='Search customers']"}`)
and saves a screenshot. To see what a click reveals (a drawer, a dialog), add
`--steps partial.json` with the steps that get there. Read the screenshot too:
it shows the state the take will start from.

## 3. Write demo.json

`demo.json` is the video (theme, scenes, transitions) plus the takes to
record. `scripts/demo.mjs init` writes a valid starter;
`examples/quick-fix.demo.json` is a complete one. The shape:

```json
{
  "name": "invite-fix",
  "url": "http://localhost:3000",
  "takes": {
    "after": {
      "url": "/team",
      "setup": "./reset-demo-data.sh",
      "steps": [
        { "wait": 1.2 },
        { "click": { "text": "Invite teammate" }, "dur": 0.8 },
        { "camera": "wide", "waitFor": { "selector": "[role=dialog]" }, "wait": 0.6 },
        { "click": { "selector": "input[aria-label='Email address']" }, "dur": 0.7 },
        { "type": "jordan.lee+demo@example.com", "cps": 22 },
        { "click": { "text": "Send invite" }, "dur": 0.7 },
        { "mark": "sent-toast", "target": { "selector": "[data-sonner-toast]" }, "look": false },
        { "wait": 1.8 },
        { "move": { "x": 900, "y": 640 }, "dur": 0.8 }
      ]
    }
  },
  "transition": "zoom-blur", "transitionSec": 0.5,
  "scenes": [
    { "type": "title", "text": "Invites now confirm", "subtitle": "ACME-101", "durationSec": 3.4 },
    { "type": "clip", "take": "after", "tag": "After", "durationSec": 7, "autoCamera": true,
      "caption": "A toast confirms the invite went out",
      "callouts": [{ "mark": "sent-toast", "label": "Invite sent" }] },
    { "type": "list", "title": "Shipped in PR #101", "items": ["Toast after sending an invite"], "durationSec": 5 }
  ]
}
```

### Takes

A take is a URL and a list of steps (`references/steps.md` has every step).
The ones that make directing easy:

- `{ "mark": "toast", "target": {...} }` notes where something is, for a
  callout or for the camera to look at.
- `{ "camera": "wide" }` right after a click that opens a drawer, dialog or
  page, so the auto-camera pulls back to show it whole.
- `{ "waitFor": {...} }` instead of guessing how long a load takes.

Every click, move and mark waits by itself until its target exists, is
visible and has stopped moving, so don't pad waits for a panel that slides
in. A target that never appears fails the take with the closest candidates.

What a recording gives you:

- **The app at the person's size.** The viewport is what their screen shows
  in a maximized browser window, at 2x, so layouts, wraps and density match
  what they see every day. `"width"` and `"height"` on the take (or under
  `capture` for all takes) pin a size instead.
- True 60 fps: the page clock is slowed just enough for Chrome to paint
  every frame, and the frames are re-timed to real speed. Expect a take to
  cost about three times its length. A take whose cursor came out jerky is
  recorded once more, slower, and the summary says so.
- A cursor that becomes a hand over links and buttons and an I-beam over
  text, with a soft ripple where it clicks, and typing at a human pace that
  is the same on every take.
- Dev overlays (Next.js, Vite, webpack, Agentation) hidden; `"hide":
  "<css>"` for anything else; `"hideFloating": true` for small floating
  widgets. That last one also hides toasts: add `"keep": "<css of the toast
  container>"` when a toast is the point.
- `clips/<take>.mp4.sheet.png`, one frame per second, to review a take in one
  image, and an events file the auto-camera reads.

Rules that matter:

- **Use `"slow": 1` when real waiting time is the point** (a spinner that
  hangs for 8 seconds). The slowed clock doesn't slow the network, so a
  slowed capture makes slow loads look fast.
- **Never add attributes to nodes inside a rich-text editor** (ProseMirror,
  Tiptap, Lexical, Slate): the editor redraws the node and a `data-demo`
  marker vanishes. Target editor content by selector or text.
- **Components that swap in on hover or focus** replace the node you were
  pointing at. Move over them first, then target what appeared.
- Selects that open a list need real pointer events: click the option by
  `text`, never `.click()` it in an `eval`.
- Set text selections through the editor's API in an `eval`, not with
  shift-arrow runs. An `eval` that throws is reported with its step number;
  `"fatal": true` makes it fail the take.
- **Mobile web**: `"mobile": true` on the take (a 390x844 phone viewport with
  touch). For native iOS and Android apps use the `argent-screen-recording`
  skill, and for desktop apps a QuickTime or `screencapture -v` recording:
  put the MP4 in the demo folder and use `"src": "clips/x.mp4"` on the scene
  instead of `take`; without an events file, write `moves` by hand instead of
  `autoCamera`.
- A still for an `image` scene: `node scripts/capture.mjs shot --url <u>
  --out <demo folder>/shots/x.png`.

### Scenes

Scene types: `title`, `issue` (the report as a ticket card), `clip`, `split`
(before and after side by side), `image` (a still with drift), `list`
(changelog or end card). Every option is in `template/src/types.ts`; the
guide is `references/scenes.md`.

**The auto-camera** (`"autoCamera": true` on a clip) pushes in about 1.8x as
the cursor acts, follows each action inside a shot, holds 2 s, pulls out at
`"camera": "wide"` steps and scrolls, and skips pushes that would wobble or
twitch. Check it on the sheet; hand-tune a scene by replacing `autoCamera`
with your own `moves`.

**The look** is a top-level `"style"`. No `style` means `studio`. Pick by
audience, then say it in one line (`"style": "editorial"`):

| `style` | The idea | Pick it for | Watch out |
|---|---|---|---|
| `studio` | Soft light gradient, a big white window a zoom grows to fill the frame, pill captions | The safe default; Slack, PRs, docs | Least distinctive |
| `midnight` | Near-black stage, glass captions, one pale accent | Launches, dark-mode products, a premium feel | A light app is a bright slab; slower pacing |
| `editorial` | Warm paper, serif, captions as margin notes | Changelogs, weekly updates, writing-led demos | Least showy; recording is smaller |
| `terminal` | Mono type, typed text, stepped motion | Developer tools, PR demos for engineers | Cold for consumer products; typed text needs time |
| `sketch` | A photo on paper, annotated by hand | Bug-fix before and afters | Playful; wrong for a formal audience |

Under any style but `studio`, the style owns the ground and text colour
(`theme.background` and `theme.foreground` are ignored with a warning);
`theme.accent`, `tagColors` and `logo` still apply, adapted to the style. A
`transition` you write is honoured; otherwise the style's own is used. When
the person cannot choose, run `node scripts/demo.mjs <demo.json> --styles
all`: it renders every style from the same recordings (nothing is recorded
again), then writes a sheet and a picker page (`references/styles.md`).

**Framing, per scene** (`frame`):

| `frame` | What it is | Use for |
|---|---|---|
| `flat` (default) | The recording in a rounded window. In `studio` and `midnight` a zoom grows the whole window until the recording fills the frame (Cap, Screen Studio); in the other styles it crops *inside* a fixed window. `"camera": "inside"` or `"fill"` on the spec or the scene overrides the style | Most scenes |
| `full` | Edge to edge, no window | Dense UI that needs every pixel |
| `stage` | A tilted 3D product shot | Remotion renderer only (see below); here it renders as `flat` with a warning, in every style |

**Transitions**, per gap (`transitions[i]` is the gap after scene `i`). The
lengths and looks below are `studio`'s; other styles redraw them in their own
language (in `terminal` and `sketch` every named one becomes that style's own
move), and a style's default can be a transition of its own:

| Transition | Feel | Use between |
|---|---|---|
| `focus-pull` (1.5 s) | Calm, premium | A title card and the first or last scene |
| `push-through` (1.3 s) | Going deeper | Before and after: the reveal |
| `whip-pan` (0.9 s, `direction`) | Fast, sideways | Peer tour beats. Vary direction |
| `zoom-blur` (`transitionSec`) | The workhorse | Anything else |
| `fade` / `cut` | Soft / none | Splitting one recording into two beats |

A transition overlaps the two scenes it joins: give a scene next to a
`focus-pull` at least 3.1 s (the check warns when it would eat over half).

**Titles** pick an `effect`: `soft-blur-in` (the opener), `word-push` (a
closing line) or `micro-scale-fade` (a chapter card). Styles that type or draw
their titles have their own default and treat these as variants.

**Emphasis**: `*word*` in a title, caption, list item or card line marks one
accented word (colour or italic, the style decides); `\*` is a literal
asterisk. Caption files drop the markers.

**Captions**: one short sentence each, at most 42 characters a line and two
lines, 15 to 17 characters a second, 1.5 s minimum; the check warns past any
of those. A caption says what to look at; the story belongs on the title,
issue and list cards. `captions` gives a long clip several in turn. Where they
sit depends on the style: in the strip under the window in `studio` and
`midnight` (over the recording, on a plate, while a zoom fills the frame, and
at the top for their whole time when the action is under that spot), under the
window in `terminal`, in a margin column in `editorial`, in the photo's strip
in `sketch`. `terminal` types them and `sketch` writes them by hand (faster
when time is short); the check does not count that time, so leave a little
extra.

**Callouts**: a hand-drawn circle (or `underline`, `highlight`, `box`,
`bracket`, `strike`, `cross`; Rough Notation's marks, in the style's own ink)
round something small the caption names, drawn on with an arrow from a short
label; `ring` and `spotlight` remain. Name a `mark` and the auto-camera places
and times it, ending at the next click.

**Speed**: `playbackRate` 1.1 to 1.25 tightens typing and loading without
looking fast-forwarded. `trimStartSec` skips the start of a take; two scenes
can use the same take with different trims.

**Sound** (optional; Slack and PRs play muted, so captions carry the story):
a `music` bed that ducks under per-scene `voiceover` files. Narration options
are in `references/scenes.md`.

**Brand**: `theme.logo` pins a mark to a corner of every scene. Outline any
text in an SVG logo first (an SVG drawn as an image can't load web fonts).

## 4. Run

```bash
node scripts/demo.mjs ~/Downloads/<name>-demo/demo.json
```

The summary lists seconds per stage, what was reused, every warning, and the
files. What each kind of failure means:

- **validate**: problems in the file itself (an unknown key, a scene whose
  take isn't defined, a step with no target). All are listed; fix all. A
  caption too fast to read is a warning, listed in the summary.
- **rehearse**: a step's target wasn't found, wasn't visible or kept moving.
  The message names the take and the step and lists the closest candidates
  with ready targets; a screenshot of that moment is in `build/miss/<take>/`.
- **record**: a take failed for real (the app errored, a wait timed out).
  Takes already recorded are kept; later ones are not started.
- **check**: the scenes don't fit the recordings (a trim past the end of a
  clip).
- Exit code 3: the page needs a sign-in (section 2).

Useful options (all of them: `references/demo-json.md`):

- `--retake <a,b|all>`: record again though the take's definition hasn't
  changed. **Needed after you change the app**: the runner can see
  `demo.json`, not your code.
- `--takes before`: record only these and stop. For a "before" from another
  branch: check out the old code, run with `--takes before`, switch back, run
  normally (the "before" clip is reused). When only one port can sign in,
  switch the same checkout: stop the server, check out the old commit,
  rebuild what it imports, clear the framework cache (`.next`), restart.
- `--only render` or `--no-deliver` while you iterate on the cut.
- `--style <name>` for one run in another look; `--styles all` to compare.
- `--gif 12:6` for a GIF excerpt, `--max-mb 10` for the PR copy's size.

Don't record while something heavy runs (a build, another render): the take
still saves, but with fewer painted frames, and the summary will warn.

## 5. Review

Look, don't assume. Two kinds of image cover everything:

- `out/<name>-sheet.png`: the finished video in one grid, with times. After
  `--styles`, `out/<name>-styles.png` instead: one row per style, the same
  moments in each.
- `clips/<take>.mp4.sheet.png`: each take, one frame a second.

Check: no dev overlays or debug UI, the cursor where expected, the page
finished loading, the action actually happened (a click that hit the wrong
element still "succeeds"), nothing personal or another customer's data on
screen, captions readable and clear of the UI, the camera on what each
caption names, transitions clean, nothing cropped. For one frame at full
size: `node scripts/compose.mjs <demo folder>/build/video.json --clips <demo
folder> --still 12.5 --still-out <demo folder>/f.png`.

Fix the take (`--retake`) when the recording is wrong; fix `demo.json` when
the cut is wrong. When only a time or a box in an events file is off, edit
the number instead of retaking.

### When the app's own motion looks wrong on camera

The capture shows the truth at 2x and a slowed clock, so it exposes motion
problems the eye forgives. **A white or empty frame where a panel should
slide in is almost always a main-thread stall in the app**: the panel mounts
its heavy content in the same frame as the animation. Measure before fixing:
a `PerformanceObserver({ type: 'longtask' })` around the click, in a visible
tab, shows the stall. Fix it in the app (mount the shell first, render the
heavy body a frame later in `startTransition`), then `--retake`. An element
that appears whole in one frame (a menu, a bubble) reads as abrupt on video:
give it a 150 ms fade and slight scale from its anchor.

## 6. Hand over

In `out/`: `<name>.mp4` (the 1080p60 master), `<name>-pr.mp4` (fits
`--max-mb`), `<name>.vtt` and `.srt` (from the scenes, on the real timeline),
`<name>-chapters.txt`, `<name>-poster.png`, and a GIF with `--gif`. A
`--styles` run leaves `out/styles/<style>.mp4`, the sheet and
`out/<name>-styles.html` (open it in a browser: number keys flip between the
styles at the same playback position) and delivers nothing: once the person
picks, run again with `--style <name>`, or put it in `demo.json`. The
delivery step also scans the master for frozen and black stretches: a still
run inside a clip scene usually means a trim ran past the end of a recording.

Where it goes:

- **GitHub PR**: 10 MB on free plans, 100 MB on paid.
  `gh pr edit <n> --body-file body.md --attach ./<name>-pr.mp4` (gh 2.99+)
  uploads files the body references by the same relative path.
- **Slack**: the master as is; it plays inline, muted.
- **Linear**: attach the MP4.
- **GIF**: only a short loop, for places that won't play video.

Give the person the paths, what each section shows, and anything you had to
approximate (a stand-in for a real person, a wait you sped up, a "before" you
couldn't re-record sharply). Then `scripts/chrome.sh --stop`.

## The Remotion renderer (optional)

The default renderer draws every scene type and transition. The one look it
doesn't have is `frame: "stage"`, the tilted 3D product shot. For that, or to
build on remocn's component catalog, render the same spec with Remotion
(`references/remotion-remocn.md`; it ignores `style` and draws the studio
look): it takes minutes instead of seconds, needs
npm and network access, and **Remotion is free for individuals, non-profits
and companies of up to 3 people; larger companies need a Company License**
(remotion.pro/license). Say so when making a video for a company.

## One stage by hand

The runner is these scripts in a row; each works alone when you need it
(`D` is the demo folder):

```bash
D=~/Downloads/<name>-demo
node scripts/capture.mjs clip --url <u> --out $D/clips/x.mp4 --duration 8 --steps steps.json --sheet
node scripts/capture.mjs clip --url <u> --steps steps.json --dry-run     # rehearse only
node scripts/auto-camera.mjs $D/build/video.json --public $D             # moves and callouts from the takes
node scripts/check-video.mjs $D/build/video.json --public $D             # trims, aspects, files, reading speed
node scripts/compose.mjs $D/build/video.json --clips $D --out $D/out/x.mp4 --sheet $D/out/x-sheet.png
node scripts/deliver.mjs $D/out/x.mp4 --spec $D/build/video.json --max-mb 10
```

`capture.mjs --help` lists every recording option. To restyle an existing
recording, skip the takes: point scenes at files with `"src"`.

## Anti-patterns

Zooms on every click or zooms that start late; bouncy motion on text-heavy
UI; an idle cursor parked over content; dead air (loading, hunting for a
control); fake-looking data; a story that needs sound; captions faster than
20 characters a second; over 90 s for a PR. (Sources in
`references/craft.md`.)

## Gotchas learned the hard way

- Hidden tabs and closed panels often hold a twin of your target (the same
  text, no box). Targets resolve to the first *visible* match; if a click
  lands nowhere, check for an invisible twin first.
- An option further down a list is off-screen inside the list; targets are
  scrolled into view (`nearest`) before they're measured. Scroll the page
  itself with a `scroll` step, or the jump shows.
- A rehearsal runs the steps for real, fast. A take that changes data needs a
  `setup` that resets it, or `"rehearse": false`. Takes that share one
  database or account must not run at the same time (the default is one at a
  time; leave `--parallel` alone).
- The take fingerprint covers `demo.json`, not the app. After changing the
  app, `--retake`.
- The capture clock slows timers, `requestAnimationFrame`, `Date.now()`,
  `performance.now()`, CSS animations and `element.animate()` together
  (measured: a 1000 ms `element.animate()` finished at 1004 ms of page time
  at `slow` 4). Code that reads `new Date()` or a server's clock sees real
  time, so use `Date.now()` or `performance.now()` in anything you inject.
- Headless Chrome renders at 1x unless told otherwise. `chrome.sh` sets 2x;
  for a 3x phone take start it as `SCALE=3 scripts/chrome.sh` (after
  `--stop`) and set `"scale": 3` on the take.
- A clip that isn't one of this skill's recordings (another codec, a variable
  frame rate) is converted once to a proxy before rendering; the first render
  with it is slower.
- Chrome refuses remote debugging on the profile the person is using. Never
  point `PROFILE` at their live one; log in through `chrome.sh --login`.

## Author

Made by Hamzat Victor ([@Code-Victor](https://github.com/Code-Victor),
https://hamz.at). Source and updates: https://github.com/Code-Victor/skills
