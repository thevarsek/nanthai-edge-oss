import { type Infer, v } from "convex/values";

export const executionRunKind = v.union(
  v.literal("chat_generation"),
  v.literal("research"),
  v.literal("scheduled_job"),
  v.literal("advisor"),
  v.literal("subagent"),
  v.literal("presentation"),
  v.literal("autonomous_chat"),
  v.literal("media"),
  v.literal("document"),
  v.literal("analytics"),
  v.literal("maintenance"),
  v.literal("local_runtime"),
  v.literal("remote_mcp"),
  v.literal("collaboration"),
);

export const executionRunState = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("waiting"),
  v.literal("waiting_for_input"),
  v.literal("waiting_for_permission"),
  v.literal("interrupted"),
  v.literal("cancelling"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled"),
);

export const executionAttemptState = v.union(
  v.literal("queued"),
  v.literal("claimed"),
  v.literal("running"),
  v.literal("waiting"),
  v.literal("interrupted"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled"),
  v.literal("superseded"),
);

export const executorKind = v.union(
  v.literal("convex_action"),
  v.literal("convex_workflow"),
  v.literal("external_cloud"),
  v.literal("local_runtime"),
);

export const executionPlacement = v.union(
  v.literal("cloud"),
  v.literal("local"),
);

export const runtimeCommandType = v.union(
  v.literal("start"),
  v.literal("prompt"),
  v.literal("steer"),
  v.literal("cancel"),
  v.literal("resume"),
  v.literal("interrupt"),
  v.literal("permission_response"),
  v.literal("shutdown"),
);

export const runtimeCommandStatus = v.union(
  v.literal("pending"),
  v.literal("acknowledged"),
  v.literal("completed"),
  v.literal("rejected"),
  v.literal("expired"),
);

export const authorizationSource = v.union(
  v.literal("explicit_user_turn"),
  v.literal("configured_automation"),
  v.literal("runtime_policy"),
  v.literal("interactive_confirmation"),
);

export const runEventType = v.union(
  v.literal("created"),
  v.literal("claimed"),
  v.literal("started"),
  v.literal("heartbeat"),
  v.literal("model_activity"),
  v.literal("tool_activity"),
  v.literal("artifact_created"),
  v.literal("waiting"),
  v.literal("waiting_for_input"),
  v.literal("waiting_for_permission"),
  v.literal("interrupted"),
  v.literal("cancel_requested"),
  v.literal("cancel_acknowledged"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled"),
  v.literal("superseded"),
);

export const toolEffect = v.union(
  v.literal("read"),
  v.literal("write"),
  v.literal("destructive"),
);

export const toolRetryPolicy = v.union(
  v.literal("safe"),
  v.literal("idempotency_key_required"),
  v.literal("never"),
);

export const executionOperationStatus = v.union(
  v.literal("prepared"),
  v.literal("dispatching"),
  v.literal("succeeded"),
  v.literal("failed_before_dispatch"),
  v.literal("outcome_unknown"),
  v.literal("reconciled"),
  v.literal("cancelled"),
);

export const executionTerminalOutcome = v.union(
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled"),
  v.literal("interrupted"),
);

export const executionComponentAdapter = v.union(
  v.literal("convex-workflow"),
  v.literal("interactive-workpool"),
  v.literal("background-workpool"),
  v.literal("maintenance-workpool"),
  v.literal("external-cloud"),
  v.literal("local-runtime"),
);

export const executionComponentStatus = v.union(
  v.literal("active"),
  v.literal("completed"),
  v.literal("cancel_requested"),
  v.literal("cancelled"),
  v.literal("failed"),
);

export const runtimeBindingStatus = v.union(
  v.literal("active"),
  v.literal("released"),
  v.literal("revoked"),
);

export const TERMINAL_RUN_STATES = new Set([
  "completed",
  "failed",
  "cancelled",
] as const);

export const TERMINAL_ATTEMPT_STATES = new Set([
  "completed",
  "failed",
  "cancelled",
  "superseded",
] as const);

export type ExecutionRunState = Infer<typeof executionRunState>;
export type ExecutionRunKind = Infer<typeof executionRunKind>;
export type ExecutionAttemptState = Infer<typeof executionAttemptState>;
export type ExecutorKind = Infer<typeof executorKind>;
export type ExecutionPlacement = Infer<typeof executionPlacement>;
export type RunEventType = Infer<typeof runEventType>;
export type ToolEffect = Infer<typeof toolEffect>;
export type ToolRetryPolicy = Infer<typeof toolRetryPolicy>;
export type AuthorizationSource = Infer<typeof authorizationSource>;
export type ExecutionComponentAdapter = Infer<typeof executionComponentAdapter>;
export type ExecutionComponentStatus = Infer<typeof executionComponentStatus>;
