import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  bootstrapDesktop,
  codexRuntime,
  desktopEnvironment,
  rendererRuntime,
  rendererLifetime,
  resolveDesktopExecutable,
  sidecarRuntime,
  validateCodexLoginUrl,
} from "../desktop/runtime.mjs";

test("invalidates a trusted renderer when its child process exits", () => {
  let exitHandler;
  const child = { exitCode: null, once: (event, handler) => { assert.equal(event, "exit"); exitHandler = handler; } };
  const events = [];
  const lifetime = rendererLifetime(child, () => events.push("invalidated"));

  lifetime.trust();
  exitHandler();
  assert.deepEqual(events, ["invalidated"]);
});

test("does not recover the renderer during an intentional shutdown", () => {
  let exitHandler;
  const child = { exitCode: null, once: (_event, handler) => { exitHandler = handler; } };
  const events = [];
  const lifetime = rendererLifetime(child, () => events.push("invalidated"));

  lifetime.trust();
  lifetime.stop();
  exitHandler();
  assert.deepEqual(events, []);
});

test("uses the development server only outside a packaged app", () => {
  assert.deepEqual(rendererRuntime({ packaged: false, appRoot: "/app", electronPath: "/electron" }), {
    url: "http://localhost:3010",
    command: null,
  });
});

test("starts the bundled standalone renderer on loopback with a private launch handshake", () => {
  const runtime = rendererRuntime({ packaged: true, appRoot: "/bundle/app", electronPath: "/bundle/Electron", port: 43123, launchToken: "secret-token" });
  assert.equal(runtime.url, "http://127.0.0.1:43123/");
  assert.deepEqual(runtime.command, {
    executable: "/bundle/Electron",
    args: [path.join("/bundle/app", "dist/standalone/server.js")],
    environment: { ELECTRON_RUN_AS_NODE: "1", HOST: "127.0.0.1", PORT: "43123", LEARNSTEPPER_RENDERER_TOKEN: "secret-token" },
  });
});

test("resolves Homebrew tools when a Finder launch has no shell PATH", () => {
  const existing = new Set(["/opt/homebrew/bin/uv"]);
  const environment = desktopEnvironment({ HOME: "/Users/learner" });

  assert.match(environment.PATH, /^\/opt\/homebrew\/bin:/);
  assert.equal(
    resolveDesktopExecutable("uv", environment, (candidate) => existing.has(candidate)),
    "/opt/homebrew/bin/uv",
  );
});

test("fails explicitly when a required desktop executable is unavailable", () => {
  assert.throws(
    () => resolveDesktopExecutable("uv", desktopEnvironment({}), () => false),
    /uv executable is not available/,
  );
});

test("uses only bundled executables and app-owned credentials in a packaged app", () => {
  const runtime = sidecarRuntime({
    packaged: true,
    appRoot: "/Applications/LearnStepper.app/Contents/Resources/app",
    resourcesPath: "/Applications/LearnStepper.app/Contents/Resources",
    userData: "/Users/learner/Library/Application Support/LearnStepper",
  });

  assert.equal(runtime.executable, "/Applications/LearnStepper.app/Contents/Resources/bin/learnstepper-sidecar");
  assert.deepEqual(runtime.args.slice(-2), ["--codex-executable", "/Applications/LearnStepper.app/Contents/Resources/bin/codex"]);
  assert.equal(runtime.environment.CODEX_HOME, "/Users/learner/Library/Application Support/LearnStepper/codex");
});

test("pins Codex credentials to the macOS keychain and never falls back to PATH in packaged mode", () => {
  const runtime = codexRuntime({
    packaged: true,
    resourcesPath: "/Applications/LearnStepper.app/Contents/Resources",
    userData: "/Users/learner/Library/Application Support/LearnStepper",
  });
  assert.equal(runtime.executable, "/Applications/LearnStepper.app/Contents/Resources/bin/codex");
  assert.equal(runtime.args, undefined);
});

test("allows only official HTTPS Codex login destinations", () => {
  assert.equal(validateCodexLoginUrl("https://auth.openai.com/codex"), "https://auth.openai.com/codex");
  assert.equal(validateCodexLoginUrl("https://chatgpt.com/auth"), "https://chatgpt.com/auth");
  assert.throws(() => validateCodexLoginUrl("http://auth.openai.com/codex"), /trusted/);
  assert.throws(() => validateCodexLoginUrl("https://openai.example/codex"), /trusted/);
});

test("shows a recovery window when the bundled renderer cannot start", async () => {
  const observed = [];
  const result = await bootstrapDesktop({
    startRenderer: async () => { throw new Error("renderer failed"); },
    createWindow: () => observed.push("window"),
    createRecoveryWindow: (error) => observed.push(error.message),
  });

  assert.equal(result, null);
  assert.deepEqual(observed, ["renderer failed"]);
});
