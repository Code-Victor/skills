# Writing a style

A style is one small file in this folder that names how a video looks: colours,
fonts, the window, captions, backgrounds, motion, transitions. `compose.mjs`
reads it; the Remotion template ignores it (it always renders the studio look).

```
styles/
  studio.js     the default look, every token spelled out (read it: it is the reference)
  midnight.js   a style that extends studio (read it: it is the worked example)
  index.js      the registry: add your file here (import + one line in STYLES)
```

A spec picks a style with `"style": "midnight"`, or
`"style": { "preset": "midnight", "overrides": { "post": { "grain": 0.02 } } }`
(overrides merge into the style token by token). No `style` means `studio`.
`node scripts/compose.mjs --style midnight ...` beats the spec;
`node scripts/compose.mjs --list-styles [--json]` prints `{ name, description, suits }`.

## The smallest style

```js
// styles/paperback.js
export default {
  name: 'paperback',
  extends: 'studio',                      // inherit everything you do not mention
  description: 'Warm paper, ink text, no shadows.',        // one line, shown by --list-styles
  suits: 'Essays, changelogs, anything calm.',             // one line: what it is for
  palette: { background: '#f4efe4', foreground: '#26242c', accent: '#b5532f' },
  canvas: { matte: '#f4efe4' },
  window: { shadow: '0 0 0 1px rgba(38,36,44,0.2)' },
};
```

Then in `index.js`: `import paperback from './paperback.js';` and add it to `STYLES`.
Objects merge key by key through `extends` and `overrides`; arrays, functions and
numbers replace. The resolved style gets a hash that is part of every captured
piece's name, so changing a token can never reuse a stale picture.

**What the spec may change (precedence).** What is in the spec is what its author wrote:
for a style other than studio, `spec-lib` writes no theme, `transition` or `transitionSec`
default, and the engine adds none, so there is no "a value equal to the default counts as
unset" guessing. An explicit `"transition": "zoom-blur"` (or `"transitionSec": 0.45`) under
`midnight` renders exactly that; with none, the style's `transition.default` and `.sec` apply.

- **studio** keeps today's behaviour: `theme.background`, `foreground`, `accent` and `tagColors` all apply.
- **Any other style owns its ground and text colour.** `theme.background` and `theme.foreground`
  are ignored, with one warning (and a `check-video` warning) that names the way to change them:
  `"style": { "preset": "midnight", "overrides": { "palette": { "background": "...", "foreground": "..." } } }`.
- `theme.accent` and `theme.tagColors` still apply, but pass through the style's own
  `palette.mapAccent(colour, tools)` and `palette.mapTag(name, colour, tools)` when it has them (see the
  palette table), so a style can adapt a colour somebody else picked to its ground. They run once, in
  Node, when the style is resolved: everything that later uses the accent or a tag colour (caption tags,
  split labels, the quote bar, callouts, emphasis, list icons) sees the adapted value. A builder should NOT
  map again. `tools` is `{ palette, ground, parse, luminance, contrast, mix, alpha, ensureContrast }`
  (`ground` is `canvas.matte`; the helpers return the colour untouched when they cannot read it, e.g.
  oklch or hsl, so always return something). Example:
  `mapTag: (name, c, t) => t.ensureContrast(c, t.ground, 4.5)` lifts a dark red until it reads on near-black.
- `theme.logo` is untouched; give a dark ground a **logo treatment** with the `logo` token (below).

Any colour CSS understands works for the accent (oklch, hsl, names): Chrome resolves it once per render.

Units: lengths are **u** (px at 1920 wide; they scale with the canvas) unless the
name says a fraction of W (width) or H (height). Times are seconds; "frames" are
output frames unless stated.

## Tokens

Every token below exists in `studio.js` with the default shown.

### palette
| token | default | meaning |
|---|---|---|
| background | `#ffffff` | CSS background for `canvas.background.kind: "css"` (any gradient) |
| foreground | `#111114` | text on the canvas and on cards |
| accent | `#3b6bff` | the one accent: callouts, status pill, list icons, emphasis |
| onAccent | `#fff` | text on an accent fill |
| tagColors | `{}` | `{ Before: '#e5484d' }` colour of caption tags |
| tagFallback | `#6ebeff` | tag colour when the tag has none |
| danger | `#e5484d` | the issue card's quote bar when `tagColors.Before` is not set |
| mapAccent | `null` | `(colour, tools) => colour`: adapts `theme.accent` to this style's ground (non-studio only) |
| mapTag | `null` | `(tagName, colour, tools) => colour`: adapts each of `theme.tagColors` (non-studio only) |

