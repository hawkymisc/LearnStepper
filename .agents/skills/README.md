# Repository skills

This directory contains project-scoped skills from the official
[`openai/skills`](https://github.com/openai/skills) repository. Codex discovers
repository skills under `.agents/skills` from the working directory up to the
repository root.

## Installed skills

| Skill | Project use |
|---|---|
| `openai-docs` | Verify current OpenAI and Codex App Server behavior against official documentation. |
| `modern-frontend-design` | Design or review purposeful, responsive, accessible, and production-ready frontend interfaces. |
| `pdf` | Read and visually validate the official curriculum PDFs used as grounded source material. |
| `security-threat-model` | Model trust boundaries and abuse paths around ChatGPT authentication, local learning data, external document retrieval, and potential use by minors if included in scope. |
| `security-best-practices` | Review Python, JavaScript/TypeScript, or Go code for secure-by-default behavior if a supported stack is selected. |

## Provenance

- Source: `openai/skills`
- Source paths: `skills/.curated/<skill-name>`
- Source branch: `main`
- Source HEAD observed after installation: `49f948faa9258a0c61caceaf225e179651397431`
- Installed: 2026-07-18
- Installer: Codex built-in `skill-installer`

The source branch is not pinned by the installer. Review upstream changes before
refreshing these checked-in copies. Each skill retains its upstream `LICENSE.txt`.

## Deferred skills

UI automation skills such as `playwright` are intentionally deferred until the
desktop framework and supported operating systems are selected. Additional
framework-specific implementation skills should be added only after those
architecture decisions are recorded.
