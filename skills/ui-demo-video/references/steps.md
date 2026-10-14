# Capture steps

Steps say what the cursor does during a take. They normally sit inline in
`demo.json`, in the `steps` list of a take (`demo-json.md`):

```json
"takes": { "after": { "url": "/team", "steps": [ { "wait": 1.2 }, ... ] } }
```

The runner writes each take's list to `build/steps/<take>.json` and hands it
to `capture.mjs clip --steps`; you can also keep a list in a file of its own
and use `capture.mjs` directly. The steps run in order, starting when the page
starts loading. All times are in **seconds of page time** (what the viewer
sees), whatever `slow` is set to.

A step may combine keys; they run in this order: `camera`, `wait`,
`waitFor`, `redact`, `mark`, `move`, `click`, `type`, `key`, `scroll`, `eval`.

| Step | Example | Does |
|---|---|---|
| `wait` | `{ "wait": 2.5 }` | Pause. Let an intro animation or a load finish. |
| `waitFor` | `{ "waitFor": { "selector": "[role=dialog]" } }` | Block until a `selector` or exact `text` is on screen (`"state": "hidden"` for gone), up to `timeout` page seconds (default 8). Use it after anything that loads. Bounded in wall time, see below. A timeout fails the take. |
| `move` | `{ "move": { "x": 600, "y": 400 }, "dur": 0.8 }` | Glide the cursor there (ease in-out). `dur` defaults to 0.8. |
| `click` | `{ "click": true }` | Click where the cursor is. |
| `click` | `{ "click": { "text": "Save" }, "dur": 0.6 }` | Glide to a target, then click. `dur` defaults to 0.6. |
| `type` | `{ "type": "hello" }` | Type into the focused field at a human pace (about 14 characters a second, slightly uneven, the same on every take). `"cps": 22` for long strings such as emails; `"instant": true` inserts it all at once. Click the field first: with nothing focused the text goes nowhere and the take warns. |
| `key` | `{ "key": "Escape" }` | Press a key. |
| `scroll` | `{ "scroll": 600, "dur": 1 }` | Wheel-scroll by that many px over `dur` (default 0.8), at the cursor. |
| `eval` | `{ "eval": "document.body.dataset.x = 1" }` | Run JS in the page (awaits promises). If it throws, the take warns with the step number and carries on; `"fatal": true` makes it fail the take. |
| `mark` | `{ "mark": "error-toast", "target": { "selector": "[data-sonner-toast]" } }` | Record where something is, for a callout or for the auto-camera to look at. Doesn't move the cursor. Without `target` it uses the step's own `move` or `click` target. A mark right after a click or typing is that action's result: the camera moves to it after the action. A mark a callout uses is always framed; `"look": false` keeps the camera off a mark no callout uses (one that only times a caption by hand). |
| `camera` | `{ "camera": "wide", "wait": 1 }` | Tell `auto-camera.mjs` to pull back out here: a drawer, dialog or new page is about to fill the frame. Logged before the step's `wait`. Only `"wide"` exists. |
| `redact` | `{ "redact": "td.email" }` | Blur matching elements from here on. The take option `redact` blurs from the start. |

Options that go on any step:

| Option | Used by | Does |
|---|---|---|
| `dur` | `move`, `click`, `scroll` | Seconds the glide or scroll takes |
| `cps` | `type` | Characters a second |
| `instant` | `type` | Insert the text at once |
| `target` | `mark` | What to mark |
| `look` | `mark` | `false`: record the box without drawing the camera to it. Ignored when a callout uses the mark (a callout is always framed) |
| `fatal` | `eval` | Fail the take if the code throws |
| `actionTimeout` | `move`, `click`, `mark` | Seconds to wait for the target to be actionable, instead of the default |

A key that is not in these tables is an error when the file is validated, so
a typo such as `"wiat"` is caught before anything is recorded.

## When a step waits, and when it fails

Every step that points at a selector or text (`move`, `click`, `mark`) first
waits until the target is **actionable**: it exists, it is visible (it has a
size and is not `visibility: hidden`, and neither it nor anything above it is
fully transparent), and its box has not changed over two animation frames.
So a panel that slides in needs no padding `wait`: the click waits for it to
stop. When the target is already still, this costs nothing.

The wait is bounded in **wall time**: 5 seconds, or 2.5 seconds per unit of
slowdown when that is more (at most 10), and 5 seconds in a rehearsal.
`actionTimeout` sets it, in seconds, for one step.

A target that does not become actionable **fails the take**. The failure says
which of the four things was wrong: `not found`, `not visible` (it exists but
is hidden or fully transparent), `still moving`, or an invalid selector. It
never silently clicks somewhere else.

