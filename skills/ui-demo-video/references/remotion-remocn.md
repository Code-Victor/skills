# Polished path: Remotion + remocn

`scripts/new-remotion.sh <dir>` gives you a Remotion project where
`src/video.json` drives one composition, `DemoVideo`:

| File | Role |
|---|---|
| `src/video.json` | The video: theme, scenes, captions, callouts, transitions, sound. |
| `src/types.ts` | Its type, every option documented. Extend here first when adding a feature. |
| `src/DemoVideo.tsx` | `TransitionSeries` over the scenes, the logo, the soundtrack (music bed with ducking, per-scene narration). |
| `src/scenes.tsx` | One view per scene type: clip, split, image, issue, list, title. `Camera` (the 2D push-in inside the window) and `CaptionBand` (timed captions) are shared. |
| `src/Callouts.tsx` | Rings and spotlights that ride with the camera. |
| `src/timeline.ts` | `sceneSpans`: where each scene starts and ends once transitions overlap. Used by the soundtrack. |
| `src/transitions.ts` | Transition names to remocn presentations, with natural lengths. |
| `src/Caption.tsx` | The caption pill. |
| `src/Logo.tsx`, `src/font.ts` | The corner mark; the font. |
| `src/Root.tsx` | Composition + `calculateMetadata` (length from the scenes). |
| `remotion.config.ts` | PNG frames, `@/` alias for remocn, Tailwind. |
| `src/components/remocn/*` | remocn components, copied in. You own and may edit them. |

Preview with `npm run dev` (Remotion Studio: scrub, tweak `video.json`, it
hot-reloads). Render with `scripts/render.sh <dir> draft|final` (it checks `video.json`
first); by hand, `npx remotion render DemoVideo out/demo.mp4 --crf=16
--color-space=bt709`, and `--scale=1.5` for a 2880x1620 master.

## remocn

remocn (remocn.dev, MIT) is a shadcn-style registry of Remotion components:
typography, transitions, backgrounds, UI primitives, cursors. Components are
copied into `src/components/remocn/` by:

```bash
npx shadcn@latest add @remocn/<name> --yes
```

(the template's `components.json` registers `@remocn` ->
`https://remocn.dev/r/{name}.json`).

**Don't guess props.** The catalog changes. Read the live index, then the
component page:

- Index, with "use for / avoid for", natural length and vibe per component:
  `https://remocn.dev/llms-components.txt`
- One component: its docs URL plus `.md`, for example
  `https://remocn.dev/docs/transitions/whip-pan.md`

For deeper remocn work, install its own agent skill:
`npx skills add Remocn/remocn --yes`. For general Remotion rules (no
`Math.random()`, animate with `useCurrentFrame` and `interpolate`), see the
`remotion-best-practices` skill if it's installed.

## What the template already uses

| Component | Where | Notes |
|---|---|---|
| `backdrop` | every scene background | `fill={{ type: "gradient", value }}`; any React element works as a live background. |
| `stage` | clip scenes with `"frame": "stage"` | Perspective plane + camera. `moves` keys are frames in Stage; `video.json` uses `atSec` and the template converts. Template tilt is gentler than Stage's defaults (6 / -10 instead of 14 / -20) so UI stays readable. Hero moments only. |
| (none) | clip and image scenes with `"frame": "flat"` + `moves` | The template's own 2D camera (`scenes.tsx`, `Camera`): scale and translate inside the rounded window, eased in-out, clamped to the recording's edges. `scripts/auto-camera.mjs` writes these moves from a take's events. |
| `zoom-blur`, `whip-pan`, `push-through`, `focus-pull` | gaps | Mapped in `src/transitions.ts` with each one's natural length. Add a transition there (and to `check-video.mjs`'s list) to make it available by name. |
| `soft-blur-in`, `word-push`, `micro-scale-fade` | title `effect` | remocn type counts 30 fps frames; the template passes `speed = 30 / fps` so the timing holds at 60 fps. |

Adding a component: add its name to `COMPONENTS` in `scripts/new-remotion.sh`
(the base cache rebuilds once), import it in `template/src`, and expose it
through `types.ts`. Read its page first; props and natural lengths are on it.

## Good upgrades, by intent

Check each one's page before using it:

| Want | Try |
|---|---|
| Faster, energetic cuts between peers | `whip-pan` |
| "Zoom into this feature" cut | `push-through` |
| Calm, premium cut | `focus-pull` |
| Background that moves | `shader-grain-gradient` or `shader-mesh-gradient` as `Backdrop` fill |
| Point at something | `ink-arrow` |
| Static screenshot that should feel alive | `drift`, or `stage` with slow moves |
| Synthetic cursor over a screenshot (no live capture) | `simulated-cursor` |

## Taste rules (from remocn's own guidance, and they hold)

- One accent color. Sentence-case text. No gradient text, glow halos or
  letter-spaced caps on your own additions.
- One story, not a component showcase: hook, what changed, proof, done.
- Camera moves should land on what the caption talks about, and hold there
  long enough to read.
