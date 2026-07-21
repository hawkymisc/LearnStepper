import { describe, expect, test } from "vitest";
import {
  deriveCapabilities,
  type RuntimeSignals,
} from "../app/frontend/state/capabilities";
import { deriveBootDestination } from "../app/frontend/state/boot";
import { curriculumProgressLabel } from "../app/frontend/features/progress/labels";

const HEALTHY: RuntimeSignals = {
  core: "available",
  database: "available",
  network: "online",
  codexCli: "available",
  authentication: "authenticated",
  appServer: "available",
  grounding: "available",
  reconciliation: "idle",
};

describe("capability separation", () => {
  test("keeps local reads and writes available when only the network is offline", () => {
    const capabilities = deriveCapabilities({ ...HEALTHY, network: "offline" });

    expect(capabilities.localRead).toBe(true);
    expect(capabilities.localWrite).toBe(true);
    expect(capabilities.conversation).toBe(false);
    expect(capabilities.groundingFetch).toBe(false);
    expect(capabilities.primaryIssue).toBe("network");
  });

  test("does not describe a database failure as offline", () => {
    const capabilities = deriveCapabilities({ ...HEALTHY, database: "unavailable" });

    expect(capabilities.localRead).toBe(false);
    expect(capabilities.localWrite).toBe(false);
    expect(capabilities.primaryIssue).toBe("database");
  });

  test("isolates App Server loss from saved source and project access", () => {
    const capabilities = deriveCapabilities({ ...HEALTHY, appServer: "unavailable" });

    expect(capabilities.localRead).toBe(true);
    expect(capabilities.conversation).toBe(false);
    expect(capabilities.cachedSources).toBe(true);
    expect(capabilities.primaryIssue).toBe("app_server");
  });

  test("identifies a missing external Codex CLI without disabling local data", () => {
    const capabilities = deriveCapabilities({ ...HEALTHY, codexCli: "missing", appServer: "unavailable" });

    expect(capabilities.localRead).toBe(true);
    expect(capabilities.conversation).toBe(false);
    expect(capabilities.primaryIssue).toBe("codex_cli");
  });
});

describe("boot and progress truth", () => {
  test("branches to profile, empty dashboard, ready dashboard, or recovery", () => {
    expect(deriveBootDestination({ coreReady: false, profile: null, projects: null, error: "boom" })).toBe("recovery");
    expect(deriveBootDestination({ coreReady: true, profile: null, projects: [], error: null })).toBe("profile");
    expect(deriveBootDestination({ coreReady: true, profile: { id: "p1" }, projects: [], error: null })).toBe("empty");
    expect(deriveBootDestination({ coreReady: true, profile: { id: "p1" }, projects: [{ id: "x" }], error: null })).toBe("ready");
  });

  test("never labels planned curriculum content as attained", () => {
    expect(curriculumProgressLabel("planned")).toBe("計画に含まれる");
    expect(curriculumProgressLabel("planned")).not.toContain("達成");
  });
});
