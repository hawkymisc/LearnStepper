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

export function buildProjectCreatePayload(draft: ProjectSetupDraft): JsonObject {
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
      prerequisites: draft.prerequisites.trim(),
      intended_use: draft.intendedUse.trim(),
      exclusions: draft.exclusions.trim(),
    },
  };
}
