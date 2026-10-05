import type { WorkflowCtx } from "@convex-dev/workflow";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { runLocalDecisionHelper } from "../runtime_host/decision_workflow";
import { choiceAnswer } from "../decisions/client";
import { discussionDecisionRequest, moderatorDecisionRequest, projectDiscussionDecision, type DiscussionOutcome } from "./decision_policy";
import { localJudgeMessages, parseLocalJudgment, localModeratorNotes } from "./local_decision_policy";
import { fallbackModeratorDirective } from "./moderator_directive";
import type { RunCycleArgs } from "./actions_run_cycle_types";

export async function localAutonomousDecision(step: WorkflowCtx, args: RunCycleArgs,
  session: Doc<"autonomousSessions">, purpose: "discussion" | "moderator", participantIndex?: number,
): Promise<DiscussionOutcome | string | null> {
  if (!args.executionAttemptId || args.executionFence === undefined) return null;
  const context = await step.runQuery(internal.autonomous.decision_context.getDecisionContext, {
    chatId: session.chatId, userId: args.userId, parentMessageIds: session.parentMessageIds,
  });
  if (!context) return null;
  const participants = await step.runQuery(internal.autonomous.local_turns.participantIds, { sessionId: session._id });
  const next = args.participantConfigs.find(item => item.participantId === session.turnOrder[participantIndex ?? 0]);
  const moderatorPersona = purpose === "moderator" && args.moderatorConfig?.personaId
    ? await step.runQuery(internal.chat.queries.getPersona, { personaId: args.moderatorConfig.personaId, userId: args.userId }) : null;
  const request = purpose === "discussion" ? discussionDecisionRequest(context) : moderatorDecisionRequest({
    ...context, moderator: { name: args.moderatorConfig?.displayName ?? "Moderator", role: moderatorPersona?.systemPrompt },
    nextParticipant: { name: next?.displayName ?? "Participant", role: next?.systemPrompt },
  });
  const content = await runLocalDecisionHelper(step, {
    parentAttemptId: args.executionAttemptId, parentFence: args.executionFence,
    chatId: session.chatId, sourceMessageId: context.messageId,
    requestKey: `${purpose}:${args.cycle}:${participantIndex ?? "end"}`, participantIds: participants,
    messages: localJudgeMessages(request),
  });
  const result = parseLocalJudgment(content, request);
  if (purpose === "discussion") return result ? projectDiscussionDecision(result) : null;
  if (!result) return fallbackModeratorDirective();
  const intervention = choiceAnswer(result, "intervention");
  return intervention === "no_intervention" ? null : localModeratorNotes[intervention] ?? fallbackModeratorDirective();
}
