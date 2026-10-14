# Scenes, captions, camera and sound

Everything the scenes of a `demo.json` (or a `video.json`) can say. The type,
with every option documented, is `template/src/types.ts`; this is the guide
to choosing. Scenes, transitions, theme and sound are the same in both files;
`demo.json` adds the takes (`demo-json.md`).

## Scene types

| `type` | Shows | Typical length | Use for |
|---|---|---|---|
| `title` | Text with an entrance effect | 3 to 4 s (2 s for a chapter card) | The opener and chapter cards |
| `issue` | A ticket card: source, ID, status pill, title, the reporter's words | 7 to 9 s (reading time) | Why the video exists. Put it before the "before" clip |
| `clip` | A recording in a window, with camera, captions and callouts | 4 to 18 s | Everything that moves |
| `split` | Before and after side by side, playing together | 5 to 7 s | A page that changed as a whole; speed or animation differences |
| `image` | A still with a slow drift | 3 to 5 s | Things you can't record live (an email, a Slack message, a chart export) |
| `list` | A title and items that build one by one, with checks | 5 to 7 s | The changelog or the end card |

```json
{ "type": "issue", "source": "Linear", "id": "ABC-123", "status": "Fixed in PR #123",
  "title": "Having trouble adding a new user to my team lead user type",
  "quote": "I'm unable to assign her as a team lead for Sales.",
  "reporter": "Reported by Sam · Sep 18", "durationSec": 8.5 }

{ "type": "split", "durationSec": 5.6,
  "before": { "take": "old", "trimStartSec": 1.8 },
  "after":  { "take": "new", "trimStartSec": 1.8 },
  "caption": "A list of roles became a directory of people" }

{ "type": "image", "src": "shots/email.png", "aspect": 1.6, "durationSec": 4.6,
  "caption": "Invitations now name the admin who sent them",
  "moves": [{ "atSec": 0, "zoom": 1.02 }, { "atSec": 4.6, "y": 0.42, "zoom": 1.12 }] }

{ "type": "list", "title": "Shipped in PR #123", "subtitle": "ABC-123", "durationSec": 6,
  "items": ["Find and restore removed teammates", "Invites name who sent them"] }
```

Every scene also takes `chapter` (used for the chapters file and the
captions file) and `voiceover`.

## Recordings: `take` or `src`

