import { internalAction, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { prepareSpeechEndpoints, speechEndpointCapabilitiesValidator } from "./speech_capabilities";
import type { SpeechEndpoint } from "./speech_capabilities";

interface SpeechCatalogModel { id: string; canonical_slug?: string }
interface ZdrEndpoint { model_id: string; tag: string }

export const syncSpeechCapabilities = internalAction({
  args: {},
  returns: v.object({ updated: v.number(), skipped: v.number() }),
  handler: async (ctx) => {
    const [catalog, zdr] = await Promise.all([
      fetch("https://openrouter.ai/api/v1/models?output_modalities=speech"),
      fetch("https://openrouter.ai/api/v1/endpoints/zdr"),
    ]);
    if (!catalog.ok || !zdr.ok) return { updated: 0, skipped: 1 };
    const models = await catalog.json() as { data?: SpeechCatalogModel[] };
    const policies = await zdr.json() as { data?: ZdrEndpoint[] };
    if (!Array.isArray(models.data) || !Array.isArray(policies.data)) {
      return { updated: 0, skipped: 1 };
    }
    let updated = 0;
    let skipped = 0;
    // Small independent metadata fetches; never fan out the entire catalogue.
    for (let offset = 0; offset < models.data.length; offset += 4) {
      const results = await Promise.all(models.data.slice(offset, offset + 4).map(async (model) => {
        try {
          const slug = model.canonical_slug ?? model.id;
          const response = await fetch(`https://openrouter.ai/api/v1/models/${slug}/endpoints`);
          if (!response.ok) return null;
          const payload = await response.json() as { data?: { endpoints?: SpeechEndpoint[] } };
          if (!Array.isArray(payload.data?.endpoints)) return null;
          const tags = new Set(policies.data?.filter((endpoint) => endpoint.model_id === model.id)
            .map((endpoint) => endpoint.tag));
          return { modelId: model.id, capabilities: prepareSpeechEndpoints(payload.data.endpoints, tags, Date.now()) };
        } catch { return null; }
      }));
      for (const result of results) {
        if (!result) { skipped += 1; continue; }
        if (await ctx.runMutation(internal.models.speech_sync.updateSpeechCapabilities, result)) updated += 1;
        else skipped += 1;
      }
    }
    return { updated, skipped };
  },
});

export const updateSpeechCapabilities = internalMutation({
  args: { modelId: v.string(), capabilities: speechEndpointCapabilitiesValidator },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const model = await ctx.db.query("cachedModels")
      .withIndex("by_modelId", (q) => q.eq("modelId", args.modelId)).first();
    if (!model) return false;
    await ctx.db.patch(model._id, { speechCapabilities: args.capabilities });
    return true;
  },
});
