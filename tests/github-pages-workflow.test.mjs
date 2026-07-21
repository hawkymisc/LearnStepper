import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowPath = new URL("../.github/workflows/release-pages.yml", import.meta.url);
const pagePath = new URL("../pages/index.html", import.meta.url);
const packagePath = new URL("../package.json", import.meta.url);

test("release workflow validates, packages, and deploys GitHub Pages on main updates", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  assert.match(workflow, /push:\s*\n\s*branches:\s*\[main\]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /npm\s+ci/);
  assert.match(workflow, /npm\s+run\s+lint/);
  assert.match(workflow, /npm\s+run\s+typecheck/);
  assert.match(workflow, /npm\s+test/);
  assert.match(workflow, /uv run python -m unittest discover -s tests -v/);
  assert.match(workflow, /uv run --extra dev ruff check learnstepper tests/);
  assert.match(workflow, /uv run --extra dev mypy learnstepper/);
  assert.match(workflow, /astral-sh\/setup-uv/);
  assert.match(workflow, /npm run desktop:package/);
  assert.match(workflow, /actions\/upload-pages-artifact/);
  assert.match(workflow, /actions\/deploy-pages/);
  assert.doesNotMatch(workflow.split("jobs:")[0], /pages: write/);
  assert.match(workflow, /deploy-pages:[\s\S]*permissions:\s*\n\s*contents: read\s*\n\s*pages: write\s*\n\s*id-token: write/);
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
