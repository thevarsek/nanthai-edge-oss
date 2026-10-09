import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { createTool } from "./registry";

export const updateCollaborationWork = createTool({
  name: "update_collaboration_work",
  description: "Publish your assigned Collaboration work, report a blocker, or review exact work evidence. Use the work ID and requirement/evidence revisions from your committed work context. Publishing stages evidence until your current reply completes. This cannot create permission, merge or publish externally.",
  parameters: { type: "object", properties: {
    work_id: { type: "string" }, action: { type: "string", enum: ["publish", "block", "accept", "rework"] },
    description: { type: "string" }, source_revision: { type: "string" },
    requirement_revision: { type: "number" }, evidence_revision: { type: "number" },
  }, required: ["work_id", "action", "description", "source_revision", "requirement_revision", "evidence_revision"] },
  effectPolicy: { effect: "write", retry: "safe" },
  execute: async (toolCtx, args) => {
    if (!toolCtx.jobId || !toolCtx.executionAttemptId || toolCtx.executionFence === undefined
      || !toolCtx.operationIdempotencyKey) {
      return { success: false, data: null, error: "An owned work execution is required." };
    }
    if (typeof args.work_id !== "string" || typeof args.description !== "string"
      || typeof args.source_revision !== "string" || typeof args.requirement_revision !== "number"
      || typeof args.evidence_revision !== "number"
      || !["publish", "block", "accept", "rework"].includes(String(args.action))) {
      return { success: false, data: null, error: "Invalid work result arguments." };
    }
    await toolCtx.ctx.runMutation(internal.collaboration.work_reviews.proposeWorkResult, {
      userId: toolCtx.userId, workId: args.work_id as Id<"collaborationWork">,
      jobId: toolCtx.jobId as Id<"generationJobs">,
      attemptId: toolCtx.executionAttemptId, fence: toolCtx.executionFence,
      action: args.action as "publish" | "block" | "accept" | "rework",
      description: args.description, sourceRevision: args.source_revision,
      requirementRevision: args.requirement_revision, evidenceRevision: args.evidence_revision,
      operationKey: toolCtx.operationIdempotencyKey,
    });
    return { success: true, data: { action: args.action, workId: args.work_id } };
  },
});
