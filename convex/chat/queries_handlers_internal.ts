import { Id } from "../_generated/dataModel";
import { QueryCtx } from "../_generated/server";

export interface ListAllMessagesArgs extends Record<string, unknown> {
  chatId: Id<"chats">;
}

export async function listAllMessagesHandler(
  ctx: QueryCtx,
  args: ListAllMessagesArgs,
): Promise<Array<any>> {
  return await ctx.db
    .query("messages")
    .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
    .order("asc")
    .take(5000);
}

export interface GetUserMemoriesArgs extends Record<string, unknown> {
  userId: string;
}

export async function getUserMemoriesHandler(
  ctx: QueryCtx,
  args: GetUserMemoriesArgs,
): Promise<Array<any>> {
  return await ctx.db
    .query("memories")
    .withIndex("by_user", (q) => q.eq("userId", args.userId))
    .order("desc")
    .take(120);
}

export interface GetModelCapabilitiesArgs extends Record<string, unknown> {
  modelId: string;
}

export async function getModelCapabilitiesHandler(
  ctx: QueryCtx,
  args: GetModelCapabilitiesArgs,
): Promise<
  | {
      provider?: string;
      supportedParameters?: string[];
      hasAudioInput?: boolean;
      hasAudioOutput?: boolean;
      hasVideoInput?: boolean;
      hasImageGeneration?: boolean;
      hasReasoning?: boolean;
      contextLength?: number;
    }
  | null
> {
  const model = await ctx.db
    .query("cachedModels")
    .withIndex("by_modelId", (q) => q.eq("modelId", args.modelId))
    .first();

  if (!model) return null;

  return {
    provider: model.provider,
    supportedParameters: model.supportedParameters,
    hasAudioInput:
      model.architecture?.modality?.split("->")[0]?.includes("audio") ?? false,
    hasAudioOutput:
      model.architecture?.modality?.split("->")[1]?.includes("audio") ?? false,
    hasVideoInput:
      model.architecture?.modality?.split("->")[0]?.includes("video") ?? false,
    hasImageGeneration: model.supportsImages ?? false,
    hasReasoning:
      model.supportedParameters?.includes("include_reasoning") ?? false,
    contextLength: model.contextLength,
  };
}

export interface GetPersonaArgs extends Record<string, unknown> {
  personaId: string;
  userId: string;
}

export async function getPersonaHandler(
  ctx: QueryCtx,
  args: GetPersonaArgs,
): Promise<any | null> {
  let persona: any | null = null;
  try {
    const doc = await ctx.db.get(args.personaId as unknown as Id<"personas">);
    if (doc && doc.userId === args.userId) {
      persona = doc;
    }
  } catch {
    // ignore invalid id and fallback to scan
  }

  if (!persona) {
    const personas = await ctx.db
      .query("personas")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    persona =
      personas.find((p) => (p._id as string) === args.personaId) ?? null;
  }

  if (!persona) return null;

  // Resolve avatarImageStorageId → avatarImageUrl
  if (persona.avatarImageStorageId) {
    const avatarImageUrl = await ctx.storage.getUrl(persona.avatarImageStorageId);
    return { ...persona, avatarImageUrl: avatarImageUrl ?? undefined };
  }
  return { ...persona, avatarImageUrl: undefined };
}

export interface GetChatInternalArgs extends Record<string, unknown> {
  chatId: Id<"chats">;
}

export async function getChatInternalHandler(
  ctx: QueryCtx,
  args: GetChatInternalArgs,
): Promise<any | null> {
  return await ctx.db.get(args.chatId);
}

export interface GetMessageInternalArgs extends Record<string, unknown> {
  messageId: Id<"messages">;
}

export async function getMessageInternalHandler(
  ctx: QueryCtx,
  args: GetMessageInternalArgs,
): Promise<any | null> {
  return await ctx.db.get(args.messageId);
}

export interface GetGenerationJobInternalArgs extends Record<string, unknown> {
  jobId: Id<"generationJobs">;
}

export async function getGenerationJobInternalHandler(
  ctx: QueryCtx,
  args: GetGenerationJobInternalArgs,
): Promise<any | null> {
  return await ctx.db.get(args.jobId);
}

export interface GetUserPreferencesArgs extends Record<string, unknown> {
  userId: string;
}

export async function getUserPreferencesHandler(
  ctx: QueryCtx,
  args: GetUserPreferencesArgs,
): Promise<any | null> {
  return await ctx.db
    .query("userPreferences")
    .withIndex("by_user", (q) => q.eq("userId", args.userId))
    .first();
}

// ── Chat search (for search_chats AI tool) ─────────────────────────────

export interface SearchMessagesInternalArgs extends Record<string, unknown> {
  userId: string;
  searchQuery: string;
  limit: number;
}

/**
 * Full-text search across messages, scoped to the requesting user's chats.
 * Uses the `search_content` search index on the `messages` table.
 * Returns enriched results with chat titles and truncated snippets.
 */
export async function searchMessagesInternalHandler(
  ctx: QueryCtx,
  args: SearchMessagesInternalArgs,
): Promise<
  Array<{
    chatId: string;
    chatTitle: string;
    messageContent: string;
    messageRole: string;
    messageDate: string;
  }>
> {
  // Run full-text search on messages, scoped to this user at index time
  const safeLimit = Math.min(Math.max(Math.floor(args.limit), 1), 50);
  const searchResults = await ctx.db
    .query("messages")
    .withSearchIndex("search_content", (q) =>
      q.search("content", args.searchQuery).eq("userId", args.userId),
    )
    .take(safeLimit * 3); // Over-fetch to account for filtering

  // Filter to user's chats and enrich with chat titles
  const results: Array<{
    chatId: string;
    chatTitle: string;
    messageContent: string;
    messageRole: string;
    messageDate: string;
  }> = [];

  // Cache chat lookups to avoid repeated DB hits
  const chatCache = new Map<string, { title: string; userId: string } | null>();

  for (const msg of searchResults) {
    if (results.length >= safeLimit) break;

    // Skip empty or system messages
    if (!msg.content || msg.role === "system") continue;

    const chatIdStr = msg.chatId as string;
    if (!chatCache.has(chatIdStr)) {
      const chat = await ctx.db.get(msg.chatId);
      chatCache.set(
        chatIdStr,
        chat ? { title: chat.title ?? "Untitled Chat", userId: chat.userId } : null,
      );
    }

    const chatInfo = chatCache.get(chatIdStr);
    if (!chatInfo || chatInfo.userId !== args.userId) continue;

    // Truncate content to ~300 chars for the snippet
    const truncated =
      msg.content.length > 300
        ? msg.content.substring(0, 300) + "..."
        : msg.content;

    results.push({
      chatId: chatIdStr,
      chatTitle: chatInfo.title,
      messageContent: truncated,
      messageRole: msg.role,
      messageDate: new Date(msg.createdAt).toISOString(),
    });
  }

  return results;
}
