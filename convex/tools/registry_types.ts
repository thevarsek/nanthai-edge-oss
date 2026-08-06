import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { ToolDefinition } from "../lib/openrouter_types";
import type { AuthorizationSource } from "../execution/validators";
import type { ToolEffectPolicy } from "./effect_policy";

export interface ToolParameterSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolResult {
  success: boolean;
  data: unknown;
  artifactData?: unknown;
  error?: string;
  deferred?: ToolDeferredPayload;
}

export interface ToolDeferredPayload {
  kind:
    | "spawn_subagents"
    | "drive_picker"
    | "presentation_workflow"
    | "analytics_workflow"
    | "remote_mcp";
  data: unknown;
}

export interface PresentationToolContext {
  projectId: Id<"presentationProjects">;
  projectRevision: number;
  slideId?: string;
  slideRevision?: number;
  elementId?: string;
}

export interface ToolExecutionContext {
  ctx: ActionCtx;
  userId: string;
  chatId?: string;
  messageId?: string;
  userMessageId?: string;
  presentationContext?: PresentationToolContext;
  turnParticipantCount?: number;
  isIdeascapeTurn?: boolean;
  jobId?: string;
  executionAttemptId?: Id<"executionAttempts">;
  executionFence?: number;
  authorizationSource?: AuthorizationSource;
  toolCallId?: string;
  /** Stable across retries; provider adapters may use it as an idempotency key. */
  operationIdempotencyKey?: string;
  /** Stable transcript prefix for distinguishing intentional calls in later rounds. */
  operationScope?: string;
  generationKey?: string;
  modelId?: string;
  requireZdr?: boolean;
  /** Absolute provider cutoff inherited from the owning generation action. */
  providerDeadlineAtMs?: number;
  sandboxSessionId?: string;
  workspaceSandbox?: unknown;
  workspaceSandboxCleanup?: () => Promise<void>;
}

export interface ToolConfig {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
  effectPolicy?: ToolEffectPolicy;
  /** This tool may pause the generation behind one durable child operation. */
  mayDefer?: boolean;
  execute: (
    toolCtx: ToolExecutionContext,
    args: Record<string, unknown>,
  ) => Promise<ToolResult>;
}

export interface RegisteredTool {
  readonly name: string;
  readonly definition: ToolDefinition;
  readonly execute: ToolConfig["execute"];
  readonly effectPolicy: ToolEffectPolicy;
  readonly mayDefer: boolean;
}
