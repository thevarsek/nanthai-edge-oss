import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import {
  parseBearerToken,
  SCHEDULED_TRIGGER_TOKEN_PREFIX,
  sha256Hex,
} from "./trigger_auth";

const API_TRIGGER_COOLDOWN_MS = 5_000;

function normalizeVariables(
  raw: unknown,
): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }

  const entries = Object.entries(raw as Record<string, unknown>);
  const normalized: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (!key.trim()) continue;
    if (typeof value === "string") {
      normalized[key] = value;
      continue;
    }
    if (
      typeof value === "number"
      || typeof value === "boolean"
      || value === null
    ) {
      normalized[key] = String(value);
      continue;
    }
    normalized[key] = JSON.stringify(value);
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export const triggerScheduledJob = httpAction(async (ctx, request) => {
  const requestId = crypto.randomUUID();
  const idempotencyKey = request.headers.get("Idempotency-Key") ?? undefined;
  const authHeader = request.headers.get("Authorization");
  const bearerToken = parseBearerToken(authHeader);

  let body: {
    jobId?: string;
    variables?: unknown;
  };
  try {
    body = (await request.json()) as {
      jobId?: string;
      variables?: unknown;
    };
  } catch {
    return new Response(JSON.stringify({
      error: "Invalid JSON body",
      requestId,
    }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  if (!body.jobId || typeof body.jobId !== "string") {
    return new Response(JSON.stringify({
      error: "Missing required field: jobId",
      requestId,
    }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const jobId = body.jobId as Id<"scheduledJobs">;
  const job = await ctx.runQuery(internal.scheduledJobs.queries.getJobInternal, { jobId });
  if (!job) {
    return new Response(JSON.stringify({
      error: "Scheduled job not found",
      requestId,
    }), { status: 404, headers: { "Content-Type": "application/json" } });
  }

  const variables = normalizeVariables(body.variables);

  let authorizedUserId: string | null = null;
  let tokenId: Id<"scheduledJobTriggerTokens"> | undefined;

  if (bearerToken?.startsWith(SCHEDULED_TRIGGER_TOKEN_PREFIX)) {
    const tokenHash = await sha256Hex(bearerToken);
    const token = await ctx.runQuery(
      internal.scheduledJobs.queries.getActiveTriggerTokenByHash,
      { tokenHash },
    );
    if (!token || token.jobId !== jobId) {
      await ctx.runMutation(internal.scheduledJobs.mutations.logApiInvocation, {
        userId: job.userId,
        jobId,
        requestId,
        idempotencyKey,
        status: "unauthorized",
        variables,
        note: "Invalid or mismatched trigger token",
      });
      return new Response(JSON.stringify({
        error: "Unauthorized",
        requestId,
      }), { status: 401, headers: { "Content-Type": "application/json" } });
    }
    if (token.userId !== job.userId) {
      await ctx.runMutation(internal.scheduledJobs.mutations.logApiInvocation, {
        userId: job.userId,
        jobId,
        requestId,
        idempotencyKey,
        status: "unauthorized",
        variables,
        note: "Trigger token user did not match the job owner",
      });
      return new Response(JSON.stringify({
        error: "Unauthorized",
        requestId,
      }), { status: 401, headers: { "Content-Type": "application/json" } });
    }
    authorizedUserId = token.userId;
    tokenId = token._id;
  } else {
    const identity = await ctx.auth.getUserIdentity();
    if (identity?.subject && identity.subject === job.userId) {
      authorizedUserId = identity.subject;
    }
  }

  if (!authorizedUserId) {
    await ctx.runMutation(internal.scheduledJobs.mutations.logApiInvocation, {
      userId: job.userId,
      jobId,
      requestId,
      idempotencyKey,
      status: "unauthorized",
      variables,
      note: "Missing valid trigger token or authenticated owner identity",
    });
    return new Response(JSON.stringify({
      error: "Unauthorized",
      requestId,
    }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  const latestInvocation = await ctx.runQuery(
    internal.scheduledJobs.queries.getLatestApiInvocationForJob,
    { jobId },
  );
  if (
    latestInvocation
    && latestInvocation.status === "triggered"
    && (Date.now() - latestInvocation.createdAt) < API_TRIGGER_COOLDOWN_MS
  ) {
    await ctx.runMutation(internal.scheduledJobs.mutations.logApiInvocation, {
      userId: authorizedUserId,
      jobId,
      tokenId,
      requestId,
      idempotencyKey,
      status: "throttled",
      variables,
      note: `Triggered too recently; cooldown ${API_TRIGGER_COOLDOWN_MS}ms`,
    });
    return new Response(JSON.stringify({
      error: "Too Many Requests",
      requestId,
    }), { status: 429, headers: { "Content-Type": "application/json" } });
  }

  try {
    const result = await ctx.runMutation(internal.scheduledJobs.mutations.triggerJobViaApi, {
      jobId,
      userId: authorizedUserId,
      tokenId,
      requestId,
      idempotencyKey,
      variables,
    });

    return new Response(JSON.stringify({
      requestId,
      ...result,
    }), { status: result.duplicate ? 200 : 202, headers: { "Content-Type": "application/json" } });
  } catch (error) {
    await ctx.runMutation(internal.scheduledJobs.mutations.logApiInvocation, {
      userId: authorizedUserId,
      jobId,
      tokenId,
      requestId,
      idempotencyKey,
      status: "error",
      variables,
      note: error instanceof Error ? error.message : String(error),
    });
    return new Response(JSON.stringify({
      error: "Failed to trigger scheduled job",
      requestId,
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
