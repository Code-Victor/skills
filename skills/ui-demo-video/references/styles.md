# Visual styles

A style is the look of the finished video: the ground, the window around the
recording, the type, the captions, the cards, the callouts, how things move
and how scenes join. The scenes, takes and camera are the same in every
style; only how they are drawn changes. There are five, and `studio` is the
default.

Styles belong to the default renderer (`scripts/compose.mjs`). The Remotion
renderer ignores them and always draws the studio look.

`node scripts/compose.mjs --list-styles` prints each style's name, a line
about it and a line about what it suits (`--json` for data).

## The five at a glance

| Style | The idea | Right choice when | Cost |
|---|---|---|---|
| `studio` | The original: a soft light gradient, a white window, dark pill captions | You are unsure, or the video goes into Slack, a PR or docs. Your own `theme` colours apply | The safe default, so the least distinctive |
| `midnight` | Depth and light: a near-black stage with a slow pool of cool grey light, glass captions | Launches, dark-mode products, anything that should feel premium | A light app is a bright slab on a dark stage; pacing is slower (0.7 s transitions) |
| `editorial` | Type and stillness: warm paper, ink, hairline rules, a serif, margin notes | Changelogs, weekly updates, writing-led explanations | The least showy. The recording is smaller (at most 74% of the width) to leave room for the margin note |
| `terminal` | A terminal session about the change: mono type, typed text, stepped motion | Developer tools, pull-request demos for engineers | Reads as cold for a consumer product. Typed text needs time to finish |
| `sketch` | A photo pinned to paper, annotated by hand, moving in held poses | Bug-fix before and afters, where circling the bug by hand says it fastest | Playful, so wrong for a formal audience. Typed captions are slow; very long ones are cut short |

All five render at about 140 to 190 frames a second on an Apple M2 Pro, so a
minute of video takes under half a minute. No style records anything
different: the clips are the same files.

## How a style treats your colours

- `studio` applies everything in `theme`: `background`, `foreground`,
  `accent`, `tagColors` and `logo`.
- Any other style **owns the ground and the text colour**. `theme.background`
  and `theme.foreground` are ignored, with a warning (the check and the
  render both say so). To change them use overrides (below).
- `theme.accent` and `theme.tagColors` still apply, but each style adapts
  them to its ground, so one accent and a few tag colours still hold together.
  The details are per style below.
- `theme.logo` is used as it is; some styles recolour it (below).
- A `transition` or `transitionSec` you write is honoured. When you write none,
  the style's own default applies, and its length differs slightly (0.5 s for
  `studio`, `terminal` and `sketch`, 0.6 s for `editorial`, 0.7 s for
  `midnight`), so the video's length changes by a fraction of a second
  between styles.

## studio

What the viewer sees: a pale gradient ground, the recording in a white
rounded window with a soft shadow, a dark pill caption under the window, Inter
type, a ticket card for the issue, a check list at the end. Titles blur in.
The camera glides on an ease curve. The default transition is `zoom-blur`
(0.5 s). It is the look the skill had before styles existed, drawn the same
way.

Colours: `theme.background`, `foreground`, `accent` and `tagColors` all
apply. Defaults are a blue accent, red for `Before` and blue for `After`.

## midnight

What the viewer sees: a near-black ground with one slow pool of cool grey
light behind the window, a little film grain and a soft vignette. The window
is dark-filled with a gradient hairline and a faint cool glow, and drifts in
about 3% over each scene so no frame is still. Captions are dark glass under
the window with a small mono tag (`After` is a filled chip, other tags are
outlined). Titles are large, tight Geist type that resolves out of blur, with
a quiet mono subtitle. The issue card is dark glass; the end list is hairline
rows with ring ticks. The camera arrives without overshoot and blurs slightly
as it moves. Callouts are a thicker ring with a stronger dim.

Colours: one pale-blue accent. A `theme.accent` is pulled partway toward it
and lifted until it reads. A tag called `After` takes the accent; every other
tag is a neutral grey that keeps only a trace of the colour you gave it. A
dark logo is turned into a quiet monochrome light one.

Transitions: the default is `zoom-blur`, 0.7 s. The named ones are toned down
(smaller scale changes, less blur, no brightening). `whip-pan` still slides
the bright window across the dark margins, so use it sparingly here.

Behaves differently: the ground is a shader, so the ground colour is not
`palette.background`; to change it you override `canvas` tokens (see the
tokens README).

## editorial

What the viewer sees: warm paper with a fine static grain and no gradients,
ink-coloured type, hairline rules instead of shadows, one vermilion accent.
Newsreader (a serif, with its italic) for text and DM Mono for small labels.
Every scene except the title has a running header: the video's title in
italics on the left, a folio such as `03 / 06` on the right, over a hairline.

- **Window.** Hung on the left margin, at most 74% of the width, with a thin
  ink edge and almost square corners.
