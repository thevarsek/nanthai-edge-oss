import { ConvexError } from "convex/values";
import {
  scheduleBackendAnalytics,
  type BackendAnalyticsSchedulingCtx,
} from "../analytics/backend_events";
import {
  analyticsClientProperties,
  type AnalyticsClientMetadata,
} from "../analytics/client_metadata";
import {
  cancellationCategory,
  openRouterFailureCategory,
  openRouterUsageAnalyticsProperties,
  type OpenRouterFailureCategory,
  type CancellationCategory,
} from "../analytics/event_properties";
import type { OpenRouterUsage } from "../lib/openrouter_types";
import type {
  GenerationContinuationState,
  RunGenerationParticipantArgs,
} from "./generation_continuation_shared";

type AssistantResponseSource =
  | "chat_generation"
  | "autonomous_discussion"
  | "subagent_child"
  | "subagent_parent_resume"
  | "web_search"
  | "research_paper"
  | "scheduled_job"
  | "video_generation";

type ContinuationAnalyticsState = Pick<GenerationContinuationState, "assembledCheckpoint"> | null;

type AssistantResponseAnalyticsResult = {
  continued: boolean;
  failed: boolean;
  cancelled: boolean;
  deferredForSubagents: boolean;
  generationId?: string | null;
  usage?: OpenRouterUsage | null;
  latencies?: Record<string, number | undefined>;
  error?: unknown;
};

type AssistantResponseFailureCaptureArgs = {
  userId: string;
  chatId: string;
  messageId: string;
  jobId: string;
  modelId?: string | null;
  source: AssistantResponseSource;
  error?: unknown;
  cancelled?: boolean;
  analytics?: AnalyticsClientMetadata;
  durationMs?: number;
  properties?: Record<string, string | number | boolean | null | undefined>;
};

type AssistantResponseStartedCaptureArgs = {
  userId: string;
  chatId: string;
  messageId: string;
  jobId: string;
  modelId?: string | null;
  source: AssistantResponseSource;
  analytics?: AnalyticsClientMetadata;
  participantCount?: number;
  webSearchEnabled?: boolean;
  integrationCount?: number;
  subagentsEnabled?: boolean;
  isResume?: boolean;
  schedulerHop2Ms?: number | null;
  properties?: Record<string, string | number | boolean | null | undefined>;
};

type AssistantResponseCompletionCaptureArgs = {
  userId: string;
  chatId: string;
  messageId: string;
  jobId: string;
  modelId?: string | null;
  source: AssistantResponseSource;
  usage?: OpenRouterUsage | null;
  analytics?: AnalyticsClientMetadata;
  durationMs?: number;
  participantCount?: number;
  openrouterGenerationId?: string | null;
  latencies?: Record<string, number | undefined>;
  properties?: Record<string, string | number | boolean | null | undefined>;
};

type AssistantResponseContinuedCaptureArgs = {
  userId: string;
  chatId: string;
  messageId: string;
  jobId: string;
  modelId?: string | null;
  source: AssistantResponseSource;
  usage?: OpenRouterUsage | null;
  analytics?: AnalyticsClientMetadata;
  participantCount?: number;
  openrouterGenerationId?: string | null;
  latencies?: Record<string, number | undefined>;
  properties?: Record<string, string | number | boolean | null | undefined>;
};

export function assistantResponseFailureDetails(
  result: Pick<AssistantResponseAnalyticsResult, "cancelled" | "error"> & {
    properties?: Record<string, unknown>;
    source?: string;
  },
): {
  failure_category: OpenRouterFailureCategory;
  cancellation_category?: CancellationCategory;
  error_type: string;
  error_label: string;
} {
  if (result.cancelled) {
    return {
      failure_category: "cancelled",
      cancellation_category: cancellationCategory({
        error: result.error,
        properties: result.properties,
        source: result.source,
      }),
      error_type: "cancelled",
      error_label: "cancelled",
    };
  }

  if (result.error !== undefined) {
    return {
      failure_category: openRouterFailureCategory(result.error),
      error_type: result.error instanceof ConvexError ? "convex" : "generation_failed",
      error_label: errorLabel(result.error),
    };
  }

  return {
    failure_category: "provider_error",
    error_type: "generation_failed",
    error_label: "generation_failed",
  };
}