### logo
`theme.logo` in the spec is the picture; this token is how the style treats it (all `null` = as is).
`filter`: any CSS filter applied when the logo still is captured (`invert(1)` for a dark logo on a dark ground,
`brightness(1.4)`; an inverting filter turns an already light logo dark, which a spec undoes with
`"overrides": { "logo": { "filter": null } }`), `plate`: `{ background, padX, padY, radius, border }` a rounded plate behind it (u). Both together work.

### fonts
`text`, `display`, `mono`, each `{ family, weights, italic, opsz, fallback }`. `family` is a Google
Fonts family (or `null` for the fallback only). `italic: true` also fetches the italic faces
(use `<i>` or `font-style: italic`); `opsz: 72` (a number, or `'8..72'`) pins the optical size of a family
that has the axis (Newsreader, Fraunces: 72 is the display cut; a family without the axis fails the
download and falls back with a warning). One choice per family. Each variant is cached under its own name
(`newsreader-400.600-i-o72`). Each family is downloaded once
(latin subset) to `$XDG_CACHE_HOME/ui-demo-video/fonts` and reused offline. When
the download fails there is one 4 s attempt, remembered for 10 minutes (a
`.failed` marker), and the text uses `fallback`; the render warns. Env:
`UI_DEMO_FONTS_HOST` (point downloads elsewhere, e.g. an unreachable host in
tests), `UI_DEMO_FONTS_OFFLINE=1` (never try). Fonts are loaded before anything
is laid out. In builders use `ctx.font('display' | 'text' | 'mono')`.

