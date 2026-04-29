// convex/scheduledJobs/mutations.ts
// =============================================================================
// Scheduled job CRUD + execution lifecycle mutations.
// =============================================================================

import { v, ConvexError } from "convex/values";
import { mutation, internalMutation, type MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { Doc, Id } from "../_generated/dataModel";
import { requireAuth, requirePro } from "../lib/auth";
import { filterToolIncompatibleOptions } from "../lib/tool_capability";
import {
  integrationOverrideEntry,
  scheduledJobRecurrence,
  scheduledJobStep,
  skillOverrideEntry,
} from "../schema_validators";
import {
  computeNextRunTime,
  validateRecurrence,
  type Recurrence,
} from "./recurrence";
import {
  mirrorFirstStep,
  normalizeSearchComplexity,
  resolveScheduledJobSearchMode,
  type ScheduledJobStepConfig,
} from "./shared";
import {
  createScheduledTriggerToken,
  sha256Hex,
} from "./trigger_auth";

function recurrenceEquals(left: Recurrence, right: Recurrence): boolean {
  if (left.type !== right.type) return false;

  switch (left.type) {
    case "manual":
      return true;
    case "interval":
      return left.minutes === (right as Extract<Recurrence, { type: "interval" }>).minutes;
    case "daily":
      return left.hourUTC === (right as Extract<Recurrence, { type: "daily" }>).hourUTC
        && left.minuteUTC === (right as Extract<Recurrence, { type: "daily" }>).minuteUTC;
    case "weekly":
      return left.dayOfWeek === (right as Extract<Recurrence, { type: "weekly" }>).dayOfWeek
        && left.hourUTC === (right as Extract<Recurrence, { type: "weekly" }>).hourUTC
        && left.minuteUTC === (right as Extract<Recurrence, { type: "weekly" }>).minuteUTC;
    case "cron":
      return left.expression === (right as Extract<Recurrence, { type: "cron" }>).expression;
  }
}

function buildStepsFromInput(args: {
  prompt?: string;
  modelId?: string;
  personaId?: Id<"personas"> | null;
  enabledIntegrations?: string[];
  turnSkillOverrides?: Array<{ skillId: Id<"skills">; state: "always" | "available" | "never" }>;
  turnIntegrationOverrides?: Array<{ integrationId: string; enabled: boolean }>;
  webSearchEnabled?: boolean;
  searchMode?: string;
  searchComplexity?: number;
  knowledgeBaseFileIds?: Id<"_storage">[];
  includeReasoning?: boolean;
  reasoningEffort?: string;
  steps?: ScheduledJobStepConfig[];
}): ScheduledJobStepConfig[] {
  if (args.steps && args.steps.length > 0) {
    return args.steps.map((step) => ({
      ...step,
      searchMode: resolveScheduledJobSearchMode(step),
      searchComplexity: normalizeSearchComplexity(step.searchComplexity),
    }));
  }

  if (!args.prompt || !args.modelId) {
    throw new ConvexError({ code: "VALIDATION" as const, message: "Either 'steps' or legacy 'prompt' and 'modelId' are required" });
  }

  return [{
    prompt: args.prompt,
    modelId: args.modelId,
    personaId: args.personaId ?? undefined,
    enabledIntegrations: args.enabledIntegrations,
    turnSkillOverrides: args.turnSkillOverrides,
    turnIntegrationOverrides: args.turnIntegrationOverrides,
    webSearchEnabled: args.webSearchEnabled,
    searchMode: resolveScheduledJobSearchMode(args),
    searchComplexity: normalizeSearchComplexity(args.searchComplexity),
    knowledgeBaseFileIds: args.knowledgeBaseFileIds,
    includeReasoning: args.includeReasoning,
    reasoningEffort: args.reasoningEffort,
  }];
}

async function validateKnowledgeBaseFileIds(
  ctx: MutationCtx,
  userId: string,
  fileIds?: Id<"_storage">[],
): Promise<void> {
  if (!fileIds) return;

  for (const fileId of fileIds) {
    const genFile = await ctx.db
      .query("generatedFiles")
      .withIndex("by_storage", (q) => q.eq("storageId", fileId))
      .first();
    const attachment = genFile
      ? null
      : await ctx.db
          .query("fileAttachments")
          .withIndex("by_storage", (q) => q.eq("storageId", fileId))
          .first();
    const media = genFile || attachment
      ? null
      : await ctx.db
          .query("generatedMedia")
          .withIndex("by_storageId", (q) => q.eq("storageId", fileId))
          .first();
    const ownerFile = genFile ?? attachment ?? media;
    if (!ownerFile || ownerFile.userId !== userId) {
      throw new ConvexError({ code: "NOT_FOUND" as const, message: "Knowledge base file not found or unauthorized" });
    }
  }
}

/**
 * Validate scheduled steps and silently strip tool-dependent options
 * (integrations) for models that don't support tools.
 * Returns the (possibly modified) steps array.
 */
async function validateScheduledSteps(
  ctx: MutationCtx,
  userId: string,
  steps: ScheduledJobStepConfig[],
): Promise<ScheduledJobStepConfig[]> {
  if (steps.length < 1 || steps.length > 5) {
    throw new ConvexError({ code: "VALIDATION" as const, message: "Scheduled jobs must contain between 1 and 5 steps" });
  }

  const result: ScheduledJobStepConfig[] = [];

  for (const [index, step] of steps.entries()) {
    if (!step.prompt.trim()) {
      throw new ConvexError({ code: "VALIDATION" as const, message: `Step ${index + 1} prompt is required` });
    }
    if (!step.modelId.trim()) {
      throw new ConvexError({ code: "VALIDATION" as const, message: `Step ${index + 1} model is required` });
    }

    let resolvedModelId = step.modelId;
    if (step.personaId) {
      const persona = await ctx.db.get(step.personaId);
      if (!persona || persona.userId !== userId) {
        throw new ConvexError({ code: "NOT_FOUND" as const, message: `Step ${index + 1} persona not found or unauthorized` });
      }
      resolvedModelId = persona.modelId ?? step.modelId;
    }

    await validateKnowledgeBaseFileIds(
      ctx,
      userId,
      step.knowledgeBaseFileIds,
    );

    // Silently strip tool-dependent overrides for non-tool-capable models.
    const filtered = await filterToolIncompatibleOptions(ctx, {
      enabledIntegrations: step.enabledIntegrations,
      turnSkillOverrides: step.turnSkillOverrides,
      turnIntegrationOverrides: step.turnIntegrationOverrides,
      modelIds: [resolvedModelId],
    });

    result.push({
      ...step,
      enabledIntegrations: filtered.enabledIntegrations,
      turnSkillOverrides: filtered.turnSkillOverrides,
      turnIntegrationOverrides: filtered.turnIntegrationOverrides,
    });
  }

  return result;
}

type ScheduledJobUpdateArgs = {
  jobId: Id<"scheduledJobs">;
  userId: string;
  name?: string;
  prompt?: string;
  modelId?: string;
  personaId?: Id<"personas"> | null;
  enabledIntegrations?: string[];
  turnSkillOverrides?: Array<{ skillId: Id<"skills">; state: "always" | "available" | "never" }>;
  turnIntegrationOverrides?: Array<{ integrationId: string; enabled: boolean }>;
  webSearchEnabled?: boolean;
  searchMode?: "none" | "basic" | "web" | "research";
  searchComplexity?: number;
  knowledgeBaseFileIds?: Id<"_storage">[];
  includeReasoning?: boolean;
  reasoningEffort?: string;
  steps?: ScheduledJobStepConfig[];
  recurrence?: Recurrence;
  timezone?: string;
  targetFolderId?: Id<"folders"> | null;
  status?: "active" | "paused" | "error";
};

async function buildScheduledJobUpdatePatch(
  ctx: MutationCtx,
  args: ScheduledJobUpdateArgs,
  job: Doc<"scheduledJobs">,
): Promise<Record<string, unknown>> {
  const updates: Record<string, unknown> = { updatedAt: Date.now() };

  if (args.name !== undefined) {
    const trimmedName = args.name.trim();
    if (!trimmedName) {
      throw new ConvexError({ code: "VALIDATION" as const, message: "Job name is required" });
    }
    updates.name = trimmedName;
  }

  if (args.timezone !== undefined) {
    updates.timezone = args.timezone;
  }

  if (args.targetFolderId !== undefined) {
    if (args.targetFolderId) {
      const folder = await ctx.db.get(args.targetFolderId);
      if (!folder || folder.userId !== args.userId) {
        throw new ConvexError({ code: "NOT_FOUND" as const, message: "Target folder not found or unauthorized" });
      }
    }
    updates.targetFolderId = args.targetFolderId ?? undefined;
  }

  if (args.status !== undefined) {
    updates.status = args.status;
  }

  const hasLegacyStepOverrides = args.prompt !== undefined
    || args.modelId !== undefined
    || args.personaId !== undefined
    || args.enabledIntegrations !== undefined
    || args.turnSkillOverrides !== undefined
    || args.turnIntegrationOverrides !== undefined
    || args.webSearchEnabled !== undefined
    || args.searchMode !== undefined
    || args.searchComplexity !== undefined
    || args.knowledgeBaseFileIds !== undefined
    || args.includeReasoning !== undefined
    || args.reasoningEffort !== undefined;

  const effectiveSteps = buildStepsFromInput({
    prompt: args.prompt ?? job.prompt,
    modelId: args.modelId ?? job.modelId,
    personaId: args.personaId === undefined
      ? (job.personaId ?? undefined)
      : args.personaId,
    enabledIntegrations: args.enabledIntegrations ?? job.enabledIntegrations,
    turnSkillOverrides: args.turnSkillOverrides ?? job.turnSkillOverrides,
    turnIntegrationOverrides: args.turnIntegrationOverrides ?? job.turnIntegrationOverrides,
    webSearchEnabled: args.webSearchEnabled ?? job.webSearchEnabled,
    searchMode: args.searchMode ?? job.searchMode,
    searchComplexity: args.searchComplexity ?? job.searchComplexity,
    knowledgeBaseFileIds: args.knowledgeBaseFileIds ?? job.knowledgeBaseFileIds,
    includeReasoning: args.includeReasoning ?? job.includeReasoning,
    reasoningEffort: args.reasoningEffort ?? job.reasoningEffort,
    steps: args.steps ?? (hasLegacyStepOverrides ? undefined : job.steps),
  });
  const effectiveStepsFiltered = await validateScheduledSteps(ctx, args.userId, effectiveSteps);
  const firstStep = mirrorFirstStep(effectiveStepsFiltered);

  updates.prompt = firstStep.prompt;
  updates.modelId = firstStep.modelId;
  updates.personaId = firstStep.personaId;
  updates.enabledIntegrations = firstStep.enabledIntegrations;
  updates.turnSkillOverrides = firstStep.turnSkillOverrides;
  updates.turnIntegrationOverrides = firstStep.turnIntegrationOverrides;
  updates.webSearchEnabled = firstStep.webSearchEnabled;
  updates.searchMode = firstStep.searchMode;
  updates.searchComplexity = firstStep.searchComplexity;
  updates.knowledgeBaseFileIds = firstStep.knowledgeBaseFileIds;
  updates.includeReasoning = firstStep.includeReasoning;
  updates.reasoningEffort = firstStep.reasoningEffort;
  updates.steps = effectiveStepsFiltered;

  const recurrence = (args.recurrence ?? job.recurrence) as Recurrence;
  if (args.recurrence !== undefined) {
    const validationError = validateRecurrence(recurrence);
    if (validationError) {
      throw new ConvexError({ code: "VALIDATION" as const, message: `Invalid recurrence: ${validationError}` });
    }
    updates.recurrence = args.recurrence;
  }

  const recurrenceChanged = args.recurrence !== undefined
    && !recurrenceEquals(recurrence, job.recurrence as Recurrence);
  const timezoneChanged = args.timezone !== undefined
    && args.timezone !== job.timezone;
  const statusChanged = args.status !== undefined && args.status !== job.status;

  if (recurrenceChanged || timezoneChanged || statusChanged) {
    if (job.scheduledFunctionId) {
      try {
        await ctx.scheduler.cancel(job.scheduledFunctionId);
      } catch {
        // May already have executed or been cancelled
      }
    }

    const effectiveStatus = args.status ?? job.status;
    const tz = args.timezone ?? job.timezone;
    const nextRunAt = computeNextRunTime(recurrence, tz) ?? undefined;
    updates.nextRunAt = effectiveStatus === "active" ? nextRunAt : undefined;

    if (effectiveStatus === "active" && nextRunAt !== undefined) {
      const scheduledId = await ctx.scheduler.runAt(
        nextRunAt,
        internal.scheduledJobs.actions.executeScheduledJob,
        { jobId: args.jobId },
      );
      updates.scheduledFunctionId = scheduledId;
    } else {
      updates.scheduledFunctionId = undefined;
    }
  }

  return updates;
}

// ── Public mutations (authenticated) ───────────────────────────────────

/** Create a new scheduled job and schedule its first execution. */
export const createJob = mutation({
  args: {
    name: v.string(),
    prompt: v.optional(v.string()),
    modelId: v.optional(v.string()),
    personaId: v.optional(v.id("personas")),
    enabledIntegrations: v.optional(v.array(v.string())),
    turnSkillOverrides: v.optional(v.array(skillOverrideEntry)),
    turnIntegrationOverrides: v.optional(v.array(integrationOverrideEntry)),
    webSearchEnabled: v.optional(v.boolean()),
    searchMode: v.optional(v.union(
      v.literal("none"),
      v.literal("basic"),
      v.literal("web"),
      v.literal("research"),
    )),
    searchComplexity: v.optional(v.number()),
    knowledgeBaseFileIds: v.optional(v.array(v.id("_storage"))),
    includeReasoning: v.optional(v.boolean()),
    reasoningEffort: v.optional(v.string()),
    steps: v.optional(v.array(scheduledJobStep)),
    recurrence: scheduledJobRecurrence,
    timezone: v.optional(v.string()),
    targetFolderId: v.optional(v.id("folders")),
    createdBy: v.optional(v.union(v.literal("user"), v.literal("ai"))),
  },
  returns: v.id("scheduledJobs"),
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    await requirePro(ctx, userId);
    const now = Date.now();
    let steps = buildStepsFromInput(args);

    // Validate recurrence
    const recurrence = args.recurrence as Recurrence;
    const validationError = validateRecurrence(recurrence);
    if (validationError) {
      throw new ConvexError({ code: "VALIDATION" as const, message: `Invalid recurrence: ${validationError}` });
    }

    // Validate name
    const trimmedName = args.name.trim();
    if (!trimmedName) throw new ConvexError({ code: "VALIDATION" as const, message: "Job name is required" });
    if (trimmedName.length > 200) throw new ConvexError({ code: "VALIDATION" as const, message: "Job name too long (max 200 characters)" });

    // Validate target folder if provided
    if (args.targetFolderId) {
      const folder = await ctx.db.get(args.targetFolderId);
      if (!folder || folder.userId !== userId) {
        throw new ConvexError({ code: "NOT_FOUND" as const, message: "Target folder not found or unauthorized" });
      }
    }

    // Validate and silently strip tool-dependent options for non-tool models
    steps = await validateScheduledSteps(ctx, userId, steps);
    const firstStep = mirrorFirstStep(steps);

    // Compute first run time
    const nextRunAt = computeNextRunTime(recurrence, args.timezone) ?? undefined;

    // Insert the job
    const jobId = await ctx.db.insert("scheduledJobs", {
      userId,
      name: trimmedName,
      prompt: firstStep.prompt,
      modelId: firstStep.modelId,
      personaId: firstStep.personaId,
      enabledIntegrations: firstStep.enabledIntegrations,
      turnSkillOverrides: firstStep.turnSkillOverrides,
      turnIntegrationOverrides: firstStep.turnIntegrationOverrides,
      webSearchEnabled: firstStep.webSearchEnabled,
      searchMode: firstStep.searchMode,
      searchComplexity: firstStep.searchComplexity,
      knowledgeBaseFileIds: firstStep.knowledgeBaseFileIds,
      steps,
      includeReasoning: firstStep.includeReasoning,
      reasoningEffort: firstStep.reasoningEffort,
      recurrence: args.recurrence,
      timezone: args.timezone,
      targetFolderId: args.targetFolderId,
      status: "active",
      nextRunAt,
      consecutiveFailures: 0,
      totalRuns: 0,
      createdBy: args.createdBy ?? "user",
      createdAt: now,
      updatedAt: now,
    });

    // Schedule first execution (skip for manual jobs)
    if (nextRunAt !== undefined) {
      const scheduledId = await ctx.scheduler.runAt(
        nextRunAt,
        internal.scheduledJobs.actions.executeScheduledJob,
        { jobId },
      );
      await ctx.db.patch(jobId, { scheduledFunctionId: scheduledId });
    }

    return jobId;
  },
});

