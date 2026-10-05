import { z } from "zod";
import {
  boundedString,
  DetailSchema,
  FenceSchema,
  IdentifierSchema,
  LabelSchema,
  MimeTypeSchema,
  RUNTIME_LIMITS,
  RUNTIME_PROTOCOL_VERSION,
  SequenceSchema,
  Sha256Schema,
  StructuredInputSchema,
  SummarySchema,
  TimestampSchema,
} from "./protocol_common";

export const AdapterEventTypeSchema = z.enum([
  "session_started", "text_delta", "reasoning_delta", "tool_started",
  "tool_progress", "tool_completed", "command_output", "evidence_observed",
  "permission_requested", "permission_resolved", "input_requested",
  "input_resolved", "artifact_created", "usage_reported", "model_observed",
  "native_agent_started", "native_agent_activity", "native_agent_status",
  "heartbeat", "terminal",
]);

export const ActualModelSchema = z.strictObject({
  provider: IdentifierSchema.nullable(),
  modelId: IdentifierSchema,
  reportedByAdapter: z.literal(true),
});

const eventBase = {
  protocolVersion: z.literal(RUNTIME_PROTOCOL_VERSION), eventId: IdentifierSchema,
  sequence: SequenceSchema, occurredAt: TimestampSchema, runId: IdentifierSchema,
  attemptId: IdentifierSchema, fence: FenceSchema, sessionId: IdentifierSchema,
};

const SessionStartedEventSchema = z.strictObject({
  ...eventBase, type: z.literal("session_started"), nativeSessionId: IdentifierSchema,
  resumed: z.boolean(), workingDirectory: boundedString(4_096),
  repository: z.strictObject({
    root: boundedString(4_096), revision: IdentifierSchema.nullable(),
  }).nullable(),
});

const TextDeltaEventSchema = z.strictObject({
  ...eventBase, type: z.literal("text_delta"), messageId: IdentifierSchema,
  delta: boundedString(RUNTIME_LIMITS.deltaCharacters),
});

const ReasoningDeltaEventSchema = z.strictObject({
  ...eventBase, type: z.literal("reasoning_delta"),
  delta: boundedString(RUNTIME_LIMITS.deltaCharacters),
});

const ToolStartedEventSchema = z.strictObject({
  ...eventBase, type: z.literal("tool_started"), toolCallId: IdentifierSchema,
  toolName: IdentifierSchema, summary: SummarySchema,
});

const ToolProgressEventSchema = z.strictObject({
  ...eventBase, type: z.literal("tool_progress"), toolCallId: IdentifierSchema,
  summary: SummarySchema, progress: z.number().min(0).max(1).nullable(),
});

const ToolCompletedEventSchema = z.strictObject({
  ...eventBase, type: z.literal("tool_completed"), toolCallId: IdentifierSchema,
  toolName: IdentifierSchema, outcome: z.enum(["completed", "failed", "cancelled"]),
  summary: SummarySchema,
  artifactIds: z.array(IdentifierSchema).max(RUNTIME_LIMITS.maxArtifacts),
});

const CommandOutputEventSchema = z.strictObject({
  ...eventBase, type: z.literal("command_output"),
  toolCallId: IdentifierSchema.nullable(), stream: z.enum(["stdout", "stderr"]),
  chunk: boundedString(RUNTIME_LIMITS.outputChunkCharacters), isFinalChunk: z.boolean(),
});

const EvidenceObservedEventSchema = z.strictObject({
  ...eventBase, type: z.literal("evidence_observed"),
  evidenceKind: z.enum(["file", "diff", "test"]), summary: SummarySchema,
  localPath: boundedString(4_096).nullable(),
  artifactIds: z.array(IdentifierSchema).max(RUNTIME_LIMITS.maxArtifacts),
});

export const PermissionDecisionSchema = z.enum([
  "allow_once", "allow_session", "deny", "cancel",
]);

const PermissionRequestedEventSchema = z.strictObject({
  ...eventBase, type: z.literal("permission_requested"),
  permissionRequestId: IdentifierSchema, toolCallId: IdentifierSchema.nullable(),
  nativeAgentThreadId: IdentifierSchema.nullable(),
  permissionKind: IdentifierSchema, prompt: DetailSchema,
  choices: z.array(PermissionDecisionSchema)
    .min(1).max(RUNTIME_LIMITS.maxPermissionChoices),
  expiresAt: TimestampSchema.nullable(),
});

const PermissionResolvedEventSchema = z.strictObject({
  ...eventBase, type: z.literal("permission_resolved"),
  permissionRequestId: IdentifierSchema, decision: PermissionDecisionSchema,
});

const InputRequestedEventSchema = z.strictObject({
  ...eventBase, type: z.literal("input_requested"), inputRequestId: IdentifierSchema,
  nativeAgentThreadId: IdentifierSchema.nullable(),
  source: z.enum(["request_user_input", "mcp_elicitation", "adapter_native"]),
  prompt: DetailSchema, requestSchema: StructuredInputSchema,
  sensitiveFieldPaths: z.array(boundedString(512))
    .max(RUNTIME_LIMITS.maxStructuredInputEntries),
});

