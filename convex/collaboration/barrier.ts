import { internalQuery } from "../_generated/server";
import { v } from "convex/values";

const TERMINAL_JOB_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "timedOut",
]);

export const getDecisionBarrier = internalQuery({
  args: {
    exchangeId: v.id("collaborationExchanges"),
    decisionId: v.id("collaborationDecisions"),
  },
  handler: async (ctx, args) => {
    const [exchange, decision] = await Promise.all([
      ctx.db.get(args.exchangeId),
      ctx.db.get(args.decisionId),
    ]);
    if (!exchange || !decision || decision.exchangeId !== exchange._id) {
      return { terminal: true, stale: true, jobs: [] };
    }
    const jobs = await Promise.all(
      (decision.generationJobIds ?? []).map((jobId) => ctx.db.get(jobId)),
    );
    return {
      terminal:
        jobs.length > 0 &&
        jobs.every((job) => job && TERMINAL_JOB_STATUSES.has(job.status)),
      stale: false,
      jobs: jobs.map((job) => ({
        id: job?._id,
        status: job?.status ?? "missing",
      })),
    };
  },
});