- **Captions are margin notes.** On a clip or image scene the caption sits in
  a narrow column to the right of the recording, under a rule, with the tag in
  mono above the text. The type steps down as the caption gets longer, so a
  long caption gets smaller type and more lines rather than a clipped one. On
  a `split` scene it sits under the pair; on a `frame: "full"` clip it gets a
  small paper sheet of its own.
- **Title.** Left-aligned, large, each line rising out of its own band (a mask
  reveal, about 0.7 s). The subtitle sits above it in mono, over a rule.
- **Issue.** No card: a typographic block between two rules, the title large,
  the reporter's words in italics with a vermilion bar, the source, ID and
  status in the margin column.
- **List.** Numbered `01`, `02`, hairline rows; a subtitle becomes a margin
  note.
- **Callouts.** A plain ink ring with no fill and a paper label with an ink edge.
- **Emphasis.** `*word*` is italic, in the accent in titles and captions and in
  ink in cards and lists. Straight quotes become typographer's quotes.

Colours: the accent you give is pulled toward ink and deepened until it reads
on paper; tag colours are inked the same way. Defaults: a brick red for
`Before`, a green for `After`, ink for any other tag.

Transitions: the default is `page-slide` (0.6 s, the old page lifts a few
percent and fades while the new one settles up from below); it only exists in
this style. The named transitions are toned down to small scale changes and
very little blur.

## terminal

What the viewer sees: a near-black zinc ground with a faint static dot grid
and a vignette, and one monospace family (JetBrains Mono) for everything. The
window has a slim title bar with three dots and a path such as `~/app before`,
the tag shown as a lower-case word (red for `Before`, green for `After`). Text
is **typed**, not faded, and overlays move in steps, 30 poses a second, with no
easing or blur.

- **Captions** start with a green `>` prompt, are left-aligned under the
  window and type at 50 characters a second behind a block caret, after a
  0.4 s delay. They wrap inside 72% of the width.
- **Title** types at 30 characters a second (the whole entrance never takes
  more than 1.4 s), with the subtitle as a `# comment` line above.
- **Issue** is a terminal pane: `> issue show ACME-101` and then key and value
  rows (source, status, title), the quote with a red bar, the reporter.
- **List** prints one line at a time with green checks, then a prompt types a
  muted summary such as `# 3 changes`.
- **Split** gives both windows the same slim bar.
- **Callouts** are four corner brackets that draw out in three steps, with a
  green-edged label, instead of a ring.

Colours: one soft green accent, always. `theme.accent` is ignored. Tags follow
a fixed rule whatever colours you give: `Before` red, `After` the green accent,
everything else muted grey. A logo is turned light and monochrome.

Transitions are discrete and **named ones are reinterpreted on purpose**: the
default and `zoom-blur` are a caret wipe (a bar sweeps across and the new scene
appears behind it, snapping to a column grid), `focus-pull` repaints the frame
line by line, `push-through` scrolls it a line at a time, `whip-pan` is a hard
slide with no blur. `fade` is stepped too. All run 0.5 s.

Behaves differently: typed text needs time to finish. A caption of 42
characters is complete after about 0.8 s plus the 0.4 s delay, so give a
caption scene a little longer than in other styles, and avoid long captions
on short scenes.

## sketch

What the viewer sees: a cream paper board with a paper grain. The recording is
a photo print pinned to it, with a taller strip underneath, and it is the one
smooth thing in the frame. Everything else is drawn by hand in Caveat
handwriting and moves in held poses, 10 a second, with a seeded wobble: the
print shakes by a pixel or two and tilts about a degree, and the same seed
gives the same video every time.

- **Captions** are written by hand into the strip of the print, with a
  highlighter slab behind the tag, at 16 characters a second. A caption that
  does not fit on one line shrinks a little, then wraps to two lines; one
  longer than that is shortened with an ellipsis. On a full-bleed clip the
  caption becomes a taped note.
- **Title** is hand-written, then an ink underline draws on and the subtitle
  pops in as a sticker.
- **Issue** is a note on slightly tilted paper, with the status drawn by hand.
- **List** is a hand-drawn check list whose ticks are drawn stroke by stroke.
- **Split** shows the two prints tilted opposite ways, each tag written under
  its print.
- **Callouts** are a scribbled circle drawn on in ten poses, with a paper label
  and a long arrow that points at it.

Colours: red pencil for marks and a deep olive for ticks. Tags are coloured by
their **name**, not by the colour you gave: `Before`, `Bug`, `Broken`, `Old`,
`Problem`, `Issue`, `Wrong` or `Regression` are red; `After`, `Fix`, `Fixed`,
`New`, `Now`, `Done` or `Result` are olive; anything else is ink. A
`theme.accent` is lifted until it reads on the note paper.

Transitions: the default is `paper-swap` (0.5 s): the old scene is nudged and
turned a fraction of a degree for two poses, hard cuts, and the new one settles
into place. `zoom-blur`, `focus-pull`, `push-through` and `whip-pan` all
become variants of it (they differ in how far the paper moves), and `fade` is
a dissolve in three held steps.

