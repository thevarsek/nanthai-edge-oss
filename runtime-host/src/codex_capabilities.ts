import type {
  CodexEventFeature,
  CodexInputModality,
  CodexOperation,
  CodexTransportCapabilities,
  CodexTransportName,
} from "./codex_transport.ts";

export const APP_SERVER_CAPABILITIES = Object.freeze({
  transport: "app_server_stdio",
  inputModalities: [
    "text",
    "local_image",
    "remote_image",
  ],
  events: [
    "item_lifecycle",
    "text_delta",
    "reasoning_delta",
    "tool_progress",
    "command_output_delta",
    "diff_delta",
    "approval_request",
    "usage",
    "model_reroute",
    "native_agent_activity",
  ],
  operations: [
    "cancel",
    "resume",
    "respond_to_approval",
    "respond_to_structured_input",
    "respond_to_mcp_elicitation",
    "list_models",
    "account_usage",
    "mcp",
    "plugins",
    "web_search",
  ],
} satisfies CodexTransportCapabilities);

export type CodexRequirements = {
  inputModalities?: readonly CodexInputModality[];
  events?: readonly CodexEventFeature[];
  operations?: readonly CodexOperation[];
  preferredTransport?: CodexTransportName;
};

export class CodexCapabilityPreflightError extends Error {
  constructor(readonly diagnostics: readonly string[]) {
    super(`No Codex transport satisfies the turn: ${diagnostics.join("; ")}`);
    this.name = "CodexCapabilityPreflightError";
  }
}

export function selectCodexTransport(
  requirements: CodexRequirements,
  available: readonly CodexTransportCapabilities[] = [APP_SERVER_CAPABILITIES],
): CodexTransportName {
  const name = requirements.preferredTransport ?? "app_server_stdio";
  const capability = available.find((entry) => entry.transport === name);
  if (!capability) throw new CodexCapabilityPreflightError([`${name} is unavailable`]);
  const missing = missingCapabilities(capability, requirements);
  if (missing.length) throw new CodexCapabilityPreflightError([`${name} lacks ${missing.join(", ")}`]);
  return name;
}

function missingCapabilities(
  capability: CodexTransportCapabilities,
  requirements: CodexRequirements,
): string[] {
  const missing: string[] = [];
  appendMissing("input", capability.inputModalities, requirements.inputModalities, missing);
  appendMissing("event", capability.events, requirements.events, missing);
  appendMissing("operation", capability.operations, requirements.operations, missing);
  return missing;
}

function appendMissing(
  prefix: string,
  available: readonly string[],
  required: readonly string[] | undefined,
  output: string[],
): void {
  for (const value of required ?? []) {
    if (!available.includes(value)) {
      output.push(`${prefix}:${value}`);
    }
  }
}
