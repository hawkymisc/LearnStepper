# フロントエンド PO 保留リスト

状態: **運用中**
作成日: 2026-07-20

正本: 本ファイルだけをPO判断の情報源とします。類似名のローカルコピーや一時ファイルは監査・提出対象外です。

このリストには、フロントエンド実装側で推測して決めてはならないプロダクトオーナー判断を記録します。
技術的なプロバイダー依存事項は、引き続き
[`../not-implemented-functionalities.md`](../not-implemented-functionalities.md) で管理します。
このリストで判断が確定しても、対応する NIF 項目が自動的に解消されるわけではありません。
NIF 項目の解消には、実装と検証証拠が別途必要です。

## 判断状態

- `🔲 判断待ち`: 承認済みの判断が記録されていません。
- `⚠️ 提案中`: 安全側の実装案は記録済みですが、PO 承認前です。
- `✅ 決定済み`: PO の判断内容と判断日が記録されています。

## 現在の判断待ち項目

| ID | 状態 | PO 判断が必要な内容 | 判断待ち期間中のフロントエンド動作 | 関連ドキュメント・保留事項 |
|---|---|---|---|---|
| FE-PO-001 | ✅ ハッカソン決定 | macOS arm64限定DMGをad-hoc署名で限定配布します。Developer ID署名、公証、複数OS、自動更新はFuture Updateです | Electron host が型付きBridgeとJSONL sidecarでローカルサービスへ接続します。ホステッド版は非製品プレビューです | [実装計画](FRONTEND_IMPLEMENTATION_PLAN.md)、[Hackathon設計](HACKATHON_SUBMISSION_DESIGN.md) |
| FE-PO-002 | ✅ 決定済み | 外部Codex CLI 0.144.5を必須とし、`codex login --device-auth`で認証します | LearnStepperはブラウザログインを開始せず、**ログイン状態を再確認**で`account/read`のみ実行します。Rendererへアカウント情報・トークンを渡しません | [Hackathon設計](HACKATHON_SUBMISSION_DESIGN.md)、[NIF](../not-implemented-functionalities.md) NIF-001 |
| FE-PO-003 | ✅ ハッカソン決定 | Codex既定のモデル・推論設定で学習対話だけを提供します | 診断、計画生成、演習生成・採点、AI推薦はFuture Updateとし、未完成画面を表示しません | [Hackathon設計](HACKATHON_SUBMISSION_DESIGN.md) |
| FE-PO-004 | ✅ ハッカソン決定 | GroundingはWeb検索を禁止し、この端末に保存済みの資料だけを使用します。Web検索はFuture Updateです | 学習画面と学習目標・資料画面に方針を常時表示します | [Hackathon設計](HACKATHON_SUBMISSION_DESIGN.md) |
| FE-PO-005 | ✅ Future Update | 教育課程に沿った学習はハッカソンMVPの対象外です | 教育課程・地域・版の選択UIを表示しません。内部データは将来向けに保持します | [Hackathon設計](HACKATHON_SUBMISSION_DESIGN.md) |
| FE-PO-006 | ✅ ハッカソン決定 | MVPで扱う学習目標は最大5件です。保存済み目標の閲覧に限定します | AI生成、教科・教育段階別の版付きルーブリック、承認完全性の保証はFuture Updateです | [画面設計 S05/S07/S10](SCREEN_FLOW_DESIGN.md)、[NIF](../not-implemented-functionalities.md) NIF-014, NIF-020 |
| FE-PO-007 | ✅ ハッカソン決定 | 既存の有効計画を読み取り専用で表示します | 下書き・レビュー・承認ライフサイクルと完全性ゲートはFuture Updateです。`plan.update` 成功をユーザー承認済みとは表示しません | [UI/Backend整合 UI-BE-004](UI_BACKEND_ALIGNMENT_REVIEW.md)、[NIF](../not-implemented-functionalities.md) NIF-020 |
| FE-PO-008 | ✅ Future Update | 教育課程項目の達成集約と推薦はMVPの対象外です | 教育課程進捗を問い合わせず、画面にも表示しません | [Hackathon設計](HACKATHON_SUBMISSION_DESIGN.md) |
| FE-PO-009 | ✅ ハッカソン決定 | ローカル保存と既存の個別削除だけをMVPで提供します | 全ローカルデータ削除、エクスポート、バックアップ、暗号化・保存期間・ライセンス方針はFuture Updateです | [UI/Backend整合 UI-BE-007, 018](UI_BACKEND_ALIGNMENT_REVIEW.md)、[NIF](../not-implemented-functionalities.md) NIF-002, NIF-009, NIF-013, NIF-015 |
| FE-PO-010 | ✅ ハッカソン決定 | MVPは18歳以上を対象とします。医療・法律・金融テーマは対象外です | 未成年者対応と高リスク分野の安全設計はFuture Updateです | [NIF](../not-implemented-functionalities.md) NIF-016 |
| FE-PO-011 | ✅ ハッカソン決定 | 外部テレメトリーとクラッシュレポートを送信しません | 端末内の診断ログだけを使用します。外部品質指標、同意取得を伴う送信はFuture Updateです | [画面設計 S00/S14](SCREEN_FLOW_DESIGN.md)、[NIF](../not-implemented-functionalities.md) NIF-017 |
| FE-PO-012 | ✅ ハッカソン決定 | MVPでは学習コードを実行しません | 説明、コード例、レビューだけを提供します。ローカル・外部サンドボックスはFuture Updateです | [会話設計](conversation-data-design.md)、[NIF](../not-implemented-functionalities.md) NIF-010 |
| FE-PO-013 | ✅ ハッカソン決定 | クイック操作は「もっと簡単に」「具体例」「理解を確認」「レッスンへ戻る」の4種類です | 操作は現在の応答を調整するだけで、永続的な寄り道状態を作りません。追加操作と寄り道ライフサイクルはFuture Updateです | [会話設計](conversation-data-design.md)、[NIF](../not-implemented-functionalities.md) NIF-025 |
| FE-PO-014 | ✅ Future Update | 補習提案、拒否、開始、完了、元レッスン復帰はMVPの対象外です | 補習画面と操作を表示しません | [Hackathon設計](HACKATHON_SUBMISSION_DESIGN.md)、[UI/Backend整合 UI-BE-012](UI_BACKEND_ALIGNMENT_REVIEW.md) |

