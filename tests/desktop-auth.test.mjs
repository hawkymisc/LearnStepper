import assert from "node:assert/strict";
import test from "node:test";

import { beginChatGPTLogin } from "../desktop/auth.mjs";

test("opens a validated Codex URL and returns only renderer-safe state", async () => {
  const opened = [];
  const sidecar = {
    startLogin: async () => ({ state: "awaiting_browser", auth_url: "https://auth.openai.com/codex" }),
    cancelLogin: async () => assert.fail("must not cancel a successful browser launch"),
  };
  assert.deepEqual(await beginChatGPTLogin({ sidecar, openExternal: async (url) => opened.push(url) }), { state: "awaiting_browser" });
  assert.deepEqual(opened, ["https://auth.openai.com/codex"]);
});

test("cancels the active Codex login when URL validation or browser launch fails", async (t) => {
  for (const [name, authUrl, openExternal] of [
    ["untrusted URL", "https://example.test/login", async () => assert.fail("must not open")],
    ["browser failure", "https://auth.openai.com/codex", async () => { throw new Error("browser failed"); }],
  ]) {
    await t.test(name, async () => {
      let cancelled = 0;
      const sidecar = { startLogin: async () => ({ state: "awaiting_browser", auth_url: authUrl }), cancelLogin: async () => { cancelled += 1; } };
      await assert.rejects(beginChatGPTLogin({ sidecar, openExternal }));
      assert.equal(cancelled, 1);
    });
  }
});
