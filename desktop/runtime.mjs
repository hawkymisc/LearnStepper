import { existsSync } from "node:fs";
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
  environment.PATH = [...new Set([...DESKTOP_PATHS, ...inheritedPaths])].join(path.delimiter);
  return environment;
}

export function resolveDesktopExecutable(name, environment, exists = existsSync) {
  for (const directory of (environment.PATH ?? "").split(path.delimiter)) {
    const candidate = path.join(directory, name);
    if (exists(candidate)) return candidate;
  }
  throw new Error(`${name} executable is not available in the desktop environment`);
}

export function sidecarRuntime({ appRoot, userData, source = process.env, exists = existsSync }) {
  const environment = desktopEnvironment(source);
  return {
    executable: resolveDesktopExecutable("uv", environment, exists),
    args: ["run", "--frozen", "--project", appRoot, "python", "-m", "learnstepper.desktop_service", "--data-dir", userData, "--app-root", appRoot],
    environment: {
      ...environment,
      UV_PROJECT_ENVIRONMENT: path.join(userData, "python-env"),
      UV_CACHE_DIR: path.join(userData, "uv-cache"),
    },
  };
}

export function normalizeRendererUrl(value) {
  return new URL(value).href;
}

export function createRendererLifecycle() {
  let activeUrl = null;
  return {
    activate(value) { activeUrl = normalizeRendererUrl(value); },
    fail() { activeUrl = null; },
    current() { return activeUrl; },
  };
}

export function watchRendererProcess(child, onFailure) {
  let failed = false;
  const fail = (error) => {
    if (failed) return;
    failed = true;
    onFailure(error instanceof Error ? error : new Error("Bundled Renderer stopped"));
  };
  child.once("error", fail);
  child.once("exit", (code, signal) => fail(new Error(`Bundled Renderer stopped (${code ?? signal ?? "unknown"})`)));
}

export function rendererRuntime({ packaged, appRoot, electronPath, npmPath, port, nonce }) {
  const url = normalizeRendererUrl(`http://127.0.0.1:${port}/`);
  if (!packaged) {
    return {
      url,
      command: {
        executable: npmPath,
        args: ["run", "desktop:renderer", "--", "--port", String(port)],
        environment: { LEARNSTEPPER_BOOT_NONCE: nonce },
      },
    };
  }
  return {
    url,
    command: {
      executable: electronPath,
      args: [path.join(appRoot, "dist/standalone/server.js")],
      environment: { ELECTRON_RUN_AS_NODE: "1", HOST: "127.0.0.1", PORT: String(port), LEARNSTEPPER_BOOT_NONCE: nonce },
    },
  };
}

export async function bootstrapDesktop({ startRenderer, isRendererAvailable = () => true, createWindow, createRecoveryWindow }) {
  try {
    const rendererUrl = await startRenderer();
    if (!isRendererAvailable(rendererUrl)) {
      throw new Error("Bundled Renderer stopped before window creation");
    }
    createWindow(rendererUrl);
    return rendererUrl;
  } catch (error) {
    createRecoveryWindow(error instanceof Error ? error : new Error("Renderer failed to start"));
    return null;
  }
}
