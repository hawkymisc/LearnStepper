import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, type ComponentProps } from "react";
import { describe, expect, test, vi } from "vitest";
import { LearnStepperApp as ProductionLearnStepperApp } from "../app/frontend/learnstepper-app";
import type { HostBridge, IPCEnvelope, IPCResponse } from "../app/frontend/bridge/ipc-client";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function LearnStepperApp(props: ComponentProps<typeof ProductionLearnStepperApp>) {
  useEffect(() => {
    document.querySelector<HTMLButtonElement>(".renderer-eligibility button")?.click();
  }, []);
  return <ProductionLearnStepperApp {...props} />;
}

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
  test("requires per-launch adult self-attestation before resolving or querying the host", async () => {
    const user = userEvent.setup();
    const bridge = bridgeFor();
    const getRuntimeStatus = vi.fn(async () => ({
      core: "available" as const,
      database: "available" as const,
      codexCli: "available" as const,
      appServer: "available" as const,
      authentication: "authenticated" as const,
    }));

    const firstLaunch = render(<ProductionLearnStepperApp bridge={{ ...bridge, getRuntimeStatus }} />);

    expect(screen.getByRole("heading", { name: "18歳以上の方が利用できます" })).toBeTruthy();
    expect(screen.getByText(/本人確認や年齢認証ではありません/)).toBeTruthy();
    expect(screen.getByText(/医療・法律・金融に関する学習は対象外/)).toBeTruthy();
    expect(bridge.invoke).not.toHaveBeenCalled();
    expect(getRuntimeStatus).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "18歳以上であることを確認して進む" }));

    expect(await screen.findByRole("heading", { name: "最初の学びを作成します" })).toBeTruthy();
    expect(bridge.invoke).toHaveBeenCalledWith(expect.objectContaining({ type: "query", name: "profile.get" }));
    expect(getRuntimeStatus).toHaveBeenCalledOnce();

    firstLaunch.unmount();
    render(<ProductionLearnStepperApp bridge={bridge} />);
    expect(screen.getByRole("heading", { name: "18歳以上の方が利用できます" })).toBeTruthy();
  });

  test("does not even resolve the installed host bridge before adult self-attestation", async () => {
    const user = userEvent.setup();
    const bridge = bridgeFor();
    const getInstalledBridge = vi.fn(() => bridge);
    const confirmEligibility = vi.fn(async () => ({ state: "ready" as const }));
    const getEligibilityBridge = vi.fn(() => ({ confirm: confirmEligibility }));
    Object.defineProperty(window, "learnstepper", { configurable: true, get: getInstalledBridge });
    Object.defineProperty(window, "learnstepperEligibility", { configurable: true, get: getEligibilityBridge });

    const view = render(<ProductionLearnStepperApp />);
    expect(screen.getByRole("heading", { name: "18歳以上の方が利用できます" })).toBeTruthy();
    expect(getInstalledBridge).not.toHaveBeenCalled();
    expect(getEligibilityBridge).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "18歳以上であることを確認して進む" }));
    await waitFor(() => expect(confirmEligibility).toHaveBeenCalledOnce());
    await waitFor(() => expect(getInstalledBridge).toHaveBeenCalledOnce());
    expect(confirmEligibility.mock.invocationCallOrder[0]).toBeLessThan(getInstalledBridge.mock.invocationCallOrder[0]);

    view.unmount();
    delete window.learnstepper;
    delete window.learnstepperEligibility;
  });

  test("keeps the eligibility screen available for retry when host initialization fails", async () => {
    const user = userEvent.setup();
    const confirm = vi.fn()
      .mockRejectedValueOnce(new Error("private host detail"))
      .mockResolvedValueOnce({ state: "ready" });
    window.learnstepperEligibility = { confirm };
    window.learnstepper = bridgeFor();

    render(<ProductionLearnStepperApp />);
    await user.click(screen.getByRole("button", { name: "18歳以上であることを確認して進む" }));

    expect((await screen.findByRole("alert")).textContent).toContain("ローカル機能を起動できませんでした");
    expect(screen.getByRole("heading", { name: "18歳以上の方が利用できます" })).toBeTruthy();
    expect(document.body.textContent).not.toContain("private host detail");

    await user.click(screen.getByRole("button", { name: "もう一度起動する" }));
    expect(await screen.findByRole("heading", { name: "最初の学びを作成します" })).toBeTruthy();
    expect(confirm).toHaveBeenCalledTimes(2);

    delete window.learnstepperEligibility;
    delete window.learnstepper;
  });

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