/** Update an existing scheduled job's configuration. */
export const updateJob = mutation({
  args: {
    jobId: v.id("scheduledJobs"),
    name: v.optional(v.string()),
    prompt: v.optional(v.string()),
    modelId: v.optional(v.string()),
    personaId: v.optional(v.union(v.id("personas"), v.null())),
    enabledIntegrations: v.optional(v.array(v.string())),
    turnSkillOverrides: v.optional(v.array(skillOverrideEntry)),
    turnIntegrationOverrides: v.optional(v.array(integrationOverrideEntry)),
    webSearchEnabled: v.optional(v.boolean()),
    searchMode: v.optional(v.union(
      v.literal("none"),
      v.literal("basic"),
      v.literal("web"),
      v.literal("research"),
    )),
    searchComplexity: v.optional(v.number()),
    knowledgeBaseFileIds: v.optional(v.array(v.id("_storage"))),
    includeReasoning: v.optional(v.boolean()),
    reasoningEffort: v.optional(v.string()),
    steps: v.optional(v.array(scheduledJobStep)),
    recurrence: v.optional(scheduledJobRecurrence),
    timezone: v.optional(v.string()),
    targetFolderId: v.optional(v.union(v.id("folders"), v.null())),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    await requirePro(ctx, userId);
    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== userId) {
      throw new ConvexError({ code: "NOT_FOUND" as const, message: "Job not found or unauthorized" });
    }
    const updates = await buildScheduledJobUpdatePatch(ctx, {
      ...args,
      userId,
    }, job);
    await ctx.db.patch(args.jobId, updates);
  },
});

