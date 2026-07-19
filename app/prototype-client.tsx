"use client";

import { useEffect, useMemo, useState } from "react";

type Screen =
  | "dashboard"
  | "setup"
  | "lesson"
  | "exercise"
  | "remediation"
  | "progress"
  | "library"
  | "settings";

type SetupStep = "profile" | "grounding" | "diagnosis" | "plan";
type GenerationState =
  | "idle"
  | "sending"
  | "streaming"
  | "completed"
  | "interrupting"
  | "stopped"
  | "failed";

type SetupDraft = {
  started: boolean;
  step: SetupStep;
  mode: "curriculum" | "free";
  jurisdiction: string;
  grade: string;
  subject: string;
  sessionMinutes: string;
  topic: string;
  purpose: string;
  diagnosisIndex: number;
  diagnosisAnswers: Array<string | null>;
};

type ExerciseResult = {
  completed: boolean;
  correct: number;
  total: number;
};

type Source = {
  code: string;
  title: string;
  detail: string;
  status: string;
  version: string;
  citation: string;
  excerpt: string;
};

const JURISDICTION_PROFILES: Record<string, { label: string; authority: string; framework: string; code: string; grades: Array<{ value: string; label: string }>; edition: string; subject: string }> = {
  japan: { label: "日本", authority: "文部科学省", framework: "中学校学習指導要領 · 数学 · 数と式", code: "MEXT", grades: [{ value: "jhs1", label: "中学校・1年" }, { value: "jhs2", label: "中学校・2年" }], edition: "令和3年全面実施版", subject: "数学" },
  dc: { label: "コロンビア特別区", authority: "OSSE", framework: "DC Learning Standards · Mathematics · Expressions and Equations", code: "OSSE", grades: [{ value: "grade7", label: "Grade 7" }, { value: "grade8", label: "Grade 8" }], edition: "DC Mathematics Standards 現行版", subject: "Mathematics" },
  ny: { label: "ニューヨーク州", authority: "NYSED", framework: "New York State Next Generation Mathematics Learning Standards", code: "NYSED", grades: [{ value: "grade7", label: "Grade 7" }, { value: "grade8", label: "Grade 8" }], edition: "Next Generation Standards 現行版", subject: "Mathematics" },
  ca: { label: "カリフォルニア州", authority: "California Department of Education", framework: "California Common Core State Standards · Mathematics", code: "CDE", grades: [{ value: "grade7", label: "Grade 7" }, { value: "grade8", label: "Grade 8" }], edition: "CA CCSS Mathematics 現行版", subject: "Mathematics" },
  berlin: { label: "ベルリン州", authority: "SenBJF Berlin", framework: "Rahmenlehrplan Berlin-Brandenburg · Mathematik", code: "BERLIN", grades: [{ value: "jahr7", label: "Jahrgangsstufe 7" }, { value: "jahr8", label: "Jahrgangsstufe 8" }], edition: "Rahmenlehrplan 1–10 現行版", subject: "Mathematik" },
  hamburg: { label: "ハンブルク州", authority: "Hamburg BSB", framework: "Bildungsplan Gymnasium · Mathematik", code: "HH", grades: [{ value: "jahr7", label: "Jahrgangsstufe 7" }, { value: "jahr8", label: "Jahrgangsstufe 8" }], edition: "Bildungsplan Gymnasium 現行版", subject: "Mathematik" },
  bavaria: { label: "バイエルン州", authority: "ISB Bayern", framework: "LehrplanPLUS · Mathematik", code: "BY", grades: [{ value: "jahr7", label: "Jahrgangsstufe 7" }, { value: "jahr8", label: "Jahrgangsstufe 8" }], edition: "LehrplanPLUS 現行版", subject: "Mathematik" },
};

const INITIAL_SETUP_DRAFT: SetupDraft = {
  started: false,
  step: "profile",
  mode: "curriculum",
  jurisdiction: "japan",
  grade: "jhs1",
  subject: "math",
  sessionMinutes: "25",
  topic: "統計の基礎",
  purpose: "データを読み解き、仕事で説明できるようになりたい",
  diagnosisIndex: 0,
  diagnosisAnswers: [null, null, null],
};

const INITIAL_EXERCISE_RESULT: ExerciseResult = { completed: false, correct: 0, total: 3 };

const NAV_ITEMS: Array<{ screen: Screen; label: string; mark: string }> = [
  { screen: "dashboard", label: "ホーム", mark: "H" },
  { screen: "lesson", label: "学習", mark: "L" },
  { screen: "progress", label: "進捗", mark: "P" },
  { screen: "library", label: "ライブラリ", mark: "B" },
  { screen: "settings", label: "設定", mark: "S" },
];

const SCREEN_TITLES: Record<Screen, string> = {
  dashboard: "ホーム",
  setup: "新しい学習をつくる",
  lesson: "一次方程式の考え方",
  exercise: "理解を確かめる",
  remediation: "前提を整える",
  progress: "学びの現在地",
  library: "ライブラリ",
  settings: "設定",
};

const MODULES = [
  {
    label: "01",
    title: "正負の数",
    lessons: ["数直線と絶対値", "四則計算", "文字式への準備"],
    status: "done",
  },
  {
    label: "02",
    title: "文字と式",
    lessons: ["文字式の表し方", "同類項をまとめる", "式の値"],
    status: "done",
  },
  {
    label: "03",
    title: "一次方程式",
    lessons: ["等式の性質", "一次方程式の考え方", "文章題への応用"],
    status: "active",
  },
  {
    label: "04",
    title: "比例と反比例",
    lessons: ["比例の式", "グラフ", "反比例"],
    status: "locked",
  },
];

function sourcesForDraft(draft: SetupDraft): Source[] {
  if (draft.mode === "free") {
    return [
      { code: "PRIMARY", title: `${draft.topic}の一次資料候補`, detail: "計画生成時に発行主体と版を検証", status: "候補・要検証", version: "未確定", citation: "テーマに対応する一次資料を収集中", excerpt: "検証済み資料だけを学習根拠として採用します。" },
      { code: "REFERENCE", title: `${draft.topic}の基礎リファレンス候補`, detail: "公的機関・大学・標準化団体を優先", status: "候補・要検証", version: "未確定", citation: "学習目的に対応する基礎項目", excerpt: draft.purpose },
    ];
  }
  const profile = JURISDICTION_PROFILES[draft.jurisdiction] ?? JURISDICTION_PROFILES.japan;
  return [
    { code: `${profile.code} STD`, title: profile.framework, detail: `${profile.authority}・公式教育課程`, status: "取得済み・検証済み", version: "MVP保存版", citation: "Expressions and equations / 数と式の対応項目", excerpt: "一次方程式を根拠と理由を示しながら解き、具体的な場面へ適用します。" },
    { code: `${profile.code} GUIDE`, title: `${profile.label} 数学指導ガイド`, detail: `${profile.authority}・実施ガイダンス`, status: "取得済み・検証済み", version: "MVP保存版", citation: "指導順序と評価観点", excerpt: "等式の性質を基に、解法を考察し表現する学習活動を扱います。" },
  ];
}

function SourceDialog({ source, onClose }: { source: Source | null; onClose: () => void }) {

  useEffect(() => {
    if (!source) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, source]);

  if (!source) return null;
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="source-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">根拠資料の詳細</p>
            <h2 id="source-dialog-title">{source.title}</h2>
          </div>
          <button className="dialog-close" type="button" onClick={onClose} aria-label="閉じる">×</button>
        </div>
        <dl className="source-metadata">
          <div><dt>発行主体</dt><dd>{source.detail.split("・")[0]}</dd></div>
          <div><dt>版・公開日</dt><dd>{source.version}</dd></div>
          <div><dt>取得時点</dt><dd>2026年7月16日 09:42 JST</dd></div>
          <div><dt>検証状態</dt><dd><strong>{source.status}</strong></dd></div>
        </dl>
        <div className="citation-range">
          <span>対応箇所</span>
          <p>{source.citation}</p>
          <blockquote>{source.excerpt}</blockquote>
        </div>
        <p className="dialog-note">このプロトタイプでは外部URLを開かず、保存済みメタデータのみ表示します。</p>
      </section>
    </div>
  );
}

