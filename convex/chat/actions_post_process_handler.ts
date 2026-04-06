import { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { isPlaceholderTitle } from "./title_helpers";

export interface PostProcessArgs extends Record<string, unknown> {
  chatId: Id<"chats">;
  userMessageId: Id<"messages">;
  assistantMessageIds: Id<"messages">[];
  userId: string;
}

const MIN_MEMORY_USER_CONTENT_LENGTH = 10;

export async function postProcessHandler(
  ctx: ActionCtx,
  args: PostProcessArgs,
): Promise<void> {
  // Parallelize independent reads: chat, user message, and preferences
  const [chat, userMsg, prefs] = await Promise.all([
    ctx.runQuery(internal.chat.queries.getChatInternal, {
      chatId: args.chatId,
    }),
    ctx.runQuery(internal.chat.queries.getMessageInternal, {
      messageId: args.userMessageId,
    }),
    ctx.runQuery(internal.chat.queries.getUserPreferences, {
      userId: args.userId,
    }),
  ]);
  if (!chat) return;

  if (userMsg?.source === "scheduled_step") {
    return;
  }
  const userContent = userMsg?.content?.trim() ?? "";

  // Parallelize assistant message fetches
  const assistantMessages = await Promise.all(
    args.assistantMessageIds.map((msgId) =>
      ctx.runQuery(internal.chat.queries.getMessageInternal, {
        messageId: msgId,
      }),
    ),
  );
  const assistantContents = assistantMessages
    .filter((msg): msg is NonNullable<typeof msg> =>
      msg !== null && msg.status === "completed" && msg.content.trim() !== "",
    )
    .map((msg) => msg.content.trim());
  const assistantContent = assistantContents.join(
    "\n\n<assistant_response_separator>\n\n",
  );

  const needsTitle = isPlaceholderTitle(chat.title);
  const sourceContentForTitle = userContent || assistantContent;
  if (needsTitle && sourceContentForTitle) {
    const configuredTitleModel = prefs?.titleModelId?.trim() || undefined;
    await ctx.scheduler.runAfter(0, internal.chat.actions.generateTitle, {
      chatId: args.chatId,
      sourceContent: sourceContentForTitle,
      assistantContent: assistantContent || undefined,
      titleModel: configuredTitleModel,
      userId: args.userId,
      messageId: args.assistantMessageIds[0], // M23: cost attribution
    });
  }

  if (userContent.length < MIN_MEMORY_USER_CONTENT_LENGTH) {
    return;
  }

  const memoryEnabled = prefs?.isMemoryEnabled ?? true;
  const gatingMode = prefs?.memoryGatingMode ?? "automatic";
  if (!memoryEnabled || gatingMode === "disabled") {
    return;
  }

  const extractionModel = prefs?.memoryExtractionModelId?.trim() || undefined;
  await ctx.scheduler.runAfter(0, internal.chat.actions.extractMemories, {
    chatId: args.chatId,
    userMessageContent: userContent,
    userMessageId: args.userMessageId,
    assistantMessageId: args.assistantMessageIds[0],
    assistantContent,
    userId: args.userId,
    extractionModel,
    isPending: gatingMode === "manualConfirm",
  });
}