describe("hackathon submission presentation", () => {
  test("creates free-topic learning without curriculum controls", async () => {
    const user = userEvent.setup();
    render(<LearnStepperApp bridge={bridgeFor()} />);

    await user.click(await screen.findByRole("button", { name: "新しい学習を作成" }));
    expect(await screen.findByRole("heading", { name: "新しい学びを作成" })).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "教育管轄" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "教育課程" })).toBeNull();
    expect(screen.queryByText("教育課程に沿って学ぶ")).toBeNull();
  });

  test("submits the free-topic form through the exact persisted project boundary", async () => {
    const user = userEvent.setup();
    const bridge = bridgeFor({
      "project.create": { ok: true, data: { id: "project-new", title: "線形代数", topic: "行列", purpose: "データ分析へ使う", status: "active", mode: "free_topic" } },
    });
    render(<LearnStepperApp bridge={bridge} />);

    await user.click(await screen.findByRole("button", { name: "新しい学習を作成" }));
    await user.type(screen.getByRole("textbox", { name: "プロジェクト名" }), "線形代数");
    await user.type(screen.getByRole("textbox", { name: "学習テーマ" }), "行列");
    await user.type(screen.getByRole("textbox", { name: "学習目的" }), "データ分析へ使う");
    await user.type(screen.getByRole("textbox", { name: "現在のレベル" }), "未学習");
    await user.type(screen.getByRole("textbox", { name: "目標レベル" }), "固有値を説明できる");
    await user.type(screen.getByRole("textbox", { name: "前提知識" }), "高校数学");
    await user.type(screen.getByRole("textbox", { name: "用途" }), "仕事");
    await user.type(screen.getByRole("textbox", { name: "除外事項" }), "証明中心の内容");
    await user.click(screen.getByRole("button", { name: "学びを作成" }));

    await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith(expect.objectContaining({
      type: "command",
      name: "project.create",
      payload: {
        mode: "free_topic",
        title: "線形代数",
        topic: "行列",
        purpose: "データ分析へ使う",
        curriculum_id: null,
        current_level: "未学習",
        target_level: "固有値を説明できる",
        target_date: null,
        preferred_session_minutes: 25,
        constraints: { prerequisites: ["高校数学"], uses: ["仕事"], exclusions: ["証明中心の内容"] },
      },
    })));
    expect(await screen.findByRole("heading", { name: "線形代数" })).toBeTruthy();
  });

  test("treats sensitive-domain scope as acknowledgement copy without keyword rejection", async () => {
    const user = userEvent.setup();
    const bridge = bridgeFor({
      "project.create": { ok: true, data: { id: "project-finance", title: "金融の基礎", topic: "金融商品の仕組み", purpose: "一般教養", status: "active", mode: "free_topic" } },
    });
    render(<ProductionLearnStepperApp bridge={bridge} />);

    expect(screen.getByText(/医療・法律・金融に関する学習は対象外/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "18歳以上であることを確認して進む" }));
    await user.click(await screen.findByRole("button", { name: "新しい学習を作成" }));
    await user.type(screen.getByRole("textbox", { name: "プロジェクト名" }), "金融の基礎");
    await user.type(screen.getByRole("textbox", { name: "学習テーマ" }), "金融商品の仕組み");
    await user.type(screen.getByRole("textbox", { name: "学習目的" }), "一般教養");
    await user.type(screen.getByRole("textbox", { name: "現在のレベル" }), "未学習");
    await user.type(screen.getByRole("textbox", { name: "目標レベル" }), "一般的な説明を理解する");
    await user.click(screen.getByRole("button", { name: "学びを作成" }));

    expect(bridge.invoke).toHaveBeenCalledWith(expect.objectContaining({
      name: "project.create",
      payload: expect.objectContaining({ topic: "金融商品の仕組み", purpose: "一般教養" }),
    }));
    expect(await screen.findByRole("heading", { name: "金融の基礎" })).toBeTruthy();
  });

  test("does not expose product-management or architecture terminology", async () => {
    render(<LearnStepperApp bridge={null} />);

    expect(await screen.findByText("プレビュー")).toBeTruthy();
    expect(screen.getByText(/この画面の操作は保存されません/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/PO保留|Application Core|Local Core|Core unavailable|Concrete host|Bridge接続|FE-PO-|NIF-/);
    expect(screen.queryByText("保存しました")).toBeNull();
  });

  test("uses the installed desktop bridge after hydration without rendering preview mode", async () => {
    const bridge = bridgeFor();
    window.learnstepper = bridge;
    render(<LearnStepperApp />);

    expect(await screen.findByRole("heading", { name: "最初の学びを作成します" })).toBeTruthy();
    expect(screen.queryByText("プレビュー")).toBeNull();
    expect(screen.queryByText(/この画面の操作は保存されません/)).toBeNull();
    expect((bridge.invoke as ReturnType<typeof vi.fn>).mock.calls).toContainEqual([
      expect.objectContaining({ type: "query", name: "profile.get" }),
    ]);
    delete window.learnstepper;
  });

  test("keeps local data available and refreshes state after external Codex device login", async () => {
    const user = userEvent.setup();
    const refreshChatGPTLogin = vi.fn(async () => ({ state: "authenticated" as const }));
    render(<LearnStepperApp bridge={{
      ...bridgeFor(),
      refreshChatGPTLogin,
      getRuntimeStatus: async () => ({
        core: "available",
        database: "available",
        codexCli: "available",
        appServer: "available",
        authentication: "unauthenticated",
      }),
    }} />);

    expect(await screen.findByText("Codex CLIでログインしてください")).toBeTruthy();
    expect(screen.getByText(/codex login --device-auth/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "ログイン状態を再確認" }));
    expect(refreshChatGPTLogin).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByText("Codex CLIでログインしてください")).toBeNull());
  });

  test("explains a missing external Codex CLI without hiding local data", async () => {
    render(<LearnStepperApp bridge={{
      ...bridgeFor(),
      getRuntimeStatus: async () => ({
        core: "available",
        database: "available",
        codexCli: "missing",
        appServer: "unavailable",
        authentication: "unauthenticated",
      }),
    }} />);

    expect(await screen.findByText("Codex CLIが見つかりません")).toBeTruthy();
    expect(screen.getByText(/Codex CLI 0\.144\.5/)).toBeTruthy();
    expect(screen.getByText("最初の学びを作成します")).toBeTruthy();
  });

  test("distinguishes an unsupported external Codex CLI version", async () => {
    render(<LearnStepperApp bridge={{
      ...bridgeFor(),
      getRuntimeStatus: async () => ({
        core: "available",
        database: "available",
        codexCli: "unsupported",
        appServer: "unavailable",
        authentication: "error",
      }),
    }} />);

    expect(await screen.findByText("Codex CLIのバージョンが対応外です")).toBeTruthy();
    expect(screen.getByText(/Codex CLI 0\.144\.5をインストール/)).toBeTruthy();
  });

  test("keeps external authentication refresh failures actionable", async () => {
    const user = userEvent.setup();
    render(<LearnStepperApp bridge={{
      ...bridgeFor(),
      refreshChatGPTLogin: vi.fn(async () => { throw new Error("private account failure"); }),
      getRuntimeStatus: async () => ({
        core: "available",
        database: "available",
        codexCli: "available",
        appServer: "available",
        authentication: "unauthenticated",
      }),
    }} />);

    await user.click(await screen.findByRole("button", { name: "ログイン状態を再確認" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Codex CLIとネットワーク接続を確認");
    expect(document.body.textContent).not.toContain("private account failure");
  });

  test("shows authenticated external CLI state in settings", async () => {
    const user = userEvent.setup();
    render(<LearnStepperApp bridge={bridgeFor()} initialSignals={{
      codexCli: "available",
      authentication: "authenticated",
      appServer: "available",
    }} />);

    await user.click(await screen.findByRole("button", { name: "設定" }));
    expect(screen.getByText("Codex CLI: 利用可能")).toBeTruthy();
    expect(screen.getByText("ChatGPT: ログイン済み")).toBeTruthy();
    expect(screen.getByText("AI接続: 利用可能")).toBeTruthy();
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

  test("localizes objective scope, attainment, and mastery status", async () => {
    const user = userEvent.setup();
    render(<LearnStepperApp bridge={bridgeFor({
      "project.list": { ok: true, data: { items: [{ id: "project-1", title: "数学", status: "active", mode: "free_topic" }] } },
      "project.get": { ok: true, data: { id: "project-1", title: "数学", status: "active", mode: "free_topic" } },
      "plan.getCurrent": { ok: true, data: { plan: null } },
      "learningObjective.list": { ok: true, data: { items: [{ id: "objective-1", current_version: { id: "version-1", goal_type: "can_do", statement: "説明できる", scope: "project", version_number: 1 } }] } },
      "learningObjective.get": { ok: true, data: { id: "objective-1", current_version: { id: "version-1", statement: "説明できる" } } },
      "learningObjective.attainment.get": { ok: true, data: { status: "achieved" } },
      "learningObjective.evidence.list": { ok: true, data: { items: [] } },
      "progress.get": { ok: true, data: { lesson_total: 1, lesson_completed: 0, progress_rate: 0 } },
      "mastery.get": { ok: true, data: { items: [{ id: "mastery-1", name: "一次方程式", status: "needs_review" }] } },
      "remediation.getActive": { ok: true, data: { remediation: null } },
      "history.listSessions": { ok: true, data: { items: [] } },
      "note.list": { ok: true, data: { items: [] } },
      "bookmark.list": { ok: true, data: { items: [] } },
    })} />);

    await user.click(await screen.findByRole("button", { name: "プロジェクトを開く" }));
    expect(screen.getByText(/Web検索や新しい資料の取得は行いません/)).toBeTruthy();
    expect(screen.getByText(/保存済み資料は「ライブラリ」で確認できます/)).toBeTruthy();
    expect(screen.getByText(/資料ファイルのアップロードは現在利用できません/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "学習目標" }));
    expect(screen.getByText(/Web検索や新しい資料の取得は行いません/)).toBeTruthy();
    expect(await screen.findByText(/対象: プロジェクト/)).toBeTruthy();
    expect(await screen.findByText("達成状態: 達成")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "進捗" }));
    expect(await screen.findByText("復習が必要")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/needs_review|scope: project|対象: project/);
  });

  test("renders the saved plan read-only and shows only persisted source evidence", async () => {
    const user = userEvent.setup();
    render(<LearnStepperApp bridge={bridgeFor({
      "project.list": { ok: true, data: { items: [{ id: "project-1", title: "数学", status: "active", mode: "free_topic" }] } },
      "project.get": { ok: true, data: { id: "project-1", title: "数学", status: "active", mode: "free_topic" } },
      "plan.getCurrent": { ok: true, data: { plan: { id: "plan-1", source_document_ids: ["source-1"], modules: [{ id: "module-1", title: "一次方程式", estimated_minutes: 25 }] } } },
      "learningObjective.list": { ok: true, data: { items: [{ id: "objective-1", current_version: { id: "version-1", goal_type: "know", statement: "等式を説明できる", scope: "project", success_criteria: "例を示す", version_number: 1, source_document_ids: ["source-1"] } }] } },
      "learningObjective.get": { ok: true, data: { id: "objective-1", current_version: { id: "version-1", statement: "等式を説明できる" } } },
      "learningObjective.attainment.get": { ok: true, data: { status: "not_attained" } },
      "learningObjective.evidence.list": { ok: true, data: { items: [] } },
      "source.get": { ok: true, data: { id: "source-1", title: "保存済み数学資料", publisher: "教育機関", version: "2026", verification_status: "verified", retrieved_at: "2026-07-21" } },
      "source.citations": { ok: true, data: { items: [{ id: "citation-1" }] } },
      "progress.get": { ok: true, data: {} },
      "mastery.get": { ok: true, data: { items: [] } },
      "history.listSessions": { ok: true, data: { items: [] } },
      "note.list": { ok: true, data: { items: [] } },
      "bookmark.list": { ok: true, data: { items: [] } },
    })} />);

    await user.click(await screen.findByRole("button", { name: "プロジェクトを開く" }));
    await user.click(await screen.findByRole("button", { name: "学習計画" }));
    expect(await screen.findByText("一次方程式")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "計画を編集" })).toBeNull();
    expect(screen.queryByRole("button", { name: "計画を承認" })).toBeNull();
    expect(screen.queryByRole("button", { name: "計画を再生成" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "学習へ戻る" }));
    await user.click(screen.getByRole("button", { name: "学習目標" }));
    expect(await screen.findByText("保存済み数学資料")).toBeTruthy();
    expect(screen.getByText(/引用 1件/)).toBeTruthy();
    expect(screen.getByText(/取得時点 2026-07-21/)).toBeTruthy();
  });

  test("renders every Core-returned objective without truncating the fifth or defensive overflow", async () => {
    const user = userEvent.setup();
    const objectives = Array.from({ length: 6 }, (_, index) => ({
      id: `objective-${index + 1}`,
      current_version: {
        id: `version-${index + 1}`,
        goal_type: "can_do",
        statement: `学習目標 ${index + 1}`,
        scope: "project",
        success_criteria: `成功基準 ${index + 1}`,
        version_number: 1,
      },
    }));
    render(<LearnStepperApp bridge={bridgeFor({
      "project.list": { ok: true, data: { items: [{ id: "project-1", title: "数学", status: "active", mode: "free_topic" }] } },
      "project.get": { ok: true, data: { id: "project-1", title: "数学", status: "active", mode: "free_topic" } },
      "plan.getCurrent": { ok: true, data: { plan: null } },
      "learningObjective.list": { ok: true, data: { items: objectives } },
      "progress.get": { ok: true, data: { lesson_total: 0, lesson_completed: 0, progress_rate: null } },
      "mastery.get": { ok: true, data: { items: [] } },
      "remediation.getActive": { ok: true, data: { remediation: null } },
      "history.listSessions": { ok: true, data: { items: [] } },
      "note.list": { ok: true, data: { items: [] } },
      "bookmark.list": { ok: true, data: { items: [] } },
    })} />);

    await user.click(await screen.findByRole("button", { name: "プロジェクトを開く" }));
    for (const objective of objectives) {
      expect(await screen.findByText(objective.current_version.statement)).toBeTruthy();
    }
  });
});