function Wordmark() {
  return (
    <div className="wordmark" aria-label="LearnStepper">
      <span className="wordmark-symbol" aria-hidden="true">
        L
      </span>
      <span>
        Learn<span>Stepper</span>
      </span>
    </div>
  );
}

function AppShell({
  screen,
  learningDraft,
  offline,
  onOfflineChange,
  onNavigate,
  children,
}: {
  screen: Screen;
  learningDraft: SetupDraft;
  offline: boolean;
  onOfflineChange: () => void;
  onNavigate: (screen: Screen) => void;
  children: React.ReactNode;
}) {
  const activeNav =
    screen === "setup" || screen === "dashboard"
      ? "dashboard"
      : screen === "exercise" || screen === "remediation"
        ? "lesson"
        : screen;
  const profile = JURISDICTION_PROFILES[learningDraft.jurisdiction] ?? JURISDICTION_PROFILES.japan;
  const courseLabel = learningDraft.mode === "free" ? learningDraft.topic : `${profile.label} · 数学`;
  const lessonTitle = learningDraft.mode === "free" ? `${learningDraft.topic}の全体像` : SCREEN_TITLES.lesson;

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <Wordmark />
        <nav className="primary-nav" aria-label="メインナビゲーション">
          {NAV_ITEMS.map((item) => {
            const active = activeNav === item.screen;
            return (
              <button
                className={active ? "nav-item nav-item-active" : "nav-item"}
                type="button"
                key={item.screen}
                onClick={() => onNavigate(item.screen)}
                aria-current={active ? "page" : undefined}
              >
                <span className="nav-mark" aria-hidden="true">
                  {item.mark}
                </span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-course">
          <p className="eyebrow">学習中</p>
          <button type="button" onClick={() => onNavigate("lesson")}>
            <span className="course-dot" aria-hidden="true" />
            <span>
              <strong>{courseLabel}</strong>
              <small>{learningDraft.mode === "free" ? "基本概念 · 42%" : "一次方程式 · 42%"}</small>
            </span>
          </button>
        </div>

        <div className="sidebar-profile">
          <span className="avatar" aria-hidden="true">
            DM
          </span>
          <span>
            <strong>学習者デモ</strong>
            <small>今日 18分 学習</small>
          </span>
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <div>
            <p className="topbar-context">{courseLabel} / 学習プロトタイプ</p>
            <h1 aria-live="polite">{screen === "lesson" ? lessonTitle : SCREEN_TITLES[screen]}</h1>
          </div>
          <div className="topbar-actions">
            <button
              className={offline ? "connection-button is-offline" : "connection-button"}
              type="button"
              onClick={onOfflineChange}
              aria-pressed={offline}
            >
              <span className="connection-dot" aria-hidden="true" />
              {offline ? "オフライン" : "オンライン"}
            </button>
            <button className="icon-button" type="button" aria-label="通知はありません" disabled>
              <span aria-hidden="true">•</span>
            </button>
          </div>
        </header>
        {offline ? (
          <div className="offline-banner" role="status">
            <strong>オフラインです。</strong>
            保存済みの内容は閲覧できます。質問や新しい資料の取得は接続回復後に利用できます。
          </div>
        ) : null}
        <main className="screen-stage">{children}</main>
      </div>
    </div>
  );
}

function Dashboard({
  draft,
  onResume,
  onCreate,
  onResumeDraft,
  onProgress,
  hasDraft,
  offline,
}: {
  draft: SetupDraft;
  onResume: () => void;
  onCreate: () => void;
  onResumeDraft: () => void;
  onProgress: () => void;
  hasDraft: boolean;
  offline: boolean;
}) {
  const isFree = draft.mode === "free";
  const profile = JURISDICTION_PROFILES[draft.jurisdiction] ?? JURISDICTION_PROFILES.japan;
  return (
    <section className="dashboard-screen" data-screen="dashboard">
      <div className="welcome-row">
        <div>
          <p className="eyebrow">2026年7月18日・土曜日</p>
          <h2>おかえりなさい。続きを一歩、進めましょう。</h2>
          <p>
            {isFree ? `前回は「${draft.topic}」の目的を確認しました。今日は基本概念を具体例へ結び付けます。` : "前回は「移項」の仕組みまで確認しました。今日は実際に方程式を解いて、考え方を定着させます。"}
          </p>
        </div>
        <button className="button button-secondary" type="button" onClick={onCreate} disabled={offline}>
          新しい学習をつくる
        </button>
      </div>

      <div className="dashboard-grid">
        <article className="resume-card">
          <div className="resume-card-topline">
            <span className="subject-chip">{isFree ? "任意テーマ" : profile.subject}</span>
            <span className="quiet-label">前回から2日</span>
          </div>
          <p className="eyebrow">次のレッスン</p>
          <h3>{isFree ? `${draft.topic}の全体像` : "一次方程式の考え方"}</h3>
          <p>
            {isFree ? draft.purpose : "等式の両辺に同じ操作をすると、等しい関係が保たれることを使って未知数を求めます。"}
          </p>

          <div className="goal-strip">
            <span className="goal-type goal-can">できる</span>
            <span>{isFree ? `${draft.topic}を説明し、具体例へ適用できる` : "一次方程式を、途中式と理由を示しながら解ける"}</span>
          </div>

          <div className="progress-line" aria-label="テーマの進捗 42パーセント">
            <span style={{ width: "42%" }} />
          </div>
          <div className="progress-meta">
            <span>全体の42%</span>
            <span>残り約4時間20分</span>
          </div>

          <button className="button button-primary resume-button" type="button" onClick={onResume}>
            学習を再開
            <span aria-hidden="true">→</span>
          </button>
        </article>

        <aside className="today-panel">
          <p className="eyebrow">今日のプラン</p>
          <div className="today-time">
            <strong>25</strong>
            <span>分</span>
          </div>
          <ol className="today-steps">
            <li className="is-current">
              <span>1</span>
              <p>
                <strong>前回の振り返り</strong>
                <small>3分</small>
              </p>
            </li>
            <li>
              <span>2</span>
              <p>
                <strong>{isFree ? `${draft.topic}の基本概念` : "一次方程式の考え方"}</strong>
                <small>12分</small>
              </p>
            </li>
            <li>
              <span>3</span>
              <p>
                <strong>理解チェック</strong>
                <small>10分</small>
              </p>
            </li>
          </ol>
        </aside>
      </div>

      {hasDraft ? (
        <button className="draft-resume" type="button" onClick={onResumeDraft}>
          <span>
            <strong>作成途中の学習プランがあります</strong>
            <small>入力内容はこの端末に保持されています</small>
          </span>
          <span>設定を再開 →</span>
        </button>
      ) : null}

      <div className="dashboard-lower-grid">
        <section className="plain-section">
          <div className="section-heading-row">
            <div>
              <p className="eyebrow">最近の学び</p>
              <h3>積み重ねが見えています</h3>
            </div>
            <button className="text-button" type="button" onClick={onProgress}>
              進捗を見る →
            </button>
          </div>
          <div className="stat-row">
            <div>
              <strong>7</strong>
              <span>完了レッスン</span>
            </div>
            <div>
              <strong>84%</strong>
              <span>直近の正答率</span>
            </div>
            <div>
              <strong>4日</strong>
              <span>連続学習</span>
            </div>
          </div>
        </section>

        <section className="plain-section insight-section">
          <p className="eyebrow">AIからのメモ</p>
          <blockquote>
            負の数を含む計算は安定しています。次は「なぜその操作でよいか」を言葉で説明できると、文章題でも迷いにくくなります。
          </blockquote>
          <span>評価証拠: 直近3回の演習</span>
        </section>
      </div>
    </section>
  );
}

function SetupFlow({
  draft,
  onDraftChange,
  onCancel,
  onComplete,
  offline,
}: {
  draft: SetupDraft;
  onDraftChange: (draft: SetupDraft) => void;
  onCancel: () => void;
  onComplete: () => void;
  offline: boolean;
}) {
  const steps: SetupStep[] = ["profile", "grounding", "diagnosis", "plan"];
  const currentIndex = steps.indexOf(draft.step);
  const diagnosisQuestions = draft.mode === "free"
    ? [
        { prompt: `${draft.topic}について、現在の理解に最も近いものはどれですか。`, options: ["初めて学ぶ", "用語は知っている", "基礎を説明できる", "応用経験がある"] },
        { prompt: "どの学び方がいちばん取り組みやすいですか。", options: ["具体例から", "図や構造から", "短い説明から", "演習から"] },
        { prompt: "現在、確保しやすい学習頻度はどれですか。", options: ["毎日", "週3回", "週1回", "不定期"] },
      ]
    : [
        { prompt: "3x + 5 = 20 のとき、xはいくつですか。", options: ["3", "5", "8", "15"] },
        { prompt: "2x = 14 のとき、xはいくつですか。", options: ["5", "6", "7", "12"] },
        { prompt: "x − 4 = 9 のとき、最初に両辺へ何をしますか。", options: ["4を足す", "4を引く", "9を足す", "9で割る"] },
      ];
  const diagnosisQuestion = diagnosisQuestions[draft.diagnosisIndex];
  const diagnosisChoice = draft.diagnosisAnswers[draft.diagnosisIndex];
  const sources = sourcesForDraft(draft);
  const selectedProfile = JURISDICTION_PROFILES[draft.jurisdiction] ?? JURISDICTION_PROFILES.japan;

  function update(patch: Partial<SetupDraft>) {
    onDraftChange({ ...draft, ...patch, started: true });
  }

  function next() {
    if (draft.step === "diagnosis" && draft.diagnosisIndex < diagnosisQuestions.length - 1) {
      update({ diagnosisIndex: draft.diagnosisIndex + 1 });
      return;
    }
    const nextStep = steps[currentIndex + 1];
    if (nextStep) update({ step: nextStep });
    else onComplete();
  }

  function back() {
    const previous = steps[currentIndex - 1];
    if (previous) update({ step: previous });
    else onCancel();
  }

  return (
    <section className="setup-screen" data-screen="setup">
      <div className="setup-progress" aria-label={`設定ステップ ${currentIndex + 1}/4`}>
        {steps.map((item, index) => (
          <span key={item} className={index <= currentIndex ? "is-active" : ""} />
        ))}
      </div>
      <p className="step-count">STEP {currentIndex + 1} / 4</p>

      {draft.step === "profile" ? (
        <div className="setup-content">
          <p className="eyebrow">S04 学習設定</p>
          <h2>何を、どこまで学びますか。</h2>
          <p>あとから変更できます。まずは今の目的にいちばん近い内容を設定します。</p>
          <div className="mode-choice">
            <label className={draft.mode === "curriculum" ? "choice-card is-selected" : "choice-card"}>
              <input
                checked={draft.mode === "curriculum"}
                type="radio"
                name="mode"
                onChange={() => update({ mode: "curriculum" })}
              />
              <span>
                <strong>教育課程に沿って学ぶ</strong>
                <small>学習指導要領と前提関係に沿って進みます</small>
              </span>
            </label>
            <label className={draft.mode === "free" ? "choice-card is-selected" : "choice-card"}>
              <input
                checked={draft.mode === "free"}
                type="radio"
                name="mode"
                onChange={() => update({ mode: "free" })}
              />
              <span>
                <strong>自由なテーマを学ぶ</strong>
                <small>興味や仕事に合わせて計画をつくります</small>
              </span>
            </label>
          </div>
          {draft.mode === "curriculum" ? (
          <div className="form-grid">
            <label>
              教育管轄
              <select value={draft.jurisdiction} onChange={(event) => {
                const jurisdiction = event.target.value;
                update({ jurisdiction, grade: JURISDICTION_PROFILES[jurisdiction].grades[0].value });
              }}>
                <option value="japan">日本・文部科学省</option>
                <option value="dc">コロンビア特別区・OSSE</option>
                <option value="ny">ニューヨーク州・NYSED</option>
                <option value="ca">カリフォルニア州・CDE</option>
                <option value="berlin">ベルリン州</option>
                <option value="hamburg">ハンブルク州</option>
                <option value="bavaria">バイエルン州</option>
              </select>
            </label>
            <label>
              教育段階・学年
              <select value={draft.grade} onChange={(event) => update({ grade: event.target.value })}>
                {selectedProfile.grades.map((grade) => <option value={grade.value} key={grade.value}>{grade.label}</option>)}
              </select>
            </label>
            <label>
              教科
              <select value={draft.subject} onChange={(event) => update({ subject: event.target.value })}>
                <option value="math">{selectedProfile.subject}</option>
              </select>
            </label>
            <label>
              教育課程版
              <select value={selectedProfile.edition} onChange={() => undefined} aria-readonly="true">
                <option value={selectedProfile.edition}>{selectedProfile.edition}</option>
              </select>
            </label>
            <label>
              1回の学習時間
              <select value={draft.sessionMinutes} onChange={(event) => update({ sessionMinutes: event.target.value })}>
                <option value="15">15分</option>
                <option value="25">25分</option>
                <option value="40">40分</option>
              </select>
            </label>
          </div>
          ) : (
            <div className="free-topic-form">
              <label>
                学びたいテーマ
                <input value={draft.topic} onChange={(event) => update({ topic: event.target.value })} placeholder="例: Python、世界史、英会話" />
              </label>
              <label>
                学習目的
                <textarea value={draft.purpose} onChange={(event) => update({ purpose: event.target.value })} rows={3} />
              </label>
            </div>
          )}
        </div>
      ) : null}

      {draft.step === "grounding" ? (
        <div className="setup-content">
          <p className="eyebrow">S05 目標・根拠確認</p>
          <h2>この目標と根拠で計画をつくります。</h2>
          <div className="review-goal-card">
            <span className="goal-type goal-can">できる</span>
            <h3>{draft.mode === "free" ? `${draft.topic}を、${draft.purpose}` : "一次方程式を使って、身近な数量関係の問題を解ける"}</h3>
            <dl>
              <div>
                <dt>成功基準</dt>
                <dd>{draft.mode === "free" ? "学んだ内容を自分の言葉で説明し、具体例へ適用できる" : "異なる形式の問題3問中2問以上で、式と理由を示せる"}</dd>
              </div>
              <div>
                <dt>評価方法</dt>
                <dd>記述式演習と単元確認テスト</dd>
              </div>
            </dl>
          </div>
          {draft.mode === "curriculum" ? <div className="source-stack">
            {sources.map((source) => (
              <div className="source-row" key={source.code}>
                <span className="source-code">{source.code}</span>
                <span>
                  <strong>{source.title}</strong>
                  <small>{source.detail}</small>
                </span>
                <em>{source.status}</em>
              </div>
            ))}
          </div> : <p className="dialog-note">自由テーマでは、計画生成時に公的資料と一次資料を優先して根拠候補を収集します。</p>}
        </div>
      ) : null}

      {draft.step === "diagnosis" ? (
        <div className="setup-content diagnosis-content">
          <p className="eyebrow">S06 初期診断</p>
          <h2>今の理解を、3問だけ確認します。</h2>
          <p>点数をつけるためではなく、ちょうどよい開始位置を見つけるための診断です。</p>
          <div className="question-preview">
            <span>問題 {draft.diagnosisIndex + 1} / 3</span>
            <strong>{diagnosisQuestion.prompt}</strong>
            <div className="mini-options">
              {diagnosisQuestion.options.map((option) => (
                <button
                  className={diagnosisChoice === option ? "is-selected" : ""}
                  type="button"
                  key={option}
                  onClick={() => update({ diagnosisAnswers: draft.diagnosisAnswers.map((answer, index) => index === draft.diagnosisIndex ? option : answer) })}
                  aria-pressed={diagnosisChoice === option}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
          <button className="text-button diagnosis-skip" type="button" onClick={() => update({ step: "plan" })}>
            診断をスキップして計画へ
          </button>
        </div>
      ) : null}

      {draft.step === "plan" ? (
        <div className="setup-content">
          <p className="eyebrow">S07 学習計画レビュー</p>
          <h2>6週間の学習計画ができました。</h2>
          <p>{draft.mode === "free" ? `${draft.topic}を段階的に説明・適用できる構成です。` : "診断結果をもとに、文字式の復習を短く追加しています。"}</p>
          <div className="plan-preview">
            {MODULES.map((module, index) => (
              <div key={module.label}>
                <span>{index + 1}</span>
                <p>
                  <strong>{draft.mode === "free" ? [`${draft.topic}の全体像`, "基本用語と考え方", "具体例での練習", "説明と応用"][index] : module.title}</strong>
                  <small>{module.lessons.length}レッスン · 約{45 + index * 10}分</small>
                </p>
                <em>{index < 2 ? "準備" : "本編"}</em>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <footer className="setup-actions">
        <button className="button button-ghost" type="button" onClick={back}>
          戻る
        </button>
        <button className="button button-primary" type="button" onClick={next} disabled={(offline && draft.step !== "profile") || (draft.step === "diagnosis" && !diagnosisChoice)}>
          {draft.step === "plan" ? "計画を承認して始める" : draft.step === "diagnosis" && draft.diagnosisIndex < 2 ? "次の問題へ" : "次へ進む"}
          <span aria-hidden="true">→</span>
        </button>
      </footer>
      {offline && draft.step !== "profile" ? <p className="setup-offline-note" role="status">接続回復後に診断・計画生成を続けられます。入力内容は保持されています。</p> : null}
    </section>
  );
}

function LessonPlan({ remediationMode, draft }: { remediationMode: boolean; draft: SetupDraft }) {
  const freeModules = [`${draft.topic}の全体像`, "基本用語と考え方", "具体例での練習", "説明と応用"];
  return (
    <aside className="lesson-plan-panel" aria-label="学習計画">
      <div className="panel-heading">
        <p className="eyebrow">現在地</p>
        <span>42%</span>
      </div>
      <div className="compact-progress" aria-hidden="true">
        <span style={{ width: "42%" }} />
      </div>
      {remediationMode ? (
        <div className="remediation-route-mini">
          <span>補習中</span>
          <strong>等式の性質を確認</strong>
          <small>復帰先: 一次方程式の考え方</small>
        </div>
      ) : null}
      <div className="module-list">
        {MODULES.map((module) => (
          <div className={`module-item module-${module.status}`} key={module.label}>
            <div className="module-line">
              <span>{module.status === "done" ? "✓" : module.label}</span>
              <p>
                <small>MODULE {module.label}</small>
                <strong>{draft.mode === "free" ? freeModules[Number(module.label) - 1] : module.title}</strong>
              </p>
            </div>
            {module.status === "active" ? (
              <ol>
                {module.lessons.map((lesson, index) => (
                  <li className={index === 1 ? "is-current" : ""} key={lesson}>
                    <span>{index === 0 ? "✓" : index + 1}</span>
                    {draft.mode === "free" ? [`導入と目的`, `基本概念`, `説明して確かめる`][index] : lesson}
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        ))}
      </div>
    </aside>
  );
}

function TutorConversation({
  draft: learningDraft,
  sources,
  offline,
  generation,
  onGeneration,
  onExercise,
  onRemediation,
  onOpenSource,
}: {
  draft: SetupDraft;
  sources: Source[];
  offline: boolean;
  generation: GenerationState;
  onGeneration: (state: GenerationState) => void;
  onExercise: () => void;
  onRemediation: () => void;
  onOpenSource: (source: Source) => void;
}) {
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<Array<{ question: string; answer: string | null }>>([]);
  const isFree = learningDraft.mode === "free";

  useEffect(() => {
    if (generation !== "sending") return;
    const timer = window.setTimeout(() => onGeneration("streaming"), 450);
    return () => window.clearTimeout(timer);
  }, [generation, onGeneration]);

  useEffect(() => {
    if (generation !== "streaming") return;
    const timer = window.setTimeout(() => {
      setTurns((items) => items.map((item, index) => index === items.length - 1 && item.answer === null
        ? { ...item, answer: isFree
          ? `${learningDraft.topic}では、まず全体像と基本用語を結び付けます。その後、${learningDraft.purpose}という目的に近い具体例で確かめると理解を定着させやすくなります。`
          : "等式は左右が同じ値である関係です。片方だけを変えると等しくなくなるため、左右へ同じ操作を行います。天びんの両側から同じ重さを取り除いても、つり合いが保たれるのと同じです。" }
        : item));
      onGeneration("completed");
    }, 900);
    return () => window.clearTimeout(timer);
  }, [generation, isFree, learningDraft.purpose, learningDraft.topic, onGeneration]);

  useEffect(() => {
    if (offline && (generation === "sending" || generation === "streaming")) {
      onGeneration("failed");
    }
  }, [generation, offline, onGeneration]);

  function send() {
    if (!offline && draft.trim()) {
      setTurns((items) => [...items, { question: draft.trim(), answer: null }]);
      onGeneration("sending");
      setDraft("");
    }
  }

  function stop() {
    onGeneration("interrupting");
    window.setTimeout(() => onGeneration("stopped"), 260);
  }

  return (
    <section className="conversation-panel" aria-label="AIチューターとの対話">
      <div className="session-summary">
        <p className="eyebrow">前回の振り返り</p>
        <p>
          {isFree ? `${learningDraft.topic}を学ぶ目的と、最初に押さえる用語を確認しました。` : "等式は「左右がつり合った天びん」と同じで、両辺へ同じ操作をすれば関係が保たれることを確認しました。"}
        </p>
      </div>

      <div className="conversation-date"><span>今日</span></div>

      <article className="message message-tutor">
        <div className="tutor-mark" aria-hidden="true">L</div>
        <div>
          <p className="message-author">LearnStepper</p>
          <div className="message-body">
            <p>{isFree ? `今日は、${learningDraft.topic}の全体像と学習の道筋を整理します。` : "今日は、一次方程式を実際に解く流れを整理します。"}</p>
            {isFree ? <p>目標は「{learningDraft.purpose}」です。まず基本用語を具体例と結び付け、その後に自分の言葉で説明します。</p> : <p>
              例として <strong>3x + 5 = 20</strong> を考えます。まず、xが含まれる項だけを左辺に残すため、両辺から5を引きます。
            </p>}
            {!isFree ? <div className="equation-block">
              <span>3x + 5</span><span>=</span><span>20</span>
              <small>− 5</small><small></small><small>− 5</small>
              <strong>3x</strong><strong>=</strong><strong>15</strong>
            </div> : null}
            {!isFree ? <p>
              次に両辺を3で割ると、<strong>x = 5</strong> になります。大切なのは、移項という操作を暗記するのではなく、両辺へ同じ操作をしていると捉えることです。
            </p> : null}
          </div>
          <div className="message-sources">
            <span>根拠 2件</span>
            {sources.map((source) => <button type="button" key={source.code} onClick={() => onOpenSource(source)}>{source.code}</button>)}
          </div>
        </div>
      </article>

      <article className="message message-user">
        <div>
          <p className="message-author">あなた</p>
          <div className="message-body">
            <p>{isFree ? `${learningDraft.topic}は、どんな場面で役立ちますか。` : "移項すると符号が変わる、と覚えるだけではだめですか。"}</p>
          </div>
        </div>
      </article>

      <article className="message message-tutor">
        <div className="tutor-mark" aria-hidden="true">L</div>
        <div>
          <p className="message-author">LearnStepper</p>
          <div className="message-body">
            <p>
              {isFree ? `${learningDraft.topic}を目的へ結び付けるには、用語を覚えるだけでなく、具体例を説明できることが重要です。` : "計算を速くするためのルールとして覚えるのは問題ありません。ただ、「なぜ符号が変わるか」を説明できると、複雑な式でも操作を間違えにくくなります。"}
            </p>
            <p>{isFree ? "最初の概念から順に進めます。" : "今の説明を、短い問題で確かめてみましょう。"}</p>
          </div>
          <div className="message-actions">
            <button className="button button-primary" type="button" onClick={onExercise}>
              {isFree ? "理解を確かめる" : "演習を始める"}
            </button>
            {!isFree ? <button className="button button-ghost" type="button" onClick={onRemediation}>
              前提を確認する
            </button> : null}
          </div>
        </div>
      </article>

      {turns.map((turn, index) => (
        <div key={`${turn.question}-${index}`}>
          <article className="message message-user submitted-question" aria-live="polite">
            <div><p className="message-author">あなた · 送信済み</p><div className="message-body"><p>{turn.question}</p></div></div>
          </article>
          {turn.answer ? (
            <article className="message message-tutor generation-message">
              <div className="tutor-mark" aria-hidden="true">L</div>
              <div><p className="message-author">LearnStepper · 回答完了</p><div className="message-body"><p>{turn.answer}</p></div></div>
            </article>
          ) : null}
        </div>
      ))}

      {generation === "sending" ? (
        <p className="stopped-note" role="status">質問を送信しています…</p>
      ) : null}

      {generation === "streaming" || generation === "interrupting" ? (
        <article className="message message-tutor generation-message" aria-live="polite">
          <div className="tutor-mark" aria-hidden="true">L</div>
          <div>
            <p className="message-author">LearnStepper · {generation === "interrupting" ? "停止処理中" : "生成中"}</p>
            <div className="message-body">
              <p>別の見方で説明します。等式を左右が同じ重さの天びんだと考えると…</p>
            </div>
            <button className="stop-button" type="button" onClick={stop} disabled={generation === "interrupting"}>
              {generation === "interrupting" ? "停止しています…" : "生成を停止"}
            </button>
          </div>
        </article>
      ) : null}

      {generation === "stopped" ? (
        <p className="stopped-note" role="status">生成を停止しました。送信した質問は会話に保持されています。</p>
      ) : null}

      {generation === "failed" ? (
        <p className="generation-error" role="alert">
          接続が切れたため生成を中断しました。送信した質問は保持されています。接続回復後に再送できます。
        </p>
      ) : null}

      <div className="quick-actions" aria-label="説明のクイック操作">
        {['もっと簡単に', '具体例', '図解', 'ヒント', '要約'].map((label) => (
          <button type="button" key={label} disabled={offline} onClick={() => setDraft(`${label}説明してください`)}>{label}</button>
        ))}
      </div>

      <div className="composer">
        <textarea
          aria-label="質問を入力"
          placeholder={offline ? "オフライン中も下書きを保存できます" : "わからないことを質問してください"}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          rows={2}
        />
        <button
          className="send-button"
          type="button"
          onClick={send}
          disabled={offline || !draft.trim() || generation === "sending" || generation === "streaming" || generation === "interrupting"}
          aria-label="質問を送信"
        >
          →
        </button>
        <p>Shift + Enterで改行 · AIの回答には誤りが含まれる場合があります</p>
      </div>
    </section>
  );
}

function LessonContext({ draft, sources, onProgress, onOpenSource }: { draft: SetupDraft; sources: Source[]; onProgress: () => void; onOpenSource: (source: Source) => void }) {
  const profile = JURISDICTION_PROFILES[draft.jurisdiction] ?? JURISDICTION_PROFILES.japan;
  return (
    <aside className="lesson-context-panel">
      <section>
        <p className="eyebrow">今回の目標</p>
        <span className="goal-type goal-can">できる</span>
        <h3>{draft.mode === "free" ? `${draft.topic}を自分の言葉で説明し、具体例へ適用できる` : "一次方程式を途中式と理由を示しながら解ける"}</h3>
        <dl className="goal-details">
          <div>
            <dt>成功基準</dt>
            <dd>{draft.mode === "free" ? "基本概念を説明し、目的に近い例を1つ示す" : "3問中2問以上で、式と理由を示す"}</dd>
          </div>
          <div>
            <dt>評価証拠</dt>
            <dd>記述式演習・確認テスト</dd>
          </div>
        </dl>
      </section>
      <section>
        <div className="panel-heading">
          <p className="eyebrow">根拠資料</p>
          <span>2件</span>
        </div>
        {sources.map((source) => (
          <button className="context-source" type="button" key={source.code} onClick={() => onOpenSource(source)}>
            <span>{source.code}</span>
            <strong>{source.title}</strong>
            <small>{source.status}</small>
          </button>
        ))}
      </section>
      <section>
        <p className="eyebrow">教育課程上の位置</p>
        <div className="curriculum-path">
          <span>{draft.mode === "free" ? "任意テーマ" : profile.label}</span>
          <span>{draft.mode === "free" ? draft.topic : profile.framework}</span>
          <strong>{draft.mode === "free" ? "全体像と基本概念" : "一次方程式"}</strong>
        </div>
      </section>
      <button className="button button-secondary button-block" type="button" onClick={onProgress}>
        進捗を見る
      </button>
    </aside>
  );
}

function RemediationLesson({ onComplete }: { onComplete: () => void }) {
  const questions = [
    {
      prompt: "x + 3 = 8 から x = 5 を求めるとき、なぜ両辺から3を引くのですか。",
      options: ["左右の等しい関係を保ちながら、xだけを残すため", "3を反対側へ移すと自動的に符号が変わるため"],
      answer: "左右の等しい関係を保ちながら、xだけを残すため",
    },
    {
      prompt: "2x = 10 から x = 5 を求めるとき、なぜ両辺を2で割るのですか。",
      options: ["左右の等しい関係を保ちながら、xの係数を1にするため", "左辺の2だけを消せば十分だから"],
      answer: "左右の等しい関係を保ちながら、xの係数を1にするため",
    },
  ];
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answer, setAnswer] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [ready, setReady] = useState(false);
  const question = questions[questionIndex];

  function checkAnswer() {
    setChecked(true);
    if (answer !== question.answer) return;
    if (questionIndex === questions.length - 1) {
      setReady(true);
      return;
    }
    setQuestionIndex((index) => index + 1);
    setAnswer(null);
    setChecked(false);
  }
  return (
    <section className="conversation-panel remediation-lesson" aria-label="補習レッスン">
      <div className="remediation-lesson-heading">
        <span>補習中 · 約10分</span>
        <h2>等式の性質を、天びんで確認</h2>
        <p>復帰先: 一次方程式の考え方 · 復帰条件: 両辺への操作を理由とともに説明できる</p>
      </div>
      <article className="message message-tutor">
        <div className="tutor-mark" aria-hidden="true">L</div>
        <div>
          <p className="message-author">LearnStepper</p>
          <div className="message-body">
            <p>等式の左右を、同じ重さでつり合った天びんだと考えます。</p>
            <p>片側だけから3を取り除くと、つり合いは崩れます。左右の両方から同じ3を取り除けば、等しい関係は保たれます。</p>
          </div>
        </div>
      </article>
      <div className="remediation-check">
        <p className="eyebrow">復帰チェック {Math.min(questionIndex + 1, 2)} / 2</p>
        <h3>{question.prompt}</h3>
        {question.options.map((option) => (
          <button
            className={answer === option ? "answer-option is-selected" : "answer-option"}
            type="button"
            key={option}
            onClick={() => {
              setAnswer(option);
              setChecked(false);
            }}
            aria-pressed={answer === option}
          >
            <span>{option === question.options[0] ? "A" : "B"}</span>{option}
          </button>
        ))}
        {!ready ? (
          <button className="button button-primary" type="button" disabled={!answer} onClick={checkAnswer}>
            {questionIndex === 0 ? "1問目を確認" : "復帰条件を確認"}
          </button>
        ) : (
          <div className="return-confirmation" role="status">
            <strong>復帰条件を満たしました</strong>
            <p>等式を保つ理由を説明できています。元のレッスンへ戻れます。</p>
            <button className="button button-primary" type="button" onClick={onComplete}>元のレッスンへ戻る</button>
          </div>
        )}
        {checked && answer !== question.answer ? <p className="exercise-hint" role="status">片側だけでなく、両辺へ同じ操作を行う理由を確認してください。</p> : null}
      </div>
    </section>
  );
}

function LessonScreen({
  draft,
  offline,
  remediationMode,
  onExercise,
  onRemediation,
  onRemediationComplete,
  onProgress,
}: {
  draft: SetupDraft;
  offline: boolean;
  remediationMode: boolean;
  onExercise: () => void;
  onRemediation: () => void;
  onRemediationComplete: () => void;
  onProgress: () => void;
}) {
  const [generation, setGeneration] = useState<GenerationState>("idle");
  const [contextView, setContextView] = useState<"plan" | "goal" | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const sources = sourcesForDraft(draft);

  function openSource(selectedSource: Source) {
    setContextView(null);
    setSource(selectedSource);
  }

  return (
    <section className="lesson-screen" data-screen="lesson">
      <LessonPlan remediationMode={remediationMode} draft={draft} />
      {remediationMode ? (
        <RemediationLesson onComplete={onRemediationComplete} />
      ) : (
        <TutorConversation
          draft={draft}
          sources={sources}
          offline={offline}
          generation={generation}
          onGeneration={setGeneration}
          onExercise={onExercise}
          onRemediation={onRemediation}
          onOpenSource={openSource}
        />
      )}
      <LessonContext draft={draft} sources={sources} onProgress={onProgress} onOpenSource={openSource} />

      <div className="mobile-learning-context" aria-label="学習コンテキスト">
        <button type="button" onClick={() => setContextView("plan")}>現在地</button>
        <button type="button" onClick={() => setContextView("goal")}>目標・根拠</button>
      </div>
      {contextView ? (
        <div className="learning-context-drawer" role="dialog" aria-modal="true" aria-label={contextView === "plan" ? "現在地" : "目標と根拠"}>
          <button className="drawer-close" type="button" onClick={() => setContextView(null)}>閉じる</button>
          {contextView === "plan" ? (
            <LessonPlan remediationMode={remediationMode} draft={draft} />
          ) : (
            <LessonContext draft={draft} sources={sources} onProgress={onProgress} onOpenSource={openSource} />
          )}
        </div>
      ) : null}
      <SourceDialog source={source} onClose={() => setSource(null)} />
    </section>
  );
}

function ExerciseScreen({ draft, onBack, onComplete }: { draft: SetupDraft; onBack: () => void; onComplete: (result: ExerciseResult) => void }) {
  const questions = draft.mode === "free" ? [
    {
      prompt: `${draft.topic}を学ぶ最初の段階として適切なのはどれですか。`,
      options: [{ key: "A", label: "全体像と基本用語を具体例へ結び付ける" }, { key: "B", label: "用語を順不同で暗記する" }, { key: "C", label: "目的を決めず応用だけ試す" }, { key: "D", label: "根拠資料を確認しない" }],
      answer: "A",
      explanation: "全体像、基本用語、具体例の順で結び付けると、目的に沿って理解を整理できます。",
    },
    {
      prompt: `「${draft.purpose}」という目的へ近づく確認方法はどれですか。`,
      options: [{ key: "A", label: "学んだ概念を目的に近い例で説明する" }, { key: "B", label: "説明せず用語数だけ数える" }, { key: "C", label: "出典を見ずに断定する" }, { key: "D", label: "毎回テーマを変える" }],
      answer: "A",
      explanation: "目的に近い具体例を自分の言葉で説明すると、理解と適用の両方を確かめられます。",
    },
    {
      prompt: `${draft.topic}の理解を更新するとき、根拠として優先するものはどれですか。`,
      options: [{ key: "A", label: "発行主体と版を確認した一次資料" }, { key: "B", label: "出典不明の短文" }, { key: "C", label: "閲覧数だけが多い投稿" }, { key: "D", label: "生成された文章だけ" }],
      answer: "A",
      explanation: "発行主体、版、取得時点を確認できる一次資料を優先し、主張との対応を記録します。",
    },
  ] : [
    {
      prompt: "2x − 7 = 11 で、最初に行う操作はどれですか。",
      options: [
        { key: "A", label: "両辺に 7 を足す" },
        { key: "B", label: "両辺から 7 を引く" },
        { key: "C", label: "両辺を 7 で割る" },
        { key: "D", label: "両辺に 2 を掛ける" },
      ],
      answer: "A",
      explanation: "−7を消すには逆の操作である7を足します。両辺に同じ操作を行うため、等しい関係は保たれます。",
    },
    {
      prompt: "3x = 18 から x を求めるため、次に何をしますか。",
      options: [
        { key: "A", label: "両辺に 3 を足す" },
        { key: "B", label: "両辺を 3 で割る" },
        { key: "C", label: "左辺だけを 3 で割る" },
        { key: "D", label: "両辺から 3 を引く" },
      ],
      answer: "B",
      explanation: "xの係数3を1にするため、両辺を3で割ります。すると x = 6 です。",
    },
    {
      prompt: "方程式を解いたあと、答えを確かめる最もよい方法はどれですか。",
      options: [
        { key: "A", label: "元の式へ代入して左右が等しいか確認する" },
        { key: "B", label: "符号だけを見直す" },
        { key: "C", label: "答えを整数へ丸める" },
        { key: "D", label: "途中式を消して計算し直す" },
      ],
      answer: "A",
      explanation: "求めた値を元の式へ代入し、左辺と右辺が同じ値になることを確認します。",
    },
  ];
  const [questionIndex, setQuestionIndex] = useState(0);
  const [choice, setChoice] = useState<string | null>(null);
  const [graded, setGraded] = useState(false);
  const [score, setScore] = useState(0);
  const [hintVisible, setHintVisible] = useState(false);
  const question = questions[questionIndex];
  const correct = choice === question.answer;

  function grade() {
    if (!choice || graded) return;
    setGraded(true);
    if (correct) setScore((value) => value + 1);
  }

  function nextQuestion() {
    if (questionIndex === questions.length - 1) {
      onComplete({ completed: true, correct: score, total: questions.length });
      return;
    }
    setQuestionIndex((value) => value + 1);
    setChoice(null);
    setGraded(false);
    setHintVisible(false);
  }

  return (
    <section className="exercise-screen" data-screen="exercise">
      <button className="back-link" type="button" onClick={onBack}>← レッスンへ戻る</button>
      <div className="exercise-layout">
        <article className="exercise-card">
          <div className="exercise-kicker">
            <span>理解チェック</span>
            <span>{questionIndex + 1} / {questions.length}</span>
          </div>
          <div className="compact-progress"><span style={{ width: `${((questionIndex + 1) / questions.length) * 100}%` }} /></div>
          <p className="eyebrow">{draft.mode === "free" ? draft.topic : "一次方程式の考え方"}</p>
          <h2>{question.prompt}</h2>
          <p className="question-note">{draft.mode === "free" ? "学習目的と根拠を意識して選んでください。" : "等式の性質を意識して選んでください。"}</p>
          <div className="answer-options">
            {question.options.map((option) => (
              <button
                className={choice === option.key ? "answer-option is-selected" : "answer-option"}
                type="button"
                key={option.key}
                disabled={graded}
                onClick={() => {
                  setChoice(option.key);
                  setGraded(false);
                }}
                aria-pressed={choice === option.key}
              >
                <span>{option.key}</span>
                {option.label}
              </button>
            ))}
          </div>

          {hintVisible && !graded ? (
            <p className="exercise-hint" role="status">{draft.mode === "free" ? `「${draft.purpose}」という目的と、発行主体を確認できる根拠へ結び付けて考えます。` : "左右の等しい関係を保つには、両辺へ同じ操作を行います。"}</p>
          ) : null}

          {graded ? (
            <div className={correct ? "feedback feedback-correct" : "feedback"} role="status">
              <strong>{correct ? "正解です" : "考え方を確認しました"}</strong>
              <p>{question.explanation}</p>
              <span>評価証拠として「{draft.mode === "free" ? `${draft.topic}の理解` : "等式の性質"}」に記録されます</span>
            </div>
          ) : null}

          <div className="exercise-actions">
            <button className="button button-ghost" type="button" onClick={() => setHintVisible((value) => !value)} disabled={graded}>
              {hintVisible ? "ヒントを閉じる" : "ヒントを見る"}
            </button>
            {graded ? (
              <button className="button button-primary" type="button" onClick={nextQuestion}>
                {questionIndex === questions.length - 1 ? "3問の結果を進捗へ反映 →" : "次の問題へ →"}
              </button>
            ) : (
              <button
                className="button button-primary"
                type="button"
                disabled={!choice}
                onClick={grade}
              >
                回答を確認
              </button>
            )}
          </div>
        </article>

        <aside className="exercise-goal">
          <p className="eyebrow">対応する目標</p>
          <span className="goal-type goal-know">わかる</span>
          <h3>{draft.mode === "free" ? `${draft.topic}を説明し、目的に近い例へ適用できる` : "等式の性質と移項の関係を説明できる"}</h3>
          <dl className="goal-details">
            <div><dt>評価観点</dt><dd>{draft.mode === "free" ? "概念の説明と適用" : "操作の選択と理由"}</dd></div>
            <div><dt>根拠資料</dt><dd>{sourcesForDraft(draft).map((source) => source.code).join("・")}</dd></div>
          </dl>
        </aside>
      </div>
    </section>
  );
}

function RemediationScreen({
  onStart,
  onReturn,
}: {
  onStart: () => void;
  onReturn: () => void;
}) {
  return (
    <section className="remediation-screen" data-screen="remediation">
      <div className="route-label">補習ルート</div>
      <h2>先に「等式の性質」を確かめると、次が楽になります。</h2>
      <p>
        「符号が変わる」という手順は使えています。一方で、なぜその操作が成り立つかの説明に迷いがありました。
      </p>
      <div className="remediation-map">
        <div className="route-node origin-node">
          <span>元の位置</span>
          <strong>一次方程式の考え方</strong>
          <small>Module 03 · Lesson 2</small>
        </div>
        <div className="route-arrow" aria-hidden="true">↓</div>
        <div className="route-node remediation-node">
          <span>10分の補習</span>
          <strong>等式の性質を、天びんで確認</strong>
          <small>説明 4分 · 演習 2問</small>
        </div>
        <div className="route-arrow" aria-hidden="true">↓</div>
        <div className="route-node return-node">
          <span>復帰条件</span>
          <strong>両辺への操作を理由とともに2問説明できる</strong>
          <small>達成後、元の位置へ戻ります</small>
        </div>
      </div>
      <div className="remediation-actions">
        <button className="button button-primary" type="button" onClick={onStart}>補習を始める</button>
        <button className="button button-ghost" type="button" onClick={onReturn}>元のレッスンへ戻る</button>
      </div>
    </section>
  );
}

function ProgressScreen({ draft, onLesson, result }: { draft: SetupDraft; onLesson: () => void; result: ExerciseResult }) {
  const [showAllEvidence, setShowAllEvidence] = useState(false);
  const equationMastery = result.completed ? Math.round(68 + (result.correct / result.total) * 14) : 68;
  const concepts = draft.mode === "free" ? [
    { label: `${draft.topic}の全体像`, value: 82, state: "学習中" },
    { label: "基本用語", value: 76, state: "学習中" },
    { label: "具体例への適用", value: equationMastery, state: result.completed && result.correct >= 2 ? "学習中" : "要復習" },
    { label: "自分の言葉で説明", value: 54, state: "学習中" },
  ] : [
    { label: "正負の数", value: 92, state: "習得" },
    { label: "文字式", value: 78, state: "学習中" },
    { label: "等式の性質", value: equationMastery, state: result.completed && result.correct >= 2 ? "学習中" : "要復習" },
    { label: "一次方程式", value: 54, state: "学習中" },
  ];

  return (
    <section className="progress-screen" data-screen="progress">
      <div className="progress-hero">
        <div>
          <p className="eyebrow">{draft.mode === "free" ? `${draft.topic} · 任意テーマ` : "中学数学 · 2026年7月開始"}</p>
          <h2>学びの現在地</h2>
          <p>点数だけでなく、何ができて、何を根拠に達成したかを確認できます。</p>
        </div>
        <button className="button button-primary" type="button" onClick={onLesson}>学習へ戻る</button>
      </div>

      <div className="progress-stats">
        <article><span>全体進捗</span><strong>{result.completed ? "45%" : "42%"}</strong><small>{result.completed ? "8" : "7"} / 16 レッスン</small></article>
        <article><span>目標達成</span><strong>6</strong><small>できる 4 · わかる 2</small></article>
        <article><span>今週の学習</span><strong>1h 48m</strong><small>4日連続</small></article>
      </div>

      <div className="progress-content-grid">
        <section className="mastery-section">
          <div className="section-heading-row">
            <div><p className="eyebrow">概念別習熟度</p><h3>理解の強さ</h3></div>
            <span className="quiet-label">診断・演習・復習から算出</span>
          </div>
          <div className="mastery-list">
            {concepts.map((concept) => (
              <div key={concept.label}>
                <p><strong>{concept.label}</strong><span>{concept.value}% · {concept.state}</span></p>
                <div className="mastery-bar"><span style={{ width: `${concept.value}%` }} /></div>
              </div>
            ))}
          </div>
        </section>

        <aside className="next-action-panel">
          <p className="eyebrow">次のおすすめ</p>
          <span className="goal-type goal-know">わかる</span>
          <h3>{draft.mode === "free" ? `${draft.topic}の基本概念を言葉で説明する` : "等式の性質を言葉で説明する"}</h3>
          <p>{draft.mode === "free" ? draft.purpose : "操作は正確です。理由を説明する練習を1回行うと、一次方程式の定着が見込めます。"}</p>
          <button className="button button-secondary button-block" type="button" onClick={onLesson}>7分で復習する</button>
        </aside>
      </div>

      <section className="evidence-section">
        <div className="section-heading-row">
          <div><p className="eyebrow">目標と評価証拠</p><h3>達成の根拠</h3></div>
          <button className="text-button" type="button" aria-expanded={showAllEvidence} onClick={() => setShowAllEvidence((value) => !value)}>
            {showAllEvidence ? "表示を戻す ↑" : "すべて表示 →"}
          </button>
        </div>
        <div className="evidence-table" role="table" aria-label="学習目標と達成証拠">
          <div role="row" className="evidence-head">
            <span role="columnheader">種類</span><span role="columnheader">目標</span><span role="columnheader">状態</span><span role="columnheader">証拠</span>
          </div>
          <div role="row">
            <span role="cell"><em className="goal-type goal-can">できる</em></span>
            <span role="cell">{draft.mode === "free" ? `${draft.topic}の全体像と基本用語を説明できる` : "正負の数を含む計算を正確に行える"}</span>
            <span role="cell"><strong className="status-mastered">習得</strong></span>
            <span role="cell">演習3回 · 92%</span>
          </div>
          {showAllEvidence ? (
            <div role="row">
              <span role="cell"><em className="goal-type goal-can">できる</em></span>
              <span role="cell">{draft.mode === "free" ? `${draft.topic}を自分の言葉で説明できる` : "一次方程式を具体的な場面で活用できる"}</span>
              <span role="cell"><strong className="status-review">学習中</strong></span>
              <span role="cell">文章題演習 1回 · 次回継続</span>
            </div>
          ) : null}
          <div role="row">
            <span role="cell"><em className="goal-type goal-know">わかる</em></span>
            <span role="cell">{draft.mode === "free" ? `${draft.topic}を目的に近い例へ適用できる` : "等式の性質と移項の関係を説明できる"}</span>
            <span role="cell"><strong className={result.completed && result.correct >= 2 ? "status-mastered" : "status-review"}>{result.completed && result.correct >= 2 ? "学習中" : "要復習"}</strong></span>
            <span role="cell">{result.completed ? `今回の演習 ${result.correct}/${result.total}問 · ${equationMastery}%` : "記述式1回 · 68%"}</span>
          </div>
        </div>
      </section>
    </section>
  );
}

function LibraryScreen({ draft }: { draft: SetupDraft }) {
  const [tab, setTab] = useState<"sources" | "curriculum" | "notes">("sources");
  const [source, setSource] = useState<Source | null>(null);
  const sources = sourcesForDraft(draft);
  const profile = JURISDICTION_PROFILES[draft.jurisdiction] ?? JURISDICTION_PROFILES.japan;
  const tabs = [
    { id: "sources" as const, label: "根拠資料" },
    { id: "curriculum" as const, label: "教育課程" },
    { id: "notes" as const, label: "履歴・ノート" },
  ];
  return (
    <section className="library-screen" data-screen="library">
      <div className="page-intro">
        <p className="eyebrow">S11・S12</p>
        <h2>根拠、教育課程、ノートをひとつに。</h2>
        <p>学習で使った情報だけを、出典と取得時点を保ったまま確認できます。</p>
      </div>
      <div className="library-tabs" role="tablist" aria-label="ライブラリの表示">
        {tabs.map((item) => (
          <button
            className={tab === item.id ? "is-active" : ""}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            aria-controls={`library-panel-${item.id}`}
            id={`library-tab-${item.id}`}
            key={item.id}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {tab === "sources" ? (
      <div className="library-list" role="tabpanel" id="library-panel-sources" aria-labelledby="library-tab-sources">
        {sources.map((source) => (
          <article key={source.code}>
            <span className="source-code">{source.code}</span>
            <div><h3>{source.title}</h3><p>{source.detail}</p><small>取得: 2026年7月16日 · PDF · 公的資料</small></div>
            <strong>{source.status}</strong>
            <button className="text-button" type="button" onClick={() => setSource(source)}>詳細を見る →</button>
          </article>
        ))}
      </div>
      ) : null}
      {tab === "curriculum" ? (
        <div className="library-panel-content" role="tabpanel" id="library-panel-curriculum" aria-labelledby="library-tab-curriculum">
          <p className="eyebrow">教育課程上の現在地</p>
          <h3>{draft.mode === "free" ? `${draft.topic} · 任意テーマ` : profile.framework}</h3>
          <p>{draft.mode === "free" ? draft.purpose : `一次方程式を具体的な場面で活用すること。発行主体: ${profile.authority}。`}</p>
        </div>
      ) : null}
      {tab === "notes" ? (
        <div className="library-panel-content" role="tabpanel" id="library-panel-notes" aria-labelledby="library-tab-notes">
          <p className="eyebrow">前回のセッション · 7月16日</p>
          <h3>{draft.mode === "free" ? `${draft.topic}の目的と全体像` : "移項は「両辺へ同じ操作」の省略表現"}</h3>
          <p>{draft.mode === "free" ? `${draft.purpose}という目的を確認。次回は基本用語を具体例へ結び付けます。` : "天びんの例で等式の性質を確認。次回は途中式と理由を言葉にして演習します。"}</p>
        </div>
      ) : null}
      <SourceDialog source={source} onClose={() => setSource(null)} />
    </section>
  );
}

function SettingsScreen() {
  const [dialog, setDialog] = useState<"logout" | "profile" | "delete" | null>(null);

  useEffect(() => {
    if (!dialog) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setDialog(null);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [dialog]);
  return (
    <section className="settings-screen" data-screen="settings">
      <div className="page-intro">
        <p className="eyebrow">S14</p>
        <h2>プロフィールとデータ</h2>
        <p>認証情報と端末内の学習データは、別々に管理されます。</p>
      </div>
      <div className="settings-list">
        <section>
          <div><p className="eyebrow">ChatGPT認証</p><h3>デモモード</h3><span>プロトタイプのため認証情報・実データは使用していません</span></div>
          <button className="button button-secondary" type="button" onClick={() => setDialog("logout")}>ログアウト表示を確認</button>
        </section>
        <section>
          <div><p className="eyebrow">学習プロフィール</p><h3>学習者デモ</h3><span>日本語 · Asia/Tokyo · 具体例を多めに</span></div>
          <button className="button button-secondary" type="button" onClick={() => setDialog("profile")}>編集</button>
        </section>
        <section className="danger-setting">
          <div><p className="eyebrow">ローカルデータ</p><h3>この端末の学習データ</h3><span>計画、進捗、履歴、根拠資料を含みます</span></div>
          <button className="button button-danger" type="button" onClick={() => setDialog("delete")}>削除内容を確認</button>
        </section>
      </div>
      {dialog ? (
        <div className="dialog-backdrop" role="presentation" onMouseDown={() => setDialog(null)}>
          <section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
            <p className="eyebrow">確認</p>
            <h2 id="settings-dialog-title">
              {dialog === "logout" ? "ChatGPTからログアウト" : dialog === "delete" ? "ローカルデータの削除範囲" : "学習プロフィール"}
            </h2>
            {dialog === "logout" ? <p>ログアウトしても、計画、進捗、履歴、根拠資料はこの端末に保持されます。再ログインまでAI生成は利用できません。</p> : null}
            {dialog === "delete" ? <p>全ローカルデータ削除では、学習計画、進捗、履歴、保存済み根拠資料、認証情報が対象です。このプロトタイプでは実際の削除は行いません。</p> : null}
            {dialog === "profile" ? <p>表示名、言語、タイムゾーン、説明の好みを変更する画面です。このプロトタイプでは現在値を確認できます。</p> : null}
            <button className="button button-primary" type="button" onClick={() => setDialog(null)}>内容を確認しました</button>
          </section>
        </div>
      ) : null}
    </section>
  );
}

export function LearningPrototype() {
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [offline, setOffline] = useState(false);
  const [remediationMode, setRemediationMode] = useState(false);
  const [setupDraft, setSetupDraft] = useState<SetupDraft>(INITIAL_SETUP_DRAFT);
  const [exerciseResult, setExerciseResult] = useState<ExerciseResult>(INITIAL_EXERCISE_RESULT);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
  }, [screen]);

  const content = useMemo(() => {
    switch (screen) {
      case "dashboard":
        return (
          <Dashboard
            draft={setupDraft}
            onResume={() => setScreen("lesson")}
            onCreate={() => {
              setSetupDraft({ ...INITIAL_SETUP_DRAFT, started: true });
              setExerciseResult(INITIAL_EXERCISE_RESULT);
              setRemediationMode(false);
              setScreen("setup");
            }}
            onResumeDraft={() => setScreen("setup")}
            onProgress={() => setScreen("progress")}
            hasDraft={setupDraft.started}
            offline={offline}
          />
        );
      case "setup":
        return (
          <SetupFlow
            draft={setupDraft}
            onDraftChange={setSetupDraft}
            onCancel={() => setScreen("dashboard")}
            onComplete={() => {
              setSetupDraft((draft) => ({ ...draft, started: false }));
              setScreen("lesson");
            }}
            offline={offline}
          />
        );
      case "lesson":
        return (
          <LessonScreen
            draft={setupDraft}
            offline={offline}
            remediationMode={remediationMode}
            onExercise={() => setScreen("exercise")}
            onRemediation={() => setScreen("remediation")}
            onRemediationComplete={() => {
              setRemediationMode(false);
              setScreen("lesson");
            }}
            onProgress={() => setScreen("progress")}
          />
        );
      case "exercise":
        return (
          <ExerciseScreen
            draft={setupDraft}
            onBack={() => setScreen("lesson")}
            onComplete={(result) => {
              setExerciseResult(result);
              setScreen("progress");
            }}
          />
        );
      case "remediation":
        return (
          <RemediationScreen
            onStart={() => {
              setRemediationMode(true);
              setScreen("lesson");
            }}
            onReturn={() => setScreen("lesson")}
          />
        );
      case "progress":
        return <ProgressScreen draft={setupDraft} onLesson={() => setScreen("lesson")} result={exerciseResult} />;
      case "library":
        return <LibraryScreen draft={setupDraft} />;
      case "settings":
        return <SettingsScreen />;
    }
  }, [exerciseResult, offline, remediationMode, screen, setupDraft]);

  return (
    <AppShell
      screen={screen}
      learningDraft={setupDraft}
      offline={offline}
      onOfflineChange={() => setOffline((value) => !value)}
      onNavigate={setScreen}
    >
      {content}
    </AppShell>
  );
}