/** Pause a scheduled job — cancels pending execution. */
export const pauseJob = mutation({
  args: { jobId: v.id("scheduledJobs") },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    await requirePro(ctx, userId);
    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== userId) {
      throw new ConvexError({ code: "NOT_FOUND" as const, message: "Job not found or unauthorized" });
    }
    if (job.status === "paused") return;

    // Cancel pending scheduled function
    if (job.scheduledFunctionId) {
      try {
        await ctx.scheduler.cancel(job.scheduledFunctionId);
      } catch {
        // Already executed or cancelled
      }
    }

    await ctx.db.patch(args.jobId, {
      status: "paused",
      nextRunAt: undefined,
      scheduledFunctionId: undefined,
      updatedAt: Date.now(),
    });
  },
});

/** Resume a paused/errored job — resets failure count and reschedules. */
export const resumeJob = mutation({
  args: { jobId: v.id("scheduledJobs") },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    await requirePro(ctx, userId);
    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== userId) {
      throw new ConvexError({ code: "NOT_FOUND" as const, message: "Job not found or unauthorized" });
    }
    if (job.status === "active") return;

    const recurrence = job.recurrence as Recurrence;
    const nextRunAt = computeNextRunTime(recurrence, job.timezone) ?? undefined;

    const updates: Record<string, unknown> = {
      status: "active",
      consecutiveFailures: 0,
      lastRunError: undefined,
      nextRunAt,
      updatedAt: Date.now(),
    };

    if (nextRunAt !== undefined) {
      const scheduledId = await ctx.scheduler.runAt(
        nextRunAt,
        internal.scheduledJobs.actions.executeScheduledJob,
        { jobId: args.jobId },
      );
      updates.scheduledFunctionId = scheduledId;
    } else {
      updates.scheduledFunctionId = undefined;
    }

    await ctx.db.patch(args.jobId, updates);
  },
});

