import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";

export const voiceCloningRequestValidator = v.object({
  modelId: v.string(),
  permissionConfirmed: v.boolean(),
  references: v.array(v.object({
    storageId: v.id("_storage"),
    transcript: v.optional(v.string()),
  })),
});

export interface VoiceCloningRequest {
  modelId: string;
  permissionConfirmed: boolean;
  references: Array<{ storageId: Id<"_storage">; transcript?: string }>;
}

export function validateVoiceCloningRequest(
  request: VoiceCloningRequest,
  capabilities: { maxAudioReferences: number; maxZdrAudioReferences: number } | undefined,
  requireZdr: boolean,
  attachments: Array<{ storageId?: string; mimeType?: string; sizeBytes?: number }>,
): void {
  const fail = (message: string): never => { throw new ConvexError({ code: "VOICE_CLONING_INVALID", message }); };
  if (request.permissionConfirmed !== true) fail("Confirm that you have permission to use these voices for this request.");
  const maximum = requireZdr ? capabilities?.maxZdrAudioReferences : capabilities?.maxAudioReferences;
  if (!maximum) fail(requireZdr ? "The selected model has no ZDR voice-cloning endpoint." : "The selected model does not support voice cloning.");
  if (request.references.length < 1 || request.references.length > (maximum ?? 0)) {
    fail(`Choose between one and ${maximum ?? 0} audio references for the selected model.`);
  }
  if (new Set(request.references.map((reference) => reference.storageId)).size !== request.references.length) {
    fail("Each voice reference must be a different recording.");
  }
  for (const reference of request.references) {
    const attachment = attachments.find((candidate) => candidate.storageId === reference.storageId);
    if (!attachment) fail("Voice references must be owned audio attached to this request.");
    if (!attachment?.mimeType?.startsWith("audio/")) fail("Voice references must be audio recordings.");
    if (!attachment?.sizeBytes || attachment.sizeBytes > 15 * 1024 * 1024) fail("Each audio reference must be nonempty and at most 15 MiB.");
    if ((reference.transcript?.length ?? 0) > 10_000) fail("Each reference transcript may contain at most 10,000 characters.");
  }
}

export function validateReferencePlaceholders(modelId: string, input: string, count: number): void {
  if (!modelId.startsWith("bytedance-seed/seed-audio-")) return;
  const used = new Set(Array.from(input.matchAll(/@Audio(\d+)/g), (match) => Number(match[1])));
  if (Array.from(used).some((number) => number < 1 || number > count)
    || (count > 1 && Array.from({ length: count }, (_, index) => index + 1).some((number) => !used.has(number)))) {
    throw new ConvexError({ code: "VOICE_CLONING_INVALID", message: "Use @Audio1, @Audio2 and @Audio3 for every supplied Seed audio reference, without referencing a missing clip." });
  }
}
