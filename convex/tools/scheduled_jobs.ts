// convex/tools/scheduled_jobs.ts
// =============================================================================
// AI tools for scheduled job management: create, list, delete.
//
// These are Tier 1 tools (always on, no OAuth required). They let the AI
// create/manage scheduled jobs conversationally — e.g. "remind me every
// morning to summarise my inbox".
// =============================================================================

import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import type { Recurrence } from "../scheduledJobs/recurrence";
import { createTool } from "./registry";

// ── create_scheduled_job ───────────────────────────────────────────────

export const createScheduledJob = createTool({
  name: "create_scheduled_job",
  description:
    "Create a recurring scheduled job that runs a prompt on a schedule. " +
    "Use when the user wants recurring tasks like daily summaries, weekly reports, " +
    "morning briefings, or periodic reminders. The job creates a new chat each run " +
    "and notifies the user when complete. Recurrence types: 'interval' (every N " +
    "minutes, min 15), 'daily' (specific hour/minute UTC), 'weekly' (specific day " +
    "and time UTC), 'cron' (5-field cron expression), 'manual' (only via Run Now).",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Short descriptive name for the job (e.g. 'Morning Gmail Summary'). Max 200 chars.",
      },
      prompt: {
        type: "string",
        description:
          "The prompt to execute each time the job runs. Be specific — this runs " +
          "without additional user context. Include what tools/integrations the job " +
          "should use and what output format is expected.",
      },
      modelId: {
        type: "string",
        description:
          "OpenRouter model ID to use (e.g. 'anthropic/claude-sonnet-4', " +
          "'google/gemini-2.5-flash'). If omitted, uses the user's default model.",
      },
      recurrence: {
        type: "object",
        description:
          "Schedule configuration. Must include 'type' plus type-specific fields. " +
          "For 'interval': { type: 'interval', minutes: 60 }. " +
          "For 'daily': { type: 'daily', hourUTC: 8, minuteUTC: 0 }. " +
          "For 'weekly': { type: 'weekly', dayOfWeek: 1, hourUTC: 9, minuteUTC: 0 } (0=Sun). " +
          "For 'cron': { type: 'cron', expression: '0 8 * * 1-5' }. " +
          "For 'manual': { type: 'manual' }.",
        properties: {
          type: {
            type: "string",
            enum: ["interval", "daily", "weekly", "cron", "manual"],
          },
          minutes: { type: "number", description: "Interval minutes (min 15). Required for 'interval'." },
          hourUTC: { type: "number", description: "Hour in UTC (0-23). Required for 'daily' and 'weekly'." },
          minuteUTC: { type: "number", description: "Minute (0-59). Required for 'daily' and 'weekly'." },
          dayOfWeek: { type: "number", description: "Day of week (0=Sun, 6=Sat). Required for 'weekly'." },
          expression: { type: "string", description: "5-field cron expression. Required for 'cron'." },
        },
        required: ["type"],
      },
      enabledIntegrations: {
        type: "array",
        items: { type: "string" },
        description:
          "OAuth integrations to enable for this job's execution (e.g. ['gmail', 'calendar']). " +
          "Only relevant if the prompt needs external service access.",
      },
      webSearchEnabled: {
        type: "boolean",
        description: "Whether to enable web search during job execution.",
      },
    },
    required: ["name", "prompt", "recurrence"],
  },

  execute: async (toolCtx, args) => {
    // Pro gating: scheduled jobs are a Pro-only feature
    const isPro = await toolCtx.ctx.runQuery(
      internal.preferences.queries.checkProStatus,
      { userId: toolCtx.userId },
    );
    if (!isPro) {
      return {
        success: false,
        data: null,
        error:
          "Scheduled jobs are a Pro feature — upgrade to automate recurring AI tasks.",
      };
    }

    const name = args.name as string | undefined;
    const prompt = args.prompt as string | undefined;
    const recurrence = args.recurrence as Recurrence | undefined;

    if (!name || typeof name !== "string" || !name.trim()) {
      return { success: false, data: null, error: "Missing or empty 'name'" };
    }
    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return { success: false, data: null, error: "Missing or empty 'prompt'" };
    }
    if (!recurrence || typeof recurrence !== "object" || !recurrence.type) {
      return { success: false, data: null, error: "Missing or invalid 'recurrence'. Must include 'type'." };
    }

    // Resolve modelId: explicit arg → user's default → fail
    let modelId = args.modelId as string | undefined;
    if (!modelId) {
      const userDefault = await toolCtx.ctx.runQuery(
        internal.preferences.queries.getUserDefaultModel,
        { userId: toolCtx.userId },
      );
      if (!userDefault) {
        return {
          success: false,
          data: null,
          error:
            "No model specified and no default model set. " +
            "Please either provide a 'modelId' or set a default model in Settings → Models.",
        };
      }
      modelId = userDefault;
    }

    try {
      const jobId = await toolCtx.ctx.runMutation(
        internal.scheduledJobs.mutations.createJobInternal,
        {
          userId: toolCtx.userId,
          name: name.trim(),
          prompt,
          modelId,
          recurrence,
          enabledIntegrations: (args.enabledIntegrations as string[]) || undefined,
          webSearchEnabled: args.webSearchEnabled !== undefined ? (args.webSearchEnabled as boolean) : undefined,
        },
      );

      // Build a human-friendly schedule description
      const scheduleDesc = describeRecurrence(recurrence);

      return {
        success: true,
        data: {
          jobId,
          name: name.trim(),
          schedule: scheduleDesc,
          message:
            `Created scheduled job "${name.trim()}" (${scheduleDesc}). ` +
            `Each run creates a new chat with the results, and the user gets a ` +
            `notification when it completes. The job can be managed in Settings → Scheduled Jobs.`,
        },
      };
    } catch (e) {
      return {
        success: false,
        data: null,
        error: `Failed to create scheduled job: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
});

// ── list_scheduled_jobs ────────────────────────────────────────────────

export const listScheduledJobs = createTool({
  name: "list_scheduled_jobs",
  description:
    "List all of the user's scheduled jobs with their status, schedule, " +
    "and next run time. Use when the user asks about their scheduled jobs, " +
    "automations, or recurring tasks.",
  parameters: {
    type: "object",
    properties: {},
  },

  execute: async (toolCtx) => {
    try {
      const jobs = await toolCtx.ctx.runQuery(
        internal.scheduledJobs.queries.listJobsInternal,
        { userId: toolCtx.userId },
      );

      if (jobs.length === 0) {
        return {
          success: true,
          data: {
            jobs: [],
            message: "No scheduled jobs found. The user can create one by describing a recurring task.",
          },
        };
      }

      const summaries = jobs.map((job: Record<string, unknown>) => ({
        id: job._id,
        name: job.name,
        status: job.status,
        schedule: describeRecurrence(job.recurrence as Record<string, unknown>),
        nextRunAt: job.nextRunAt ? new Date(job.nextRunAt as number).toISOString() : null,
        lastRunAt: job.lastRunAt ? new Date(job.lastRunAt as number).toISOString() : null,
        lastRunStatus: job.lastRunStatus ?? null,
        totalRuns: job.totalRuns ?? 0,
        createdBy: job.createdBy ?? "user",
      }));

      return {
        success: true,
        data: {
          jobs: summaries,
          count: summaries.length,
          message: `Found ${summaries.length} scheduled job${summaries.length === 1 ? "" : "s"}.`,
        },
      };
    } catch (e) {
      return {
        success: false,
        data: null,
        error: `Failed to list scheduled jobs: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
});