/** Delete a scheduled job and all its run history. */
export const deleteJob = mutation({
  args: { jobId: v.id("scheduledJobs") },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    await requirePro(ctx, userId);
    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== userId) {
      throw new ConvexError({ code: "NOT_FOUND" as const, message: "Job not found or unauthorized" });
    }

    // Cancel pending scheduled function
    if (job.scheduledFunctionId) {
      try {
        await ctx.scheduler.cancel(job.scheduledFunctionId);
      } catch {
        // Already executed or cancelled
      }
    }

    // Delete run history in batches to stay within transaction limits
    let batch;
    do {
      batch = await ctx.db
        .query("jobRuns")
        .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
        .take(100);
      for (const run of batch) {
        await ctx.db.delete(run._id);
      }
    } while (batch.length === 100);

    await ctx.db.delete(args.jobId);
  },
});

/** Run Now — trigger immediate execution of any job. */
export const runJobNow = mutation({
  args: { jobId: v.id("scheduledJobs") },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    await requirePro(ctx, userId);
    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== userId) {
      throw new ConvexError({ code: "NOT_FOUND" as const, message: "Job not found or unauthorized" });
    }

    // Block paused manual jobs from running (for non-manual jobs, allow one-off)
    // Actually per spec: "Paused manual jobs cannot be run via Run Now"
    // But for non-manual paused jobs, allow one-off execution without un-pausing
    if (job.status === "paused" && (job.recurrence as Recurrence).type === "manual") {
      throw new ConvexError({ code: "VALIDATION" as const, message: "Cannot run a paused manual job — resume it first" });
    }

    // Fire immediately
    await ctx.scheduler.runAfter(
      0,
      internal.scheduledJobs.actions.executeScheduledJob,
      {
        jobId: args.jobId,
        invocationSource: "manual",
      },
    );

    return { triggered: true, message: "Job execution started" };
  },
});

/** Create a new API trigger token for a scheduled job. */
const scheduledTriggerTokenResponse = v.object({
  tokenId: v.id("scheduledJobTriggerTokens"),
  token: v.string(),
  tokenPrefix: v.string(),
});

async function insertScheduledJobTriggerToken(
  ctx: MutationCtx,
  {
    userId,
    jobId,
    label,
  }: {
    userId: string;
    jobId: Id<"scheduledJobs">;
    label?: string;
  },
) {
  const { rawToken, tokenPrefix } = createScheduledTriggerToken();
  const tokenHash = await sha256Hex(rawToken);
  const now = Date.now();
  const tokenId = await ctx.db.insert("scheduledJobTriggerTokens", {
    userId,
    jobId,
    label: label?.trim() || undefined,
    tokenPrefix,
    tokenHash,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });

  return {
    tokenId,
    token: rawToken,
    tokenPrefix,
  };
}

export const createJobTriggerToken = mutation({
  args: {
    jobId: v.id("scheduledJobs"),
    label: v.optional(v.string()),
  },
  returns: scheduledTriggerTokenResponse,
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    await requirePro(ctx, userId);
    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== userId) {
      throw new ConvexError({ code: "NOT_FOUND" as const, message: "Job not found or unauthorized" });
    }

    return await insertScheduledJobTriggerToken(ctx, {
      userId,
      jobId: args.jobId,
      label: args.label,
    });
  },
});

/** Rotate a scheduled-job API trigger token, revoking existing active tokens. */
export const rotateJobTriggerToken = mutation({
  args: {
    jobId: v.id("scheduledJobs"),
    label: v.optional(v.string()),
  },
  returns: scheduledTriggerTokenResponse,
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    await requirePro(ctx, userId);
    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== userId) {
      throw new ConvexError({ code: "NOT_FOUND" as const, message: "Job not found or unauthorized" });
    }

    const activeTokens = await ctx.db
      .query("scheduledJobTriggerTokens")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId).eq("status", "active"))
      .collect();
    const now = Date.now();

    await Promise.all(activeTokens.map((token) => ctx.db.patch(token._id, {
      status: "revoked",
      revokedAt: now,
      updatedAt: now,
    })));

    return await insertScheduledJobTriggerToken(ctx, {
      userId,
      jobId: args.jobId,
      label: args.label ?? activeTokens[0]?.label,
    });
  },
});

/** Revoke an existing scheduled-job API trigger token. */
export const revokeJobTriggerToken = mutation({
  args: {
    tokenId: v.id("scheduledJobTriggerTokens"),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    await requirePro(ctx, userId);
    const token = await ctx.db.get(args.tokenId);
    if (!token || token.userId !== userId) {
      throw new ConvexError({ code: "NOT_FOUND" as const, message: "Trigger token not found or unauthorized" });
    }
    if (token.status === "revoked") return;

    const now = Date.now();
    // Revocation prevents future API-triggered executions with this token.
    // It intentionally does not cancel runs that were already accepted and scheduled.
    await ctx.db.patch(args.tokenId, {
      status: "revoked",
      revokedAt: now,
      updatedAt: now,
    });
  },
});

/** Upsert the user's OpenRouter API key into `userSecrets` for server-side use. */
export const upsertApiKey = mutation({
  args: { apiKey: v.string() },
  handler: async (ctx, args) => {
    if (!args.apiKey || args.apiKey.trim().length === 0) {
      throw new ConvexError({ code: "VALIDATION" as const, message: "API key cannot be empty." });
    }
    const { userId } = await requireAuth(ctx);
    const existing = await ctx.db
      .query("userSecrets")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        apiKey: args.apiKey,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("userSecrets", {
        userId,
        apiKey: args.apiKey,
        updatedAt: Date.now(),
      });
    }
  },
});

/** Remove the user's API key from `userSecrets` (called on OpenRouter disconnect). */
export const deleteApiKey = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);
    const existing = await ctx.db
      .query("userSecrets")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});

// ── Internal mutations (called from executeScheduledJob action) ────────

