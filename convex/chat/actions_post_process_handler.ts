import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { DeepPartial, mergeTestDeps } from "../lib/test_deps";
import { isPlaceholderTitle } from "./title_helpers";
import { isZdrEnabled } from "../lib/openrouter_zdr";

export interface PostProcessArgs extends Record<string, unknown> {
  chatId: Id<"chats">;
  userMessageId: Id<"messages">;
  assistantMessageIds: Id<"messages">[];
  userId: string;
}

const MIN_MEMORY_USER_CONTENT_LENGTH = 10;
const defaultPostProcessHandlerDeps = {
  isPlaceholderTitle,
};

export type PostProcessHandlerDeps = typeof defaultPostProcessHandlerDeps;

export function createPostProcessHandlerDepsForTest(
  overrides: DeepPartial<PostProcessHandlerDeps> = {},
): PostProcessHandlerDeps {
  return mergeTestDeps(defaultPostProcessHandlerDeps, overrides);
}

export async function postProcessHandler(
  ctx: ActionCtx,
  args: PostProcessArgs,
  deps: PostProcessHandlerDeps = defaultPostProcessHandlerDeps,
): Promise<void> {
  const writable = await ctx.runQuery(internal.chat.post_process_guard.isChatWritable, {
    chatId: args.chatId,
    userId: args.userId,
  });
  if (!writable) return;
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
  const assistantMessages: Array<Doc<"messages"> | null> = await Promise.all(
    args.assistantMessageIds.map((msgId) =>
      ctx.runQuery(internal.chat.queries.getMessageInternal, {
        messageId: msgId,
      }),
    ),
  );
  const assistantContents = assistantMessages.flatMap((msg) => {
    if (msg === null || msg.status !== "completed") {
      return [];
    }
    const content = msg.content.trim();
    return content === "" ? [] : [content];
  });
  const assistantContent = assistantContents.join(
    "\n\n<assistant_response_separator>\n\n",
  );
  const requireZdr = isZdrEnabled(prefs);

  const needsTitle = deps.isPlaceholderTitle(chat.title);
  const sourceContentForTitle = userContent || assistantContent;
  if (needsTitle && sourceContentForTitle) {
    const configuredTitleModel = requireZdr
      ? undefined
      : prefs?.titleModelId?.trim() || undefined;
    await ctx.runMutation(internal.execution.workload_queues.enqueueTitle, {
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

  const extractionModel = requireZdr
    ? undefined
    : prefs?.memoryExtractionModelId?.trim() || undefined;
  await ctx.runMutation(internal.execution.workload_queues.enqueueMemoryExtraction, {
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
