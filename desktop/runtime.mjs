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

export function codexRuntime({ packaged, resourcesPath, userData, source = process.env, exists = existsSync }) {
  const environment = desktopEnvironment(source);
  const executable = packaged
    ? path.join(resourcesPath, "bin", "codex")
    : resolveDesktopExecutable("codex", environment, exists);
  return {
    executable,
    environment: { ...environment, CODEX_HOME: path.join(userData, "codex") },
  };
}

export function sidecarRuntime({ packaged = false, appRoot, resourcesPath = "", userData, source = process.env, exists = existsSync }) {
  const codex = codexRuntime({ packaged, resourcesPath, userData, source, exists });
  if (packaged) {
    return {
      executable: path.join(resourcesPath, "bin", "learnstepper-sidecar"),
      args: ["--data-dir", userData, "--app-root", appRoot, "--codex-executable", codex.executable],
      environment: codex.environment,
    };
  }
  const environment = desktopEnvironment(source);
  return {
    executable: resolveDesktopExecutable("uv", environment, exists),
    args: ["run", "--frozen", "--project", appRoot, "python", "-m", "learnstepper.desktop_service", "--data-dir", userData, "--app-root", appRoot, "--codex-executable", codex.executable],
    environment: {
      ...codex.environment,
      UV_PROJECT_ENVIRONMENT: path.join(userData, "python-env"),
      UV_CACHE_DIR: path.join(userData, "uv-cache"),
    },
  };
}

const TRUSTED_LOGIN_HOSTS = new Set(["auth.openai.com", "chatgpt.com", "auth.chatgpt.com"]);

export function validateCodexLoginUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("Codex returned an untrusted login URL"); }
  if (url.protocol !== "https:" || !TRUSTED_LOGIN_HOSTS.has(url.hostname) || url.username || url.password) {
    throw new Error("Codex returned an untrusted login URL");
  }
  return url.toString();
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
