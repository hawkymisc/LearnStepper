import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the adult eligibility gate before resolving a host bridge", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);

  const html = await response.text();
  assert.match(html, /<html[^>]+lang="ja"/i);
  assert.match(html, /<title>LearnStepper/);
  assert.match(html, /18歳以上の方が利用できます/);
  assert.match(html, /18歳以上であることを確認して進む/);
  assert.doesNotMatch(html, /ローカルデータを確認しています/);
  assert.doesNotMatch(html, /この画面の操作は保存されません/);
});

test("does not ship temporary starter content or sensitive credentials", async () => {
  const response = await render();
  const html = await response.text();

  assert.doesNotMatch(html, /Your site is taking shape|Building your site/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/);
  assert.doesNotMatch(html, /access[_-]?token|api[_-]?key|bearer\s+[a-z0-9]/i);
});
