import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactName = "LearnStepper-mac-arm64.dmg";

function run(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: root, stdio: "inherit", shell: false });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(executable)} exited with ${code}`));
    });
  });
}

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function packageDesktop() {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error("LearnStepper submission packaging supports macOS arm64 only");
  }

  // Documents may be managed by File Provider, which immediately restores a
  // FinderInfo xattr that macOS rejects during code signing. Build and sign in
  // the system temp directory, then publish only the completed disk image.
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "learnstepper-package-"));
  const output = path.join(tempRoot, "release");

  try {
    await run(path.join(root, "node_modules", ".bin", "electron-builder"), [
      "--mac",
      "dmg",
      "--arm64",
      "--publish",
      "never",
      `--config.directories.output=${output}`,
    ]);

    const application = path.join(output, "mac-arm64", "LearnStepper.app");
    const sourceArtifact = path.join(output, artifactName);
    await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=4", application]);
    await stat(path.join(application, "Contents", "Resources", "bin", "learnstepper-sidecar"));

    const release = path.join(root, "release");
    const publishedArtifact = path.join(release, artifactName);
    await mkdir(release, { recursive: true });
    await copyFile(sourceArtifact, publishedArtifact);

    const sourceHash = await sha256(sourceArtifact);
    const publishedHash = await sha256(publishedArtifact);
    if (sourceHash !== publishedHash) throw new Error("Published DMG checksum mismatch");
    await writeFile(`${publishedArtifact}.sha256`, `${publishedHash}  ${artifactName}\n`, "utf8");
    process.stdout.write(`Published ${publishedArtifact}\nSHA256 ${publishedHash}\n`);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

await packageDesktop();
