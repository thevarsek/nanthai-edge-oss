import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import {
  isImageGenerationAvailable,
  projectModelMediaContract,
} from "../models/media_capabilities";

type MemoryQueryResult = Partial<Doc<"memories">> & {
  _id: Id<"memories">;
  content: string;
};

type PersonaQueryResult = Partial<Doc<"personas">> & {
  _id: Id<"personas"> | string;
  userId: string;
  name?: string;
  avatarImageStorageId?: Id<"_storage"> | string;
  avatarImageUrl?: string;
};

export interface ListAllMessagesArgs extends Record<string, unknown> {
  chatId: Id<"chats">;
}

export async function listAllMessagesHandler(
  ctx: QueryCtx,
  args: ListAllMessagesArgs,
): Promise<Array<Doc<"messages">>> {
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
): Promise<MemoryQueryResult[]> {
  const [recent, alwaysOn, legacyPreferences, pinned] = await Promise.all([
    ctx.db.query("memories")
      .withIndex("by_user", (query) => query.eq("userId", args.userId))
      .order("desc")
      .take(120),
    ctx.db.query("memories")
      .withIndex("by_user_retrieval_mode", (query) =>
        query.eq("userId", args.userId).eq("retrievalMode", "alwaysOn")
      )
      .order("desc")
      .take(80),
    ctx.db.query("memories")
      .withIndex("by_user_type", (query) =>
        query.eq("userId", args.userId).eq("memoryType", "responsePreference")
      )
      .order("desc")
      .take(80),
    ctx.db.query("memories")
      .withIndex("by_user_pinned", (query) =>
        query.eq("userId", args.userId).eq("isPinned", true)
      )
      .take(80),
  ]);
  const unique = new Map<Id<"memories">, MemoryQueryResult>();
  for (const memory of [...recent, ...alwaysOn, ...legacyPreferences, ...pinned]) {
    unique.set(memory._id, memory);
  }
  return [...unique.values()];
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
      hasImageInput?: boolean;
      hasFileInput?: boolean;
      hasAudioInput?: boolean;
      hasAudioOutput?: boolean;
      hasVideoInput?: boolean;
      hasImageGeneration?: boolean;
      hasVideoGeneration?: boolean;
      hasReasoning?: boolean;
      hasZdrEndpoint?: boolean;
      contextLength?: number;
      imageCapabilities?: {
        supportsStreaming?: boolean;
        maxInputReferences?: number;
        supportedParameters?: Record<string, unknown>;
      };
      videoCapabilities?: {
        supportedResolutions: string[];
        supportedAspectRatios: string[];
        supportedDurations: number[];
        supportedFrameImages: string[];
        supportedSizes: string[];
        generateAudio: boolean;
        seed: boolean;
      };
    }
  | null
