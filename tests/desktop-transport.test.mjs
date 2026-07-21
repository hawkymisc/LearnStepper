import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import { SidecarClient } from "../desktop/sidecar-client.mjs";

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.killed = false;
  child.kill = () => { child.killed = true; };
  child.stdin = { writes: [], write(value) { this.writes.push(value); return true; } };
  return child;
}

test("correlates multiple sidecar responses and forwards typed events", async () => {
  const child = fakeChild();
  const client = new SidecarClient(child, () => "frame-1");
  const events = [];
  client.subscribe((event) => events.push(event));

  const response = client.invoke({ type: "query", name: "profile.get", payload: {} });
  assert.deepEqual(JSON.parse(child.stdin.writes[0]), {
    id: "frame-1",
    envelope: { type: "query", name: "profile.get", payload: {} },
  });
  child.stdout.write(`${JSON.stringify({ type: "event", event: { sequence: 1, name: "turn.completed" } })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "response", id: "frame-1", response: { ok: true, data: { id: "profile-1" } } })}\n`);

  assert.deepEqual(await response, { ok: true, data: { id: "profile-1" } });
  assert.deepEqual(events, [{ sequence: 1, name: "turn.completed" }]);
});

test("rejects outstanding work when the sidecar exits", async () => {
  const child = fakeChild();
  const client = new SidecarClient(child, () => "frame-2");
  const response = client.invoke({ type: "query", name: "project.list", payload: {} });
  child.emit("exit", 1);

  await assert.rejects(response, /sidecar stopped/i);
});

test("correlates responses that arrive in reverse order", async () => {
  const child = fakeChild();
  const ids = ["frame-a", "frame-b"];
  const client = new SidecarClient(child, () => ids.shift());
  const first = client.invoke({ type: "query", name: "profile.get", payload: {} });
  const second = client.invoke({ type: "query", name: "project.list", payload: {} });

  child.stdout.write(`${JSON.stringify({ type: "response", id: "frame-b", response: { ok: true, data: { item: 2 } } })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "response", id: "frame-a", response: { ok: true, data: { item: 1 } } })}\n`);

  assert.deepEqual(await first, { ok: true, data: { item: 1 } });
  assert.deepEqual(await second, { ok: true, data: { item: 2 } });
});

test("fails closed on malformed or oversized JSONL output", async (t) => {
  await t.test("malformed JSON", async () => {
    const child = fakeChild();
    const client = new SidecarClient(child, () => "malformed");
    const response = client.status();
    child.stdout.write("not-json\n");
    await assert.rejects(response, /protocol/i);
    assert.equal(child.killed, true);
  });

  await t.test("oversized line", async () => {
    const child = fakeChild();
    const client = new SidecarClient(child, () => "oversized", { maxLineBytes: 32 });
    const response = client.status();
    child.stdout.write("x".repeat(33));
    await assert.rejects(response, /maximum line size/i);
    assert.equal(child.killed, true);
  });
});

test("times out an unresponsive sidecar request", async () => {
  const child = fakeChild();
  const client = new SidecarClient(child, () => "timeout", { requestTimeoutMs: 10 });

  await assert.rejects(client.status(), /timed out/i);
});

test("correlates sanitized authentication responses", async () => {
  const child = fakeChild();
  const client = new SidecarClient(child, () => "auth-1");
  const response = client.startLogin();
  assert.deepEqual(JSON.parse(child.stdin.writes[0]), { id: "auth-1", type: "auth", action: "login" });
  child.stdout.write(`${JSON.stringify({ type: "auth", id: "auth-1", authentication: { state: "awaiting_browser", auth_url: "https://auth.openai.com/codex" } })}\n`);
  assert.deepEqual(await response, { state: "awaiting_browser", auth_url: "https://auth.openai.com/codex" });
});
