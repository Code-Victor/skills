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

It records in the background. No browser window opens and nothing takes focus,
so you can keep working while it runs. The agent writes one file, `demo.json`,
which holds both the recordings to make and the scenes to cut them into, and
runs one command.

### Ask for it like this

- "Make a before/after video of this fix for the PR."
- "Record a 45 second tour of the new settings page for Slack."
- "Here's a screen recording. Make it look better."

### How it works

1. **Plan.** The agent writes the story in beats and sets up stand-in data, so
   no real customer ends up on screen. It looks at each page once with
   `capture.mjs scout`, which lists every control with a ready-to-paste target.
2. **Write.** It writes `demo.json`: the takes (a URL and the cursor steps for
   each) and the scenes (title, issue card, clips, captions, end card).
3. **Run.** One command, `node scripts/demo.mjs demo.json`, checks the file
   and lists every problem at once. It rehearses each take in seconds, so a
   wrong target stops there with the closest matches. Then it records in a
   background Chrome at 2x with true 60fps: the cursor changes shape over
   links and text and ripples on click, typing runs at a human pace, and
   anything private can be blurred.
4. **Direct and render.** An auto-camera reads what happened in each take
   (clicks, typing, scrolls) and zooms in on the action, the way Screen Studio
   does. The whole video is then rendered on the GPU, with transitions,
   captions and callouts. [Remotion](https://remotion.dev) with
   [remocn](https://remocn.dev) is an optional second renderer, for the tilted
   3D product shot.
5. **Deliver.** A copy small enough for a pull request, captions (`.vtt` and
   `.srt`), chapters, a poster image, an optional GIF, a contact sheet to
   review the result, and a check that catches frozen or black stretches.

Run the same command again and it redoes only what changed. Edit a caption,
a trim or the camera and nothing is recorded again; change a take, or tell it
the app changed, and only that take is.

### How long it takes

I measured one video on an Apple M2 Pro: 34 seconds at 1080p60, three takes.
The earlier version of this skill needed about 10 minutes of machine time,
spread across 17 or more separate agent steps (open a browser, record each
take, direct the camera, check, render, deliver). The current version ran in
85 seconds as one command. Changing a caption and running it again took 22
seconds. That is one machine and one video, so treat it as an example, not a
promise.

### What you can put in a video

Title cards, issue cards that quote the bug as it was reported, recorded
clips, before and after side by side, stills, and changelog or end cards.
Clips take timed captions and callouts, and the video can carry music,
narration and your logo.

### Requirements

- Node 22 or newer, ffmpeg, and Google Chrome or Chromium. There is nothing
  to install with npm.
- Optional, for the Remotion renderer: npm and network access. Remotion is
  free for individuals, non-profits and companies of up to 3 people. Larger
  companies need a [Company License](https://remotion.pro/license). The
  default renderer needs no license.

If your app needs a login, the agent opens one window once so you can sign in,
then goes back to recording in the background.

The scripts are bash and Node. I wrote and tested them on macOS. They also
look for Chrome in the usual Linux locations.

It records web apps, including mobile web. For a native or desktop app, record
the screen yourself and hand over the MP4: any MP4 works as a clip.

### Works well with

These are optional. The agent uses them when they are installed.

```bash
npx skills add Remocn/remocn              # the catalog of transitions and text effects
npx skills add remotion-dev/skills        # general Remotion rules
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
    scripts/      demo (the one command), capture, compose, auto-camera,
                  deliver, and the optional Remotion scripts
    references/   details the agent loads when it needs them
    template/     the Remotion project the optional renderer starts from
    examples/     a sample demo.json and a sample video.json
```

Every skill is one folder under `skills/`.

## Feedback

Found a bug, or have an idea that would make a skill better? Open an
[issue](https://github.com/Code-Victor/skills/issues) or a pull request.

## License

[MIT](LICENSE) © Hamzat Victor
