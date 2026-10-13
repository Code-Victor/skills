# Writing a style

A style is one small file in this folder that names how a video looks: colours,
fonts, the window, captions, backgrounds, motion, transitions. `compose.mjs`
reads it; the Remotion template ignores it (it always renders the studio look).

```
styles/
  studio.js     today's look, every token spelled out (read it: it is the reference)
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

How the spec's own `theme` interacts: `theme.background`, `foreground`, `accent`
and `tagColors` (per tag) win over the style's palette (a `theme.background`
replaces the style's background with that CSS). demo.mjs writes the authoring
defaults into every spec, so for a style other than studio a theme value equal to
that authoring default counts as "not set". The same goes for `transition` /
`transitionSec` equal to the authoring default (`zoom-blur`, 0.5 or 0.45): the
style's `transition.default` and `.sec` apply. Any colour CSS understands works
for the accent (oklch, hsl, names): Chrome resolves it once per render.

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

### fonts
`text`, `display`, `mono`, each `{ family, weights, fallback }`. `family` is a Google
Fonts family (or `null` for the fallback only). Each family is downloaded once
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
| vignette, vignetteSoftness | 0, 0.6 | corner darkening 0..1, and how far in it starts |

Any of them switches the frame through a half-float buffer, so gradients are
computed without banding and dithered once at the end.

### window
| token | default | meaning |
|---|---|---|
| maxWidth, maxHeight | 0.9, 0.8 | fractions of W and H the whole window (shell + recording) may take |
| top, align, margin | 0.055, `center`, 0.05 | top as a fraction of H; `left`/`right` with a margin (fraction of W) |
| radius | 0.008 | corner radius (fraction of W) |
| fill | `#fff` | colour behind the recording |
| shadow | `0 0 0 1px rgba(0,0,0,0.06),0 24px 70px rgba(0,0,0,0.22)` | any CSS box-shadow list |
| shadowPad | 130 | px kept around the shell for the shadow |
| border | null | `{ width, color }` hairline drawn OVER the recording's edge |
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
`align`: `center` | `left`. `size` (0.0135 W), `offset` (0.05 H bottom gap when there is no band), `inset` (0.03 H overlay gap).
`color` `#fff`, `weight` 500, `textShadow` (bar, mono).
Variant tokens: `pill { gap, padY, padX, radius, background, shadow, border }`, `glass { blur, tint, saturate, border, radius, shadow }`
(a blurred, tinted copy of what is behind it, drawn by the GPU), `plain { shadow, rule, ruleColor }`, `bar { barWidth, padX, padY, background, tagSize }`, `mono { prompt, promptColor }`.
`tag { style: 'word' | 'chip' | 'bracket', weight }`.
**Entrance** (B): `enter: 'fade'` (today's: opacity plus a rise of `rise` caption heights), `'blur'` (opacity plus blur `blurPx` to 0 over `blurSec`, no translation), `'rise'`, `'type'`
(characters revealed left to right at `typeCps` by clipping the captured text at real glyph edges; `caret: 'bar' | 'block' | 'none'` blinks on a fixed clock and stays; it suits plain, mono and bar). `delay` 0.25, `exit` 0.35. The same four work for the title's subtitle (`title.subtitleEnter`), card rows (`card.rowEnter`: `rise` = today, `fade`, `blur`, `type`) and list items (`list.itemEnter`: `slide` = today, others as above).

### title, card, list
`title`: `size` 0.042 W, `weight` 600, `align` `center`|`left` (with `padLeft`), `subtitleSize/Weight/Opacity/Enter`, `gap`, `tracking` per effect, `measure`: `estimate` (today: 0.5 em per character, Inter's guess, used by word-push) or `glyph` (the real captured word widths: use this for any other font).
`card`: `width` 1040, `padX/padY` 60/52, `radius` 28, `gap` 22, `fill`, `shadow`, `border`, `metaSize/metaOpacity`, `statusSize/statusAlpha`, `titleSize`, `quoteSize`, `reporterSize`, `quoteBar`, `rowEnter`. Card text uses `palette.foreground`: a dark card needs a light foreground, set both.
`list`: `width` 1100, `gap`, `titleSize`, `subtitleSize/Opacity`, `itemSize`, `itemGap`, `iconSize`, `iconAlpha`, `numbered` (mono 01 02 03 instead of check icons), `itemEnter`.

### callout
`mark`: `ring` or your builder (`build.calloutMark`). `pad` 8, `radius` 10, `ringWidth` 2.5, `ringColor` (default accent), `dash` (0 solid; n dashes around), `fillAlpha`, `dimAlpha` 0.42, `dimColor`, `scaleIn` 0.96, `forSec` 2.5, `enterSec`, `exitSec`, `chip { size, weight, padX, padY, radius, background, color }`.

### motion
`spring` `{ damping: 200 }` for every enter. `card { rise, rows, alpha }`, `list { headRise, start, step, dx }`, `split { stagger, rise }`,
`text { softBlur { stagger, rise, blur, frames, riseFrames, ease }, microScale { frames, from, ease }, wordPush { reveal, slide, over, char, space, gap, accel }, subtitle { from, to, rise } }`,
`poseRate` (poses per second for pose sequences, default the clock's rate or 10).
**Quantised clock** (C): `clock: { poses: 10, seed: 1, jitterPx: 1.4, jitterDeg: 0.35 }` evaluates everything except the recording (stills, pieces, callouts, captions, transitions that are `stepped`, the group's tilt and jitter) at `poses` a second, each pose held, with per-pose jitter from a seeded generator (never `Math.random`: same seed, same video). The recording and its camera always run at full rate.

### camera
`ease`: `{ type: 'bezier', curve: [0.65,0,0.35,1] }` (today) or `{ type: 'spring', stiffness: 320, damping: 40, mass: 0.92 }` (overdamped: no overshoot; the spring's step response is stretched so it has settled when the keyframe's `atSec` arrives). `motionBlur`: `{ shutter: 0.5, samples: 6 }` averages camera poses between a moment ago and now (only while the camera moves; the cost is the window pass times `samples`).

### transition
`default` (`zoom-blur`), `sec` (0.45, used for zoom-blur and fade; the others have natural lengths), `stepped` (all transitions on the quantised clock), `params { zoomBlur { scaleIn, scaleOut, sigma }, focusPull { bright, brightIn } }`
(focus-pull brightens by 1.3: a flash on a dark ground, lower it), `custom { name: { sec, stepped, glsl } }` (below). All built-in transitions work in every style; in the `shared` model they pass through the background, not the matte.

## Builders (E8, F)

A style can replace the HTML of any piece with `build: { title, issue, list, caption, calloutChip, calloutMark, window, furniture }`. A builder is
`(ctx) => ({ html, css?, poses? })`. `ctx` carries `spec, style, scene, index, W, H, u, fg, accent, font(role), rgba(css, alpha), rich(text, color?), esc, has`, per kind more (below), and `default()`, which runs the default builder so you can wrap or tweak its result.

**Pieces.** The animations move elements marked `data-p="name"` (optionally `data-pad="px"`: room around it for blur and shadows). The engine captures each one into its own picture. Names the scenes expect:
- title: `c0, c1, ...` (one per non-space glyph, soft-blur-in), `w0, w1, ...` (words, word-push), `all` (micro-scale-fade), `sub`. `titleSpans(ctx)` (exported from plan.js) returns the right spans for the effect: wrap them in your own layout.
- issue: an element `id="card"` holding `.piece[data-p="title" | "quote" | "reporter"]`; the card is captured without its pieces.
- list: `head`, `i0, i1, ...`.
- caption: one element `id="pill"`; `ctx.pos` has the positioned wrapper (`ctx.pos.css`) to put it in, and `tag, text, color, size`. Elements with `data-type` are what the `type` entrance reveals (glyph edges are measured from them).
- calloutChip: `id="chip"` (label in `ctx.label`).
- window: HTML placed inside the shell box (`ctx.box` outer, `ctx.view` the recording's rectangle, `ctx.insets`, `ctx.label` the tag or take name, `ctx.radius`). Set `window.insets` to say where the recording sits; a caption with `placement: 'slot'` goes in the bottom inset strip.
- calloutMark: HTML for a callout given its size at 2x (`ctx.w`, `ctx.h`, `ctx.callout`): it is captured at 2x so it stays sharp when the camera zooms and follows the camera like the ring. Return `poses`, an array of inner-HTML strings, to get a pose sequence.
- furniture: HTML drawn on the background outside the window for every non-title scene (a running header, a folio): `ctx.scene`, `ctx.index`.

**Poses** (D): any piece (and a callout mark) may return `poses: { name: [html0, html1, ...] }` (for the mark: just the array); each is captured once and shown in turn at `motion.poseRate`. Frame k of the callout is pose `floor(seconds * rate)`, clamped.

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
The contract is a pure function of the two scene layers (`getFrom(uv)`, `getTo(uv)`, transparent where a scene has nothing; the background is composited under the result), `uProgress` (0..1), `uRes` and `uPal[0..3]` (matte, foreground, accent, dim colour). A spec uses it by name in `transition` / `transitions`. `stepped` evaluates progress on the quantised clock.

## Rotation (E)

Pieces take a rotation in the engine (`piece(id, { rot })`, radians about their centre; the clock's jitter uses it), and the window group takes `tilt`. Both are applied in the recording pass too (the video shader works in window space), so the picture, its corners and its callouts stay locked together. Keep angles small (a few degrees); edges stay antialiased.

## Testing a style

```sh
export XDG_CACHE_HOME=/tmp/engine-cache          # keep your real cache untouched
node scripts/compose.mjs video.json --style paperback --still 12 --still-out /tmp/a.png
node scripts/compose.mjs video.json --style paperback --out /tmp/a.mp4 --sheet /tmp/a.png --json
UI_DEMO_EXTRA_STYLES=/abs/path/mystyle.js node scripts/compose.mjs ...   # try a style that is not registered yet
node scripts/check-video.mjs video.json          # validates "style" (unknown names list the valid ones)
```

Check: text contrast at 375 px, the window edge against the background, captions over bright and dark parts of the page, the transitions in the middle of their run (not only the ends), and a title-only render of your background with the final pass off and on (banding). Keep every style above 120 fps on the sample; `renderFps` is in the `--json` output. The default `studio` must stay pixel-identical: render the sample before and after a change to shared code and compare (`ffmpeg -lavfi ssim`).
