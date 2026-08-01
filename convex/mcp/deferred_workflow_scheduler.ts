import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type {
  GenerationContinuationCheckpoint,
  RunGenerationParticipantArgs,
} from "../chat/generation_continuation_shared";
import { durableGenerationContinuationCheckpoint } from "../chat/actions_run_generation_continuation";

export async function scheduleDeferredRemoteMcp(
  ctx: ActionCtx,
  args: RunGenerationParticipantArgs,
  checkpoint: GenerationContinuationCheckpoint,
  invocation: { invocationId: string; toolCallId: string },
): Promise<void> {
  if (!args.workflowResumeEventId) {
    throw new Error("MCP_PARENT_WORKFLOW_EVENT_REQUIRED");
  }
  const invocationDoc = await ctx.runQuery(internal.mcp.queries.getOwnedInvocationInternal, {
    userId: args.userId,
    publicId: invocation.invocationId,
  });
  if (!invocationDoc) throw new Error("MCP_DEFERRED_INVOCATION_NOT_FOUND");
  const durableCheckpoint = durableGenerationContinuationCheckpoint(
    { ...args, workflowManaged: true },
    {
      ...checkpoint,
      deferredResumeEventId: args.workflowResumeEventId,
      deferredOwnership: {
        kind: "remote_mcp",
        invocationId: invocationDoc._id,
        toolCallId: invocation.toolCallId,
      },
    },
  );
  await ctx.runMutation(internal.mcp.lifecycle_mutations.saveCheckpointAndBindInvocation, {
    userId: args.userId,
    chatId: args.chatId,
    messageId: args.participant.messageId,
    checkpoint: durableCheckpoint,
    publicId: invocation.invocationId,
    jobId: args.participant.jobId,
    toolCallId: invocation.toolCallId,
    parentResumeEventId: args.workflowResumeEventId,
  });
}
