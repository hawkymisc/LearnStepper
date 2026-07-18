# 06 ローカルアプリケーションインターフェース

[INDEXへ戻る](00_INDEX.md)

## 1. 方針

MVPはstandaloneデスクトップアプリであり、外部公開REST APIを持ちません。Desktop RendererはApplication Coreが公開する型付きローカルIPCのCommand、Query、Eventを使用します。RendererからSQLite、OS資格情報ストア、Codex App Serverへ直接アクセスしません。

以下の名称は論理インターフェースです。具体的なIPCライブラリに依存せず、スキーマとエラー形式を契約テスト可能にします。

## 2. 認証・ローカルプロフィール

```text
QUERY   auth.getStatus
COMMAND auth.loginWithChatGPT
COMMAND auth.cancelLogin
COMMAND auth.logout
QUERY   profile.get
COMMAND profile.update
COMMAND profile.deleteLearningData
COMMAND profile.deleteAllLocalData
```

`auth.loginWithChatGPT`はシステムブラウザで開く認証URLとログイン試行IDを返せますが、ChatGPTのAPIキー・アクセストークンを返しません。Application CoreはURLのHTTPS schemeと公式許可hostを検証します。完了Eventを試行ID、期限、重複状態と照合し、`auth.getStatus`相当の再確認後に認証済み状態を確定します。

## 3. 教育課程・根拠資料

```text
QUERY   curriculumProfile.list
QUERY   curriculumProfile.get
QUERY   curriculum.list
QUERY   curriculum.get
QUERY   curriculum.items
QUERY   curriculum.objectives
QUERY   source.search
QUERY   source.get
COMMAND source.retrieve
COMMAND source.refresh
QUERY   source.citations
```

`curriculumProfile.list`はMVPの8教育管轄プロファイルを返し、安定キー、国・管轄名・管轄種別・公式教育当局を含めます。`curriculum.list`は指定プロファイル配下の教育段階、学年、教科、版を返し、`curriculum.objectives`は教育課程資料の個別到達目標原文と出典位置を返します。

`source.retrieve`と`source.refresh`は読取り専用Groundingポリシーを適用し、取得したURL、リダイレクト後URL、発行主体、版、取得時点、内容ハッシュ、検証状態を返します。

## 4. 学習テーマ

```text
COMMAND project.create
QUERY   project.list
QUERY   project.get
COMMAND project.update
COMMAND project.archive
COMMAND project.restore
COMMAND project.delete
```

## 5. 診断・学習計画

```text
COMMAND diagnostic.start
COMMAND diagnostic.submitAnswers
QUERY   diagnostic.get
COMMAND plan.generate
QUERY   plan.getCurrent
COMMAND plan.update
COMMAND plan.regenerate
QUERY   learningObjective.list
QUERY   learningObjective.get
COMMAND learningObjective.update
QUERY   learningObjective.evidence.list
QUERY   learningObjective.attainment.get
QUERY   remediation.getActive
COMMAND remediation.accept
COMMAND remediation.complete
```

`plan.generate`と`plan.getCurrent`は、モジュール・レッスンに加えて構造化した学習目標を返します。学習目標は論理ID、現在版ID、`scope`、`goal_type`、目標文、対象、条件、成功基準、評価証拠の取得方法、教育課程項目ID、教育課程原文目標IDを含みます。`learningObjective.update`は達成状態を受け付けず、既存版を上書きせずに新しいappend-only版を作成します。更新時も`scope`とIDの組合せ、`goal_type`、種類ごとの必須項目を検証し、既存の達成判定を失効または再計算します。

`learningObjective.evidence.list`は採用・不採用を含む評価証拠と判定理由を返し、`learningObjective.attainment.get`はApplication Coreが算出した達成状態、対象目標版、使用証拠、判定日時を返します。

## 6. 学習セッション・会話

```text
COMMAND session.start
QUERY   session.get
COMMAND message.send
COMMAND turn.steer
COMMAND turn.interrupt
COMMAND session.complete
```

`message.send`はローカルrequest IDを受け付け、開始したCodex Turnとの対応を返します。ストリーミング内容はEventとして配信します。

## 7. ノート・ブックマーク・履歴

```text
COMMAND note.create
QUERY   note.list
COMMAND note.update
COMMAND note.delete
COMMAND bookmark.create
QUERY   bookmark.list
COMMAND bookmark.delete
QUERY   history.listSessions
QUERY   history.getSession
```

履歴Queryはページング、時系列順序、アーカイブ済みテーマの包含可否を明示し、削除済み参照を有効データとして返しません。

## 8. 評価・進捗

```text
COMMAND assessment.generate
COMMAND assessment.submitAttempt
QUERY   progress.get
QUERY   mastery.get
QUERY   reviewRecommendations.get
QUERY   curriculumProgress.get
```

## 9. Event

```text
auth.statusChanged
auth.loginCompleted
appServer.statusChanged
source.retrievalUpdated
turn.started
item.started
item.agentMessageDelta
item.completed
turn.completed
warning
error
rateLimits.updated
```

Eventにはアプリ起動中の単調増加sequence、関連するrequest ID、project ID、session ID、Codex Thread／Turn／Item IDを必要に応じて含めます。確定状態は`item.completed`と`turn.completed`を基準にアプリDBへ保存します。

## 10. 横断要件

- Renderer起点の全入力へ`additionalProperties: false`のスキーマ検証、文字数・配列件数・数値範囲・null・空文字規則、サイズ制限、ID形式検証を適用します。
- Application Coreはproject、plan、module、lesson、objective、assessment、session、note、bookmark間の所有関係と許可された状態遷移を再検証し、Rendererから内部状態を直接設定させません。
- `mode=curriculum`では関連する全curriculum itemおよびcurriculum objectiveが学習テーマと同じ教育管轄プロファイルに属することを確認し、不一致時は`CURRICULUM_JURISDICTION_MISMATCH`としてトランザクション全体を拒否します。
- 学習目標の`scope`と参照IDの不正な組合せ、`goal_type`の欠落・未知値・重複指定、必須文字列の空値、証拠の所有関係不一致は`VALIDATION_ERROR`として確定保存しません。
- IPC呼出元をアプリ自身のRendererへ限定し、任意Webコンテンツからの呼出しを許可しません。
- ターン開始、計画生成、資料取得などの重複実行が問題となるCommandにはrequest IDを使用します。
- エラーは`code`、ユーザー向けメッセージ、再試行可否、再試行可能時刻、関連request IDを持つアプリ向け分類へ変換します。
- ChatGPT認証情報、OS資格情報ストアの値、App Serverの生ログをIPCレスポンスへ含めません。
- Renderer再読込後はアプリDBの確定状態を再取得し、実行中処理がある場合はApplication Coreの現在状態へ再購読します。

関連文書: [機能要件](03_機能要件.md)、[データモデル](05_システム構成とデータモデル.md)、[非機能要件](07_非機能要件.md)
