# Visual styles

A style is the look of the finished video: the ground, the window around the
recording, the type, the captions, the cards, the callouts, how things move
and how scenes join. The scenes, takes and camera moves are the same in every
style; only how they are drawn changes (including how a zoom frames the
recording: see "How the camera frames the recording"). There are five, and
`studio` is the default.

Styles belong to the default renderer (`scripts/compose.mjs`). The Remotion
renderer ignores them and always draws the studio look.

`node scripts/compose.mjs --list-styles` prints each style's name, a line
about it and a line about what it suits (`--json` for data).

## The five at a glance

| Style | The idea | Right choice when | Cost |
|---|---|---|---|
| `studio` | A soft light gradient, a big white window that a zoom grows until the recording fills the frame, dark pill captions | You are unsure, or the video goes into Slack, a PR or docs. Your own `theme` colours apply | The safe default, so the least distinctive |
| `midnight` | Depth and light: a near-black stage with a slow pool of graphite light, glass captions | Launches, dark-mode products, anything that should feel premium | A light app is a bright slab on a dark stage; pacing is slower (0.7 s transitions) |
| `editorial` | Type and stillness: warm paper, ink, hairline rules, a serif, margin notes | Changelogs, weekly updates, writing-led explanations | The least showy. The recording is smaller (at most 74% of the width) to leave room for the margin note |
| `terminal` | A terminal session about the change: mono type, typed text, stepped motion | Developer tools, pull-request demos for engineers | Reads as cold for a consumer product. Typed text needs time to finish |
| `sketch` | A photo pinned to paper, annotated by hand, moving in held poses | Bug-fix before and afters, where circling the bug by hand says it fastest | Playful, so wrong for a formal audience. Captions are written by hand, and one longer than two lines is cut short. The slowest to render |

All five render at about 140 to 190 frames a second on an Apple M2 Pro, so a
minute of video takes under half a minute (`sketch` adds a few seconds before
the first frame). No style records anything different: the clips are the
same files.

## How a style treats your colours

- `studio` applies everything in `theme`: `background`, `foreground`,
  `accent`, `tagColors` and `logo`.
- Any other style **owns the ground and the text colour**. `theme.background`
  and `theme.foreground` are ignored, with a warning (the check and the
  render both say so). To change them use overrides (below).
- `theme.accent` and `theme.tagColors` still apply, but each style adapts
  them to its ground, so one accent and a few tag colours still hold together.
  The details are per style below.
- `theme.logo` is used as it is, except in `midnight` and `terminal`, which
  invert it into a light monochrome mark. That suits a dark logo; a white one
  would turn dark, so for a logo that is already light add
  `"logo": { "filter": null }` to the overrides (below).
- A `transition` or `transitionSec` you write is honoured. When you write none,
  the style's own default applies, and its length differs slightly (0.5 s for
  `studio`, `terminal` and `sketch`, 0.6 s for `editorial`, 0.7 s for
  `midnight`), so the video's length changes by a fraction of a second
  between styles.

## How the camera frames the recording

`studio` and `midnight` **fill**. At rest the recording sits in a big window
(84% of the height: a 16:10 recording is about 76% of the width, a 16:9 one
84%) with a slim strip under it for one caption line. When the camera zooms,
the whole window grows over the background, shadow and corners with it, and
slides toward what the camera looks at, until the recording fills the frame:
from about 1.2x (16:9) or 1.3x (16:10) no background shows, and the corners
square off as the window reaches the edge. This is how Cap and Screen Studio
zoom, and how most launch videos look: full-bleed most of the time, the framed
wide shot brief. The logo fades out as the window grows, so it never sits on
the recording.

`editorial`, `terminal` and `sketch` frame **inside**: the window stays where
it is and the zoom crops inside it, because the page, the terminal window and
the pinned print are their look.

To change it for one video, put `"camera": "inside"` (or `"fill"`) at the top
of the spec; for one clip or image scene, put it on the scene. A
`frame: "full"` clip, a split and the cards never change.

**Captions over the recording.** Once a zoom fills the frame, the caption sits
over the recording. Both fill styles set captions large (34 px in studio,
36 px in midnight) on a plate that holds 4.5:1 or better over a white page and
a black one, for the text and for the tag colours (studio's dark pill at 92%,
midnight's dark glass; a tag colour that would fall short on the plate is
lifted, `caption.tagContrast`). A style forced to fill whose captions have no
plate gets a soft scrim behind them while the recording covers them. Where the
caption goes is decided once per caption, before the render: if its spot in
the strip would sit on or within 6% of the action (a callout that is showing,
where the camera looks while zoomed in, a click or typing in the take) for
more than 0.2 s, it sits at the top title-safe line instead, for its whole
time on screen. The same goes for a caption on a `frame: "full"` clip in any
style. The render prints the captions it moved.

