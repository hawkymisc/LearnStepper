# LearnStepper

LearnStepper is an interactive AI learning application. This repository contains two layers:

- a Next.js UI prototype covering the main learning flows;
- a framework-independent local Application Core backed by SQLite.

The UI prototype is not yet connected to the Application Core, real learning data, ChatGPT
authentication, or the Codex App Server. The Application Core communicates through a closed logical
IPC contract and does not expose a REST server.

## Prerequisites

- Node.js `>=22.13.0`
- Python `>=3.11`
- [uv](https://docs.astral.sh/uv/)

## UI prototype

The prototype covers:

- P0: dashboard → learning → exercise → progress;
- P0: learning → remediation prompt → remediation learning;
- P1: new-learning setup, evidence review, initial assessment, and plan approval;
- P1: library, settings, offline display, and generation stop.

### Development

```bash
npm install
npm run dev
npm run build
```

This prototype does not use `wrangler.jsonc`.

Useful commands:

- `npm run dev`: start local development;
- `npm run build`: verify the vinext build output;
- `npm test`: build the prototype and run its contract, rendered-output, and interaction tests;
- `npm run lint`: run ESLint across the JavaScript and TypeScript source;
- `npm run typecheck`: run the TypeScript compiler without emitting files.

## Application Core

Implemented scope:

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

The complete hold register is [not-implemented-functionalities.md](not-implemented-functionalities.md).
Must/AC classification is in
[requirements-traceability.yaml](docs/requirements-traceability.yaml).
Conversation use cases and cardinalities are in
[conversation-data-design.md](docs/conversation-data-design.md).

### Development

```bash
uv run python -m unittest discover -s tests -v
uv run --extra dev ruff check learnstepper tests
uv run --extra dev mypy learnstepper
uv run --extra dev coverage run -m unittest discover -s tests
uv run --extra dev coverage report -m
```

Dependencies and tool versions are locked by `uv.lock`.

### Storage portability

Application code depends on `Database` and `DatabaseSession`, not `sqlite3`. The SQLite adapter owns
PRAGMAs, connection setup, row conversion, and SQLite DDL. Application-generated UUIDs avoid reliance
on SQLite auto-increment behavior. DuckDB is not presented as implemented; adding it requires a
DuckDB-specific adapter, migrations, and the same persistence contract tests.

## Workspace Auth Headers

OpenAI workspace sites can read the current user's email from
`oai-authenticated-user-email`.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs optional or required
ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send anonymous visitors
  through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in or sign-out. The helper
  validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because they depend on per-request
  identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the OAuth cookies, and
identity header injection. Do not implement app routes for those reserved paths. Routes that do not
import and call the helper remain anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the Sites hosting
platform's access policy controls for workspace-wide restrictions, or enforce explicit server-side
membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write actions tied to the
current ChatGPT user. Leave public content anonymous.

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