function assistantResponseSource(
  args: RunGenerationParticipantArgs,
  continuationState: ContinuationAnalyticsState,
): AssistantResponseSource {
  return continuationState?.assembledCheckpoint?.runtimeKind
    ?? args.analyticsSource
    ?? (args.subagentBatchId ? "subagent_parent_resume" : "chat_generation");
}

function errorLabel(error: unknown): string {
  if (error instanceof ConvexError) {
    const data = error.data;
    if (data && typeof data === "object") {
      const code = (data as { code?: unknown }).code;
      if (typeof code === "string" && code.trim().length > 0) {
        return code.toLowerCase();
      }
    }
    return "convex_error";
  }

  if (error instanceof Error && error.name.trim().length > 0) {
    return error.name.toLowerCase();
  }

  return "unknown_error";
}

export async function captureAssistantResponseStarted(
  ctx: BackendAnalyticsSchedulingCtx,
  args: RunGenerationParticipantArgs,
  options: { isResume: boolean; schedulerHop2Ms: number | null },
): Promise<void> {
  await scheduleBackendAnalytics(ctx, args.userId, "assistant_response_started", {
    chat_id: String(args.chatId),
    message_id: String(args.participant.messageId),
    job_id: String(args.participant.jobId),
    model_id: args.participant.modelId,
    participant_count: args.assistantMessageIds.length,
    source: assistantResponseSource(args, null),
    web_search_enabled: args.webSearchEnabled === true,
    integration_count: args.effectiveIntegrations.length,
    subagents_enabled: args.allowSubagents === true,
    is_resume: options.isResume,
    scheduler_hop_2_ms: options.schedulerHop2Ms,
    ...analyticsClientProperties(args.analytics),
  });
}

export async function captureAssistantResponseStartedEvent(
  ctx: BackendAnalyticsSchedulingCtx,
  args: AssistantResponseStartedCaptureArgs,
): Promise<void> {
  await scheduleBackendAnalytics(ctx, args.userId, "assistant_response_started", {
    chat_id: args.chatId,
    message_id: args.messageId,
    job_id: args.jobId,
    model_id: args.modelId ?? null,
    participant_count: args.participantCount ?? null,
    source: args.source,
    web_search_enabled: args.webSearchEnabled === true,
    integration_count: args.integrationCount ?? null,
    subagents_enabled: args.subagentsEnabled === true,
    is_resume: args.isResume === true,
    scheduler_hop_2_ms: args.schedulerHop2Ms ?? null,
    ...args.properties,
    ...analyticsClientProperties(args.analytics),
  });
}

export async function captureVideoGenerationRequested(
  ctx: BackendAnalyticsSchedulingCtx,
  args: RunGenerationParticipantArgs,
): Promise<void> {
  await scheduleBackendAnalytics(ctx, args.userId, "video_generation_requested", {
    chat_id: String(args.chatId),
    message_id: String(args.participant.messageId),
    job_id: String(args.participant.jobId),
    model_id: args.participant.modelId,
    ...analyticsClientProperties(args.analytics),
  });
}

export async function captureAssistantResponseTerminal(
  ctx: BackendAnalyticsSchedulingCtx,
  args: RunGenerationParticipantArgs,
  continuationState: ContinuationAnalyticsState,
  result: AssistantResponseAnalyticsResult,
  durationMs: number,
): Promise<void> {
  if (result.continued) {
    await scheduleBackendAnalytics(ctx, args.userId, "message_continued", {
      chat_id: String(args.chatId),
      message_id: String(args.participant.messageId),
      job_id: String(args.participant.jobId),
      model_id: args.participant.modelId,
      participant_count: args.assistantMessageIds.length,
      source: assistantResponseSource(args, continuationState),
      openrouter_generation_id: result.generationId ?? null,
      ...openRouterUsageAnalyticsProperties(result.usage),
      ...result.latencies,
      ...analyticsClientProperties(args.analytics),
    });
  }

  if (result.deferredForSubagents && !result.continued) {
    await scheduleBackendAnalytics(ctx, args.userId, "message_continued", {
      chat_id: String(args.chatId),
      message_id: String(args.participant.messageId),
      job_id: String(args.participant.jobId),
      model_id: args.participant.modelId,
      participant_count: args.assistantMessageIds.length,
      source: assistantResponseSource(args, continuationState),
      openrouter_generation_id: result.generationId ?? null,
      deferred_for_subagents: true,
      duration_ms: durationMs,
      ...openRouterUsageAnalyticsProperties(result.usage),
      ...result.latencies,
      ...analyticsClientProperties(args.analytics),
    });
  }

  if ((result.failed || result.cancelled) && !result.deferredForSubagents && !result.continued) {
    await scheduleBackendAnalytics(ctx, args.userId, "assistant_response_failed", {
      chat_id: String(args.chatId),
      message_id: String(args.participant.messageId),
      job_id: String(args.participant.jobId),
      model_id: args.participant.modelId,
      source: assistantResponseSource(args, continuationState),
      duration_ms: durationMs,
      ...assistantResponseFailureDetails({
        ...result,
        source: assistantResponseSource(args, continuationState),
      }),
      ...result.latencies,
      ...analyticsClientProperties(args.analytics),
    });
  }

  if (!result.failed && !result.cancelled && !result.deferredForSubagents && !result.continued) {
    await scheduleBackendAnalytics(ctx, args.userId, "assistant_response_completed", {
      chat_id: String(args.chatId),
      message_id: String(args.participant.messageId),
      job_id: String(args.participant.jobId),
      model_id: args.participant.modelId,
      participant_count: args.assistantMessageIds.length,
      web_search_enabled: args.webSearchEnabled === true,
      integration_count: args.effectiveIntegrations.length,
      subagents_enabled: args.allowSubagents === true,
      continued: false,
      source: assistantResponseSource(args, continuationState),
      openrouter_generation_id: result.generationId ?? null,
      duration_ms: durationMs,
      ...openRouterUsageAnalyticsProperties(result.usage),
      ...result.latencies,
      ...analyticsClientProperties(args.analytics),
    });
  }
}

