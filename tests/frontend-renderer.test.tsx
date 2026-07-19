import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { LearnStepperApp } from "../app/frontend/learnstepper-app";
import type { HostBridge, IPCEnvelope, IPCResponse } from "../app/frontend/bridge/ipc-client";

const PROFILES = [
  ["jp-national", "日本"],
  ["us-dc", "コロンビア特別区"],
  ["us-ny", "ニューヨーク州"],
  ["us-ca", "カリフォルニア州"],
  ["de-be", "ベルリン州"],
  ["de-hh", "ハンブルク州"],
  ["de-by", "バイエルン州"],
].map(([id, jurisdiction_name]) => ({ id, jurisdiction_name, jurisdiction_type: id === "us-dc" ? "federal_district" : "state_or_national" }));

function bridgeFor(overrides: Partial<Record<string, IPCResponse>> = {}): HostBridge {
  return {
    invoke: vi.fn(async (envelope: IPCEnvelope): Promise<IPCResponse> => {
      const response = overrides[envelope.name];
      if (response) return response;
      if (envelope.name === "profile.get") {
        return { ok: true, data: { id: "profile-1", display_name: "学習者", locale: "ja-JP", timezone: "Asia/Tokyo" } };
      }
      if (envelope.name === "project.list") return { ok: true, data: { items: [] } };
      if (envelope.name === "curriculumProfile.list") return { ok: true, data: { items: PROFILES } };
      return { ok: false, error: { code: "NOT_IMPLEMENTED", message: "Not implemented" } };
    }),
  };
}

describe("LearnStepper Renderer boot states", () => {
  test("shows the profile form when the local profile is missing", async () => {
    render(<LearnStepperApp bridge={bridgeFor({
      "profile.get": { ok: false, error: { code: "NOT_FOUND", message: "Profile not found" } },
    })} />);

    expect(await screen.findByRole("heading", { name: "最初にプロフィールを設定します" })).toBeTruthy();
    expect(screen.getByLabelText("表示名")).toBeTruthy();
  });

  test("shows a truthful empty dashboard and the five-item navigation", async () => {
    render(<LearnStepperApp bridge={bridgeFor()} />);

    expect(await screen.findByRole("heading", { name: "最初の学びを作成します" })).toBeTruthy();
    const navigation = screen.getByRole("navigation", { name: "メインナビゲーション" });
    for (const item of ["ホーム", "学習", "進捗", "ライブラリ", "設定"]) {
      expect(within(navigation).getByRole("button", { name: item })).toBeTruthy();
    }
  });

  test("labels a missing local core as a local failure rather than offline", async () => {
    render(<LearnStepperApp bridge={bridgeFor({
      "profile.get": { ok: false, error: { code: "INTERNAL_ERROR", message: "details must not render" } },
    })} />);

    expect(await screen.findByRole("heading", { name: "ローカルデータを開けません" })).toBeTruthy();
    expect(screen.queryByText("オフライン")).toBeNull();
    expect(screen.queryByText("details must not render")).toBeNull();
  });
});

