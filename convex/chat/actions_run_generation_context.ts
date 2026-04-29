import { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { hydrateAttachmentsForRequest, type MessageWithStoredAttachments } from "./action_image_helpers";
import { ModelCapabilities, RunGenerationArgs } from "./actions_run_generation_types";

export interface GenerationContext {
  allMessages: MessageWithStoredAttachments[];
  memoryContext: string | undefined;
  modelCapabilities: Map<string, ModelCapabilities>;
}

export async function prepareGenerationContext(
  ctx: ActionCtx,
  args: RunGenerationArgs,
  preloadedCapabilities?: Map<string, ModelCapabilities>,
): Promise<GenerationContext> {
  const rawMessages = await ctx.runQuery(internal.chat.queries.listAllMessages, {
    chatId: args.chatId,
  });
  const allMessages = await hydrateAttachmentsForRequest(ctx, rawMessages);

  let modelCapabilities: Map<string, ModelCapabilities>;
  if (preloadedCapabilities && preloadedCapabilities.size > 0) {
    modelCapabilities = preloadedCapabilities;
  } else {
    const uniqueModelIds = [...new Set(args.participants.map((participant) => participant.modelId))];
    const capabilityEntries = await Promise.all(
      uniqueModelIds.map(async (modelId) => ({
        modelId,
        caps: await ctx.runQuery(internal.chat.queries.getModelCapabilities, { modelId }),
      })),
    );
    modelCapabilities = new Map<string, ModelCapabilities>();
    for (const { modelId, caps } of capabilityEntries) {
      if (caps) {
        modelCapabilities.set(modelId, caps);
      }
    }
  }

  return { allMessages, memoryContext: undefined, modelCapabilities };
}