// ── delete_scheduled_job ───────────────────────────────────────────────

export const deleteScheduledJob = createTool({
  name: "delete_scheduled_job",
  description:
    "Delete a scheduled job by name or ID. Cancels any pending execution " +
    "and removes all run history. Use when the user wants to remove or cancel " +
    "a recurring task. Supports lookup by name (case-insensitive partial match) " +
    "for natural language requests.",
  parameters: {
    type: "object",
    properties: {
      jobId: {
        type: "string",
        description: "The job's Convex document ID, if known.",
      },
      jobName: {
        type: "string",
        description:
          "The job name to search for (case-insensitive). Used when the user " +
          "refers to the job by name rather than ID.",
      },
    },
  },

  execute: async (toolCtx, args) => {
    const jobId = args.jobId as string | undefined;
    const jobName = args.jobName as string | undefined;

    if (!jobId && !jobName) {
      return {
        success: false,
        data: null,
        error: "Provide either 'jobId' or 'jobName' to identify the job to delete.",
      };
    }

    try {
      // Resolve the job — by ID or by name lookup
      let resolvedJobId: Id<"scheduledJobs"> | null = null;
      let resolvedJobName: string | null = null;

      if (jobId) {
        // Direct ID lookup — verify it exists and belongs to user
        const jobs = await toolCtx.ctx.runQuery(
          internal.scheduledJobs.queries.listJobsInternal,
          { userId: toolCtx.userId },
        );
        const match = jobs.find((j: Record<string, unknown>) => j._id === jobId);
        if (!match) {
          return { success: false, data: null, error: `No scheduled job found with ID "${jobId}".` };
        }
        resolvedJobId = match._id as Id<"scheduledJobs">;
        resolvedJobName = match.name as string;
      } else if (jobName) {
        // Name-based lookup — case-insensitive partial match
        const jobs = await toolCtx.ctx.runQuery(
          internal.scheduledJobs.queries.listJobsInternal,
          { userId: toolCtx.userId },
        );

        const needle = jobName.toLowerCase();
        const matches = jobs.filter((j: Record<string, unknown>) =>
          (j.name as string).toLowerCase().includes(needle),
        );

        if (matches.length === 0) {
          return {
            success: false,
            data: null,
            error: `No scheduled job found matching "${jobName}". Use list_scheduled_jobs to see available jobs.`,
          };
        }
        if (matches.length > 1) {
          const names = matches.map((j: Record<string, unknown>) => j.name);
          return {
            success: false,
            data: { ambiguousMatches: names },
            error:
              `Multiple jobs match "${jobName}": ${names.join(", ")}. ` +
              `Please be more specific or use the exact name.`,
          };
        }
        resolvedJobId = matches[0]._id as Id<"scheduledJobs">;
        resolvedJobName = matches[0].name as string;
      }

      // Delete the job
      await toolCtx.ctx.runMutation(
        internal.scheduledJobs.mutations.deleteJobInternal,
        { jobId: resolvedJobId!, userId: toolCtx.userId },
      );

      return {
        success: true,
        data: {
          deletedJobId: resolvedJobId as string,
          deletedJobName: resolvedJobName,
          message: `Deleted scheduled job "${resolvedJobName}". Any pending execution has been cancelled.`,
        },
      };
    } catch (e) {
      return {
        success: false,
        data: null,
        error: `Failed to delete scheduled job: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
});

// ── Helpers ────────────────────────────────────────────────────────────

/** Produce a human-friendly description of a recurrence config. */
function describeRecurrence(rec: Record<string, unknown>): string {
  switch (rec.type) {
    case "interval":
      return `every ${rec.minutes} minutes`;
    case "daily":
      return `daily at ${String(rec.hourUTC).padStart(2, "0")}:${String(rec.minuteUTC).padStart(2, "0")} UTC`;
    case "weekly": {
      const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const day = days[rec.dayOfWeek as number] ?? `day ${rec.dayOfWeek}`;
      return `weekly on ${day} at ${String(rec.hourUTC).padStart(2, "0")}:${String(rec.minuteUTC).padStart(2, "0")} UTC`;
    }
    case "cron":
      return `cron: ${rec.expression}`;
    case "manual":
      return "manual (Run Now only)";
    default:
      return "unknown schedule";
  }
}