const InputResolvedEventSchema = z.strictObject({
  ...eventBase, type: z.literal("input_resolved"), inputRequestId: IdentifierSchema,
  outcome: z.enum(["submitted", "cancelled"]),
});

const ArtifactCreatedEventSchema = z.strictObject({
  ...eventBase, type: z.literal("artifact_created"), artifactId: IdentifierSchema,
  artifactKind: IdentifierSchema, name: LabelSchema, mimeType: MimeTypeSchema,
  byteLength: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  sha256: Sha256Schema,
});

const CostSchema = z.discriminatedUnion("source", [
  z.strictObject({ source: z.literal("provider_reported"),
    amount: z.number().nonnegative().finite(), currency: z.string().regex(/^[A-Z]{3}$/) }),
  z.strictObject({ source: z.literal("api_equivalent_estimate"),
    amount: z.number().nonnegative().finite(), currency: z.string().regex(/^[A-Z]{3}$/),
    pricingVersion: IdentifierSchema }),
  z.strictObject({ source: z.literal("unpriced"), reason: SummarySchema }),
]);

const nullableTokenCount = z.number().int().nonnegative()
  .max(Number.MAX_SAFE_INTEGER).nullable();

const UsageReportedEventSchema = z.strictObject({
  ...eventBase, type: z.literal("usage_reported"),
  nativeAgentThreadId: IdentifierSchema.optional(),
  actualModel: ActualModelSchema.nullable(),
  tokens: z.strictObject({ input: nullableTokenCount, output: nullableTokenCount,
    cachedInput: nullableTokenCount, reasoning: nullableTokenCount, total: nullableTokenCount }),
  cost: CostSchema,
});

const ModelObservedEventSchema = z.strictObject({
  ...eventBase, type: z.literal("model_observed"), actualModel: ActualModelSchema,
  reason: z.enum(["initial", "reroute", "resume"]),
});

const NativeAgentStartedEventSchema = z.strictObject({
  ...eventBase, type: z.literal("native_agent_started"),
  nativeThreadId: IdentifierSchema, rootNativeThreadId: IdentifierSchema,
  parentNativeThreadId: IdentifierSchema.nullable(),
  depth: z.number().int().min(1).max(64), agentPath: LabelSchema.nullable(),
  nickname: LabelSchema.nullable(), role: LabelSchema.nullable(),
  prompt: DetailSchema.nullable(), actualModel: ActualModelSchema.nullable(),
  reasoningEffort: LabelSchema.nullable(),
});

const NativeAgentActivityEventSchema = z.strictObject({
  ...eventBase, type: z.literal("native_agent_activity"),
  nativeThreadId: IdentifierSchema, activityId: IdentifierSchema,
  kind: z.enum(["delegation", "message", "reasoning", "tool", "interaction"]),
  summary: SummarySchema,
});

const NativeAgentStatusEventSchema = z.strictObject({
  ...eventBase, type: z.literal("native_agent_status"),
  nativeThreadId: IdentifierSchema,
  status: z.enum([
    "pending", "running", "completed", "failed", "interrupted", "shutdown", "not_found",
  ]),
  summary: SummarySchema.nullable(), actualModel: ActualModelSchema.nullable(),
  reasoningEffort: LabelSchema.nullable(),
});

const HeartbeatEventSchema = z.strictObject({ ...eventBase, type: z.literal("heartbeat") });

export const TerminalAdapterEventSchema = z.strictObject({
  ...eventBase, type: z.literal("terminal"),
  outcome: z.enum(["completed", "failed", "cancelled", "interrupted"]),
  summary: SummarySchema, errorCode: IdentifierSchema.nullable(),
  checkpointRef: IdentifierSchema.nullable(),
  nativeTurnId: IdentifierSchema.nullable().optional(),
});

export const NonTerminalAdapterEventSchema = z.discriminatedUnion("type", [
  SessionStartedEventSchema, TextDeltaEventSchema, ReasoningDeltaEventSchema,
  ToolStartedEventSchema, ToolProgressEventSchema, ToolCompletedEventSchema,
  CommandOutputEventSchema, EvidenceObservedEventSchema,
  PermissionRequestedEventSchema, PermissionResolvedEventSchema,
  InputRequestedEventSchema, InputResolvedEventSchema, ArtifactCreatedEventSchema,
  UsageReportedEventSchema, ModelObservedEventSchema,
  NativeAgentStartedEventSchema, NativeAgentActivityEventSchema,
  NativeAgentStatusEventSchema, HeartbeatEventSchema,
]);

export const AdapterEventSchema = z.union([
  NonTerminalAdapterEventSchema, TerminalAdapterEventSchema,
]);

export type ActualModel = z.infer<typeof ActualModelSchema>;
export type PermissionDecision = z.infer<typeof PermissionDecisionSchema>;
export type AdapterEvent = z.infer<typeof AdapterEventSchema>;
export type NonTerminalAdapterEvent = z.infer<typeof NonTerminalAdapterEventSchema>;
export type TerminalAdapterEvent = z.infer<typeof TerminalAdapterEventSchema>;
