import { mutation, MutationCtx } from "../_generated/server";
import { v, ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { requireAuth, requirePro } from "../lib/auth";
import { isAudioAttachment } from "../chat/audio_shared";
import {
  normalizeMessageAttachments,
  resolveParentMessageIdsForSend,
} from "../chat/mutation_send_helpers";

export const startResearchPaper = mutation({
  args: {
    chatId: v.id("chats"),
    text: v.string(),
    recordedAudio: v.optional(v.object({
      storageId: v.id("_storage"),
      transcript: v.string(),
      durationMs: v.optional(v.number()),
      mimeType: v.optional(v.string()),
    })),
    attachments: v.optional(v.array(v.object({
      type: v.string(),
      url: v.optional(v.string()),
      storageId: v.optional(v.id("_storage")),
      name: v.optional(v.string()),
      mimeType: v.optional(v.string()),
      sizeBytes: v.optional(v.number()),
    }))),
    participant: v.object({
      modelId: v.string(),
      personaId: v.optional(v.union(v.id("personas"), v.null())),
      personaName: v.optional(v.union(v.string(), v.null())),
      personaEmoji: v.optional(v.union(v.string(), v.null())),
      personaAvatarImageUrl: v.optional(v.union(v.string(), v.null())),
      systemPrompt: v.optional(v.union(v.string(), v.null())),
      temperature: v.optional(v.number()),
      maxTokens: v.optional(v.number()),
      includeReasoning: v.optional(v.boolean()),
      reasoningEffort: v.optional(v.union(v.string(), v.null())),
    }),
    complexity: v.number(),
    explicitParentIds: v.optional(v.array(v.id("messages"))),
    expandMultiModelGroups: v.optional(v.boolean()),
    enabledIntegrations: v.optional(v.array(v.string())),
    subagentsEnabled: v.optional(v.boolean()),
  },
  returns: v.object({
    sessionId: v.id("searchSessions"),
    userMessageId: v.id("messages"),
    assistantMessageId: v.id("messages"),
  }),
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    await requirePro(ctx, userId);
    const now = Date.now();

    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.userId !== userId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Chat not found" });
    }

    const participantCount = await ctx.db
      .query("chatParticipants")
      .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
      .collect();
    if (participantCount.length > 1) {
      throw new ConvexError({ code: "VALIDATION", message: "Research Paper requires a single participant." });
    }

    const trimmedText = args.text.trim();
    if (!trimmedText) {
      throw new ConvexError({ code: "VALIDATION", message: "Empty input" });
    }

    const complexity = Math.max(1, Math.min(3, Math.round(args.complexity)));
    const normalizedAttachments = await normalizeMessageAttachments(
      ctx,
      args.attachments,
    );
    const audioAttachmentCount = normalizedAttachments?.filter((attachment) =>
      isAudioAttachment(attachment),
    ).length ?? 0;
    if (args.recordedAudio && audioAttachmentCount > 0) {
      throw new ConvexError({ code: "VALIDATION", message: "Choose one audio source before sending." });
    }
    if (complexity === 3 && (normalizedAttachments?.length ?? 0) > 0) {
      throw new ConvexError({ code: "VALIDATION", message: "Complexity 3 search does not support attachments." });
    }

    const expandMultiModelGroups = args.expandMultiModelGroups ?? true;
    const parentMessageIds = await resolveParentMessageIdsForSend(ctx, {
      chatId: args.chatId,
      activeBranchLeafId: chat.activeBranchLeafId,
      explicitParentIds: args.explicitParentIds,
      expandMultiModelGroups,
    });

    const userMessageId = await ctx.db.insert("messages", {
      chatId: args.chatId,
      userId,
      role: "user",
      content: trimmedText,
      parentMessageIds,
      status: "completed",
      audioStorageId: args.recordedAudio?.storageId,
      audioTranscript:
        args.recordedAudio?.transcript?.trim() ||
        (audioAttachmentCount > 0 ? trimmedText : undefined),
      audioDurationMs: args.recordedAudio?.durationMs,
      attachments: normalizedAttachments,
      createdAt: now,
    });

    const assistantMessageId = await ctx.db.insert("messages", {
      chatId: args.chatId,
      userId,
      role: "assistant",
      content: "",
      modelId: args.participant.modelId,
      participantId: args.participant.personaId ?? undefined,
      participantName: args.participant.personaName ?? undefined,
      participantEmoji: args.participant.personaEmoji ?? undefined,
      participantAvatarImageUrl: args.participant.personaAvatarImageUrl ?? undefined,
      parentMessageIds: [userMessageId],
      status: "pending",
      createdAt: now + 1,
    });

    const jobId = await ctx.db.insert("generationJobs", {
      chatId: args.chatId,
      messageId: assistantMessageId,
      userId,
      modelId: args.participant.modelId,
      status: "queued",
      createdAt: now,
    });

    const sessionId = await ctx.db.insert("searchSessions", {
      chatId: args.chatId,
      userId,
      assistantMessageId,
      query: trimmedText,
      mode: "paper",
      complexity,
      status: "planning",
      progress: 0,
      currentPhase: "planning",
      phaseOrder: 0,
      startedAt: now,
    });

    await ctx.db.patch(assistantMessageId, { searchSessionId: sessionId });

    const previewText =
      trimmedText.length > 200 ? trimmedText.substring(0, 200) : trimmedText;
    await ctx.db.patch(chat._id, {
      updatedAt: now,
      lastMessageDate: now,
      lastMessagePreview: previewText,
      messageCount: (chat.messageCount ?? 0) + 2,
      activeBranchLeafId: assistantMessageId,
    });

    await ctx.scheduler.runAfter(
      0,
      internal.search.workflow.researchPaperPipeline,
      {
        sessionId,
        assistantMessageId,
        jobId,
        chatId: args.chatId,
        userMessageId,
        userId,
        query: trimmedText,
        complexity,
        expandMultiModelGroups,
        modelId: args.participant.modelId,
        personaId: args.participant.personaId ?? undefined,
        systemPrompt: args.participant.systemPrompt ?? undefined,
        temperature: args.participant.temperature,
        maxTokens: args.participant.maxTokens,
        includeReasoning: args.participant.includeReasoning,
        reasoningEffort: args.participant.reasoningEffort ?? undefined,
        enabledIntegrations: args.enabledIntegrations,
        subagentsEnabled: args.subagentsEnabled,
      },
    );

    if ((chat.messageCount ?? 0) === 0 && trimmedText.length > 0) {
      const prefs = await ctx.db
        .query("userPreferences")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .first();
      const configuredTitleModel = prefs?.titleModelId?.trim() || undefined;

      await ctx.scheduler.runAfter(0, internal.chat.actions.generateTitle, {
        chatId: args.chatId,
        sourceContent: trimmedText,
        assistantContent: undefined,
        titleModel: configuredTitleModel,
        seedTitle: undefined,
        userId,
        messageId: assistantMessageId, // M23: cost attribution
      });
    }

    return { sessionId, userMessageId, assistantMessageId };
  },
});

