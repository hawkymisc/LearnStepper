import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const videoDirectory = resolve(scriptDirectory, "..");
const outputDirectory = resolve(videoDirectory, "..", "dist", "submission");

await mkdir(outputDirectory, { recursive: true });
await copyFile(
  join(videoDirectory, "public", "captions.en.srt"),
  join(outputDirectory, "learnstepper-buildweek-remotion.pending.en.srt"),
);
