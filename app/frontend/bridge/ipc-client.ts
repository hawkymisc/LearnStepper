export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export type QueryEnvelope = {
  type: "query";
  name: string;
  payload: JsonObject;
};

export type CommandEnvelope = {
  type: "command";
  name: string;
  request_id: string;
  payload: JsonObject;
};

export type IPCEnvelope = QueryEnvelope | CommandEnvelope;

export type IPCFailure = {
  code: string;
  message: string;
  request_id?: string;
  retry_after?: string;
};

export type IPCResponse<T extends JsonValue = JsonValue> =
  | { ok: true; data: T }
  | { ok: false; error: IPCFailure };

export type RendererEvent = {
  sequence: number;
  name: string;
  occurred_at: string;
  request_id?: string;
  project_id?: string;
  session_id?: string;
  thread_id?: string;
  turn_id?: string;
  item_id?: string;
  payload: JsonObject;
};

export type HostRuntimeStatus = {
  core: "available" | "unavailable" | "checking";
  database: "available" | "unavailable" | "checking";
  codexCli: "available" | "missing" | "unsupported" | "checking";
  appServer: "available" | "unavailable" | "checking";
  authentication: "authenticated" | "unauthenticated" | "error" | "checking";
};

export type HostAuthenticationResult = {
  state: "authenticated" | "unauthenticated" | "error";
};

export type HostBridge = {
  invoke(envelope: IPCEnvelope): Promise<IPCResponse>;
  subscribe?(listener: (event: RendererEvent) => void): () => void;
  getRuntimeStatus?(): Promise<HostRuntimeStatus>;
  refreshChatGPTLogin?(): Promise<HostAuthenticationResult>;
};

export type HostEligibilityBridge = {
  confirm(): Promise<{ state: "ready" }>;
};

const USER_MESSAGES: Record<string, string> = {
  VALIDATION_ERROR: "入力内容を確認してください。",
  NOT_FOUND: "対象のデータが見つかりません。",
  INVALID_STATE_TRANSITION: "現在の状態ではこの操作を実行できません。",
  IDEMPOTENCY_CONFLICT: "同じ操作の再送内容が変わっています。画面を更新してやり直してください。",
  AUTH_REQUIRED: "ChatGPTへの再ログインが必要です。",
  OFFLINE: "ネットワーク接続が必要な操作です。入力内容は保持されています。",
  APP_SERVER_UNAVAILABLE: "AI機能へ接続できません。保存済みデータは引き続き利用できます。",
  RECONCILIATION_CONFLICT: "会話履歴の差異を自動解決できませんでした。ローカル履歴は変更されていません。",
  RESPONSE_TOO_LARGE: "表示対象が大きすぎます。範囲を絞ってください。",
  NOT_IMPLEMENTED: "この操作は現在利用できません。",
  INTERNAL_ERROR: "ローカル処理で問題が発生しました。安全のため操作は完了していません。",
};

export class IPCError extends Error {
  readonly code: string;
  readonly requestId?: string;
  readonly retryAfter?: string;
  readonly userMessage: string;

  constructor(failure: IPCFailure) {
    super(USER_MESSAGES[failure.code] ?? "処理を完了できませんでした。もう一度お試しください。");
    this.name = "IPCError";
    this.code = failure.code;
    this.requestId = failure.request_id;
    this.retryAfter = failure.retry_after;
    this.userMessage = this.message;
  }
}

function defaultRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function unwrap<T extends JsonValue>(response: IPCResponse): Promise<T> {
  if (!response.ok) throw new IPCError(response.error);
  return response.data as T;
}

export function createIPCClient(bridge: HostBridge, requestIdFactory: () => string = defaultRequestId) {
  return {
    async query<T extends JsonValue = JsonValue>(name: string, payload: JsonObject): Promise<T> {
      return unwrap<T>(await bridge.invoke({ type: "query", name, payload }));
    },

    async command<T extends JsonValue = JsonValue>(
      name: string,
      payload: JsonObject,
      requestId: string = requestIdFactory(),
    ): Promise<T> {
      return unwrap<T>(await bridge.invoke({ type: "command", name, request_id: requestId, payload }));
    },

    prepareCommand<T extends JsonValue = JsonValue>(name: string, payload: JsonObject) {
      const envelope: CommandEnvelope = {
        type: "command",
        name,
        request_id: requestIdFactory(),
        payload,
      };
      return {
        requestId: envelope.request_id,
        envelope,
        execute: async (): Promise<T> => unwrap<T>(await bridge.invoke(envelope)),
      };
    },
  };
}

declare global {
  interface Window {
    learnstepper?: HostBridge;
    learnstepperEligibility?: HostEligibilityBridge;
  }
}

export function installedEligibilityBridge(): HostEligibilityBridge | null {
  return typeof window === "undefined" ? null : window.learnstepperEligibility ?? null;
}

export function installedHostBridge(): HostBridge | null {
  return typeof window === "undefined" ? null : window.learnstepper ?? null;
}