## 承認済みの実装方針

### FE-PO-D01 — 契約優先 Renderer 境界

- 判断日: 2026-07-20
- 判断内容: 方針 A を承認済みです。既存の Next.js／Vinext Renderer を、型付きかつ
  フレームワーク非依存の Host Bridge と厳密な LocalIPC envelope に接続します。
  プロバイダー依存機能は、依存事項が解消されるまで無効化するか、保留中と明示します。
- 不採用案: デスクトップフレームワーク確定まで待機する案は、独立して検証可能な Renderer 実装を
  停止させるため不採用です。タイマー駆動デモを拡張する案は、偽の成功状態とバックエンド不整合を
  残すため不採用です。
- 影響する要件: フロントエンド要件全体、
  [UI-BE-001〜UI-BE-018](UI_BACKEND_ALIGNMENT_REVIEW.md)。
- 実装証拠: `app/frontend/bridge/ipc-client.ts`、
  `app/frontend/learnstepper-app.tsx`、`app/frontend/services/project-data.ts`、
  `tests/frontend-*.test.tsx` の契約テスト群。2026-07-20 にビルド、Lint、型検査、
  フロントエンドテスト40件、サーバー・プロトタイプテスト6件、Python `unittest` 回帰試験で検証済みです。

### FE-PO-D02 — macOS開発用 Electron host

- 判断日: 2026-07-20
- 判断内容: macOS向けローカル開発版は Electron を使用します。Renderer と Python Application Core は
  context-isolated preload Bridge と相関ID付きJSONL sidecarで接続します。SQLite、WAL、SHMは
  `~/Library/Application Support/LearnStepper/` 配下に保存します。
