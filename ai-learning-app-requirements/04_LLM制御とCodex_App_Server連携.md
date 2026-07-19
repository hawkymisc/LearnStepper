# 04 LLM制御とCodex App Server連携

[INDEXへ戻る](00_INDEX.md)

## 1. 学習コンテキスト

LLMには、アプリ共通指示、安全指示、ローカルプロフィールの学習設定、テーマと`can_do`／`know`で構造化した最終学習目標、対象教育課程と版、現在の計画、現在レッスンと学習目標、概念別習熟度、学習目標別の評価証拠、直近要約、選定済み根拠資料の抜粋とsource ID、今回入力を渡します。長期状態は端末内のアプリDBから構築し、会話コンテキストだけに依存しません。

## 2. AIチューターの振る舞い

- レベルを超える用語には説明を付け、一度に過剰な情報を出しません。
- 必要に応じて理解確認し、正答だけでなく考え方を説明します。
- 説明、演習、確認質問を現在の`can_do`または`know`学習目標と成功基準へ対応付けます。
- `know`の達成は、説明、区別、関連付け、理由提示などの証拠で判断し、ユーザーの自己申告だけでは確定しません。
- 不必要に肯定せず、誤りは明確かつ学習意欲を損なわない表現で示します。
- 対象教育課程と前提関係を参照し、理解不足を検出した場合は前段階へ戻る理由、補う内容、元の位置への復帰条件を示します。
- 教育上の事実主張を根拠資料へ対応付け、資料にない内容や推測を区別します。
- 根拠資料が取得不能、版不明、相互矛盾の場合は断定せず、その状態を表示します。
- 無関係な操作を勝手に実行しません。
- 医療・法律・金融では専門家の判断を代替しません。

## 3. 構造化出力

初期診断問題、学習計画、学習目標、演習問題、採点結果、概念抽出、セッション要約、習熟度更新候補はJSON Schemaで生成します。学習目標は`scope`、`goal_type`、`statement`、`target`、`conditions`、`success_criteria`、`evidence_method`を含み、`goal_type`は`can_do`または`know`に限定します。教育課程に関係する出力にはcurriculum item IDとcurriculum objective IDを、根拠を必要とする出力にはsource IDと引用対象範囲を含めます。`turn/start`のターン限定`outputSchema`を利用します。

`can_do`では観測可能な行動と`success_criteria`を必須とします。`know`では知識・理解の対象と、説明、区別、関連付け、理由提示などの`evidence_method`を必須とします。スキーマ違反、分類不能、評価方法が自己申告だけの場合は確定データへ保存せず、再生成またはユーザー確認の対象とします。

source IDはApplication Coreが管理する根拠資料を参照し、LLMが未登録のURLやsource IDを新規作成した場合は検証エラーとします。

## 4. プロンプト変更管理

- プロンプトにバージョンを付け、各実行でモデル、推論設定、出力スキーマ、教育課程版、source ID集合と共に記録します。
- 本番変更前に評価データセットで回帰テストします。
- 計画生成、採点、説明生成、補習経路判定は別プロンプトとして管理します。

## 5. ローカル接続構成

デスクトップUIからCodex App Serverへ直接接続しません。App Serverはデスクトップアプリが子プロセスとして起動し、ネットワーク待受ポートを公開しません。

```text
Desktop Renderer → typed IPC → Application Core／Learning Orchestrator
                               → Codex Gateway
                               → JSON-RPC over stdio → Codex App Server
                               → Grounding Gateway → HTTPS読取り → Web上の根拠資料

Codex App Server → HTTPS → OpenAI／ChatGPT
```

MVPはstdio/JSONLを使用します。実験的WebSocketトランスポート、Application API／BFF、SSE配信は使用しません。App ServerイベントはCodex Gatewayが型検証し、Application CoreからローカルIPCイベントとしてRendererへ配信します。

## 6. ChatGPT認証

1. アプリ起動後、初期化済みApp Serverへ`account/read`を送信し、認証状態を確認します。
2. 未認証時は`account/login/start`をChatGPT方式で開始し、返された認証URLのHTTPS schemeと公式許可hostを検証してからシステムブラウザで開きます。PKCE、`state`、`nonce`、固定redirect URIをCodex認証契約として確認します。
3. ログイン試行IDと`account/login/completed`を一対一に対応させ、未要求、重複、期限切れ、不一致のイベントを拒否します。完了イベント受信後に`account/read`で状態を再確認してから利用可能状態へ移行します。
4. ログアウト時は`account/logout`を使用します。ローカル学習データの削除は別操作とします。

