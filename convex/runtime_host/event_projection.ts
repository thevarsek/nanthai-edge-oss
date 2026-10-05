import { z } from "zod";
import {
  type AdapterEvent,
  AdapterEventSchema,
} from "./protocol_adapter";
import {
  IdentifierSchema,
  RUNTIME_LIMITS,
  SummarySchema,
} from "./protocol_common";

const M46RunEventTypeSchema = z.enum([
  "started",
  "model_activity",
  "tool_activity",
  "artifact_created",
  "waiting_for_input",
  "waiting_for_permission",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

export const M46RunEventProjectionSchema = z.strictObject({
  eventId: IdentifierSchema,
  type: M46RunEventTypeSchema,
  summary: SummarySchema,
  phase: z.string().min(1).max(200).optional(),
  progress: z.number().min(0).max(1).optional(),
  artifactIds: z.array(IdentifierSchema).max(RUNTIME_LIMITS.maxArtifacts).optional(),
  privacyClass: z.literal("runtime_summary"),
  adapterDetail: z.string().min(2).max(RUNTIME_LIMITS.detailCharacters).optional(),
});

export type M46RunEventProjection = z.infer<typeof M46RunEventProjectionSchema>;

function projection(
  event: AdapterEvent,
  type: z.infer<typeof M46RunEventTypeSchema>,
  summary: string,
  detail: Record<string, unknown>,
  extras: Pick<M46RunEventProjection, "phase" | "progress" | "artifactIds"> = {},
): M46RunEventProjection {
  const adapterDetail = boundedJson(detail);
  return M46RunEventProjectionSchema.parse({
    eventId: event.eventId,
    type,
    summary: truncateUnicodeSafe(summary, RUNTIME_LIMITS.summaryCharacters),
    privacyClass: "runtime_summary",
    adapterDetail,
    ...extras,
  });
}

function truncateUnicodeSafe(value: string, maximumCodeUnits: number): string {
  let codeUnits = 0;
  let result = "";
  for (const character of value) {
    if (codeUnits + character.length > maximumCodeUnits) break;
    result += character;
    codeUnits += character.length;
  }
  return result;
}

function boundedJson(detail: Record<string, unknown>): string {
  const serialized = JSON.stringify(detail);
  if (serialized.length <= RUNTIME_LIMITS.detailCharacters) return serialized;
  const preview = truncateUnicodeSafe(serialized, 512);
  const fallback = JSON.stringify({
    truncated: true,
    keys: Object.keys(detail).sort(),
    preview,
  });
  if (fallback.length <= RUNTIME_LIMITS.detailCharacters) return fallback;
  return JSON.stringify({ truncated: true });
}

export function projectConsequentialAdapterEvent(
  input: AdapterEvent | unknown,
): M46RunEventProjection | null {
  const event = AdapterEventSchema.parse(input);
  switch (event.type) {
    case "text_delta":
    case "reasoning_delta":
    case "command_output":
    case "tool_progress":
    case "heartbeat":
      return null;
    case "session_started":
      return projection(event, "started", "Local runtime session started", {
        resumed: event.resumed,
      });
    case "tool_started":
      return projection(event, "tool_activity", event.summary, {
        lifecycle: "started",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
      });
    case "tool_completed":
      return projection(event, "tool_activity", event.summary, {
        lifecycle: "completed",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        outcome: event.outcome,
      }, { artifactIds: event.artifactIds });
    case "evidence_observed": {
      const type = event.artifactIds.length > 0 ? "artifact_created" : "tool_activity";
      return projection(event, type, event.summary, {
        evidenceKind: event.evidenceKind,
      }, { artifactIds: event.artifactIds });
    }
    case "permission_requested":
      return projection(event, "waiting_for_permission", event.prompt, {
        permissionRequestId: event.permissionRequestId,
        nativeAgentThreadId: event.nativeAgentThreadId,
        toolCallId: event.toolCallId,
        permissionKind: event.permissionKind,
        prompt: event.prompt,
        choices: event.choices,
        expiresAt: event.expiresAt,
      });
    case "permission_resolved":
      return projection(event, "model_activity", "Runtime permission request resolved", {
        permissionRequestId: event.permissionRequestId,
        decision: event.decision,
      });
    case "input_requested":
      return projection(event, "waiting_for_input", event.prompt, {
        inputRequestId: event.inputRequestId,
        nativeAgentThreadId: event.nativeAgentThreadId,
        source: event.source,
        requestSchemaKeys: Object.keys(event.requestSchema).sort(),
        sensitiveFieldCount: event.sensitiveFieldPaths.length,
        contentRedacted: true,
      });
    case "input_resolved":
      return projection(
        event,
        "model_activity",
        event.outcome === "submitted"
          ? "Structured input submitted"
          : "Structured input cancelled",
        {
          inputRequestId: event.inputRequestId,
          outcome: event.outcome,
          contentRedacted: true,
        },
      );
    case "artifact_created":
      return projection(event, "artifact_created", `Created ${event.name}`, {
        artifactId: event.artifactId,
        artifactKind: event.artifactKind,
        mimeType: event.mimeType,
        byteLength: event.byteLength,
        sha256: event.sha256,
      }, { artifactIds: [event.artifactId] });
    case "usage_reported":
      return projection(event, "model_activity", "Runtime usage reported", {
        actualModel: event.actualModel,
        modelAttribution: event.actualModel === null
          ? "unavailable"
          : "adapter_reported",
        tokens: event.tokens,
        cost: event.cost,
      });
    case "model_observed":
      return projection(event, "model_activity", "Runtime model observed", {
        actualModel: event.actualModel,
        reason: event.reason,
      });
    case "native_agent_started":
      return projection(event, "model_activity", "Codex started a native agent", {
        nativeThreadId: event.nativeThreadId,
        parentNativeThreadId: event.parentNativeThreadId,
        depth: event.depth,
        nickname: event.nickname,
        role: event.role,
        lifecycle: "started",
      });
    case "native_agent_activity":
      return null;
    case "native_agent_status":
      if (event.status === "pending" || event.status === "running") return null;
      return projection(
        event,
        "model_activity",
        event.summary ?? `Codex native agent ${event.status}`,
        {
          nativeThreadId: event.nativeThreadId,
          status: event.status,
          lifecycle: "terminal",
        },
      );
    case "terminal":
      return projection(event, event.outcome, event.summary, {
        errorCode: event.errorCode,
        checkpointRef: event.checkpointRef,
        nativeTurnId: event.nativeTurnId ?? null,
      });
  }
}
