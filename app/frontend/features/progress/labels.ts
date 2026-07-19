const LABELS: Record<string, string> = {
  planned: "計画に含まれる",
  learning: "学習中",
  mastered: "検証済み証拠により習得",
  insufficient_evidence: "証拠不足",
};

export function curriculumProgressLabel(status: string): string {
  return LABELS[status] ?? "状態未確認";
}