describe("project lifecycle", () => {
  test("archives a project only after local persistence confirms the command", async () => {
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

  test("keeps destructive confirmation in an escape-dismissable modal and returns focus", async () => {
    const user = userEvent.setup();
    render(<LearnStepperApp bridge={bridgeFor({
      "project.list": { ok: true, data: { items: [{ id: "project-1", title: "数学", status: "paused", mode: "curriculum" }] } },
    })} />);

    await user.click(await screen.findByRole("button", { name: "数学を管理" }));
    const trigger = screen.getByRole("button", { name: "削除範囲を確認" });
    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "プロジェクトを削除" })).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "プロジェクトを削除" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

describe("project-owned asynchronous state", () => {
  function projectBridge(options: {
    projectA?: ReturnType<typeof deferred<IPCResponse>>;
    projectB?: ReturnType<typeof deferred<IPCResponse>>;
    source?: ReturnType<typeof deferred<IPCResponse>>;
    attainment?: ReturnType<typeof deferred<IPCResponse>>;
  } = {}): HostBridge {
    const projects = [
      { id: "project-a", title: "プロジェクトA", purpose: "Aの学習", status: "active", mode: "free_topic" },
      { id: "project-b", title: "プロジェクトB", purpose: "Bの学習", status: "active", mode: "free_topic" },
    ];
    return {
      invoke: vi.fn(async (envelope: IPCEnvelope): Promise<IPCResponse> => {
        const projectId = String(envelope.payload.project_id ?? envelope.payload.id ?? "");
        if (envelope.name === "profile.get") return { ok: true, data: { id: "profile-1", display_name: "学習者", locale: "ja-JP", timezone: "Asia/Tokyo" } };
        if (envelope.name === "project.list") return { ok: true, data: { items: projects } };
        if (envelope.name === "project.get") {
          if (projectId === "project-a" && options.projectA) return options.projectA.promise;
          if (projectId === "project-b" && options.projectB) return options.projectB.promise;
          return { ok: true, data: projects.find((project) => project.id === projectId) ?? {} };
        }
        if (envelope.name === "plan.getCurrent") return { ok: true, data: { plan: { id: `plan-${projectId}`, modules: [{ id: `module-${projectId}`, title: projectId === "project-a" ? "Aだけの計画" : "Bだけの計画", estimated_minutes: 25, lessons: [{ id: `lesson-${projectId}`, title: "レッスン" }] }] } } };
        if (envelope.name === "learningObjective.list") return {
          ok: true,
          data: {
            items: [{
              id: `objective-${projectId}`,
              current_version: {
                id: `version-${projectId}`,
                statement: projectId === "project-a" ? "Aだけの目標" : "Bだけの目標",
                goal_type: "can_do",
                scope: "project",
                version_number: 1,
                success_criteria: "説明できる",
                source_document_ids: projectId === "project-b" ? ["source-b"] : [],
              },
            }],
          },
        };
        if (envelope.name === "progress.get") return { ok: true, data: { lesson_total: 1, lesson_completed: 0, progress_rate: 0 } };
        if (envelope.name === "mastery.get" || envelope.name === "history.listSessions" || envelope.name === "note.list" || envelope.name === "bookmark.list") return { ok: true, data: { items: [] } };
        if (envelope.name === "learningObjective.get") return { ok: true, data: { id: "objective-project-b", current_version: { statement: "Bだけの目標" } } };
        if (envelope.name === "learningObjective.attainment.get") return options.attainment?.promise ?? { ok: true, data: { status: "in_progress" } };
        if (envelope.name === "learningObjective.evidence.list") return { ok: true, data: { items: [{ id: "evidence-b" }] } };
        if (envelope.name === "source.get") return options.source?.promise ?? { ok: true, data: { id: "source-b", title: "Bの保存済み資料", publisher: "発行主体", verification_status: "verified" } };
        if (envelope.name === "source.citations") return { ok: true, data: { items: [] } };
        return { ok: false, error: { code: "NOT_IMPLEMENTED", message: envelope.name } };
      }),
    };
  }

  test("switches to the new project shell immediately without exposing prior owned content or lesson actions", async () => {
    const user = userEvent.setup();
    const projectB = deferred<IPCResponse>();
    const bridge = projectBridge({ projectB });
    render(<LearnStepperApp bridge={bridge} initialSignals={{ authentication: "authenticated", appServer: "available" }} />);

    const dashboard = await screen.findByRole("heading", { name: "学びの現在地" });
    expect(dashboard).toBeTruthy();
    const projectACard = screen.getByRole("heading", { name: "プロジェクトA" }).closest("article")!;
    await user.click(within(projectACard).getByRole("button", { name: "プロジェクトを開く" }));
    expect(await screen.findByText("Aだけの計画")).toBeTruthy();
    expect(screen.getByText("Aだけの目標")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "ホーム" }));
    const projectBCard = screen.getByRole("heading", { name: "プロジェクトB" }).closest("article")!;
    await user.click(within(projectBCard).getByRole("button", { name: "プロジェクトを開く" }));

    expect(screen.getByRole("heading", { name: "プロジェクトB" })).toBeTruthy();
    expect(screen.getByText("計画を読み込んでいます。")).toBeTruthy();
    expect(screen.queryByText("Aだけの計画")).toBeNull();
    expect(screen.queryByText("Aだけの目標")).toBeNull();
    expect((screen.getByRole("button", { name: "セッションを開始" }) as HTMLButtonElement).disabled).toBe(true);

    projectB.resolve({ ok: true, data: { id: "project-b", title: "プロジェクトB", purpose: "Bの学習", status: "active", mode: "free_topic" } });
    expect(await screen.findByText("Bだけの計画")).toBeTruthy();
    expect(screen.getByText("Bだけの目標")).toBeTruthy();
  });

  test("loads attainment and saved-source regions independently and keeps one region usable when the other fails", async () => {
    const user = userEvent.setup();
    const source = deferred<IPCResponse>();
    const attainment = deferred<IPCResponse>();
    render(<LearnStepperApp bridge={projectBridge({ source, attainment })} />);

    await screen.findByRole("heading", { name: "学びの現在地" });
    const projectBCard = screen.getByRole("heading", { name: "プロジェクトB" }).closest("article")!;
    await user.click(within(projectBCard).getByRole("button", { name: "プロジェクトを開く" }));
    await user.click(await screen.findByRole("button", { name: "学習目標" }));

    expect(await screen.findByText("達成状況を読み込んでいます。")).toBeTruthy();
    expect(screen.getByText("保存済み資料を読み込んでいます。")).toBeTruthy();

    attainment.resolve({ ok: true, data: { status: "in_progress" } });
    expect(await screen.findByText("達成状態: 学習中")).toBeTruthy();
    expect(screen.getByText("保存済み資料を読み込んでいます。")).toBeTruthy();

    source.reject(new Error("private source failure"));
    expect(await screen.findByText("保存済み資料を取得できませんでした。")).toBeTruthy();
    expect(screen.getByText("達成状態: 学習中")).toBeTruthy();
    expect(document.body.textContent).not.toContain("private source failure");
  });

  test("shows a truthful loading state while a feature screen refreshes its workspace", async () => {
    const user = userEvent.setup();
    const workspaceRefresh = deferred<IPCResponse>();
    const bridge = projectBridge();
    const invoke = bridge.invoke as ReturnType<typeof vi.fn>;
    const baseInvoke = invoke.getMockImplementation() as (envelope: IPCEnvelope) => Promise<IPCResponse>;
    let projectBReads = 0;
    invoke.mockImplementation((envelope: IPCEnvelope) => {
      if (envelope.name === "project.get" && envelope.payload.id === "project-b") {
        projectBReads += 1;
        if (projectBReads > 1) return workspaceRefresh.promise;
      }
      return baseInvoke(envelope);
    });
    render(<LearnStepperApp bridge={bridge} />);

    await screen.findByRole("heading", { name: "学びの現在地" });
    const projectBCard = screen.getByRole("heading", { name: "プロジェクトB" }).closest("article")!;
    await user.click(within(projectBCard).getByRole("button", { name: "プロジェクトを開く" }));
    await screen.findByText("Bだけの目標");
    await user.click(screen.getByRole("button", { name: "学習目標" }));

    expect(screen.getByRole("status").textContent).toContain("プロジェクトデータを読み込んでいます");
    expect(screen.queryByText("保存済みの達成状況はありません。")).toBeNull();
    expect(screen.queryByText("現在の計画・目標に関連する保存済み資料はありません。")).toBeNull();

    workspaceRefresh.resolve({ ok: true, data: { id: "project-b", title: "プロジェクトB", purpose: "Bの学習", status: "active", mode: "free_topic" } });
    expect(await screen.findByText("達成状態: 学習中")).toBeTruthy();
  });

  test("ignores a late response from the previously selected project", async () => {
    const user = userEvent.setup();
    const projectA = deferred<IPCResponse>();
    render(<LearnStepperApp bridge={projectBridge({ projectA })} />);

    await screen.findByRole("heading", { name: "学びの現在地" });
    const projectBCard = screen.getByRole("heading", { name: "プロジェクトB" }).closest("article")!;
    await user.click(within(projectBCard).getByRole("button", { name: "プロジェクトを開く" }));
    expect(await screen.findByText("Bだけの計画")).toBeTruthy();

    projectA.resolve({ ok: true, data: { id: "project-a", title: "プロジェクトA", purpose: "Aの学習", status: "active", mode: "free_topic" } });
    await projectA.promise;
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    await waitFor(() => expect(screen.queryByText("Aだけの計画")).toBeNull());
    expect(screen.getByText("Bだけの計画")).toBeTruthy();
  });

  test("rejects a workspace whose returned project ownership does not match the selected project", async () => {
    const user = userEvent.setup();
    const projectB = deferred<IPCResponse>();
    render(<LearnStepperApp bridge={projectBridge({ projectB })} />);

    await screen.findByRole("heading", { name: "学びの現在地" });
    const projectBCard = screen.getByRole("heading", { name: "プロジェクトB" }).closest("article")!;
    await user.click(within(projectBCard).getByRole("button", { name: "プロジェクトを開く" }));
    projectB.resolve({ ok: true, data: { id: "project-a", title: "プロジェクトA", purpose: "Aの学習", status: "active", mode: "free_topic" } });

    expect((await screen.findByRole("alert")).textContent).toContain("プロジェクトの所有情報を確認できませんでした。");
    expect(screen.queryByText("Aだけの計画")).toBeNull();
    expect(screen.queryByText("Bだけの計画")).toBeNull();
    expect(screen.queryByRole("button", { name: "セッションを開始" })).toBeNull();
    expect((screen.getByRole("button", { name: "質問を送信" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("event-driven conversation", () => {
  test("reloads the active session before remounting learning after navigation", async () => {
    const user = userEvent.setup();
    let sessionStarted = false;
    const activeSession = {
      id: "session-new",
      project_id: "project-1",
      status: "active",
      active_thread: { id: "thread-new", turns: [] },
      messages: [{ id: "message-new", role: "assistant", item_type: "agentMessage", content: "再訪後も残る回答です。", status: "completed" }],
    };
    const invoke = vi.fn(async (envelope: IPCEnvelope): Promise<IPCResponse> => {
      const data: Record<string, unknown> = {
        "profile.get": { id: "profile-1", display_name: "学習者", locale: "ja-JP", timezone: "Asia/Tokyo" },
        "curriculumProfile.list": { items: PROFILES },
        "project.list": { items: [{ id: "project-1", title: "数学", status: "active", mode: "free_topic" }] },
        "project.get": { id: "project-1", title: "数学", status: "active", mode: "free_topic" },
        "plan.getCurrent": { plan: null },
        "learningObjective.list": { items: [] },
        "progress.get": { lesson_total: 0, lesson_completed: 0, progress_rate: 0 },
        "mastery.get": { items: [] },
        "note.list": { items: [] },
        "bookmark.list": { items: [] },
        "session.get": activeSession,
        "session.resume": activeSession,
        "conversation.reconcile": { session_id: "session-new", thread_id: "thread-new", imported_items: 0 },
      };
      if (envelope.name === "history.listSessions") {
        return { ok: true, data: { items: sessionStarted ? [{ id: "session-new", status: "active" }] : [] } };
      }
      if (envelope.name === "session.start") {
        sessionStarted = true;
        return { ok: true, data: activeSession };
      }
      return { ok: true, data: (data[envelope.name] ?? {}) as never };
    });

    render(<LearnStepperApp bridge={{ invoke }} initialSignals={{ authentication: "authenticated", appServer: "available" }} />);
    await user.click(await screen.findByRole("button", { name: "プロジェクトを開く" }));
    await user.click(await screen.findByRole("button", { name: "セッションを開始" }));
    expect(await screen.findByText("再訪後も残る回答です。")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "ホーム" }));
    await screen.findByRole("heading", { name: "学びの現在地" });
    await user.click(screen.getByRole("button", { name: "学習" }));

    expect(await screen.findByText("セッション接続済み")).toBeTruthy();
    expect(screen.getByText("再訪後も残る回答です。")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "セッションを開始" })).toBeNull();
    expect(invoke.mock.calls.filter(([envelope]) => envelope.name === "session.start")).toHaveLength(1);
  });

  test("reconnects and reconciles a persisted active session before enabling new input", async () => {
    const user = userEvent.setup();
    const resume = deferred<IPCResponse>();
    const reconcile = deferred<IPCResponse>();
    const callNames: string[] = [];
    const persistedSession = {
      id: "session-persisted",
      project_id: "project-1",
      status: "active",
      active_thread: { id: "thread-persisted" },
      messages: [
        { id: "message-hidden", role: "system", item_type: "reasoning", content: "表示してはいけない内部推論", status: "completed" },
        { id: "message-saved", role: "assistant", item_type: "agentMessage", content: "保存済みの回答です。", status: "completed" },
      ],
    };
    const invoke = vi.fn(async (envelope: IPCEnvelope): Promise<IPCResponse> => {
      callNames.push(envelope.name);
      const data: Record<string, unknown> = {
        "profile.get": { id: "profile-1", display_name: "学習者", locale: "ja-JP", timezone: "Asia/Tokyo" },
        "curriculumProfile.list": { items: PROFILES },
        "project.list": { items: [{ id: "project-1", title: "数学", status: "active", mode: "free_topic" }] },
        "project.get": { id: "project-1", title: "数学", status: "active", mode: "free_topic" },
        "plan.getCurrent": { plan: null },
        "learningObjective.list": { items: [] },
        "progress.get": { lesson_total: 0, lesson_completed: 0, progress_rate: 0 },
        "mastery.get": { items: [] },
        "history.listSessions": { items: [{ id: "session-persisted", status: "active" }] },
        "note.list": { items: [] },
        "bookmark.list": { items: [] },
        "session.get": persistedSession,
      };
      if (envelope.name === "session.resume") return resume.promise;
      if (envelope.name === "conversation.reconcile") return reconcile.promise;
      return { ok: true, data: (data[envelope.name] ?? {}) as never };
    });

    render(<LearnStepperApp bridge={{ invoke }} initialSignals={{ authentication: "authenticated", appServer: "available" }} />);
    await user.click(await screen.findByRole("button", { name: "プロジェクトを開く" }));

    expect(await screen.findByText("保存済みの回答です。")).toBeTruthy();
    expect(screen.queryByText("表示してはいけない内部推論")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("保存済みセッションへ再接続しています");
    expect((screen.getByRole("textbox", { name: "質問を入力" }) as HTMLTextAreaElement).disabled).toBe(true);

    resume.resolve({ ok: true, data: persistedSession });
    expect(await screen.findByText("会話履歴を照合しています。" )).toBeTruthy();
    reconcile.resolve({ ok: true, data: { session_id: "session-persisted", thread_id: "thread-persisted", imported_items: 0 } });

    expect(await screen.findByText("セッション接続済み")).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "質問を入力" }) as HTMLTextAreaElement).disabled).toBe(false);
    expect(callNames.indexOf("session.get")).toBeLessThan(callNames.indexOf("session.resume"));
    expect(callNames.indexOf("session.resume")).toBeLessThan(callNames.indexOf("conversation.reconcile"));
    expect(callNames.filter((name) => name === "session.get")).toHaveLength(2);
  });

  test("restores an in-progress turn after reconciliation and keeps send disabled until it is stopped", async () => {
    const user = userEvent.setup();
    const reconcile = deferred<IPCResponse>();
    const persistedSession = {
      id: "session-persisted",
      project_id: "project-1",
      status: "active",
      active_thread: {
        id: "thread-persisted",
        turns: [{ id: "turn-running", status: "in_progress", items: [] }],
      },
      messages: [],
    };
    const invoke = vi.fn(async (envelope: IPCEnvelope): Promise<IPCResponse> => {
      const data: Record<string, unknown> = {
        "profile.get": { id: "profile-1", display_name: "学習者", locale: "ja-JP", timezone: "Asia/Tokyo" },
        "curriculumProfile.list": { items: PROFILES },
        "project.list": { items: [{ id: "project-1", title: "数学", status: "active", mode: "free_topic" }] },
        "project.get": { id: "project-1", title: "数学", status: "active", mode: "free_topic" },
        "plan.getCurrent": { plan: null },
        "learningObjective.list": { items: [] },
        "progress.get": { lesson_total: 0, lesson_completed: 0, progress_rate: 0 },
        "mastery.get": { items: [] },
        "history.listSessions": { items: [{ id: "session-persisted", status: "active" }] },
        "note.list": { items: [] },
        "bookmark.list": { items: [] },
        "session.get": persistedSession,
        "session.resume": persistedSession,
        "turn.interrupt": { session_id: "session-persisted", thread_id: "thread-persisted", turn_id: "turn-running", status: "interrupted" },
      };
      if (envelope.name === "conversation.reconcile") return reconcile.promise;
      return { ok: true, data: (data[envelope.name] ?? {}) as never };
    });

    render(<LearnStepperApp bridge={{ invoke }} initialSignals={{ authentication: "authenticated", appServer: "available" }} />);
    await user.click(await screen.findByRole("button", { name: "プロジェクトを開く" }));

    expect(await screen.findByText("会話履歴を照合しています。")).toBeTruthy();
    expect((screen.getByRole("button", { name: "もっと簡単に" }) as HTMLButtonElement).disabled).toBe(true);
    reconcile.resolve({ ok: true, data: { session_id: "session-persisted", thread_id: "thread-persisted", imported_items: 0 } });
    expect(await screen.findByText("セッション接続済み")).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "質問を入力" }) as HTMLTextAreaElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "回答を停止" }));
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({
      type: "command",
      name: "turn.interrupt",
      payload: { session_id: "session-persisted", turn_id: "turn-running" },
    }));
    expect(await screen.findByText("停止しました")).toBeTruthy();
  });

  test("preserves local history and offers retry when persisted-session reconnection fails", async () => {
    const user = userEvent.setup();
    let resumeAttempts = 0;
    const persistedSession = {
      id: "session-persisted",
      project_id: "project-1",
      status: "active",
      active_thread: { id: "thread-persisted" },
      messages: [{ id: "message-saved", role: "assistant", item_type: "agentMessage", content: "失敗後も残る回答です。", status: "completed" }],
    };
    const invoke = vi.fn(async (envelope: IPCEnvelope): Promise<IPCResponse> => {
      const data: Record<string, unknown> = {
        "profile.get": { id: "profile-1", display_name: "学習者", locale: "ja-JP", timezone: "Asia/Tokyo" },
        "curriculumProfile.list": { items: PROFILES },
        "project.list": { items: [{ id: "project-1", title: "数学", status: "active", mode: "free_topic" }] },
        "project.get": { id: "project-1", title: "数学", status: "active", mode: "free_topic" },
        "plan.getCurrent": { plan: null },
        "learningObjective.list": { items: [] },
        "progress.get": { lesson_total: 0, lesson_completed: 0, progress_rate: 0 },
        "mastery.get": { items: [] },
        "history.listSessions": { items: [{ id: "session-persisted", status: "active" }] },
        "note.list": { items: [] },
        "bookmark.list": { items: [] },
        "session.get": persistedSession,
        "conversation.reconcile": { session_id: "session-persisted", thread_id: "thread-persisted", imported_items: 0 },
      };
      if (envelope.name === "session.resume") {
        resumeAttempts += 1;
        if (resumeAttempts === 1) return { ok: false, error: { code: "APP_SERVER_UNAVAILABLE", message: "private detail" } };
        return { ok: true, data: persistedSession };
      }
      return { ok: true, data: (data[envelope.name] ?? {}) as never };
    });

    render(<LearnStepperApp bridge={{ invoke }} initialSignals={{ authentication: "authenticated", appServer: "available" }} />);
    await user.click(await screen.findByRole("button", { name: "プロジェクトを開く" }));

    expect(await screen.findByText("失敗後も残る回答です。")).toBeTruthy();
    expect((await screen.findByRole("alert")).textContent).toContain("セッションを再接続できませんでした");
    expect(document.body.textContent).not.toContain("private detail");
    expect((screen.getByRole("textbox", { name: "質問を入力" }) as HTMLTextAreaElement).disabled).toBe(true);

    await user.click(screen.getByRole("button", { name: "再接続を試す" }));
    expect(await screen.findByText("セッション接続済み")).toBeTruthy();
    expect(screen.getByText("失敗後も残る回答です。")).toBeTruthy();
    expect(resumeAttempts).toBe(2);
  });

  test("moves to recoverable reconnect state when the App Server disappears during send", async () => {
    const user = userEvent.setup();
    const invoke = vi.fn(async (envelope: IPCEnvelope): Promise<IPCResponse> => {
      const data: Record<string, unknown> = {
        "profile.get": { id: "profile-1", display_name: "学習者", locale: "ja-JP", timezone: "Asia/Tokyo" },
        "curriculumProfile.list": { items: PROFILES },
        "project.list": { items: [{ id: "project-1", title: "数学", status: "active", mode: "free_topic" }] },
        "project.get": { id: "project-1", title: "数学", status: "active", mode: "free_topic" },
        "plan.getCurrent": { plan: null },
        "learningObjective.list": { items: [] },
        "progress.get": { lesson_total: 0, lesson_completed: 0, progress_rate: 0 },
        "mastery.get": { items: [] },
        "history.listSessions": { items: [] },
        "note.list": { items: [] },
        "bookmark.list": { items: [] },
        "session.start": { id: "session-1", project_id: "project-1", status: "active", active_thread: { id: "thread-1" }, messages: [] },
      };
      if (envelope.name === "message.send") {
        return { ok: false, error: { code: "APP_SERVER_UNAVAILABLE", message: "private process detail" } };
      }
      return { ok: true, data: (data[envelope.name] ?? {}) as never };
    });

    render(<LearnStepperApp bridge={{ invoke }} initialSignals={{ authentication: "authenticated", appServer: "available" }} />);
    await user.click(await screen.findByRole("button", { name: "プロジェクトを開く" }));
    await user.click(await screen.findByRole("button", { name: "セッションを開始" }));
    const composer = screen.getByRole("textbox", { name: "質問を入力" }) as HTMLTextAreaElement;
    await user.type(composer, "保持される質問です");
    await user.click(screen.getByRole("button", { name: "質問を送信" }));

    expect((await screen.findByRole("alert")).textContent).toContain("セッションへの接続が失われました");
    expect(document.body.textContent).not.toContain("private process detail");
    expect(composer.value).toBe("保持される質問です");
    expect(composer.disabled).toBe(true);
    expect(screen.getByRole("button", { name: "再接続を試す" })).toBeTruthy();
  });

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
    emit({ sequence: 1, name: "item.completed", occurred_at: "2026-07-20T00:00:00Z", project_id: "project-1", session_id: "session-1", thread_id: "thread-1", turn_id: "turn-1", item_id: "reasoning-1", payload: { item_type: "reasoning", content: "ライブ内部推論" } });
    expect(screen.queryByText("ライブ内部推論")).toBeNull();
    for (const [label, actionId] of [
      ["もっと簡単に", "explain_simply.v1"],
      ["具体例", "give_example.v1"],
      ["理解を確認", "check_understanding.v1"],
      ["レッスンへ戻る", "return_to_lesson.v1"],
    ] as const) {
      await user.click(screen.getByRole("button", { name: label }));
      expect(invoke).toHaveBeenCalledWith(expect.objectContaining({
        type: "command",
        name: "turn.steer",
        payload: { session_id: "session-1", turn_id: "turn-1", action_id: actionId },
      }));
    }
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
  test("refreshes the selected workspace when entering the library", async () => {
    const user = userEvent.setup();
    let historyCalls = 0;
    const invoke = vi.fn(async (envelope: IPCEnvelope): Promise<IPCResponse> => {
      const data: Record<string, unknown> = {
        "profile.get": { id: "profile-1", display_name: "学習者", locale: "ja-JP", timezone: "Asia/Tokyo" },
        "curriculumProfile.list": { items: PROFILES },
        "project.list": { items: [{ id: "project-1", title: "数学", status: "active", mode: "free_topic" }] },
        "project.get": { id: "project-1", title: "数学", status: "active", mode: "free_topic" },
        "plan.getCurrent": { plan: null },
        "learningObjective.list": { items: [] },
        "progress.get": { lesson_total: 0, lesson_completed: 0, progress_rate: 0 },
        "mastery.get": { items: [] },
        "note.list": { items: [] },
        "bookmark.list": { items: [] },
      };
      if (envelope.name === "history.listSessions") {
        historyCalls += 1;
        return { ok: true, data: { items: historyCalls > 1 ? [{ id: "session-new", started_at: "2026-07-22", summary: "更新後の履歴" }] : [] } };
      }
      return { ok: true, data: (data[envelope.name] ?? {}) as never };
    });

    render(<LearnStepperApp bridge={{ invoke }} />);
    await user.click(await screen.findByRole("button", { name: "プロジェクトを開く" }));
    await user.click(screen.getByRole("button", { name: "ライブラリ" }));

    expect(await screen.findByText("更新後の履歴")).toBeTruthy();
    expect(historyCalls).toBeGreaterThan(1);
  });

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

  test("opens persisted history and updates or deletes saved notes and bookmarks", async () => {
    const user = userEvent.setup();
    const bridge = bridgeFor({
      "project.list": { ok: true, data: { items: [{ id: "project-1", title: "数学", status: "active", mode: "free_topic" }] } },
      "project.get": { ok: true, data: { id: "project-1", title: "数学", status: "active", mode: "free_topic" } },
      "plan.getCurrent": { ok: true, data: { plan: null } },
      "learningObjective.list": { ok: true, data: { items: [] } },
      "progress.get": { ok: true, data: {} },
      "mastery.get": { ok: true, data: { items: [] } },
      "history.listSessions": { ok: true, data: { items: [{ id: "session-1", started_at: "2026-07-21", summary: "一次方程式を復習" }] } },
      "history.getSession": { ok: true, data: { session_id: "session-1", items: [
        { id: "message-hidden", role: "system", item_type: "reasoning", content: "履歴でも非表示の内部推論" },
        { id: "message-1", role: "assistant", item_type: "agentMessage", content: "等式の両辺を同じように扱います。" },
      ], has_more: false, next_after_sequence: 2 } },
      "note.list": { ok: true, data: { items: [{ id: "note-1", content: "移項を復習", updated_at: "2026-07-21" }] } },
      "note.update": { ok: true, data: { id: "note-1", content: "等式変形を復習", updated_at: "2026-07-21" } },
      "note.delete": { ok: true, data: { id: "note-1", deleted: true } },
      "bookmark.list": { ok: true, data: { items: [{ id: "bookmark-1", note: "重要な説明", created_at: "2026-07-21" }] } },
      "bookmark.delete": { ok: true, data: { id: "bookmark-1", deleted: true } },
    });
    render(<LearnStepperApp bridge={bridge} />);

    await user.click(await screen.findByRole("button", { name: "プロジェクトを開く" }));
    await user.click(screen.getByRole("button", { name: "ライブラリ" }));
    await user.click(await screen.findByRole("button", { name: "履歴を開く" }));
    expect(await screen.findByText("等式の両辺を同じように扱います。")).toBeTruthy();
    expect(screen.queryByText("履歴でも非表示の内部推論")).toBeNull();
    expect(bridge.invoke).toHaveBeenCalledWith(expect.objectContaining({ type: "query", name: "history.getSession", payload: { id: "session-1", after_sequence: 0, limit: 200 } }));

    await user.click(screen.getByRole("tab", { name: "ノート" }));
    await user.click(await screen.findByRole("button", { name: "編集" }));
    const noteEditor = screen.getByRole("textbox", { name: "ノートを編集" });
    await user.clear(noteEditor);
    await user.type(noteEditor, "等式変形を復習");
    await user.click(screen.getByRole("button", { name: "変更を保存" }));
    expect(await screen.findByText("等式変形を復習")).toBeTruthy();
    expect(bridge.invoke).toHaveBeenCalledWith(expect.objectContaining({ type: "command", name: "note.update", payload: { id: "note-1", content: "等式変形を復習" } }));
    await user.click(screen.getByRole("button", { name: "削除" }));
    await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith(expect.objectContaining({ type: "command", name: "note.delete", payload: { id: "note-1" } })));

    await user.click(screen.getByRole("tab", { name: "ブックマーク" }));
    expect(await screen.findByText("重要な説明")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "削除" }));
    await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith(expect.objectContaining({ type: "command", name: "bookmark.delete", payload: { id: "bookmark-1" } })));
  });

  test("loads every page of a persisted history before displaying it", async () => {
    const user = userEvent.setup();
    const baseBridge = bridgeFor({
      "project.list": { ok: true, data: { items: [{ id: "project-1", title: "数学", status: "active", mode: "free_topic" }] } },
      "project.get": { ok: true, data: { id: "project-1", title: "数学", status: "active", mode: "free_topic" } },
      "plan.getCurrent": { ok: true, data: { plan: null } },
      "learningObjective.list": { ok: true, data: { items: [] } },
      "progress.get": { ok: true, data: {} },
      "mastery.get": { ok: true, data: { items: [] } },
      "history.listSessions": { ok: true, data: { items: [{ id: "session-1", started_at: "2026-07-21", summary: "長いセッション" }] } },
      "note.list": { ok: true, data: { items: [] } },
      "bookmark.list": { ok: true, data: { items: [] } },
    });
    const invoke = vi.fn(async (envelope: IPCEnvelope): Promise<IPCResponse> => {
      if (envelope.name === "history.getSession") {
        const afterSequence = Number(envelope.payload.after_sequence ?? 0);
        return afterSequence === 0
          ? { ok: true, data: { session_id: "session-1", items: [{ id: "message-1", role: "user", item_type: "userMessage", content: "最初の質問" }], has_more: true, next_after_sequence: 200 } }
          : { ok: true, data: { session_id: "session-1", items: [{ id: "message-2", role: "assistant", item_type: "agentMessage", content: "最後の回答" }], has_more: false, next_after_sequence: 201 } };
      }
      return baseBridge.invoke(envelope);
    });
    const bridge: HostBridge = { invoke };

    render(<LearnStepperApp bridge={bridge} />);
    await user.click(await screen.findByRole("button", { name: "プロジェクトを開く" }));
    await user.click(screen.getByRole("button", { name: "ライブラリ" }));
    await user.click(await screen.findByRole("button", { name: "履歴を開く" }));

    expect(await screen.findByText("最初の質問")).toBeTruthy();
    expect(screen.getByText("最後の回答")).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({ payload: { id: "session-1", after_sequence: 200, limit: 200 } }));
  });

  test("updates the local profile through local persistence", async () => {
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

  test("omits diagnosis and assessment placeholders from the submission surface", async () => {
    const user = userEvent.setup();
    render(<LearnStepperApp bridge={bridgeFor({
      "project.list": { ok: true, data: { items: [{ id: "project-1", title: "数学", status: "active", mode: "curriculum" }] } },
    })} />);

    await user.click(await screen.findByRole("button", { name: "プロジェクトを開く" }));
    expect(screen.queryByRole("button", { name: "初期診断" })).toBeNull();
    expect(screen.queryByRole("button", { name: "演習" })).toBeNull();
    expect(screen.queryByRole("button", { name: "補習" })).toBeNull();
    expect(screen.queryByText(/確定待ち|未実装|保留/)).toBeNull();
  });
});