export const cancelResearchPaper = mutation({
  args: {
    sessionId: v.id("searchSessions"),
  },
  handler: cancelResearchPaperHandler,
});

export function cancellationPlaceholderForMode(
  mode: "paper" | "web" | undefined,
): string {
  if (mode === "web") {
    return "[Web search cancelled]";
  }
  if (mode === "paper") {
    return "[Research paper cancelled]";
  }
  return "[Generation cancelled]";
}

export async function cancelResearchPaperHandler(
  ctx: MutationCtx,
  args: { sessionId: Id<"searchSessions"> },
): Promise<void> {
  const { userId } = await requireAuth(ctx);
  const session = await ctx.db.get(args.sessionId);
  if (!session || session.userId !== userId) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Search session not found" });
  }

  if (
    session.status === "completed" ||
    session.status === "failed" ||
    session.status === "cancelled"
  ) {
    return;
  }

  await ctx.db.patch(args.sessionId, {
    status: "cancelled",
    completedAt: Date.now(),
  });

  const message = await ctx.db.get(session.assistantMessageId);
  if (!message) {
    return;
  }

  const jobs = await ctx.db
    .query("generationJobs")
    .withIndex("by_message", (q) => q.eq("messageId", session.assistantMessageId))
    .collect();
  for (const job of jobs) {
    if (job.status !== "completed" && job.status !== "failed") {
      await ctx.db.patch(job._id, {
        status: "cancelled",
        completedAt: Date.now(),
      });
    }
  }

  if (message.status !== "completed") {
    await ctx.db.patch(session.assistantMessageId, {
      status: "cancelled",
      content: message.content || cancellationPlaceholderForMode(session.mode),
    });
  }
}