認証情報の保存と更新はCodexに委譲しますが、永続保存先はOS資格情報ストアを必須とします。利用不能時は永続ログインを無効とし、`CODEX_HOME`、SQLite、設定、ログ、バックアップへ平文または可逆形式で保存しません。アプリ専用の`CODEX_HOME`をOSユーザー限定権限で使用し、既存のCodex CLI、IDE拡張、他アプリの認証・スレッド状態と分離します。OpenAI APIキーまたはChatGPTアクセストークンをRenderer、アプリDB、診断ログへ渡しません。

## 7. 初期化

App Serverプロセスの接続ごとに、他の操作より前に`initialize`、`initialized`を行います。その後に認証状態確認、スレッド開始または再開を行います。MVPでは`experimentalApi`を無効にします。

## 8. 概念対応

| アプリ概念 | Codex概念・操作 |
|---|---|
| 学習テーマ | Threadの上位にあるApplication Core固有のProject |
| 学習セッション | 1件以上のThreadを束ねるApplication Core固有のSession |
| 会話分岐 | Thread。通常はSession内1件、Fork時は複数件 |
| ユーザー発言とAI処理 | Turn |
| メッセージ、進捗、結果 | Item |
| 逐次表示 | Item delta notification |
| 応答停止 | `turn/interrupt` |
| テーマ再開 | `thread/resume` |
| 履歴参照 | `thread/read` |
| 一覧同期 | `thread/list` |
| アーカイブ | `thread/archive` |

Project 1件は複数LearningSessionを、LearningSession 1件は複数Threadを保持できます。同一Threadの
再開ではLearningSession IDとThread IDを維持します。Fork後はchild Threadをactiveにします。
App Server 0.144.5の`thread/fork`はTurn境界のみのため、Item境界Forkは対象の確定Itemまでを
`thread/start`と`thread/inject_items`で新Threadへ再構成します。この方式はCodex内部の承認状態や
実行状態を継承しません。非実験APIで損失なく再構成できる完了済みuser／agent message Itemだけを
対象とし、別種Itemを含むprefixは意味を変換せず拒否します。教育課程、根拠資料、習熟度、補習経路はアプリ固有データであり、アプリDBを正本とします。

## 9. イベント処理

`turn/started`、`item/started`、`item/agentMessage/delta`、`item/completed`、`turn/completed`、`error`、`warning`、承認要求、`account/login/completed`、`account/updated`、レート制限を処理します。MVPで受信した承認要求はRendererへ転送せずApplication Coreで既定拒否し、セキュリティイベントとして記録します。`item/completed`をItem確定状態とし、ターンは`completed`、`interrupted`、`failed`を区別して保存します。

Rendererは受信したdeltaを表示にのみ使用し、確定履歴はApplication Coreが検証した`item/completed`を基準に保存します。

## 10. 再起動・冪等性

- Rendererの再読込後もApplication CoreとApp Serverの実行状態を維持します。
- App Server異常終了時は自動再起動し、アプリDBとCodexスレッド状態を照合します。
- アプリ終了時の進行中ターンは中断として整合させ、未送信入力と下書きを端末内に保持します。
- ローカルIPC要求へrequest IDを付け、同一ターンの二重実行を防ぎます。
- アプリ再起動時はアプリDBの確定履歴を表示し、必要に応じて`thread/read`で整合確認します。
- 再整合はCodex Thread／Turn／Item IDで照合し、欠落した確定Itemだけを取込みます。同一IDで
  内容が異なる場合は上書きせず`RECONCILIATION_CONFLICT`とします。
- モデルと推論設定はGatewayへ注入できます。未指定時はフィールド自体を送信せずApp Server既定値を使用します。

## 11. バージョン管理

Codexバイナリをアプリに同梱してバージョン固定し、更新時は互換性試験を行います。`generate-ts`または`generate-json-schema`の生成物をリポジトリに保存します。未知の通知は記録して無視でき、未知の必須レスポンス項目は安全に失敗させます。

## 12. ツール、Grounding、承認

MVPではApp Serverのツール許可集合を空、承認方針を既定拒否として固定します。シェル、端末ファイル読取り・書込み、外部サービスへの副作用、未知のツールを許可せず、設定欠落またはツール有効化を検出した場合は安全に起動失敗させます。App ServerはOSサンドボックス内で起動し、作業ディレクトリ、環境変数、他アプリ資格情報、不要なネットワークへのアクセスを制限します。教育内容のGroundingはApp Serverの汎用ツールを使用せず、Application Coreが管理する専用Grounding Gatewayで実行します。許可されたHTTPS読取り、取得サイズ、Content-Type、リダイレクト、タイムアウトを制限し、取得文書はプロンプトインジェクションを含む信頼できない入力として扱います。

将来、副作用を伴うツールを有効化する場合は、操作、対象、影響を表示し、明示承認を必須とします。

関連文書: [システム構成](05_システム構成とデータモデル.md)、[非機能要件](07_非機能要件.md)
