import { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { callOpenRouterNonStreaming, OpenRouterMessage } from "../lib/openrouter";
import { getRequiredUserOpenRouterApiKey } from "../lib/user_secrets";
import { MODEL_IDS } from "../lib/model_constants";
import {
  fallbackTitleFromSource,
  isPlaceholderTitle,
  normalizedGeneratedTitle,
} from "./title_helpers";

const DEFAULT_TITLE_MODEL = MODEL_IDS.titleGeneration;

export interface GenerateTitleArgs extends Record<string, unknown> {
  chatId: Id<"chats">;
  sourceContent: string;
  assistantContent?: string;
  titleModel?: string;
  seedTitle?: string;
  userId: string;
  messageId?: Id<"messages">; // M23: for ancillary cost attribution
}

function canUpdateChatTitle(
  title: string | undefined | null,
  seedTitle: string,
): boolean {
  const normalizedTitle = (title ?? "").trim();
  if (isPlaceholderTitle(title)) return true;
  return seedTitle.length > 0 && normalizedTitle === seedTitle;
}

export async function generateTitleHandler(
  ctx: ActionCtx,
  args: GenerateTitleArgs,
): Promise<void> {
  const currentChat = await ctx.runQuery(internal.chat.queries.getChatInternal, {
    chatId: args.chatId,
  });
  if (!currentChat) {
    return;
  }

  const normalizedCurrentTitle = (currentChat.title ?? "").trim();
  const normalizedSeedTitle = (args.seedTitle ?? "").trim();
  const canOverwriteSeed =
    normalizedSeedTitle.length > 0 &&
    normalizedCurrentTitle.length > 0 &&
    normalizedCurrentTitle === normalizedSeedTitle;

  if (!isPlaceholderTitle(currentChat.title) && !canOverwriteSeed) {
    return;
  }

  const fallbackTitle = fallbackTitleFromSource(
    args.sourceContent,
    args.assistantContent,
  );
  const messages: OpenRouterMessage[] = [
    {
      role: "system",
      content:
        "You are a chat title generator. Your ONLY job is to produce a short title " +
        "(max 6 words) that summarises WHAT THE USER IS ASKING ABOUT — their topic " +
        "or intent, NOT an answer to their question.\n\n" +
        "Rules:\n" +
        "- Generate the title in the SAME LANGUAGE as the user's message. If the user writes in French, title in French. If in Japanese, title in Japanese. Etc.\n" +
        "- Describe the subject/topic, never answer or interpret the question.\n" +
        "- Use neutral, descriptive language (e.g. \"React useEffect cleanup\" not \"How to fix useEffect\").\n" +
        "- No punctuation, quotes, or prefixes like \"Title:\".\n" +
        "- No hallucinated details beyond what the user actually wrote.\n" +
        "- If the conversation is a greeting or vague, use a generic label like \"General chat\" (in the user's language).\n" +
        "- Return ONLY the title text, nothing else.",
    },
    {
      role: "user",
      content: args.assistantContent
        ? `User message: ${args.sourceContent}\nAssistant response: ${args.assistantContent}`
        : `User message: ${args.sourceContent}`,
    },
  ];

  try {
    const apiKey = await getRequiredUserOpenRouterApiKey(ctx, args.userId);
    const model =
      args.titleModel?.trim().length
        ? args.titleModel.trim()
        : DEFAULT_TITLE_MODEL;
    const result = await callOpenRouterNonStreaming(
      apiKey,
      model,
      messages,
      { temperature: 0.1, maxTokens: 24 },
      { fallbackModel: DEFAULT_TITLE_MODEL },
    );

    // M23: Track title generation cost.
    if (args.messageId && result.usage) {
      await ctx.runMutation(internal.chat.mutations.storeAncillaryCost, {
        messageId: args.messageId,
        chatId: args.chatId,
        userId: args.userId,
        modelId: model,
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        totalTokens: result.usage.totalTokens,
        cost: result.usage.cost,
        source: "title",
        generationId: result.generationId ?? undefined,
      });
    }

    let title = normalizedGeneratedTitle(result.content);
    if (!title || isPlaceholderTitle(title)) {
      title = fallbackTitle;
    }

    if (!title) {
      return;
    }

    const latestChat = await ctx.runQuery(internal.chat.queries.getChatInternal, {
      chatId: args.chatId,
    });
    if (!latestChat || !canUpdateChatTitle(latestChat.title, normalizedSeedTitle)) {
      return;
    }

    await ctx.runMutation(internal.chat.mutations.updateChatTitle, {
      chatId: args.chatId,
      title,
    });
  } catch {
    if (!fallbackTitle) {
      return;
    }

    const latestChat = await ctx.runQuery(internal.chat.queries.getChatInternal, {
      chatId: args.chatId,
    });
    if (!latestChat || !canUpdateChatTitle(latestChat.title, normalizedSeedTitle)) {
      return;
    }

    await ctx.runMutation(internal.chat.mutations.updateChatTitle, {
      chatId: args.chatId,
      title: fallbackTitle,
    });
  }
}
