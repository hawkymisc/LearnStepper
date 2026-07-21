export type RuntimeSignals = {
  core: "available" | "unavailable" | "checking";
  database: "available" | "unavailable" | "checking";
  network: "online" | "offline" | "checking";
  codexCli: "available" | "missing" | "unsupported" | "checking";
  authentication: "authenticated" | "unauthenticated" | "error" | "checking";
  appServer: "available" | "unavailable" | "held" | "checking";
  grounding: "available" | "unavailable" | "held" | "checking";
  reconciliation: "idle" | "running" | "conflict";
};

export type CapabilityIssue =
  | "none"
  | "core"
  | "database"
  | "network"
  | "codex_cli"
  | "authentication"
  | "app_server"
  | "reconciliation";

export type Capabilities = {
  localRead: boolean;
  localWrite: boolean;
  conversation: boolean;
  groundingFetch: boolean;
  cachedSources: boolean;
  authentication: boolean;
  primaryIssue: CapabilityIssue;
};

export const DEFAULT_SIGNALS: RuntimeSignals = {
  core: "available",
  database: "available",
  network: "online",
  codexCli: "checking",
  authentication: "checking",
  appServer: "checking",
  grounding: "held",
  reconciliation: "idle",
};

export function deriveCapabilities(signals: RuntimeSignals): Capabilities {
  const localRead = signals.core === "available" && signals.database === "available";
  const localWrite = localRead;
  const authentication = signals.authentication === "authenticated";
  const conversation = localRead && signals.network === "online" && authentication && signals.appServer === "available";
  const groundingFetch = localRead && signals.network === "online" && signals.grounding === "available";
  const cachedSources = localRead;

  let primaryIssue: CapabilityIssue = "none";
  if (signals.core === "unavailable") primaryIssue = "core";
  else if (signals.database === "unavailable") primaryIssue = "database";
  else if (signals.reconciliation === "conflict") primaryIssue = "reconciliation";
  else if (signals.network === "offline") primaryIssue = "network";
  else if (signals.codexCli === "missing" || signals.codexCli === "unsupported") primaryIssue = "codex_cli";
  else if (signals.authentication === "unauthenticated") primaryIssue = "authentication";
  else if (signals.appServer === "unavailable") primaryIssue = "app_server";

  return { localRead, localWrite, conversation, groundingFetch, cachedSources, authentication, primaryIssue };
}
