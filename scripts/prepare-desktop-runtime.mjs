import { mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function runtimeLayout(root) {
  const runtimeRoot = path.join(root, "build", "runtime");
  return {
    root: runtimeRoot,
    bin: path.join(runtimeRoot, "bin"),
    sidecar: path.join(runtimeRoot, "bin", "learnstepper-sidecar"),
    pyinstaller: path.join(runtimeRoot, "pyinstaller"),
  };
}

export function assertSupportedBuildPlatform(platform = process.platform, arch = process.arch) {
  if (platform !== "darwin" || arch !== "arm64") {
    throw new Error(`Hackathon packaging supports macOS arm64 only; received ${platform} ${arch}`);
  }
}

function run(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ["ignore", "pipe", "pipe"], ...options });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${path.basename(executable)} exited with ${code}: ${stderr.trim()}`));
    });
  });
}

export async function prepareDesktopRuntime({ root }) {
  assertSupportedBuildPlatform();
  const layout = runtimeLayout(root);
  await rm(layout.root, { recursive: true, force: true });
  await mkdir(layout.bin, { recursive: true });

  await run("uv", [
    "run",
    "--extra",
    "dev",
    "pyinstaller",
    "--noconfirm",
    "--clean",
    "--onefile",
    "--name",
    "learnstepper-sidecar",
    "--distpath",
    layout.bin,
    "--workpath",
    layout.pyinstaller,
    "--specpath",
    layout.pyinstaller,
    "--paths",
    root,
    path.join(root, "learnstepper", "desktop_service.py"),
  ], { cwd: root });

  return { ...layout, platform: os.platform(), arch: os.arch() };
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  const root = path.resolve(path.dirname(modulePath), "..");
  prepareDesktopRuntime({ root })
    .then((result) => process.stdout.write(`Prepared LearnStepper sidecar for ${result.platform} ${result.arch}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
