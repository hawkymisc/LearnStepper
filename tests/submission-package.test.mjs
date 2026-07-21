import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("README documents Build Week collaboration and judge setup", async () => {
  const readme = await read("README.md");

  for (const requiredText of [
    "## OpenAI Build Week 2026",
    "GPT-5.6",
    "How Codex accelerated the build",
    "Key product and engineering decisions",
    "During the submission period",
    "Judge quick start",
  ]) {
    assert.match(readme, new RegExp(requiredText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("Devpost draft covers every required submission field", async () => {
  const draft = await read("docs/submission/DEVPOST_SUBMISSION.md");

  for (const requiredText of [
    "Category: Education",
    "## Inspiration",
    "## What it does",
    "## How we built it",
    "## How Codex and GPT-5.6 were used",
    "## Challenges we ran into",
    "## Accomplishments that we're proud of",
    "## What we learned",
    "## What's next for LearnStepper",
    "Repository URL:",
    "Demo video URL:",
    "/feedback Session ID:",
  ]) {
    assert.ok(draft.includes(requiredText), `missing ${requiredText}`);
  }
});

test("judge guide distinguishes Build Week work and provides a no-rebuild path", async () => {
  const guide = await read("docs/submission/JUDGES_GUIDE.md");
  const evidence = await read("docs/submission/BUILD_WEEK_EVIDENCE.md");

  assert.match(guide, /macOS arm64/);
  assert.match(guide, /LearnStepper-mac-arm64\.dmg/);
  assert.match(guide, /without rebuilding/i);
  assert.match(guide, /ChatGPT/);
  assert.match(evidence, /July 13, 2026/);
  assert.match(evidence, /dated commit history/i);
  assert.match(evidence, /pre-existing work/i);
});

test("submission checklist preserves external-action checkpoints", async () => {
  const checklist = await read("docs/submission/SUBMISSION_CHECKLIST.md");

  for (const requiredText of [
    "testing@devpost.com",
    "build-week-event@openai.com",
    "YouTube",
    "public",
    "separate session",
    "/feedback",
    "Do not submit before PO approval",
  ]) {
    assert.ok(checklist.includes(requiredText), `missing ${requiredText}`);
  }
});

test("readiness report exposes every remaining handoff value", async () => {
  const readiness = await read("docs/submission/SUBMISSION_READINESS.md");

  for (const requiredText of [
    "PUBLIC YOUTUBE URL",
    "/feedback Session ID",
    "testing@devpost.com",
    "build-week-event@openai.com",
    "PO approval",
  ]) {
    assert.ok(readiness.includes(requiredText), `missing ${requiredText}`);
  }
});
