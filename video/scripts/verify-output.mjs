import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { FPS, TOTAL_DURATION_IN_FRAMES } from "../src/timeline.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(scriptDirectory, "..", "..");
const outputDirectory = join(projectDirectory, "dist", "submission");
const qaDirectory = join(outputDirectory, "remotion-qa");
const verifyPending = process.argv.includes("--pending");
const outputStem = verifyPending
  ? "learnstepper-buildweek-remotion.pending"
  : "learnstepper-buildweek-remotion";
const videoPath = join(outputDirectory, `${outputStem}.mp4`);
const srtPath = join(outputDirectory, `${outputStem}.en.srt`);

const probe = JSON.parse(
  execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration,size:stream=index,codec_type,codec_name,width,height,r_frame_rate,pix_fmt,sample_rate,channels",
      "-of",
      "json",
      videoPath,
    ],
    { encoding: "utf8" },
  ),
);

const videoStream = probe.streams.find((stream) => stream.codec_type === "video");
const audioStream = probe.streams.find((stream) => stream.codec_type === "audio");
const duration = Number.parseFloat(probe.format.duration);
const expectedDuration = TOTAL_DURATION_IN_FRAMES / FPS;

if (videoStream?.codec_name !== "h264") throw new Error("Expected H.264 video");
if (videoStream.width !== 1920 || videoStream.height !== 1080) {
  throw new Error(`Expected 1920x1080, got ${videoStream.width}x${videoStream.height}`);
}
if (videoStream.r_frame_rate !== "30/1") throw new Error("Expected 30 fps");
if (videoStream.pix_fmt !== "yuv420p") throw new Error(`Expected yuv420p, got ${videoStream.pix_fmt}`);
if (audioStream?.codec_name !== "aac") throw new Error("Expected AAC audio");
if (audioStream.sample_rate !== "48000") throw new Error("Expected 48 kHz audio");
if (audioStream.channels !== 2) throw new Error("Expected stereo audio");
if (Math.abs(duration - expectedDuration) > 0.2) {
  throw new Error(`Expected about ${expectedDuration}s, got ${duration}s`);
}

const volumeResult = spawnSync(
  "ffmpeg",
  ["-hide_banner", "-i", videoPath, "-af", "volumedetect", "-f", "null", "-"],
  { encoding: "utf8" },
);
const volumeOutput = `${volumeResult.stdout}\n${volumeResult.stderr}`;
const peakMatch = volumeOutput.match(/max_volume:\s*(-?[\d.]+) dB/);
if (volumeResult.status !== 0 || !peakMatch) throw new Error("Unable to measure output volume");
const peakDb = Number.parseFloat(peakMatch[1]);
if (peakDb <= -30) throw new Error(`Narration is too quiet: ${peakDb} dB`);

const srt = await readFile(srtPath, "utf8");
const sourceSrt = await readFile(join(projectDirectory, "video", "public", "captions.en.srt"), "utf8");
if (srt !== sourceSrt) throw new Error("Published SRT does not match the rendered caption source");
const cueCount = srt.match(/ --> /g)?.length ?? 0;
if (cueCount !== 23 || srt.includes("NaN")) throw new Error(`Invalid SRT: ${cueCount} cues`);

await mkdir(qaDirectory, { recursive: true });
const frameTimes = [3, 34, 58, 80, 100, 118, 141, 165];
for (const seconds of frameTimes) {
  execFileSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-ss",
      String(seconds),
      "-i",
      videoPath,
      "-frames:v",
      "1",
      join(
        qaDirectory,
        `${verifyPending ? "pending" : "final"}-${String(seconds).padStart(3, "0")}.png`,
      ),
    ],
    { stdio: "inherit" },
  );
}

const fileStats = await stat(videoPath);
const summary = {
  videoPath: `${outputStem}.mp4`,
  durationSeconds: duration,
  sizeBytes: fileStats.size,
  video: videoStream,
  audio: audioStream,
  peakDb,
  srtCueCount: cueCount,
  inspectedFrameTimesSeconds: frameTimes,
};

await writeFile(
  join(outputDirectory, `${outputStem}.verify.json`),
  `${JSON.stringify(summary, null, 2)}\n`,
  "utf8",
);

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