export async function captureAssistantResponseThrown(
  ctx: BackendAnalyticsSchedulingCtx,
  args: RunGenerationParticipantArgs,
  error: unknown,
): Promise<void> {
  await scheduleBackendAnalytics(ctx, args.userId, "assistant_response_failed", {
    chat_id: String(args.chatId),
    message_id: String(args.participant.messageId),
    job_id: String(args.participant.jobId),
    model_id: args.participant.modelId,
    source: assistantResponseSource(args, null),
    error_type: error instanceof ConvexError ? "convex" : "unknown",
    failure_category: openRouterFailureCategory(error),
    error_label: errorLabel(error),
    ...analyticsClientProperties(args.analytics),
  });
}

export async function captureAssistantResponseFailure(
  ctx: BackendAnalyticsSchedulingCtx,
  args: AssistantResponseFailureCaptureArgs,
): Promise<void> {
  await scheduleBackendAnalytics(ctx, args.userId, "assistant_response_failed", {
    chat_id: args.chatId,
    message_id: args.messageId,
    job_id: args.jobId,
    model_id: args.modelId ?? null,
    source: args.source,
    duration_ms: args.durationMs ?? null,
    ...assistantResponseFailureDetails({
      cancelled: args.cancelled === true,
      error: args.error,
      properties: args.properties,
      source: args.source,
    }),
    ...args.properties,
    ...analyticsClientProperties(args.analytics),
  });
}

export async function captureAssistantResponseCompleted(
  ctx: BackendAnalyticsSchedulingCtx,
  args: AssistantResponseCompletionCaptureArgs,
): Promise<void> {
  await scheduleBackendAnalytics(ctx, args.userId, "assistant_response_completed", {
    chat_id: args.chatId,
    message_id: args.messageId,
    job_id: args.jobId,
    model_id: args.modelId ?? null,
    source: args.source,
    participant_count: args.participantCount ?? null,
    openrouter_generation_id: args.openrouterGenerationId ?? null,
    duration_ms: args.durationMs ?? null,
    ...openRouterUsageAnalyticsProperties(args.usage),
    ...args.latencies,
    ...args.properties,
    ...analyticsClientProperties(args.analytics),
  });
}

export async function captureAssistantResponseContinued(
  ctx: BackendAnalyticsSchedulingCtx,
  args: AssistantResponseContinuedCaptureArgs,
): Promise<void> {
  await scheduleBackendAnalytics(ctx, args.userId, "message_continued", {
    chat_id: args.chatId,
    message_id: args.messageId,
    job_id: args.jobId,
    model_id: args.modelId ?? null,
    participant_count: args.participantCount ?? null,
    source: args.source,
    openrouter_generation_id: args.openrouterGenerationId ?? null,
    ...openRouterUsageAnalyticsProperties(args.usage),
    ...args.latencies,
    ...args.properties,
    ...analyticsClientProperties(args.analytics),
  });
}
