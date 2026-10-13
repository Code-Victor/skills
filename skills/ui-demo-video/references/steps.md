# Capture steps

`capture.mjs clip --steps steps.json` runs these in order, starting when the
page starts loading. All times are in **seconds of page time** (what the
viewer sees), whatever `--slow` is set to.

A step may combine keys; they run in this order: `camera`, `wait`,
`waitFor`, `redact`, `mark`, `move`, `click`, `type`, `key`, `scroll`, `eval`.

| Step | Example | Does |
|---|---|---|
| `wait` | `{ "wait": 2.5 }` | Pause. Let an intro animation or a load finish. |
| `waitFor` | `{ "waitFor": { "selector": "[role=dialog]" } }` | Block until a selector or `text` is on screen (`"state": "hidden"` for gone), up to `timeout` (default 8) seconds. Use it after anything that loads. |
| `move` | `{ "move": { "x": 600, "y": 400 }, "dur": 0.8 }` | Glide the cursor there (ease in-out). `dur` defaults to 0.8. |
| `click` | `{ "click": true }` | Click where the cursor is. |
| `click` | `{ "click": { "text": "Save" }, "dur": 0.6 }` | Glide to a target, then click. |
| `type` | `{ "type": "hello" }` | Type into the focused field at a human pace (about 14 characters a second, slightly uneven, the same on every take). `"cps": 22` for long strings such as emails; `"instant": true` pastes it all at once. |
| `key` | `{ "key": "Escape" }` | Press a key. |
| `scroll` | `{ "scroll": 600, "dur": 1 }` | Wheel-scroll by that many px over `dur`, at the cursor. |
| `eval` | `{ "eval": "document.body.dataset.x = 1" }` | Run JS in the page (awaits promises). |
| `mark` | `{ "mark": "error-toast", "target": { "selector": "[data-sonner-toast]" } }` | Record where something is, for a callout or for the auto-camera to look at. Doesn't move the cursor. `"look": false` keeps the camera where it is (a toast while the shot stays wide). |
| `camera` | `{ "camera": "wide", "wait": 1 }` | Tell `auto-camera.mjs` to pull back out here: a drawer, dialog or new page is about to fill the frame. Logged before the step's `wait`. |
| `redact` | `{ "redact": "td.email" }` | Blur matching elements from here on. `--redact "<css>"` blurs from the start. |

## Targets

Anything `move`, `click` or `mark` accepts:

- `{ "x": 600, "y": 400 }`: CSS pixels in the viewport. The viewport is
  measured from the screen (a 14" MacBook on "More Space" gives 1800x1044),
  so prefer selectors and text: a fixed point lands somewhere else on another
  screen. Pin `--width`/`--height` when a script must use coordinates.
- `{ "selector": "button.primary" }`: centre of the first match **that is on
  screen**. Hidden tabs and closed panels often hold a twin of the target with
  no box; those are skipped.
- `{ "selector": "svg.logo", "at": [0.2, 0.8] }`: a point inside the box as
  fractions of its width and height. Values outside 0..1 point around it
  (`[1.8, 1.5]` is below-right), handy for approaching from a distance.
- `{ "text": "No connection" }`: the smallest visible button, link, heading,
  paragraph, cell or labelled element whose text is exactly this.

Targets are scrolled into view first (`nearest`: anything already visible
stays put), so an option further down a list is reached before it is
clicked. For the page itself, scroll smoothly with a `scroll` step first;
otherwise the jump shows.

Prefer stable selectors (`data-testid`, roles, `aria-label`) over class names
that change with the build. `agent-browser snapshot -i` lists the accessible
names to target.

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

Skip the cursor (`--no-cursor`) and use `eval` clicks instead when the
switcher is dev-only chrome the viewer shouldn't notice.

## The events file

Every clip writes `<clip>.events.json` next to it:

```json
{ "width": 1440, "height": 900, "duration": 22.7, "events": [
  { "type": "click", "t": 4.06, "x": 0.278, "y": 0.273, "box": [0.194, 0.256, 0.167, 0.036] },
  { "type": "type-start", "t": 4.15, "text": "jordan", "box": [...] },
  { "type": "mark", "label": "removed-note", "t": 5.7, "box": [...] },
  { "type": "wide", "t": 10.67 }
] }
```

Times are video seconds; positions and boxes are fractions of the frame.
Copy it along with the clip (`cp clips/* public/clips/`); `auto-camera.mjs`
reads it from there. It is plain data: if a take logged a mark late or a box
wrong, fix the number rather than retaking.
