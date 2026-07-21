import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import path from "node:path";
import test from "node:test";

import {
  bootstrapDesktop,
  createRendererLifecycle,
  desktopEnvironment,
  rendererRuntime,
  normalizeRendererUrl,
  resolveDesktopExecutable,
  sidecarRuntime,
  watchRendererProcess,
} from "../desktop/runtime.mjs";

test("starts a nonce-bound development renderer on a random loopback port", () => {
  assert.deepEqual(rendererRuntime({ packaged: false, appRoot: "/app", electronPath: "/electron", npmPath: "/npm", port: 43122, nonce: "dev-secret" }), {
    url: "http://127.0.0.1:43122/",
    command: {
      executable: "/npm",
      args: ["run", "desktop:renderer", "--", "--port", "43122"],
      environment: { LEARNSTEPPER_BOOT_NONCE: "dev-secret" },
    },
  });
});

test("starts the bundled standalone renderer on loopback in a packaged app", () => {
  const runtime = rendererRuntime({ packaged: true, appRoot: "/bundle/app", electronPath: "/bundle/Electron", port: 43123, nonce: "packaged-secret" });
  assert.equal(runtime.url, "http://127.0.0.1:43123/");
  assert.deepEqual(runtime.command, {
    executable: "/bundle/Electron",
    args: [path.join("/bundle/app", "dist/standalone/server.js")],
    environment: { ELECTRON_RUN_AS_NODE: "1", HOST: "127.0.0.1", PORT: "43123", LEARNSTEPPER_BOOT_NONCE: "packaged-secret" },
  });
});

test("normalizes trusted and sender URLs before exact comparison", () => {
  assert.equal(normalizeRendererUrl("http://127.0.0.1:43123"), "http://127.0.0.1:43123/");
  assert.equal(normalizeRendererUrl("http://127.0.0.1:43123/"), "http://127.0.0.1:43123/");
});

test("invalidates the renderer URL after child failure so activation uses recovery", () => {
  const lifecycle = createRendererLifecycle();
  lifecycle.activate("http://127.0.0.1:43123");
  assert.equal(lifecycle.current(), "http://127.0.0.1:43123/");

  lifecycle.fail();
  assert.equal(lifecycle.current(), null);
});

test("observes renderer spawn errors and exits exactly once", () => {
  const child = new EventEmitter();
  const failures = [];
  watchRendererProcess(child, (error) => failures.push(error.message));

  child.emit("error", new Error("spawn failed"));
  child.emit("exit", 1, null);

  assert.deepEqual(failures, ["spawn failed"]);
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

test("keeps uv environments and caches in writable user data", () => {
  const runtime = sidecarRuntime({
    appRoot: "/Applications/LearnStepper.app/Contents/Resources/app",
    userData: "/Users/learner/Library/Application Support/LearnStepper",
    source: { HOME: "/Users/learner" },
    exists: (candidate) => candidate === "/opt/homebrew/bin/uv" || candidate === "/opt/homebrew/bin/codex",
  });

  assert.equal(runtime.executable, "/opt/homebrew/bin/uv");
  assert.equal(runtime.environment.UV_PROJECT_ENVIRONMENT, "/Users/learner/Library/Application Support/LearnStepper/python-env");
  assert.equal(runtime.environment.UV_CACHE_DIR, "/Users/learner/Library/Application Support/LearnStepper/uv-cache");
  assert.ok(runtime.args.includes("--frozen"));
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

test("shows recovery when the renderer exits after ready but before window creation", async () => {
  const observed = [];
  const result = await bootstrapDesktop({
    startRenderer: async () => "http://127.0.0.1:43123/",
    isRendererAvailable: () => false,
    createWindow: () => observed.push("window"),
    createRecoveryWindow: (error) => observed.push(error.message),
  });

  assert.equal(result, null);
  assert.deepEqual(observed, ["Bundled Renderer stopped before window creation"]);
});
