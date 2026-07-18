import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("implements the P0 learning journey from dashboard through progress", async () => {
  const prototype = await source("app/prototype-client.tsx");

  for (const screen of [
    "dashboard",
    "lesson",
    "exercise",
    "progress",
    "remediation",
  ]) {
    assert.match(prototype, new RegExp(`data-screen=["'{].*${screen}`, "s"));
  }

  for (const action of [
    "学習を再開",
    "演習を始める",
    "進捗を見る",
    "補習を始める",
    "元のレッスンへ戻る",
  ]) {
    assert.match(prototype, new RegExp(action));
  }
});

test("keeps the learner oriented and grounded", async () => {
  const prototype = await source("app/prototype-client.tsx");

  for (const label of [
    "ホーム",
    "学習",
    "進捗",
    "ライブラリ",
    "設定",
    "現在地",
    "今回の目標",
    "成功基準",
    "根拠資料",
    "できる",
    "わかる",
  ]) {
    assert.match(prototype, new RegExp(label));
  }

  assert.match(prototype, /aria-live="polite"/);
  assert.match(prototype, /aria-current=/);
  assert.match(prototype, /文部科学省/);
  assert.match(prototype, /取得済み・検証済み/);
});

test("provides explicit generation, offline, and responsive states", async () => {
  const [prototype, css] = await Promise.all([
    source("app/prototype-client.tsx"),
    source("app/globals.css"),
  ]);

  assert.match(prototype, /生成中/);
  assert.match(prototype, /生成を停止/);
  assert.match(prototype, /オフライン/);
  assert.match(prototype, /保存済みの内容は閲覧できます/);
  assert.match(css, /@media\s*\(max-width:\s*1100px\)/);
  assert.match(css, /@media\s*\(max-width:\s*720px\)/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
});

test("removes the temporary starter product surface", async () => {
  const [page, layout, packageJson] = await Promise.all([
    source("app/page.tsx"),
    source("app/layout.tsx"),
    source("package.json"),
  ]);

  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);
  assert.doesNotMatch(layout, /Starter Project/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.match(layout, /LearnStepper/);
  assert.match(layout, /lang="ja"/);
});
