import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { injectAdvisorNotes } from "../advisors/notes";
import { resolveGenerationMemoryContext } from "../chat/action_memory_helpers";
import { prepareRequestContextForGeneration } from "../chat/actions_context_assembly_integration";
import { prepareGenerationContext } from "../chat/actions_run_generation_context";
import type { RunGenerationParticipantArgs } from "../chat/generation_continuation_shared";
import { buildRequestMessages } from "../chat/helpers";
import type { ContextMessage } from "../chat/helpers_types";
import { branchPathIds } from "../chat/helpers_utils";
import { autonomousRuntimeContext } from "./autonomous_context";
import {
  appendCollaborationHandoff,
  type PreparedParticipantTurn,
  type PreparedTurnCausality,
} from "../chat/prepared_participant_turn";

export async function prepareLocalParticipantTurn(
  ctx: ActionCtx,
  args: RunGenerationParticipantArgs,
  options: {
    personaPrompt: string;
  },
): Promise<PreparedParticipantTurn> {
  assertSupportedInitialCapabilities(args);
  const generationContext = await prepareGenerationContext(ctx, {
    chatId: args.chatId,
    userMessageId: args.userMessageId,
    assistantMessageIds: args.assistantMessageIds,
    generationJobIds: args.generationJobIds,
    participants: [args.participant],
    userId: args.userId,
    expandMultiModelGroups: args.expandMultiModelGroups,
    webSearchEnabled: args.webSearchEnabled,
  });
  const allMessages = generationContext.allMessages as unknown as ContextMessage[];
  const memory = await resolveGenerationMemoryContext(ctx, {
    messages: allMessages.map((message) => ({
      _id: message._id as Id<"messages">,
      role: message.role,
      content: message.content,
      parentMessageIds: message.parentMessageIds,
    })),
    userMessageId: args.userMessageId,
    userId: args.userId,
    personaId: args.participant.personaId,
    chatId: args.chatId,
    assistantMessageId: args.participant.messageId,
    requireZdr: args.requireZdrOverride === true,
  });
  const legacyMessages = buildRequestMessages({
    messages: allMessages,
    preserveMessageBoundaries: true,
    excludeMessageId: args.participant.messageId,
    systemPrompt: options.personaPrompt,
    memoryContext: memory.memoryContext,
    expandMultiModelGroups: args.expandMultiModelGroups,
    maxContextTokens:
      generationContext.modelCapabilities.get(args.participant.modelId)?.contextLength
      ?? 75_000,
  });
  const causality = collaborationCausality(allMessages, args.participant.messageId);
  const autonomous = allMessages.some(message => message._id === args.participant.messageId && message.autonomousParticipantId);
  let prepared = await prepareRequestContextForGeneration({
    ctx,
    chatId: args.chatId,
    userId: args.userId,
    assistantMessageId: args.participant.messageId,
    jobId: args.participant.jobId,
    participantId: String(args.participant.chatParticipantId),
    legacyMessages,
    preserveMessageBoundaries: true,
    conversationExpandGroups: args.expandMultiModelGroups,
    sharedMemorySources: memory.evidenceSources,
    allMessages,
    providerContextWindowTokens:
      generationContext.modelCapabilities.get(args.participant.modelId)?.contextLength,
    mode: autonomous ? "autonomous_discussion" : causality ? "collaborative_discussion" : "read_path",
    runtimeKind: autonomous ? "autonomous_discussion" : causality ? "collaborative_discussion" : "chat_generation",
    causality,
  });
  const advisorNotes = await ctx.runQuery(
    internal.advisors.queries.getAdvisorNotesForMessage,
    { messageId: args.participant.messageId },
  );
  const providerMessages = appendCollaborationHandoff(
    injectAdvisorNotes(prepared.providerMessages, advisorNotes),
    causality,
  );
  for (const message of providerMessages) {
    if (typeof message.content === "string" && message.content.startsWith("[Assigned Collaboration work]")) {
      message.content = message.content.replaceAll("update_collaboration_work", "nanthai_update_collaboration_work");
    }
  }
  prepared = { ...prepared, providerMessages,
    runtimeBranchMessageIds: [...branchPathIds(String(args.participant.messageId), new Map(allMessages.map((message) => [String(message._id), message])))],
    runtimeSourceMessages: allMessages,
  };
  return autonomous ? autonomousRuntimeContext(prepared, String(args.userMessageId), args.participant.personaName ?? "the next participant") : prepared;
}

function collaborationCausality(
  messages: ContextMessage[],
  assistantMessageId: Id<"messages">,
): PreparedTurnCausality | undefined {
  const message = messages.find((candidate) => candidate._id === assistantMessageId);
  if (
    !message?.collaborationExchangeId
    || !message.collaborationDecisionId
    || message.collaborationWave === undefined
  ) return undefined;
  return {
    exchangeId: message.collaborationExchangeId,
    decisionId: message.collaborationDecisionId,
    wave: message.collaborationWave,
    frontierMessageIds: message.parentMessageIds,
    replyToMessageIds: message.collaborationReplyToIds ?? message.parentMessageIds,
  };
}

function assertSupportedInitialCapabilities(args: RunGenerationParticipantArgs): void {
  const unsupported = [
    args.allowSubagents ? "NanthAI subagents" : null,
    args.effectiveIntegrations.length > 0 ? "integrations" : null,
    (args.directToolNames?.length ?? 0) > 0 ? "attachment tools" : null,
  ].filter((value): value is string => value !== null);
  if (unsupported.length > 0) {
    throw new Error(
      `The local Runtime Host does not yet bind ${unsupported.join(", ")} for this turn`,
    );
  }
}
