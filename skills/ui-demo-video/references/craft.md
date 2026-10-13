# Craft: what makes a demo video read as professional

Research notes behind the skill's defaults (October 2026). Numbers come from
the sources linked; "measured" means taken from real launch videos with
ffprobe; "judgment" means no source settles it.

## Length and pacing

- Linear's feature videos run 18 to 67 s (median about 34 s); their changelog
  clips 17 to 40 s; Arc and Dia spots 19 to 64 s (measured).
- Beats of about 4 to 6 s, each one continuous camera move; text cards about
  2 s; end card 4 to 10 s (measured, Linear).
- Videos under 60 s hold attention best
  ([Wistia](https://wistia.com/blog/optimal-video-length)); in interactive
  demos most viewers drop off by step 7, so lead with the strongest moment
  ([Arcade](https://www.arcade.software/post/2026-arcade-benchmarks)).
- Keep PR videos under 90 s.

### A fix plus a tour, in about 75 to 90 s (judgment, from the above)

| Time | Beat |
|---|---|
| 0 to 3 s | Title: the outcome, 42 characters or fewer |
| 3 to 11 s | Issue card: the report in the reporter's words |
| 11 to 26 s | Before: reproduce it in real time, zoom on the failure, hold 2 s |
| 26 to 42 s | After: the same steps, the same data, the same framing |
| 42 to 80 s | 3 to 5 tour beats, 6 to 12 s each: one action, one result, one caption |
| last 5 s | End card: what shipped, the ticket and PR |

## Before and after

- **Sequential** (the default): for flows, timing bugs, anything multi-step.
- **Split, synced**: for a page that changed as a whole, or a speed or
  animation difference. It halves the width, so keep it to calm pages.
- **Wipe**: for a visual change in the same layout. (No template scene yet;
  a `fade` between two `image` scenes of the same frame comes close.)
- Always: the same viewport, data and framing in both; persistent "Before" and
  "After" labels; before on the left (judgment, consistent with
  [CapCut](https://www.capcut.com/create/split-screen-effects-multi-frame-videos)).

## Camera and cursor

- Auto-zoom: about 2x; start 0.3 s before the click; hold 2.5 s; merge clicks
  under 2.5 s apart; ignore clicks in the last second; finish zooming out
  0.8 s before the end ([Cap](https://github.com/CapSoftware/Cap/blob/main/apps/desktop/src-tauri/src/recording.rs)).
  Cursorful never zooms on a lone click ([Cursorful](https://cursorful.com/welcome)).
- Camera springs that don't overshoot: Cap's stiffness 200, damping 40, mass
  2.25 settles in about 0.45 s ([Cap](https://github.com/CapSoftware/Cap/blob/main/crates/project/src/configuration.rs));
  the template's ease-in-out curve does the same job for keyframed moves.
- Cursor: bigger than life (Tella defaults to 2x,
  [Tella](https://www.tella.com/docs/help/editing/customize-animated-cursor.md));
  hide it when idle; park it off the content at the end
  ([Screen Studio](https://screen.studio/guide/cursor)).
- Click effects: a ring or ripple, never more than 3 flashes a second
  ([WCAG 2.3.1](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold)).

## Captions

- 42 characters a line, two lines at most, one preferred; 20 characters a
  second for adults; each on screen 5/6 s to 7 s
  ([Netflix](https://partnerhelp.netflixstudios.com/hc/en-us/articles/217350977-English-USA-Timed-Text-Style-Guide)).
- Prerecorded video with audio needs captions
  ([WCAG 1.2.2](https://www.w3.org/WAI/WCAG22/Understanding/captions-prerecorded)).
- Burn them in for Slack and PRs; ship `.vtt`/`.srt` for docs pages.

## Sound

- Music bed under voice: duck it about 12 dB (up to 20), attack 30 to 80 ms,
  release 250 to 700 ms.
- Loudness: -14 LUFS for social, -16 for narration
  ([Apple podcasts](https://podcasters.apple.com/support/audio-requirements)).
- Narration: 140 to 160 words a minute.
- Never make sound the only signal: most previews play muted
  ([Apple](https://developer.apple.com/app-store/app-previews/)).

## Delivery

| Where | Limits and behaviour |
|---|---|
| GitHub PR or issue | MP4, MOV or WebM; 10 MB on free plans, 100 MB on paid. `gh pr edit --body-file b.md --attach ./demo-pr.mp4` (gh 2.99+) ([docs](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files)) |
| Slack | Up to 1 GB; MP4 and MOV play inline, muted ([help](https://slack.com/help/articles/201330736-Add-files-to-Slack)) |
| Linear | Attach the MP4, or link Loom or YouTube, which embed |
| GIF | Only for a short silent loop: a 3.7 MB GIF was a 551 KB MP4 ([web.dev](https://web.dev/articles/replace-gifs-with-videos)) |

Encode H.264, yuv420p, `+faststart`, even dimensions; CRF 18 looks lossless,
23 is the default ([ffmpeg](https://trac.ffmpeg.org/wiki/Encode/H.264)).
Linear ships 1080p at 1.6 to 3.2 Mbps, 4 to 7 MB (measured). Make the poster
the "after" state or the title. Vertical (1080x1920) and square (1080x1080)
cuts need their own framing; Reels keep 14% top and 35% bottom clear.

## Anti-patterns

- Zooming on every click, or zooms that start late.
- Springy, bouncy motion on text-heavy UI.
- Cursor jitter or an idle cursor parked over the content.
- Dead air: page loads, hunting for a control, waiting on a server.
- Data that doesn't look like the real product (lorem ipsum, "Test User 1").
- A story that only works with the sound on.
- Captions faster than 20 characters a second.
- Exports in yuv444 or without faststart (they won't play inline everywhere).
- Over 90 s for a PR.
