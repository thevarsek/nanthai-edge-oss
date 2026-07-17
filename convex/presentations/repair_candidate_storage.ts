"use node";

import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { deletePresentationRepairCandidateRef } from "./deferred_workflow_refs";
import { PRESENTATION_WORKFLOW_LEASE_MS } from "./limits";

export async function deletePresentationRepairCandidate(
  ctx: ActionCtx,
  storageId: Id<"_storage"> | undefined,
): Promise<void> {
  if (!storageId) return;
  try {
    await ctx.storage.delete(storageId);
  } catch {
    // The timeout cleanup or another terminal path may already have deleted it.
  }
}

export async function storePresentationRepairCandidate(
  ctx: ActionCtx,
  content: string,
): Promise<Id<"_storage">> {
  const storageId = await ctx.storage.store(new Blob(
    [content],
    { type: "application/json" },
  ));
  try {
    await ctx.scheduler.runAfter(
      PRESENTATION_WORKFLOW_LEASE_MS,
      deletePresentationRepairCandidateRef,
      { storageId },
    );
    return storageId;
  } catch (error) {
    await deletePresentationRepairCandidate(ctx, storageId);
    throw error;
  }
}
