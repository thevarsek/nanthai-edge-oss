import {
  makeFunctionReference,
  type FunctionReference,
} from "convex/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { MODEL_IDS } from "../lib/model_constants";
import { claimExecutionRun } from "../execution/attempts";
import { linkExecutionComponent } from "../execution/component_refs";
import { durableWorkflow } from "../execution/components";
import { scheduleOwnedWorkflowWatchdog } from
  "../execution/owned_workflow_watchdog";
import { createExecutionRun } from "../execution/runs";
import {
  isAudioBasedUserMessage,
  resolveAutoAudioResponseEnabled,
} from "./audio_shared";

export type MessageAudioWorkflowStartResult =
  | { started: false }
  | { started: true; workflowId: string };

const ownedWorkflowCompletionRef = makeFunctionReference<"mutation">(
  "execution/workflow_lifecycle:reconcileOwnedWorkflow",
);
type MessageAudioWorkflowArgs = {
  messageId: Id<"messages">;
  execution: {
    runId: Id<"executionRuns">;
    attemptId: Id<"executionAttempts">;
    fence: number;
    claimantId: string;
  };
};
const runMessageAudioWorkflowRef = makeFunctionReference<
  "mutation",
  MessageAudioWorkflowArgs,
  null
>("chat/audio_workflow:runMessageAudioWorkflow") as unknown as FunctionReference<
  "mutation",
  "internal",
  MessageAudioWorkflowArgs,
  null
>;

export interface MessageAudioWorkflowStartDeps {
  createExecution: typeof createExecutionRun;
  claimExecution: typeof claimExecutionRun;
  startWorkflow: (
    ctx: MutationCtx,
    args: MessageAudioWorkflowArgs,
  ) => Promise<string>;
  linkComponent: typeof linkExecutionComponent;
  scheduleWatchdog: typeof scheduleOwnedWorkflowWatchdog;
}

const defaultDeps: MessageAudioWorkflowStartDeps = {
  createExecution: createExecutionRun,
  claimExecution: claimExecutionRun,
  startWorkflow: async (ctx, args) => String(await durableWorkflow.start(
    ctx,
    runMessageAudioWorkflowRef,
    args,
    {
      startAsync: true,
      onComplete: ownedWorkflowCompletionRef,
      context: {},
    },
  )),
  linkComponent: linkExecutionComponent,
  scheduleWatchdog: scheduleOwnedWorkflowWatchdog,
};

export async function startMessageAudioWorkflow(
  ctx: MutationCtx,
  args: {
    messageId: Id<"messages">;
    chatId: Id<"chats">;
    userId: string;
    modelId?: string;
  },
  deps: MessageAudioWorkflowStartDeps = defaultDeps,
): Promise<MessageAudioWorkflowStartResult> {
  const [message, chat] = await Promise.all([
    ctx.db.get(args.messageId),
    ctx.db.get(args.chatId),
  ]);
  if (
    !message
    || message.chatId !== args.chatId
    || message.role !== "assistant"
    || !message.content.trim()
    || !chat
    || chat.userId !== args.userId
    || message.audioStorageId
    || message.audioGenerating
  ) return { started: false };

  const now = Date.now();
  const preferences = args.modelId
    ? null
    : await ctx.db
      .query("userPreferences")
      .withIndex("by_user", (query) => query.eq("userId", args.userId))
      .first();
  const modelId = args.modelId
    ?? preferences?.defaultSpeechGenerationModelId
    ?? MODEL_IDS.speechGeneration;
  const runKey = `message-speech:${String(args.messageId)}:${now}`;
  const claimantId = `message-speech-workflow:${runKey}`;
  await ctx.db.patch(message._id, { audioGenerating: true });
  const execution = await deps.createExecution(ctx, {
    userId: args.userId,
    runKey,
    kind: "media",
    requestedPlacement: "cloud",
    chatId: args.chatId,
    sourceMessageId: args.messageId,
    domainType: "message_speech",
    domainId: String(args.messageId),
    initialAttempt: {
      executorKind: "convex_workflow",
      placement: "cloud",
      adapterId: "convex-workflow",
      provider: "openrouter",
      modelId,
    },
    now,
  });
  const claimed = await deps.claimExecution(ctx, {
    runId: execution.runId,
    claimantId,
    leaseMs: 20 * 60 * 1_000,
    now,
  });
  if (!claimed) throw new Error("MESSAGE_AUDIO_EXECUTION_NOT_CLAIMABLE");
  const workflowId = await deps.startWorkflow(ctx, {
    messageId: args.messageId,
    execution: {
      runId: claimed.runId,
      attemptId: claimed.attemptId,
      fence: claimed.fence,
      claimantId,
    },
  });
  await ctx.db.patch(claimed.attemptId, {
    componentOperationId: workflowId,
    updatedAt: now,
  });
  await deps.linkComponent(ctx, {
    runId: claimed.runId,
    attemptId: claimed.attemptId,
    fence: claimed.fence,
    adapterId: "convex-workflow",
    operationId: workflowId,
    role: "message-audio-workflow",
    now,
  });
  await deps.scheduleWatchdog(ctx, { workflowId, context: {} });
  return { started: true, workflowId };
}

export async function maybeStartAutomaticMessageAudio(
  ctx: MutationCtx,
  args: {
    messageId: Id<"messages">;
    chatId: Id<"chats">;
    triggerUserMessageId: Id<"messages">;
  },
  deps: MessageAudioWorkflowStartDeps = defaultDeps,
): Promise<void> {
  const [triggerMessage, chat] = await Promise.all([
    ctx.db.get(args.triggerUserMessageId),
    ctx.db.get(args.chatId),
  ]);
  if (!triggerMessage || !chat || !isAudioBasedUserMessage(triggerMessage)) {
    return;
  }
  const preferences = await ctx.db
    .query("userPreferences")
    .withIndex("by_user", (query) => query.eq("userId", chat.userId))
    .first();
  if (!resolveAutoAudioResponseEnabled(chat, preferences)) return;
  await startMessageAudioWorkflow(ctx, {
    messageId: args.messageId,
    chatId: args.chatId,
    userId: chat.userId,
    modelId: preferences?.defaultSpeechGenerationModelId,
  }, deps);
}

export const startAutomaticMessageAudio = internalMutation({
  args: {
    messageId: v.id("messages"),
    chatId: v.id("chats"),
    triggerUserMessageId: v.id("messages"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await maybeStartAutomaticMessageAudio(ctx, args);
    return null;
  },
});