- 認証: 独自ChatGPT OAuthは実装しません。外部Codex CLI 0.144.5で`codex login --device-auth`を実行し、
  LearnStepperは既定または設定済み`CODEX_HOME`を共有します。アプリDB・Renderer・ログには保存しません。
- 不採用案: ブラウザストレージを正本にする案は、再起動・データ所有権・プレビュー表示を不明確にするため不採用です。
  Tauriは今回の開発起動には新規Rust host実装を要するため不採用です。
- 決定事項: ハッカソン提出物はmacOS arm64 DMGです。
- Future Update: 最低対応macOS版、Developer ID署名、公証、自動更新、完全削除、バックアップ、エクスポートです。ad-hoc署名とdeep検証は実装済みです。
- 実装証拠: `desktop/`、`learnstepper/desktop_service.py`、`tests/desktop-transport.test.mjs`、
  `tests/test_desktop_service.py`。

### FE-PO-D03 — 起動時の成人確認と学習目標5件上限

- 判断日: 2026-07-21
- 状態: 1A・2A・3A・4Aを承認済み、実装済みです。外部Codex CLI方式への変更も承認済みです。
  新DMGの回帰検証、外部CLI状態の画面キャプチャー、既存CLI認証による最初のAI応答、再起動後の
  外部CLI認証・会話セッション再利用まで完了しています。
- 年齢制限: アプリ起動直後、プロフィール・プロジェクト・認証状態を読み込む前に、18歳以上であることを
  自己申告する専用画面を表示します。確認結果は永続化せず、Rendererプロセス内だけで保持するため、起動ごとに
  再確認します。本人確認や年齢認証を実施したとは表示しません。医療・法律・金融テーマがMVP対象外で
  あることも同画面で明示します。確認前に利用できるHost機能は確認専用IPCだけです。Electronのsidecar、DB、Codex、
  account readとその他IPCは確認成功後に開始します。対象外テーマの文言はスコープ確認であり、キーワード拒否は行いません。
- 学習目標上限: 1プロジェクトあたり有効な学習目標は最大5件です。Rendererで6件目以降を隠さず、
  Application Coreの`learningObjective.update`新規作成境界で6件目を拒否します。既存のactive目標の版更新は
  件数を増やさないため許可します。invalidated目標の再有効化はactive件数へ算入し、既に5件以上なら拒否します。
  既存の上限超過データは削除・非表示にせず、件数が5未満へ戻るまで新規作成と再有効化を拒否します。
- 不採用案: 年齢確認結果を端末へ永続保存する案と、目標一覧をRenderer側で5件へ切り詰める案は
  不採用です。前者は起動ごとの確認要件を満たさず、後者は正本と表示内容を不一致にするためです。
- 実装証拠: `desktop/eligibility.mjs`、`desktop/main.mjs`、`app/frontend/learnstepper-app.tsx`、`learnstepper/core.py`、
  `tests/desktop-eligibility.test.mjs`、`tests/frontend-renderer.test.tsx`、`tests/test_backend_application_core.py`。
  確認前Host開始0件、保護IPC拒否、同時確認の一回起動、失敗後再試行、再起動リセット、5件目までの新規作成、
  6件目の拒否、active更新、invalidated再有効化、legacy上限超過保持を検証済みです。
  1440×900と320×900の成人確認、ホスト起動中・失敗、A→B切替中・完了の実画面キャプチャーでも
  表示欠落と旧プロジェクト情報の露出がないことを確認済みです。
  [成人確認 1440×900](evidence/adult-eligibility-1440x900.png)、[成人確認 320×900](evidence/adult-eligibility-320x900.png)、
  [ホスト起動中](evidence/eligibility-host-loading-1440x900.png)、[ホスト失敗](evidence/eligibility-host-error-1440x900.png)、
  [B読込中](evidence/project-switch-b-loading-1440x900.png)、[B読込完了](evidence/project-switch-b-settled-1440x900.png)、
  [最終パッケージ 320px](evidence/installed-project-created-320x900.png)、
  [200%ズーム](evidence/installed-project-created-200-percent-zoom.png)、
  [reduced-motion](evidence/installed-project-created-reduced-motion-1440x900.png)、
  [キーボードフォーカス](evidence/installed-keyboard-focus-1440x900.png)、
  [再起動永続化](evidence/installed-project-persisted-after-restart-1440x900.png)。