/** Internal: create a scheduled job on behalf of a user (for AI tools). */
export const createJobInternal = internalMutation({
  args: {
    userId: v.string(),
    name: v.string(),
    prompt: v.optional(v.string()),
    modelId: v.optional(v.string()),
    personaId: v.optional(v.id("personas")),
    enabledIntegrations: v.optional(v.array(v.string())),
    turnSkillOverrides: v.optional(v.array(skillOverrideEntry)),
    turnIntegrationOverrides: v.optional(v.array(integrationOverrideEntry)),
    webSearchEnabled: v.optional(v.boolean()),
    searchMode: v.optional(v.union(
      v.literal("none"),
      v.literal("basic"),
      v.literal("web"),
      v.literal("research"),
    )),
    searchComplexity: v.optional(v.number()),
    knowledgeBaseFileIds: v.optional(v.array(v.id("_storage"))),
    includeReasoning: v.optional(v.boolean()),
    reasoningEffort: v.optional(v.string()),
    steps: v.optional(v.array(scheduledJobStep)),
    recurrence: scheduledJobRecurrence,
    timezone: v.optional(v.string()),
    targetFolderId: v.optional(v.id("folders")),
  },
  returns: v.id("scheduledJobs"),
  handler: async (ctx, args) => {
    const now = Date.now();
    let steps = buildStepsFromInput(args);

    // Validate recurrence
    const recurrence = args.recurrence as Recurrence;
    const validationError = validateRecurrence(recurrence);
    if (validationError) {
      throw new ConvexError({
        code: "INVALID_RECURRENCE" as const,
        message: `Invalid recurrence: ${validationError}`,
      });
    }

    // Validate name
    const trimmedName = args.name.trim();
    if (!trimmedName) throw new ConvexError({ code: "INVALID_ARGS" as const, message: "Job name is required" });
    if (trimmedName.length > 200) throw new ConvexError({ code: "INVALID_ARGS" as const, message: "Job name too long (max 200 characters)" });

    // Validate target folder if provided
    if (args.targetFolderId) {
      const folder = await ctx.db.get(args.targetFolderId);
      if (!folder || folder.userId !== args.userId) {
        throw new ConvexError({ code: "NOT_FOUND" as const, message: "Target folder not found or unauthorized" });
      }
    }

    // Validate and silently strip tool-dependent options for non-tool models
    steps = await validateScheduledSteps(ctx, args.userId, steps);
    const firstStep = mirrorFirstStep(steps);

    // Compute first run time
    const nextRunAt = computeNextRunTime(recurrence, args.timezone) ?? undefined;

    // Insert the job
    const jobId = await ctx.db.insert("scheduledJobs", {
      userId: args.userId,
      name: trimmedName,
      prompt: firstStep.prompt,
      modelId: firstStep.modelId,
      personaId: firstStep.personaId,
      enabledIntegrations: firstStep.enabledIntegrations,
      turnSkillOverrides: firstStep.turnSkillOverrides,
      turnIntegrationOverrides: firstStep.turnIntegrationOverrides,
      webSearchEnabled: firstStep.webSearchEnabled,
      searchMode: firstStep.searchMode,
      searchComplexity: firstStep.searchComplexity,
      knowledgeBaseFileIds: firstStep.knowledgeBaseFileIds,
      steps,
      includeReasoning: firstStep.includeReasoning,
      reasoningEffort: firstStep.reasoningEffort,
      recurrence: args.recurrence,
      timezone: args.timezone,
      targetFolderId: args.targetFolderId,
      status: "active",
      nextRunAt,
      consecutiveFailures: 0,
      totalRuns: 0,
      createdBy: "ai",
      createdAt: now,
      updatedAt: now,
    });

    // Schedule first execution (skip for manual jobs)
    if (nextRunAt !== undefined) {
      const scheduledId = await ctx.scheduler.runAt(
        nextRunAt,
        internal.scheduledJobs.actions.executeScheduledJob,
        { jobId },
      );
      await ctx.db.patch(jobId, { scheduledFunctionId: scheduledId });
    }

    return jobId;
  },
});

/** Internal: update a scheduled job on behalf of a user (for AI tools). */
export const updateJobInternal = internalMutation({
  args: {
    jobId: v.id("scheduledJobs"),
    userId: v.string(),
    name: v.optional(v.string()),
    prompt: v.optional(v.string()),
    modelId: v.optional(v.string()),
    personaId: v.optional(v.union(v.id("personas"), v.null())),
    enabledIntegrations: v.optional(v.array(v.string())),
    turnSkillOverrides: v.optional(v.array(skillOverrideEntry)),
    turnIntegrationOverrides: v.optional(v.array(integrationOverrideEntry)),
    webSearchEnabled: v.optional(v.boolean()),
    searchMode: v.optional(v.union(
      v.literal("none"),
      v.literal("basic"),
      v.literal("web"),
      v.literal("research"),
    )),
    searchComplexity: v.optional(v.number()),
    knowledgeBaseFileIds: v.optional(v.array(v.id("_storage"))),
    includeReasoning: v.optional(v.boolean()),
    reasoningEffort: v.optional(v.string()),
    steps: v.optional(v.array(scheduledJobStep)),
    recurrence: v.optional(scheduledJobRecurrence),
    timezone: v.optional(v.string()),
    targetFolderId: v.optional(v.union(v.id("folders"), v.null())),
    status: v.optional(v.union(v.literal("active"), v.literal("paused"), v.literal("error"))),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== args.userId) {
      throw new ConvexError({ code: "NOT_FOUND" as const, message: "Job not found or unauthorized" });
    }
    const updates = await buildScheduledJobUpdatePatch(ctx, args, job);
    await ctx.db.patch(args.jobId, updates);
  },
});

/** Internal: delete a scheduled job on behalf of a user (for AI tools). */
export const deleteJobInternal = internalMutation({
  args: {
    jobId: v.id("scheduledJobs"),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== args.userId) {
      throw new ConvexError({ code: "NOT_FOUND" as const, message: "Job not found or unauthorized" });
    }

    // Cancel pending scheduled function
    if (job.scheduledFunctionId) {
      try {
        await ctx.scheduler.cancel(job.scheduledFunctionId);
      } catch {
        // Already executed or cancelled
      }
    }

    // Delete run history in batches to stay within transaction limits
    let batch;
    do {
      batch = await ctx.db
        .query("jobRuns")
        .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
        .take(100);
      for (const run of batch) {
        await ctx.db.delete(run._id);
      }
    } while (batch.length === 100);

    await ctx.db.delete(args.jobId);
  },
});

