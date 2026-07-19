# Codex App Server protocol fixture 0.144.5

Generated from `codex-cli 0.144.5` with:

```shell
codex app-server generate-json-schema --out <temporary-directory>
```

Committed fixture: `codex_app_server_protocol.v2.schemas.json`.

SHA-256: `275a7469440f01b41056c96faa01db9c24871cadad173064897a99f19dfe0aaa`.

The stdio gateway contract tests cover the subset used by LearnStepper: initialization,
`account/read`, `thread/start`, `thread/resume`, `thread/read`, `thread/inject_items`, `turn/start`,
`turn/steer`, `turn/interrupt`, delta notifications, completed items, and completed turns. Updating the
bundled Codex version requires regenerating this fixture and rerunning those tests.
