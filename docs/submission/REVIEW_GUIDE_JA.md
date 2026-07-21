# 投稿前レビューガイド

対象: OpenAI Build Week 2026 / Education category。

## 採用した提出ストーリー

**LearnStepperは、使い捨てになりやすいAI対話を、学習者自身が所有する継続的かつ検証可能な学習記録へ変換します。**

差別化の中心は、AI回答そのものではありません。会話、学習目標、確認済み履歴、エビデンス、進捗を
ローカルの同一プロジェクトに結び付け、再起動後も継続できる点です。自己申告だけでは主要な到達扱いに
しないため、「話したこと」と「学べた根拠」を分離しています。

## 投稿時の採用案

- Project title: `LearnStepper`
- Tagline: `A local-first AI tutor that remembers how you learn, one verified step at a time.`
- Category: `Education`
- Repository: privateのまま審査用2アカウントへ共有
- Primary visual: `devpost-thumbnail-1200x800.png`（Devpost推奨3:2）
- Test platform: macOS arm64 DMG
- AI prerequisite: external Codex CLI 0.144.5 + ChatGPT account

## 5分レビュー順

1. `DEVPOST_SUBMISSION.md`のTitle、Tagline、What it does、What's nextを確認します。
2. `devpost-thumbnail-1200x800.png`と`GALLERY_ASSETS.md`の掲載順を確認します。
3. `JUDGING_ALIGNMENT.md`で、技術・デザイン・インパクト・アイデアの4基準に根拠があることを確認します。
4. `JUDGE_FAQ.md`で、外部Codex CLI、ローカル保存、未実装範囲の説明を確認します。
5. 公開YouTube URLを受領後、`SUBMISSION_CHECKLIST.md`を上から確認します。

## 特に確認する表現

- 「Codex同梱」ではなく「外部Codex CLI 0.144.5が必要」と記載しています。
- ChatGPT認証情報をLearnStepperが保管するとは記載していません。
- Web検索、コード実行、カリキュラム生成、診断、演習、最終評価の完成を主張していません。
- Developer ID公証済みとは記載していません。
- 過去の企画材料とBuild Week期間内の実装を区別しています。

## 投稿直前まで空欄の値

- 公開YouTube URL。映像セッションから受領します。
- `/feedback Session ID`: `019f73ce-4667-7e90-aa14-4a4aa88d7e6a`を取得済みです。
- 最終DMGの配布URL、サイズ、SHA-256。
- Devpost上の参加者名、チーム、適格性情報。

外部公開、GitHub共有、Devpost送信は、完成プレビューに対するPO承認後にのみ実行します。
