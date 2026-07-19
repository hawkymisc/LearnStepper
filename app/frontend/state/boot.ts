type Entity = { id: string };

export type BootSnapshot = {
  coreReady: boolean;
  profile: Entity | null;
  projects: Entity[] | null;
  error: string | null;
};

export type BootDestination = "loading" | "profile" | "empty" | "ready" | "recovery";

export function deriveBootDestination(snapshot: BootSnapshot): BootDestination {
  if (snapshot.error || !snapshot.coreReady) return "recovery";
  if (!snapshot.profile) return "profile";
  if (!snapshot.projects) return "loading";
  return snapshot.projects.length === 0 ? "empty" : "ready";
}
