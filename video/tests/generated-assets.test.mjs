import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

import { SCENES } from "../src/timeline.mjs";
import {
  ASSET_CONTRACT_FILENAME,
  calculateAssetContractHash,
} from "../scripts/asset-contract.mjs";

test("generated narration assets match the current timeline contract", async () => {
  const manifest = JSON.parse(
    await readFile(new URL(`../public/${ASSET_CONTRACT_FILENAME}`, import.meta.url), "utf8"),
  );

  assert.equal(manifest.hash, calculateAssetContractHash());
});

test("generated captions have finite, ordered time ranges", async () => {
  const captions = JSON.parse(
    await readFile(new URL("../public/captions.json", import.meta.url), "utf8"),
  );
  const expectedCount = SCENES.reduce(
    (total, scene) => total + scene.narrationChunks.length,
    0,
  );

  assert.equal(captions.length, expectedCount);
  for (const [index, caption] of captions.entries()) {
    assert.ok(Number.isFinite(caption.startMs), caption.text);
    assert.ok(Number.isFinite(caption.endMs), caption.text);
    assert.ok(caption.endMs > caption.startMs, caption.text);
    if (index > 0) {
      assert.ok(
        captions[index - 1].endMs <= caption.startMs,
        `captions overlap: ${captions[index - 1].text} / ${caption.text}`,
      );
    }
  }
});

test("generated SRT contains one cue for every caption", async () => {
  const srt = await readFile(
    new URL("../public/captions.en.srt", import.meta.url),
    "utf8",
  );

  assert.ok(!srt.includes("NaN"));
  assert.equal(
    srt.match(/ --> /g)?.length,
    SCENES.reduce((total, scene) => total + scene.narrationChunks.length, 0),
  );
});

test("generated narration contains audible speech", () => {
  const result = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-i",
      new URL("../public/narration.wav", import.meta.url).pathname,
      "-af",
      "volumedetect",
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8" },
  );
  const output = `${result.stdout}\n${result.stderr}`;
  const match = output.match(/max_volume:\s*(-?[\d.]+) dB/);

  assert.equal(result.status, 0, output);
  assert.ok(match, output);
  assert.ok(Number.parseFloat(match[1]) > -60, `narration is effectively silent: ${match[1]} dB`);
});
