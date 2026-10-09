import { getVoiceCloningSource } from "./voice_cloning_source";
import { internalQuery, type MutationCtx } from "../_generated/server";
import { ConvexError, v } from "convex/values";
import type { VoiceCloningRequest } from "./voice_cloning_contract";
import { validateVoiceCloningRequest, voiceCloningRequestValidator } from "./voice_cloning_contract";
import { projectVoiceCloningCapabilities } from "../models/speech_capabilities";

export async function validateVoiceCloningAdmission(
  ctx: MutationCtx,
  request: VoiceCloningRequest | undefined,
  requireZdr: boolean,
  attachments: Array<{ storageId?: string; mimeType?: string; sizeBytes?: number }>,
) {
  if (!request) return;
  const model = await ctx.db.query("cachedModels")
    .withIndex("by_modelId", (q) => q.eq("modelId", request.modelId)).first();
  validateVoiceCloningRequest(request, projectVoiceCloningCapabilities(model?.speechCapabilities), requireZdr, attachments);
}

// Consent is read from the authenticated source message, never from tool/model output.
export const getTurnReferences = internalQuery({
  args: { messageId: v.id("messages"), userId: v.string() },
  returns: v.union(v.null(), v.object({
    request: voiceCloningRequestValidator,
    references: v.array(v.object({ storageId: v.id("_storage"), url: v.string(), transcript: v.optional(v.string()), mimeType: v.string(), sizeBytes: v.number() })),
  })),
  handler: async (ctx, args) => {
    const source = await getVoiceCloningSource(ctx, args.messageId, args.userId);
    if (!source?.voiceCloning) return null;
    const references = [];
      for (const reference of source.voiceCloning.references) {
        const owned = await ctx.db.query("fileAttachments")
          .withIndex("by_storage", (q) => q.eq("storageId", reference.storageId)).collect();
        if (!owned.some((file) => file.userId === args.userId && file.messageId === source._id)) {
          throw new ConvexError({ code: "VOICE_REFERENCE_UNAVAILABLE", message: "A selected voice reference is no longer owned by this request." });
        }
        const metadata = await ctx.db.system.get(reference.storageId);
        const url = await ctx.storage.getUrl(reference.storageId);
        if (!metadata || !url) {
          throw new ConvexError({ code: "VOICE_REFERENCE_UNAVAILABLE", message: "A selected voice reference is no longer available." });
        }
        references.push({ ...reference, url, mimeType: metadata.contentType ?? "", sizeBytes: metadata.size });
      }
      return { request: source.voiceCloning, references };
  },
});
