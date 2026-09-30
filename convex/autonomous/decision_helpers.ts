import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { getRequiredUserOpenRouterApiKey } from "../lib/user_secrets";
import { isZdrEnabled } from "../lib/openrouter_zdr";
import { choiceAnswer } from "../decisions/client";
import { tryJevDecision } from "../decisions/service";
import { discussionDecisionRequest, projectDiscussionDecision, moderatorDecisionRequest, interventionInstructions } from "./decision_policy";

export async function judgeDiscussion(ctx: ActionCtx, args: { chatId: Id<"chats">; userId: string; parentMessageIds: Id<"messages">[] }) {
  try {
    const context = await ctx.runQuery(internal.autonomous.decision_context.getDecisionContext, args);
    if (!context || !Array.isArray(context.messages)) return null;
    const [apiKey, preferences] = await Promise.all([
      getRequiredUserOpenRouterApiKey(ctx, args.userId),
      ctx.runQuery(internal.chat.queries.getUserPreferences, { userId: args.userId }),
    ]);
    const result = await tryJevDecision(ctx, {
      ...discussionDecisionRequest(context), ...args, messageId: context.messageId,
      useCase: "discussion", apiKey, requireZdr: isZdrEnabled(preferences),
    });
    return result ? projectDiscussionDecision(result) : null;
  } catch {
    console.warn("[m60:discussion] decision preparation failed; using existing helper");
    return null;
  }
}

export async function judgeModeratorIntervention(
  ctx: Pick<ActionCtx, "runQuery"> & Partial<Pick<ActionCtx, "scheduler" | "runMutation">>,
  args: { chatId: Id<"chats">; userId: string },
  roles: { moderator: { name: string; role?: string }; nextParticipant: { name: string; role?: string } },
): Promise<string | null> {
  try {
    const context = await ctx.runQuery(internal.autonomous.decision_context.getDecisionContext, args);
    if (!context || !Array.isArray(context.messages)) return null;
    const [apiKey, preferences] = await Promise.all([
      getRequiredUserOpenRouterApiKey(ctx, args.userId),
      ctx.runQuery(internal.chat.queries.getUserPreferences, { userId: args.userId }),
    ]);
    const result = await tryJevDecision(ctx, {
      ...moderatorDecisionRequest({ ...context, ...roles }), ...args, messageId: context.messageId,
      useCase: "moderator", apiKey, requireZdr: isZdrEnabled(preferences),
    });
    if (!result) return null;
    const category = choiceAnswer(result, "intervention");
    return category === "no_intervention" ? category : interventionInstructions[category] ?? null;
  } catch {
    console.warn("[m60:moderator] decision preparation failed; using existing helper");
    return null;
  }
}
