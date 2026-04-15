import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { createTool } from "./registry";

export const updateScheduledJob = createTool({
  name: "update_scheduled_job",
  description:
    "Update an existing scheduled job by ID or by name lookup. " +
    "Supports editing single-step or multi-step jobs, recurrence, and pause/resume state.",
  parameters: {
    type: "object",
    properties: {
      jobId: { type: "string", description: "Scheduled job ID." },
      jobName: { type: "string", description: "Scheduled job name (case-insensitive partial match)." },
      name: { type: "string", description: "New job name." },
      prompt: { type: "string", description: "Legacy single-step prompt." },
      modelId: { type: "string", description: "Legacy single-step model ID." },
      personaId: {
        type: "string",
        description: "Optional persona ID for the legacy single-step shape. Pass an empty string to clear it.",
      },
      targetFolderId: {
        type: "string",
        description: "Optional destination folder ID. Pass an empty string to clear it.",
      },
      steps: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            prompt: { type: "string" },
            modelId: { type: "string" },
            personaId: { type: "string" },
            enabledIntegrations: { type: "array", items: { type: "string" } },
            webSearchEnabled: { type: "boolean" },
            searchMode: { type: "string", enum: ["none", "basic", "web", "research"] },
            searchComplexity: { type: "number" },
            includeReasoning: { type: "boolean" },
            reasoningEffort: { type: "string" },
          },
          required: ["prompt", "modelId"],
        },
      },
      recurrence: { type: "object", description: "Optional recurrence replacement." },
      timezone: { type: "string" },
      status: { type: "string", enum: ["active", "paused"] },
    },
  },
  execute: async (toolCtx, args) => {
    const isPro = await toolCtx.ctx.runQuery(
      internal.preferences.queries.checkProStatus,
      { userId: toolCtx.userId },
    );
    if (!isPro) {
      return {
        success: false,
        data: null,
        error: "Scheduled jobs are a Pro feature — upgrade to manage recurring AI tasks.",
      };
    }

    const jobIdArg = args.jobId as string | undefined;
    const jobName = args.jobName as string | undefined;
    if (!jobIdArg && !jobName) {
      return { success: false, data: null, error: "Provide either 'jobId' or 'jobName'." };
    }

    const jobs = await toolCtx.ctx.runQuery(
      internal.scheduledJobs.queries.listJobsInternal,
      { userId: toolCtx.userId },
    );

    let resolvedJobId: Id<"scheduledJobs"> | null = null;
    if (jobIdArg) {
      const direct = jobs.find((job: Record<string, unknown>) => job._id === jobIdArg);
      if (!direct) {
        return { success: false, data: null, error: `No scheduled job found with ID "${jobIdArg}".` };
      }
      resolvedJobId = direct._id as Id<"scheduledJobs">;
    } else if (jobName) {
      const needle = jobName.toLowerCase();
      const matches = jobs.filter((job: Record<string, unknown>) =>
        String(job.name ?? "").toLowerCase().includes(needle),
      );
      if (matches.length === 0) {
        return { success: false, data: null, error: `No scheduled job found matching "${jobName}".` };
      }
      if (matches.length > 1) {
        return {
          success: false,
          data: { ambiguousMatches: matches.map((job: Record<string, unknown>) => job.name) },
          error: `Multiple jobs match "${jobName}".`,
        };
      }
      resolvedJobId = matches[0]._id as Id<"scheduledJobs">;
    }

    const steps = Array.isArray(args.steps)
      ? args.steps.map((step: any) => ({
          title: typeof step.title === "string" ? step.title : undefined,
          prompt: step.prompt,
          modelId: step.modelId,
          personaId: typeof step.personaId === "string" ? step.personaId as Id<"personas"> : undefined,
          enabledIntegrations: Array.isArray(step.enabledIntegrations) ? step.enabledIntegrations : undefined,
          webSearchEnabled: typeof step.webSearchEnabled === "boolean" ? step.webSearchEnabled : undefined,
          searchMode: (step.searchMode === "none"
            || step.searchMode === "basic"
            || step.searchMode === "web"
            || step.searchMode === "research")
            ? step.searchMode
            : undefined,
          searchComplexity: typeof step.searchComplexity === "number" ? step.searchComplexity : undefined,
          includeReasoning: typeof step.includeReasoning === "boolean" ? step.includeReasoning : undefined,
          reasoningEffort: typeof step.reasoningEffort === "string" ? step.reasoningEffort : undefined,
        }))
      : undefined;

    try {
      const status = args.status === "active"
        ? "active"
        : args.status === "paused"
          ? "paused"
          : undefined;

      await toolCtx.ctx.runMutation(
        internal.scheduledJobs.mutations.updateJobInternal,
        {
          jobId: resolvedJobId!,
          userId: toolCtx.userId,
          name: typeof args.name === "string" ? args.name : undefined,
          prompt: typeof args.prompt === "string" ? args.prompt : undefined,
          modelId: typeof args.modelId === "string" ? args.modelId : undefined,
          personaId: typeof args.personaId === "string"
            ? (args.personaId.trim() ? args.personaId as Id<"personas"> : null)
            : undefined,
          steps,
          recurrence: (args.recurrence as any) ?? undefined,
          timezone: typeof args.timezone === "string" ? args.timezone : undefined,
          targetFolderId: typeof args.targetFolderId === "string"
            ? (args.targetFolderId.trim() ? args.targetFolderId as Id<"folders"> : null)
            : undefined,
          status,
        },
      );
      return {
        success: true,
        data: {
          updatedJobId: resolvedJobId,
          message: "Scheduled job updated.",
        },
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: `Failed to update scheduled job: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});
