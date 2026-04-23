// convex/crons.ts
// =============================================================================
// Scheduled jobs: model catalog sync, benchmark sync, stale job cleanup,
// memory consolidation, sandbox session cleanup.
// =============================================================================

import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Refresh model catalog from OpenRouter every 4 hours.
// Models change infrequently; hourly was burning ~250 MB/month in DB bandwidth
// just for upsertBatch reads. Combined with hash-based skip (sync.ts), most
// invocations now do zero mutations.
crons.interval(
  "refreshModelCatalog",
  { hours: 4 },
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

// M27: Clean up stale sandbox sessions every 30 minutes.
// Marks "running" or "pendingCreate" sessions with no activity for 1 hour
// as "deleted", and attempts best-effort Sandbox.stop() to free VM resources.
// Also cleans up "failed" records older than 24 hours (DB hygiene).
crons.interval(
  "cleanStaleSandboxSessions",
  { minutes: 30 },
  internal.runtime.cleanup.cleanStaleSandboxSessions,
);

// M29: Sync video model capabilities from OpenRouter every 4 hours.
// Mirrors the refreshModelCatalog pattern (hash-based skip in video_sync.ts
// keeps most invocations mutation-free).
crons.interval(
  "syncVideoModels",
  { hours: 4 },
  internal.models.video_sync.syncVideoModels,
);

// Sync image-generation-capable models every 4 hours. The main
// /api/v1/models endpoint silently omits image-only models (FLUX, Sourceful,
// Seedream, etc.); this job targets ?output_modalities=image to pick them up.
// See convex/models/image_sync.ts for full rationale.
crons.interval(
  "syncImageModels",
  { hours: 4 },
  internal.models.image_sync.syncImageModels,
);

// Slack MCP schema drift check — weekly on Monday at 6:00 UTC.
// Compares Slack's live tools/list response to our committed baseline in
// convex/tools/slack/mcp_tools_snapshot.ts and logs warnings on drift.
// Uses any active Slack OAuth connection (drift affects everyone equally).
// Skips silently if no active connections exist.
crons.cron(
  "checkSlackMcpDrift",
  "0 6 * * 1",
  internal.tools.slack.drift_check.checkSlackMcpDrift,
);

export default crons;
