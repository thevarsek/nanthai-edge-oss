import { v } from "convex/values";
import { internalQuery, query } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { optionalAuth } from "../lib/auth";
import { integrationOverrideEntry } from "../schema_validators";
import {
  MAX_ADVISOR_HISTORY_BYTES,
  MAX_ADVISOR_HISTORY_ITEMS,
  MAX_ADVISOR_CONTEXT_MESSAGES,
} from "./constants";
import { resolveAdvisorEligibility } from "./eligibility";
import { successfulAdvisorNotes } from "./shared";
import { advisorBatchView, chatAdvisorView } from "./view";

const participantRef = v.object({
  modelId: v.string(),
  personaId: v.optional(v.union(v.id("personas"), v.null())),
});

export const listChatAdvisors = query({
  args: {
    chatId: v.id("chats"),
    participants: v.optional(v.array(participantRef)),
    selectedPersonaIds: v.optional(v.array(v.id("personas"))),
    turnIntegrationOverrides: v.optional(v.array(integrationOverrideEntry)),
  },
  handler: async (ctx, args) => {
    const auth = await optionalAuth(ctx);
    const chat = await ctx.db.get(args.chatId);
    if (!auth || !chat || chat.userId !== auth.userId) {
      return {
        advisors: [],
        eligibility: {
          isAvailable: false,
          reasonCode: "not_pro" as const,
          maxAdvisors: 3,
          keptCount: 0,
          remainingCapacity: 3,
        },
      };
    }
    const [assignments, storedParticipants, preferences] = await Promise.all([
      ctx.db
        .query("chatAdvisors")
        .withIndex("by_chat", (builder) => builder.eq("chatId", args.chatId))
        .collect(),
      args.participants === undefined
        ? ctx.db
            .query("chatParticipants")
            .withIndex("by_chat", (builder) => builder.eq("chatId", args.chatId))
            .collect()
        : Promise.resolve([]),
      ctx.db
        .query("userPreferences")
        .withIndex("by_user", (builder) => builder.eq("userId", auth.userId))
        .first(),
    ]);
    const participantRows = args.participants ?? storedParticipants;
    const participantPersonaIds = new Set(
      participantRows.flatMap((participant) =>
        participant.personaId ? [String(participant.personaId)] : []
      ),
    );
    const inheritedPersonaIds = args.selectedPersonaIds === undefined
      ? assignments.map((assignment) => assignment.personaId)
      : [];
    const [views, eligibility] = await Promise.all([
      Promise.all(assignments.map((assignment) => chatAdvisorView(ctx, assignment, {
        defaultModelId: preferences?.defaultModelId,
        participantPersonaIds,
      }))),
      resolveAdvisorEligibility(ctx, {
        userId: auth.userId,
        chat,
        participants: participantRows,
        keptPersonaIds: inheritedPersonaIds,
        selectedPersonaIds: args.selectedPersonaIds,
        turnIntegrationOverrides: args.turnIntegrationOverrides,
      }),
    ]);
    return { advisors: views.filter((view) => view != null), eligibility };
  },
});

export const getBatchView = query({
  args: { batchId: v.id("advisorBatches") },
  handler: async (ctx, args) => {
    const auth = await optionalAuth(ctx);
    if (!auth) return null;
    const batch = await ctx.db.get(args.batchId);
    if (!batch || batch.userId !== auth.userId) return null;
    const runs = await ctx.db
      .query("advisorRuns")
      .withIndex("by_batch", (builder) => builder.eq("batchId", batch._id))
      .collect();
    return advisorBatchView(batch, runs);
  },
});

