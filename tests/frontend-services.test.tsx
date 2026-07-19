import { describe, expect, test, vi } from "vitest";
import { createIPCClient, type IPCEnvelope, type IPCResponse } from "../app/frontend/bridge/ipc-client";
import {
  collectSourceIds,
  loadCurriculaForProfile,
  loadObjectiveDetails,
  loadProjectSources,
  loadProjectWorkspace,
} from "../app/frontend/services/project-data";

function recordingClient(responses: Record<string, unknown>) {
  const invoke = vi.fn(async (envelope: IPCEnvelope): Promise<IPCResponse> => ({
    ok: true,
    data: (responses[envelope.name] ?? {}) as never,
  }));
  return { client: createIPCClient({ invoke }), invoke };
}

describe("project data services", () => {
  test("loads curricula by profile and retains backend curriculum ids", async () => {
    const { client, invoke } = recordingClient({
      "curriculum.list": { items: [{ id: "curriculum-jp-math", profile_id: "jp-national", official_name: "学習指導要領" }] },
    });

    const result = await loadCurriculaForProfile(client, "jp-national");

    expect(result[0].id).toBe("curriculum-jp-math");
    expect(invoke).toHaveBeenCalledWith({
      type: "query",
      name: "curriculum.list",
      payload: { profile_id: "jp-national" },
    });
  });

  test("loads every implemented project workspace read with project ownership", async () => {
    const { client, invoke } = recordingClient({
      "project.get": { id: "project-1", title: "数学" },
      "plan.getCurrent": { plan: null },
      "learningObjective.list": { items: [] },
      "progress.get": { lesson_total: 0, lesson_completed: 0, progress_rate: 0, objectives: [] },
      "mastery.get": { items: [] },
      "curriculumProgress.get": { items: [] },
      "remediation.getActive": { remediation: null },
      "history.listSessions": { items: [] },
      "note.list": { items: [] },
      "bookmark.list": { items: [] },
    });

    const workspace = await loadProjectWorkspace(client, "project-1");

    expect(workspace.project.id).toBe("project-1");
    expect(workspace.plan).toBeNull();
    expect(workspace.progress.progress_rate).toBe(0);
    const calls = invoke.mock.calls.map(([envelope]) => envelope);
    for (const name of [
      "project.get",
      "plan.getCurrent",
      "learningObjective.list",
      "progress.get",
      "mastery.get",
      "curriculumProgress.get",
      "remediation.getActive",
      "history.listSessions",
      "note.list",
      "bookmark.list",
    ]) {
      expect(calls).toContainEqual(expect.objectContaining({ name, payload: expect.objectContaining(name === "project.get" ? { id: "project-1" } : { project_id: "project-1" }) }));
    }
  });

  test("loads attainment and evidence for each current objective version", async () => {
    const { client, invoke } = recordingClient({
      "learningObjective.get": { id: "objective-1", current_version: { id: "objective-version-2", version: 2 } },
      "learningObjective.attainment.get": { status: "not_attained", objective_version_id: "objective-version-2" },
      "learningObjective.evidence.list": { items: [] },
    });

    const detail = await loadObjectiveDetails(client, "objective-1");

    expect(detail.objective.current_version.id).toBe("objective-version-2");
    expect(detail.attainment.status).toBe("not_attained");
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({ name: "learningObjective.evidence.list", payload: { id: "objective-1" } }));
  });

  test("loads only sources referenced by the active plan and current objective versions", async () => {
    const { client, invoke } = recordingClient({
      "source.get": { id: "source-record", title: "資料", verification_status: "verified" },
      "source.citations": { items: [{ id: "citation-1" }] },
    });
    const workspace = {
      project: { id: "project-1" },
      plan: { source_document_ids: ["source-1"], modules: [{ source_document_ids: ["source-2"], lessons: [{ source_document_ids: ["source-1"] }] }] },
      objectives: [{ id: "objective-1", current_version: { id: "version-1", source_document_ids: ["source-3"] } }],
      progress: {}, mastery: [], curriculumProgress: [], remediation: null, sessions: [], notes: [], bookmarks: [],
    };

    expect(collectSourceIds(workspace)).toEqual(["source-1", "source-2", "source-3"]);
    const sources = await loadProjectSources(client, workspace);

    expect(sources).toHaveLength(3);
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({ name: "source.get", payload: { id: "source-1" } }));
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({ name: "source.citations", payload: { source_document_id: "source-3" } }));
  });
});
