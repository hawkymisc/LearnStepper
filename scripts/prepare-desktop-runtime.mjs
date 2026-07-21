import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PINNED_CODEX_VERSION = "0.144.5";
export const PINNED_CODEX_SHA256 = "5e29ab10ca1171be158f7335dd6bd8ce1aaf9af1556939db36a5ee338be6f5f2";

export function runtimeLayout(root) {
  const runtimeRoot = path.join(root, "build", "runtime");
  return {
    root: runtimeRoot,
    bin: path.join(runtimeRoot, "bin"),
    codex: path.join(runtimeRoot, "bin", "codex"),
    sidecar: path.join(runtimeRoot, "bin", "learnstepper-sidecar"),
    pyinstaller: path.join(runtimeRoot, "pyinstaller"),
  };
}

export function assertSupportedBuildPlatform(platform = process.platform, arch = process.arch) {
  if (platform !== "darwin" || arch !== "arm64") {
    throw new Error(`Hackathon packaging supports macOS arm64 only; received ${platform} ${arch}`);
  }
}

export function parseCodexVersion(output) {
  const match = /^codex-cli\s+(\d+\.\d+\.\d+)\s*$/m.exec(output);
  if (!match) throw new Error("Unable to determine bundled Codex version");
  if (match[1] !== PINNED_CODEX_VERSION) {
    throw new Error(`Codex ${PINNED_CODEX_VERSION} is required; received ${match[1]}`);
  }
  return match[1];
}

export function resolveBuildExecutable(value, environmentPath = process.env.PATH ?? "", exists = existsSync) {
  if (path.isAbsolute(value) || value.includes(path.sep)) {
    if (!exists(value)) throw new Error(`Required build executable is unavailable: ${value}`);
    return path.resolve(value);
  }
  for (const directory of environmentPath.split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, value);
    if (exists(candidate)) return candidate;
  }
  throw new Error(`Required build executable is unavailable: ${value}`);
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

export function fileSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const input = createReadStream(filePath);
    input.on("error", reject);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolve(hash.digest("hex")));
  });
}

export async function prepareDesktopRuntime({ root, codexExecutable = process.env.CODEX_EXECUTABLE || "codex" }) {
  assertSupportedBuildPlatform();
  const codexSource = resolveBuildExecutable(codexExecutable);
  const layout = runtimeLayout(root);
  await rm(layout.root, { recursive: true, force: true });
  await mkdir(layout.bin, { recursive: true });

  const version = await run(codexSource, ["--version"]);
  parseCodexVersion(version.stdout);
  const architecture = await run("file", [codexSource]);
  if (!/Mach-O 64-bit executable arm64/.test(architecture.stdout)) {
    throw new Error("Codex executable must be a macOS arm64 standalone binary");
  }
  if (await fileSha256(codexSource) !== PINNED_CODEX_SHA256) {
    throw new Error("Codex executable SHA-256 does not match the pinned official artifact");
  }
  await copyFile(codexSource, layout.codex);
  await chmod(layout.codex, 0o755);
  if (await fileSha256(layout.codex) !== PINNED_CODEX_SHA256) {
    throw new Error("Copied Codex executable failed SHA-256 verification");
  }

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

  return { ...layout, codexVersion: PINNED_CODEX_VERSION, platform: os.platform(), arch: os.arch() };
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  const root = path.resolve(path.dirname(modulePath), "..");
  prepareDesktopRuntime({ root })
    .then((result) => process.stdout.write(`Prepared Codex ${result.codexVersion} and LearnStepper sidecar for ${result.platform} ${result.arch}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
