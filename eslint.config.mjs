import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    // Repository-distributed Codex skills are maintained independently.
    ".agents/**",
    ".worktrees/**",
    "build/**",
    "release/**",
    // Python tooling outputs are not JavaScript source.
    ".venv/**",
    "htmlcov/**",
    ".mypy_cache/**",
    ".ruff_cache/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
