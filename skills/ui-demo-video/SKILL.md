---
name: ui-demo-video
description: Make product videos of a web app that look professionally edited (bug-fix before/afters with the reported issue, feature tours, changelogs, PR, Slack and team demos) from real recordings. Captures at 2x with lossless frames and a slowed clock for true 60fps, with a cursor that changes shape and ripples on click, human typing and blur for private data. An auto-camera zooms the way Screen Studio does, from what happened in each take. Scenes include issue cards, side-by-side comparisons, timed captions, callouts, screenshots, end cards, music and narration. Assembles with ffmpeg (fast) or Remotion + remocn (cinematic), then delivers a PR-sized copy, captions, chapters, a poster and an automated check. Use when asked for a demo video, before/after video, screen recording, walkthrough, GIF or mp4 of UI work, a video for Slack, a PR or the team, or to make an existing recording look better.
license: MIT
metadata:
  author: Hamzat Victor (@Code-Victor)
  homepage: https://hamz.at
  repository: https://github.com/Code-Victor/skills
  tags: video, screen-recording, demo, before-after, auto-zoom, captions, remotion, remocn, ffmpeg, chrome-devtools-protocol
---

# UI demo video

Turns UI work into a video worth posting. Five stages, each a script in
`scripts/` (paths below are relative to this skill's folder):

1. **Plan** the story and the data it needs.
2. **Capture** clips from a real browser: `capture.mjs` (also writes each
   take's timeline of clicks, typing and marks).
3. **Direct**: describe the video in one `video.json`, then let
   `auto-camera.mjs` write the camera moves and callouts from the timelines.
4. **Render**: `assemble.mjs` (ffmpeg, one to two minutes, simple) or the
   Remotion template (`new-remotion.sh` + `render.sh`, cinematic).
5. **Deliver**: `deliver.mjs` makes the PR copy, captions, chapters, poster
   and an optional GIF, and checks the master for frozen or black stretches.

Both renderers read the same `video.json`, so you can draft with the quick
path and switch to Remotion without rewriting anything.

References, read when the task reaches them:

- `references/steps.md`: every capture step and how targets resolve.
- `references/scenes.md`: scene types, clip options, the auto-camera,
  captions, callouts, music and narration.
- `references/craft.md`: the research behind the defaults (pacing, before /
  after formats, delivery limits, anti-patterns), with sources.
- `references/remotion-remocn.md`: the template's files and adding remocn
  pieces.

## Requirements

- Node 22+ (the capture script uses the built-in WebSocket), ffmpeg, Google
  Chrome or Chromium.
- Remotion path only: npm and network access (it scaffolds a project and pulls
  remocn components). **Remotion is free for individuals, non-profits and
  companies of up to 3 people; larger companies need a Company License**
  (remotion.pro/license). Say so when making a video for a company, and offer
  the ffmpeg path, which needs no license.
- Optional, for scouting a page before a take: the `agent-browser` CLI 0.37+
  (`npm i -g agent-browser`).

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
  Keep the reset in a script (SQL, an API call, `--setup`) and run it before
  every take, so each one starts the same.
- **Blur what must stay on screen**: `--redact "<css>"` or a `redact` step.
- Nothing from another customer, ever. Check the contact sheet for names,
  emails and IDs before rendering.
- External effects (emails, invitations, webhooks) are real. Use a plus
  address the person owns (`name+demo@...`) and clean up afterwards.

### Scout and rehearse with agent-browser (before any take)

`agent-browser` (0.37+; `agent-browser skills get core` loads its guide) is
the fast tool around a take:

- **Get in**: `--profile Default` reuses the person's own Chrome login.
  Apps whose refresh token rotates (WorkOS, Auth0) do best in a kept profile:
  the clone-browser-profile skill, when it's installed, seeds one from the
  person's Chrome (`browser.py open <name> --from "<profile>" --reseed`), and
  capture and scouting share it through its CDP port.
- **Find the targets**: `snapshot -i` lists interactive elements with their
  accessible names, the best selectors for `steps.json`.
- **Rehearse**: walk the flow once by hand (`click @ref`, `fill`) to learn
  what mounts where and what each action says, before scripting it.

## 2. Capture

**Work in a folder that survives a restart**, such as `~/Downloads/<name>-demo/`,
never a session scratchpad or anything under `/tmp` or `/private/tmp`. macOS
empties those on every restart, and recordings can't be re-rendered, only
re-recorded. Keep the clips, steps, reset script and the Remotion project
there.

```bash
scripts/chrome.sh                      # Chrome on port 9222 with its own profile
# log in to the app in that window once; the profile keeps the session

node scripts/capture.mjs clip --url http://localhost:3000/page \
  --out clips/after.mp4 --duration 8 --steps steps/after.json --hide-floating --sheet

node scripts/capture.mjs shot --url http://localhost:3000/page --out shots/after.png --wait 3
```

What a take gives you:

- **The app at your size.** The viewport is what this screen shows in a
  maximized browser window (measured each take: the screen less the
  browser's toolbars), so layouts, wraps and density match what the person
  sees every day. `--width 1440 --height 900` pins a size instead, for takes
  that must match an older recording or a smaller laptop.

- 2x device pixels and lossless PNG frames; the page clock runs 5x slower
  while Chrome paints, and frames are re-timed to real speed: true 60fps at
  the timing a user sees.
- A cursor that becomes a hand over links and buttons and an I-beam over
  text, re-checks when the page changes under it, and leaves a soft ripple
  where it clicks (`--cursor-scale`, `--no-ripple`).
- Typing at a human pace, the same on every take.
- `<clip>.events.json`: every click, typing run, key, scroll and mark, in
  video seconds and frame fractions, for the auto-camera.
- `<clip>.sheet.png` with `--sheet`: one frame per second, to review a take in
  one image.
- Its own tab, closed afterwards; dev overlays (Next.js, Vite, webpack,
  Agentation) hidden; `--hide "<css>"` for anything else, `--hide-floating`
  for small floating widgets.

Script the interaction in a steps file (`references/steps.md`). The steps
that make directing easy:

- `{ "mark": "toast", "target": {...} }` notes where something is, for a
  callout or for the camera to look at.
- `{ "camera": "wide" }` right after a click that opens a drawer, dialog or
  page, so the auto-camera pulls back to show it whole.
- `{ "waitFor": {...} }` instead of guessing how long a load takes.

Rules that matter:

- **Use `--slow 1` when real waiting time is the point** (a spinner that hangs
  for 8 seconds). The slowed clock doesn't slow the network, so a slowed
  capture makes slow loads look fast.
- **Warm the route first** on dev servers: the first request compiles, and
  that compile time would be in your clip. Take one throwaway `shot` first.
- **Recording "before" from another branch**: prefer a separate checkout on
  another port. When only one port can sign in (an auth provider with one
  registered callback), switch the same checkout: stop the server, check out
  the old commit, rebuild the workspace libraries it imports, clear the
  framework cache (`.next`), restart, and check a fresh screenshot before
  trusting it. Switch back the same way.
- `--duration` is a minimum: the clip also runs until the steps finish.
- Keep the Chrome window visible (not minimized); hidden tabs stop painting.
  The script retries if a take comes back empty.
- **Don't record while something heavy runs** (a render, a build): the take
  still saves but paints a third of the frames. `N painted frames` in the log
  should be near 60 per second of motion.
- **Mobile web**: `--mobile --width 390 --height 844 --scale 3`. For native
  iOS and Android apps use the `argent-screen-recording` skill, and for
  desktop apps a QuickTime or `screencapture -v` recording; any MP4 works as a
  clip (without an events file, write `moves` by hand).

### Scripting interactions in rich apps

- **Never add attributes to nodes inside a rich-text editor** (ProseMirror,
  Tiptap, Lexical, Slate): the editor redraws the node and a `data-demo`
  marker vanishes. Target editor content by selector.
- **Components that swap in on hover or focus** replace the node you were
  pointing at. Move over them first, then resolve targets.
- Selects that open a list need real pointer events: click the option by
  `text`, never `.click()` it in an eval.
- Set text selections through the editor's API in an eval, not with
  shift-arrow runs.
- An `eval` that throws prints `step N eval threw`; read it rather than
  retaking blind.

## 3. Review the takes

Look at every take, don't assume: `--sheet` writes one image per take.

Check: no dev overlays or debug UI, the cursor where expected, the page
finished loading, the action actually happened (a click that hit the wrong
element still "succeeds"), nothing personal or another customer's data on
screen. Retake rather than patch, but fix the events file by hand when only a
time or box is off.

### When the app's own motion looks wrong on camera

The capture shows the truth at 2x and a slowed clock, so it exposes motion
problems the eye forgives. **A white or empty frame where a panel should
slide in is almost always a main-thread stall in the app**: the panel mounts
its heavy content in the same frame as the animation. Measure before fixing:

```bash
ffmpeg -v error -ss 4.5 -t 2.5 -i clips/x.mp4 -vf "fps=60,crop=W:H:X:Y,scale=260:-1" fr/%03d.png
# count dark pixels per frame (PIL): a run of zeros is the blank
```

Then a `PerformanceObserver({ type: 'longtask' })` around the click, in a
visible tab, shows the stall. Fix it in the app (mount the shell first, render
the heavy body a frame later in `startTransition`), re-record and re-count.
An element that appears whole in one frame (a menu, a bubble) reads as abrupt
on video: give it a 150 ms fade and slight scale from its anchor.

## 4. Direct

`video.json` (starter: `template/src/video.json`; every option:
`template/src/types.ts`; the guide: `references/scenes.md`):

```json
{
  "width": 1920, "height": 1080, "fps": 60,
  "theme": { "background": "radial-gradient(120% 90% at 50% 0%, #f6f7fb 0%, #e7e9f1 100%)",
             "foreground": "#18181b", "accent": "#3355ff",
             "tagColors": { "Before": "#e5484d", "After": "#3355ff" },
             "logo": { "src": "brand/mark.svg", "height": 26, "opacity": 0.75 } },
  "transition": "zoom-blur", "transitionSec": 0.5,
  "transitions": ["focus-pull", null, "push-through", null, "focus-pull"],
  "scenes": [
    { "type": "title", "text": "Role-based Access, rebuilt", "subtitle": "ABC-123", "durationSec": 3.6 },
    { "type": "issue", "source": "Linear", "id": "ABC-123", "status": "Fixed in PR #123",
      "title": "Having trouble adding a new user to my team lead user type",
      "quote": "I'm unable to assign her as a team lead for Sales.",
      "reporter": "Reported by Sam · Sep 18", "durationSec": 8 },
    { "type": "clip", "src": "clips/before.mp4", "aspect": 1.6, "trimStartSec": 6.3,
      "playbackRate": 1.2, "durationSec": 15, "tag": "Before", "autoCamera": true,
      "captions": [{ "atSec": 0, "text": "The role editor never lists people who were removed" },
                   { "atSec": 6.9, "text": "Inviting them again is refused" }],
      "callouts": [{ "mark": "error-toast", "forSec": 2.6 }] },
    { "type": "clip", "src": "clips/after.mp4", "aspect": 1.6, "durationSec": 16,
      "tag": "After", "autoCamera": true, "caption": "Search finds them, and restore brings them back" },
    { "type": "list", "title": "Shipped in PR #123", "items": ["Find and restore removed teammates"], "durationSec": 6 }
  ]
}
```

`aspect` is the recording's shape; `auto-camera.mjs` sets it from each take,
so leave whatever the starter says. Then direct the camera from the takes and
check before every render (a second,
versus a ten-minute render that ends with a frozen last frame):

```bash
node scripts/auto-camera.mjs demo-video/src/video.json   # writes moves, resolves callout marks
node scripts/check-video.mjs demo-video/src/video.json   # trims, aspects, files, keys, reading speed
```

**Scene types**: `title`, `issue` (the report as a ticket card), `clip`,
`split` (before and after side by side), `image` (a still with drift), `list`
(changelog or end card).

**The auto-camera** pushes in about 1.8x as the cursor acts, follows each
action inside a shot, holds 2 s, pulls out at `"camera": "wide"` steps and
scrolls, and skips pushes that would wobble or twitch (details and options:
`references/scenes.md`). Check it in a draft; hand-tune a scene by deleting
its `autoCamera` and editing `moves`.

**Framing, per scene** (`frame`):

| `frame` | What it is | Use for |
|---|---|---|
| `flat` (default) | The recording in a rounded window; `moves` push in *inside* the window, like a screen-recording editor | Most scenes |
| `stage` | A tilted 3D product shot with camera moves | One or two hero moments; on every scene it tires the eye |
| `full` | Edge to edge, no window | Dense UI that needs every pixel |

**Transitions**, per gap (`transitions[i]` is the gap after scene `i`):

| Transition | Feel | Use between |
|---|---|---|
| `focus-pull` (1.5 s) | Calm, premium | A title card and the first or last scene |
| `push-through` (1.3 s) | Going deeper | Before and after: the reveal |
| `whip-pan` (0.9 s, `direction`) | Fast, sideways | Peer tour beats. Vary direction |
| `zoom-blur` (`transitionSec`) | The workhorse | Anything else |
| `fade` / `cut` | Soft / none | Splitting one recording into two beats |

**Titles** pick an `effect`: `soft-blur-in` (the opener), `word-push` (a
closing line) or `micro-scale-fade` (a chapter card). Give a title 3 s or more
when a focus-pull joins it.

**Captions**: one short sentence each, at most 42 characters a line, 15 to 17
characters a second (20 at most), 1.5 s minimum. `captions` gives a long clip
several in turn. They sit under the frame, never over the UI.

**Callouts**: a ring (or `spotlight`) around something small the caption
names; name a `mark` and the auto-camera places and times it, ending at the
next click.

**Speed**: `playbackRate` 1.1 to 1.25 tightens typing and loading without
looking fast-forwarded.

**Sound** (optional; Slack and PRs play muted, so captions carry the story):
a `music` bed that ducks under per-scene `voiceover` files. Narration options
are in `references/scenes.md`.

**Brand**: `theme.logo` pins a mark to a corner of every scene. Outline any
text in an SVG logo first (an SVG drawn as an image can't load web fonts).

### Learn from remocn before you polish

remocn is the source for transitions, text effects, backgrounds and shaders,
and its catalog changes, so read it rather than working from memory: load the
`remocn` skill if installed (or `npx skills add Remocn/remocn --yes`), read the
archetype recipe that matches the video (`product-demo`,
`feature-announcement`, `changelog`), and pick components from
`https://remocn.dev/llms-components.txt` (each row has use-for, avoid-for,
natural length and vibe), then open each component's `.md` page for its real
props. Match the vibe to the brand (`clean` or `premium` next to a real
screen), budget each Sequence at least the component's natural length, ease
out entrances, keep your own additions restrained: sentence case, one accent,
no glow halos or gradient text.

## 5. Render

**Quick (ffmpeg only)**, for a first look at the cut:

```bash
node scripts/assemble.mjs video.json --out demo.mp4 --clips ./public --scale 1.5
```

Flat frames, fades and cuts. Issue and list cards become titles, images
stills, timed captions their first; split scenes and camera moves need
Remotion.

**Polished (Remotion + remocn)**, for anything people will watch twice:

```bash
scripts/new-remotion.sh ./demo-video        # first run ~2 min (builds a cached base), then seconds
cp clips/* demo-video/public/clips/          # clips AND their .events.json
cp video.json demo-video/src/video.json
node scripts/auto-camera.mjs demo-video/src/video.json
scripts/render.sh ./demo-video draft        # checks video.json, half size, ~3 min per minute of video
scripts/render.sh ./demo-video final        # the 1080p master; then deliver.mjs (section 6)
```

`render.sh` runs the check first and uses half the cores (`--concurrency=N`
to change it); `final` renders
PNG frames in bt709 at CRF 16. Iterate on drafts; run `final` once, when the
cut is locked. To check a fix without another full draft, render the frames
that changed: `npx remotion still DemoVideo review/f.png --frame=<n> --scale=0.5`
(frame = seconds x fps). `npm run dev` opens Remotion Studio to scrub and
tweak `video.json` live.

## 6. Deliver

```bash
node scripts/deliver.mjs demo-video/out/demo.mp4 --spec demo-video/src/video.json --max-mb 10 [--gif 30:5]
```

Writes next to the video: `demo-pr.mp4` (1080p, two-pass to fit `--max-mb`
when needed), `demo.vtt` and `demo.srt` (from the scenes, on the real
timeline), `demo-chapters.txt`, `demo-poster.png` (the middle of the first
clip, or `--poster <sec>`), and a GIF excerpt with `--gif`. Then it scans the
master: a still run inside a clip scene usually means a trim ran past the end
of a recording; black frames, a take that lost its paint.

Pull a few frames (`ffmpeg -ss <t> -i demo.mp4 -frames:v 1 f.png`) and look:
captions readable, transitions clean, nothing cropped, the camera on what each
caption names.

Where it goes:

- **GitHub PR**: 10 MB on free plans, 100 MB on paid.
  `gh pr edit <n> --body-file body.md --attach ./demo-pr.mp4` (gh 2.99+)
  uploads files the body references by the same relative path.
- **Slack**: the master as is; it plays inline, muted.
- **Linear**: attach the MP4.
- **GIF**: only a short loop, for places that won't play video.

Give the person the paths, what each section shows, and anything you had to
approximate (a stand-in for a real person, a wait you sped up, a "before" you
couldn't re-record sharply).

## Anti-patterns

Zooms on every click or zooms that start late; bouncy motion on text-heavy
UI; an idle cursor parked over content; dead air (loading, hunting for a
control); fake-looking data; a story that needs sound; captions faster than
20 characters a second; exports without faststart; over 90 s for a PR.
(Sources in `references/craft.md`.)

## Gotchas learned the hard way

- Hidden tabs and closed panels often hold a twin of your target (the same
  text, no box). Targets resolve to the first *visible* match; if a click
  lands nowhere, check for an invisible twin first.
- An option further down a list is off-screen inside the list; targets are
  scrolled into view (`nearest`) before they're measured. Scroll the page
  itself with a `scroll` step, or the jump shows.
- `element.animate()` isn't slowed by the capture clock; anything injected
  that animates must use `requestAnimationFrame` and `performance.now()`.
- Nodes you add to the page can be removed when the framework hydrates the
  document; the cursor script re-attaches itself on every move.
- A floating-widget hider that matches on size will hide your cursor too
  unless it excludes it (the script does).
- ffmpeg builds without `drawtext` are common (Homebrew's default). Never rely
  on it; captions here are drawn by Chrome or Remotion.
- Remotion's bundler doesn't read tsconfig `paths`; the template's
  `remotion.config.ts` maps `@/` for the remocn components. Remotion renders
  JPEG frames by default; the template switches to PNG so UI text stays sharp.
- The overlay-hiding style re-adds itself if hydration removes it. If overlays
  reappear, check `document.getElementById('__cap_hide')` in the capture tab.
- Screencast frames can arrive out of order; the script sorts them.

## Author

Made by Hamzat Victor ([@Code-Victor](https://github.com/Code-Victor),
https://hamz.at). Source and updates: https://github.com/Code-Victor/skills
