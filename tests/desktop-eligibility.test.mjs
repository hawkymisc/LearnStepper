import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createEligibilityGate } from "../desktop/eligibility.mjs";

test("does not initialize host services before confirmation and denies protected IPC", async () => {
  let starts = 0;
  const gate = createEligibilityGate(async () => { starts += 1; });

  assert.equal(gate.acknowledged, false);
  assert.equal(starts, 0);
  await assert.rejects(gate.requireReady(), /adult eligibility confirmation is required/i);
  assert.equal(starts, 0);
});

test("confirmation initializes host services once and is idempotent", async () => {
  let starts = 0;
  let release;
  const startPending = new Promise((resolve) => { release = resolve; });
  const gate = createEligibilityGate(async () => {
    starts += 1;
    await startPending;
  });

  const first = gate.confirm();
  const second = gate.confirm();
  assert.equal(gate.acknowledged, true);
  assert.equal(starts, 0, "initialization is scheduled after confirmation returns control");
  release();
  await Promise.all([first, second, gate.requireReady()]);
  assert.equal(starts, 1);
});

test("failed initialization can be retried without persisting acknowledgement across process gates", async () => {
  let starts = 0;
  const firstProcess = createEligibilityGate(async () => {
    starts += 1;
    if (starts === 1) throw new Error("sidecar unavailable");
  });

  await assert.rejects(firstProcess.confirm(), /sidecar unavailable/);
  await firstProcess.confirm();
  assert.equal(starts, 2);
  await firstProcess.requireReady();

  const relaunchedProcess = createEligibilityGate(async () => { starts += 1; });
  assert.equal(relaunchedProcess.acknowledged, false);
  await assert.rejects(relaunchedProcess.requireReady(), /adult eligibility confirmation is required/i);
  assert.equal(starts, 2);
});

test("Electron wiring exposes only confirmation bootstrap before protected bridge use", async () => {
  const [main, preloadModule, preloadCommonJs] = await Promise.all([
    readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8"),
    readFile(new URL("../desktop/preload.mjs", import.meta.url), "utf8"),
    readFile(new URL("../desktop/preload.cjs", import.meta.url), "utf8"),
  ]);

  assert.match(main, /createEligibilityGate\(startSidecar\)/);
  assert.doesNotMatch(main, /sidecarReady\s*=\s*startSidecar\(\)/);
  assert.match(main, /learnstepper:eligibility-confirm/);
  assert.match(main, /await eligibilityGate\.requireReady\(\)/);
  for (const preload of [preloadModule, preloadCommonJs]) {
    assert.match(preload, /learnstepperEligibility/);
    assert.match(preload, /learnstepper:eligibility-confirm/);
  }
});
