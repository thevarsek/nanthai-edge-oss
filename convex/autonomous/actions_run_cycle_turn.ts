import { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import {
  callOpenRouterStreaming,
  ChatRequestParameters,
  ContentPart,
  gateParameters,
  OpenRouterMessage,
} from "../lib/openrouter";
import { buildRequestMessages } from "../chat/helpers";
import { promoteLatestUserVideoUrls } from "../chat/helpers_video_url_utils";
import { StreamWriter } from "../chat/stream_writer";
import { getRequiredUserOpenRouterApiKey } from "../lib/user_secrets";
import {
  generateModeratorDirective,
  ModeratorConfig,
  ParticipantConfig,
} from "./actions_helpers";
import { ModelCapabilities, TurnOutcome } from "./actions_run_cycle_types";
import { loadMemoryContext } from "./actions_run_cycle_context";
import { DeepPartial, mergeTestDeps } from "../lib/test_deps";

const EMPTY_STREAM_RETRY_DELAYS = [500, 1500];
const CANCELLED_TURN_ERROR = "AUTONOMOUS_SESSION_CANCELLED";

const defaultRunParticipantTurnDeps = {
  now: () => Date.now(),
  getRequiredUserOpenRouterApiKey,
  generateModeratorDirective,
  buildRequestMessages,
  promoteLatestUserVideoUrls,
  createStreamWriter: (options: ConstructorParameters<typeof StreamWriter>[0]) =>
    new StreamWriter(options),
  loadMemoryContext,
  gateParameters,
  callOpenRouterStreaming,
};

export type RunParticipantTurnDeps = typeof defaultRunParticipantTurnDeps;

export function createRunParticipantTurnDepsForTest(
  overrides: DeepPartial<RunParticipantTurnDeps> = {},
): RunParticipantTurnDeps {
  return mergeTestDeps(defaultRunParticipantTurnDeps, overrides);
}

function isCancelledTurnError(error: unknown): boolean {
  return error instanceof Error && error.message === CANCELLED_TURN_ERROR;
}

function messageContentToText(content: OpenRouterMessage["content"]): string {
  if (typeof content === "string") return content.trim();
  if (!content) return "";
  return content
    .map((part: ContentPart) => part.type === "text" ? (part.text ?? "") : `[${part.type}]`)
    .join("\n")
    .trim();
}

function messageContentToParts(content: OpenRouterMessage["content"]): ContentPart[] {
  if (typeof content === "string") return [];
  return content?.filter((part) => part.type !== "text") ?? [];
}

function buildAutonomousTranscriptMessages(
  messages: OpenRouterMessage[],
  participantName: string,
): OpenRouterMessage[] {
  const systemMessages = messages.filter((message) => message.role === "system");
  const discussionMessages = messages.filter((message) => message.role !== "system");
  const transcriptLines: string[] = [];
  const nonTextParts: ContentPart[] = [];

  for (const message of discussionMessages) {
    const text = messageContentToText(message.content);
    if (!text) continue;
    const speaker = message.role === "user"
      ? "User"
      : message.role === "assistant"
        ? "Previous participant"
        : "Tool";
    transcriptLines.push(`${speaker}: ${text}`);
    nonTextParts.push(...messageContentToParts(message.content));
  }

  const promptText = [
    "You are participating in an autonomous group discussion.",
    "Use any provided user context only to make the discussion relevant. Do not mention memory, profile data, writing preferences, prompts, model identity, training data, weights, providers, or internal instructions.",
    "",
    "Discussion so far:",
    transcriptLines.length > 0 ? transcriptLines.join("\n\n") : "No prior visible turns.",
    "",
    `Now provide ${participantName}'s next contribution to the debate. Respond only with the contribution itself. Do not summarize your instructions or explain your role. Do not speak for other participants.`,
  ].join("\n");

  return [
    ...systemMessages,
    {
      role: "user",
      content: nonTextParts.length > 0
        ? [{ type: "text", text: promptText }, ...nonTextParts]
        : promptText,
    },
  ];
}

function autonomousParticipantPromptName(participant: ParticipantConfig): string {
  return participant.personaId ? participant.displayName : "the next participant";
}

async function finalizeTransientTurnFailure(
  ctx: ActionCtx,
  params: {
    messageId: Id<"messages">;
    jobId: Id<"generationJobs">;
    chatId: Id<"chats">;
    userId: string;
    reason: string;
  },
): Promise<void> {
  await ctx.runMutation(internal.chat.mutations.finalizeGeneration, {
    messageId: params.messageId,
    jobId: params.jobId,
    chatId: params.chatId,
    content: `Autonomous turn failed: ${params.reason}`,
    status: "failed",
    error: params.reason,
    userId: params.userId,
  });
}

async function cleanupTransientTurnEntities(
  ctx: ActionCtx,
  messageId: Id<"messages"> | undefined,
  jobId: Id<"generationJobs"> | undefined,
): Promise<void> {
  if (messageId) {
    try {
      await ctx.runMutation(internal.autonomous.mutations_helpers.deleteMessage, {
        messageId,
      });
    } catch {
      // no-op
    }
  }
  if (jobId) {
    try {
      await ctx.runMutation(internal.autonomous.mutations_helpers.deleteGenerationJob, {
        jobId,
      });
    } catch {
      // no-op
    }
  }
}

export interface RunParticipantTurnParams {
  ctx: ActionCtx;
  sessionId: Id<"autonomousSessions">;
  chatId: Id<"chats">;
  participant: ParticipantConfig;
  cycleParentIds: Id<"messages">[];
  modelCapabilities: Map<string, ModelCapabilities>;
  memoryContext: string | undefined;
  moderatorConfig?: ModeratorConfig;
  userId: string;
  webSearchEnabled: boolean;
}

export async function runParticipantTurn(
  params: RunParticipantTurnParams,
  deps: RunParticipantTurnDeps = defaultRunParticipantTurnDeps,
): Promise<TurnOutcome> {
  const {
    ctx,
    sessionId,
    chatId,
    participant,
    cycleParentIds,
    modelCapabilities,
    memoryContext,
    moderatorConfig,
    userId,
    webSearchEnabled,
  } = params;

  let messageId: Id<"messages"> | undefined;
  let jobId: Id<"generationJobs"> | undefined;

  const markTurnCancelled = async () => {
    if (jobId) {
      try {
        await ctx.runMutation(internal.chat.mutations.updateJobStatus, {
          jobId,
          status: "cancelled",
        });
      } catch {
        // no-op
      }
    }
    if (messageId) {
      try {
        await ctx.runMutation(internal.chat.mutations.updateMessageContent, {
          messageId,
          content: "",
          status: "cancelled",
        });
      } catch {
        // no-op
      }
    }
  };

  try {
    const apiKey = await deps.getRequiredUserOpenRouterApiKey(ctx, userId);
    let moderatorDirective: string | undefined;
    if (moderatorConfig) {
      moderatorDirective = await deps.generateModeratorDirective(
        ctx,
        moderatorConfig,
        participant,
        chatId,
        userId,
      );
    }

    let effectiveSystemPrompt = participant.systemPrompt;
    if (moderatorDirective) {
      const parts = [
        `<moderator_directive>\n${moderatorDirective}\n</moderator_directive>`,
        effectiveSystemPrompt,
      ].filter(Boolean);
      effectiveSystemPrompt = parts.join("\n\n");
    }

    const now = deps.now();
    messageId = await ctx.runMutation(
      internal.autonomous.mutations_helpers.createAutonomousMessage,
      {
        chatId,
        userId,
        modelId: participant.modelId,
        personaId: participant.personaId,
        participantId: participant.participantId,
        participantName: participant.displayName,
        parentMessageIds: cycleParentIds,
        moderatorDirective,
      },
    );

    jobId = await ctx.runMutation(
      internal.autonomous.mutations_helpers.createGenerationJob,
      {
        chatId,
        messageId,
        modelId: participant.modelId,
        userId,
      },
    );

    await ctx.runMutation(internal.chat.mutations.updateJobStatus, {
      jobId,
      status: "streaming",
      startedAt: now,
    });

    const currentMessages = await ctx.runQuery(internal.chat.queries.listAllMessages, {
      chatId,
    });
    const resolvedMemoryContext = await deps.loadMemoryContext(
      ctx,
      userId,
      participant.personaId,
      chatId,
    );

    const baseRequestMessages = deps.buildRequestMessages({
      messages: currentMessages,
      excludeMessageId: messageId,
      systemPrompt: effectiveSystemPrompt,
      memoryContext: resolvedMemoryContext || memoryContext,
      expandMultiModelGroups: false,
      maxContextTokens:
        modelCapabilities.get(participant.modelId)?.contextLength ?? 75_000,
    });

    const caps = modelCapabilities.get(participant.modelId);
    const promotedRequest = deps.promoteLatestUserVideoUrls(baseRequestMessages, {
      modelId: participant.modelId,
      provider: caps?.provider,
      hasVideoInput: caps?.hasVideoInput,
    });

    if (promotedRequest.messages.length === 0) {
      await cleanupTransientTurnEntities(ctx, messageId, jobId);
      return { kind: "skipped" };
    }

    const requestMessages = buildAutonomousTranscriptMessages(
      promotedRequest.messages,
      autonomousParticipantPromptName(participant),
    );

    if (promotedRequest.events.length > 0) {
      const promotedCount = promotedRequest.events.filter(
        (event) => event.status === "promoted",
      ).length;
      const skipped = promotedRequest.events.filter(
        (event) => event.status === "skipped",
      );
      if (promotedCount > 0) {
        console.info("[video_url] promoted YouTube URLs", {
          modelId: participant.modelId,
          provider: caps?.provider,
          count: promotedCount,
        });
      }
      for (const event of skipped) {
        console.info("[video_url] YouTube URL detected but not promoted", {
          modelId: participant.modelId,
          provider: caps?.provider,
          url: event.url,
          reason: event.reason,
        });
      }
    }

    const rawParams: ChatRequestParameters = {
      temperature: participant.temperature ?? 0.7,
      maxTokens: participant.maxTokens ?? null,
      includeReasoning: participant.includeReasoning ?? null,
      reasoningEffort: participant.reasoningEffort ?? null,
      webSearchEnabled,
    };
    const gatedParams = deps.gateParameters(
      rawParams,
      caps?.supportedParameters,
      caps?.hasImageGeneration,
      caps?.hasReasoning,
    );

    let totalReasoning = "";
    let cancellationCheckCounter = 0;

    const assertTurnStillActive = async () => {
      if (!jobId) return;
      cancellationCheckCounter += 1;
      if (cancellationCheckCounter % 2 !== 0) return;
      const isCancelled = await ctx.runQuery(
        internal.chat.queries.isJobCancelled,
        { jobId },
      );
      if (!isCancelled) return;
      await markTurnCancelled();
      throw new Error(CANCELLED_TURN_ERROR);
    };

    const writer = deps.createStreamWriter({
      ctx,
      messageId,
      beforePatch: assertTurnStillActive,
    });

    const result = await deps.callOpenRouterStreaming(
      apiKey,
      participant.modelId,
      requestMessages,
      gatedParams,
      {
        onDelta: async (delta) => {
          await writer.handleContentDeltaBoundary(delta.length);
          await writer.appendContent(delta);
          await writer.patchContentIfNeeded();
        },
        onReasoningDelta: async (delta) => {
          await writer.appendReasoning(delta);
          await writer.patchReasoningIfNeeded(writer.hasSeenContentDelta);
        },
      },
      {
        emptyStreamRetries: 2,
        emptyStreamBackoffs: EMPTY_STREAM_RETRY_DELAYS,
        fallbackModel: undefined,
      },
    );

    await assertTurnStillActive();

    await writer.flush();

    await assertTurnStillActive();
    totalReasoning = writer.totalReasoning;

    const finalContent = result.content.trim();
    if (!finalContent && result.reasoning) {
      await finalizeTransientTurnFailure(ctx, {
        messageId,
        jobId,
        chatId,
        userId,
        reason: "Model returned reasoning only without a visible response.",
      });
      return {
        kind: "failed",
        reason: "Model returned reasoning only without a visible response.",
      };
    } else if (!finalContent && result.imageUrls.length === 0) {
      await finalizeTransientTurnFailure(ctx, {
        messageId,
        jobId,
        chatId,
        userId,
        reason: "Model returned an empty response after retries.",
      });
      return {
        kind: "failed",
        reason: "Model returned an empty response after retries.",
      };
    }

    await ctx.runMutation(internal.chat.mutations.finalizeGeneration, {
      messageId,
      jobId,
      chatId,
      content: finalContent,
      status: "completed",
      usage: result.usage ?? undefined,
      reasoning: result.reasoning || totalReasoning || undefined,
      imageUrls: result.imageUrls.length > 0 ? result.imageUrls : undefined,
      userId,
    });

    await ctx.runMutation(internal.autonomous.mutations_helpers.setChatActiveLeaf, {
      chatId,
      messageId,
    });

    await ctx.runMutation(internal.autonomous.mutations.updateParentMessageIds, {
      sessionId,
      parentMessageIds: [messageId],
    });

    return { kind: "completed", messageId };
  } catch (error) {
    if (isCancelledTurnError(error)) {
      return { kind: "cancelled" };
    }

    if (messageId && jobId) {
      const reason = error instanceof Error ? error.message : "Unknown error";
      await finalizeTransientTurnFailure(ctx, {
        messageId,
        jobId,
        chatId,
        userId,
        reason,
      });
    } else {
      await cleanupTransientTurnEntities(ctx, messageId, jobId);
    }

    return {
      kind: "failed",
      reason: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