### canvas
| token | default | meaning |
|---|---|---|
| matte | `#ffffff` | the colour behind everything: what a blur or fade passes through |
| model | `scene` | `scene`: each scene paints its own background and a transition mixes whole scenes over the matte (today's look, the dip is white). `shared`: one background per frame, scenes draw their content with alpha over it, transitions composite scene CONTENT over that background (a dark style never flashes white, an animated background never pulses). A non-css background forces `shared` |
| background | `{ kind: 'css' }` | see below |

**Background kinds** (`canvas.background`):
- `css`: `palette.background`, captured once as a still (as before).
- `shader`: an animated GLSL function, drawn once per frame behind everything.
  `colors` (up to 6 CSS colours), `speed` and the shader's own named parameters.
  Built in: `aurora` (`speed` 0.06, `intensity` 0.4, `height` 0.32, `spread` 0.16; colours: ground then three tints),
  `mesh` (Paper Design mesh gradient, Apache-2.0: `speed` 0.15, `distortion` 0.8, `swirl` 0.1; every colour is a spot),
  `dots` and `lines` (`spacing` 28/64 u, `radius` or `width`, `drift` u/s, `fade` 0..1 edge fade, `opacity`, `gradient` 0..1 to colours[2]; colours: ground, mark, optional second ground).
  Keep it slow: `speed` is cycles per second for aurora (0.05 is a 20 s period), orbit speed for mesh (0.1 to 0.3 is a 40 to 100 s period); never let the background be what the eye follows.
- `ambient`: the recording's own colours: the current clip frame, heavily blurred, enlarged, saturated and dimmed. `blur` (u, 90), `scale` (1.2), `saturate` (1.3), `dim` (0.35), `tint`/`tintAmount`. Scenes without a clip hold the nearest clip's frame (the one before, else the first frame of the next).

Your own GLSL: `background: { kind: 'shader', glsl: '...', colors: [...], params: [..up to 8 numbers] }` where `glsl` defines

```glsl
vec3 background(vec2 uv, vec2 px, float t)   // uv 0..1 (y down), px = pixel, t = seconds
// available: uCol[0..5] (vec3, sRGB), uNCol, uP[0..7] (your params), uRes
```

Credit adapted shader code above the function with its licence (MIT or Apache-2.0 only).

### post (final pass, off in studio)
| token | default | meaning |
|---|---|---|
| dither | 0 | triangular noise in 8-bit levels (2 to 3 removes banding in dark gradients) |
| grain | 0 | film grain amplitude 0..1 (0.012 is about 3 levels) |
| grainSize | 1.5 | grain cell in u |
| grainClock | `frame` | when the grain and dither noise changes: `frame` (every output frame), `pose` (every pose of `motion.clock`, so a stepped style's grain steps with it) or `static` (never: the same grain on every frame, which also encodes better) |
| vignette, vignetteSoftness | 0, 0.6 | corner darkening 0..1, and how far in it starts |

Any of them switches the frame through a half-float buffer, so gradients are
computed without banding and dithered once at the end.

### window
| token | default | meaning |
|---|---|---|
| maxWidth, maxHeight | 0.92, 0.84 | fractions of W and H the whole window (shell + recording) may take (studio's fill framing: a strip for one caption line under it) |
| top, align, margin | 0.036, `center`, 0.05 | top as a fraction of H; `left`/`right` with a margin (fraction of W) |
| radius | 0.0115 | corner radius (fraction of W) |
| fill | `#fff` | colour behind the recording |
| shadow | `0 0 0 1px rgba(0,0,0,0.06),0 24px 70px rgba(0,0,0,0.22)` | any CSS box-shadow list |
| shadowPad | 130 | px kept around the shell for the shadow |
| border | null | `{ width, color }` hairline drawn OVER the recording's edge; or `{ width, gradient: 'linear-gradient(180deg, rgba(255,255,255,.18), rgba(255,255,255,0) 60%)' }` for a gradient ring (a top-lit hairline; the ring is the gradient with the middle cut out by a mask, so any CSS gradient works). `highlight` still adds its 1 px line |
| highlight | null | `{ color }` 1 px line along the inner top edge, over the recording |
| glow | null | `{ color, blur, spread }` tinted glow behind the window |
| insets | `[0,0,0,0]` | u: room inside the shell around the recording `[top,right,bottom,left]` (a title bar, a photo-frame strip) |
| chrome | `{ kind: 'none' }` | `{ kind: 'browser', height: 44, urlText, fill, rule, lights, urlFill, color }`: traffic lights and a URL pill; the bar is added to the top inset and the camera box excludes it |
| drift | null | `{ to: 1.035 }`: scene-long linear push-in of the whole window group (A) |
| tilt, tiltJitter | 0, 0 | degrees: a constant small tilt of the whole group (shell, recording, ring, callouts); jitter adds a per-scene random in plus or minus that |
| jitter | false | with `motion.clock`: the group shakes a little each pose |

Layout numbers live in `layout.js`, used by both the page and plan.js. The shell
is captured empty; the recording is drawn over it by the GPU with the same
rounded corners (top corners square when there is a top inset).

### split
`gap` 0.025, `width` 0.92, `height` 0.7, `top` 0.12, `labelSize` 0.0135, `labelRise` 0.055.

### caption
`variant`: `pill` | `glass` | `plain` | `bar` | `mono`.
`placement`: `under` (band below the window), `overlay` (inside, at the bottom), `slot` (the shell's bottom inset strip; it rides with the window's tilt).
`align`: `center` | `left`. `size` (0.0177 W), `offset` (0.05 H bottom gap when there is no band), `inset` (0.03 H overlay gap),
`top` (0.05 H: the top edge of a caption that moved up because the action is under its bottom spot; see camera),
`tagContrast` (4.5: tag colours and the emphasis colour on a pill, glass or bar plate are lifted until they hold this against the plate over white; `null` keeps them as given).
`color` `#fff`, `weight` 500, `textShadow` (bar, mono), `maxWidth` (a fraction of W; null keeps one line, a number makes every variant wrap inside that width, and a typed caption follows its lines).
`scrim`: `{ height: 0.3, color: '#000', opacity: 0.6 }` a soft gradient up from the bottom of the recording (height is a fraction of the recording's height), drawn behind overlay captions and captions on a full-bleed recording; it fades in with the first caption of the scene and out with the last, and rides with the window group.
Variant tokens: `pill { gap, padY, padX, radius, background, shadow, border }`, `glass { blur, tint, saturate, border, radius, shadow }`
(a blurred, tinted copy of what is behind it, drawn by the GPU), `plain { shadow, rule, ruleColor }`, `bar { barWidth, padX, padY, background, tagSize }`, `mono { prompt, promptColor }`.
`tag { style: 'word' | 'chip' | 'bracket', weight }`.
**Entrance** (B): `enter: 'fade'` (today's: opacity plus a rise of `rise` caption heights), `'blur'` (opacity plus blur `blurPx` to 0 over `blurSec`, no translation), `'rise'`, `'type'`
(characters revealed in reading order at `typeCps` by clipping the captured text at real glyph edges, **line by line**: earlier lines whole, the current one up to the caret, so wrapped captions (set `caption.maxWidth`) and wrapped titles type properly; `caret: 'bar' | 'block' | 'none'` moves from line to line, blinks on a fixed clock and stays; it suits plain, mono and bar). `delay` 0.25, `exit` 0.35. The same four work for the title's subtitle (`title.subtitleEnter`), card rows (`card.rowEnter`: `rise` = today, `fade`, `blur`, `type`) and list items (`list.itemEnter`: `slide` = today, others as above).

### title, card, list
`title`: `enter` (the entrance when a scene has no `effect`: `soft-blur-in` | `word-push` | `micro-scale-fade` | `type` | `lines`; a scene's own `effect` wins, and `type` and `lines` are valid scene effects too), `maxEnterSec` (null: none; a number speeds the whole entrance up until it finishes within that many seconds, whatever the text length), `size` 0.042 W, `weight` 600, `align` `center`|`left` (with `padLeft`), `subtitleSize/Weight/Opacity/Enter`, `gap`, `tracking` per effect, `measure`: `estimate` (today: 0.5 em per character, Inter's guess, used by word-push) or `glyph` (the real captured word widths: use this for any other font).
`maxWidth` (0.8 W) and `lineHeight` (1.12) are the title's measure: with the default builder every entrance but `word-push` wraps a long title inside it in balanced lines, a word never split, and pushes the subtitle down (a one-line title sits where it always did; `word-push` keeps one line).
The two newer entrances capture the wrapped text as ONE piece (`all`): `type` types it across the lines with `typeCps` (24) and `caret` / `caretColor`;
`lines` is the line-by-line mask reveal: each line rises (`lines.rise` line heights, 1) into a mask that is its own band of the screen (`lines.stagger` 0.09 s, `lines.sec` 0.6, `lines.ease`, `lines.fade: false` for a pure mask reveal with no opacity ramp), whatever the wrapping turns out to be.
`card`: `width` 1040, `padX/padY` 60/52, `radius` 28, `gap` 22, `fill`, `shadow`, `border`, `metaSize/metaOpacity`, `statusSize/statusAlpha`, `titleSize`, `quoteSize`, `reporterSize`, `quoteBar`, `rowEnter`. Card text uses `palette.foreground`: a dark card needs a light foreground, set both.
`list`: `width` 1100, `gap`, `titleSize`, `subtitleSize/Opacity`, `itemSize`, `itemGap`, `iconSize`, `iconAlpha`, `numbered` (mono 01 02 03 instead of check icons), `itemEnter`. With `slide`, items come in from `motion.list.dx` and `motion.list.dy` (u; dy 0 by default, so a row can rise instead of slide).

### callout
`mark`: `ring` or your builder (`build.calloutMark`). `pad` 8, `radius` 10, `ringWidth` 2.5, `ringColor` (default accent), `dash` (0 solid; n dashes around), `fillAlpha`, `dimAlpha` 0.42, `dimColor`, `scaleIn` 0.96, `forSec` 2.5, `enterSec`, `exitSec`, `chip { size, weight, padX, padY, radius, background, color }`.

### motion
`spring` `{ damping: 200 }` for every enter. `card { rise, rows, alpha }`, `list { headRise, start, step, dx, dy }`, `split { stagger, rise }`,
`text { softBlur { stagger, rise, blur, frames, riseFrames, ease, staggerSec, sec, riseSec }, microScale { frames, from, ease, sec }, wordPush { reveal, slide, over, char, space, gap, accel, revealSec, slideSec, gapSec }, subtitle { from, to, rise } }`.
The frame counts are the original numbers (soft-blur in output frames, the other two in frames at 30 fps) and stay as studio's defaults;
the `...Sec` tokens are the same timings in seconds, null by default, and win when set, so a style's timing does not change with the frame rate.
`poseRate` (poses per second for pose sequences, default the clock's rate or 10).
**Quantised clock** (C): `clock: { poses: 10, seed: 1, jitterPx: 1.4, jitterDeg: 0.35 }` evaluates everything except the recording (stills, pieces, callouts, captions, transitions that are `stepped`, the group's tilt and jitter) at `poses` a second, each pose held, with per-pose jitter from a seeded generator (never `Math.random`: same seed, same video). The recording and its camera always run at full rate.
The ticks are on the **output frame count** (every multiple of `step` frames), not on each scene's own start: two scenes in a transition, the transition's steps (`stepped`), pose sequences, the callout marks and, with `post.grainClock: 'pose'`, the grain all change on the same frames. A scene begins on its first tick, so its first pose may be held up to one pose long.

### camera
`mode`: `fill` | `inside`. **Not inherited through `extends`**: a style that does not say `fill` frames inside. `fill` (studio, midnight):
on flat clip and image scenes the zoom moves the whole window group (shell, shadow, recording, ring, callouts, but not the captions)
through `fillPose` (motion.js), a plain camera on the composition at rest: each key is solved once into a view of the canvas
(centre c, zoom z: inside the recording along an axis where the view is smaller than it, the recording centred where it is larger;
zoom 1 is the identity), c and z are interpolated on the same eased parameter as inside mode, and screen = (p - c) z + the canvas
centre. A view edge is convex in that parameter, so the view stays inside the bounds both keys keep with no clamp per frame, and a
zoom never wobbles. `fill` (0 at rest, 1 once the recording covers the frame) and the corner rounding come from the recording's
rectangle on screen. The corners square off as the nearest side reaches the frame's edge and the ring fades with them; tilt and
jitter fade as it fills; the logo is gone by fill 0.35. A caption with no plate gets a screen-space scrim
(`caption.scrim`, else black or white against the text) once fill passes about 0.5. `inside`: the zoom crops inside a fixed window
(the original behaviour). A spec overrides it with `"camera"` at the top or on a clip or image scene. Captions that can sit over the
recording (fill, `frame: "full"`, `placement: "overlay"`) are placed once per caption in Node (`captionPlacements`, layout.js): at the
top when the bottom spot would be on or within 6% of the action for more than 0.2 s.
In both modes a pan between two zoomed-in keys whose focus points are more than a view apart follows van Wijk & Nuij's smooth
pan-zoom path (`farPath` in motion.js, rho 1.4, never wider than the whole frame): it pulls out on the way and back in on the one
eased parameter. `ease`: `{ type: 'bezier', curve: [0.65,0,0.35,1] }` (today) or `{ type: 'spring', stiffness: 320, damping: 40, mass: 0.92 }` (overdamped: no overshoot; the spring's step response is stretched so it has settled when the keyframe's `atSec` arrives). `motionBlur`: `{ shutter: 0.5, samples: 6 }` averages camera poses between a moment ago and now (only while the camera moves; the cost is the window pass times `samples`).

### transition
`default` (`zoom-blur`), `sec` (0.45, used for zoom-blur and fade; the others have natural lengths), `stepped` (all transitions on the quantised clock), `params`: `zoomBlur { scaleIn 0.9, scaleOut 1.12, sigma 16 }`, `focusPull { bright 1.3, brightIn 1.25, sigma 16, scaleOut 1.05, scaleIn 0.97 }`,
`pushThrough { scale 2.4, scaleIn 0.68, settle 1.02, sigma 14, sigmaIn 0.7 }`, `whipPan { travel 1.1, stretch 0.12, blur 24 }` (the numbers in each are studio's: focus-pull brightens by 1.3, a flash on a dark ground, lower it; sigma and blur are px, travel is fractions of the frame), `custom { name: { sec, stepped, glsl } }` (below). All built-in transitions work in every style; in the `shared` model they pass through the background, not the matte.

## Builders (E8, F)

A style can replace the HTML of any piece with `build: { title, issue, list, caption, calloutChip, calloutMark, window, furniture }`. A builder is
`(ctx) => ({ html, css?, poses? })`. `ctx` carries `spec, style, scene, index, W, H, u, fg, accent, font(role), rgba(css, alpha), rich(text, color?), esc, has`, per kind more (below), and `default()`, which runs the default builder so you can wrap or tweak its result.

**Pieces.** The animations move elements marked `data-p="name"` (optionally `data-pad="px"`: room around it for blur and shadows). The engine captures each one into its own picture. Names the scenes expect:
- title: `c0, c1, ...` (one per non-space glyph, soft-blur-in), `w0, w1, ...` (words, word-push), `all` (micro-scale-fade), `sub`. `titleSpans(ctx)` (exported from plan.js) returns the right spans for the effect: wrap them in your own layout.
- issue: an element `id="card"` holding `.piece[data-p="title" | "quote" | "reporter"]`; the card is captured without its pieces.
- list: `head`, `i0, i1, ...`.
- caption: one element `id="pill"`; `ctx.pos` has the positioned wrapper (`ctx.pos.css`) to put it in, and `tag, text, color, size`. Elements with `data-type` are what the `type` entrance reveals (glyph edges are measured from them).
- calloutChip: `id="chip"` (label in `ctx.label`). The context also has `callout` (the whole callout), `scene`, `index`, `calloutIndex` and `side` (`'above'` or `'below'`: where the engine puts the label, below when the box is near the top of the recording). A style with its own chip builder gets one picture per callout and side.
- window: HTML placed inside the shell box (`ctx.box` outer, `ctx.view` the recording's rectangle, `ctx.insets`, `ctx.label` the tag or take name, `ctx.radius`). Set `window.insets` to say where the recording sits; a caption with `placement: 'slot'` goes in the bottom inset strip.
- calloutMark: HTML for a callout given its size at 2x (`ctx.w`, `ctx.h`, `ctx.callout`): it is captured at 2x so it stays sharp when the camera zooms and follows the camera like the ring. Return `poses`, an array of inner-HTML strings, to get a pose sequence.
- furniture: HTML drawn on the background, outside the window, on **every** scene type (title, issue, list, split, clip, image: a running header, a folio). `ctx.scene`, `ctx.index` and `ctx.sceneType` (`'title' | 'issue' | 'list' | 'split' | 'clip' | 'image'`) are given; return `null` for the scenes that should have none. (Furniture used to be offered on clip, image and split scenes only, and drawn on clip and image only: a builder written then should return `null` for the other types if it bakes its header into card pieces.)

**Poses** (D): any piece (and a callout mark) may return `poses: { name: [html0, html1, ...] }` (for the mark: just the array); each is captured once and shown in turn at `motion.poseRate`. Frame k of the callout is pose `floor(seconds * rate)`, clamped.

**Extra pieces.** Besides the fixed names above, any other `data-p="name"` element in a title, issue, list, split or caption builder's HTML is captured as its own picture, and the builder can return `pieces` to say when and how it enters:

```js
return { html, poses: { underline: [html0, html1, html2, html3] },
  pieces: { sticker:   { at: 0.6, enter: 'pop', sec: 0.4, from: 0.4 },        // pops on the title 0.6 s in, with a small overshoot
            underline: { at: 0.3, rate: 8 },                                  // plays its poses from 0.3 s at 8 a second (draw-on)
            tick0:     { at: 0.5, enter: 'fade' } } };
```
`at` is seconds after the owner's own start (the scene for a title, card, list or split; the caption's entrance for a caption).
`enter`: `fade` (default), `blur` (`px`, `sec`), `rise` (`rise` u, `sec`), `type` (`cps`, `caret`; the element needs `data-type`), `pop` (scale from `from`, 0.6, to 1 with a small overshoot). Also `sec`, `opacity` (the level it settles at),
`rate` / `loop` (pose sequence speed; loop repeats it, else it holds the last pose), `until` and `exitSec` (fade out), `z` (draw order; the default is by name). Extras inside a caption are drawn with the caption (and fade out with it); inside a card they move with it.
They are never part of the card's or pill's own picture. An extra's pose sequence starts when the extra does.

**Fixed pieces play poses too.** A title's `sub`, `all`, a card's `title` / `quote` / `reporter`, a list's `head` and items, a caption's pill and the split labels may all return `poses` (`poses: { i0: [...] }` for a named piece; an array for a caption's pill): they play on the scene's clock (a caption's from its own start) at `motion.poseRate`, holding the last pose.

**Emphasis** (G): in any title, caption, list item or card line `*word*` marks the accented word (accent colour, no background); `\*` is a literal asterisk. Default builders do it through `ctx.rich(text)`; custom builders should too. `stripEmphasis(text)` (layout.js) returns the plain text for caption files and chapters.

Worked example, a left-aligned editorial title:

```js
import { titleSpans } from '../plan.js';
build: {
  title: (c) => ({ html: `<div class="af" style="justify-content:center;padding-left:${c.W * 0.1}px;font-family:${c.font('display')}">
    <div style="font-size:${c.W * 0.05}px;font-weight:600;color:${c.fg};white-space:nowrap">${titleSpans(c)}</div>
    ${c.has(c.scene.subtitle) ? `<div data-p="sub" data-pad="8" style="margin-top:12px;font-size:${c.W * 0.016}px;color:${c.fg};opacity:.6">${c.rich(c.scene.subtitle)}</div>` : ''}
  </div>` }),
}
```

## Transitions in GLSL (H)

```js
transition: { custom: { 'my-wipe': { sec: 0.8, stepped: false, glsl: `
vec4 transition(vec2 uv) {          // uv 0..1, y down
  float m = smoothstep(uProgress - .1, uProgress + .1, uv.x);
  return mix(getTo(uv), getFrom(uv), m);   // premultiplied RGBA
}` } } }
```
The contract is a pure function of the two scene layers (`getFrom(uv)`, `getTo(uv)`, transparent where a scene has nothing; the background is composited under the result), `uProgress` (0..1), `uRes`, `uPal[0..3]` (matte, foreground, accent, dim colour) and `uDir` (`vec2`, y down: the transition's `"direction"` as a unit vector, left `(-1,0)` when none is given; a spec writes `{ "type": "my-wipe", "direction": "down" }`). A spec uses it by name in `transition` / `transitions`. `stepped` evaluates progress on the quantised clock.

## Rotation (E)

Pieces take a rotation in the engine (`piece(id, { rot })`, radians about their centre; the clock's jitter uses it), and the window group takes `tilt`. Both are applied in the recording pass too (the video shader works in window space), so the picture, its corners and its callouts stay locked together. Keep angles small (a few degrees); edges stay antialiased.

## Determinism

The frames handed to the encoder are identical between runs for every built-in style, `sketch` included. What
can break that is Chrome's GPU raster when a piece is captured (not the WebGL draw or the hardware encoder): it can
draw the anti-aliased edges of SVG paths, SVG masks and filters, and boxes turned with a CSS rotation a level or
two differently from one browser launch to the next. Before `sketch` changed, the same piece captured six times
came out in up to three versions; with `--disable-gpu-rasterization`, in one. Text (glyphs come from a
CPU-rasterised atlas), level boxes and level tiled backgrounds repeat exactly.

So a style that draws by hand (strokes, masks, filters, turned paper) should do what `sketch` does: paint every
mark, note, sticker and strip of tape in Node into a PNG, with its jitter and grain from a fixed seed, and let
Chrome only place the picture, untransformed. `sketch.js` has the small painter it uses (brush ribbons, a scanline
fill, a seeded grain mask, PNG writing). Noise can also be drawn in a shader. Small level icons (the built-in
list check marks) have repeated so far, but measure any style with `--hash-frames` (two runs, then `diff`).

## Testing a style

```sh
export XDG_CACHE_HOME=/tmp/engine-cache          # keep your real cache untouched
node scripts/compose.mjs video.json --style paperback --still 12 --still-out /tmp/a.png
node scripts/compose.mjs video.json --style paperback --out /tmp/a.mp4 --sheet /tmp/a.png --json
UI_DEMO_EXTRA_STYLES=/abs/path/mystyle.js node scripts/compose.mjs ...   # try a style that is not registered yet
node scripts/check-video.mjs video.json          # validates "style" (unknown names list the valid ones)
node scripts/compose.mjs video.json --still 3 --still-out /tmp/a.png --dump-stills /tmp/pieces   # every captured piece, named by its id (an index.txt lists them)
node scripts/compose.mjs video.json --out /tmp/a.mp4 --hash-frames /tmp/a.hash                  # a SHA-1 of each frame's pixels just before the encoder (compare two runs with diff)
COMPOSE_CHROME_ARGS="--disable-gpu-rasterization" node scripts/compose.mjs ...                   # extra Chrome flags, for experiments
```

Check: text contrast at 375 px, the window edge against the background, captions over bright and dark parts of the page, the transitions in the middle of their run (not only the ends), and a title-only render of your background with the final pass off and on (banding). Keep every style above 120 fps on the sample; `renderFps` is in the `--json` output. The default `studio` must stay pixel-identical: render the sample before and after a change to shared code and compare (`ffmpeg -lavfi ssim`).
