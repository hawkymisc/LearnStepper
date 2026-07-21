import { access, copyFile, mkdir, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const videoDirectory = resolve(scriptDirectory, "..");
const projectDirectory = resolve(videoDirectory, "..");
const outputDirectory = join(projectDirectory, "dist", "submission");
const pendingVideo = join(outputDirectory, "learnstepper-buildweek-remotion.pending.mp4");
const pendingSrt = join(outputDirectory, "learnstepper-buildweek-remotion.pending.en.srt");
const finalVideo = join(outputDirectory, "learnstepper-buildweek-remotion.mp4");
const finalSrt = join(outputDirectory, "learnstepper-buildweek-remotion.en.srt");
const backupVideo = join(outputDirectory, "learnstepper-buildweek-remotion.backup.mp4");
const backupSrt = join(outputDirectory, "learnstepper-buildweek-remotion.backup.en.srt");

const exists = async (path) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

await mkdir(outputDirectory, { recursive: true });
await access(pendingVideo);
await access(pendingSrt);

const hadFinalVideo = await exists(finalVideo);
const hadFinalSrt = await exists(finalSrt);
if (hadFinalVideo) await copyFile(finalVideo, backupVideo);
if (hadFinalSrt) await copyFile(finalSrt, backupSrt);

try {
  await rename(pendingVideo, finalVideo);
  await rename(pendingSrt, finalSrt);
} catch (error) {
  if (hadFinalVideo) await copyFile(backupVideo, finalVideo);
  else await rm(finalVideo, { force: true });
  if (hadFinalSrt) await copyFile(backupSrt, finalSrt);
  else await rm(finalSrt, { force: true });
  throw error;
} finally {
  await rm(backupVideo, { force: true });
  await rm(backupSrt, { force: true });
}
