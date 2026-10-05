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
import { resolveParticipant } from "./execution_routing";

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
): Promise<boolean> {
  const resolvedStep: ScheduledJobStepConfig = {
    ...args.step,
    prompt: applyTemplateVariables(args.step.prompt, args.templateVariables),
  };
  const participant = await resolveParticipant(ctx, {
    ...resolvedStep,
    userId: args.userId,
  });
  const stepTitle = getStepTitle(resolvedStep, args.stepIndex);
  const basePrompt = buildStepTriggerPrompt(
    resolvedStep,
    args.previousAssistantContent,
  );
  const promptWithKB = await buildPromptWithKnowledgeBase(
    ctx,
    resolvedStep,
    basePrompt,
  );

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
      useParticipantRoute: ["none", "basic"].includes(resolveScheduledJobSearchMode(resolvedStep)),
    },
  );

  if (turn.runtimeUnavailable !== undefined) {
    await ctx.runMutation(
      internal.scheduledJobs.execution_terminal_commit.commitScheduledExecutionFailure,
      {
        jobId: args.jobId, executionId: args.executionId,
        error: turn.runtimeUnavailable, runtimeUnavailable: turn.offline,
      },
    );
    return false;
  }

  await routeScheduledStep(ctx, {
    scheduledJobId: args.jobId,
    executionId: args.executionId,
    chatId: args.chatId,
    userId: args.userId,
    userMessageId: turn.userMessageId,
    assistantMessageId: turn.assistantMsgId,
    genJobId: turn.genJobId,
    chatParticipantId: turn.chatParticipantId,
    stepIndex: args.stepIndex,
    participant,
    prompt: promptWithKB,
    step: resolvedStep,
  });
  return true;
}

async function routeScheduledStep(
  ctx: ActionCtx,
  args: {
    scheduledJobId: Id<"scheduledJobs">;
    executionId: string;
    chatId: Id<"chats">;
    userId: string;
    userMessageId: Id<"messages">;
    assistantMessageId: Id<"messages">;
    genJobId: Id<"generationJobs">;
    chatParticipantId?: Id<"chatParticipants">;
    stepIndex: number;
    participant: ResolvedParticipant;
    prompt: string;
    step: ScheduledJobStepConfig;
  },
): Promise<void> {
  const effectiveSearchMode = resolveScheduledJobSearchMode(args.step);
  const effectiveComplexity =
    normalizeSearchComplexity(args.step.searchComplexity) ?? 1;

  if (effectiveSearchMode === "none" || effectiveSearchMode === "basic") {
    await ctx.runMutation(internal.execution.queues.enqueueRunGeneration, {
        chatId: args.chatId,
        userMessageId: args.userMessageId,
        assistantMessageIds: [args.assistantMessageId],
        generationJobIds: [args.genJobId],
        participants: [
          {
            modelId: args.participant.modelId,
            chatParticipantId: args.chatParticipantId,
            messageId: args.assistantMessageId,
            jobId: args.genJobId,
            systemPrompt: args.participant.systemPrompt ?? null,
            temperature: args.participant.temperature,
            maxTokens: args.participant.maxTokens,
            personaId: args.participant.personaId ?? null,
            personaName: args.participant.personaName ?? null,
            personaEmoji: args.participant.personaEmoji ?? null,
            personaAvatarImageUrl:
              args.participant.personaAvatarImageUrl ?? null,
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
        turnSkillOverrides: args.step.turnSkillOverrides,
        turnIntegrationOverrides: args.step.turnIntegrationOverrides,
        analyticsSource: "scheduled_job",
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

    await ctx.runMutation(
      internal.scheduledJobs.execution_lifecycle.enqueueScheduledWebSearch,
      {
        scheduledJobId: args.scheduledJobId,
        executionId: args.executionId,
        stepIndex: args.stepIndex,
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
        turnIntegrationOverrides: args.step.turnIntegrationOverrides,
        subagentsEnabled: undefined,
        analyticsSource: "scheduled_job",
      },
    );
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

  await ctx.runMutation(internal.execution.workflow_starts.startResearchPaper, {
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
      turnIntegrationOverrides: args.step.turnIntegrationOverrides,
      subagentsEnabled: undefined,
      analyticsSource: "scheduled_job",
  });
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
