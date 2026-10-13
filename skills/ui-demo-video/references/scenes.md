# Scenes, captions, camera and sound

Everything `video.json` can say. The type, with every option documented, is
`template/src/types.ts`; this is the guide to choosing.

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

{ "type": "split", "aspect": 1.6, "durationSec": 5.6,
  "before": { "src": "clips/old.mp4", "trimStartSec": 1.8 },
  "after":  { "src": "clips/new.mp4", "trimStartSec": 1.8 },
  "caption": "A list of roles became a directory of people" }

{ "type": "image", "src": "shots/email.png", "aspect": 1.6, "durationSec": 4.6,
  "caption": "Invitations now name the admin who sent them",
  "moves": [{ "atSec": 0, "zoom": 1.02 }, { "atSec": 4.6, "y": 0.42, "zoom": 1.12 }] }

{ "type": "list", "title": "Shipped in PR #123", "subtitle": "ABC-123", "durationSec": 6,
  "items": ["Find and restore removed teammates", "Invites name who sent them"] }
```

Every scene also takes `chapter` (used for the chapters file and the
captions file) and `voiceover`.

## Clip options

| Option | Does |
|---|---|
| `aspect` | The recording's width / height. `auto-camera.mjs` sets it from the take; an image needs it by hand |
| `tag`, `caption` | One caption under the frame, with a coloured label ("Before", "After") |
| `captions` | `[{ "atSec", "text", "tag"? }]`: several in turn, for a scene that walks through steps. Each shows until the next |
| `autoCamera` | `true` or options: let `scripts/auto-camera.mjs` write `moves` from the take |
| `moves` | Camera keyframes `{ atSec, x, y, zoom }` (x, y = focus as fractions of the recording) |
| `callouts` | `[{ "mark" or "atSec" + "box", "label"?, "style"? }]`: a ring (or `"style": "spotlight"`, which also dims the rest) that rides with the camera |
| `playbackRate` | Play faster: `1.2` covers 1.2 s of recording per second of video. Good for typing and loading; say so if time matters |
| `trimStartSec` | Skip the start of the recording |
| `frame` | `flat` (default), `stage` (3D, hero moments only), `full` |

## The auto-camera

```bash
node scripts/auto-camera.mjs demo-video/src/video.json
```

For every clip with `"autoCamera": true` it reads `public/<clip>.events.json`
and writes `moves`, tagged `"movesFrom": "auto-camera"`; it also times and
places callouts that name a `mark`. Re-run it after changing a trim or speed.
To hand-tune a scene, delete its `autoCamera` and edit `moves`.

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
lone click), `endWide`. Then check the result in a draft: if a caption talks
about something the camera isn't on, mark it in the steps or add a key.

## Captions

- One short sentence, sentence case, plain words, at most 42 characters a
  line (Netflix). Say what it does for the user, not how it's built.
- Reading speed: 15 to 17 characters a second reads comfortably; 20 is the
  ceiling for adults. `check-video.mjs` warns past 20, counting the pill's
  entrance and exit.
- Each caption needs at least 1.5 s on screen, however short.
- Captions sit in a band under the frame, never over the UI. They're burned in
  because Slack and GitHub play videos muted and don't show sidecar tracks;
  `deliver.mjs` also writes `.vtt` and `.srt` for anywhere that does.

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
  draws the camera.
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

- The music bed fades in and out and dips to `duck` (0.25 is about -12 dB)
  while any voiceover plays, 0.3 s either side.
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
