import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { createAuthenticationRefresher } from "../desktop/auth-refresh.mjs";

test("desktop authentication only refreshes external Codex CLI state", () => {
  const sources = ["../desktop/main.mjs", "../desktop/auth-refresh.mjs", "../desktop/preload.cjs", "../desktop/sidecar-client.mjs"]
    .map((relative) => readFileSync(new URL(relative, import.meta.url), "utf8"))
    .join("\n");

  assert.match(sources, /auth-refresh/);
  assert.match(sources, /refreshAuthentication/);
  assert.match(sources, /candidate = await createSidecar\(\)/);
  assert.match(sources, /previous\?\.retire\(\)/);
  assert.doesNotMatch(sources, /shell\.openExternal|account\/login\/start|auth-login|auth-cancel|auth-logout/);
  assert.equal(existsSync(new URL("../app/chatgpt-auth.ts", import.meta.url)), false);
});

test("authentication refresh coalesces callers and promotes only a verified candidate", async () => {
  let resolveRefresh;
  const oldSidecar = { retireCalls: 0, retire() { this.retireCalls += 1; } };
  const candidate = {
    closeCalls: 0,
    refreshAuthentication() {
      return new Promise((resolve) => { resolveRefresh = resolve; });
    },
    close() { this.closeCalls += 1; },
  };
  let current = oldSidecar;
  const activated = [];
  let created = 0;
  const refresh = createAuthenticationRefresher({
    createSidecar: async () => { created += 1; return candidate; },
    getCurrent: () => current,
    setCurrent: (next) => { current = next; },
    activate: (next) => activated.push(next),
  });

  const first = refresh();
  const second = refresh();
  assert.strictEqual(first, second);
  await Promise.resolve();
  assert.equal(created, 1);
  assert.strictEqual(current, oldSidecar);
  assert.deepEqual(activated, []);

  resolveRefresh({ state: "authenticated" });
  assert.deepEqual(await first, { state: "authenticated" });
  assert.strictEqual(current, candidate);
  assert.deepEqual(activated, [candidate]);
  assert.equal(oldSidecar.retireCalls, 1);
  assert.equal(candidate.closeCalls, 0);
});

test("authentication refresh failure preserves the active sidecar and closes the candidate", async () => {
  const oldSidecar = { retireCalls: 0, retire() { this.retireCalls += 1; } };
  const candidate = {
    closeCalls: 0,
    async refreshAuthentication() { throw new Error("refresh failed"); },
    close() { this.closeCalls += 1; },
  };
  let current = oldSidecar;
  const activated = [];
  const refresh = createAuthenticationRefresher({
    createSidecar: async () => candidate,
    getCurrent: () => current,
    setCurrent: (next) => { current = next; },
    activate: (next) => activated.push(next),
  });

  await assert.rejects(refresh(), /refresh failed/);
  assert.strictEqual(current, oldSidecar);
  assert.deepEqual(activated, []);
  assert.equal(oldSidecar.retireCalls, 0);
  assert.equal(candidate.closeCalls, 1);
});
