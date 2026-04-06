import { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { hydrateAttachmentsForRequest } from "./action_image_helpers";
import { ModelCapabilities, RunGenerationArgs } from "./actions_run_generation_types";

export interface GenerationContext {
  allMessages: Array<any>;
  memoryContext: string | undefined;
  modelCapabilities: Map<string, ModelCapabilities>;
}

export async function prepareGenerationContext(
  ctx: ActionCtx,
  args: RunGenerationArgs,
): Promise<GenerationContext> {
  const rawMessages = await ctx.runQuery(internal.chat.queries.listAllMessages, {
    chatId: args.chatId,
  });
  const allMessages = await hydrateAttachmentsForRequest(ctx, rawMessages);

  const modelCapabilities = new Map<string, ModelCapabilities>();
  for (const participant of args.participants) {
    if (!modelCapabilities.has(participant.modelId)) {
      const caps = await ctx.runQuery(internal.chat.queries.getModelCapabilities, {
        modelId: participant.modelId,
      });
      if (caps) {
        modelCapabilities.set(participant.modelId, caps);
      }
    }
  }

  return { allMessages, memoryContext: undefined, modelCapabilities };
}
