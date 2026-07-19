import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { DeferredGenerationSnapshot } from "./types";

export async function scheduleLegacyDeferredGeneration(
  ctx: MutationCtx,
  rawSnapshot: unknown,
): Promise<Array<Id<"_scheduled_functions">>> {
  const snapshot = rawSnapshot as DeferredGenerationSnapshot;
  if (snapshot.kind === "generation" && snapshot.args) {
    return [await ctx.scheduler.runAfter(
      0,
      internal.chat.actions_runtime.runGeneration,
      { ...snapshot.args, enqueuedAt: Date.now() },
    )];
  }
  if (snapshot.kind === "advanced_search" && Array.isArray(snapshot.requests)) {
    return await Promise.all(snapshot.requests.map(async (request) =>
      await ctx.scheduler.runAfter(0, internal.search.actions.runWebSearch, request)
    ));
  }
  if (snapshot.kind === "research_paper" && snapshot.request) {
    return [await ctx.scheduler.runAfter(
      0,
      internal.search.workflow.researchPaperPipeline,
      snapshot.request,
    )];
  }
  throw new Error("Invalid deferred Advisor generation snapshot");
}
