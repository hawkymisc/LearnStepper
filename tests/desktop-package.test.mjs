import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";

import {
  PINNED_CODEX_VERSION,
  PINNED_CODEX_SHA256,
  assertSupportedBuildPlatform,
  parseCodexVersion,
  resolveBuildExecutable,
  runtimeLayout,
} from "../scripts/prepare-desktop-runtime.mjs";

test("pins and validates the bundled Codex protocol version", () => {
  assert.equal(PINNED_CODEX_VERSION, "0.144.5");
  assert.equal(PINNED_CODEX_SHA256, "5e29ab10ca1171be158f7335dd6bd8ce1aaf9af1556939db36a5ee338be6f5f2");
  assert.equal(parseCodexVersion("codex-cli 0.144.5\n"), "0.144.5");
  assert.throws(() => parseCodexVersion("codex-cli 0.145.0\n"), /0\.144\.5 is required/);
});

test("prepares the exact extraResources layout expected by Electron", () => {
  const layout = runtimeLayout("/repo");
  assert.equal(layout.codex, path.join("/repo", "build", "runtime", "bin", "codex"));
  assert.equal(layout.sidecar, path.join("/repo", "build", "runtime", "bin", "learnstepper-sidecar"));
});

test("resolves the Codex build input from PATH without shell evaluation", () => {
  assert.equal(resolveBuildExecutable("codex", "/missing:/tools", (candidate) => candidate === "/tools/codex"), "/tools/codex");
  assert.throws(() => resolveBuildExecutable("missing-codex", "/missing", () => false), /unavailable/);
});

test("fails closed outside the approved macOS arm64 submission target", () => {
  assert.doesNotThrow(() => assertSupportedBuildPlatform("darwin", "arm64"));
  assert.throws(() => assertSupportedBuildPlatform("darwin", "x64"), /macOS arm64 only/);
  assert.throws(() => assertSupportedBuildPlatform("win32", "x64"), /macOS arm64 only/);
});

test("electron package ships the two runtime executables for macOS arm64 only", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.deepEqual(packageJson.build.mac.target, [{ target: "dmg", arch: ["arm64"] }]);
  assert.equal(packageJson.build.win, undefined);
  assert.equal(packageJson.build.linux, undefined);
  assert.deepEqual(packageJson.build.extraResources, [
    { from: "build/runtime/bin/codex", to: "bin/codex" },
    { from: "build/runtime/bin/learnstepper-sidecar", to: "bin/learnstepper-sidecar" },
  ]);
  assert.equal(packageJson.build.afterPack, "scripts/after-pack.cjs");
  assert.equal(packageJson.build.mac.icon, "assets/learnstepper-icon-source.png");
  assert.equal(packageJson.build.mac.category, "public.app-category.education");
  assert.equal(packageJson.build.mac.extendInfo.NSAppTransportSecurity.NSAllowsArbitraryLoads, false);
  assert.equal(existsSync(new URL("../assets/learnstepper-icon-source.png", import.meta.url)), true);
});

test("desktop packaging signs outside File Provider storage and verifies before publishing", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const packagingScript = readFileSync(new URL("../scripts/package-desktop.mjs", import.meta.url), "utf8");
  const afterPackScript = readFileSync(new URL("../scripts/after-pack.cjs", import.meta.url), "utf8");

  assert.match(packageJson.scripts["desktop:package"], /node scripts\/package-desktop\.mjs/);
  assert.match(packagingScript, /mkdtemp/);
  assert.match(packagingScript, /codesign/);
  assert.match(packagingScript, /--verify/);
  assert.match(packagingScript, /copyFile/);
  assert.match(afterPackScript, /plutil/);
  assert.match(afterPackScript, /NSAllowsArbitraryLoads/);
  assert.match(afterPackScript, /NSCameraUsageDescription/);
});
