import type { JsonObject } from "../../bridge/ipc-client";

export type ProjectSetupDraft = {
  mode: "curriculum" | "free_topic";
  title: string;
  topic: string;
  purpose: string;
  curriculumId: string | null;
  currentLevel: string;
  targetLevel: string;
  targetDate: string | null;
  preferredSessionMinutes: number;
  prerequisites: string;
  intendedUse: string;
  exclusions: string;
};

export type ProjectCreatePayload = JsonObject & {
  mode: "curriculum" | "free_topic";
  title: string;
  topic: string;
  purpose: string;
  curriculum_id: string | null;
  current_level: string;
  target_level: string;
  target_date: string | null;
  preferred_session_minutes: number;
  constraints: JsonObject & {
    prerequisites: string[];
    uses: string[];
    exclusions: string[];
  };
};

function optionalTextList(value: string): string[] {
  const text = value.trim();
  return text ? [text] : [];
}

export function buildProjectCreatePayload(draft: ProjectSetupDraft): ProjectCreatePayload {
  return {
    mode: draft.mode,
    title: draft.title.trim(),
    topic: draft.topic.trim(),
    purpose: draft.purpose.trim(),
    curriculum_id: draft.mode === "curriculum" ? draft.curriculumId : null,
    current_level: draft.currentLevel.trim(),
    target_level: draft.targetLevel.trim(),
    target_date: draft.targetDate?.trim() || null,
    preferred_session_minutes: draft.preferredSessionMinutes,
    constraints: {
      prerequisites: optionalTextList(draft.prerequisites),
      uses: optionalTextList(draft.intendedUse),
      exclusions: optionalTextList(draft.exclusions),
    },
  };
}
