import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { assertUserDataWritable } from "../lib/write_fence";
import { normalizeMemoryRecord } from "../memory/shared";
import { assertMemoryHelperExecution, type MemoryHelperExecution } from "../memory/helper_write_fence";

export interface UpdateChatTitleArgs extends Record<string, unknown>, MemoryHelperExecution {
  chatId: Id<"chats">;
  title: string;
}

export async function updateChatTitleHandler(
  ctx: MutationCtx,
  args: UpdateChatTitleArgs,
): Promise<void> {
  const chat = await ctx.db.get(args.chatId);
  if (!chat) return;
  await assertUserDataWritable(ctx, chat.userId, chat._id);
  await assertMemoryHelperExecution(ctx, args, chat.userId);
  // Intentionally skip updatedAt — title generation is a background refinement
  // and should not re-sort the chat list or trigger an extra listChats cascade.
  // sendMessage already bumped updatedAt when the chat was created/sent.
  await ctx.db.patch(args.chatId, {
    title: args.title,
  });
}

export interface CreateMemoryArgs extends Record<string, unknown>, MemoryHelperExecution {
  userId: string;
  content: string;
  category?: string;
  memoryType?: "profile" | "responsePreference" | "workContext" | "transient";
  importanceScore?: number;
  confidenceScore?: number;
  reinforcementCount?: number;
  lastReinforcedAt?: number;
  expiresAt?: number;
  supersedesMemoryId?: Id<"memories">;
  sourceMessageId?: Id<"messages">;
  sourceChatId?: Id<"chats">;
  retrievalMode?: string;
  scopeType?: string;
  personaIds?: string[];
  sourceType?: string;
  sourceFileName?: string;
  tags?: string[];
  isPending?: boolean;
  createdAt: number;
}

export async function createMemoryHandler(
  ctx: MutationCtx,
  args: CreateMemoryArgs,
): Promise<Id<"memories">> {
  await assertUserDataWritable(ctx, args.userId, args.sourceChatId);
  await assertMemoryHelperExecution(ctx, args, args.userId);
  const normalized = normalizeMemoryRecord({
    content: args.content,
    category: args.category,
    memoryType: args.memoryType,
    retrievalMode: args.retrievalMode,
    scopeType: args.scopeType,
    personaIds: args.personaIds,
    sourceType: args.sourceType,
    sourceFileName: args.sourceFileName,
    tags: args.tags,
    importanceScore: args.importanceScore,
  });
  return await ctx.db.insert("memories", {
    userId: args.userId,
    content: args.content,
    category: normalized.category,
    sourceMessageId: args.sourceMessageId,
    sourceChatId: args.sourceChatId,
    isPinned: false,
    isPending: args.isPending ?? false,
    accessCount: 0,
    memoryType: args.memoryType ?? "workContext",
    retrievalMode: normalized.retrievalMode,
    scopeType: normalized.scopeType,
    personaIds: normalized.personaIds,
    sourceType: normalized.sourceType,
    sourceFileName: normalized.sourceFileName,
    tags: normalized.tags,
    importanceScore: args.importanceScore ?? 0.6,
    confidenceScore: args.confidenceScore ?? 0.6,
    reinforcementCount: args.reinforcementCount ?? 1,
    lastReinforcedAt: args.lastReinforcedAt ?? args.createdAt,
    expiresAt: args.expiresAt,
    isSuperseded: false,
    supersedesMemoryId: args.supersedesMemoryId,
    createdAt: args.createdAt,
    updatedAt: args.createdAt,
  });
}