In a `demo.json`, a `clip` scene names the recording by `"take": "<name>"`,
one of the takes defined in the same file, and a `split` names one per side.
The runner turns it into `src: "clips/<name>.mp4"` and fills in `aspect` from
the recording, so you leave `aspect` out. Use `src` instead of `take` for a
file you made some other way (put it in the demo folder; see "Using an
existing recording" in `demo-json.md`). A scene has one or the other, never
both.

An `image` scene shows a still, so it always takes `src` (a png or jpg
in the demo folder); a `take` there is an error.
Make the still with `node scripts/capture.mjs shot --url <u> --out
<demo folder>/shots/x.png`.

## Clip options

| Option | Does |
|---|---|
| `aspect` | The recording's width / height. Leave it out: the runner sets it from the take, and for a file given by `src` the renderer reads it from the file. Write it only to force a different shape |
| `tag`, `caption` | One caption with a label ("Before", "After"). Where it sits and how it enters depend on the style (see Captions) |
| `captions` | `[{ "atSec", "text", "tag"? }]`: several in turn, for a scene that walks through steps. Each shows until the next |
| `autoCamera` | `true` or options: let `scripts/auto-camera.mjs` write `moves` from the take's events file |
| `moves` | Camera keyframes `{ atSec, x, y, zoom }` (x, y = focus as fractions of the recording) |
| `camera` | `"fill"` (a zoom grows the whole window until the recording fills the frame) or `"inside"` (the zoom crops inside a fixed window). Default: the spec's top-level `camera`, else the style's (`studio` and `midnight` fill). Clip and image scenes; no effect on `frame: "full"` |
| `callouts` | `[{ "mark" or "atSec" + "box", "label"?, "style"? }]`: a ring (or `"style": "spotlight"`, which also dims the rest) that rides with the camera |
| `playbackRate` | Play faster: `1.2` covers 1.2 s of recording per second of video. Good for typing and loading; say so if time matters. Clip scenes only |
| `trimStartSec` | Skip the start of the recording |
| `frame` | `flat` (default), `full` (edge to edge, no window, no logo) or `stage` (tilted 3D; hero moments only, and the one look only the Remotion renderer draws: the default renderer draws it as `flat` and warns) |

## The auto-camera

The runner does this itself on every run, in its `camera` stage: it writes
`build/video.json` from `demo.json` and then directs the camera in that file.
Your `demo.json` is never changed, so a trim, a speed or a caption edit
needs no extra step. To run it by hand on a resolved spec:

```bash
node scripts/auto-camera.mjs <demo folder>/build/video.json --public <demo folder>
```

For every clip with `"autoCamera": true` it reads
`<clip file>.events.json` (`clips/after.mp4.events.json`, next to the clip)
and writes `moves`, tagged `"movesFrom": "auto-camera"`; it also times and
places callouts that name a `mark`. To hand-tune a scene, replace its
`autoCamera` with your own `moves` in `demo.json`; the runner leaves a
scene's own `moves` alone.

How it decides (defaults follow Cap, the open-source Screen Studio
alternative, a little gentler for dense product UI):

- **Shots.** Actions (clicks, typing, marks) less than 2.5 s apart share a
  shot. The camera pushes in 0.6 s before the first, follows each action
  inside the shot (it pans with the work, it doesn't reframe), and holds 2 s
  after the last.
- **Breaks.** A scroll or a `"camera": "wide"` step ends the shot and pulls
  out, so a drawer or dialog that opens is seen whole.
- **Zoom.** 1.8x for a click; a typed field or marked box is framed to fill
  about 40% of the view, never tighter than 2x. Pushes under 1.3x are dropped
  (a wobble), as are shots that can't hold for 1 s (a twitch), and actions in
  the scene's last second.
- **Between shots.** Close ones pan straight on; far ones pull out first.

Options per scene: `zoom`, `maxZoom`, `minZoom`, `lead`, `hold`, `gap`,
`reach`, `pad`, `outSec`, `tail`, `minHold`, `minActions` (2 = never zoom on a
lone click), `endWide`. Then check the result on the contact sheet
(`out/<name>-sheet.png`): if a caption talks about something the camera isn't
on, mark it in the steps or add a key.

How a zoom looks is the style's: in `studio` and `midnight` the whole window
grows over the background until the recording fills the frame (from about
1.2x for a 16:9 recording, 1.3x for 16:10), sliding toward the focus; in the
other styles the window stays put and the zoom crops inside it. The same
`moves` work in both; `"camera": "inside"` or `"fill"` on the spec or a scene
changes it (`styles.md`).

## Captions

- One short sentence, sentence case, plain words, at most 42 characters a
  line and two lines (Netflix, BBC). Say what it does for the user, not how
  it's built. A caption names what to look at; the story belongs on the title,
  issue and list cards. Split a longer thought into timed `captions`.
- Reading speed: 15 to 17 characters a second reads comfortably; 20 is the
  ceiling for adults. `check-video.mjs` warns past 17, past 42 characters a
  line and past two lines (a line break you write starts a new line). It
  takes 0.6 s off each caption's time on screen for its entrance and exit.
- Each caption needs at least 1.5 s on screen, however short.
- Captions stay clear of the action. In `studio` and `midnight` they sit in
  the strip under the window, and over the recording once a zoom has filled
  the frame, on a plate that reads over any page; a caption whose spot would
  cover the action (a callout, where the camera looks, a click) moves to the
  top of the frame for its whole time on screen. In `terminal` they sit in a
  band under the window (on a dark scrim over a `frame: "full"` clip); in
  `editorial` they are margin notes in a column beside the recording; in
  `sketch` they are written into the strip of the photo print. They're burned
  in because Slack and GitHub play videos muted and
  don't show sidecar tracks; `deliver.mjs` also writes `.vtt` and `.srt` for
  anywhere that does.
- Some styles type the caption instead of fading it in: `terminal` at 50
  characters a second after a 0.4 s delay, `sketch` at 16 a second after
  0.3 s, faster (up to 44) when 16 would not leave about 1.4 s to read.
  A caption is complete after its length divided by that rate plus the delay,
  so a long caption on a short scene may still be appearing when the scene
  ends. `sketch` also shortens a caption that will not fit in two lines with
  an ellipsis. `check-video.mjs` does not know about typing speed: its reading
  check counts from the caption's start, not from its last word.
- `demo.mjs` lists a caption that is too fast or too short in its summary;
  fix the text or give the scene more time.

## Emphasis

`*word*` in a title, a caption, a list item or a line of the issue card marks
one accented word: the accent colour in most styles, italic in `editorial`. Write
`\*` for a real asterisk. A lone `*` with no partner stays as typed. The
`.vtt` and `.srt` files, the chapters and the reading-speed check ignore the
markers.

```json
{ "type": "clip", "take": "after", "durationSec": 7, "caption": "A *toast* confirms the invite" }
```

## Transitions and the style

The names (`zoom-blur`, `focus-pull`, `push-through`, `whip-pan`, `fade`,
`cut`) and the per-gap `transitions` list mean the same in every style, but
what they look like is the style's: `studio` blurs and zooms, `midnight` and
`editorial` tone them down, and `terminal` and `sketch` redraw them in their own
language (a caret wipe, a line repaint, a line scroll, a hard slide and a
stepped crossfade in `terminal`; a nudge of the paper and a cut in `sketch`).
Their lengths follow the style too, unless you write `sec`. A style may also add a transition of its
own that you can name only under that style (`page-slide` in `editorial`,
`caret-wipe` in `terminal`, `paper-swap` in `sketch`). See `styles.md`.

## Callouts

Use one when the thing the caption names is small (a toast, a checkbox, a
note): a ring around it for 2 to 3 s. No more than one on screen at a time;
labels under 60 characters.

- **From a mark** (preferred): mark it in the steps
  (`{ "mark": "toast", "target": {...} }`) and name it:
  `{ "mark": "toast", "label": "Removed, not hidden" }`. `auto-camera.mjs`
  sets `box`, `atSec` and `forSec` on every run: it appears at the mark
  (`delaySec` later, if given) and stays up to `maxSec` (2.5), but ends just
  after the next click, which usually changes what it circles. A mark also
  draws the camera. The mark itself is the style's: a ring in `studio`, `midnight`
  and `editorial`, corner brackets in `terminal`, a scribbled circle in `sketch`.
  For something the camera shouldn't move to (a toast while the shot stays
  wide), mark it with `"look": false`.
- **By hand**: `{ "atSec": 14.3, "forSec": 2.1, "box": [x, y, w, h] }`, box
  as fractions of the recording. Measure it on a frame of the raw clip.

## Sound

Most demos go to Slack and PRs, where video plays muted, so the captions must
carry the story. Add sound when the video will be watched with it on (a
launch post, an all-hands).

```json
"music": { "src": "audio/bed.mp3", "volume": 0.16, "fadeInSec": 1, "fadeOutSec": 2, "duck": 0.25 },
"scenes": [{ "...": "...", "voiceover": { "src": "audio/vo-03.m4a", "delaySec": 0.3 } }]
```

- The music bed fades in and out and dips to `duck` (default 0.35, about
  -9 dB; 0.25 is about -12 dB) while any voiceover plays, 0.3 s either side.
- Narration: 140 to 160 words a minute. Write one short file per scene so it
  stays in sync when scenes are trimmed.
- Making narration:
  - macOS: `say -v Ava -r 165 -f vo-03.txt -o vo-03.m4a --file-format=m4af --data-format=aac`
    (always `-f`; install a Premium voice under System Settings > Accessibility
    > Spoken Content first, the default voices sound robotic).
  - OpenAI: `POST /v1/audio/speech` with `"model": "gpt-4o-mini-tts"`, a voice
    such as `marin`, and `"instructions": "Calm product narrator."`. Their
    usage policy asks you to say the voice is AI-generated.
  - Local and free: Kokoro-82M (`python3 -m kokoro -m af_heart -t "..." -o vo.wav`).
- Loudness: about -14 LUFS for social, -16 for narration-led videos.
