"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  IPCError,
  createIPCClient,
  installedHostBridge,
  type HostBridge,
  type JsonObject,
  type JsonValue,
  type RendererEvent,
} from "./bridge/ipc-client";
import { DEFAULT_SIGNALS, deriveCapabilities, type Capabilities, type RuntimeSignals } from "./state/capabilities";
import { buildProjectCreatePayload, type ProjectSetupDraft } from "./features/setup/project-payload";
import {
  loadObjectiveDetails,
  loadProjectSources,
  loadProjectWorkspace,
  type ProjectWorkspace,
  type SourceRecord,
} from "./services/project-data";

type Screen = "home" | "setup" | "learning" | "objectives" | "diagnosis" | "plan" | "assessment" | "finalAssessment" | "remediation" | "sources" | "progress" | "library" | "settings" | "projectSettings";
type BootState = "loading" | "profile" | "empty" | "ready" | "recovery" | "preview";

type Profile = { id: string; display_name: string; locale: string; timezone: string };
type Project = {
  id: string;
  title: string;
  topic?: string;
  purpose?: string;
  mode: "curriculum" | "free_topic";
  status: "active" | "paused" | "completed" | "archived";
  current_level?: string;
  target_level?: string;
  target_date?: string | null;
  preferred_session_minutes?: number;
  progress_rate?: number;
};
const NAV: Array<{ id: Screen; label: string; mark: string }> = [
  { id: "home", label: "ホーム", mark: "01" },
  { id: "learning", label: "学習", mark: "02" },
  { id: "progress", label: "進捗", mark: "03" },
  { id: "library", label: "ライブラリ", mark: "04" },
  { id: "settings", label: "設定", mark: "05" },
];

const PROJECT_STATUS_LABELS: Record<Project["status"], string> = {
  active: "学習中",
  paused: "一時停止中",
  completed: "完了",
  archived: "アーカイブ済み",
};

const ATTAINMENT_LABELS: Record<string, string> = {
  not_started: "未開始",
  in_progress: "学習中",
  needs_review: "復習が必要",
  achieved: "達成",
  invalidated: "再確認が必要",
};

const OBJECTIVE_SCOPE_LABELS: Record<string, string> = {
  project: "プロジェクト",
  module: "モジュール",
  lesson: "レッスン",
};

const MASTERY_STATUS_LABELS: Record<string, string> = {
  not_started: "未開始",
  learning: "学習中",
  needs_review: "復習が必要",
  mastered: "習得済み",
  on_hold: "一時停止中",
};

const VERIFICATION_LABELS: Record<string, string> = {
  verified: "確認済み",
  unverified: "未確認",
  stale: "更新確認が必要",
  rejected: "不採用",
};

function displayLabel(labels: Record<string, string>, value: JsonValue | undefined, fallback: string) {
  return typeof value === "string" ? labels[value] ?? fallback : fallback;
}

const EMPTY_DRAFT: ProjectSetupDraft = {
  mode: "free_topic",
  title: "",
  topic: "",
  purpose: "",
  curriculumId: null,
  currentLevel: "",
  targetLevel: "",
  targetDate: null,
  preferredSessionMinutes: 25,
  prerequisites: "",
  intendedUse: "",
  exclusions: "",
};

function asObject(value: JsonValue): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function asItems<T>(value: JsonValue): T[] {
  const items = asObject(value).items;
  return Array.isArray(items) ? items as T[] : [];
}

function Brand() {
  return (
    <div className="renderer-brand" aria-label="LearnStepper">
      <span className="renderer-brand-mark" aria-hidden="true">L</span>
      <span>Learn<b>Stepper</b></span>
    </div>
  );
}

function CapabilityBanner({
  signals,
  preview,
  authBusy,
  authError,
  onLogin,
  onCancel,
}: {
  signals: RuntimeSignals;
  preview: boolean;
  authBusy: boolean;
  authError: string | null;
  onLogin: () => void;
  onCancel: () => void;
}) {
  if (preview) {
    return (
      <div className="renderer-banner renderer-banner-preview" role="status">
        <strong>プレビュー</strong>
        <span>この画面の操作は保存されません。デスクトップアプリでは学習内容をこの端末に保存します。</span>
      </div>
    );
  }
  if (signals.network === "offline") {
    return (
      <div className="renderer-banner renderer-banner-warning" role="status">
        <strong>ネットワーク接続なし</strong>
        <span>保存済みデータとローカル操作は利用できます。AI生成と資料取得は停止中です。</span>
      </div>
    );
  }
  if (signals.appServer === "unavailable") {
    return (
      <div className="renderer-banner renderer-banner-warning" role="status">
        <strong>AI機能を準備できません</strong>
        <span>保存済みデータは利用できます。アプリを再起動してもう一度お試しください。</span>
      </div>
    );
  }
  if (["starting", "awaiting_browser", "verifying"].includes(signals.authentication)) {
    return (
      <div className="renderer-banner renderer-banner-warning" role="status">
        <strong>{signals.authentication === "verifying" ? "ログインを確認しています" : "ブラウザでログインを完了してください"}</strong>
        <span>ログインが完了すると、この画面からAI学習を開始できます。</span>
        <button type="button" disabled={signals.authentication === "verifying"} onClick={onCancel}>キャンセル</button>
      </div>
    );
  }
  if (signals.authentication === "unauthenticated" || signals.authentication === "error") {
    return (
      <div className="renderer-banner renderer-banner-warning" role="status">
        <strong>AI学習を始めるにはログインが必要です</strong>
        <span>保存済みデータは利用できます。Codexを通じてChatGPTアカウントへ安全に接続します。</span>
        <button className="renderer-primary" type="button" disabled={authBusy} onClick={onLogin}>{authBusy ? "ログインを準備中" : "ChatGPTにログインする"}</button>
        {authError && <span role="alert">{authError}</span>}
      </div>
    );
  }
  return null;
}

function ProfileSetup({ onSave, busy, error }: { onSave: (data: Omit<Profile, "id">) => void; busy: boolean; error: string | null }) {
  const [displayName, setDisplayName] = useState("");
  return (
    <main className="renderer-onboarding">
      <Brand />
      <section className="renderer-onboarding-card">
        <p className="renderer-kicker">LOCAL PROFILE</p>
        <h1>最初にプロフィールを設定します</h1>
        <p>学習状態はこの端末に保存されます。ChatGPTの認証情報とは分離されています。</p>
        <label>表示名<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
        <label>言語<select defaultValue="ja-JP"><option value="ja-JP">日本語</option></select></label>
        <label>タイムゾーン<select defaultValue="Asia/Tokyo"><option value="Asia/Tokyo">Asia/Tokyo</option></select></label>
        {error && <p className="renderer-error" role="alert">{error}</p>}
        <button className="renderer-primary" type="button" disabled={busy || !displayName.trim()} onClick={() => onSave({ display_name: displayName.trim(), locale: "ja-JP", timezone: "Asia/Tokyo" })}>
          {busy ? "保存中" : "プロフィールを保存"}
        </button>
      </section>
    </main>
  );
}