/** Internal: create a new chat for a job execution. */
export const createJobChat = internalMutation({
  args: {
    jobId: v.id("scheduledJobs"),
    userId: v.string(),
    jobName: v.string(),
    targetFolderId: v.optional(v.id("folders")),
    sourceJobId: v.id("scheduledJobs"),
    executionId: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) {
      throw new ConvexError({ code: "NOT_FOUND" as const, message: "Scheduled job not found" });
    }
    if (job.activeExecutionId !== args.executionId) {
      throw new ConvexError({ code: "EXECUTION_STALE" as const, message: "Scheduled job execution no longer active" });
    }

    const now = Date.now();

    // Resolve folder: user-selected → "Scheduled" fallback → create "Scheduled"
    let folderId: string | undefined;
    if (args.targetFolderId) {
      const folder = await ctx.db.get(args.targetFolderId);
      if (folder && folder.userId === args.userId) {
        folderId = args.targetFolderId as string;
      }
    }
    if (!folderId) {
      // Look for existing "Scheduled" folder (filter instead of collect+find)
      const scheduledFolder = await ctx.db
        .query("folders")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .filter((q) => q.eq(q.field("name"), "Scheduled"))
        .first();
      if (scheduledFolder) {
        folderId = scheduledFolder._id as string;
      } else {
        // Create "Scheduled" folder
        const newFolderId = await ctx.db.insert("folders", {
          userId: args.userId,
          name: "Scheduled",
          color: "#8E8E93", // System gray
          sortOrder: 999,
          createdAt: now,
          updatedAt: now,
        });
        folderId = newFolderId as string;
      }
    }

    const chatId = await ctx.db.insert("chats", {
      userId: args.userId,
      title: args.jobName,
      mode: "chat",
      folderId,
      source: "scheduled_job",
      sourceJobId: args.sourceJobId,
      sourceJobName: args.jobName,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.patch(args.jobId, {
      activeExecutionChatId: chatId,
      lastRunChatId: chatId,
      updatedAt: now,
    });

    return chatId;
  },
});

/** Internal: insert the job's prompt as a user message. */
export const createJobUserMessage = internalMutation({
  args: {
    chatId: v.id("chats"),
    userId: v.string(),
    content: v.string(),
    source: v.optional(v.union(v.literal("user"), v.literal("scheduled_step"))),
    sourceJobId: v.optional(v.id("scheduledJobs")),
    sourceStepIndex: v.optional(v.number()),
    sourceStepTitle: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("messages", {
      chatId: args.chatId,
      userId: args.userId,
      role: "user",
      content: args.content,
      parentMessageIds: [],
      status: "completed",
      source: args.source ?? "user",
      sourceJobId: args.sourceJobId,
      sourceStepIndex: args.sourceStepIndex,
      sourceStepTitle: args.sourceStepTitle,
      createdAt: Date.now(),
    });
  },
});

/** Internal: create assistant message placeholder + generation job for scheduled execution. */
export const createAssistantAndJob = internalMutation({
  args: {
    chatId: v.id("chats"),
    userId: v.string(),
    modelId: v.string(),
    systemPrompt: v.optional(v.string()),
    temperature: v.optional(v.number()),
    maxTokens: v.optional(v.number()),
    userMessageId: v.id("messages"),
    personaId: v.optional(v.id("personas")),
    personaName: v.optional(v.string()),
    personaEmoji: v.optional(v.string()),
    personaAvatarImageUrl: v.optional(v.string()),
    enabledIntegrations: v.optional(v.array(v.string())),
    sourceJobId: v.optional(v.id("scheduledJobs")),
    sourceExecutionId: v.optional(v.string()),
    sourceStepIndex: v.optional(v.number()),
    sourceStepTitle: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Create assistant message placeholder
    const assistantMsgId = await ctx.db.insert("messages", {
      chatId: args.chatId,
      userId: args.userId,
      role: "assistant",
      content: "",
      modelId: args.modelId,
      participantId: args.personaId ?? undefined,
      participantName: args.personaName ?? undefined,
      participantEmoji: args.personaEmoji ?? undefined,
      participantAvatarImageUrl: args.personaAvatarImageUrl ?? undefined,
      parentMessageIds: [args.userMessageId],
      status: "pending",
      enabledIntegrations: args.enabledIntegrations,
      sourceJobId: args.sourceJobId,
      sourceStepIndex: args.sourceStepIndex,
      sourceStepTitle: args.sourceStepTitle,
      createdAt: now,
    });

    // Create generation job
    const genJobId = await ctx.db.insert("generationJobs", {
      chatId: args.chatId,
      messageId: assistantMsgId,
      userId: args.userId,
      modelId: args.modelId,
      status: "queued",
      sourceJobId: args.sourceJobId,
      sourceExecutionId: args.sourceExecutionId,
      sourceStepIndex: args.sourceStepIndex,
      sourceStepTitle: args.sourceStepTitle,
      createdAt: now,
    });

    // Create participant entry for the chat
    const existingParticipants = await ctx.db
      .query("chatParticipants")
      .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
      .collect();

    const hasMatchingParticipant = existingParticipants.some((participant) =>
      participant.modelId === args.modelId
      && (participant.personaId ?? undefined) === (args.personaId ?? undefined),
    );

    if (!hasMatchingParticipant) {
      await ctx.db.insert("chatParticipants", {
        chatId: args.chatId,
        userId: args.userId,
        modelId: args.modelId,
        personaId: args.personaId,
        personaName: args.personaName,
        personaEmoji: args.personaEmoji,
        personaAvatarImageUrl: args.personaAvatarImageUrl,
        sortOrder: existingParticipants.length,
        createdAt: now,
      });
    }

    return { assistantMsgId, genJobId };
  },
});

export const beginExecution = internalMutation({
  args: {
    jobId: v.id("scheduledJobs"),
    executionId: v.string(),
    startedAt: v.number(),
    stepCount: v.number(),
    templateVariables: v.optional(v.record(v.string(), v.string())),
  },
  returns: v.object({ started: v.boolean() }),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) {
      return { started: false };
    }

    if (job.activeExecutionId) {
      return { started: false };
    }

    await ctx.db.patch(args.jobId, {
      activeExecutionId: args.executionId,
      activeExecutionChatId: undefined,
      activeExecutionStartedAt: args.startedAt,
      activeExecutionVariables: args.templateVariables ?? undefined,
      activeStepCount: args.stepCount,
      activeStepIndex: undefined,
      activeUserMessageId: undefined,
      activeAssistantMessageId: undefined,
      activeGenerationJobId: undefined,
      updatedAt: Date.now(),
    });

    return { started: true };
  },
});

