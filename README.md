# Skills

Agent skills I built for my own work, shared so you can use them too.

They follow the open [Agent Skills](https://agentskills.io) format, so they
work in Claude Code, Codex, Cursor and most other coding agents.

Made by [Hamzat Victor](https://hamz.at)
([@Code-Victor](https://github.com/Code-Victor) on GitHub,
[@TheFireAndCode](https://x.com/TheFireAndCode) on X).

## Install

```bash
npx skills add Code-Victor/skills --skill ui-demo-video
```

The installer asks which agents to install to, and whether you want the skill
in this project only or in every project (`-g`).

To see everything in this repo before installing:

```bash
npx skills add Code-Victor/skills --list
```

## Skills

| Skill | What it does |
| --- | --- |
| [ui-demo-video](skills/ui-demo-video) | Turns UI work into a product video that looks edited: bug-fix before/afters, feature tours, changelogs. |

More will be added over time.

## ui-demo-video

You fixed a bug or shipped a feature, and now you have to show it. Ask your
agent for a video. It records your real app in a real browser, then cuts the
recording into something worth posting in a pull request or in Slack.

### Ask for it like this

- "Make a before/after video of this fix for the PR."
- "Record a 45 second tour of the new settings page for Slack."
- "Here's a screen recording. Make it look better."

### How it works

1. **Plan.** The agent writes the story in beats and sets up stand-in data, so
   no real customer ends up on screen.
2. **Capture.** It drives Chrome and records at 2x with lossless frames and
   true 60fps. The cursor changes shape over links and text and ripples on
   click, typing runs at a human pace, and anything private can be blurred.
3. **Direct.** One `video.json` describes the whole video. An auto-camera
   reads what happened in each take (clicks, typing, scrolls) and zooms in on
   the action, the way Screen Studio does.
4. **Render.** ffmpeg for a quick first cut in a minute or two, or Remotion
   with [remocn](https://remocn.dev) for the polished version with camera
   moves, side-by-side scenes and transitions.
5. **Deliver.** A copy small enough for a pull request, captions (`.vtt` and
   `.srt`), chapters, a poster image, an optional GIF, and a check that
   catches frozen or black stretches.

### What you can put in a video

Title cards, issue cards that quote the bug as it was reported, recorded
clips, before and after side by side, stills, and changelog or end cards.
Clips take timed captions and callouts, and the video can carry music,
narration and your logo.

### Requirements

- Node 22 or newer, ffmpeg, and Google Chrome or Chromium.
- For the Remotion path: npm and network access. Remotion is free for
  individuals, non-profits and companies of up to 3 people. Larger companies
  need a [Company License](https://remotion.pro/license). The ffmpeg path
  needs no license.
- Optional: the [agent-browser](https://github.com/vercel-labs/agent-browser)
  CLI, 0.37 or newer (`npm i -g agent-browser`), which the agent uses to look
  around a page before recording it.

The scripts are bash and Node. I wrote and tested them on macOS. They also
look for Chrome in the usual Linux locations.

It records web apps, including mobile web. For a native or desktop app, record
the screen yourself and hand over the MP4: any MP4 works as a clip.

### Works well with

These are optional. The agent uses them when they are installed.

```bash
npx skills add Remocn/remocn              # the catalog of transitions and text effects
npx skills add remotion-dev/skills        # general Remotion rules
npx skills add vercel-labs/agent-browser  # how to drive the agent-browser CLI
```

## Update or remove

```bash
npx skills update ui-demo-video
npx skills remove ui-demo-video
```

## What's in this repo

```
skills/
  ui-demo-video/
    SKILL.md      the instructions the agent reads
    scripts/      capture, auto-camera, assemble, render, deliver
    references/   details the agent loads when it needs them
    template/     the Remotion project the polished path starts from
    examples/     a sample video.json
```

Every skill is one folder under `skills/`.

## Feedback

Found a bug, or have an idea that would make a skill better? Open an
[issue](https://github.com/Code-Victor/skills/issues) or a pull request.

## License

[MIT](LICENSE) © Hamzat Victor