function Recovery() {
  return (
    <main className="renderer-onboarding">
      <Brand />
      <section className="renderer-onboarding-card renderer-recovery">
        <p className="renderer-kicker">LOCAL DATA</p>
        <h1>ローカルデータを開けません</h1>
        <p>ネットワーク状態とは別の問題です。学習データを変更せずに処理を停止しました。</p>
        <button className="renderer-primary" type="button" onClick={() => window.location.reload()}>もう一度確認</button>
      </section>
    </main>
  );
}

function Dashboard({ projects, preview, onCreate, onSelect, onManage }: { projects: Project[]; preview: boolean; onCreate: () => void; onSelect: (id: string) => void; onManage: (id: string) => void }) {
  if (projects.length === 0) {
    return (
      <section className="renderer-empty">
        <p className="renderer-kicker">YOUR FIRST STEP</p>
        <h1>最初の学びを作成します</h1>
        <p>興味のあるテーマと到達したい目標を設定し、自分のペースで学び始めます。</p>
        <button className="renderer-primary" type="button" onClick={onCreate}>新しい学習を作成</button>
        {preview && <p className="renderer-caption">プレビューでは入力内容を保存しません。</p>}
      </section>
    );
  }
  return (
    <section>
      <div className="renderer-page-heading">
        <div><p className="renderer-kicker">CONTINUE LEARNING</p><h1>学びの現在地</h1></div>
        <button className="renderer-primary" type="button" onClick={onCreate}>新しい学習を作成</button>
      </div>
      <div className="renderer-project-grid">
        {projects.map((project) => (
          <article className="renderer-project-card" key={project.id}>
            <div className="renderer-card-meta"><span>学習テーマ</span><span>{PROJECT_STATUS_LABELS[project.status]}</span></div>
            <h2>{project.title}</h2>
            <p>{project.purpose || "保存済みの学習プロジェクト"}</p>
            <div className="renderer-card-actions"><button type="button" onClick={() => onSelect(project.id)}>プロジェクトを開く</button><button type="button" aria-label={`${project.title}を管理`} onClick={() => onManage(project.id)}>管理</button></div>
          </article>
        ))}
      </div>
    </section>
  );
}

