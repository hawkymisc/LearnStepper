# LearnStepper Build Week Video

Remotion source for the Devpost promotional video. The structure combines an access-first opening and closing with
an evidence-led product demonstration in the center.

## Commands

```bash
npm install
npm test
npm run assets
npm run lint
npm run dev
npm run render
```

`npm run assets` copies the approved product evidence into `public/`, generates timed English narration with the
macOS `Samantha` voice, and writes JSON captions plus the English SRT source. It requires `say`, `ffmpeg`, and
`ffprobe`. The regular `npm run render` consumes those checked assets without regenerating them, keeping review cuts
deterministic. A generated contract hash prevents rendering stale narration after timeline or voice-setting changes.
Use `npm run render:refresh-assets` only when narration or timeline copy changes.

`npm run render` creates a Remotion source encode, normalizes it to BT.709 limited-range `yuv420p`, publishes the MP4
and matching SRT only after the pending pair passes validation, and then revalidates the published container, streams,
audio level, captions, and representative frames.

The final composition is `LearnStepperBuildWeek`: 1920×1080, 30 fps, 2 minutes 53 seconds. Every product-demo scene
includes the persistent disclosure `Screen shown is from a work in progress.`

Rendered deliverables are written to `dist/submission/learnstepper-buildweek-remotion.mp4` and
`dist/submission/learnstepper-buildweek-remotion.en.srt`.