**The earlier studio framing** (the zoom inside an 80% window, 26 px captions,
tag colours as given) is one override; it renders frame for frame what studio
drew before fill existed:

```json
"style": { "preset": "studio", "overrides": {
  "camera": { "mode": "inside" },
  "window": { "maxWidth": 0.9, "maxHeight": 0.8, "top": 0.055, "radius": 0.008 },
  "caption": { "size": 0.0135, "tagContrast": null } } }
```

## studio

What the viewer sees: a pale gradient ground, the recording in a big white
rounded window with a soft shadow, a dark pill caption in the strip under the
window (over the recording once a zoom fills the frame), Inter type, a ticket
card for the issue, a check list at the end. Titles blur in; a long title
wraps inside 80% of the width in balanced lines, never splitting a word, and
pushes its subtitle down (`word-push` keeps one line). A zoom grows the
window until the recording fills the frame, gliding on an ease curve. The
default transition is `zoom-blur` (0.5 s). Callouts are drawn by hand in the
accent and labelled in handwriting (Caveat) on a small white plate, with an
arrow to the mark.

Colours: `theme.background`, `foreground`, `accent` and `tagColors` all
apply. Defaults are a blue accent, red for `Before` and blue for `After`.
Faded text (subtitles, the issue's source and reporter lines) stays at 66%
opacity or more so it holds 4.5:1, and the issue's status text is darkened
from the accent until it reads 4.5:1 on its pill.

## midnight

What the viewer sees: a near-black ground with one slow pool of graphite
light behind the window (a cool grey on the hue of the style's pale-blue
accent), a little film grain and a soft vignette. The window is dark-filled
with a gradient hairline and a faint glow in the accent's hue, and drifts in
about 3% over each scene so no frame is still; a zoom grows it until the
recording fills the frame, as in `studio`. Captions are dark glass in the
strip under the window (over the recording once a zoom fills the frame) with
a small mono tag (`After` is a filled chip, other tags are outlined). Titles
are large, tight Geist type that resolves out of blur, with a quiet mono
subtitle. The issue card is dark glass; the end list is hairline rows with
ring ticks. The camera arrives without overshoot and blurs slightly as it
moves. Callouts are drawn by hand in the pale accent with a thin dark edge
under the line, so it holds on a white page too, and labelled in handwriting
on the caption's dark glass. `ring` and `spotlight` are a thicker ring with a
stronger dim, labelled on a chip filled with the accent, so a frame carries
one accent.

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
- **Callouts.** The editor's vermilion pencil, a finer line, and a margin note
  in the serif's italic on a slip of the page's paper with a hairline edge, like
  a proofreader's mark. `ring` is a plain ink ring with no fill and a paper label
  with an ink edge.
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
the tag shown as a lower-case word (red for `Before`, green for `After`).
Titles, captions and the list's closing line are **typed**; the issue pane,
its rows, the list heading and the list items fade in over about five steps
(a sixth of a second). Overlays move in steps, 30 poses a second, with no
blur; the recording and the camera stay smooth.

- **Captions** start with a green `>` prompt, are left-aligned under the
  window and type at 50 characters a second behind a block caret, after a
  0.4 s delay. They wrap inside 64% of the width (no wider than a 16:10
  window) and type line by line; the band under the window has room for two
  lines. On a `frame: "full"` clip, which has no title bar, the caption
  starts with the tag word and sits on a dark scrim that rises from the
  bottom of the recording.
- **Title** types at 30 characters a second (the whole entrance never takes
  more than 1.4 s), with the subtitle as a `# comment` line above. A long
  title wraps, the caret moving from line to line and resting after the last
  character.
- **Issue** is a terminal pane: `> issue show ACME-101` and then key and value
  rows (source, status, title), the quote with a red bar, the reporter.
- **List** prints one line at a time with green checks, then a prompt types a
  muted summary such as `# 3 changes`, where the caret stays.
- **Split** gives each window the same slim bar as a clip, with its own tag in
  it (`before`, `after`), and the caption under the pair.
- **Callouts** are drawn in the green accent with a dark edge under the line,
  stepped with everything else, and labelled with a typed mono comment
  (`# Export started`) on a dark panel. `"style": "bracket"` keeps the four
  corner brackets that draw out in three steps (`ring` too, with its
  green-edged label).

Colours: one soft green accent, always. `theme.accent` is ignored. Tags follow
a fixed rule whatever colours you give: `Before` red, `After` the green accent,
everything else muted grey. A dark logo is turned light and monochrome (a
white one would turn dark: see the logo note above).

Transitions are discrete and **named ones are reinterpreted on purpose**: the
default and `zoom-blur` are a caret wipe (a bar sweeps across and the new scene
appears behind it, snapping to a column grid), `focus-pull` repaints the frame
line by line, `push-through` scrolls it a line at a time, `whip-pan` slides
both scenes across by whole columns with no blur, and `fade` is a crossfade in
steps. All run 0.5 s.

Behaves differently: typed text needs time to finish. A caption of 42
characters is complete after about 0.8 s plus the 0.4 s delay, so give a
caption scene a little longer than in other styles, and avoid long captions
on short scenes. `check-video.mjs` does not count the typing time.

## sketch

What the viewer sees: a cream paper board with a paper grain. The recording is
a photo print pinned to it, with a taller strip underneath, and it is the one
smooth thing in the frame. Everything else is drawn by hand in Caveat
handwriting and moves in held poses, 10 a second, with a seeded wobble: the
print shakes by a pixel or two and tilts about a degree, and the same seed
gives the same video every time.

- **Captions** are written by hand into the strip of the print, with a
  highlighter slab behind the tag. The words are written at 16 characters a
  second, or faster (up to 44) when at 16 they would not finish with about
  1.4 s left to read. A caption that does not fit on one line shrinks a little, then
  wraps to two lines that hang clear of the tag; one longer than that is
  shortened with an ellipsis. On a full-bleed clip the caption becomes a
  taped note.
- **Title** is hand-written, then an ink underline draws on and the subtitle
  pops in as a sticker.
- **Issue** is a note taped to the board on slightly tilted paper, written
  line by line, with the status circled by hand.
- **List** is a hand-drawn check list: each item is written, then ticked in
  three strokes.
- **Split** shows two level prints taped to the board, each tag written in
  the strip under its print.
- **Callouts** are drawn with the pencil in ten poses: a scribbled circle by
  default, and a box, underline, highlighter, bracket, strike or cross in the
  same hand when the callout asks, with a paper label and a long arrow aimed
  at it.

Colours: the accent is the pencil. Circles, arrows, underlines and emphasis
are drawn in `theme.accent`, pulled a little toward ink and deepened until it
reads 4.5:1 on the board; with no accent the pencil is red. Ticks and the
issue's status are a deep olive. Tags are coloured by their **name**, not by
the colour you gave: `Before`, `Bug`, `Broken`, `Old`, `Problem`, `Issue`,
`Wrong` or `Regression` are red; `After`, `Fix`, `Fixed`, `New`, `Now`, `Done`
or `Result` are olive; anything else is ink.

Transitions: the default is `paper-swap` (0.5 s): the old scene is nudged and
turned a fraction of a degree for two poses, hard cuts, and the new one settles
into place. `zoom-blur`, `focus-pull`, `push-through` and `whip-pan` all
become variants of it (they differ in how far the paper moves), and `fade` is
a dissolve in three held steps.

Behaves differently: it usually takes the longest to render. Every mark,
note and sheet of paper is painted before the first frame, which adds a few
seconds (measured: 2 to 3.5 s more than `studio` on a 20 second demo, 3 to
6 s on a 36 second one); the frames themselves draw as fast as in any style.
Keep captions to one short sentence.

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
Measured on a 20 second demo with two clips: five styles took 52 to 60
seconds of rendering in all, between 9 and 15 seconds each. Allow roughly one
normal render per style; the first run also downloads the fonts (below).

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
plays the renders at full size and works from the keyboard. The styles are a
radio group: Tab to it and use the arrow keys, or press `1` to `9` anywhere
on the page (left and right arrows also flip when the position slider does
not have focus); a flip keeps the playback position. The Play button, space
or a click on the video plays and pauses; comma and full stop step one frame
back and forward, and `Home` goes to the start. The position is a native
slider: drag it to scrub, or focus it and the arrow keys step a frame (Page
Up and Page Down, `Home` and `End` jump). Every control shows a focus ring.
Because each style has its own transition lengths, the same second can be a
slightly different moment.

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
| Smaller captions in `midnight` (the default is 0.0187 of the width) | `{ "caption": { "size": 0.016 } }` |
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

- The Remotion renderer ignores `style` and draws the studio look, with a
  ring for every hand-drawn callout.
- `frame: "stage"` still falls back to a flat window, with a warning, in every
  style.
- A style does not change what is recorded, the scene types or where the
  camera looks, only how they are drawn (fill or inside is part of that). The
  auto-camera runs once per style, so its moves can differ by a fraction of a
  second.
- `midnight`, `editorial`, `terminal` and `sketch` ignore `theme.background`
  and `theme.foreground`.