export const createScheduledExecutionTurn = internalMutation({
  args: {
    jobId: v.id("scheduledJobs"),
    chatId: v.id("chats"),
    userId: v.string(),
    executionId: v.string(),
    stepIndex: v.number(),
    stepTitle: v.string(),
    content: v.string(),
    modelId: v.string(),
    systemPrompt: v.optional(v.string()),
    temperature: v.optional(v.number()),
    maxTokens: v.optional(v.number()),
    personaId: v.optional(v.id("personas")),
    personaName: v.optional(v.string()),
    personaEmoji: v.optional(v.string()),
    personaAvatarImageUrl: v.optional(v.string()),
    enabledIntegrations: v.optional(v.array(v.string())),
  },
  returns: v.object({
    userMessageId: v.id("messages"),
    assistantMsgId: v.id("messages"),
    genJobId: v.id("generationJobs"),
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) {
      throw new ConvexError({ code: "NOT_FOUND" as const, message: "Scheduled job not found" });
    }
    if (job.activeExecutionId !== args.executionId) {
      throw new ConvexError({ code: "EXECUTION_STALE" as const, message: "Scheduled job execution no longer active" });
    }
    if (job.activeExecutionChatId !== args.chatId) {
      throw new ConvexError({ code: "EXECUTION_MISMATCH" as const, message: "Scheduled job execution chat mismatch" });
    }

    const currentStepIndex = job.activeStepIndex ?? -1;
    if (currentStepIndex >= args.stepIndex) {
      if (
        job.activeUserMessageId
        && job.activeAssistantMessageId
        && job.activeGenerationJobId
      ) {
        return {
          userMessageId: job.activeUserMessageId,
          assistantMsgId: job.activeAssistantMessageId,
          genJobId: job.activeGenerationJobId,
          created: false,
        };
      }
      throw new ConvexError({ code: "DUPLICATE_STEP" as const, message: "Scheduled job step already created" });
    }

    if (currentStepIndex !== args.stepIndex - 1) {
      throw new ConvexError({ code: "STEP_ORDER" as const, message: "Scheduled job step order mismatch" });
    }

    const now = Date.now();
    const parentMessageIds = job.activeAssistantMessageId
      ? [job.activeAssistantMessageId]
      : [];
    const userMessageId = await ctx.db.insert("messages", {
      chatId: args.chatId,
      userId: args.userId,
      role: "user",
      content: args.content,
      parentMessageIds,
      status: "completed",
      source: "scheduled_step",
      sourceJobId: args.jobId,
      sourceStepIndex: args.stepIndex,
      sourceStepTitle: args.stepTitle,
      createdAt: now,
    });

    const assistantMsgId = await ctx.db.insert("messages", {
      chatId: args.chatId,
      userId: args.userId,
      role: "assistant",
      content: "",
      modelId: args.modelId,
      participantId: args.personaId ?? undefined,
      participantName: args.personaName ?? undefined,
      participantEmoji: args.personaEmoji ?? undefined,
      participantAvatarImageUrl: args.personaAvatarImageUrl ?? undefined,
      parentMessageIds: [userMessageId],
      status: "pending",
      enabledIntegrations: args.enabledIntegrations,
      sourceJobId: args.jobId,
      sourceStepIndex: args.stepIndex,
      sourceStepTitle: args.stepTitle,
      createdAt: now,
    });

    const genJobId = await ctx.db.insert("generationJobs", {
      chatId: args.chatId,
      messageId: assistantMsgId,
      userId: args.userId,
      modelId: args.modelId,
      status: "queued",
      sourceJobId: args.jobId,
      sourceExecutionId: args.executionId,
      sourceStepIndex: args.stepIndex,
      sourceStepTitle: args.stepTitle,
      createdAt: now,
    });

    const existingParticipants = await ctx.db
      .query("chatParticipants")
      .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
      .collect();
    const hasMatchingParticipant = existingParticipants.some((participant) =>
      participant.modelId === args.modelId
      && (participant.personaId ?? undefined) === (args.personaId ?? undefined),
    );
    if (!hasMatchingParticipant) {
      await ctx.db.insert("chatParticipants", {
        chatId: args.chatId,
        userId: args.userId,
        modelId: args.modelId,
        personaId: args.personaId,
        personaName: args.personaName,
        personaEmoji: args.personaEmoji,
        personaAvatarImageUrl: args.personaAvatarImageUrl,
        sortOrder: existingParticipants.length,
        createdAt: now,
      });
    }

    await ctx.db.patch(args.jobId, {
      activeStepIndex: args.stepIndex,
      activeUserMessageId: userMessageId,
      activeAssistantMessageId: assistantMsgId,
      activeGenerationJobId: genJobId,
      updatedAt: now,
    });

    return { userMessageId, assistantMsgId, genJobId, created: true };
  },
});

/** Internal: create a search session for web/paper search from scheduled jobs. */
export const createSearchSession = internalMutation({
  args: {
    chatId: v.id("chats"),
    userId: v.string(),
    assistantMessageId: v.id("messages"),
    query: v.string(),
    mode: v.union(v.literal("web"), v.literal("paper")),
    complexity: v.number(),
  },
  returns: v.id("searchSessions"),
  handler: async (ctx, args) => {
    const now = Date.now();
    const complexity = Math.max(1, Math.min(3, Math.round(args.complexity)));

    const sessionId = await ctx.db.insert("searchSessions", {
      chatId: args.chatId,
      userId: args.userId,
      assistantMessageId: args.assistantMessageId,
      query: args.query,
      mode: args.mode,
      complexity,
      status: complexity === 1 && args.mode === "web" ? "searching" : "planning",
      progress: 0,
      currentPhase: complexity === 1 && args.mode === "web" ? "searching" : "planning",
      phaseOrder: 0,
      startedAt: now,
    });

    // Link assistant message to search session
    await ctx.db.patch(args.assistantMessageId, { searchSessionId: sessionId });

    return sessionId;
  },
});

/** Internal: record a successful run. */
export const recordRunSuccess = internalMutation({
  args: {
    jobId: v.id("scheduledJobs"),
    chatId: v.id("chats"),
    startedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const job = await ctx.db.get(args.jobId);
    if (!job) return;

    // Insert run record
    await ctx.db.insert("jobRuns", {
      jobId: args.jobId,
      userId: job.userId,
      chatId: args.chatId,
      status: "success",
      startedAt: args.startedAt,
      completedAt: now,
      durationMs: now - args.startedAt,
    });

    // Update job state
    await ctx.db.patch(args.jobId, {
      lastRunAt: now,
      lastRunChatId: args.chatId,
      lastRunStatus: "success",
      lastRunError: undefined,
      consecutiveFailures: 0,
      totalRuns: (job.totalRuns ?? 0) + 1,
      activeExecutionId: undefined,
      activeExecutionChatId: undefined,
      activeExecutionStartedAt: undefined,
      activeExecutionVariables: undefined,
      activeStepIndex: undefined,
      activeStepCount: undefined,
      activeUserMessageId: undefined,
      activeAssistantMessageId: undefined,
      activeGenerationJobId: undefined,
      updatedAt: now,
    });
  },
});

/** Internal: record a failed run and optionally auto-pause. */
export const recordRunFailure = internalMutation({
  args: {
    jobId: v.id("scheduledJobs"),
    error: v.string(),
    consecutiveFailures: v.number(),
    autoPause: v.boolean(),
    startedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const job = await ctx.db.get(args.jobId);
    if (!job) return;

    const runStartedAt = args.startedAt ?? now;

    // Insert run record
    await ctx.db.insert("jobRuns", {
      jobId: args.jobId,
      userId: job.userId,
      chatId: job.activeExecutionChatId,
      status: "failed",
      error: args.error,
      startedAt: runStartedAt,
      completedAt: now,
      durationMs: now - runStartedAt,
    });

    // Update job state
    const patch: Record<string, unknown> = {
      lastRunAt: now,
      lastRunChatId: job.activeExecutionChatId,
      lastRunStatus: "failed",
      lastRunError: args.error,
      consecutiveFailures: args.consecutiveFailures,
      status: args.autoPause ? "error" : job.status,
      totalRuns: (job.totalRuns ?? 0) + 1,
      activeExecutionId: undefined,
      activeExecutionChatId: undefined,
      activeExecutionStartedAt: undefined,
      activeExecutionVariables: undefined,
      activeStepIndex: undefined,
      activeStepCount: undefined,
      activeUserMessageId: undefined,
      activeAssistantMessageId: undefined,
      activeGenerationJobId: undefined,
      updatedAt: now,
    };

    if (args.autoPause) {
      if (job.scheduledFunctionId) {
        try {
          await ctx.scheduler.cancel(job.scheduledFunctionId);
        } catch {
          // Already executed or cancelled
        }
      }
      patch.nextRunAt = undefined;
      patch.scheduledFunctionId = undefined;
    }

    await ctx.db.patch(args.jobId, patch);
  },
});