describe("setup and hold presentation", () => {
  test("offers exactly the seven backend curriculum profiles and excludes UAE", async () => {
    const user = userEvent.setup();
    render(<LearnStepperApp bridge={bridgeFor()} />);

    await user.click(await screen.findByRole("button", { name: "新しい学習を作成" }));
    const jurisdiction = await screen.findByRole("combobox", { name: "教育管轄" });
    expect(within(jurisdiction).getAllByRole("option")).toHaveLength(7);
    expect(within(jurisdiction).queryByRole("option", { name: /UAE/ })).toBeNull();
    expect(within(jurisdiction).getByRole("option", { name: "コロンビア特別区" })).toBeTruthy();
  });

  test("marks preview-only and provider-held behavior without claiming persistence", async () => {
    render(<LearnStepperApp bridge={null} />);

    expect(await screen.findByText("プレビュー")).toBeTruthy();
    expect(screen.getByText(/この画面の操作は保存されません/)).toBeTruthy();
    expect(screen.getByText(/ChatGPTログイン.*PO保留/)).toBeTruthy();
    expect(screen.queryByText("保存しました")).toBeNull();
  });

  test("keeps saved local access available when network capability is offline", async () => {
    const user = userEvent.setup();
    render(<LearnStepperApp bridge={bridgeFor()} initialSignals={{ network: "offline" }} />);

    expect(await screen.findByText("ネットワーク接続なし")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "設定" }));
    expect(await screen.findByRole("heading", { name: "アプリ設定" })).toBeTruthy();
    expect(screen.getByText("ローカルデータ: 利用可能")).toBeTruthy();
  });

  test("does not complete asynchronous work from a presentation timer", async () => {
    vi.useFakeTimers();
    render(<LearnStepperApp bridge={bridgeFor({
      "project.list": { ok: true, data: { items: [{ id: "project-1", title: "数学", status: "active", mode: "curriculum" }] } },
      "progress.get": { ok: true, data: { project_id: "project-1", lesson_total: 1, lesson_completed: 0, progress_rate: 0, objectives: [] } },
    })} />);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(screen.queryByText(/回答完了|達成済み|保存しました/)).toBeNull();
    vi.useRealTimers();
  });
});

