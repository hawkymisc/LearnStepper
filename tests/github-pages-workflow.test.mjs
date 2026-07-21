import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowPath = new URL("../.github/workflows/release-pages.yml", import.meta.url);
const pagePath = new URL("../pages/index.html", import.meta.url);
const packagePath = new URL("../package.json", import.meta.url);
const tsconfigPath = new URL("../tsconfig.json", import.meta.url);
const eslintConfigPath = new URL("../eslint.config.mjs", import.meta.url);

test("release workflow validates, packages, and deploys GitHub Pages on main updates", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  assert.match(workflow, /push:\s*\n\s*branches:\s*\[main\]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /npm\s+ci/);
  assert.match(workflow, /npm\s+run\s+lint/);
  assert.match(workflow, /npm\s+run\s+typecheck/);
  assert.match(workflow, /npm\s+test/);
  assert.match(workflow, /cache-dependency-path:\s*\|\s*\n\s*package-lock\.json\s*\n\s*video\/package-lock\.json/);
  assert.match(workflow, /run:\s*npm ci\s*\n\s*working-directory:\s*video/);
  assert.match(workflow, /run:\s*npm test\s*\n\s*working-directory:\s*video/);
  assert.match(workflow, /run:\s*npm run lint\s*\n\s*working-directory:\s*video/);
  assert.match(workflow, /uv run python -m unittest discover -s tests -v/);
  assert.match(workflow, /uv run --extra dev ruff check learnstepper tests/);
  assert.match(workflow, /uv run --extra dev mypy learnstepper/);
  assert.match(workflow, /astral-sh\/setup-uv/);
  assert.match(workflow, /lfs:\s*true/);
  assert.match(workflow, /sha256sum\s+-c\s+LearnStepper-mac-arm64\.dmg\.sha256/);
  assert.doesNotMatch(workflow, /npm run desktop:package/);
  const actionReferences = [...workflow.matchAll(/^\s*-\s+uses:\s*(\S+)/gm)].map((match) => match[1]);
  assert.ok(actionReferences.length > 0);
  for (const reference of actionReferences) {
    assert.match(reference, /@[0-9a-f]{40}$/);
  }
  const checkoutCount = actionReferences.filter((reference) => reference.startsWith("actions/checkout@")).length;
  const disabledCredentialCount = workflow.match(/persist-credentials:\s*false/g)?.length ?? 0;
  assert.equal(checkoutCount, 3);
  assert.equal(disabledCredentialCount, checkoutCount);
  assert.match(workflow, /actions\/upload-pages-artifact/);
  assert.match(workflow, /actions\/deploy-pages/);
  assert.doesNotMatch(workflow.split("jobs:")[0], /pages: write/);
  assert.match(workflow, /deploy-pages:[\s\S]*permissions:\s*\n\s*contents: read\s*\n\s*pages: write\s*\n\s*id-token: write/);
});

test("root TypeScript validation leaves the video package to its own toolchain", async () => {
  const tsconfig = JSON.parse(await readFile(tsconfigPath, "utf8"));
  const eslintConfig = await readFile(eslintConfigPath, "utf8");

  assert.ok(tsconfig.exclude.includes("video"));
  assert.ok(tsconfig.exclude.includes("node_modules"));
  assert.match(eslintConfig, /"video\/\*\*"/);
});

test("download page exposes the approved macOS arm64 submission artifact", async () => {
  const page = await readFile(pagePath, "utf8");

  assert.match(page, /LearnStepper/);
  assert.match(page, /macOS/);
  assert.match(page, /Apple Silicon/);
  assert.match(page, /Future Update/);
  assert.match(page, /LearnStepper-mac-arm64\.dmg\.sha256/);
  assert.match(page, /releases\/latest/);
});

test("desktop artifact names remain aligned with the download page", async () => {
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  const page = await readFile(pagePath, "utf8");

  assert.ok(page.includes("LearnStepper-mac-arm64.dmg"));
  assert.equal(packageJson.build.mac.artifactName, "${productName}-mac-arm64.${ext}");
  assert.equal(packageJson.build.win, undefined);
  assert.equal(packageJson.build.linux, undefined);
});
