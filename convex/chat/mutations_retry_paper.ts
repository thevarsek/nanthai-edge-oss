import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { ConvexError } from "convex/values";
import type { AnalyticsClientMetadata } from "../analytics/client_metadata";
import { reuseAdvisorBatchForRetry } from "../advisors/retry";
import type { PipelineArgs } from "../search/workflow_shared";
import {
  createAssistantMessagesAndJobs,
  type SendParticipantConfig,
} from "./mutation_send_helpers";
import type { RetryContract } from "./retry_contract";

export interface PaperRetrySource {
  session: Doc<"searchSessions">;
  message: Doc<"messages">;
}

function hasSameParents(
  left: Id<"messages">[],
  right: Id<"messages">[],
): boolean {
  return left.length === right.length
    && left.every((parentId, index) => parentId === right[index]);
}

async function paperSourceForSession(
  ctx: MutationCtx,
  session: Doc<"searchSessions"> | null,
): Promise<PaperRetrySource | undefined> {
  if (!session || session.mode !== "paper") return undefined;
  const message = await ctx.db.get(session.assistantMessageId);
  if (!message) return undefined;
  return { session, message };
}

/**
 * Resolve both direct paper responses and the short-lived malformed retry
 * branches created before paper was represented in RetryContract.
 */
export async function resolvePaperRetrySource(
  ctx: MutationCtx,
  message: Doc<"messages">,
  options: { includeSiblingBranches: boolean },
): Promise<PaperRetrySource | undefined> {
  if (message.searchSessionId) {
    const direct = await paperSourceForSession(
      ctx,
      await ctx.db.get(message.searchSessionId),
    );
    if (direct) return direct;
  }
  if (!options.includeSiblingBranches) return undefined;

  const candidates = await ctx.db
    .query("searchSessions")
    .withIndex("by_chat", (q) => q.eq("chatId", message.chatId))
    .order("desc")
    .take(50);
  for (const session of candidates) {
    if (session.mode !== "paper") continue;
    const source = await paperSourceForSession(ctx, session);
    if (source && hasSameParents(source.message.parentMessageIds, message.parentMessageIds)) {
      return source;
    }
  }
  return undefined;
}

export async function createResearchPaperRetry(
  ctx: MutationCtx,
  args: {
    originalMessage: Doc<"messages">;
    paperSource: PaperRetrySource;
    chat: Doc<"chats">;
    userId: string;
    retryContract: RetryContract;
    expandMultiModelGroups?: boolean;
    analytics?: AnalyticsClientMetadata;
    now: number;
  },
): Promise<{ assistantMessageIds: Id<"messages">[] }> {
  if (args.retryContract.participants.length !== 1) {
    throw new ConvexError({
      code: "VALIDATION",
      message: "Research Paper retries require a single participant.",
    });
  }
  const userMessageId = args.originalMessage.parentMessageIds[0];
  if (!userMessageId) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Cannot retry a research paper without its source user message",
    });
  }
  const userMessage = await ctx.db.get(userMessageId);
  const query = userMessage?.role === "user" ? userMessage.content.trim() : "";
  if (!query) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Cannot retry a research paper without its source prompt",
    });
  }

  const participant = args.retryContract.participants[0] as SendParticipantConfig;
  const { assistantMessageIds, generationJobIds } =
    await createAssistantMessagesAndJobs(ctx, {
      chatId: args.originalMessage.chatId,
      userId: args.userId,
      participants: [participant],
      parentMessageIds: args.originalMessage.parentMessageIds,
      assistantCreatedAt: args.now,
      jobCreatedAt: args.now,
      enabledIntegrations: args.retryContract.enabledIntegrations,
      subagentsEnabled: false,
      turnSkillOverrides: args.retryContract.turnSkillOverrides,
      turnIntegrationOverrides: args.retryContract.turnIntegrationOverrides,
      retryContract: args.retryContract,
      analytics: args.analytics,
      analyticsSource: "research_paper",
    });
  const assistantMessageId = assistantMessageIds[0];
  const jobId = generationJobIds[0];
  if (!assistantMessageId || !jobId) {
    throw new ConvexError({
      code: "INTERNAL_ERROR",
      message: "Research Paper retry could not create its generation records.",
    });
  }

  await reuseAdvisorBatchForRetry(ctx, {
    sourceMessage: args.paperSource.message,
    targetMessageIds: [assistantMessageId],
    userId: args.userId,
  });

  const complexity = Math.max(
    1,
    Math.min(
      3,
      Math.round(
        args.retryContract.searchComplexity
          ?? args.paperSource.session.complexity,
      ),
    ),
  );
  const sessionId = await ctx.db.insert("searchSessions", {
    chatId: args.originalMessage.chatId,
    userId: args.userId,
    assistantMessageId,
    query,
    mode: "paper",
    complexity,
    status: "planning",
    progress: 0,
    currentPhase: "planning",
    phaseOrder: 0,
    participantId: participant.personaId ?? undefined,
    startedAt: args.now,
  });
  await ctx.db.patch(assistantMessageId, { searchSessionId: sessionId });
  await ctx.db.patch(args.chat._id, {
    updatedAt: args.now,
    activeBranchLeafId: assistantMessageId,
    activeBranchLeafFocusOrder: undefined,
  });

  const pipelineArgs: PipelineArgs = {
    sessionId,
    assistantMessageId,
    jobId,
    chatId: args.originalMessage.chatId,
    userMessageId,
    userId: args.userId,
    query,
    complexity,
    expandMultiModelGroups: args.expandMultiModelGroups ?? true,
    modelId: participant.modelId,
    personaId: participant.personaId ?? undefined,
    systemPrompt: participant.systemPrompt ?? undefined,
    temperature: participant.temperature,
    maxTokens: participant.maxTokens,
    includeReasoning: participant.includeReasoning,
    reasoningEffort: participant.reasoningEffort ?? undefined,
    enabledIntegrations: args.retryContract.enabledIntegrations,
    turnIntegrationOverrides: args.retryContract.turnIntegrationOverrides,
    subagentsEnabled: false,
    analytics: args.analytics,
    analyticsSource: "research_paper",
  };
  await ctx.scheduler.runAfter(
    0,
    internal.search.workflow.researchPaperPipeline,
    pipelineArgs,
  );
  return { assistantMessageIds };
}
