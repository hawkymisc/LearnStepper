# LearnStepper

LearnStepper is an interactive AI learning application. This repository contains two layers:

LearnStepper は、対話型の AI 学習アプリケーションです。このリポジトリは次の2層で構成されています。

- a Next.js / Vinext Renderer covering the main learning flows;
- a framework-independent local learning service backed by SQLite.

- 主要な学習フローを扱う Next.js / Vinext Renderer。
- SQLite を利用する、フレームワーク非依存のローカル学習サービス。

The desktop Renderer connects to the local learning service through a closed logical IPC contract.
The packaged app includes Codex and starts the official browser login from its
**ChatGPTにログインする** button. Browser-only development runs as a non-persistent preview.

デスクトップ版 Renderer は、閉じた論理 IPC 契約を通じてローカル学習サービスへ接続します。
パッケージには Codex が同梱され、**ChatGPTにログインする** ボタンから公式ブラウザログインを開始します。
ブラウザだけで起動する開発版は、永続化を伴わないプレビューです。

## Prerequisites

- Node.js `>=22.13.0`
- Python `>=3.11`
- [uv](https://docs.astral.sh/uv/)

## Launching the Renderer

## Renderer の起動方法

### Development

### 開発用

Install dependencies once, then start the hot-reload development server:

依存関係を一度インストールしてから、ホットリロード付きの開発サーバーを起動します。

```bash
npm install
npm run dev
```

Open the local URL printed by the command, usually `http://localhost:5173`.

コマンドに表示されたローカル URL を開きます。通常は `http://localhost:5173` です。

Use these commands while developing:

開発中は次のコマンドを使用します。

- `npm run dev`: start local development with hot reload;
- `npm run build`: verify the Vinext production build output;
- `npm test`: build the Renderer and run contract, rendered-output, and interaction tests;
- `npm run lint`: run ESLint across the JavaScript and TypeScript source;
- `npm run typecheck`: run the TypeScript compiler without emitting files.

- `npm run dev`: ホットリロード付きのローカル開発環境を起動します。
- `npm run build`: Vinext の本番ビルド出力を検証します。
- `npm test`: Renderer をビルドし、契約、レンダリング出力、操作テストを実行します。
- `npm run lint`: JavaScript / TypeScript ソースに対して ESLint を実行します。
- `npm run typecheck`: ファイルを出力せずに TypeScript コンパイラを実行します。

### User Preview

### ユーザー用プレビュー

Build the app first, then run the production-style local server:

先にアプリをビルドしてから、本番相当のローカルサーバーを起動します。

```bash
npm install
npm run build
npm run start
```

Open the local URL printed by the server. In this mode, the Renderer still requires the desktop host
bridge for persisted local learning data. Without the bridge, it shows the preview state.

サーバーに表示されたローカル URL を開きます。このモードでも、永続化された学習データを扱うには
デスクトップ host bridge が必要です。bridge がない場合はプレビュー状態として表示されます。

This app does not use `wrangler.jsonc`.

このアプリは `wrangler.jsonc` を使用しません。

### macOS デスクトップ版（ローカル開発用）

`npm run dev` と `npm run start` はブラウザ用プレビューです。実データをこの端末に保存して
継続利用する場合は、Electron host 経由で起動します。

```bash
npm install
npm run desktop:dev
```

このモードは macOS 専用の開発起動です。Electron が Renderer と Python ローカルサービスを接続し、
学習データを `~/Library/Application Support/LearnStepper/learnstepper.sqlite3` に保存します。
画面の **ChatGPTにログインする** からCodexのブラウザログインを開始します。認証情報は
LearnStepperのSQLiteやRendererには保存せず、CodexがOS keyringで管理します。未ログインでも、
保存されたローカル学習データは読み書きできますが、AI会話は利用できません。

`npm run desktop:package`はCodex CLIとPython sidecarを同梱したmacOS arm64 DMGを生成します。
Developer ID署名、公証、自動更新、全ローカルデータ削除、バックアップおよびエクスポートはFuture Updateです。

### Desktop downloads / デスクトップ版のダウンロード

When a change is merged into `main`, GitHub Actions validates the project, builds the macOS arm64
desktop artifact, then publishes the download page to GitHub Pages. Enable GitHub Pages
for this repository with **Source: GitHub Actions** once in the repository settings.

`main` に変更が反映されると、GitHub Actions が検証、macOS arm64向けデスクトップ成果物の
ビルド、GitHub Pages上のダウンロードページ公開まで実行します。Windows/LinuxはFuture Updateです。
リポジトリ設定で GitHub Pages の
**Source: GitHub Actions** を一度だけ有効化してください。

Local packaging uses the same configuration:

ローカルでのパッケージ作成も同じ設定を使用します。

```bash
npm run desktop:package
```

## Renderer Scope

## Renderer の範囲

The Renderer covers:

Renderer は次の範囲を扱います。

- P0: profile → Codex login → free-topic setup → learning conversation → progress;
- P1: objectives, actionable saved plan, history, notes, bookmarks, settings, and archive;
- Future Update: curriculum-aligned learning, diagnosis, exercises, final assessment, and remediation.

- P0: プロフィール → Codexログイン → 任意テーマ作成 → AI学習対話 → 進捗。
- P1: 学習目標、実データがある計画、履歴、ノート、ブックマーク、設定、アーカイブ。
- Future Update: 教育課程準拠、初期診断、演習、最終評価、補習。

## Local learning service / ローカル学習サービス

Implemented scope:

実装済み範囲:

- one local learning profile without credential/token columns;
- import and query of the seven included education jurisdictions;
- free-topic and curriculum project lifecycle with idempotent commands;
- versioned plans, modules, lessons, concepts, prerequisite graphs, and source provenance;
- append-only `can_do` / `know` objectives;
- assessments, evidence validation, self-report exclusion, and core-calculated attainment;
- mastery, progress, remediation, confirmed history, notes, and bookmarks;
- Project→LearningSession→CodexThread→Turn→Item conversation persistence, item-boundary forks,
  interruption, restart resume, typed streaming events, and conflict-safe reconciliation;
- an injected, version-pinned Codex App Server 0.144.5 stdio/JSONL gateway with a generated protocol fixture;
- atomic jurisdiction and ownership validation;
- hard deletion of project-owned data with a minimal deletion tombstone;
- SQLite behind runtime-checkable storage protocols for future DuckDB support.

- 認証情報やトークン列を持たない、端末内の単一学習プロフィール。
- MVP 対象7教育管轄のインポートとクエリ。
- 冪等 command を備えた、任意テーマおよび教育課程プロジェクトのライフサイクル。
- 版管理された計画、モジュール、レッスン、概念、前提グラフ、出典 provenance。
- append-only な `can_do` / `know` 目標。
- 評価、証拠検証、自己申告の除外、Core 計算による達成判定。
- 習熟度、進捗、補習、確定済み履歴、ノート、ブックマーク。
- Project→LearningSession→CodexThread→Turn→Item の会話永続化、Item 境界 fork、
  interrupt、再起動後 resume、型付き streaming event、競合安全な reconciliation。
- 生成済みプロトコル fixture を持つ、Codex App Server 0.144.5 の injectable / version-pinned
  stdio/JSONL gateway。
- 管轄と所有権の atomic validation。
- project-owned data の hard deletion と最小 deletion tombstone。
- 将来の DuckDB 対応に備えた runtime-checkable storage protocol 配下の SQLite。

The complete hold register is [not-implemented-functionalities.md](not-implemented-functionalities.md).
Must/AC classification is in
[requirements-traceability.yaml](docs/requirements-traceability.yaml).
Conversation use cases and cardinalities are in
[conversation-data-design.md](docs/conversation-data-design.md).

完全な保留リストは [not-implemented-functionalities.md](not-implemented-functionalities.md) にあります。
Must / AC の分類は [requirements-traceability.yaml](docs/requirements-traceability.yaml) にあります。
会話ユースケースと cardinality は [conversation-data-design.md](docs/conversation-data-design.md) にあります。

### Development

### 開発用

```bash
uv run python -m unittest discover -s tests -v
uv run --extra dev ruff check learnstepper tests
uv run --extra dev mypy learnstepper
uv run --extra dev coverage run -m unittest discover -s tests
uv run --extra dev coverage report -m
```

Dependencies and tool versions are locked by `uv.lock`.

依存関係とツールバージョンは `uv.lock` で固定されています。

### Storage portability

### ストレージ移植性

Application code depends on `Database` and `DatabaseSession`, not `sqlite3`. The SQLite adapter owns
PRAGMAs, connection setup, row conversion, and SQLite DDL. Application-generated UUIDs avoid reliance
on SQLite auto-increment behavior. DuckDB is not presented as implemented; adding it requires a
DuckDB-specific adapter, migrations, and the same persistence contract tests.

Application code は `sqlite3` ではなく `Database` と `DatabaseSession` に依存します。SQLite adapter が
PRAGMA、connection setup、row conversion、SQLite DDL を所有します。Application-generated UUID により、
SQLite auto-increment 挙動への依存を避けています。DuckDB は実装済みとして扱いません。追加する場合は
DuckDB 固有の adapter、migration、および同等の persistence contract test が必要です。

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
