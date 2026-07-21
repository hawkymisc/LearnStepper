import { randomUUID } from "node:crypto";

const DEFAULT_MAX_LINE_BYTES = 1024 * 1024;
const DEFAULT_MAX_PENDING = 128;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_TIMED_OUT_IDS = 128;

export class SidecarClient {
  #child;
  #idFactory;
  #pending = new Map();
  #listeners = new Set();
  #buffer = "";
  #closed = false;
  #maxLineBytes;
  #maxPending;
  #requestTimeoutMs;
  #timedOutIds = new Set();
  #maxTimedOutIds;

  constructor(child, idFactory = randomUUID, options = {}) {
    this.#child = child;
    this.#idFactory = idFactory;
    this.#maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
    this.#maxPending = options.maxPending ?? DEFAULT_MAX_PENDING;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.#maxTimedOutIds = options.maxTimedOutIds ?? DEFAULT_MAX_TIMED_OUT_IDS;
    child.stdout.on("data", (chunk) => this.#consume(chunk));
    child.once("error", (error) => this.#stop(error));
    child.once("exit", () => this.#stop(new Error("LearnStepper sidecar stopped")));
  }

  invoke(envelope) {
    return this.#request({ envelope });
  }

  status() {
    return this.#request({ type: "status" }).then((frame) => frame.status);
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  close() {
    this.#stop(new Error("LearnStepper sidecar stopped"));
    if (!this.#child.killed) this.#child.kill();
  }

  #request(body) {
    if (this.#closed) return Promise.reject(new Error("LearnStepper sidecar stopped"));
    if (this.#pending.size >= this.#maxPending) return Promise.reject(new Error("LearnStepper sidecar has too many pending requests"));
    const id = this.#idFactory();
    const serialized = `${JSON.stringify({ id, ...body })}\n`;
    if (Buffer.byteLength(serialized, "utf8") > this.#maxLineBytes) {
      return Promise.reject(new Error("LearnStepper sidecar request exceeded the maximum line size"));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        this.#rememberTimedOutId(id);
        reject(new Error("LearnStepper sidecar request timed out"));
      }, this.#requestTimeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      try {
        this.#child.stdin.write(serialized);
      } catch (error) {
        this.#pending.delete(id);
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  #consume(chunk) {
    this.#buffer += chunk.toString("utf8");
    if (Buffer.byteLength(this.#buffer, "utf8") > this.#maxLineBytes && !this.#buffer.includes("\n")) {
      this.#protocolFailure("LearnStepper sidecar exceeded the maximum line size");
      return;
    }
    let newline = this.#buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.#buffer.slice(0, newline);
      this.#buffer = this.#buffer.slice(newline + 1);
      if (Buffer.byteLength(line, "utf8") > this.#maxLineBytes) {
        this.#protocolFailure("LearnStepper sidecar exceeded the maximum line size");
        return;
      }
      this.#handleLine(line);
      if (this.#closed) return;
      newline = this.#buffer.indexOf("\n");
    }
  }

  #handleLine(line) {
    let frame;
    try {
      frame = JSON.parse(line);
    } catch {
      this.#protocolFailure("LearnStepper sidecar protocol returned malformed JSON");
      return;
    }
    if (frame?.type === "event" && frame.event && typeof frame.event === "object") {
      for (const listener of this.#listeners) listener(frame.event);
      return;
    }
    if ((frame?.type !== "response" && frame?.type !== "status") || typeof frame.id !== "string") {
      this.#protocolFailure("LearnStepper sidecar protocol returned an invalid frame");
      return;
    }
    const pending = this.#pending.get(frame.id);
    if (!pending) {
      if (this.#timedOutIds.delete(frame.id)) return;
      this.#protocolFailure("LearnStepper sidecar protocol returned an unexpected id");
      return;
    }
    this.#pending.delete(frame.id);
    clearTimeout(pending.timer);
    if (frame.type === "response" && frame.response) pending.resolve(frame.response);
    else if (frame.type === "status" && frame.status) pending.resolve(frame);
    else pending.reject(new Error("LearnStepper sidecar returned an invalid frame"));
  }

  #stop(error) {
    if (this.#closed) return;
    this.#closed = true;
    for (const { reject, timer } of this.#pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    this.#pending.clear();
    this.#timedOutIds.clear();
  }

  #rememberTimedOutId(id) {
    this.#timedOutIds.add(id);
    while (this.#timedOutIds.size > this.#maxTimedOutIds) {
      const oldest = this.#timedOutIds.values().next().value;
      this.#timedOutIds.delete(oldest);
    }
  }

  #protocolFailure(message) {
    this.#stop(new Error(message));
    if (!this.#child.killed) this.#child.kill();
  }
}
