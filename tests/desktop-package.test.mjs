import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";

import {
  assertSupportedBuildPlatform,
  runtimeLayout,
} from "../scripts/prepare-desktop-runtime.mjs";

test("prepares only the sidecar runtime expected by Electron", () => {
  const layout = runtimeLayout("/repo");
  assert.equal(layout.codex, undefined);
  assert.equal(layout.sidecar, path.join("/repo", "build", "runtime", "bin", "learnstepper-sidecar"));
});

test("fails closed outside the approved macOS arm64 submission target", () => {
  assert.doesNotThrow(() => assertSupportedBuildPlatform("darwin", "arm64"));
  assert.throws(() => assertSupportedBuildPlatform("darwin", "x64"), /macOS arm64 only/);
  assert.throws(() => assertSupportedBuildPlatform("win32", "x64"), /macOS arm64 only/);
});

test("electron package ships the sidecar but not Codex for macOS arm64", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.deepEqual(packageJson.build.mac.target, [{ target: "dmg", arch: ["arm64"] }]);
  assert.equal(packageJson.build.win, undefined);
  assert.equal(packageJson.build.linux, undefined);
  assert.deepEqual(packageJson.build.extraResources, [
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
  assert.doesNotMatch(packagingScript, /Resources["'],\s*["']bin["'],\s*["']codex["']/);
  assert.match(afterPackScript, /plutil/);
  assert.match(afterPackScript, /NSAllowsArbitraryLoads/);
  assert.match(afterPackScript, /NSCameraUsageDescription/);
});

test("release workflow publishes the locally verified DMG without rebuilding or embedding Codex", () => {
  const workflow = readFileSync(new URL("../.github/workflows/release-pages.yml", import.meta.url), "utf8");

  assert.match(workflow, /name: Publish verified macOS arm64[\s\S]*?lfs:\s*true/);
  assert.match(workflow, /sha256sum\s+-c\s+LearnStepper-mac-arm64\.dmg\.sha256/);
  assert.doesNotMatch(workflow, /npm run desktop:package/);
  assert.doesNotMatch(workflow, /npm install --global @openai\/codex/);
  assert.doesNotMatch(workflow, /codex-aarch64-apple-darwin|CODEX_EXECUTABLE|rust-v0\.144\.5/);
});

test("README explains why an external Codex CLI is required", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

  assert.match(readme, /Codex CLI 0\.144\.5/);
  assert.match(readme, /codex login --device-auth/);
  assert.match(readme, /ChatGPT.*アプリ.*代替.*できません/s);
  assert.match(readme, /同梱していません/);
});

test("does not bundle product telemetry or crash-reporting clients", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const dependencyNames = Object.keys({ ...packageJson.dependencies, ...packageJson.devDependencies });
  assert.deepEqual(
    dependencyNames.filter((name) => /sentry|datadog|segment|posthog|mixpanel|amplitude|telemetry/i.test(name)),
    [],
  );

  const productSources = [
    "../app/frontend/learnstepper-app.tsx",
    "../app/frontend/bridge/ipc-client.ts",
    "../desktop/main.mjs",
    "../learnstepper/desktop_service.py",
  ].map((relative) => readFileSync(new URL(relative, import.meta.url), "utf8")).join("\n");
  assert.doesNotMatch(productSources, /navigator\.sendBeacon|Sentry\.|posthog\.|mixpanel\.|amplitude\.|datadog/i);
});