/** Internal: update next run time after scheduling. */
export const updateNextRun = internalMutation({
  args: {
    jobId: v.id("scheduledJobs"),
    nextRunAt: v.number(),
    scheduledFunctionId: v.id("_scheduled_functions"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.jobId, {
      nextRunAt: args.nextRunAt,
      scheduledFunctionId: args.scheduledFunctionId,
      updatedAt: Date.now(),
    });
  },
});

/** Internal: trigger a scheduled job via API with idempotency + audit logging. */
export const triggerJobViaApi = internalMutation({
  args: {
    jobId: v.id("scheduledJobs"),
    userId: v.string(),
    tokenId: v.optional(v.id("scheduledJobTriggerTokens")),
    requestId: v.string(),
    idempotencyKey: v.optional(v.string()),
    variables: v.optional(v.record(v.string(), v.string())),
  },
  returns: v.object({
    duplicate: v.boolean(),
    triggered: v.boolean(),
    message: v.string(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const effectiveIdempotencyKey = args.idempotencyKey?.trim() || undefined;

    if (effectiveIdempotencyKey) {
      const existing = await ctx.db
        .query("scheduledJobApiInvocations")
        .withIndex("by_job_idempotency", (q) =>
          q.eq("jobId", args.jobId).eq("idempotencyKey", effectiveIdempotencyKey),
        )
        .first();
      if (existing) {
        await ctx.db.insert("scheduledJobApiInvocations", {
          userId: args.userId,
          jobId: args.jobId,
          tokenId: args.tokenId,
          requestId: args.requestId,
          idempotencyKey: effectiveIdempotencyKey,
          status: "duplicate",
          variables: args.variables,
          note: `Duplicate of request ${existing.requestId}`,
          createdAt: now,
        });
        return {
          duplicate: true,
          triggered: false,
          message: "Duplicate idempotency key; skipped triggering a new execution.",
        };
      }
    }

    const scheduledFunctionId = await ctx.scheduler.runAfter(
      0,
      internal.scheduledJobs.actions.executeScheduledJob,
      {
        jobId: args.jobId,
        invocationSource: "api",
        templateVariables: args.variables,
      },
    );

    await ctx.db.insert("scheduledJobApiInvocations", {
      userId: args.userId,
      jobId: args.jobId,
      tokenId: args.tokenId,
      requestId: args.requestId,
      idempotencyKey: effectiveIdempotencyKey,
      status: "triggered",
      variables: args.variables,
      scheduledFunctionId,
      createdAt: now,
    });

    if (args.tokenId) {
      await ctx.db.patch(args.tokenId, {
        lastUsedAt: now,
        updatedAt: now,
      });
    }

    return {
      duplicate: false,
      triggered: true,
      message: "Scheduled job execution triggered.",
    };
  },
});

/** Internal: append an audit-only API invocation event (no execution). */
export const logApiInvocation = internalMutation({
  args: {
    userId: v.string(),
    jobId: v.id("scheduledJobs"),
    tokenId: v.optional(v.id("scheduledJobTriggerTokens")),
    requestId: v.string(),
    idempotencyKey: v.optional(v.string()),
    status: v.union(
      v.literal("throttled"),
      v.literal("unauthorized"),
      v.literal("not_found"),
      v.literal("error"),
    ),
    variables: v.optional(v.record(v.string(), v.string())),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("scheduledJobApiInvocations", {
      userId: args.userId,
      jobId: args.jobId,
      tokenId: args.tokenId,
      requestId: args.requestId,
      idempotencyKey: args.idempotencyKey?.trim() || undefined,
      status: args.status,
      variables: args.variables,
      note: args.note,
      createdAt: Date.now(),
    });
  },
});

export const replaceScheduledFunction = internalMutation({
  args: {
    jobId: v.id("scheduledJobs"),
    nextRunAt: v.number(),
    scheduledFunctionId: v.id("_scheduled_functions"),
    previousScheduledFunctionId: v.optional(v.id("_scheduled_functions")),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.jobId, {
      nextRunAt: args.nextRunAt,
      scheduledFunctionId: args.scheduledFunctionId,
      updatedAt: Date.now(),
    });

    if (
      args.previousScheduledFunctionId
      && args.previousScheduledFunctionId !== args.scheduledFunctionId
    ) {
      try {
        await ctx.scheduler.cancel(args.previousScheduledFunctionId);
      } catch {
        // Already executed or cancelled
      }
    }
  },
});

/** Internal: cancel an existing scheduled function for a job. */
export const cancelScheduledFunction = internalMutation({
  args: {
    jobId: v.id("scheduledJobs"),
    scheduledFunctionId: v.id("_scheduled_functions"),
  },
  handler: async (ctx, args) => {
    try {
      await ctx.scheduler.cancel(args.scheduledFunctionId);
    } catch {
      // Already executed or cancelled
    }
    // Clear the reference so we don't try to cancel it again
    await ctx.db.patch(args.jobId, {
      scheduledFunctionId: undefined,
      updatedAt: Date.now(),
    });
  },
});

/** Internal: clean up job runs older than 30 days (called by daily cron).
 *  Deletes in batches of 500. If more remain, self-schedules a continuation
 *  so the 30-day retention policy is enforced regardless of backlog size. */
export const cleanOldJobRuns = internalMutation({
  args: {},
  handler: async (ctx) => {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    let totalDeleted = 0;
    const BATCH_SIZE = 500;
    const MAX_BATCHES = 10; // Safety cap per invocation

    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const oldRuns = await ctx.db
        .query("jobRuns")
        .withIndex("by_completedAt", (q) => q.lt("completedAt", thirtyDaysAgo))
        .take(BATCH_SIZE);

      if (oldRuns.length === 0) break;

      for (const run of oldRuns) {
        await ctx.db.delete(run._id);
      }
      totalDeleted += oldRuns.length;

      // If we got a full batch, there may be more — but if we've hit
      // MAX_BATCHES, schedule a continuation to avoid transaction limits.
      if (oldRuns.length === BATCH_SIZE && batch === MAX_BATCHES - 1) {
        await ctx.scheduler.runAfter(
          0,
          internal.scheduledJobs.mutations.cleanOldJobRuns,
          {},
        );
        console.log(
          `cleanOldJobRuns: deleted ${totalDeleted} runs, scheduling continuation`,
        );
        return;
      }
    }

    if (totalDeleted > 0) {
      console.log(
        `cleanOldJobRuns: deleted ${totalDeleted} runs older than 30 days`,
      );
    }
  },
});
