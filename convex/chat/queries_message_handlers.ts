import { generationRecovery, type GenerationRecovery } from "./generation_recovery";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { optionalAuth } from "../lib/auth";
import { getAuthorizedMessage, withRefreshedAttachmentUrls } from "./query_helpers";
import { hydrateDocumentEditAnnotations } from "../documents/docx_edit_annotations";
import { mcpContextCardsByMessage, type McpContextCard } from "../mcp/message_cards";
import { normalizeModeratorDirective } from "../autonomous/moderator_directive";
import type { ExecutionProjection } from "../execution/projection";

function withoutPrivateMessageFields<T extends {
  searchContext?: unknown;
  mcpInvocationIds?: unknown;
}>(
  message: T,
): Omit<T, "searchContext" | "mcpInvocationIds"> {
  const { searchContext: _searchContext, mcpInvocationIds: _mcpInvocationIds, ...rest } = message;
  return rest;
}

export function publicParticipantName(message: {
  participantId?: string;
  participantName?: string;
  modelId?: string;
}): string | undefined {
  const participantName = message.participantName?.trim();
  if (!participantName) return undefined;
  const modelSlug = message.modelId?.split("/").pop();
  return !message.participantId && participantName === modelSlug
    ? undefined
    : participantName;
}

function withPublicParticipantIdentity<T extends {
  participantId?: string;
  participantName?: string;
  modelId?: string;
}>(message: T): T {
  const participantName = publicParticipantName(message);
  return participantName === message.participantName
    ? message
    : { ...message, participantName };
}

function withPublicModeratorDirective<T extends {
  moderatorDirective?: string;
}>(message: T): T {
  const moderatorDirective = normalizeModeratorDirective(
    message.moderatorDirective,
  );
  return moderatorDirective === message.moderatorDirective
    ? message
    : { ...message, moderatorDirective };
}

type PublicMessage = Omit<Doc<"messages">, "searchContext" | "mcpInvocationIds"> & {
  executionRoute?: Pick<ExecutionProjection, "placement" | "runtimeLabel">;
  mcpContextCards?: McpContextCard[];
  generationRecovery?: GenerationRecovery;
};

export async function messageExecutionRoute(
  ctx: QueryCtx,
  message: Pick<Doc<"messages">, "_id" | "chatId" | "role">,
): Promise<Pick<ExecutionProjection, "placement" | "runtimeLabel"> | undefined> {
  if (message.role !== "assistant") return undefined;
  const job = await ctx.db.query("generationJobs")
    .withIndex("by_message", (q) => q.eq("messageId", message._id))
    .order("desc").first();
  if (!job) {
    const imported = await ctx.db.query("runtimeOfflineImports")
      .withIndex("by_assistant_message", q => q.eq("assistantMessageId", message._id)).unique();
    if (!imported || imported.chatId !== message.chatId) return undefined;
    const run = await ctx.db.get(imported.runId);
    const attempt = run?.activeAttemptId ? await ctx.db.get(run.activeAttemptId) : null;
    if (!attempt || attempt.runId !== imported.runId || attempt.userId !== imported.userId) return undefined;
    return { placement: attempt.placement, runtimeLabel: attempt.runtimeLabel };
  }
  if (job.chatId !== message.chatId || !job.executionAttemptId) return undefined;
  const attempt = await ctx.db.get(job.executionAttemptId);
  if (!attempt || attempt.runId !== job.executionRunId || attempt.userId !== job.userId) return undefined;
  return { placement: attempt.placement, runtimeLabel: attempt.runtimeLabel };
}

export interface ListMessagesArgs extends Record<string, unknown> {
  chatId: Id<"chats">;
  limit?: number;
  /** When set, only return messages with createdAt < this value (ms epoch). Used for cursor-based pagination aligned with the by_chat index. */
  before?: number;
}

const MAX_LIST_MESSAGES_LIMIT = 500;

function listMessagesLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return MAX_LIST_MESSAGES_LIMIT;
  return Math.min(MAX_LIST_MESSAGES_LIMIT, Math.max(1, Math.trunc(limit)));
}

export async function listMessagesHandler(
  ctx: QueryCtx,
  args: ListMessagesArgs,
): Promise<PublicMessage[]> {
  const auth = await optionalAuth(ctx);
  if (!auth) return [];

  const chat = await ctx.db.get(args.chatId);
  if (!chat || chat.userId !== auth.userId) return [];

  const limit = listMessagesLimit(args.limit);
  const query = ctx.db
    .query("messages")
    .withIndex("by_chat", (q) => {
      const q2 = q.eq("chatId", args.chatId);
      if (args.before !== undefined) {
        return q2.lt("createdAt", args.before);
      }
      return q2;
    })
    .order("desc");

  const newestFirst = await query.take(limit);
  const messages = newestFirst.slice().reverse();
  const contextCardsByMessage = await mcpContextCardsByMessage(ctx, messages);

  // Refresh persona avatar URLs from storage so clients never see expired
  // signed URLs. participantId stores the persona ID when present.
  const personaIds = new Set<string>();
  for (const m of messages) {
    if (m.participantId) personaIds.add(m.participantId);
  }

  const personaAvatarUrls = new Map<string, string>();
  if (personaIds.size > 0) {
    await Promise.all(
      [...personaIds].map(async (pid) => {
        try {
          const persona = await ctx.db.get(pid as Id<"personas">);
          if (persona?.avatarImageStorageId) {
            const url = await ctx.storage.getUrl(persona.avatarImageStorageId);
            if (url) personaAvatarUrls.set(pid, url);
          }
        } catch {
          // Persona may have been deleted — keep the stale snapshot.
        }
      }),
    );
  }

  return await Promise.all(
    messages.map(async (message) => {
      const contextCards = contextCardsByMessage.get(String(message._id));
      const publicMessage = withPublicParticipantIdentity(
        withPublicModeratorDirective(message),
      );
      const withAvatar = publicMessage.participantId && personaAvatarUrls.has(publicMessage.participantId)
        ? {
            ...publicMessage,
            participantAvatarImageUrl: personaAvatarUrls.get(publicMessage.participantId),
          }
        : publicMessage;
      const refreshed = await withRefreshedAttachmentUrls(ctx, withAvatar);
      const hydrated = await hydrateDocumentEditAnnotations(ctx, refreshed);
      return { ...withoutPrivateMessageFields(hydrated), generationRecovery: generationRecovery(message), mcpContextCards: contextCards, executionRoute: await messageExecutionRoute(ctx, message) };
    }),
  );
}

export interface GetMessageArgs extends Record<string, unknown> {
  messageId: Id<"messages">;
}

export async function getMessageHandler(
  ctx: QueryCtx,
  args: GetMessageArgs,
): Promise<PublicMessage | null> {
  const auth = await optionalAuth(ctx);
  if (!auth) return null;

  const message = await getAuthorizedMessage(ctx, args.messageId, auth.userId);
  if (!message) return null;
  const contextCards = (await mcpContextCardsByMessage(ctx, [message])).get(String(message._id));
  const refreshed = await withRefreshedAttachmentUrls(
    ctx,
    withPublicParticipantIdentity(withPublicModeratorDirective(message)),
  );
  const hydrated = await hydrateDocumentEditAnnotations(ctx, refreshed);
  return { ...withoutPrivateMessageFields(hydrated), generationRecovery: generationRecovery(message), mcpContextCards: contextCards, executionRoute: await messageExecutionRoute(ctx, message) };
}

