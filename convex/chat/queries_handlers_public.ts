import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { optionalAuth } from "../lib/auth";
import {
  getAuthorizedChat,
  getAuthorizedMessage,
  withRefreshedAttachmentUrls,
} from "./query_helpers";
import { hydrateDocumentEditAnnotations } from "../documents/docx_edit_annotations";

function withoutSearchContext<T extends { searchContext?: unknown }>(
  message: T,
): Omit<T, "searchContext"> {
  const { searchContext: _ignored, ...rest } = message;
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

export interface ListChatsArgs extends Record<string, unknown> {
  folderId?: string;
  limit?: number;
  searchQuery?: string;
  source?: "user" | "scheduled_job";
}

export const DEFAULT_LIST_CHATS_LIMIT = 50;
const MAX_LIST_CHATS_LIMIT = 500;
const MAX_LIST_CHATS_SEARCH_RESULTS = 500;
const LEGACY_USER_SOURCE_SCAN_MULTIPLIER = 10;
const CHAT_FALLBACK_TITLE = "New conversation";

type ChatListItem = Doc<"chats"> & {
  participantSummary: Array<{
    modelId: string;
    personaId?: string;
    personaName?: string;
    personaEmoji?: string;
    personaAvatarImageUrl?: string;
  }>;
};

type PublicMessage = Omit<Doc<"messages">, "searchContext">;

function legacyUserSourceScanLimit(limit: number): number {
  return Math.min(MAX_LIST_CHATS_LIMIT, Math.max(limit, limit * LEGACY_USER_SOURCE_SCAN_MULTIPLIER));
}

export function buildChatListPage<T extends { _id: string; isPinned?: boolean }>(
  pinnedChats: T[],
  recentChats: T[],
  limit: number,
): T[] {
  const pinnedIds = new Set(pinnedChats.map((chat) => chat._id));
  const unpinnedChats = recentChats
    .filter((chat) => chat.isPinned !== true && !pinnedIds.has(chat._id))
    .slice(0, limit);

  return [...pinnedChats, ...unpinnedChats];
}

export function chatMatchesSearch(
  chat: { title?: string; lastMessagePreview?: string; folderId?: string },
  query: string,
  folderNamesById: Map<string, string>,
): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return (
    (chat.title ?? CHAT_FALLBACK_TITLE).toLowerCase().includes(normalized) ||
    (chat.lastMessagePreview ?? "").toLowerCase().includes(normalized) ||
    (chat.folderId ? (folderNamesById.get(chat.folderId) ?? "").toLowerCase().includes(normalized) : false)
  );
}

export function chatMatchesSource(
  chat: { source?: string },
  source?: ListChatsArgs["source"],
): boolean {
  if (!source) return true;
  const normalizedSource = chat.source ?? "user";
  return normalizedSource === source;
}

