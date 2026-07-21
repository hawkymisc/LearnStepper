import type { JsonObject, JsonValue, createIPCClient } from "../bridge/ipc-client";

export type IPCClient = ReturnType<typeof createIPCClient>;

export type CurriculumRecord = JsonObject & {
  id: string;
  profile_id: string;
  official_name: string;
};

export type ObjectiveRecord = JsonObject & {
  id: string;
  current_version: JsonObject & { id: string; version?: number; version_number?: number };
};

export type ProjectWorkspace = {
  project: JsonObject & { id: string };
  plan: JsonObject | null;
  objectives: ObjectiveRecord[];
  progress: JsonObject;
  mastery: JsonObject[];
  curriculumProgress: JsonObject[];
  remediation: JsonObject | null;
  sessions: JsonObject[];
  notes: JsonObject[];
  bookmarks: JsonObject[];
};

export type SourceRecord = JsonObject & {
  id: string;
  citations: JsonObject[];
};

function object(value: JsonValue): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function items<T extends JsonObject>(value: JsonValue): T[] {
  const candidate = object(value).items;
  return Array.isArray(candidate) ? candidate as T[] : [];
}

export async function loadCurriculaForProfile(client: IPCClient, profileId: string): Promise<CurriculumRecord[]> {
  return items<CurriculumRecord>(await client.query("curriculum.list", { profile_id: profileId }));
}

export async function loadObjectiveDetails(client: IPCClient, objectiveId: string) {
  const [objective, attainment, evidence] = await Promise.all([
    client.query("learningObjective.get", { id: objectiveId }),
    client.query("learningObjective.attainment.get", { id: objectiveId }),
    client.query("learningObjective.evidence.list", { id: objectiveId }),
  ]);
  return {
    objective: object(objective) as ObjectiveRecord,
    attainment: object(attainment),
    evidence: items<JsonObject>(evidence),
  };
}

function addSourceIds(value: JsonValue, target: Set<string>) {
  if (Array.isArray(value)) {
    for (const item of value) addSourceIds(item, target);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (key === "source_document_ids" && Array.isArray(child)) {
      for (const id of child) if (typeof id === "string" && id) target.add(id);
    } else {
      addSourceIds(child, target);
    }
  }
}

export function collectSourceIds(workspace: ProjectWorkspace): string[] {
  const ids = new Set<string>();
  addSourceIds(workspace.plan, ids);
  for (const objective of workspace.objectives) addSourceIds(objective.current_version, ids);
  return [...ids];
}

export async function loadProjectSources(client: IPCClient, workspace: ProjectWorkspace): Promise<SourceRecord[]> {
  return Promise.all(collectSourceIds(workspace).map(async (id) => {
    const [source, citationResult] = await Promise.all([
      client.query("source.get", { id }),
      client.query("source.citations", { source_document_id: id }),
    ]);
    return { ...object(source), id, citations: items<JsonObject>(citationResult) } as SourceRecord;
  }));
}

export async function loadProjectWorkspace(client: IPCClient, projectId: string): Promise<ProjectWorkspace> {
  const projectPayload = { id: projectId };
  const ownedPayload = { project_id: projectId };
  const [project, planResult, objectiveResult, progress, mastery, remediationResult, sessions, notes, bookmarks] = await Promise.all([
    client.query("project.get", projectPayload),
    client.query("plan.getCurrent", ownedPayload),
    client.query("learningObjective.list", ownedPayload),
    client.query("progress.get", ownedPayload),
    client.query("mastery.get", ownedPayload),
    client.query("remediation.getActive", ownedPayload),
    client.query("history.listSessions", { ...ownedPayload, limit: 50, offset: 0 }),
    client.query("note.list", ownedPayload),
    client.query("bookmark.list", ownedPayload),
  ]);

  return {
    project: object(project) as ProjectWorkspace["project"],
    plan: (object(planResult).plan as JsonObject | null | undefined) ?? null,
    objectives: items<ObjectiveRecord>(objectiveResult),
    progress: object(progress),
    mastery: items<JsonObject>(mastery),
    curriculumProgress: [],
    remediation: (object(remediationResult).remediation as JsonObject | null | undefined) ?? null,
    sessions: items<JsonObject>(sessions),
    notes: items<JsonObject>(notes),
    bookmarks: items<JsonObject>(bookmarks),
  };
}
