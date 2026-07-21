export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;
export const DEMO_DISCLOSURE = "Screen shown is from a work in progress.";

const seconds = (value) => value * FPS;

const sceneDefinitions = [
  {
    id: "access",
    kind: "message",
    durationInFrames: seconds(12),
    eyebrow: "ACCESS SHOULD START WITH CURIOSITY",
    headline: "Where you live should not decide what you can learn.",
    subhead: "Education should begin with curiosity — not circumstance.",
    narrationChunks: [
      "Where you live should not decide what you can learn.",
      "Neither should your race, your gender, or your location determine the opportunities available to you.",
    ],
  },
  {
    id: "promise",
    kind: "message",
    durationInFrames: seconds(15),
    eyebrow: "ONE SUBSCRIPTION. ONE LEARNING WORKSPACE.",
    headline: "ChatGPT Plus. Meet LearnStepper.",
    subhead: "A personal path to higher-education-level learning.",
    narrationChunks: [
      "With a ChatGPT Plus plan and LearnStepper, a question can become a personal learning path.",
      "A path toward higher-education-level learning, built around your goal and your pace.",
    ],
  },
  {
    id: "goal",
    kind: "demo",
    durationInFrames: seconds(18),
    eyebrow: "01  START WITH A GOAL",
    headline: "Turn any topic into a place to learn.",
    subhead: "Create a focused project with an outcome you can return to.",
    asset: "installed-project-created-1440x900.png",
    focus: "center",
    disclosure: DEMO_DISCLOSURE,
    narrationChunks: [
      "Start with a topic and a concrete outcome.",
      "LearnStepper turns that intention into a persistent project instead of another disposable chat.",
      "Your learning has a place, a purpose, and a next step.",
    ],
  },
  {
    id: "learning-loop",
    kind: "demo",
    durationInFrames: seconds(28),
    eyebrow: "02  LEARN IN CONTEXT",
    headline: "Move from answers to a learning loop.",
    subhead: "Objective, plan, conversation, and continuity — in one workspace.",
    asset: "option-a-real-ai-response-1440x928.png",
    focus: "right",
    disclosure: DEMO_DISCLOSURE,
    narrationChunks: [
      "Inside the workspace, a saved objective and an actionable plan frame the lesson.",
      "The learner can ask for a simpler explanation, request an example, check understanding, or return to the lesson.",
      "Live tutoring connects through the external Codex CLI using the learner's ChatGPT sign-in.",
      "Confirmed conversation items are stored locally, so a learning thread can survive interruption and restart.",
    ],
  },
  {
    id: "evidence",
    kind: "demo",
    durationInFrames: seconds(20),
    eyebrow: "03  PROGRESS YOU CAN INSPECT",
    headline: "Evidence, not estimates.",
    subhead: "Objectives, success criteria, and saved evidence stay connected.",
    asset: "objectives-evidence-1440x900.png",
    focus: "center",
    disclosure: DEMO_DISCLOSURE,
    narrationChunks: [
      "Progress is not a confidence animation.",
      "LearnStepper separates objectives, evidence, and attainment, and self-report alone cannot create mastery.",
      "The learner can inspect what supports an achievement and what still needs proof.",
    ],
  },
  {
    id: "progress",
    kind: "demo",
    durationInFrames: seconds(18),
    eyebrow: "04  KNOW THE NEXT STEP",
    headline: "See what is known. See what comes next.",
    subhead: "Confirmed work becomes an honest picture of progress.",
    asset: "progress-1440x900.png",
    focus: "left",
    disclosure: DEMO_DISCLOSURE,
    narrationChunks: [
      "The progress view summarizes confirmed work without inventing certainty.",
      "Learners can see what is complete, what remains unevaluated, and where to continue next.",
    ],
  },
  {
    id: "continuity",
    kind: "demo",
    durationInFrames: seconds(18),
    eyebrow: "05  RETURN TOMORROW",
    headline: "Close the app. Keep the learning.",
    subhead: "Local records return after restart; credentials remain with Codex.",
    asset: "installed-project-persisted-after-restart-1440x900.png",
    focus: "center",
    disclosure: DEMO_DISCLOSURE,
    narrationChunks: [
      "Quit the application, reopen it, and the project returns.",
      "Learning records stay in local SQLite storage, while ChatGPT credentials stay with the external Codex CLI.",
    ],
  },
  {
    id: "buildweek",
    kind: "proof",
    durationInFrames: seconds(28),
    eyebrow: "BUILT DURING OPENAI BUILD WEEK",
    headline: "Product judgment, accelerated by Codex.",
    subhead: "React · Electron · Python · SQLite · Codex App Server",
    metrics: [
      ["202 / 202", "automated tests"],
      ["0.144.5", "required Codex CLI"],
      ["Local-first", "learning records"],
    ],
    narrationChunks: [
      "GPT-5.6 through Codex helped turn product requirements into tests and working boundaries across React, Electron, Python, and SQLite.",
      "It exercised failure paths, reviewed the interface, and packaged a standalone macOS app around a version-pinned Codex App Server adapter.",
      "The owner made the scope and privacy decisions. Codex accelerated the path to a verified product.",
    ],
  },
  {
    id: "close",
    kind: "close",
    durationInFrames: seconds(16),
    eyebrow: "LEARNSTEPPER",
    headline: "The next step should be yours.",
    subhead: "ChatGPT Plus + LearnStepper · A personal path to higher-education-level learning.",
    narrationChunks: [
      "Whatever your race, gender, or location, the next step in your education should be yours.",
      "LearnStepper. A personal path to higher-education-level learning, powered by ChatGPT Plus.",
    ],
  },
];

let startFrame = 0;

export const SCENES = sceneDefinitions.map((scene) => {
  const withTimeline = {
    ...scene,
    startFrame,
    narration: scene.narrationChunks.join(" "),
  };
  startFrame += scene.durationInFrames;
  return withTimeline;
});

export const TOTAL_DURATION_IN_FRAMES = startFrame;
