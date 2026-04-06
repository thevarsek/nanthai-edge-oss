import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { formatMemoryContext } from "./helpers";
import { selectMemoriesForContext } from "./actions_memory_lifecycle";
import {
  isMemoryVisibleToPersona,
  normalizeMemoryRecord,
  prioritizeAlwaysOnMemories,
} from "../memory/shared";
import { MODEL_IDS } from "../lib/model_constants";

interface MemoryContextArgs {
  messages: Array<{ _id: Id<"messages">; role: string; content: string }>;
  userMessageId: Id<"messages">;
  userId: string;
  personaId?: Id<"personas"> | null;
  // M23: Optional chat attribution for embedding cost tracking.
  chatId?: Id<"chats">;
  assistantMessageId?: Id<"messages">;
}

type ActionContextLike = Pick<ActionCtx, "runAction" | "runQuery" | "runMutation">;

export async function resolveMemoryContextForGeneration(
  ctx: ActionContextLike,
  args: MemoryContextArgs,
): Promise<string> {
  const promptUserMessage = args.messages.find(
    (message) => message._id === args.userMessageId && message.role === "user",
  );
  const fallbackUserMessage = args.messages
    .slice()
    .reverse()
    .find((message) => message.role === "user");
  const memoryQueryText =
    promptUserMessage?.content?.trim() ??
    fallbackUserMessage?.content?.trim() ??
    "";
  const allMemories = (
    await ctx.runQuery(internal.chat.queries.getUserMemories, { userId: args.userId })
  )
    .map((memory: any) => normalizeMemoryRecord(memory))
    .filter((memory: any) => isMemoryVisibleToPersona(memory, args.personaId));

  const alwaysOn = prioritizeAlwaysOnMemories(
    allMemories.filter((memory: any) => memory.retrievalMode === "alwaysOn"),
    MODEL_IDS.memoryAlwaysOnLimit,
  );

  let memoryCandidates: Array<any> = [];
  if (memoryQueryText.length > 0) {
    try {
      const relevantMemories = await ctx.runAction(
        internal.memory.operations.retrieveRelevant,
        {
          queryText: memoryQueryText,
          userId: args.userId,
          limit: 12,
          chatId: args.chatId,
          messageId: args.assistantMessageId,
        },
      );
      memoryCandidates = relevantMemories
        .map((memory: any) => normalizeMemoryRecord(memory))
        .filter(
          (memory: any) =>
            memory.retrievalMode === "contextual" &&
            isMemoryVisibleToPersona(memory, args.personaId),
        );
    } catch (error) {
      console.error("Vector memory retrieval failed", error);
    }
  }

  if (memoryCandidates.length === 0) {
    memoryCandidates = allMemories.filter(
      (memory: any) => memory.retrievalMode === "contextual",
    );
  }

  const contextual = selectMemoriesForContext(
    memoryCandidates,
    memoryQueryText,
    12,
  );
  const selected = [
    ...alwaysOn,
    ...contextual.filter(
      (memory) => !alwaysOn.some((alwaysOnMemory) => alwaysOnMemory._id === memory._id),
    ),
  ];

  const selectedIds = selected
    .map((memory) => memory._id)
    .filter((id): id is Id<"memories"> => typeof id === "string");
  if (selectedIds.length > 0) {
    await ctx.runMutation(internal.chat.mutations.touchMemories, {
      memoryIds: selectedIds,
      touchedAt: Date.now(),
    });
  }

  return formatMemoryContext(
    selected.map((memory) => ({
      content: memory.content,
      isPinned: memory.isPinned ?? false,
      memoryType: memory.memoryType,
      category: memory.category,
      retrievalMode: memory.retrievalMode,
      importanceScore: memory.importanceScore,
    })),
  ) ?? "";
}