describe("project lifecycle", () => {
  test("archives a project only after the Application Core confirms the command", async () => {
    const user = userEvent.setup();
    const bridge = bridgeFor({
      "project.list": { ok: true, data: { items: [{ id: "project-1", title: "数学", topic: "一次方程式", purpose: "説明して解く", status: "active", mode: "curriculum", current_level: "基礎", target_level: "応用", preferred_session_minutes: 25 }] } },
      "project.archive": { ok: true, data: { id: "project-1", title: "数学", topic: "一次方程式", purpose: "説明して解く", status: "archived", mode: "curriculum", current_level: "基礎", target_level: "応用", preferred_session_minutes: 25 } },
    });
    render(<LearnStepperApp bridge={bridge} />);

    await user.click(await screen.findByRole("button", { name: "数学を管理" }));
    expect(screen.getByRole("heading", { name: "プロジェクト設定" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "プロジェクトをアーカイブ" }));

    await waitFor(() => expect((bridge.invoke as ReturnType<typeof vi.fn>).mock.calls).toContainEqual([
      expect.objectContaining({ type: "command", name: "project.archive", payload: { id: "project-1" } }),
    ]));
    expect((await screen.findAllByText("アーカイブ済み")).length).toBeGreaterThanOrEqual(1);
  });

  test("shows deletion scope and requires a typed project title before irreversible deletion", async () => {
    const user = userEvent.setup();
    const bridge = bridgeFor({
      "project.list": { ok: true, data: { items: [{ id: "project-1", title: "数学", status: "paused", mode: "curriculum" }] } },
      "project.delete": { ok: true, data: { id: "project-1", deleted: true } },
    });
    render(<LearnStepperApp bridge={bridge} />);

    await user.click(await screen.findByRole("button", { name: "数学を管理" }));
    await user.click(screen.getByRole("button", { name: "削除範囲を確認" }));
    const dialog = screen.getByRole("dialog", { name: "プロジェクトを削除" });
    expect(within(dialog).getByText(/対象プロジェクトの計画、進捗、履歴、ノート/)).toBeTruthy();
    expect(within(dialog).getByText(/ChatGPT認証情報は削除しません/)).toBeTruthy();
    const confirm = within(dialog).getByRole("button", { name: "復元不能な削除を実行" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    await user.type(within(dialog).getByLabelText("確認のためプロジェクト名を入力"), "数学");
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("event-driven conversation", () => {
  test("confirms an answer only from typed item and turn events", async () => {
    const user = userEvent.setup();
    let listener: ((event: import("../app/frontend/bridge/ipc-client").RendererEvent) => void) | null = null;
    const invoke = vi.fn(async (envelope: IPCEnvelope): Promise<IPCResponse> => {
      const data: Record<string, unknown> = {
        "profile.get": { id: "profile-1", display_name: "学習者", locale: "ja-JP", timezone: "Asia/Tokyo" },
        "curriculumProfile.list": { items: PROFILES },
        "project.list": { items: [{ id: "project-1", title: "数学", status: "active", mode: "curriculum" }] },
        "project.get": { id: "project-1", title: "数学", status: "active", mode: "curriculum" },
        "plan.getCurrent": { plan: { id: "plan-1", modules: [{ id: "module-1", title: "一次方程式", estimated_minutes: 25, lessons: [{ id: "lesson-1", title: "等式の性質" }] }] } },
        "learningObjective.list": { items: [] },
        "progress.get": { lesson_total: 1, lesson_completed: 0, progress_rate: 0, objectives: [] },
        "mastery.get": { items: [] },
        "curriculumProgress.get": { items: [] },
        "remediation.getActive": { remediation: null },
        "history.listSessions": { items: [] },
        "note.list": { items: [] },
        "bookmark.list": { items: [] },
        "session.start": { id: "session-1", project_id: "project-1", status: "active", active_thread: { id: "thread-1" }, messages: [] },
        "message.send": { session_id: "session-1", thread_id: "thread-1", turn_id: "turn-1", status: "in_progress" },
      };
      return { ok: true, data: (data[envelope.name] ?? {}) as never };
    });
    const bridge: HostBridge = { invoke, subscribe: (next) => { listener = next; return () => { listener = null; }; } };
    const emit = (event: import("../app/frontend/bridge/ipc-client").RendererEvent) => {
      const current = listener as ((nextEvent: import("../app/frontend/bridge/ipc-client").RendererEvent) => void) | null;
      current?.(event);
    };
    render(<LearnStepperApp bridge={bridge} initialSignals={{ authentication: "authenticated", appServer: "available" }} />);

    await user.click(await screen.findByRole("button", { name: "プロジェクトを開く" }));
    await user.click(await screen.findByRole("button", { name: "セッションを開始" }));
    await user.type(screen.getByRole("textbox", { name: "質問を入力" }), "なぜ同じ操作をしますか");
    await user.click(screen.getByRole("button", { name: "質問を送信" }));

    expect(screen.getByText("なぜ同じ操作をしますか")).toBeTruthy();
    expect(screen.queryByText("回答完了")).toBeNull();
    emit({ sequence: 1, name: "item.completed", occurred_at: "2026-07-20T00:00:00Z", project_id: "project-1", session_id: "session-1", thread_id: "thread-1", turn_id: "turn-1", item_id: "item-1", payload: { item_type: "agentMessage", content: "等式の関係を保つためです。" } });
    emit({ sequence: 2, name: "turn.completed", occurred_at: "2026-07-20T00:00:01Z", project_id: "project-1", session_id: "session-1", thread_id: "thread-1", turn_id: "turn-1", payload: { status: "completed" } });

    expect(await screen.findByText("等式の関係を保つためです。")).toBeTruthy();
    expect(screen.getByText("回答完了")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "この回答をブックマーク" }));
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({
      type: "command",
      name: "bookmark.create",
      payload: { project_id: "project-1", lesson_id: "lesson-1", concept_id: null, message_id: "item-1", note: null, source_document_ids: [], curriculum_item_ids: [] },
    }));
  });
});

describe("library commands and deferred screens", () => {
  test("creates a note with the exact Application Core ownership payload", async () => {
    const user = userEvent.setup();
    const bridge = bridgeFor({
      "project.list": { ok: true, data: { items: [{ id: "project-1", title: "数学", status: "active", mode: "curriculum" }] } },
      "project.get": { ok: true, data: { id: "project-1", title: "数学", status: "active", mode: "curriculum" } },
      "plan.getCurrent": { ok: true, data: { plan: { id: "plan-1", modules: [{ id: "module-1", lessons: [{ id: "lesson-1" }] }] } } },
      "learningObjective.list": { ok: true, data: { items: [] } },
      "progress.get": { ok: true, data: {} },
      "mastery.get": { ok: true, data: { items: [] } },
      "curriculumProgress.get": { ok: true, data: { items: [] } },
      "remediation.getActive": { ok: true, data: { remediation: null } },
      "history.listSessions": { ok: true, data: { items: [] } },
      "note.list": { ok: true, data: { items: [] } },
      "bookmark.list": { ok: true, data: { items: [] } },
      "note.create": { ok: true, data: { id: "note-1", project_id: "project-1", lesson_id: "lesson-1", content: "移項の意味を復習", source_document_ids: [], curriculum_item_ids: [] } },
    });
    render(<LearnStepperApp bridge={bridge} />);

    await user.click(await screen.findByRole("button", { name: "プロジェクトを開く" }));
    await user.click(screen.getByRole("button", { name: "ライブラリ" }));
    await user.click(screen.getByRole("tab", { name: "ノート" }));
    await user.type(screen.getByRole("textbox", { name: "新しいノート" }), "移項の意味を復習");
    await user.click(screen.getByRole("button", { name: "ノートを保存" }));

    await waitFor(() => expect((bridge.invoke as ReturnType<typeof vi.fn>).mock.calls).toContainEqual([
      expect.objectContaining({ type: "command", name: "note.create", payload: { project_id: "project-1", lesson_id: "lesson-1", concept_id: null, content: "移項の意味を復習", source_document_ids: [], curriculum_item_ids: [] } }),
    ]));
    expect(await screen.findByText("移項の意味を復習")).toBeTruthy();
  });

  test("updates the local profile through the Application Core", async () => {
    const user = userEvent.setup();
    const bridge = bridgeFor({
      "profile.update": { ok: true, data: { id: "profile-1", display_name: "新しい名前", locale: "ja-JP", timezone: "Asia/Tokyo" } },
    });
    render(<LearnStepperApp bridge={bridge} />);

    await screen.findByRole("heading", { name: "最初の学びを作成します" });
    await user.click(screen.getByRole("button", { name: "設定" }));
    const displayName = screen.getByRole("textbox", { name: "表示名" });
    await user.clear(displayName);
    await user.type(displayName, "新しい名前");
    await user.click(screen.getByRole("button", { name: "プロフィールを更新" }));

    expect(bridge.invoke).toHaveBeenCalledWith(expect.objectContaining({ type: "command", name: "profile.update", payload: { display_name: "新しい名前", locale: "ja-JP", timezone: "Asia/Tokyo" } }));
    expect(await screen.findByText("プロフィールを更新しました")).toBeTruthy();
  });

  test("exposes held diagnosis and assessment screens without simulated completion", async () => {
    const user = userEvent.setup();
    render(<LearnStepperApp bridge={bridgeFor({
      "project.list": { ok: true, data: { items: [{ id: "project-1", title: "数学", status: "active", mode: "curriculum" }] } },
    })} />);

    await user.click(await screen.findByRole("button", { name: "プロジェクトを開く" }));
    await user.click(screen.getByRole("button", { name: "初期診断" }));
    expect(screen.getByRole("heading", { name: "初期診断" })).toBeTruthy();
    expect(screen.getByText(/生成・採点契約の確定待ち/)).toBeTruthy();
    expect(screen.queryByText("診断完了")).toBeNull();
    await user.click(screen.getByRole("button", { name: "学習へ戻る" }));
    await user.click(screen.getByRole("button", { name: "演習" }));
    expect(screen.getByRole("heading", { name: "演習" })).toBeTruthy();
    expect(screen.queryByText("正解")).toBeNull();
  });
});