function SetupScreen({ preview, client, onCreated }: {
  preview: boolean;
  client: ReturnType<typeof createIPCClient> | null;
  onCreated: (project: Project) => void;
}) {
  const [draft, setDraft] = useState<ProjectSetupDraft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = <K extends keyof ProjectSetupDraft>(key: K, value: ProjectSetupDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const canSubmit = draft.title.trim() && draft.topic.trim() && draft.purpose.trim() && draft.currentLevel.trim() && draft.targetLevel.trim();

  async function submit() {
    setError(null);
    if (preview || !client) {
      setError("プレビューでは保存できません。デスクトップアプリから作成できます。");
      return;
    }
    setBusy(true);
    try {
      const project = await client.command<JsonObject>("project.create", buildProjectCreatePayload(draft));
      onCreated(project as unknown as Project);
    } catch (caught) {
      setError(caught instanceof IPCError ? caught.userMessage : "プロジェクトを作成できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="renderer-page-heading"><div><p className="renderer-kicker">NEW LEARNING</p><h1>新しい学びを作成</h1></div><span className="renderer-step">入力 1 / 1</span></div>
      <div className="renderer-form-layout">
        <form className="renderer-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <div className="renderer-field-pair">
            <label>プロジェクト名<input value={draft.title} onChange={(event) => update("title", event.target.value)} /></label>
            <label>学習テーマ<input value={draft.topic} onChange={(event) => update("topic", event.target.value)} /></label>
          </div>
          <label>学習目的<textarea value={draft.purpose} onChange={(event) => update("purpose", event.target.value)} /></label>
          <div className="renderer-field-pair">
            <label>現在のレベル<input value={draft.currentLevel} onChange={(event) => update("currentLevel", event.target.value)} /></label>
            <label>目標レベル<input value={draft.targetLevel} onChange={(event) => update("targetLevel", event.target.value)} /></label>
          </div>
          <div className="renderer-field-pair">
            <label>目標日<input type="date" value={draft.targetDate ?? ""} onChange={(event) => update("targetDate", event.target.value || null)} /></label>
            <label>1回の学習時間<input type="number" min={1} max={1440} value={draft.preferredSessionMinutes} onChange={(event) => update("preferredSessionMinutes", Number(event.target.value))} /></label>
          </div>
          <label>前提知識<input value={draft.prerequisites} onChange={(event) => update("prerequisites", event.target.value)} /></label>
          <label>用途<input value={draft.intendedUse} onChange={(event) => update("intendedUse", event.target.value)} /></label>
          <label>除外事項<input value={draft.exclusions} onChange={(event) => update("exclusions", event.target.value)} /></label>
          {error && <p className="renderer-error" role="alert">{error}</p>}
          <button className="renderer-primary" type="submit" disabled={!canSubmit || busy}>{busy ? "作成中" : "学びを作成"}</button>
        </form>
        <aside className="renderer-side-note">
          <h2>作成後の流れ</h2>
          <ol><li>到達したい目標を確認</li><li>学習の進め方を確認</li><li>AIとの対話で学習を開始</li></ol>
          <p>入力内容は後からプロジェクト設定で変更できます。</p>
        </aside>
      </div>
    </section>
  );
}

type ConversationMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  pending?: boolean;
};

const QUICK_ACTIONS = [
  ["explain_simply.v1", "もっと簡単に"],
  ["give_example.v1", "具体例"],
  ["check_understanding.v1", "理解を確認"],
  ["return_to_lesson.v1", "レッスンへ戻る"],
] as const;

function firstLessonId(plan: JsonObject | null): string | null {
  if (!plan || !Array.isArray(plan.modules)) return null;
  for (const moduleValue of plan.modules) {
    const planModule = asObject(moduleValue);
    if (!Array.isArray(planModule.lessons)) continue;
    for (const lessonValue of planModule.lessons) {
      const lesson = asObject(lessonValue);
      if (typeof lesson.id === "string" && lesson.id) return lesson.id;
    }
  }
  return null;
}

function confirmedMessages(session: JsonObject): ConversationMessage[] {
  if (!Array.isArray(session.messages)) return [];
  return session.messages.map((value, index) => {
    const message = asObject(value);
    const role = message.role === "user" || message.role === "assistant" ? message.role : "system";
    return {
      id: String(message.id ?? `history-${index}`),
      role,
      content: String(message.content ?? ""),
    };
  });
}

function ConversationPanel({
  project,
  workspace,
  client,
  bridge,
  capabilities,
}: {
  project: Project;
  workspace: ProjectWorkspace | null;
  client: ReturnType<typeof createIPCClient> | null;
  bridge: HostBridge | null;
  capabilities: Capabilities;
}) {
  const [session, setSession] = useState<JsonObject | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [turn, setTurn] = useState<{ id: string; status: string } | null>(null);
  const [delta, setDelta] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bookmarkedIds, setBookmarkedIds] = useState<Set<string>>(new Set());
  const [completionDraft, setCompletionDraft] = useState({ summary: "", nextAction: "" });

  const sessionId = typeof session?.id === "string" ? session.id : null;
  const turnInProgress = turn?.status === "in_progress" || turn?.status === "interrupting";

  useEffect(() => {
    if (!client || !workspace) return;
    const resumable = workspace.sessions.find((candidate) => candidate.status === "active" || candidate.status === "interrupted");
    if (!resumable || typeof resumable.id !== "string") return;
    let cancelled = false;
    void client.query<JsonObject>("session.get", { id: resumable.id })
      .then((loaded) => {
        if (cancelled) return;
        setSession(loaded);
        setMessages(confirmedMessages(loaded));
      })
      .catch(() => {
        if (!cancelled) setError("保存済みセッションの詳細を取得できませんでした。");
      });
    return () => { cancelled = true; };
  }, [client, project.id, workspace]);

  useEffect(() => {
    if (!bridge?.subscribe) return;
    return bridge.subscribe((event: RendererEvent) => {
      if (event.project_id && event.project_id !== project.id) return;
      if (sessionId && event.session_id && event.session_id !== sessionId) return;
      if (event.name === "item.agentMessageDelta") {
        const next = event.payload.delta;
        if (typeof next === "string") setDelta((current) => current + next);
        return;
      }
      if (event.name === "item.completed") {
        const content = event.payload.content;
        const itemType = event.payload.item_type;
        if (typeof content !== "string") return;
        if (itemType === "userMessage") {
          setMessages((current) => {
            const pendingIndex = current.findIndex((message) => message.role === "user" && message.pending);
            if (pendingIndex < 0) return [...current, { id: event.item_id ?? `event-${event.sequence}`, role: "user", content }];
            return current.map((message, index) => index === pendingIndex ? { ...message, id: event.item_id ?? message.id, content, pending: false } : message);
          });
        } else {
          setMessages((current) => current.some((message) => message.id === event.item_id)
            ? current
            : [...current, { id: event.item_id ?? `event-${event.sequence}`, role: itemType === "agentMessage" ? "assistant" : "system", content }]);
          if (itemType === "agentMessage") setDelta("");
        }
        return;
      }
      if (event.name === "turn.completed") {
        const status = event.payload.status;
        if (typeof status === "string") setTurn((current) => current ? { ...current, status } : event.turn_id ? { id: event.turn_id, status } : null);
      }
    });
  }, [bridge, project.id, sessionId]);

  async function startSession() {
    if (!client || !capabilities.conversation) return;
    setBusy(true);
    setError(null);
    try {
      const created = await client.command<JsonObject>("session.start", {
        project_id: project.id,
        lesson_id: firstLessonId(workspace?.plan ?? null),
      });
      setSession(created);
      setMessages(confirmedMessages(created));
    } catch (caught) {
      setError(caught instanceof IPCError ? caught.userMessage : "セッションを開始できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  async function resumeSession() {
    if (!client || !sessionId) return;
    const activeThread = asObject(session?.active_thread as JsonValue);
    if (typeof activeThread.id !== "string") { setError("再開対象のスレッドが見つかりません。"); return; }
    setBusy(true); setError(null);
    try {
      const resumed = await client.command<JsonObject>("session.resume", { session_id: sessionId, thread_id: activeThread.id });
      setSession(resumed);
      setMessages(confirmedMessages(resumed));
    } catch (caught) { setError(caught instanceof IPCError ? caught.userMessage : "セッションを再開できませんでした。"); }
    finally { setBusy(false); }
  }

  async function sendMessage() {
    const text = draft.trim();
    if (!client || !sessionId || !text || turnInProgress) return;
    const command = client.prepareCommand<JsonObject>("message.send", { session_id: sessionId, text });
    setMessages((current) => [...current, { id: command.requestId, role: "user", content: text, pending: true }]);
    setDraft("");
    setError(null);
    try {
      const result = await command.execute();
      const id = typeof result.turn_id === "string" ? result.turn_id : command.requestId;
      setTurn({ id, status: String(result.status ?? "in_progress") });
    } catch (caught) {
      setMessages((current) => current.filter((message) => message.id !== command.requestId));
      setDraft(text);
      setError(caught instanceof IPCError ? caught.userMessage : "質問を送信できませんでした。入力は保持されています。");
    }
  }

  async function steer(actionId: string) {
    if (!client || !sessionId || !turn || turn.status !== "in_progress") return;
    setError(null);
    try {
      await client.command("turn.steer", { session_id: sessionId, turn_id: turn.id, action_id: actionId });
    } catch (caught) {
      setError(caught instanceof IPCError ? caught.userMessage : "追加指示を送信できませんでした。");
    }
  }

  async function interrupt() {
    if (!client || !sessionId || !turn || turn.status !== "in_progress") return;
    setTurn({ ...turn, status: "interrupting" });
    setError(null);
    try {
      const result = await client.command<JsonObject>("turn.interrupt", { session_id: sessionId, turn_id: turn.id });
      setTurn({ id: turn.id, status: String(result.status ?? "interrupted") });
    } catch (caught) {
      setTurn({ ...turn, status: "in_progress" });
      setError(caught instanceof IPCError ? caught.userMessage : "回答を停止できませんでした。");
    }
  }

  async function bookmarkMessage(message: ConversationMessage) {
    if (!client || bookmarkedIds.has(message.id)) return;
    setError(null);
    try {
      await client.command("bookmark.create", {
        project_id: project.id,
        lesson_id: firstLessonId(workspace?.plan ?? null),
        concept_id: null,
        message_id: message.id,
        note: null,
        source_document_ids: [],
        curriculum_item_ids: [],
      });
      setBookmarkedIds((current) => new Set(current).add(message.id));
    } catch (caught) {
      setError(caught instanceof IPCError ? caught.userMessage : "ブックマークを保存できませんでした。");
    }
  }

  async function forkMessage(message: ConversationMessage) {
    if (!client || !sessionId || turnInProgress) return;
    const activeThread = asObject(session?.active_thread as JsonValue);
    if (typeof activeThread.id !== "string") { setError("分岐元のスレッドが見つかりません。"); return; }
    setBusy(true); setError(null);
    try {
      const child = await client.command<JsonObject>("thread.fork", { session_id: sessionId, source_thread_id: activeThread.id, through_item_id: message.id });
      setSession((current) => current ? { ...current, active_thread: child } : current);
    } catch (caught) { setError(caught instanceof IPCError ? caught.userMessage : "会話を分岐できませんでした。"); }
    finally { setBusy(false); }
  }

  async function completeSession() {
    if (!client || !sessionId || !completionDraft.summary.trim() || !completionDraft.nextAction.trim()) return;
    setBusy(true); setError(null);
    try {
      setSession(await client.command<JsonObject>("session.complete", { id: sessionId, summary: completionDraft.summary.trim(), next_action: completionDraft.nextAction.trim() }));
    } catch (caught) { setError(caught instanceof IPCError ? caught.userMessage : "セッションを完了できませんでした。"); }
    finally { setBusy(false); }
  }

  if (!capabilities.conversation) {
    return (
      <article className="renderer-conversation">
        <div className="renderer-message"><span>LearnStepper</span><p>AI接続が完了すると会話を開始できます。保存済みデータは引き続き利用できます。</p></div>
        <label className="renderer-composer">質問を入力<textarea disabled placeholder="AI機能の接続待ち" /></label>
        <button className="renderer-primary" type="button" disabled>質問を送信</button>
      </article>
    );
  }

  return (
    <article className="renderer-conversation">
      <div className="renderer-conversation-header"><strong>{sessionId ? "セッション接続済み" : "新しいセッション"}</strong>{turn?.status === "completed" && <span role="status">回答完了</span>}{turn?.status === "interrupted" && <span role="status">停止しました</span>}</div>
      {!sessionId ? (
        <button className="renderer-primary" type="button" disabled={busy || !workspace} onClick={() => void startSession()}>{busy ? "開始中" : "セッションを開始"}</button>
      ) : session?.status === "completed" ? (
        <div className="renderer-message"><span>セッション完了</span><p>{String(session.summary ?? "要約なし")}</p><small>次にすること: {String(session.next_action ?? "未設定")}</small></div>
      ) : session?.status === "interrupted" ? (
        <button className="renderer-primary" type="button" disabled={busy} onClick={() => void resumeSession()}>{busy ? "再開中" : "セッションを再開"}</button>
      ) : (
        <>
          <div className="renderer-message-list" aria-live="polite">
            {messages.length === 0 && <div className="renderer-message"><span>LearnStepper</span><p>質問を入力すると学習を開始します。</p></div>}
            {messages.map((message) => <div className={`renderer-message is-${message.role}`} key={message.id}><span>{message.role === "user" ? "あなた" : message.role === "assistant" ? "LearnStepper" : "システム"}{message.pending ? " · 送信確認中" : ""}</span><p>{message.content}</p>{!message.pending && message.role !== "system" && <div className="renderer-card-actions">{message.role === "assistant" && <button type="button" disabled={bookmarkedIds.has(message.id)} onClick={() => void bookmarkMessage(message)}>{bookmarkedIds.has(message.id) ? "ブックマーク済み" : "この回答をブックマーク"}</button>}<button type="button" disabled={busy || turnInProgress} onClick={() => void forkMessage(message)}>ここから会話を分岐</button></div>}</div>)}
            {delta && <div className="renderer-message is-assistant is-streaming"><span>LearnStepper · 応答中</span><p>{delta}</p></div>}
          </div>
          {turn?.status === "in_progress" && <div className="renderer-quick-actions">{QUICK_ACTIONS.map(([id, label]) => <button type="button" key={id} onClick={() => void steer(id)}>{label}</button>)}</div>}
          <label className="renderer-composer">質問を入力<textarea aria-label="質問を入力" value={draft} disabled={turnInProgress} onChange={(event) => setDraft(event.target.value)} /></label>
          <div className="renderer-conversation-actions"><button className="renderer-primary" type="button" disabled={!draft.trim() || turnInProgress} onClick={() => void sendMessage()}>質問を送信</button>{turnInProgress && <button type="button" disabled={turn?.status === "interrupting"} onClick={() => void interrupt()}>{turn?.status === "interrupting" ? "停止中" : "回答を停止"}</button>}</div>
          {!turnInProgress && session?.status !== "completed" && <details className="renderer-session-complete"><summary>セッションを終了</summary><label>今回の要約<textarea value={completionDraft.summary} onChange={(event) => setCompletionDraft((current) => ({ ...current, summary: event.target.value }))} /></label><label>次にすること<input value={completionDraft.nextAction} onChange={(event) => setCompletionDraft((current) => ({ ...current, nextAction: event.target.value }))} /></label><button type="button" disabled={busy || !completionDraft.summary.trim() || !completionDraft.nextAction.trim()} onClick={() => void completeSession()}>確定して終了</button></details>}
        </>
      )}
      {error && <p className="renderer-error" role="alert">{error}</p>}
    </article>
  );
}

function LearningScreen({ selectedProject, workspace, loading, client, bridge, capabilities, onNavigate }: { selectedProject: Project | null; workspace: ProjectWorkspace | null; loading: boolean; client: ReturnType<typeof createIPCClient> | null; bridge: HostBridge | null; capabilities: Capabilities; onNavigate: (screen: Screen) => void }) {
  if (!selectedProject) return <section className="renderer-empty"><p className="renderer-kicker">LEARNING</p><h1>学習プロジェクトが選択されていません</h1><p>ホームから保存済みプロジェクトを選択してください。</p></section>;
  return (
    <section>
      <div className="renderer-page-heading"><div><p className="renderer-kicker">LEARNING SESSION</p><h1>{selectedProject.title}</h1></div><span className="renderer-status">確定履歴のみ表示</span></div>
      {(Boolean(workspace?.objectives.length) || Boolean(workspace?.plan)) && <nav className="renderer-context-nav" aria-label="学習ツール">{Boolean(workspace?.objectives.length) && <button type="button" onClick={() => onNavigate("objectives")}>学習目標</button>}{workspace?.plan && <button type="button" onClick={() => onNavigate("plan")}>学習計画</button>}</nav>}
      <div className="renderer-learning-grid">
        <aside className="renderer-panel"><h2>現在地</h2>{loading ? <p>計画を読み込んでいます。</p> : workspace?.plan ? <PlanOutline plan={workspace.plan} /> : <p>会話から学びを始められます。</p>}</aside>
        <ConversationPanel project={selectedProject} workspace={workspace} client={client} bridge={bridge} capabilities={capabilities} />
        <aside className="renderer-panel"><h2>今回の目標</h2>{workspace?.objectives.length ? <ObjectiveSummary objectives={workspace.objectives} /> : <p>設定したテーマについて質問してみましょう。</p>}</aside>
      </div>
    </section>
  );
}

function PlanOutline({ plan }: { plan: JsonObject }) {
  const modules = Array.isArray(plan.modules) ? plan.modules as JsonObject[] : [];
  return <div className="renderer-plan-outline">{modules.map((module, index) => <div key={String(module.id ?? index)}><strong>{String(module.title ?? `モジュール ${index + 1}`)}</strong><small>{String(module.estimated_minutes ?? "-")}分</small></div>)}</div>;
}

function ObjectiveSummary({ objectives }: { objectives: Array<JsonObject & { id: string }> }) {
  return <div className="renderer-objective-list">{objectives.slice(0, 4).map((objective) => { const version = asObject(objective.current_version as JsonValue); return <article key={objective.id}><span>{version.goal_type === "can_do" ? "できること" : "わかること"}</span><strong>{String(version.statement ?? "目標文未設定")}</strong><small>対象: {displayLabel(OBJECTIVE_SCOPE_LABELS, version.scope, "未設定")} · 版 {String(version.version_number ?? version.version ?? "-")}</small><p>成功基準: {String(version.success_criteria ?? "未設定")}</p></article>; })}</div>;
}

function ProjectFeatureScreen({ screen, project, workspace, client, onNavigate }: { screen: Screen; project: Project | null; workspace: ProjectWorkspace | null; client: ReturnType<typeof createIPCClient> | null; onNavigate: (screen: Screen) => void }) {
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [objectiveDetails, setObjectiveDetails] = useState<Array<{ objective: JsonObject; attainment: JsonObject; evidence: JsonObject[] }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (screen !== "objectives" || !client || !workspace) return;
    let cancelled = false;
    void loadProjectSources(client, workspace)
      .then((records) => { if (!cancelled) setSources(records); })
      .catch((caught) => { if (!cancelled) setError(caught instanceof IPCError ? caught.userMessage : "根拠資料を取得できませんでした。"); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [client, screen, workspace]);
  useEffect(() => {
    if (screen !== "objectives" || !client || !workspace?.objectives.length) return;
    let cancelled = false;
    void Promise.all(workspace.objectives.map((objective) => loadObjectiveDetails(client, objective.id)))
      .then((details) => { if (!cancelled) setObjectiveDetails(details); })
      .catch((caught) => { if (!cancelled) setError(caught instanceof IPCError ? caught.userMessage : "目標の証拠を取得できませんでした。"); });
    return () => { cancelled = true; };
  }, [client, screen, workspace]);

  const headings: Partial<Record<Screen, string>> = { objectives: "学習目標", plan: "学習計画" };
  if (!project) return <section className="renderer-empty"><h1>プロジェクトが選択されていません</h1><button type="button" onClick={() => onNavigate("learning")}>学習へ戻る</button></section>;
  return (
    <section>
      <div className="renderer-page-heading"><div><p className="renderer-kicker">{project.title}</p><h1>{headings[screen]}</h1></div><button type="button" onClick={() => onNavigate("learning")}>学習へ戻る</button></div>
      {error && <p className="renderer-error" role="alert">{error}</p>}
      {screen === "objectives" && <><ObjectiveSummary objectives={workspace?.objectives ?? []} /><div className="renderer-evidence-grid">{objectiveDetails.map((detail) => { const objective = asObject(detail.objective.current_version as JsonValue); return <article key={String(detail.objective.id)}><strong>{String(objective.statement ?? "目標")}</strong><p>達成状態: {displayLabel(ATTAINMENT_LABELS, detail.attainment.status, "判定なし")}</p><small>確認済みの学習記録 {detail.evidence.length}件</small></article>; })}</div>{busy ? <p>関連資料を確認しています。</p> : sources.length > 0 ? <SourceList sources={sources} /> : null}{workspace?.plan && <div className="renderer-card-actions"><button type="button" onClick={() => onNavigate("plan")}>学習計画を見る</button></div>}</>}
      {screen === "plan" && <div>{workspace?.plan ? <PlanOutline plan={workspace.plan} /> : <p>現在の学習計画はありません。</p>}{workspace?.plan && <button type="button" onClick={() => onNavigate("learning")}>学習へ戻る</button>}</div>}
    </section>
  );
}

function SourceList({ sources }: { sources: SourceRecord[] }) {
  if (!sources.length) return <div className="renderer-empty-inline">現在の計画・目標に関連する保存済み資料はありません。</div>;
  return <div className="renderer-source-list">{sources.map((source) => <article key={source.id}><span>{displayLabel(VERIFICATION_LABELS, source.verification_status, "確認状態不明")}</span><h2>{String(source.title ?? source.official_name ?? source.id)}</h2><p>{String(source.publisher ?? source.authority ?? "発行主体不明")} · 版 {String(source.version ?? "不明")}</p><small>引用 {source.citations.length}件 · 取得時点 {String(source.retrieved_at ?? "不明")}</small></article>)}</div>;
}

function ProgressScreen({ selectedProject, workspace, loading }: { selectedProject: Project | null; workspace: ProjectWorkspace | null; loading: boolean }) {
  const total = Number(workspace?.progress.lesson_total ?? 0);
  const completed = Number(workspace?.progress.lesson_completed ?? 0);
  const rate = Number(workspace?.progress.progress_rate ?? 0);
  return (
    <section>
      <div className="renderer-page-heading"><div><p className="renderer-kicker">EVIDENCE, NOT ESTIMATES</p><h1>進捗と習熟度</h1></div></div>
      {!selectedProject ? <div className="renderer-empty-inline">プロジェクトを選択すると進捗を表示します。</div> : loading ? <div className="renderer-empty-inline">進捗を読み込んでいます。</div> : (
        <><div className="renderer-metric-grid"><article><span>レッスン進捗</span><strong>{total ? `${completed} / ${total}` : "計画データなし"}</strong><small>{total ? `${Math.round(rate * 100)}%` : "学習を始めると記録されます"}</small></article><article><span>学習目標</span><strong>{workspace?.objectives.length ?? 0}件</strong><small>保存された学習記録から表示</small></article></div>
        <div className="renderer-progress-columns"><section><h2>概念別の理解度</h2>{workspace?.mastery.length ? workspace.mastery.map((item, index) => <div className="renderer-progress-row" key={String(item.id ?? index)}><strong>{String(item.name ?? "概念")}</strong><span>{displayLabel(MASTERY_STATUS_LABELS, item.status, "未評価")}</span></div>) : <p>学習を進めると、ここに理解度が表示されます。</p>}</section></div></>
      )}
    </section>
  );
}

function LibraryScreen({ selectedProject, workspace, loading, client }: { selectedProject: Project | null; workspace: ProjectWorkspace | null; loading: boolean; client: ReturnType<typeof createIPCClient> | null }) {
  const [tab, setTab] = useState<"history" | "notes" | "bookmarks">("history");
  const [notesOverride, setNotesOverride] = useState<JsonObject[] | null>(null);
  const [bookmarksOverride, setBookmarksOverride] = useState<JsonObject[] | null>(null);
  const [draft, setDraft] = useState("");
  const [historyDetail, setHistoryDetail] = useState<JsonObject | null>(null);
  const [editingNote, setEditingNote] = useState<{ id: string; content: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const notes = notesOverride ?? workspace?.notes ?? [];
  const bookmarks = bookmarksOverride ?? workspace?.bookmarks ?? [];
  const records = tab === "history" ? workspace?.sessions : tab === "notes" ? notes : bookmarks;

  async function createNote() {
    if (!client || !selectedProject || !draft.trim()) return;
    setBusy(true); setError(null);
    try {
      const note = await client.command<JsonObject>("note.create", { project_id: selectedProject.id, lesson_id: firstLessonId(workspace?.plan ?? null), concept_id: null, content: draft.trim(), source_document_ids: [], curriculum_item_ids: [] });
      setNotesOverride((current) => [note, ...(current ?? workspace?.notes ?? [])]); setDraft("");
    } catch (caught) { setError(caught instanceof IPCError ? caught.userMessage : "ノートを保存できませんでした。"); }
    finally { setBusy(false); }
  }

  async function deleteRecord(kind: "note" | "bookmark", id: string) {
    if (!client) return;
    setBusy(true); setError(null);
    try { await client.command(`${kind}.delete`, { id }); if (kind === "note") setNotesOverride(notes.filter((item) => item.id !== id)); else setBookmarksOverride(bookmarks.filter((item) => item.id !== id)); }
    catch (caught) { setError(caught instanceof IPCError ? caught.userMessage : "保存情報を削除できませんでした。"); }
    finally { setBusy(false); }
  }

  async function loadHistory(id: string) {
    if (!client) return;
    setBusy(true); setError(null);
    try { setHistoryDetail(await client.query<JsonObject>("history.getSession", { id })); }
    catch (caught) { setError(caught instanceof IPCError ? caught.userMessage : "履歴の詳細を取得できませんでした。"); }
    finally { setBusy(false); }
  }

  async function updateNote() {
    if (!client || !editingNote?.content.trim()) return;
    setBusy(true); setError(null);
    try {
      const updated = await client.command<JsonObject>("note.update", { id: editingNote.id, content: editingNote.content.trim() });
      setNotesOverride(notes.map((note) => note.id === updated.id ? updated : note));
      setEditingNote(null);
    } catch (caught) { setError(caught instanceof IPCError ? caught.userMessage : "ノートを更新できませんでした。"); }
    finally { setBusy(false); }
  }
  return (
    <section>
      <div className="renderer-page-heading"><div><p className="renderer-kicker">LEARNING MEMORY</p><h1>ライブラリ</h1></div></div>
      <div className="renderer-tabs" role="tablist"><button role="tab" aria-selected={tab === "history"} onClick={() => setTab("history")}>履歴</button><button role="tab" aria-selected={tab === "notes"} onClick={() => setTab("notes")}>ノート</button><button role="tab" aria-selected={tab === "bookmarks"} onClick={() => setTab("bookmarks")}>ブックマーク</button></div>
      {error && <p className="renderer-error" role="alert">{error}</p>}
      {tab === "notes" && selectedProject && <div className="renderer-note-composer"><label>新しいノート<textarea aria-label="新しいノート" value={draft} onChange={(event) => setDraft(event.target.value)} /></label><button className="renderer-primary" type="button" disabled={busy || !draft.trim()} onClick={() => void createNote()}>ノートを保存</button></div>}
      {editingNote && <div className="renderer-note-composer"><label>ノートを編集<textarea value={editingNote.content} onChange={(event) => setEditingNote({ ...editingNote, content: event.target.value })} /></label><div className="renderer-card-actions"><button className="renderer-primary" type="button" disabled={busy || !editingNote.content.trim()} onClick={() => void updateNote()}>変更を保存</button><button type="button" onClick={() => setEditingNote(null)}>キャンセル</button></div></div>}
      <div className="renderer-library-records">{!selectedProject ? <div className="renderer-empty-inline">プロジェクトを選択してください。</div> : loading ? <div className="renderer-empty-inline">保存済みデータを読み込んでいます。</div> : records?.length ? records.map((record, index) => <article key={String(record.id ?? index)}><span>{tab === "history" ? String(record.started_at ?? "日時不明") : tab === "notes" ? String(record.updated_at ?? "更新日時不明") : String(record.created_at ?? "作成日時不明")}</span><strong>{tab === "history" ? String(record.summary ?? record.status ?? "セッション") : tab === "notes" ? String(record.content ?? "ノート") : String(record.note ?? "保存したメッセージ")}</strong><div className="renderer-card-actions">{tab === "history" && typeof record.id === "string" && <button type="button" disabled={busy} onClick={() => void loadHistory(record.id as string)}>履歴を開く</button>}{tab === "notes" && typeof record.id === "string" && <button type="button" onClick={() => setEditingNote({ id: record.id as string, content: String(record.content ?? "") })}>編集</button>}{(tab === "notes" || tab === "bookmarks") && typeof record.id === "string" && <button type="button" disabled={busy} onClick={() => void deleteRecord(tab === "notes" ? "note" : "bookmark", record.id as string)}>削除</button>}</div></article>) : <div className="renderer-empty-inline">保存済みデータはありません。</div>}</div>
      {historyDetail && <section className="renderer-history-detail"><div className="renderer-page-heading"><h2>セッション詳細</h2><button type="button" onClick={() => setHistoryDetail(null)}>閉じる</button></div><p>{String(historyDetail.summary ?? "要約なし")}</p><div className="renderer-message-list">{Array.isArray(historyDetail.messages) && historyDetail.messages.map((value, index) => { const message = asObject(value); return <div className={`renderer-message is-${message.role === "user" ? "user" : "assistant"}`} key={String(message.id ?? index)}><span>{message.role === "user" ? "あなた" : "LearnStepper"}</span><p>{String(message.content ?? "")}</p></div>; })}</div></section>}
    </section>
  );
}

function SettingsScreen({ profile, signals, preview, client, onUpdated }: { profile: Profile | null; signals: RuntimeSignals; preview: boolean; client: ReturnType<typeof createIPCClient> | null; onUpdated: (profile: Profile) => void }) {
  const capabilities = deriveCapabilities(signals);
  const [displayName, setDisplayName] = useState(profile?.display_name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function updateProfile() {
    if (!client || preview || !profile || !displayName.trim()) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const updated = await client.command<JsonObject>("profile.update", { display_name: displayName.trim(), locale: profile.locale, timezone: profile.timezone }) as unknown as Profile;
      onUpdated(updated); setNotice("プロフィールを更新しました");
    } catch (caught) { setError(caught instanceof IPCError ? caught.userMessage : "プロフィールを更新できませんでした。"); }
    finally { setBusy(false); }
  }
  return (
    <section>
      <div className="renderer-page-heading"><div><p className="renderer-kicker">LOCAL APPLICATION</p><h1>アプリ設定</h1></div></div>
      <div className="renderer-settings-grid">
        <article className="renderer-settings-card"><h2>プロフィール</h2><label>表示名<input value={displayName} disabled={preview} onChange={(event) => setDisplayName(event.target.value)} /></label><dl><div><dt>言語</dt><dd>{profile?.locale ?? "ja-JP"}</dd></div><div><dt>タイムゾーン</dt><dd>{profile?.timezone ?? "Asia/Tokyo"}</dd></div></dl>{error && <p className="renderer-error" role="alert">{error}</p>}{notice && <p className="renderer-success" role="status">{notice}</p>}<button className="renderer-primary" type="button" disabled={preview || busy || !displayName.trim()} onClick={() => void updateProfile()}>プロフィールを更新</button></article>
        <article className="renderer-settings-card"><h2>接続状態</h2><ul><li>ローカルデータ: {capabilities.localRead ? "利用可能" : "利用不可"}</li><li>ネットワーク: {signals.network === "online" ? "オンライン" : "接続なし"}</li><li>ChatGPT: {signals.authentication === "authenticated" ? "ログイン済み" : signals.authentication === "unauthenticated" ? "未ログイン" : "確認中"}</li><li>AI接続: {signals.appServer === "available" ? "利用可能" : signals.appServer === "unavailable" ? "利用不可" : "確認中"}</li><li>表示モード: {preview ? "プレビュー" : "デスクトップアプリ"}</li></ul></article>
      </div>
    </section>
  );
}

function ProjectSettingsScreen({
  project,
  client,
  preview,
  onUpdated,
  onDeleted,
}: {
  project: Project | null;
  client: ReturnType<typeof createIPCClient> | null;
  preview: boolean;
  onUpdated: (project: Project) => void;
  onDeleted: (id: string) => void;
}) {
  const [title, setTitle] = useState(project?.title ?? "");
  const [purpose, setPurpose] = useState(project?.purpose ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const deleteDialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!deleteOpen) return;
    const dialog = deleteDialogRef.current;
    const deleteTrigger = deleteTriggerRef.current;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])") ?? []);
    const focusInput = window.requestAnimationFrame(() => dialog?.querySelector<HTMLInputElement>("input")?.focus());
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setDeleteOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeydown);
    return () => {
      window.cancelAnimationFrame(focusInput);
      document.removeEventListener("keydown", handleKeydown);
      deleteTrigger?.focus();
    };
  }, [deleteOpen]);

  if (!project) return <section className="renderer-empty"><p className="renderer-kicker">PROJECT SETTINGS</p><h1>プロジェクトが選択されていません</h1></section>;

  async function command(name: string, payload: JsonObject, success: string) {
    if (preview || !client) {
      setError("プレビューではプロジェクトを変更できません。");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await client.command<JsonObject>(name, payload);
      onUpdated(result as unknown as Project);
      setNotice(success);
    } catch (caught) {
      setError(caught instanceof IPCError ? caught.userMessage : "プロジェクトを更新できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  async function deleteProject() {
    if (preview || !client || deleteConfirmation !== project?.title) return;
    setBusy(true);
    setError(null);
    try {
      await client.command("project.delete", { id: project.id });
      setDeleteOpen(false);
      onDeleted(project.id);
    } catch (caught) {
      setError(caught instanceof IPCError ? caught.userMessage : "プロジェクトを削除できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  const statusLabel = project.status === "active" ? "進行中" : project.status === "paused" ? "休止中" : project.status === "completed" ? "完了" : "アーカイブ済み";
  return (
    <section>
      <div className="renderer-page-heading"><div><p className="renderer-kicker">PROJECT SETTINGS</p><h1>プロジェクト設定</h1></div><span className="renderer-status">{statusLabel}</span></div>
      {notice && <p className="renderer-success" role="status">{notice}</p>}
      {error && <p className="renderer-error" role="alert">{error}</p>}
      <div className="renderer-settings-grid">
        <form className="renderer-form" onSubmit={(event) => { event.preventDefault(); void command("project.update", { id: project.id, title: title.trim(), purpose: purpose.trim() }, "変更を保存しました"); }}>
          <h2>基本情報</h2>
          <label>プロジェクト名<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <label>学習目的<textarea value={purpose} onChange={(event) => setPurpose(event.target.value)} /></label>
          <dl className="renderer-project-facts"><div><dt>現在レベル</dt><dd>{project.current_level ?? "未設定"}</dd></div><div><dt>目標レベル</dt><dd>{project.target_level ?? "未設定"}</dd></div><div><dt>1回の時間</dt><dd>{project.preferred_session_minutes ?? "-"}分</dd></div></dl>
          <button className="renderer-primary" type="submit" disabled={busy || !title.trim() || !purpose.trim()}>基本情報を保存</button>
        </form>
        <div className="renderer-settings-card renderer-project-actions">
          <h2>状態</h2>
          <p>学習の状態を変更できます。</p>
          {project.status === "active" && <button type="button" disabled={busy} onClick={() => void command("project.update", { id: project.id, status: "paused" }, "休止中")}>学習を休止</button>}
          {project.status === "paused" && <button type="button" disabled={busy} onClick={() => void command("project.update", { id: project.id, status: "active" }, "進行中")}>学習を再開</button>}
          {(project.status === "active" || project.status === "paused") && <button type="button" disabled={busy} onClick={() => void command("project.update", { id: project.id, status: "completed" }, "完了")}>プロジェクトを完了</button>}
          {project.status !== "archived" && <button type="button" disabled={busy} onClick={() => void command("project.archive", { id: project.id }, "アーカイブ済み")}>プロジェクトをアーカイブ</button>}
          {project.status === "archived" && <button type="button" disabled={busy} onClick={() => void command("project.restore", { id: project.id }, "アーカイブから復元しました")}>プロジェクトを復元</button>}
          <h2>削除</h2>
          <p>対象プロジェクトのローカルデータを削除します。この操作は元に戻せません。</p>
          <button className="renderer-danger-button" type="button" ref={deleteTriggerRef} onClick={() => setDeleteOpen(true)}>削除範囲を確認</button>
        </div>
      </div>
      {deleteOpen && (
        <div className="renderer-dialog-backdrop" role="presentation">
          <section className="renderer-dialog" ref={deleteDialogRef} role="dialog" aria-modal="true" aria-labelledby="delete-project-title">
            <p className="renderer-kicker">IRREVERSIBLE</p>
            <h2 id="delete-project-title">プロジェクトを削除</h2>
            <p>対象プロジェクトの計画、進捗、履歴、ノート、ブックマークをこの端末から削除します。通常の画面から復元できません。</p>
            <p><strong>保持:</strong> ChatGPT認証情報は削除しません。ほかのプロジェクトとプロフィールも保持します。</p>
            <label>確認のためプロジェクト名を入力<input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} autoFocus /></label>
            <div className="renderer-dialog-actions"><button type="button" onClick={() => setDeleteOpen(false)}>キャンセル</button><button className="renderer-danger-button" type="button" disabled={busy || deleteConfirmation !== project.title} onClick={() => void deleteProject()}>復元不能な削除を実行</button></div>
          </section>
        </div>
      )}
    </section>
  );
}

export function LearnStepperApp({
  bridge: bridgeProp,
  initialSignals,
}: {
  bridge?: HostBridge | null;
  initialSignals?: Partial<RuntimeSignals>;
}) {
  // An automatic bridge is resolved only after hydration. This prevents the
  // server-rendered shell from falsely declaring an Electron window a preview.
  const [bridge, setBridge] = useState<HostBridge | null | undefined>(bridgeProp);
  const preview = bridge === null;
  const client = useMemo(() => bridge ? createIPCClient(bridge) : null, [bridge]);
  const [signals, setSignals] = useState<RuntimeSignals>({ ...DEFAULT_SIGNALS, ...initialSignals });
  const [boot, setBoot] = useState<BootState>("loading");
  const [screenName, setScreenName] = useState<Screen>("home");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<ProjectWorkspace | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const resolved = bridgeProp === undefined ? installedHostBridge() : bridgeProp;
      setBridge(resolved);
      if (resolved === null) {
        setSignals((current) => ({ ...current, core: "available", database: "available" }));
        setProfile({ id: "preview", display_name: "プレビュー学習者", locale: "ja-JP", timezone: "Asia/Tokyo" });
        setBoot("preview");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [bridgeProp]);

  useEffect(() => {
    if (!bridge?.subscribe) return;
    return bridge.subscribe((event) => {
      if (event.name !== "authentication.changed") return;
      const authentication = event.payload?.authentication;
      if (typeof authentication !== "string") return;
      if (!["authenticated", "unauthenticated", "starting", "awaiting_browser", "verifying", "error"].includes(authentication)) return;
      setSignals((current) => ({ ...current, authentication: authentication as RuntimeSignals["authentication"] }));
      setAuthBusy(false);
      if (authentication === "authenticated") setAuthError(null);
    });
  }, [bridge]);

  useEffect(() => {
    if (!bridge?.getRuntimeStatus) return;
    let cancelled = false;
    void bridge.getRuntimeStatus()
      .then((status) => {
        if (!cancelled) setSignals((current) => ({ ...current, ...status }));
      })
      .catch(() => {
        if (!cancelled) setSignals((current) => ({ ...current, core: "unavailable", database: "unavailable", appServer: "unavailable" }));
      });
    return () => { cancelled = true; };
  }, [bridge]);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    async function load() {
      try {
        let loadedProfile: Profile | null = null;
        try {
          loadedProfile = await client!.query<JsonObject>("profile.get", {}) as unknown as Profile;
        } catch (caught) {
          if (!(caught instanceof IPCError) || caught.code !== "NOT_FOUND") throw caught;
        }
        if (!loadedProfile) {
          if (!cancelled) setBoot("profile");
          return;
        }
        const projectResult = await client!.query("project.list", { include_archived: true });
        const loadedProjects = asItems<Project>(projectResult);
        if (!cancelled) {
          setProfile(loadedProfile);
          setProjects(loadedProjects);
          setSelectedProjectId(loadedProjects[0]?.id ?? null);
          setBoot(loadedProjects.length ? "ready" : "empty");
        }
      } catch {
        if (!cancelled) setBoot("recovery");
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [client]);

  useEffect(() => {
    if (!client || !selectedProjectId) return;
    let cancelled = false;
    void loadProjectWorkspace(client, selectedProjectId)
      .then((loaded) => {
        if (!cancelled) { setWorkspace(loaded); setWorkspaceError(null); }
      })
      .catch((caught) => {
        if (!cancelled) {
          setWorkspace(null);
          setWorkspaceError(caught instanceof IPCError ? caught.userMessage : "プロジェクトの詳細を取得できませんでした。");
        }
      })
    return () => { cancelled = true; };
  }, [client, selectedProjectId]);

  async function saveProfile(data: Omit<Profile, "id">) {
    if (!client) return;
    setProfileBusy(true);
    setProfileError(null);
    try {
      const saved = await client.command<JsonObject>("profile.update", data);
      setProfile(saved as unknown as Profile);
      setBoot("empty");
    } catch (caught) {
      setProfileError(caught instanceof IPCError ? caught.userMessage : "プロフィールを保存できませんでした。");
    } finally {
      setProfileBusy(false);
    }
  }

  async function startLogin() {
    if (!bridge?.startChatGPTLogin) {
      setAuthError("このアプリではログインを開始できません。最新版を再インストールしてください。");
      return;
    }
    setAuthBusy(true);
    setAuthError(null);
    setSignals((current) => ({ ...current, authentication: "starting" }));
    try {
      const result = await bridge.startChatGPTLogin();
      setSignals((current) => ({ ...current, authentication: result.state }));
    } catch {
      setSignals((current) => ({ ...current, authentication: "error" }));
      setAuthError("ログインを開始できませんでした。ネットワーク接続を確認して再試行してください。");
    } finally {
      setAuthBusy(false);
    }
  }

  async function cancelLogin() {
    if (!bridge?.cancelChatGPTLogin) return;
    setAuthBusy(true);
    try {
      const result = await bridge.cancelChatGPTLogin();
      setSignals((current) => ({ ...current, authentication: result.state }));
    } catch {
      setAuthError("ログイン処理を終了できませんでした。アプリを再起動してください。");
    } finally {
      setAuthBusy(false);
    }
  }

  if (boot === "loading") return <main className="renderer-loading"><Brand /><p role="status">ローカルデータを確認しています</p></main>;
  if (boot === "profile") return <ProfileSetup onSave={(data) => void saveProfile(data)} busy={profileBusy} error={profileError} />;
  if (boot === "recovery") return <Recovery />;

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  const workspaceLoading = Boolean(selectedProjectId && workspace?.project.id !== selectedProjectId && !workspaceError);
  function updateProject(updated: Project) {
    setProjects((current) => current.map((project) => project.id === updated.id ? updated : project));
  }

  function deleteProject(id: string) {
    setProjects((current) => current.filter((project) => project.id !== id));
    setSelectedProjectId(null);
    setWorkspace(null);
    setScreenName("home");
  }
  return (
    <div className="renderer-app">
      <aside className="renderer-sidebar">
        <Brand />
        <nav aria-label="メインナビゲーション">
          {NAV.map((item) => <button key={item.id} type="button" aria-label={item.label} aria-current={screenName === item.id ? "page" : undefined} onClick={() => setScreenName(item.id)}><span aria-hidden="true">{item.mark}</span>{item.label}</button>)}
        </nav>
        <div className="renderer-sidebar-context"><span>選択中</span><strong>{selectedProject?.title ?? "プロジェクト未選択"}</strong><small>{selectedProject ? PROJECT_STATUS_LABELS[selectedProject.status] : "ホームから選択"}</small></div>
        <div className="renderer-sidebar-profile"><span>{(profile?.display_name ?? "P").slice(0, 1)}</span><div><strong>{profile?.display_name ?? "プレビュー"}</strong><small>ローカルプロフィール</small></div></div>
      </aside>
      <div className="renderer-workspace">
        <CapabilityBanner signals={signals} preview={preview} authBusy={authBusy} authError={authError} onLogin={() => void startLogin()} onCancel={() => void cancelLogin()} />
        <header className="renderer-topbar"><div><span>LearnStepper / {selectedProject?.title ?? "ホーム"}</span></div><div className="renderer-topbar-status"><i className={deriveCapabilities(signals).localRead ? "is-ok" : "is-error"} />{deriveCapabilities(signals).localRead ? "ローカルデータ利用可能" : "ローカル機能を利用できません"}</div></header>
        <main className="renderer-content">
          {workspaceError && <p className="renderer-error" role="alert">{workspaceError}</p>}
          {screenName === "home" && <Dashboard projects={projects} preview={preview} onCreate={() => setScreenName("setup")} onSelect={(id) => { setSelectedProjectId(id); setScreenName("learning"); }} onManage={(id) => { setSelectedProjectId(id); setScreenName("projectSettings"); }} />}
          {screenName === "setup" && <SetupScreen preview={preview} client={client} onCreated={(project) => { setProjects((current) => [project, ...current]); setSelectedProjectId(project.id); setScreenName("learning"); }} />}
          {screenName === "learning" && <LearningScreen key={selectedProject?.id ?? "none"} selectedProject={selectedProject} workspace={workspace} loading={workspaceLoading} client={client} bridge={bridge ?? null} capabilities={deriveCapabilities(signals)} onNavigate={setScreenName} />}
          {(["objectives", "plan"] as Screen[]).includes(screenName) && <ProjectFeatureScreen screen={screenName} project={selectedProject} workspace={workspace} client={client} onNavigate={setScreenName} />}
          {screenName === "progress" && <ProgressScreen selectedProject={selectedProject} workspace={workspace} loading={workspaceLoading} />}
          {screenName === "library" && <LibraryScreen key={selectedProject?.id ?? "none"} selectedProject={selectedProject} workspace={workspace} loading={workspaceLoading} client={client} />}
          {screenName === "settings" && <SettingsScreen key={profile?.id ?? "preview"} profile={profile} signals={signals} preview={preview} client={client} onUpdated={setProfile} />}
          {screenName === "projectSettings" && <ProjectSettingsScreen key={selectedProject?.id ?? "none"} project={selectedProject} client={client} preview={preview} onUpdated={updateProject} onDeleted={deleteProject} />}
        </main>
      </div>
    </div>
  );
}
