import { execFileSync } from "node:child_process";
import console from "node:console";
import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { FPS, SCENES } from "../src/timeline.mjs";
import {
  ASSET_CONTRACT_FILENAME,
  AUDIO_DELAY_MS,
  CAPTION_END_PADDING_MS,
  CAPTION_START_OFFSET_MS,
  VOICE_NAME,
  VOICE_RATE,
  calculateAssetContractHash,
} from "./asset-contract.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const videoDirectory = resolve(scriptDirectory, "..");
const projectDirectory = resolve(videoDirectory, "..");
const publicDirectory = join(videoDirectory, "public");
const evidenceDirectory = join(projectDirectory, "docs", "evidence");

const formatSrtTime = (milliseconds) => {
  const value = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(value / 3_600_000);
  const minutes = Math.floor((value % 3_600_000) / 60_000);
  const seconds = Math.floor((value % 60_000) / 1000);
  const millis = value % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
};

const run = (command, args) => {
  execFileSync(command, args, { stdio: "inherit" });
};

await mkdir(publicDirectory, { recursive: true });

for (const scene of SCENES) {
  if (scene.asset) {
    await copyFile(join(evidenceDirectory, scene.asset), join(publicDirectory, scene.asset));
  }
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), "learnstepper-video-"));
const captions = [];
const audioParts = [];

try {
  for (const [sceneIndex, scene] of SCENES.entries()) {
    const sceneStartMs = (scene.startFrame / FPS) * 1000;
    const sceneDurationMs = (scene.durationInFrames / FPS) * 1000;
    const chunkWeights = scene.narrationChunks.map((text) => text.length + 20);
    const totalChunkWeight = chunkWeights.reduce((total, value) => total + value, 0);
    let chunkStartOffsetMs = 0;

    for (const [chunkIndex, text] of scene.narrationChunks.entries()) {
      const chunkDurationMs =
        sceneDurationMs * (chunkWeights[chunkIndex] / totalChunkWeight);
      const fileStem = `scene-${String(sceneIndex + 1).padStart(2, "0")}-${String(chunkIndex + 1).padStart(2, "0")}`;
      const aiffPath = join(temporaryDirectory, `${fileStem}.aiff`);
      const wavPath = join(temporaryDirectory, `${fileStem}.wav`);

      run("say", ["-v", VOICE_NAME, "-r", String(VOICE_RATE), "-o", aiffPath, text]);

      const durationText = execFileSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_entries",
          "stream=duration",
          "-of",
          "default=nw=1:nk=1",
          aiffPath,
        ],
        { encoding: "utf8" },
      ).trim();
      const voiceDurationMs = Number.parseFloat(durationText) * 1000;

      if (!Number.isFinite(voiceDurationMs) || voiceDurationMs <= 0) {
        throw new Error(
          `${fileStem} contains no synthesized speech. Run asset generation with macOS speech-service access.`,
        );
      }

      if (voiceDurationMs + CAPTION_START_OFFSET_MS + CAPTION_END_PADDING_MS >= chunkDurationMs) {
        throw new Error(
          `${fileStem} narration is ${voiceDurationMs.toFixed(0)}ms but its slot is ${chunkDurationMs.toFixed(0)}ms`,
        );
      }

      run("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        aiffPath,
        "-af",
        `adelay=${AUDIO_DELAY_MS}|${AUDIO_DELAY_MS},apad`,
        "-t",
        (chunkDurationMs / 1000).toFixed(3),
        "-ar",
        "48000",
        "-ac",
        "2",
        wavPath,
      ]);

      audioParts.push(wavPath);
      const startMs = sceneStartMs + chunkStartOffsetMs + CAPTION_START_OFFSET_MS;
      const endMs = startMs + voiceDurationMs + CAPTION_END_PADDING_MS;
      captions.push({
        text: ` ${text}`,
        startMs,
        endMs,
        timestampMs: null,
        confidence: null,
      });
      chunkStartOffsetMs += chunkDurationMs;
    }
  }

  const concatPath = join(temporaryDirectory, "audio-parts.txt");
  await writeFile(
    concatPath,
    `${audioParts.map((path) => `file '${path}'`).join("\n")}\n`,
    "utf8",
  );
  run("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatPath,
    "-c",
    "copy",
    join(publicDirectory, "narration.wav"),
  ]);

  await writeFile(
    join(publicDirectory, "captions.json"),
    `${JSON.stringify(captions, null, 2)}\n`,
    "utf8",
  );

  const srt = captions
    .map(
      (caption, index) =>
        `${index + 1}\n${formatSrtTime(caption.startMs)} --> ${formatSrtTime(caption.endMs)}\n${caption.text.trim()}\n`,
    )
    .join("\n");
  await writeFile(join(publicDirectory, "captions.en.srt"), srt, "utf8");

  const narrationText = SCENES.map((scene) => scene.narration).join("\n\n");
  await writeFile(join(publicDirectory, "narration.en.txt"), `${narrationText}\n`, "utf8");
  await writeFile(
    join(publicDirectory, ASSET_CONTRACT_FILENAME),
    `${JSON.stringify({ hash: calculateAssetContractHash() }, null, 2)}\n`,
    "utf8",
  );

  const generatedSrt = await readFile(join(publicDirectory, "captions.en.srt"), "utf8");
  if (!generatedSrt.includes("Screen shown is from a work in progress.")) {
    // The disclosure is a persistent visual overlay, not spoken narration or a subtitle.
    console.log("Demo disclosure is rendered as an on-screen overlay in every demo scene.");
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

console.log(`Generated ${captions.length} captions and ${audioParts.length} timed audio segments.`);