`waitFor` is bounded too. `timeout` is in page seconds, so under a 3x slowed
clock `"timeout": 8` can last 24 wall seconds, but never more than 30 (and
never more than 5 in a rehearsal). It counts a selector as on screen when it
matches an element with a size that is not `visibility: hidden` (a
transparent one still counts, unlike for `click`); `text` must be the exact
text of an element with no children.

## Targets

Anything `move`, `click` or `mark` accepts:

- `{ "x": 600, "y": 400 }`: CSS pixels in the viewport. The viewport is
  measured from the screen (a 14" MacBook on "More Space" gives 1800x1044),
  so prefer selectors and text: a fixed point lands somewhere else on another
  screen. Pin `width` and `height` on the take when a script must use
  coordinates.
- `{ "selector": "button.primary" }`: centre of the first match **that is on
  screen**. Hidden tabs and closed panels often hold a twin of the target with
  no box, or sitting at opacity 0; those are skipped.
- `{ "selector": "svg.logo", "at": [0.2, 0.8] }`: a point inside the box as
  fractions of its width and height. Values outside 0..1 point around it
  (`[1.8, 1.5]` is below-right), handy for approaching from a distance.
- `{ "text": "No connection" }`: the smallest visible button, link, heading,
  paragraph, cell or labelled element whose text is exactly this. Hidden and
  fully transparent elements are skipped, so a twin in a closed panel is
  never picked.

Targets are scrolled into view first (`nearest`: anything already visible
stays put), so an option further down a list is reached before it is
clicked. For the page itself, scroll smoothly with a `scroll` step first;
otherwise the jump shows.

Prefer stable selectors (`data-testid`, roles, `aria-label`) over class names
that change with the build. `capture.mjs scout` prints a ready target for
every control on a page (next section).

## Scouting a page

Read the page once before writing steps. `scout` loads it, lists what a
person could click or type into, and saves a screenshot:

```bash
node scripts/capture.mjs scout --url http://localhost:3000/team --out scout.png
```

```
viewport 1800x1044 at 2x: this screen, browser maximized (--width/--height to change)
Team  http://localhost:3000/team  viewport 1800x1044
role             visible text or name                     step target (paste into a step)                [x,y wxh]
input:text       "Search people"                          {"selector":"input[aria-label='Search people']"} [48,128 147x22]
button           "Invite teammate"                        {"text":"Invite teammate"}                     [199,128 111x22]
link             "Billing"                                {"text":"Billing"}                             [315,128 43x19]
saved /path/scout.png (3 interactive elements, wall 0.8s)
```

Paste the target column into a step. The list holds what is really on screen
(a closed drawer or a transparent element is left out), top to bottom, at most
80 rows with a count of the rest; a disabled control is marked
`(disabled)`. Read the screenshot too: it is the state the take will start
from.

To see what a click reveals, give `scout` the steps that get there. They run
first, as in a rehearsal, and the list is of the page afterwards:

```bash
echo '[{ "click": { "text": "Invite teammate" } }]' > partial.json
node scripts/capture.mjs scout --url http://localhost:3000/team --steps partial.json
```

```
input:text       "Search people"      {"selector":"input[aria-label='Search people']"} [48,128 147x22]
button           "Invite teammate"    {"text":"Invite teammate"}                       [199,128 111x22]
link             "Billing"            {"text":"Billing"}                               [315,128 43x19]
input:text       "Email address"      {"selector":"input[aria-label='Email address']"} [69,190 147x22]
button           "Send invite"        {"text":"Send invite"}                           [216,190 82x22]
```

Without `--out` the screenshot goes to the system temp folder and its path
is printed on the last line. `scout` opens its own background tab, like every
`capture.mjs` run; nothing appears on screen.

## Rehearsing

A rehearsal runs the steps at full speed without recording, and stops at the
first target that cannot be acted on:

```bash
node scripts/capture.mjs clip --url http://localhost:3000/team --steps steps.json --dry-run
```

```
dry run OK: 4 steps ran and every target resolved (0.5s)
```

`demo.mjs` does this for you before it records. A miss looks like this
(the text has a typo):

```
step 0: {"click":{"text":"Invite teamate"}}
  not found: no element for text "Invite teamate" (after 5.0 s)
  closest visible elements:
    button         "Invite teammate"                  {"text":"Invite teammate"}  [199, 128, 111, 22]
  screenshot: /path/capture-miss.png
FAILED: step 0 failed: not found: no element for text "Invite teamate" (after 5.0 s)
```

It names the step, says which of the four things was wrong, lists the closest
visible elements with ready targets, and saves a screenshot of that moment
(in `build/miss/<take>/` when the runner rehearsed; next to the clip as
`<clip>.miss.png` when a recording failed). A rehearsal really clicks, so
see "Rehearse" in `demo-json.md` for takes that change data. It cannot tell
whether the click hit the element you meant: check the contact sheet.

## Making it look human

- Start the cursor off to one side (it begins near the bottom-right) and
  approach the subject in two or three moves, not one straight line.
- 0.6 to 0.9 s per move reads as deliberate; under 0.4 looks robotic.
- Hover for a beat before clicking (`wait` 0.2), and leave 1 to 1.5 s after a
  click for the result to land before moving on.
- End by moving the cursor away so the final frame is clean.
- Selects that open a list (Base UI, Radix) need real pointer events: click
  the option by `text`; an `eval` that calls `.click()` on it does nothing.

## Example: a fix, start to finish

This list is the `steps` of one take:

```json
[
  { "wait": 2.4 },
  { "click": { "selector": "input[aria-label='Search people']" }, "dur": 0.9 },
  { "type": "jordan" },
  { "wait": 1.1 },
  { "mark": "removed-note", "target": { "text": "Jordan Lee was removed from your team." } },
  { "click": { "text": "Show removed people" }, "dur": 0.8 },
  { "wait": 1.1 },
  { "click": { "selector": "[aria-label='Actions for Jordan Lee']" }, "dur": 0.9 },
  { "click": { "text": "Restore to team" }, "dur": 0.5 },
  { "camera": "wide", "waitFor": { "selector": "[aria-label='Role for Jordan Lee']" } },
  { "click": { "selector": "[aria-label='Role for Jordan Lee']" }, "dur": 0.9 },
  { "click": { "text": "Team Leads" }, "dur": 0.7 },
  { "camera": "wide", "wait": 0.9 },
  { "click": { "text": "Sales" }, "dur": 0.6 },
  { "click": { "text": "Assign role" }, "dur": 0.6 },
  { "wait": 2.4 },
  { "move": { "x": 1180, "y": 700 }, "dur": 0.9 }
]
```

## Example: step through states in a preview page

```json
[
  { "wait": 2.6 }, { "click": { "text": "No connection" }, "dur": 0.5 },
  { "wait": 2.6 }, { "click": { "text": "Out of date" }, "dur": 0.5 },
  { "wait": 2.6 }, { "click": { "text": "Signed out" }, "dur": 0.5 }
]
```

Skip the cursor (`"noCursor": true` on the take) and use `eval` clicks
instead when the switcher is dev-only chrome the viewer shouldn't notice.

## The events file

Every clip writes `<clip>.mp4.events.json` next to it (`clips/after.mp4` gets
`clips/after.mp4.events.json`):

```json
{ "width": 1800, "height": 1044, "duration": 9.474, "fps": 60, "slow": 2,
  "distinctFps": 75.3, "frameCoverage": 52.7,
  "events": [
    { "type": "click", "t": 1.763, "x": 0.9482, "y": 0.0448, "box": [0.9142, 0.0259, 0.068, 0.0379] },
    { "type": "wide", "t": 1.871 },
    { "type": "type-start", "text": "Jordan Lee", "t": 3.24, "box": [0.7822, 0.0954, 0.2022, 0.0398] },
    { "type": "type-end", "t": 3.965, "box": [0.7822, 0.0954, 0.2022, 0.0398] },
    { "type": "mark", "label": "toast", "look": false, "t": 6.863, "box": [0.4381, 0.9372, 0.1238, 0.0418] }
  ],
  "cursor": [
    { "t": 0.797, "x": 0.9, "y": 0.92, "shape": "arrow", "pressed": false }
  ] }
```

| Field | Meaning |
|---|---|
| `width`, `height` | The viewport in CSS pixels. Their ratio is the clip's `aspect` |
| `duration` | Length of the clip in seconds |
| `fps` | Frame rate of the clip |
| `slow` | The clock slowdown the take was recorded at (1 = real time) |
| `distinctFps` | New screencast frames a second while the cursor was moving. Left out when the take had no cursor motion to measure |
| `frameCoverage` | How many of the 60 output frame slots a second held a new frame during that motion |
| `heldFramePct`, `longestHeldRun` | During cursor glides, the share of output frames that repeat the one before, and the longest run of such frames. A high number means the cursor looks jerky. Left out when there was too little motion to measure |
| `events` | `click` (with `x`, `y`, `box`), `type-start` (with the `text`) and `type-end`, `key`, `scroll` (`dy`), `mark` (`label`, `box`, and `look: false` if set) and `wide` |
| `cursor` | The drawn cursor's path, about 60 samples a second: `shape` is `arrow`, `hand` or `text` |

Times are video seconds; positions and boxes are fractions of the frame, so
the file still lines up after any resize. `auto-camera.mjs` reads it from
next to the clip; the runner keeps both in `clips/`, so nothing is copied.
It is plain data: if a take logged a mark late or a box wrong, fix the number
rather than retaking. Without the file, a scene cannot use `autoCamera`.