> {
  const model = await ctx.db
    .query("cachedModels")
    .withIndex("by_modelId", (q) => q.eq("modelId", args.modelId))
    .first();

  if (!model) return null;
  const projectedModel = projectModelMediaContract(model);

  return {
    provider: projectedModel.provider,
    supportedParameters: projectedModel.supportedParameters,
    hasImageInput:
      projectedModel.architecture?.modality?.split("->")[0]?.includes("image") ?? false,
    hasFileInput:
      projectedModel.architecture?.modality?.split("->")[0]?.includes("file") === true ||
      projectedModel.supportedParameters?.includes("file") === true,
    hasAudioInput:
      projectedModel.architecture?.modality?.split("->")[0]?.includes("audio") ?? false,
    hasAudioOutput:
      projectedModel.architecture?.modality?.split("->")[1]?.includes("audio") ?? false,
    hasVideoInput:
      projectedModel.architecture?.modality?.split("->")[0]?.includes("video") ?? false,
    hasImageGeneration: isImageGenerationAvailable(projectedModel),
    hasVideoGeneration: projectedModel.supportsVideo ?? false,
    hasReasoning:
      projectedModel.supportedParameters?.includes("include_reasoning") ?? false,
    hasZdrEndpoint: projectedModel.hasZdrEndpoint ?? false,
    contextLength: projectedModel.contextLength,
    imageCapabilities: isImageGenerationAvailable(projectedModel) && projectedModel.imageCapabilities
      ? {
          supportsStreaming: projectedModel.imageCapabilities.supportsStreaming,
          maxInputReferences: projectedModel.imageCapabilities.maxInputReferences,
          supportedParameters: projectedModel.imageCapabilities.supportedParameters,
        }
      : undefined,
    videoCapabilities: projectedModel.videoCapabilities
      ? {
          supportedResolutions: projectedModel.videoCapabilities.supportedResolutions,
          supportedAspectRatios: projectedModel.videoCapabilities.supportedAspectRatios,
          supportedDurations: projectedModel.videoCapabilities.supportedDurations,
          supportedFrameImages: projectedModel.videoCapabilities.supportedFrameImages,
          supportedSizes: projectedModel.videoCapabilities.supportedSizes,
          generateAudio: projectedModel.videoCapabilities.generateAudio,
          seed: projectedModel.videoCapabilities.seed,
        }
      : undefined,
  };
}

export interface GetPersonaArgs extends Record<string, unknown> {
  personaId: string;
  userId: string;
}

export async function getPersonaHandler(
  ctx: QueryCtx,
  args: GetPersonaArgs,
): Promise<PersonaQueryResult | null> {
  let persona: PersonaQueryResult | null = null;
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
    const avatarImageUrl = await ctx.storage.getUrl(
      persona.avatarImageStorageId as Id<"_storage">,
    );
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
): Promise<Doc<"chats"> | null> {
  return await ctx.db.get(args.chatId);
}

export interface GetMessageInternalArgs extends Record<string, unknown> {
  messageId: Id<"messages">;
}

export async function getMessageInternalHandler(
  ctx: QueryCtx,
  args: GetMessageInternalArgs,
): Promise<Doc<"messages"> | null> {
  return await ctx.db.get(args.messageId);
}

export interface GetGenerationJobInternalArgs extends Record<string, unknown> {
  jobId: Id<"generationJobs">;
}

export async function getGenerationJobInternalHandler(
  ctx: QueryCtx,
  args: GetGenerationJobInternalArgs,
): Promise<Doc<"generationJobs"> | null> {
  return await ctx.db.get(args.jobId);
}

export async function getGenerationContinuationInternalHandler(
  ctx: QueryCtx,
  args: GetGenerationJobInternalArgs,
): Promise<Doc<"generationContinuations"> | null> {
  return await ctx.db
    .query("generationContinuations")
    .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
    .first();
}

export interface GetUserPreferencesArgs extends Record<string, unknown> {
  userId: string;
}

export async function getUserPreferencesHandler(
  ctx: QueryCtx,
  args: GetUserPreferencesArgs,
): Promise<Doc<"userPreferences"> | null> {
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

// ── M29: Video Generation ─────────────────────────────────────────────

export interface GetVideoJobInternalArgs extends Record<string, unknown> {
  videoJobId: Id<"videoJobs">;
}

export async function getVideoJobInternalHandler(
  ctx: QueryCtx,
  args: GetVideoJobInternalArgs,
): Promise<Doc<"videoJobs"> | null> {
  return await ctx.db.get(args.videoJobId);
}

export interface GetVideoOutputUploadByTokenArgs extends Record<string, unknown> {
  token: string;
}

export async function getVideoOutputUploadByTokenHandler(
  ctx: QueryCtx,
  args: GetVideoOutputUploadByTokenArgs,
): Promise<Doc<"videoOutputUploads"> | null> {
  return await ctx.db
    .query("videoOutputUploads")
    .withIndex("by_token", (q) => q.eq("token", args.token))
    .first();
}
