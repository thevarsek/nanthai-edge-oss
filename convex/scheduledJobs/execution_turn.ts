import { v, ConvexError } from "convex/values";
import { internalMutation } from "../_generated/server";
import { createGenerationExecution } from "../execution/control_plane";
import { resolveEffectiveParticipantRoute } from "../runtime_host/route_resolution";

export const createScheduledExecutionTurn = internalMutation({
  args: {
    jobId: v.id("scheduledJobs"),
    chatId: v.id("chats"),
    userId: v.string(),
    executionId: v.string(),
    stepIndex: v.number(),
    stepTitle: v.string(),
    content: v.string(),
    modelId: v.string(),
    systemPrompt: v.optional(v.string()),
    temperature: v.optional(v.number()),
    maxTokens: v.optional(v.number()),
    personaId: v.optional(v.id("personas")),
    personaName: v.optional(v.string()),
    personaEmoji: v.optional(v.string()),
    personaAvatarImageUrl: v.optional(v.string()),
    enabledIntegrations: v.optional(v.array(v.string())),
    useParticipantRoute: v.optional(v.boolean()),
  },
  returns: v.union(v.object({
    userMessageId: v.id("messages"),
    assistantMsgId: v.id("messages"),
    genJobId: v.id("generationJobs"),
    created: v.boolean(),
    chatParticipantId: v.optional(v.id("chatParticipants")),
  }), v.object({ runtimeUnavailable: v.string(), offline: v.boolean() })),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) {
      throw new ConvexError({ code: "NOT_FOUND" as const, message: "Scheduled job not found" });
    }
    if (job.isDeleting) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Job not found or unauthorized" });
    }
    if (job.activeExecutionId !== args.executionId) {
      throw new ConvexError({ code: "EXECUTION_STALE" as const, message: "Scheduled job execution no longer active" });
    }
    if (job.activeExecutionChatId !== args.chatId) {
      throw new ConvexError({ code: "EXECUTION_MISMATCH" as const, message: "Scheduled job execution chat mismatch" });
    }

    const currentStepIndex = job.activeStepIndex ?? -1;
    if (currentStepIndex >= args.stepIndex) {
      if (
        job.activeUserMessageId
        && job.activeAssistantMessageId
        && job.activeGenerationJobId
      ) {
        const generation = await ctx.db.get(job.activeGenerationJobId);
        return {
          ...(generation?.chatParticipantId ? { chatParticipantId: generation.chatParticipantId } : {}),
          userMessageId: job.activeUserMessageId,
          assistantMsgId: job.activeAssistantMessageId,
          genJobId: job.activeGenerationJobId,
          created: false,
        };
      }
      throw new ConvexError({ code: "DUPLICATE_STEP" as const, message: "Scheduled job step already created" });
    }

    if (currentStepIndex !== args.stepIndex - 1) {
      throw new ConvexError({ code: "STEP_ORDER" as const, message: "Scheduled job step order mismatch" });
    }

    const now = Date.now();
    const existingParticipants = await ctx.db
      .query("chatParticipants")
      .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
      .collect();
    const existing = existingParticipants.find((participant) =>
      participant.modelId === args.modelId
      && (participant.personaId ?? undefined) === (args.personaId ?? undefined),
    );
    const chatParticipantId = existing?._id ?? await ctx.db.insert("chatParticipants", {
      chatId: args.chatId,
      userId: args.userId,
      modelId: args.modelId,
      personaId: args.personaId,
      personaName: args.personaName,
      personaEmoji: args.personaEmoji,
      personaAvatarImageUrl: args.personaAvatarImageUrl,
      sortOrder: existingParticipants.length,
      createdAt: now,
    });
    const route = args.useParticipantRoute
      ? await resolveEffectiveParticipantRoute(ctx, {
          userId: args.userId, chatParticipantId, now,
        })
      : null;
    if (route?.placement === "local" && route.availability !== "ready") {
      const offline = route.availability === "device_offline";
      const computer = route.deviceName ?? "The selected computer";
      return {
        offline,
        runtimeUnavailable: offline
          ? `${computer} is offline. This occurrence will not run later when it reconnects. The next scheduled occurrence is unchanged.`
          : `${computer} cannot run this scheduled occurrence (${route.availability}).`,
      };
    }

    const parentMessageIds = job.activeAssistantMessageId
      ? [job.activeAssistantMessageId]
      : [];
    const userMessageId = await ctx.db.insert("messages", {
      chatId: args.chatId,
      userId: args.userId,
      role: "user",
      content: args.content,
      parentMessageIds,
      status: "completed",
      source: "scheduled_step",
      sourceJobId: args.jobId,
      sourceStepIndex: args.stepIndex,
      sourceStepTitle: args.stepTitle,
      createdAt: now,
    });

    const assistantMsgId = await ctx.db.insert("messages", {
      chatId: args.chatId,
      userId: args.userId,
      role: "assistant",
      chatParticipantId: args.useParticipantRoute ? chatParticipantId : undefined,
      content: "",
      modelId: args.modelId,
      participantId: args.personaId ?? undefined,
      participantName: args.personaName ?? undefined,
      participantEmoji: args.personaEmoji ?? undefined,
      participantAvatarImageUrl: args.personaAvatarImageUrl ?? undefined,
      parentMessageIds: [userMessageId],
      status: "pending",
      enabledIntegrations: args.enabledIntegrations,
      sourceJobId: args.jobId,
      sourceStepIndex: args.stepIndex,
      sourceStepTitle: args.stepTitle,
      createdAt: now,
    });

    const genJobId = await ctx.db.insert("generationJobs", {
      chatId: args.chatId,
      messageId: assistantMsgId,
      userId: args.userId,
      modelId: args.modelId,
      status: "queued",
      chatParticipantId: args.useParticipantRoute ? chatParticipantId : undefined,
      sourceJobId: args.jobId,
      sourceExecutionId: args.executionId,
      sourceStepIndex: args.stepIndex,
      sourceStepTitle: args.stepTitle,
      createdAt: now,
    });

    if (route?.placement === "local") {
      await createGenerationExecution(ctx, {
        jobId: genJobId, userId: args.userId, chatId: args.chatId,
        sourceMessageId: assistantMsgId, modelId: args.modelId, route,
        parentRunId: job.executionRunId, now,
      });
    }
    await ctx.db.patch(args.jobId, {
      activeStepIndex: args.stepIndex,
      activeUserMessageId: userMessageId,
      activeAssistantMessageId: assistantMsgId,
      activeGenerationJobId: genJobId,
      updatedAt: now,
    });

    return { userMessageId, assistantMsgId, genJobId, created: true, chatParticipantId };
  },
});
