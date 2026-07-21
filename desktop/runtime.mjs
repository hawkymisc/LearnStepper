import { accessSync, constants, statSync } from "node:fs";
import path from "node:path";

const SAFE_ENVIRONMENT_NAMES = ["HOME", "LANG", "LC_ALL", "TMPDIR", "USER", "CODEX_HOME"];
const DESKTOP_PATHS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];

export function desktopEnvironment(source = process.env) {
  const environment = Object.fromEntries(
    SAFE_ENVIRONMENT_NAMES
      .filter((name) => source[name])
      .map((name) => [name, source[name]]),
  );
  const inheritedPaths = (source.PATH ?? "").split(path.delimiter).filter(Boolean);
  const userPaths = source.HOME
    ? [path.join(source.HOME, ".local", "bin"), path.join(source.HOME, ".npm-global", "bin")]
    : [];
  environment.PATH = [...new Set([...userPaths, ...DESKTOP_PATHS, ...inheritedPaths])].join(path.delimiter);
  return environment;
}

function isExecutableFile(candidate) {
  try {
    accessSync(candidate, constants.X_OK);
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

export function resolveDesktopExecutable(name, environment, exists = isExecutableFile) {
  for (const directory of (environment.PATH ?? "").split(path.delimiter)) {
    const candidate = path.join(directory, name);
    if (exists(candidate)) return candidate;
  }
  throw new Error(`${name} executable is not available in the desktop environment`);
}

export function codexRuntime({ source = process.env, exists = isExecutableFile }) {
  const environment = desktopEnvironment(source);
  let executable = null;
  try {
    executable = resolveDesktopExecutable("codex", environment, exists);
  } catch {
    // The sidecar remains available for local-only features and reports the missing CLI.
  }
  return { executable, environment };
}

export function sidecarRuntime({ packaged = false, appRoot, resourcesPath = "", userData, source = process.env, exists = isExecutableFile }) {
  const codex = codexRuntime({ source, exists });
  const serviceArgs = ["--data-dir", userData, "--app-root", appRoot];
  if (codex.executable) serviceArgs.push("--codex-executable", codex.executable);
  if (packaged) {
    return {
      executable: path.join(resourcesPath, "bin", "learnstepper-sidecar"),
      args: serviceArgs,
      environment: codex.environment,
    };
  }
  const environment = desktopEnvironment(source);
  return {
    executable: resolveDesktopExecutable("uv", environment, exists),
    args: ["run", "--frozen", "--project", appRoot, "python", "-m", "learnstepper.desktop_service", ...serviceArgs],
    environment: {
      ...codex.environment,
      UV_PROJECT_ENVIRONMENT: path.join(userData, "python-env"),
      UV_CACHE_DIR: path.join(userData, "uv-cache"),
    },
  };
}

export function rendererRuntime({ packaged, appRoot, electronPath, port = 3010, launchToken = "development" }) {
  if (!packaged) return { url: "http://localhost:3010", command: null };
  return {
    url: `http://127.0.0.1:${port}/`,
    command: {
      executable: electronPath,
      args: [path.join(appRoot, "dist/standalone/server.js")],
      environment: { ELECTRON_RUN_AS_NODE: "1", HOST: "127.0.0.1", PORT: String(port), LEARNSTEPPER_RENDERER_TOKEN: launchToken },
    },
  };
}

export function rendererLifetime(child, onUnexpectedExit) {
  let trusted = false;
  let stopping = false;
  let exited = child.exitCode !== null;
  child.once("exit", () => {
    exited = true;
    if (trusted && !stopping) onUnexpectedExit();
  });
  return {
    trust() {
      if (exited) throw new Error("Bundled Renderer stopped before it became trusted");
      trusted = true;
    },
    stop() {
      stopping = true;
    },
  };
}

export async function bootstrapDesktop({ startRenderer, createWindow, createRecoveryWindow }) {
  try {
    const rendererUrl = await startRenderer();
    createWindow(rendererUrl);
    return rendererUrl;
  } catch (error) {
    createRecoveryWindow(error instanceof Error ? error : new Error("Renderer failed to start"));
    return null;
  }
}
