import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { ActionCtx } from "../_generated/server";
import {
  buildPromptWithKB,
  buildStepTriggerPrompt,
  getStepTitle,
  normalizeSearchComplexity,
  applyTemplateVariables,
  resolveScheduledJobSearchMode,
  type ScheduledJobStepConfig,
} from "./shared";
import { ResolvedParticipant } from "./actions_types";

export async function enqueueStep(
  ctx: ActionCtx,
  args: {
    jobId: Id<"scheduledJobs">;
    chatId: Id<"chats">;
    userId: string;
    executionId: string;
    step: ScheduledJobStepConfig;
    stepIndex: number;
    previousAssistantContent?: string;
    templateVariables?: Record<string, string>;
  },
): Promise<void> {
  const resolvedStep: ScheduledJobStepConfig = {
    ...args.step,
    prompt: applyTemplateVariables(args.step.prompt, args.templateVariables),
  };
  const participant = await resolveParticipant(ctx, {
    ...resolvedStep,
    userId: args.userId,
  });
  const stepTitle = getStepTitle(resolvedStep, args.stepIndex);
  const basePrompt = buildStepTriggerPrompt(resolvedStep, args.previousAssistantContent);
  const promptWithKB = await buildPromptWithKnowledgeBase(ctx, resolvedStep, basePrompt);

  const turn = await ctx.runMutation(
    internal.scheduledJobs.mutations.createScheduledExecutionTurn,
    {
      jobId: args.jobId,
      chatId: args.chatId,
      userId: args.userId,
      executionId: args.executionId,
      stepIndex: args.stepIndex,
      stepTitle,
      content: promptWithKB,
      modelId: participant.modelId,
      systemPrompt: participant.systemPrompt,
      temperature: participant.temperature,
      maxTokens: participant.maxTokens,
      personaId: participant.personaId,
      personaName: participant.personaName,
      personaEmoji: participant.personaEmoji,
      personaAvatarImageUrl: participant.personaAvatarImageUrl,
      enabledIntegrations: resolvedStep.enabledIntegrations,
    },
  );

  if (!turn.created) {
    return;
  }

  await routeScheduledStep(ctx, {
    chatId: args.chatId,
    userId: args.userId,
    userMessageId: turn.userMessageId,
    assistantMessageId: turn.assistantMsgId,
    genJobId: turn.genJobId,
    participant,
    prompt: promptWithKB,
    step: resolvedStep,
  });
}

