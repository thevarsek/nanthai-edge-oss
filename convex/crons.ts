// convex/crons.ts
// =============================================================================
// Scheduled jobs: model catalog sync, benchmark sync, stale job cleanup,
// memory consolidation.
// =============================================================================

import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Refresh model catalog from OpenRouter every hour
crons.interval(
  "refreshModelCatalog",
  { hours: 1 },
  internal.models.sync.syncFromOpenRouter,
);

// Sync Artificial Analysis benchmarks daily at 2:00 UTC
crons.cron(
  "syncArtificialAnalysis",
  "0 2 * * *",
  internal.models.artificial_analysis_sync.syncBenchmarks,
);

// Sync OpenRouter category/use-case rankings every 6 hours
crons.interval(
  "syncOpenRouterUseCases",
  { hours: 6 },
  internal.models.openrouter_usecase_sync.syncUseCases,
);

// Clean up stale generation jobs every 15 minutes
crons.interval(
  "cleanStaleJobs",
  { minutes: 15 },
  internal.jobs.cleanup.cleanStale,
);

// Consolidate duplicate memories daily at 3:00 UTC
crons.cron(
  "consolidateMemories",
  "0 3 * * *",
  internal.memory.operations.consolidate,
);

// Clean up stale search phases and sessions daily at 4:00 UTC (7-day retention)
crons.cron(
  "cleanStaleSearchPhases",
  "0 4 * * *",
  internal.search.mutations.cleanStaleSearchPhases,
);

// M13: Clean up old job run records daily at 5:00 UTC (30-day retention)
crons.cron(
  "cleanOldJobRuns",
  "0 5 * * *",
  internal.scheduledJobs.mutations.cleanOldJobRuns,
);

// Max runtime: mark paused sandbox sessions eligible for cleanup every hour.
crons.interval(
  "markRuntimeCleanupCandidates",
  { hours: 1 },
  internal.runtime.mutations.markCleanupCandidatesInternal,
);

// Max runtime: delete marked paused sandbox sessions daily at 6:00 UTC.
crons.cron(
  "cleanupRuntimeSandboxes",
  "0 6 * * *",
  internal.runtime.actions.cleanupMarkedSessions,
);

export default crons;