Behaves differently: it is the slowest style to render (14 seconds against 9
to 11 for the others on the same 18.7 second demo). Keep captions to one
short sentence.

## Choosing a style

Name it in `demo.json`, or in any `video.json`:

```json
{ "name": "invite-fix", "style": "editorial", "url": "http://localhost:3000", "...": "..." }
```

- `"style": "<name>"` picks a style. No `style` means `studio`.
- `node scripts/demo.mjs demo.json --style terminal` renders in a style for
  one run without editing the file. The flag wins over the file.
- `node scripts/demo.mjs init <dir> --style editorial` writes a starter with
  the key already in it.
- An unknown name stops the run at the first stage and lists the valid names.

Changing the style needs no new recording: it is part of the cut. Run the
same command again and only the render and the delivery redo.

## Comparing styles on your own demo

When you cannot choose, render them all and let the person pick:

```bash
node scripts/demo.mjs ~/Downloads/<name>-demo/demo.json --styles all
node scripts/demo.mjs ~/Downloads/<name>-demo/demo.json --styles midnight,editorial
```

`--styles` takes a list of two or more names, or `all`. It runs validation,
the camera and the check once, so **nothing is recorded twice** (it works with
`--only render` on a finished build), then renders the demo once per style,
one after another. It does no delivery (no PR copy, captions or poster).
Measured on an 18.7 second demo with three clips: five styles took 54 seconds
of rendering in all, between 9 and 14 seconds each. Allow roughly one normal
render per style; the first run also downloads the fonts (below).

What it writes, in the demo folder:

| File | What it is |
|---|---|
| `out/styles/<style>.mp4` | The full video in that style |
| `out/<name>-styles.png` | A comparison sheet: one row per style, one column per moment (four to six: the title, the first card, a wide
clip, a zoomed clip, a transition, the end card, as far as your video has them),
the same moments in every row |
| `out/<name>-styles.html` | A local picker page |
| `build/styles/<style>.video.json` | The resolved spec each style rendered from (its transition lengths and camera differ slightly) |

Look at the sheet first. To compare in motion, open
`out/<name>-styles.html` in a browser (the run does not open it for you). It
plays the renders at full size. Number keys `1` to `9` and the left and right
arrows flip between the styles at the same playback position; space plays and
pauses, comma and full stop step one frame back and forward, `Home` goes to the
start and a click on the bar seeks. Because each style has its own transition
lengths, the same second can be a slightly different moment.

To keep the chosen one, render it for real: run the same command with
`--style <name>`, or put `"style": "<name>"` in `demo.json` so every later run
uses it. The files under `out/styles/` are for choosing only; delete them
when done.

## Changing a token for one video

Instead of the name, give an object with the style and the tokens to change:

```json
"style": { "preset": "midnight", "overrides": { "caption": { "size": 0.022 } } }
```

Overrides merge into the style token by token. Three small ones, each
checked by rendering a still:

| Want | Override |
|---|---|
| Bigger captions in `midnight` (the default is 0.0158 of the width) | `{ "caption": { "size": 0.022 } }` |
| No slow push-in on the window in `midnight` | `{ "window": { "drift": null } }` |
| No dot grid in `terminal` | `{ "canvas": { "background": { "opacity": 0 } } }` |

Name a group that does not exist (a typo such as `postt`) and the check warns
and suggests the nearest. To change a style's ground or text colour, override
`palette.background` and `palette.foreground` (for a style whose ground is a
shader, `midnight` and `terminal`, the ground lives in the `canvas` tokens).
The complete token list, and how to write a new style, is in
`scripts/compositor/styles/README.md`.

## Emphasis

`*word*` in a title, a caption, a list item or a line of the issue card marks
one accented word. Each style decides how: the accent colour, or italic in
`editorial`. A real asterisk is `\*`. A lone `*` with no partner stays as
typed. The caption files (`.vtt`, `.srt`), the chapters and the reading-speed
check all ignore the markers.

```json
{ "type": "title", "text": "Invites now *confirm*", "durationSec": 3.4 }
```

## Fonts

Each style names its Google Fonts families (Inter, Geist and Geist Mono,
Newsreader and DM Mono, JetBrains Mono, Caveat). A family is downloaded once,
the latin subset, into the cache (`$XDG_CACHE_HOME/ui-demo-video/fonts`, or
`~/.cache/ui-demo-video/fonts`) and reused after that. Offline, one short
attempt is made and remembered for ten minutes, the text falls back to a
system font in the same spirit (a serif for `editorial`, a monospace for
`terminal`, a handwriting face for `sketch`) and the render warns. The first
render in a style therefore needs the network once.

## Limits

- The Remotion renderer ignores `style` and draws the studio look.
- `frame: "stage"` still falls back to a flat window, with a warning, in every
  style.
- A style does not change what is recorded, the scene types or the camera
  logic, only how they are drawn. The auto-camera runs once per style, so its
  moves can differ by a fraction of a second.
- `midnight`, `editorial`, `terminal` and `sketch` ignore `theme.background`
  and `theme.foreground`.
