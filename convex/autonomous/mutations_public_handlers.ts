import { internal } from "../_generated/api";
import { Id, type Id as ConvexId } from "../_generated/dataModel";
import { MutationCtx } from "../_generated/server";
import { requireAuth, requirePro } from "../lib/auth";
import {
  assertTurnConfiguration,
  cancelInFlightAutonomousTurns,
  computeResumeCursor,
  dedupeParticipantIds,
  resolveInitialParentMessageIds,
} from "./session_helpers";

export { assertTurnConfiguration, computeResumeCursor, dedupeParticipantIds };

interface ParticipantConfig {
  participantId: string;
  modelId: string;
  personaId?: ConvexId<"personas"> | null;
  displayName: string;
  systemPrompt?: string | null;
  temperature?: number;
  maxTokens?: number;
  includeReasoning?: boolean;
  reasoningEffort?: string | null;
}

interface ModeratorConfig {
  modelId: string;
  personaId?: ConvexId<"personas"> | null;
  displayName: string;
}

export interface StartSessionArgs extends Record<string, unknown> {
  chatId: Id<"chats">;
  turnOrder: string[];
  maxCycles: number;
  pauseBetweenTurns: number;
  moderatorParticipantId?: string;
  autoStopOnConsensus: boolean;
  participantConfigs: ParticipantConfig[];
  moderatorConfig?: ModeratorConfig;
  webSearchEnabled?: boolean;
}

export async function startSessionHandler(
  ctx: MutationCtx,
  args: StartSessionArgs,
): Promise<Id<"autonomousSessions">> {
  const { userId } = await requireAuth(ctx);
  await requirePro(ctx, userId);
  const now = Date.now();

  const uniqueTurnOrder = dedupeParticipantIds(args.turnOrder);
  assertTurnConfiguration(
    uniqueTurnOrder,
    args.participantConfigs,
    args.moderatorParticipantId,
  );

  const chat = await ctx.db.get(args.chatId);
  if (!chat || chat.userId !== userId) {
    throw new Error("Chat not found or unauthorized");
  }

  const existingSessions = await ctx.db
    .query("autonomousSessions")
    .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
    .collect();
  const hasActive = existingSessions.some(
    (session) => session.status === "running" || session.status === "paused",
  );
  if (hasActive) {
    throw new Error("An autonomous session is already active for this chat");
  }

  const parentMessageIds = await resolveInitialParentMessageIds(
    ctx,
    args.chatId,
    chat.activeBranchLeafId,
  );

  const sessionId = await ctx.db.insert("autonomousSessions", {
    chatId: args.chatId,
    userId,
    status: "running",
    currentCycle: 0,
    maxCycles: args.maxCycles,
    currentParticipantIndex: undefined,
    turnOrder: uniqueTurnOrder,
    moderatorParticipantId: args.moderatorParticipantId,
    autoStopOnConsensus: args.autoStopOnConsensus,
    pauseBetweenTurns: args.pauseBetweenTurns,
    parentMessageIds,
    stopReason: undefined,
    error: undefined,
    createdAt: now,
    updatedAt: now,
  });

  await ctx.scheduler.runAfter(0, internal.autonomous.actions.runCycle, {
    sessionId,
    cycle: 1,
    startParticipantIndex: 0,
    userId,
    participantConfigs: args.participantConfigs,
    moderatorConfig: args.moderatorConfig,
    webSearchEnabled: args.webSearchEnabled ?? false,
  });

  return sessionId;
}

export interface PauseSessionArgs extends Record<string, unknown> {
  sessionId: Id<"autonomousSessions">;
}

export async function pauseSessionHandler(
  ctx: MutationCtx,
  args: PauseSessionArgs,
): Promise<void> {
  const { userId } = await requireAuth(ctx);
  const session = await ctx.db.get(args.sessionId);
  if (!session || session.userId !== userId) {
    throw new Error("Session not found or unauthorized");
  }
  if (session.status !== "running") {
    return;
  }

  await ctx.db.patch(args.sessionId, {
    status: "paused",
    updatedAt: Date.now(),
  });
}

export interface ResumeSessionArgs extends Record<string, unknown> {
  sessionId: Id<"autonomousSessions">;
  participantConfigs: ParticipantConfig[];
  moderatorConfig?: ModeratorConfig;
  webSearchEnabled?: boolean;
}

export async function resumeSessionHandler(
  ctx: MutationCtx,
  args: ResumeSessionArgs,
): Promise<void> {
  const { userId } = await requireAuth(ctx);
  await requirePro(ctx, userId);
  const session = await ctx.db.get(args.sessionId);
  if (!session || session.userId !== userId) {
    throw new Error("Session not found or unauthorized");
  }
  if (session.status !== "paused") {
    return;
  }

  assertTurnConfiguration(
    session.turnOrder,
    args.participantConfigs,
    session.moderatorParticipantId,
  );

  const { resumeCycle, startParticipantIndex } = computeResumeCursor(
    session.currentCycle,
    session.currentParticipantIndex,
    session.turnOrder.length,
  );

  if (resumeCycle > session.maxCycles) {
    await ctx.db.patch(args.sessionId, {
      status: "completed_max_cycles",
      stopReason: "Max cycles reached",
      updatedAt: Date.now(),
    });
    return;
  }

  await ctx.db.patch(args.sessionId, {
    status: "running",
    updatedAt: Date.now(),
  });

  await ctx.scheduler.runAfter(0, internal.autonomous.actions.runCycle, {
    sessionId: args.sessionId,
    cycle: resumeCycle,
    startParticipantIndex,
    userId,
    participantConfigs: args.participantConfigs,
    moderatorConfig: args.moderatorConfig,
    webSearchEnabled: args.webSearchEnabled ?? false,
  });
}

export interface StopSessionArgs extends Record<string, unknown> {
  sessionId: Id<"autonomousSessions">;
}

export async function stopSessionHandler(
  ctx: MutationCtx,
  args: StopSessionArgs,
): Promise<void> {
  const { userId } = await requireAuth(ctx);
  const session = await ctx.db.get(args.sessionId);
  if (!session || session.userId !== userId) {
    throw new Error("Session not found or unauthorized");
  }
  if (session.status !== "running" && session.status !== "paused") {
    return;
  }

  await ctx.db.patch(args.sessionId, {
    status: "stopped",
    stopReason: "User stopped",
    updatedAt: Date.now(),
  });
}

export interface HandleUserInterventionArgs extends Record<string, unknown> {
  sessionId: Id<"autonomousSessions">;
  forceSendNow?: boolean;
}

export async function handleUserInterventionHandler(
  ctx: MutationCtx,
  args: HandleUserInterventionArgs,
): Promise<void> {
  const { userId } = await requireAuth(ctx);
  const session = await ctx.db.get(args.sessionId);
  if (!session || session.userId !== userId) {
    throw new Error("Session not found or unauthorized");
  }
  if (session.status !== "running" && session.status !== "paused") {
    return;
  }

  await ctx.db.patch(args.sessionId, {
    status: "stopped_user_intervened",
    stopReason: "User intervened",
    updatedAt: Date.now(),
  });

  if (!args.forceSendNow) {
    return;
  }

  await cancelInFlightAutonomousTurns(ctx, session.chatId, session.turnOrder);
}
