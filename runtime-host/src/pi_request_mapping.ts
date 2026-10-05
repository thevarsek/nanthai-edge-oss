import type { AdapterEvent, PermissionDecision } from "./protocol.ts";
import type { CanonicalEventFactory } from "./canonical_event_factory.ts";
import type { PiRecord } from "./pi_rpc_client.ts";
import type { InputResponse } from "./worker_backend.ts";

export function piDialogEvent(record: PiRecord, events: CanonicalEventFactory): AdapterEvent | null {
  const prompt = [record.title, record.message].filter(value => typeof value === "string").join("\n").slice(0, 4000) || "Pi requested input";
  if (record.method === "confirm") return events.create({
    type: "permission_requested", permissionRequestId: record.id, toolCallId: null,
    nativeAgentThreadId: null, permissionKind: "pi_confirmation", prompt,
    choices: ["allow_once", "deny", "cancel"],
    expiresAt: typeof record.timeout === "number" ? Date.now() + record.timeout : null,
  });
  if (!["select", "input", "editor"].includes(String(record.method))) return null;
  return events.create({
    type: "input_requested", inputRequestId: record.id, nativeAgentThreadId: null,
    source: "adapter_native", prompt,
    requestSchema: { requestedSchema: { type: "object", properties: { value: {
      type: "string", title: prompt,
      ...(record.method === "select" ? { enum: record.options } : {}),
    } }, required: ["value"] }, isBlocking: true }, sensitiveFieldPaths: [],
  });
}

export function piInputResponse(id: string, response: InputResponse, request: PiRecord): PiRecord {
  if (response.outcome === "cancelled") return { type: "extension_ui_response", id, cancelled: true };
  const value = response.content.value;
  if (typeof value !== "string") throw new Error("Pi requires a text answer");
  if (request.method === "select" && (!Array.isArray(request.options) || !request.options.includes(value))) {
    throw new Error("Pi answer is outside the requested options");
  }
  return { type: "extension_ui_response", id, value };
}

export function piPermissionResponse(id: string, decision: PermissionDecision): PiRecord {
  if (decision === "allow_session") throw new Error("Pi confirmation does not offer session approval");
  return decision === "cancel" ? { type: "extension_ui_response", id, cancelled: true }
    : { type: "extension_ui_response", id, confirmed: decision === "allow_once" };
}
