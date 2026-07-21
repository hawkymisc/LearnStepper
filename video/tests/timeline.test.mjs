import assert from "node:assert/strict";
import test from "node:test";

import {
  DEMO_DISCLOSURE,
  FPS,
  HEIGHT,
  SCENES,
  TOTAL_DURATION_IN_FRAMES,
  WIDTH,
} from "../src/timeline.mjs";

test("the submission composition is Full HD, 30fps, and under three minutes", () => {
  assert.equal(WIDTH, 1920);
  assert.equal(HEIGHT, 1080);
  assert.equal(FPS, 30);
  assert.ok(TOTAL_DURATION_IN_FRAMES > FPS * 120);
  assert.ok(TOTAL_DURATION_IN_FRAMES < FPS * 180);
  assert.equal(
    TOTAL_DURATION_IN_FRAMES,
    SCENES.reduce((total, scene) => total + scene.durationInFrames, 0),
  );
});

test("the access-first promise leads into a substantial product demo", () => {
  assert.match(SCENES[0].headline, /where you live/i);
  assert.match(SCENES[1].headline, /ChatGPT Plus/i);
  assert.match(SCENES.at(-1).subhead, /ChatGPT Plus.*LearnStepper/i);

  const demoScenes = SCENES.filter((scene) => scene.kind === "demo");
  assert.ok(demoScenes.length >= 4);
  assert.ok(
    demoScenes.reduce((total, scene) => total + scene.durationInFrames, 0) >=
      FPS * 75,
  );
});

test("every development-screen demo carries the approved disclosure", () => {
  assert.equal(
    DEMO_DISCLOSURE,
    "Screen shown is from a work in progress.",
  );

  for (const scene of SCENES.filter((item) => item.kind === "demo")) {
    assert.equal(scene.disclosure, DEMO_DISCLOSURE, scene.id);
    assert.ok(scene.asset, `${scene.id} must use product evidence`);
  }
});

test("the inclusion message names race, gender, and location without claiming a degree", () => {
  const spokenCopy = SCENES.map((scene) => scene.narration).join(" ");

  assert.match(spokenCopy, /race/i);
  assert.match(spokenCopy, /gender/i);
  assert.match(spokenCopy, /location/i);
  assert.match(spokenCopy, /higher-education-level learning/i);
  assert.doesNotMatch(spokenCopy, /equivalent degree|replaces? (a )?university/i);
});

test("scene identifiers and time ranges are deterministic", () => {
  const ids = new Set();
  let cursor = 0;

  for (const scene of SCENES) {
    assert.ok(!ids.has(scene.id), `duplicate scene id: ${scene.id}`);
    ids.add(scene.id);
    assert.equal(scene.startFrame, cursor, scene.id);
    assert.ok(scene.durationInFrames > 0, scene.id);
    cursor += scene.durationInFrames;
  }

  assert.equal(cursor, TOTAL_DURATION_IN_FRAMES);
});
