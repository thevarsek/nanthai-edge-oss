import { ConvexError } from "convex/values";
import {
  makeFunctionReference,
  type FunctionReference,
} from "convex/server";
import {
  cancellationCategory,
  openRouterFailureCategory,
  openRouterUsageAnalyticsProperties,
} from "./event_properties";
import {
  analyticsClientProperties,
  type AnalyticsClientMetadata,
} from "./client_metadata";
import type {
  BackendAnalyticsEvent,
  PostHogProperties,
  PostHogProperty,
} from "./posthog";
import type { OpenRouterUsage } from "../lib/openrouter_types";

export type BackendAnalyticsSchedulingCtx = {
  scheduler: {
    runAfter: ActionCtxSchedulerRunAfter;
  };
};

type ActionCtxSchedulerRunAfter = (
  delayMs: number,
  fn: FunctionReference<"action", "internal", CaptureBackendEventArgs, null>,
  args: CaptureBackendEventArgs,
) => Promise<unknown>;

type ScheduledBackendAnalyticsProperties = Record<string, Exclude<PostHogProperty, undefined>>;
type CaptureBackendEventArgs = {
  distinctId: string;
  event: BackendAnalyticsEvent;
  properties: ScheduledBackendAnalyticsProperties;
};

const captureBackendEventRef = makeFunctionReference<
  "action",
  CaptureBackendEventArgs,
  null
>("analytics/actions:captureBackendEvent") as unknown as FunctionReference<
  "action",
  "internal",
  CaptureBackendEventArgs,
  null
>;

type BackendAIOperationCaptureArgs = {
  userId: string;
  operation: string;
  source?: string;
  chatId?: string;
  messageId?: string;
  jobId?: string;
  modelId?: string | null;
  durationMs?: number;
  usage?: OpenRouterUsage | null;
  openrouterGenerationId?: string | null;
  analytics?: AnalyticsClientMetadata;
  properties?: PostHogProperties;
};

type BackendAIOperationFailureCaptureArgs = BackendAIOperationCaptureArgs & {
  error?: unknown;
  cancelled?: boolean;
};

function scheduledBackendAnalyticsProperties(
  properties: PostHogProperties,
): ScheduledBackendAnalyticsProperties {
  const scheduled: ScheduledBackendAnalyticsProperties = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value !== undefined) {
      scheduled[key] = value;
    }
  }
  return scheduled;
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

function backendAIOperationProperties(
  args: BackendAIOperationCaptureArgs,
): PostHogProperties {
  return {
    operation: args.operation,
    source: args.source,
    chat_id: args.chatId,
    message_id: args.messageId,
    job_id: args.jobId,
    model_id: args.modelId ?? null,
    duration_ms: args.durationMs,
    openrouter_generation_id: args.openrouterGenerationId ?? null,
    ...openRouterUsageAnalyticsProperties(args.usage),
    ...analyticsClientProperties(args.analytics),
    ...args.properties,
  };
}

export async function scheduleBackendAnalytics(
  ctx: BackendAnalyticsSchedulingCtx,
  distinctId: string,
  event: BackendAnalyticsEvent,
  properties: PostHogProperties,
): Promise<void> {
  try {
    await ctx.scheduler.runAfter(0, captureBackendEventRef, {
      distinctId,
      event,
      properties: scheduledBackendAnalyticsProperties(properties),
    });
  } catch (error) {
    console.warn("[analytics] Failed to schedule backend analytics", {
      event,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function captureBackendAIOperationStarted(
  ctx: BackendAnalyticsSchedulingCtx,
  args: BackendAIOperationCaptureArgs,
): Promise<void> {
  await scheduleBackendAnalytics(ctx, args.userId, "backend_ai_operation_started", {
    ...backendAIOperationProperties(args),
    phase: "started",
  });
}

export async function captureBackendAIOperationCompleted(
  ctx: BackendAnalyticsSchedulingCtx,
  args: BackendAIOperationCaptureArgs,
): Promise<void> {
  await scheduleBackendAnalytics(ctx, args.userId, "backend_ai_operation_completed", {
    ...backendAIOperationProperties(args),
    phase: "completed",
  });
}

export async function captureBackendAIOperationFailed(
  ctx: BackendAnalyticsSchedulingCtx,
  args: BackendAIOperationFailureCaptureArgs,
): Promise<void> {
  await scheduleBackendAnalytics(ctx, args.userId, "backend_ai_operation_failed", {
    ...backendAIOperationProperties(args),
    phase: "failed",
    failure_category: args.cancelled === true
      ? "cancelled"
      : openRouterFailureCategory(args.error),
    cancellation_category: args.cancelled === true
      ? cancellationCategory({
        error: args.error,
        properties: args.properties,
        source: args.source,
      })
      : undefined,
    error_type: args.cancelled === true
      ? "cancelled"
      : args.error instanceof ConvexError
        ? "convex"
        : "generation_failed",
    error_label: args.cancelled === true ? "cancelled" : errorLabel(args.error),
  });
}