## 画面・操作レビューで必要な判断

以下は製品機能を有効化する判断ではありません。実行可能な Renderer に対する PO 受入確認項目です。

| ID | 状態 | PO に確認する内容 | 現在の提案 | 関連ドキュメント |
|---|---|---|---|---|
| FE-PO-101 | 🔲 判断待ち | グローバルナビゲーションは5項目で十分ですか | ホーム、学習、進捗、ライブラリ、設定を維持し、プロジェクト設定は選択中プロジェクトの文脈内に置きます | [画面設計 2](SCREEN_FLOW_DESIGN.md)、[UI-BE-017/018](UI_BACKEND_ALIGNMENT_REVIEW.md) |
| FE-PO-102 | 🔲 判断待ち | デスクトップ幅の3ペイン学習画面は理解しやすいですか | 計画、会話、目標・証拠の3ペインを維持し、狭い画面では補助ペインを折り畳みます | [画面設計 S08](SCREEN_FLOW_DESIGN.md)、[会話設計](conversation-data-design.md) |
| FE-PO-103 | 🔲 判断待ち | `できる`／`わかる`、成功基準、証拠の意味を理解できますか | 日本語ラベルと正規値 `can_do`／`know`、適用範囲、目標版を併記します | [Backend Specification 4.4/4.6](backend-specification.md)、[UI-BE-011](UI_BACKEND_ALIGNMENT_REVIEW.md) |
| FE-PO-104 | 🔲 判断待ち | 補習中も元の学習との関係を理解できますか | 元レッスン、戻る理由、現在の概念、復帰条件、バックエンド状態を固定表示します | [画面設計 S09R](SCREEN_FLOW_DESIGN.md)、[Backend Specification 5](backend-specification.md)、[UI-BE-012](UI_BACKEND_ALIGNMENT_REVIEW.md) |
| FE-PO-105 | 🔲 判断待ち | オフライン、認証期限切れ、App Server 停止、ローカル DB 障害を区別できますか | 能力ごとの状態行と、影響を受ける操作ごとのメッセージを分けて表示します | [実装計画 6](FRONTEND_IMPLEMENTATION_PLAN.md)、[UI-BE-016](UI_BACKEND_ALIGNMENT_REVIEW.md) |
| FE-PO-106 | 🔲 判断待ち | ログアウト、アーカイブ、プロジェクト削除、全ローカルデータ削除の違いは十分明確ですか | 影響範囲、復元可能性、保持されるデータを別画面・別ダイアログで表示します | [画面設計 S13/S14](SCREEN_FLOW_DESIGN.md)、[Backend Specification 8](backend-specification.md)、[UI-BE-007/018](UI_BACKEND_ALIGNMENT_REVIEW.md) |

## 判断確定時の記録形式

PO が項目を決定した場合、表の状態を `✅ 決定済み` に変更し、以下の形式で記録を追加します。

```text
### FE-PO-NNN — <判断タイトル>

- 判断日: YYYY-MM-DD
- 判断内容: <承認された動作>
- 不採用案: <案と不採用理由>
- 影響する要件: <要件 ID>
- 実装証拠: <ファイル、テスト、PR>
```

## 項目を削除しない規則

判断済みの項目も削除しません。監査可能な意思決定記録として残します。
対応する NIF 保留項目を解除できるのは、
[`not-implemented-functionalities.md`](../not-implemented-functionalities.md) に定義された
5つの証拠条件を満たした場合だけです。
