# Video Verification Baseline

## Target

- Composition: `LearnStepperBuildWeek`
- Runtime: 173 seconds, below the Devpost three-minute limit
- Container: MP4
- Video: H.264, 1920×1080, 30 fps, yuv420p-compatible playback
- Audio: AAC, audible English narration
- Captions: burned into the picture plus an English SRT sidecar

## Acceptance criteria

1. `ffprobe` reports one H.264 Full HD video stream and one AAC audio stream.
2. Runtime is within 0.2 seconds of the composition timeline.
3. Audio peak is above -30 dB and is not silent.
4. Representative frames cover the access hook, product demonstration, evidence, continuity, Build Week proof,
   and closing message without overlap or clipping.
5. Every frame showing application evidence visibly includes `Screen shown is from a work in progress.`
6. Burned-in captions remain readable and do not cover the development disclosure.
7. The SRT contains 23 ordered cues and no invalid timestamp.

## Known unknowns before PO review

- The macOS `Samantha` voice is a first-cut narration; pronunciation and tone require human listening.
- The current video cut uses the authenticated packaged-app tutor conversation captured at
  `docs/evidence/option-a-real-ai-response-1440x928.png` as its live-learning evidence.
- Full-sequence pacing and emotional impact require PO playback; automated checks cover correctness, not intent.

## Verification result

Automated and representative-frame inspection passed on 2026-07-22.

- Runtime: 173.056 seconds
- File size: 34,404,416 bytes
- MP4 SHA-256: `3c5ca0c9b0a5fa3d24142b84ea4118f90f3a7823d9e1e5a8d1e661a3fb99fe56`
- SRT SHA-256: `31afb3216f3c222b23043a3ab49d6c4f13ddfd8ca8af2d1b418b3f6428249fae`
- Video: H.264, 1920×1080, 30 fps, yuv420p
- Audio: AAC, 48 kHz, stereo, -4.4 dB peak
- Captions: 23 burned-in cues plus 23-cue English SRT
- Source checks: 9 tests passed; ESLint and TypeScript passed
- Visual samples: eight final-output frames inspected, including the live AI response, all five demo screens, Build
  Week proof, and closing; no clipping or disclosure overlap found

PO playback remains pending for narration tone, pacing, and message effectiveness.
