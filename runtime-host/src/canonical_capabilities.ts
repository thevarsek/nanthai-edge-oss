import type { AdapterCapabilities } from "./protocol.ts";
import { AdapterCapabilitiesSchema } from "./protocol.ts";
import type {
  CodexInputModality,
  CodexTransportCapabilities,
} from "./codex_transport.ts";
import { CODEX_CLI_PACKAGE_VERSION } from "./runtime_identity.ts";

export function canonicalCodexCapabilities(
  capability: CodexTransportCapabilities,
): AdapterCapabilities {
  const inputModalities = canonicalInputModalities(capability.inputModalities);
  return AdapterCapabilitiesSchema.parse({
    protocolVersion: "nanthai.runtime.v1",
    adapterId: "codex",
    adapterVersion: CODEX_CLI_PACKAGE_VERSION,
    transport: "stdio_jsonrpc",
    inputModalities,
    eventTypes: [
        "session_started", "text_delta", "reasoning_delta", "tool_started",
        "tool_progress", "tool_completed", "command_output", "evidence_observed",
        "permission_requested", "permission_resolved", "input_requested",
        "input_resolved", "usage_reported", "model_observed", "terminal",
        "native_agent_started", "native_agent_activity", "native_agent_status",
      ],
    operations: {
      listModels: capability.operations.includes("list_models"),
      cancel: capability.operations.includes("cancel"),
      resume: capability.operations.includes("resume"),
      permissionResponse: capability.operations.includes("respond_to_approval"),
      inputResponse:
        capability.operations.includes("respond_to_structured_input") &&
        capability.operations.includes("respond_to_mcp_elicitation"),
    },
    adapterNative: {
      tools: true,
      plugins: capability.operations.includes("plugins"),
      mcpServers: capability.operations.includes("mcp"),
      skills: true,
      webSearch: capability.operations.includes("web_search"),
    },
  });
}

function canonicalInputModalities(
  modalities: readonly CodexInputModality[],
): Array<"text" | "image" | "audio" | "video" | "document"> {
  const result = new Set<"text" | "image" | "audio" | "video" | "document">();
  for (const modality of modalities) {
    if (modality === "text") result.add("text");
    if (modality === "local_image" || modality === "remote_image") result.add("image");
    if (modality === "local_audio" || modality === "remote_audio") result.add("audio");
    if (modality === "video") result.add("video");
    if (modality === "document") result.add("document");
  }
  return [...result];
}
