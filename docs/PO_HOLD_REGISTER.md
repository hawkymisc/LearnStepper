# フロントエンド PO 保留リスト

状態: **運用中**
作成日: 2026-07-20

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
| FE-PO-001 | ⚠️ 提案中 | 製品版デスクトップアプリの対応 OS、最低対応バージョン、フレームワーク、ホスト IPC 通信方式、インストーラー、署名、更新方式 | フレームワーク非依存の型付き Host Bridge を使用します。ホステッド版は非製品のプレビューとして扱います | [実装計画](FRONTEND_IMPLEMENTATION_PLAN.md)、[Backend Specification](backend-specification.md)、[NIF](../not-implemented-functionalities.md) NIF-010, NIF-011, NIF-022, NIF-026、[Traceability](requirements-traceability.yaml) |
| FE-PO-002 | 🔲 判断待ち | 第三者デスクトップアプリにおける ChatGPT ログイン条件、クライアント登録、対応リダイレクト仕様、認証情報ストアとの統合方式 | 認証機能は「利用不可／PO 保留」と表示します。保存済みローカルデータの閲覧とは分離します | [画面設計 S01/S14](SCREEN_FLOW_DESIGN.md)、[会話設計](conversation-data-design.md)、[NIF](../not-implemented-functionalities.md) NIF-001、[Traceability](requirements-traceability.yaml) |
| FE-PO-003 | 🔲 判断待ち | 使用モデル、推論設定、プロンプト・出力契約、プロバイダー制限、利用コスト方針 | 診断、計画生成、演習生成・採点、AI 推薦を無効化し、依存事項を画面に表示します | [UI/Backend整合 UI-BE-001, 004, 006, 013](UI_BACKEND_ALIGNMENT_REVIEW.md)、[NIF](../not-implemented-functionalities.md) NIF-004, NIF-005, NIF-007, NIF-008, NIF-023, NIF-025、[Traceability](requirements-traceability.yaml) |
| FE-PO-004 | 🔲 判断待ち | Grounding プロバイダー、許可ドメイン・ポート、資料品質基準、最低資料数、矛盾処理方針、取得上限、費用負担者 | 保存済み資料は閲覧できます。新規検索、取得、更新は利用不可とします | [画面設計 S05/S11](SCREEN_FLOW_DESIGN.md)、[UI/Backend整合 UI-BE-010](UI_BACKEND_ALIGNMENT_REVIEW.md)、[NIF](../not-implemented-functionalities.md) NIF-003, NIF-013, NIF-018、[Traceability](requirements-traceability.yaml) |
| FE-PO-005 | 🔲 判断待ち | MVP 対象7プロフィールごとの教育段階、学年、教科、版、安定した教育課程 ID、発行主体、公式一次資料 | インポート済みデータは代表データとして表示し、最終受入対象の組合せは未確定と明記します | [画面設計 S05](SCREEN_FLOW_DESIGN.md)、[Backend Specification 4.2](backend-specification.md)、[UI/Backend整合 UI-BE-003](UI_BACKEND_ALIGNMENT_REVIEW.md)、[NIF](../not-implemented-functionalities.md) NIF-012, NIF-018, NIF-019、[Traceability](requirements-traceability.yaml) |
| FE-PO-006 | 🔲 判断待ち | 学習目標の最大件数と、教科・教育段階別の版付きルーブリック | 保存済み目標は閲覧できます。AI 生成および「承認に必要な目標がすべて揃った」という表示は保留します | [画面設計 S05/S07/S10](SCREEN_FLOW_DESIGN.md)、[Backend Specification 4.4](backend-specification.md)、[UI/Backend整合 UI-BE-011](UI_BACKEND_ALIGNMENT_REVIEW.md)、[NIF](../not-implemented-functionalities.md) NIF-014, NIF-020、[Traceability](requirements-traceability.yaml) |
| FE-PO-007 | 🔲 判断待ち | 学習計画の下書き・レビュー・承認ライフサイクルと、全レッスンに最低1件の学習目標があることを証明する規則 | 既存の有効計画は読み取り専用で表示します。`plan.update` 成功をユーザー承認済みとは表示しません | [画面設計 S07](SCREEN_FLOW_DESIGN.md)、[Backend Specification 4.5](backend-specification.md)、[UI/Backend整合 UI-BE-004](UI_BACKEND_ALIGNMENT_REVIEW.md)、[NIF](../not-implemented-functionalities.md) NIF-020、[Traceability](requirements-traceability.yaml) |
| FE-PO-008 | 🔲 判断待ち | 教育課程項目の達成集約、推薦順位、達成証拠が不足する場合の動作 | `planned` を達成状態と分離して表示します。検証済み達成および推薦は利用不可と表示します | [画面設計 S10](SCREEN_FLOW_DESIGN.md)、[Backend Specification 4.6](backend-specification.md)、[UI/Backend整合 UI-BE-013](UI_BACKEND_ALIGNMENT_REVIEW.md)、[NIF](../not-implemented-functionalities.md) NIF-008, NIF-021, NIF-024、[Traceability](requirements-traceability.yaml) |
| FE-PO-009 | 🔲 判断待ち | 保存期間、暗号化、バックアップ、エクスポート、キャッシュ・スナップショットのライセンス、全ローカルデータ削除範囲 | プロジェクト削除とは分離します。全ローカルデータ削除は無効化し、削除成功を表示しません | [画面設計 S13/S14](SCREEN_FLOW_DESIGN.md)、[Backend Specification 8](backend-specification.md)、[UI/Backend整合 UI-BE-007, 018](UI_BACKEND_ALIGNMENT_REVIEW.md)、[NIF](../not-implemented-functionalities.md) NIF-002, NIF-009, NIF-013, NIF-015、[Traceability](requirements-traceability.yaml) |
| FE-PO-010 | 🔲 判断待ち | 未成年者を対象に含めるか、および医療・法律・金融テーマに対する制限 | 年齢適格性や高リスク分野の安全性を保証しません。該当する入口にプロダクト方針の保留を表示します | [NIF](../not-implemented-functionalities.md) NIF-016、[Traceability](requirements-traceability.yaml) |
| FE-PO-011 | ⚠️ 提案中 | 外部品質指標、クラッシュレポート、診断ログ、同意取得、データ最小化方針 | 外部テレメトリーを既定で無効にし、ローカル診断情報だけを表示します | [画面設計 S00/S14](SCREEN_FLOW_DESIGN.md)、[Frontend実装計画 6](FRONTEND_IMPLEMENTATION_PLAN.md)、[NIF](../not-implemented-functionalities.md) NIF-017 |
| FE-PO-012 | 🔲 判断待ち | プログラミング学習用サンドボックスのコード実行方針 | コード実行操作は提供しません。説明のみの学習は利用可能とします | [会話設計](conversation-data-design.md)、[NIF](../not-implemented-functionalities.md) NIF-010、[Traceability](requirements-traceability.yaml) |
| FE-PO-013 | 🔲 判断待ち | クイック操作の完全な一覧と、寄り道・元レッスン復帰の意味および状態遷移 | バックエンドで版管理された操作のみ有効化します。不足する操作は必要箇所で保留表示します | [画面設計 S08](SCREEN_FLOW_DESIGN.md)、[会話設計](conversation-data-design.md)、[UI/Backend整合 UI-BE-005](UI_BACKEND_ALIGNMENT_REVIEW.md)、[NIF](../not-implemented-functionalities.md) NIF-025、[Traceability](requirements-traceability.yaml) |
| FE-PO-014 | 🔲 判断待ち | 補習提案を拒否・非表示にする状態と、補習を受けずに元レッスンを継続できるか | Core から取得可能な補習状態だけを表示・操作します。フロントエンド独自の拒否状態や完了遷移は作成しません | [画面設計 S09R](SCREEN_FLOW_DESIGN.md)、[Backend Specification 5](backend-specification.md)、[UI/Backend整合 UI-BE-012](UI_BACKEND_ALIGNMENT_REVIEW.md)、[Traceability](requirements-traceability.yaml) |

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

FE-PO-D01 の承認によって FE-PO-001 が解消されたわけではありません。
最終的なデスクトップフレームワーク、対応 OS、パッケージング、Bridge 通信方式は引き続き判断待ちです。

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