export const getRunExecutionContext = internalQuery({
  args: { runId: v.id("advisorRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return null;
    const batch = await ctx.db.get(run.batchId);
    if (!batch) return null;
    const branchMessages = await latestBranchMessages(
      ctx,
      batch.chatId,
      batch.userMessageId,
    );
    const pathIds = new Set(branchMessages.map((message) => String(message._id)));
    const multiModelGroupIds = new Set(branchMessages.flatMap((message) =>
      message.isMultiModelResponse && message.multiModelGroupId
        ? [message.multiModelGroupId]
        : []
    ));
    const [assistantMessages, multiModelSiblingGroups, priorGroups] = await Promise.all([
      Promise.all(batch.assistantMessageIds.map((messageId) => ctx.db.get(messageId))),
      Promise.all([...multiModelGroupIds].map(async (groupId) => await ctx.db
        .query("messages")
        .withIndex("by_chat_group", (builder) =>
          builder.eq("chatId", batch.chatId).eq("multiModelGroupId", groupId)
        )
        .collect())),
      Promise.all(branchMessages.map(async (message) => await ctx.db
        .query("advisorRuns")
        .withIndex("by_user_message_and_persona", (builder) =>
          builder.eq("userMessageId", message._id).eq("personaId", run.personaId)
        )
        .collect())),
    ]);
    const messages = deduplicatedMessages([
      ...branchMessages,
      ...assistantMessages.flatMap((message) => message ? [message] : []),
      ...multiModelSiblingGroups.flat(),
    ]);
    const prior = priorGroups.flat().sort((left, right) => right.createdAt - left.createdAt);
    const replayItems = branchAwareAdvisorReplayItems(prior, {
      currentRunId: String(run._id),
      currentCreatedAt: run.createdAt,
      branchMessageIds: pathIds,
    });
    return { run, batch, messages, replayItems };
  },
});

async function latestBranchMessages(
  ctx: QueryCtx,
  chatId: Id<"chats">,
  startId: Id<"messages">,
): Promise<Doc<"messages">[]> {
  const first = await ctx.db.get(startId);
  if (!first || first.chatId !== chatId) return [];
  const selected: Doc<"messages">[] = [];
  const frontier: Doc<"messages">[] = [first];
  const enqueued = new Set([String(first._id)]);

  while (frontier.length > 0 && selected.length < MAX_ADVISOR_CONTEXT_MESSAGES) {
    frontier.sort((left, right) => right.createdAt - left.createdAt);
    const current = frontier.shift();
    if (!current) break;
    selected.push(current);
    if (selected.length >= MAX_ADVISOR_CONTEXT_MESSAGES) break;
    const unseenParentIds = current.parentMessageIds.filter((parentId) => {
      const key = String(parentId);
      if (enqueued.has(key)) return false;
      enqueued.add(key);
      return true;
    });
    const parents = await Promise.all(unseenParentIds.map((parentId) => ctx.db.get(parentId)));
    frontier.push(...parents.flatMap((parent) =>
      parent?.chatId === chatId ? [parent] : []
    ));
  }

  return selected.sort((left, right) => left.createdAt - right.createdAt);
}

function deduplicatedMessages(messages: Doc<"messages">[]): Doc<"messages">[] {
  return [...new Map(messages.map((message) => [String(message._id), message])).values()]
    .sort((left, right) => left.createdAt - right.createdAt);
}

export const getBatchInternal = internalQuery({
  args: { batchId: v.id("advisorBatches") },
  handler: async (ctx, args) => await ctx.db.get(args.batchId),
});

export const getRunInternal = internalQuery({
  args: { runId: v.id("advisorRuns") },
  handler: async (ctx, args) => await ctx.db.get(args.runId),
});

export const getAdvisorNotesForMessage = internalQuery({
  args: { messageId: v.id("messages") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message?.advisorBatchId) return null;
    const batch = await ctx.db.get(message.advisorBatchId);
    if (
      !batch ||
      (batch.status !== "synthesizing" && batch.status !== "completed" &&
        batch.status !== "failed" && batch.status !== "cancelled")
    ) {
      return null;
    }
    const runs = await ctx.db
      .query("advisorRuns")
      .withIndex("by_batch", (builder) => builder.eq("batchId", batch._id))
      .collect();
    return successfulAdvisorNotes(runs.filter((run) => run.status === "completed")) ?? null;
  },
});

function boundedReplayItems(runs: Doc<"advisorRuns">[]): unknown[] {
  const selected: unknown[] = [];
  let bytes = 0;
  for (const run of runs) {
    const items = Array.isArray(run.replayItems) ? run.replayItems : [];
    for (const item of items) {
      if (!isAdvisorReplayItem(item)) continue;
      const itemBytes = JSON.stringify(item).length;
      if (selected.length >= MAX_ADVISOR_HISTORY_ITEMS || bytes + itemBytes > MAX_ADVISOR_HISTORY_BYTES) {
        return selected.reverse();
      }
      selected.push(item);
      bytes += itemBytes;
    }
  }
  return selected.reverse();
}

export function branchAwareAdvisorReplayItems(
  runs: Doc<"advisorRuns">[],
  args: {
    currentRunId: string;
    currentCreatedAt: number;
    branchMessageIds: Set<string>;
  },
): unknown[] {
  return boundedReplayItems(runs.filter((candidate) =>
    String(candidate._id) !== args.currentRunId &&
    candidate.status === "completed" &&
    candidate.createdAt < args.currentCreatedAt &&
    args.branchMessageIds.has(String(candidate.userMessageId))
  ));
}

function isAdvisorReplayItem(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" &&
    (value as { type?: unknown }).type === "openrouter:advisor";
}
