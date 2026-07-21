import { describe, expect, test, vi } from "vitest";
import { spawnSync } from "node:child_process";
import {
  IPCError,
  createIPCClient,
  type HostBridge,
  type IPCEnvelope,
} from "../app/frontend/bridge/ipc-client";
import { buildProjectCreatePayload } from "../app/frontend/features/setup/project-payload";

describe("frontend IPC contract", () => {
  test("reads desktop runtime state through the optional host-only API", async () => {
    const getRuntimeStatus = vi.fn(async () => ({
      core: "available" as const,
      database: "available" as const,
      codexCli: "available" as const,
      appServer: "available" as const,
      authentication: "authenticated" as const,
    }));
    const bridge: HostBridge = { invoke: async () => ({ ok: true, data: {} }), getRuntimeStatus };

    await expect(bridge.getRuntimeStatus?.()).resolves.toEqual({
      core: "available",
      database: "available",
      codexCli: "available",
      appServer: "available",
      authentication: "authenticated",
    });
  });

  test("refreshes Codex-managed ChatGPT state without exposing account identity", async () => {
    const refreshChatGPTLogin = vi.fn(async () => ({ state: "authenticated" as const }));
    const bridge: HostBridge = {
      invoke: async () => ({ ok: true, data: {} }),
      refreshChatGPTLogin,
    };

    await expect(bridge.refreshChatGPTLogin?.()).resolves.toEqual({ state: "authenticated" });
    expect(refreshChatGPTLogin).toHaveBeenCalledOnce();
    expect(JSON.stringify(await bridge.refreshChatGPTLogin?.())).not.toMatch(/https?:|token|loginId|email/i);
  });

  test("sends exact closed query and command envelopes", async () => {
    const invoke = vi.fn(async (envelope: IPCEnvelope) => ({ ok: true as const, data: envelope.payload }));
    const bridge: HostBridge = { invoke };
    const client = createIPCClient(bridge, () => "11111111-1111-4111-8111-111111111111");

    await client.query("project.list", { include_archived: false });
    await client.command("project.archive", { id: "project-1" });

    expect(invoke).toHaveBeenNthCalledWith(1, {
      type: "query",
      name: "project.list",
      payload: { include_archived: false },
    });
    expect(invoke).toHaveBeenNthCalledWith(2, {
      type: "command",
      name: "project.archive",
      request_id: "11111111-1111-4111-8111-111111111111",
      payload: { id: "project-1" },
    });
  });

  test("reuses an explicit request id only for an identical retry", async () => {
    const invoke = vi.fn(async (envelope: IPCEnvelope): Promise<import("../app/frontend/bridge/ipc-client").IPCResponse> => {
      void envelope;
      return { ok: true, data: { id: "project-1" } };
    });
    const client = createIPCClient({ invoke }, () => "22222222-2222-4222-8222-222222222222");
    const retry = client.prepareCommand("project.archive", { id: "project-1" });

    await retry.execute();
    await retry.execute();

    const first = invoke.mock.calls[0][0] as IPCEnvelope;
    const second = invoke.mock.calls[1][0] as IPCEnvelope;
    expect(first).toEqual(second);
    expect(first).toMatchObject({ request_id: "22222222-2222-4222-8222-222222222222" });
  });

  test("surfaces stable safe errors without exposing internal details", async () => {
    const client = createIPCClient({
      invoke: async () => ({
        ok: false,
        error: {
          code: "INVALID_STATE_TRANSITION",
          message: "Project status transition is not allowed",
          request_id: "33333333-3333-4333-8333-333333333333",
        },
      }),
    });

    await expect(client.command("project.restore", { id: "project-1" })).rejects.toMatchObject({
      name: "IPCError",
      code: "INVALID_STATE_TRANSITION",
      userMessage: "現在の状態ではこの操作を実行できません。",
    } satisfies Partial<IPCError>);
  });
});

describe("project.create payload mapping", () => {
  test("maps every required curriculum project field and no unknown fields", () => {
    expect(buildProjectCreatePayload({
      mode: "curriculum",
      title: "中学数学",
      topic: "一次方程式",
      purpose: "理由を説明して解けるようになる",
      curriculumId: "curriculum-jp",
      currentLevel: "文字式は学習済み",
      targetLevel: "文章題を説明して解ける",
      targetDate: "2026-09-01",
      preferredSessionMinutes: 25,
      prerequisites: "正負の数",
      intendedUse: "学び直し",
      exclusions: "二次方程式",
    })).toEqual({
      mode: "curriculum",
      title: "中学数学",
      topic: "一次方程式",
      purpose: "理由を説明して解けるようになる",
      curriculum_id: "curriculum-jp",
      current_level: "文字式は学習済み",
      target_level: "文章題を説明して解ける",
      target_date: "2026-09-01",
      preferred_session_minutes: 25,
      constraints: {
        prerequisites: ["正負の数"],
        uses: ["学び直し"],
        exclusions: ["二次方程式"],
      },
    });
  });

  test("uses free_topic and a null curriculum id for a free topic", () => {
    const payload = buildProjectCreatePayload({
      mode: "free_topic",
      title: "線形代数",
      topic: "行列",
      purpose: "データ分析へ使う",
      curriculumId: null,
      currentLevel: "未学習",
      targetLevel: "固有値を説明できる",
      targetDate: null,
      preferredSessionMinutes: 30,
      prerequisites: "高校数学",
      intendedUse: "仕事",
      exclusions: "証明中心の内容",
    });

    expect(payload.mode).toBe("free_topic");
    expect(payload.curriculum_id).toBeNull();
    expect(payload.constraints).toEqual({
      prerequisites: ["高校数学"],
      uses: ["仕事"],
      exclusions: ["証明中心の内容"],
    });
  });

  test("trims learner text, clears whitespace-only constraints, and discards a stale free-topic curriculum id", () => {
    expect(buildProjectCreatePayload({
      mode: "free_topic",
      title: "  線形代数  ",
      topic: "  行列  ",
      purpose: "  データ分析へ使う  ",
      curriculumId: "stale-curriculum-id",
      currentLevel: "  未学習  ",
      targetLevel: "  固有値を説明できる  ",
      targetDate: "  2026-12-31  ",
      preferredSessionMinutes: 30,
      prerequisites: "   ",
      intendedUse: "",
      exclusions: "\t",
    })).toMatchObject({
      title: "線形代数",
      topic: "行列",
      purpose: "データ分析へ使う",
      curriculum_id: null,
      current_level: "未学習",
      target_level: "固有値を説明できる",
      target_date: "2026-12-31",
      constraints: { prerequisites: [], uses: [], exclusions: [] },
    });
  });

  test("is accepted by the production Python Core contract", () => {
    const payload = buildProjectCreatePayload({
      mode: "free_topic",
      title: "線形代数",
      topic: "行列",
      purpose: "データ分析へ使う",
      curriculumId: null,
      currentLevel: "未学習",
      targetLevel: "固有値を説明できる",
      targetDate: null,
      preferredSessionMinutes: 30,
      prerequisites: "",
      intendedUse: " ",
      exclusions: "\t",
    });
    const validation = spawnSync(
      "uv",
      ["run", "--frozen", "python", "-m", "tests.fixtures.validate_project_create_payload"],
      { cwd: process.cwd(), input: JSON.stringify(payload), encoding: "utf8", timeout: 30_000 },
    );

    expect(validation.status, validation.stderr).toBe(0);
    expect(JSON.parse(validation.stdout)).toMatchObject({ title: "線形代数", mode: "free_topic" });
  });
});