async function routeScheduledStep(
  ctx: ActionCtx,
  args: {
    chatId: Id<"chats">;
    userId: string;
    userMessageId: Id<"messages">;
    assistantMessageId: Id<"messages">;
    genJobId: Id<"generationJobs">;
    participant: ResolvedParticipant;
    prompt: string;
    step: ScheduledJobStepConfig;
  },
): Promise<void> {
  const effectiveSearchMode = resolveScheduledJobSearchMode(args.step);
  const effectiveComplexity = normalizeSearchComplexity(args.step.searchComplexity) ?? 1;

  if (effectiveSearchMode === "none" || effectiveSearchMode === "basic") {
    await ctx.scheduler.runAfter(0, internal.chat.actions.runGeneration, {
      chatId: args.chatId,
      userMessageId: args.userMessageId,
      assistantMessageIds: [args.assistantMessageId],
      generationJobIds: [args.genJobId],
      participants: [
        {
          modelId: args.participant.modelId,
          messageId: args.assistantMessageId,
          jobId: args.genJobId,
          systemPrompt: args.participant.systemPrompt ?? null,
          temperature: args.participant.temperature,
          maxTokens: args.participant.maxTokens,
          personaId: args.participant.personaId ?? null,
          personaName: args.participant.personaName ?? null,
          personaEmoji: args.participant.personaEmoji ?? null,
          personaAvatarImageUrl: args.participant.personaAvatarImageUrl ?? null,
          ...(args.participant.includeReasoning !== undefined
            ? { includeReasoning: args.participant.includeReasoning }
            : {}),
          reasoningEffort: args.participant.reasoningEffort ?? null,
        },
      ],
      userId: args.userId,
      expandMultiModelGroups: false,
      webSearchEnabled: effectiveSearchMode === "basic",
      enabledIntegrations: args.step.enabledIntegrations,
    });
    return;
  }

  if (effectiveSearchMode === "web") {
    const sessionId = await ctx.runMutation(
      internal.scheduledJobs.mutations.createSearchSession,
      {
        chatId: args.chatId,
        userId: args.userId,
        assistantMessageId: args.assistantMessageId,
        query: args.prompt,
        mode: "web",
        complexity: effectiveComplexity,
      },
    );

    await ctx.scheduler.runAfter(0, internal.search.actions.runWebSearch, {
      sessionId,
      assistantMessageId: args.assistantMessageId,
      jobId: args.genJobId,
      chatId: args.chatId,
      userMessageId: args.userMessageId,
      userId: args.userId,
      query: args.prompt,
      complexity: effectiveComplexity,
      expandMultiModelGroups: false,
      modelId: args.participant.modelId,
      personaId: args.participant.personaId ?? undefined,
      systemPrompt: args.participant.systemPrompt ?? undefined,
      temperature: args.participant.temperature,
      maxTokens: args.participant.maxTokens,
      includeReasoning: args.participant.includeReasoning,
      reasoningEffort: args.participant.reasoningEffort ?? undefined,
      enabledIntegrations: args.step.enabledIntegrations,
      subagentsEnabled: undefined,
    });
    return;
  }

  const sessionId = await ctx.runMutation(
    internal.scheduledJobs.mutations.createSearchSession,
    {
      chatId: args.chatId,
      userId: args.userId,
      assistantMessageId: args.assistantMessageId,
      query: args.prompt,
      mode: "paper",
      complexity: effectiveComplexity,
    },
  );

  await ctx.scheduler.runAfter(0, internal.search.workflow.researchPaperPipeline, {
    sessionId,
    assistantMessageId: args.assistantMessageId,
    jobId: args.genJobId,
    chatId: args.chatId,
    userMessageId: args.userMessageId,
    userId: args.userId,
    query: args.prompt,
    complexity: effectiveComplexity,
    expandMultiModelGroups: false,
    modelId: args.participant.modelId,
    personaId: args.participant.personaId ?? undefined,
    systemPrompt: args.participant.systemPrompt ?? undefined,
    temperature: args.participant.temperature,
    maxTokens: args.participant.maxTokens,
    includeReasoning: args.participant.includeReasoning,
    reasoningEffort: args.participant.reasoningEffort ?? undefined,
    enabledIntegrations: args.step.enabledIntegrations,
    subagentsEnabled: undefined,
  });
}

async function resolveParticipant(
  ctx: ActionCtx,
  job: {
    modelId: string;
    personaId?: Id<"personas">;
    userId: string;
    includeReasoning?: boolean;
    reasoningEffort?: string;
  },
): Promise<ResolvedParticipant> {
  if (!job.personaId) {
    return {
      modelId: job.modelId,
      includeReasoning: job.includeReasoning ?? undefined,
      reasoningEffort: job.reasoningEffort ?? undefined,
    };
  }

  const persona = await ctx.runQuery(
    internal.chat.queries.getPersona,
    { personaId: job.personaId, userId: job.userId },
  );
  if (!persona) {
    return {
      modelId: job.modelId,
      includeReasoning: job.includeReasoning ?? undefined,
      reasoningEffort: job.reasoningEffort ?? undefined,
    };
  }

  return {
    modelId: persona.modelId ?? job.modelId,
    systemPrompt: persona.systemPrompt ?? undefined,
    temperature: persona.temperature ?? undefined,
    maxTokens: persona.maxTokens ?? undefined,
    personaId: job.personaId,
    personaName: persona.displayName ?? undefined,
    personaEmoji: persona.avatarEmoji ?? undefined,
    personaAvatarImageUrl: persona.avatarImageUrl ?? undefined,
    includeReasoning: job.includeReasoning ?? persona.includeReasoning ?? undefined,
    reasoningEffort: job.reasoningEffort ?? persona.reasoningEffort ?? undefined,
  };
}

async function buildPromptWithKnowledgeBase(
  ctx: ActionCtx,
  step: ScheduledJobStepConfig,
  prompt: string,
): Promise<string> {
  if (!step.knowledgeBaseFileIds || step.knowledgeBaseFileIds.length === 0) {
    return prompt;
  }

  const kbFiles = await ctx.runAction(
    internal.scheduledJobs.queries.getKBFileContents,
    { storageIds: step.knowledgeBaseFileIds },
  );
  if (kbFiles.length === 0) {
    return prompt;
  }

  return buildPromptWithKB(prompt, kbFiles);
}