export function mergeUserSourceRecentChats<T extends { _id: string; updatedAt: number }>(
  explicitUserChats: T[],
  legacyUserChats: T[],
): T[] {
  return [...explicitUserChats, ...legacyUserChats]
    .filter((chat, index, allChats) =>
      allChats.findIndex((candidate) => candidate._id === chat._id) === index
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

async function searchChatsByText(
  ctx: QueryCtx,
  userId: string,
  query: string,
  folderId: string | undefined,
  source: ListChatsArgs["source"],
  limit: number,
  folderNamesById: Map<string, string>,
): Promise<Array<Doc<"chats">>> {
  const searchLimit = Math.max(limit, Math.min(MAX_LIST_CHATS_SEARCH_RESULTS, limit * 10));
  const applyFilters = <Q extends { eq: (field: "userId" | "folderId" | "source", value: string) => Q }>(q: Q): Q => {
    const scoped = q.eq("userId", userId);
    const folderScoped = folderId ? scoped.eq("folderId", folderId) : scoped;
    return source && source !== "user" ? folderScoped.eq("source", source) : folderScoped;
  };

  const [titleMatches, previewMatches] = await Promise.all([
    ctx.db
      .query("chats")
      .withSearchIndex("search_title", (q) => applyFilters(q.search("title", query)))
      .take(searchLimit),
    ctx.db
      .query("chats")
      .withSearchIndex("search_preview", (q) => applyFilters(q.search("lastMessagePreview", query)))
      .take(searchLimit),
  ]);

  const byId = new Map<string, Doc<"chats">>();
  for (const chat of [...titleMatches, ...previewMatches]) {
    if (chat.isDeleting !== true && chatMatchesSource(chat, source) && chatMatchesSearch(chat, query, folderNamesById)) {
      byId.set(chat._id as string, chat);
    }
  }

  const matchingFolderIds = Array.from(folderNamesById.entries())
    .filter(([id, name]) => (!folderId || id === folderId) && name.toLowerCase().includes(query.toLowerCase()))
    .map(([id]) => id);

  for (const matchingFolderId of matchingFolderIds) {
    const folderChats = await ctx.db
      .query("chats")
      .withIndex("by_user_folder", (q) => q.eq("userId", userId).eq("folderId", matchingFolderId))
      .order("desc")
      .filter((q) => q.neq(q.field("isDeleting"), true))
      .take(searchLimit);
    for (const chat of folderChats) {
      if (chatMatchesSource(chat, source)) {
        byId.set(chat._id as string, chat);
      }
    }
  }

  const matches = Array.from(byId.values()).sort((a, b) => {
    if ((a.isPinned === true) !== (b.isPinned === true)) return a.isPinned === true ? -1 : 1;
    if (a.isPinned === true && b.isPinned === true) return (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0);
    return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
  });

  return buildChatListPage(
    matches.filter((chat) => chat.isPinned === true),
    matches,
    limit,
  );
}

export async function listChatsHandler(
  ctx: QueryCtx,
  args: ListChatsArgs,
): Promise<ChatListItem[]> {
  const auth = await optionalAuth(ctx);
  if (!auth) return [];

  const limit = Math.min(
    Math.max(Math.floor(args.limit ?? DEFAULT_LIST_CHATS_LIMIT), 1),
    MAX_LIST_CHATS_LIMIT,
  );
  const searchQuery = args.searchQuery?.trim() ?? "";

  const folderNamesById = new Map<string, string>();
  if (searchQuery) {
    const folders = await ctx.db
      .query("folders")
      .withIndex("by_user", (q) => q.eq("userId", auth.userId))
      .collect();
    for (const folder of folders) {
      folderNamesById.set(folder._id as string, folder.name);
    }
  }

  let chats: Doc<"chats">[];
  if (args.folderId && searchQuery) {
    chats = await searchChatsByText(ctx, auth.userId, searchQuery, args.folderId, args.source, limit, folderNamesById);
  } else if (searchQuery) {
    chats = await searchChatsByText(ctx, auth.userId, searchQuery, undefined, args.source, limit, folderNamesById);
  } else if (args.folderId && args.source && args.source !== "user") {
    const folderPinned = await ctx.db
      .query("chats")
      .withIndex("by_user_folder_source_pinned", (q) =>
        q
          .eq("userId", auth.userId)
          .eq("folderId", args.folderId!)
          .eq("source", args.source!)
          .eq("isPinned", true),
      )
      .order("desc")
      .filter((q) => q.neq(q.field("isDeleting"), true))
      .collect();
    const folderRecent = await ctx.db
      .query("chats")
      .withIndex("by_user_folder_source", (q) =>
        q.eq("userId", auth.userId).eq("folderId", args.folderId!).eq("source", args.source!),
      )
      .order("desc")
      .filter((q) => q.neq(q.field("isDeleting"), true))
      .take(limit + folderPinned.length);
    chats = buildChatListPage(folderPinned, folderRecent, limit);
  } else if (args.folderId && args.source === "user") {
    const folderPinned = await ctx.db
      .query("chats")
      .withIndex("by_user_folder", (q) =>
        q.eq("userId", auth.userId).eq("folderId", args.folderId!),
      )
      .order("desc")
      .filter((q) => q.and(
        q.eq(q.field("isPinned"), true),
        q.neq(q.field("isDeleting"), true),
      ))
      .collect();
    const explicitUserChats = await ctx.db
      .query("chats")
      .withIndex("by_user_folder_source", (q) =>
        q.eq("userId", auth.userId).eq("folderId", args.folderId!).eq("source", "user"),
      )
      .order("desc")
      .filter((q) => q.neq(q.field("isDeleting"), true))
      .take(limit + folderPinned.length);
    const legacyUserChats = await ctx.db
      .query("chats")
      .withIndex("by_user_folder", (q) =>
        q.eq("userId", auth.userId).eq("folderId", args.folderId!),
      )
      .order("desc")
      .filter((q) => q.neq(q.field("isDeleting"), true))
      .take(legacyUserSourceScanLimit(limit + folderPinned.length));
    const folderRecent = mergeUserSourceRecentChats(explicitUserChats, legacyUserChats);
    chats = buildChatListPage(
      folderPinned.filter((chat) => chatMatchesSource(chat, args.source)),
      folderRecent.filter((chat) => chatMatchesSource(chat, args.source)),
      limit,
    );
  } else if (args.folderId) {
    // Pinned chats in this folder (usually few)
    const folderPinned = await ctx.db
      .query("chats")
      .withIndex("by_user_folder", (q) =>
        q.eq("userId", auth.userId).eq("folderId", args.folderId!),
      )
      .order("desc")
      .filter((q) => q.and(
        q.eq(q.field("isPinned"), true),
        q.neq(q.field("isDeleting"), true),
      ))
      .collect();
    const folderRecent = await ctx.db
      .query("chats")
      .withIndex("by_user_folder", (q) =>
        q.eq("userId", auth.userId).eq("folderId", args.folderId!),
      )
      .order("desc")
      .filter((q) => q.neq(q.field("isDeleting"), true))
      .take(limit + folderPinned.length);
    chats = buildChatListPage(folderPinned, folderRecent, limit);
  } else if (args.source && args.source !== "user") {
    const pinnedChats = await ctx.db
      .query("chats")
      .withIndex("by_user_source_pinned", (q) =>
        q.eq("userId", auth.userId).eq("source", args.source!).eq("isPinned", true),
      )
      .order("desc")
      .filter((q) => q.neq(q.field("isDeleting"), true))
      .collect();
    const recentChats = await ctx.db
      .query("chats")
      .withIndex("by_user_source", (q) =>
        q.eq("userId", auth.userId).eq("source", args.source!),
      )
      .order("desc")
      .filter((q) => q.neq(q.field("isDeleting"), true))
      .take(limit + pinnedChats.length);
    chats = buildChatListPage(pinnedChats, recentChats, limit);
  } else if (args.source === "user") {
    const pinnedChats = await ctx.db
      .query("chats")
      .withIndex("by_user_pinned", (q) =>
        q.eq("userId", auth.userId).eq("isPinned", true),
      )
      .order("desc")
      .collect();
    const explicitUserChats = await ctx.db
      .query("chats")
      .withIndex("by_user_source", (q) =>
        q.eq("userId", auth.userId).eq("source", "user"),
      )
      .order("desc")
      .take(limit + pinnedChats.length);
    const legacyUserChats = await ctx.db
      .query("chats")
      .withIndex("by_user", (q) => q.eq("userId", auth.userId))
      .order("desc")
      .take(legacyUserSourceScanLimit(limit + pinnedChats.length));
    const recentChats = mergeUserSourceRecentChats(explicitUserChats, legacyUserChats);
    chats = buildChatListPage(
      pinnedChats.filter((chat) => chat.isDeleting !== true && chatMatchesSource(chat, args.source)),
      recentChats.filter((chat) => chat.isDeleting !== true && chatMatchesSource(chat, args.source)),
      limit,
    );
  } else {
    const pinnedChats = await ctx.db
      .query("chats")
      .withIndex("by_user_pinned", (q) =>
        q.eq("userId", auth.userId).eq("isPinned", true),
      )
      .order("desc")
      .collect();
    const recentChats = await ctx.db
      .query("chats")
      .withIndex("by_user", (q) => q.eq("userId", auth.userId))
      .order("desc")
      .take(limit + pinnedChats.length);
    chats = buildChatListPage(
      pinnedChats.filter((chat) => chat.isDeleting !== true),
      recentChats.filter((chat) => chat.isDeleting !== true),
      limit,
    );
  }

  // Fetch participants per-chat using the by_chat index (max 3 rows each).
  // This is O(displayed_chats) not O(total_chats) — critical for users with
  // large chat histories. The previous bulk by_user .collect() loaded every
  // participant across all chats and caused severe performance degradation.
  const participantsByChat = new Map<
    string,
    Array<{
      modelId: string;
      personaId?: string;
      personaName?: string;
      personaEmoji?: string;
      personaAvatarImageUrl?: string;
      sortOrder: number;
    }>
  >();

  await Promise.all(
    chats.map(async (chat) => {
      const participants = await ctx.db
        .query("chatParticipants")
        .withIndex("by_chat", (q) => q.eq("chatId", chat._id))
        .collect();
      participantsByChat.set(chat._id as string, participants);
    }),
  );

  return chats.map((chat) => {
    const participantSummary = (participantsByChat.get(chat._id as string) ?? [])
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((participant) => ({
        modelId: participant.modelId,
        personaId: participant.personaId ?? undefined,
        personaName: participant.personaName ?? undefined,
        personaEmoji: participant.personaEmoji ?? undefined,
        personaAvatarImageUrl: participant.personaAvatarImageUrl ?? undefined,
      }));

    return {
      ...chat,
      participantSummary,
    };
  });
}

export interface GetChatArgs extends Record<string, unknown> {
  chatId: Id<"chats">;
}

export async function getChatHandler(
  ctx: QueryCtx,
  args: GetChatArgs,
): Promise<Doc<"chats"> | null> {
  const auth = await optionalAuth(ctx);
  if (!auth) return null;

  const chat = await ctx.db.get(args.chatId);
  if (!chat || chat.userId !== auth.userId) return null;
  return chat;
}

export interface ListMessagesArgs extends Record<string, unknown> {
  chatId: Id<"chats">;
  limit?: number;
  /** When set, only return messages with createdAt < this value (ms epoch). Used for cursor-based pagination aligned with the by_chat index. */
  before?: number;
}

export async function listMessagesHandler(
  ctx: QueryCtx,
  args: ListMessagesArgs,
): Promise<PublicMessage[]> {
  const auth = await optionalAuth(ctx);
  if (!auth) return [];

  const chat = await ctx.db.get(args.chatId);
  if (!chat || chat.userId !== auth.userId) return [];

  const limit = args.limit ?? 500;
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
      const publicMessage = withPublicParticipantIdentity(message);
      const withAvatar = publicMessage.participantId && personaAvatarUrls.has(publicMessage.participantId)
        ? {
            ...publicMessage,
            participantAvatarImageUrl: personaAvatarUrls.get(publicMessage.participantId),
          }
        : publicMessage;
      const refreshed = await withRefreshedAttachmentUrls(ctx, withAvatar);
      const hydrated = await hydrateDocumentEditAnnotations(ctx, refreshed);
      return withoutSearchContext(hydrated);
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
  const refreshed = await withRefreshedAttachmentUrls(
    ctx,
    withPublicParticipantIdentity(message),
  );
  const hydrated = await hydrateDocumentEditAnnotations(ctx, refreshed);
  return withoutSearchContext(hydrated);
}

export interface GetGenerationStatusArgs extends Record<string, unknown> {
  jobId: Id<"generationJobs">;
}

export async function getGenerationStatusHandler(
  ctx: QueryCtx,
  args: GetGenerationStatusArgs,
): Promise<
  | {
      status: string;
      error?: string;
      startedAt?: number;
      completedAt?: number;
    }
  | null
> {
  const auth = await optionalAuth(ctx);
  if (!auth) return null;

  const job = await ctx.db.get(args.jobId);
  if (!job) return null;
  const chat = await ctx.db.get(job.chatId);
  if (!chat || chat.userId !== auth.userId) return null;

  return {
    status: job.status,
    error: job.error,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
  };
}

export interface GetActiveJobsArgs extends Record<string, unknown> {
  chatId: Id<"chats">;
}

export async function getActiveJobsHandler(
  ctx: QueryCtx,
  args: GetActiveJobsArgs,
): Promise<Array<Doc<"generationJobs">>> {
  const auth = await optionalAuth(ctx);
  if (!auth) return [];

  const chat = await getAuthorizedChat(ctx, args.chatId, auth.userId);
  if (!chat) return [];

  const streaming = await ctx.db
    .query("generationJobs")
    .withIndex("by_chat_status", (q) =>
      q.eq("chatId", args.chatId).eq("status", "streaming"),
    )
    .collect();

  const queued = await ctx.db
    .query("generationJobs")
    .withIndex("by_chat_status", (q) =>
      q.eq("chatId", args.chatId).eq("status", "queued"),
    )
    .collect();

  return [...queued, ...streaming];
}

// -- Lazy attachment URL resolution -----------------------------------------

export interface GetAttachmentUrlArgs extends Record<string, unknown> {
  storageId: Id<"_storage">;
  messageId: Id<"messages">;
}

export async function getAttachmentUrlHandler(
  ctx: QueryCtx,
  args: GetAttachmentUrlArgs,
): Promise<string | null> {
  const auth = await optionalAuth(ctx);
  if (!auth) return null;

  // Verify the message belongs to this user's chat.
  const message = await getAuthorizedMessage(ctx, args.messageId, auth.userId);
  if (!message) return null;

  // Verify the requested storageId exists in the message's attachments.
  const hasAttachment = message.attachments?.some(
    (a: { storageId?: string }) => a.storageId === args.storageId,
  );
  if (!hasAttachment) return null;

  const url = await ctx.storage.getUrl(args.storageId);
  return url;
}

export interface GetGeneratedChartsByMessageArgs extends Record<string, unknown> {
  messageId: Id<"messages">;
}

export async function getGeneratedChartsByMessageHandler(
  ctx: QueryCtx,
  args: GetGeneratedChartsByMessageArgs,
): Promise<
  Array<{
    _id: string;
    _creationTime: number;
    userId: string;
    chatId: string;
    messageId: string;
    toolName: string;
    chartType: "line" | "bar" | "scatter" | "pie" | "box" | "png_image";
    title?: string;
    xLabel?: string;
    yLabel?: string;
    xUnit?: string;
    yUnit?: string;
    elements: unknown;
    pngBase64?: string;
    createdAt: number;
  }>
> {
  const auth = await optionalAuth(ctx);
  if (!auth) return [];

  const message = await getAuthorizedMessage(ctx, args.messageId, auth.userId);
  if (!message) return [];

  const charts = await ctx.db
    .query("generatedCharts")
    .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
    .collect();

  return charts.map((chart) => ({
    _id: chart._id,
    _creationTime: chart._creationTime,
    userId: chart.userId,
    chatId: chart.chatId,
    messageId: chart.messageId,
    toolName: chart.toolName,
    chartType: chart.chartType,
    title: chart.title,
    xLabel: chart.xLabel,
    yLabel: chart.yLabel,
    xUnit: chart.xUnit,
    yUnit: chart.yUnit,
    elements: chart.elements,
    pngBase64: chart.pngBase64,
    createdAt: chart.createdAt,
  }));
}

// MARK: - Knowledge Base
//
// KB queries moved to `convex/knowledge_base/queries.ts`. The handlers,
// arg validators, and the `KBFileRecord` type now live there. Tests import
// from the new location.

// ── M23: Advanced Stats ────────────────────────────────────────────────

export interface GetChatCostSummaryArgs extends Record<string, unknown> {
  chatId: Id<"chats">;
}

export interface CostBreakdown {
  responses: number;
  advisors: number;
  memory: number;
  search: number;
  other: number;
}

export interface ChatCostSummary {
  chatId: Id<"chats">;
  totalCost: number;
  /** Per-message costs: messageId → primary generation cost only (stable after first write). */
  messageCosts: Record<string, number>;
  /** Bucketed breakdown of totalCost by domain. */
  breakdown: CostBreakdown;
}

// Source → bucket mapping for cost breakdown.
// "responses" = primary generation (no source). Others are grouped by domain.
const MEMORY_SOURCES = new Set(["memory_extraction", "memory_embedding_store", "memory_embedding_retrieve"]);
const SEARCH_SOURCES = new Set([
  "search_query_gen",
  "search_perplexity",
  "search_planning",
  "search_analysis",
  "search_synthesis",
  "search_architecture",
  "tool_web_search",
]);

export async function getChatCostSummaryHandler(
  ctx: QueryCtx,
  args: GetChatCostSummaryArgs,
): Promise<ChatCostSummary | null> {
  const auth = await optionalAuth(ctx);
  if (!auth) return null;

  // Verify user owns this chat
  const chat = await getAuthorizedChat(ctx, args.chatId, auth.userId);
  if (!chat) return null;

  const records = await ctx.db
    .query("usageRecords")
    .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
    .collect();

  let totalCost = 0;
  const messageCosts: Record<string, number> = {};
  const breakdown = { responses: 0, advisors: 0, memory: 0, search: 0, other: 0 };

  for (const r of records) {
    // When the user brings their own API key (BYOK), OpenRouter's `cost`
    // reflects their markup (often 0), not what the provider charges. Use
    // `upstreamInferenceCost` in that case so the UI shows the real model cost.
    const cost =
      r.isByok === true && r.upstreamInferenceCost != null
        ? r.upstreamInferenceCost
        : (r.cost ?? 0);
    totalCost += cost;

    const src = r.source as string | undefined;

    // Per-message cost only reflects the primary generation (source is absent).
    // Ancillary rows contribute to totalCost and breakdown but not messageCosts,
    // so the per-message figure stays stable after the first write.
    if (!src) {
      const mid = r.messageId as string;
      messageCosts[mid] = (messageCosts[mid] ?? 0) + cost;
      breakdown.responses += cost;
    } else if (src === "advisor") {
      breakdown.advisors += cost;
    } else if (MEMORY_SOURCES.has(src)) {
      breakdown.memory += cost;
    } else if (SEARCH_SOURCES.has(src)) {
      breakdown.search += cost;
    } else {
      // title, compaction, subagent, and any future sources
      breakdown.other += cost;
    }
  }

  return {
    chatId: args.chatId,
    totalCost,
    messageCosts,
    breakdown,
  };
}

// ── M29: Video Job Status (public, auth-gated) ────────────────────────

export interface GetVideoJobStatusArgs extends Record<string, unknown> {
  messageId: Id<"messages">;
}

/**
 * Public query for clients to subscribe to real-time video generation progress.
 * Returns the video job status for a given message, or null if none exists.
 * Auth-gated: only the owning user can see their video job.
 */
export async function getVideoJobStatusHandler(
  ctx: QueryCtx,
  args: GetVideoJobStatusArgs,
): Promise<
  | {
      status: string;
      pollCount: number;
      error?: string;
      model: string;
      createdAt: number;
      lastPolledAt?: number;
    }
  | null
> {
  const auth = await optionalAuth(ctx);
  if (!auth) return null;

  const videoJob = await ctx.db
    .query("videoJobs")
    .withIndex("by_messageId", (q) => q.eq("messageId", args.messageId))
    .first();

  if (!videoJob) return null;
  if (videoJob.userId !== auth.userId) return null;

  return {
    status: videoJob.status,
    pollCount: videoJob.pollCount,
    error: videoJob.error ?? undefined,
    model: videoJob.model,
    createdAt: videoJob.createdAt,
    lastPolledAt: videoJob.lastPolledAt ?? undefined,
  };
}
