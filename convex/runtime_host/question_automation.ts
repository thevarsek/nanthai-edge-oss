import { makeFunctionReference, type FunctionReference } from "convex/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { appendExecutionEvent } from "../execution/control_plane";
import { respondToRuntimeInput } from "./input_requests";
import { inspectPermissionRuntime } from "./permission_live_context";
import { automaticQuestionContent } from "./question_policy";

type Args = { requestId: Id<"runtimePermissionRequests">; expectedResponseAt: number };
export const continueQuestionRef = makeFunctionReference<"mutation", Args, boolean>(
  "runtime_host/question_automation:continueQuestion",
) as unknown as FunctionReference<"mutation", "internal", Args, boolean>;

export async function continueQuestionHandler(ctx: MutationCtx, args: Args & { now?: number }): Promise<boolean> {
  const request = await ctx.db.get(args.requestId);
  const now = args.now ?? Date.now();
  if (!request?.inputSchema || request.status !== "pending"
    || request.automaticResponseAt !== args.expectedResponseAt || args.expectedResponseAt > now) return false;
  const content = automaticQuestionContent(request.inputSchema);
  if (!content || !(await inspectPermissionRuntime(ctx, request, now)).ready) return false;
  await respondToRuntimeInput(ctx, { userId: request.userId, requestId: request._id,
    outcome: "submitted", content: JSON.stringify(content), responseSource: "automatic", now });
  await appendExecutionEvent(ctx, { attemptId: request.attemptId, fence: request.fence,
    type: "model_activity", eventId: `question-auto-${String(request._id)}`,
    summary: "No human answer received. The AI continued using its own judgment under your local question setting.", now });
  return true;
}

export const continueQuestion = internalMutation({
  args: { requestId: v.id("runtimePermissionRequests"), expectedResponseAt: v.number() },
  returns: v.boolean(), handler: continueQuestionHandler,
});
