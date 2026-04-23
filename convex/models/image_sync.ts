// convex/models/image_sync.ts
// =============================================================================
// Sync image-generation-capable models from OpenRouter's
// /api/v1/models?output_modalities=image endpoint, then fetch per-model SKU
// pricing from /api/v1/models/{id}/endpoints.
//
// Rationale: image-only models (FLUX, Sourceful Riverflow, ByteDance Seedream,
// etc. — output modality `text+image->image` with no text output) are silently
// EXCLUDED from the general /api/v1/models response. They are only returned
// when the output_modalities query param explicitly asks for them.
// Multimodal image models (Gemini Image, GPT-5 Image, Auto Router — output
// modality `text+image->text+image`) DO appear in both endpoints and are
// owned by the main sync (convex/models/sync.ts).
//
// **Pricing gotcha**: the listing endpoint reports `pricing.prompt: "0"` /
// `pricing.completion: "0"` for all image-only models — the REAL per-image-
// token and per-image-output rates are only exposed at
// /api/v1/models/{id}/endpoints as `pricing.image_token` and
// `pricing.image_output`. We fetch those in a second pass and store them in
// `imageCapabilities.pricingSkus`.
//
// Strategy:
//   1. Fetch ?output_modalities=image (17 models as of 2026-04).
//   2. Fetch /endpoints for each model (in small parallel batches) to get
//      real SKU pricing.
//   3. For each model, detect if it is image-only (`!output.includes("text")`):
//        - image-only  → create/patch with `managedByImageSync: true`. These
//                        rows are skipped by `pruneStaleModels` in sync.ts so
//                        the main sync does not delete them.
//        - multimodal  → patch only the pricing/marker hint onto the existing
//                        row (no-op if row is missing; main sync will create
//                        it on the next /api/v1/models pass).
//   4. Cadence: every 4 hours via cron, offset from main + video syncs.
// =============================================================================

import { v } from "convex/values";
import { internalAction, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { HTTP_REFERER, X_TITLE } from "../lib/openrouter_constants";

// -- Types --------------------------------------------------------------------

interface ImageModelResponse {
  id: string;
  name?: string;
  canonical_slug?: string;
  description?: string;
  context_length?: number;
  architecture?: {
    modality?: string;
    tokenizer?: string;
    instruct_type?: string | null;
    input_modalities?: string[];
    output_modalities?: string[];
  };
  pricing?: {
    prompt?: string;
    completion?: string;
    image?: string; // per-image cost in dollars (rarely populated here)
  };
  top_provider?: {
    max_completion_tokens?: number;
  };
  supported_parameters?: string[];
}

interface EndpointPricing {
  prompt?: string;
  completion?: string;
  image?: string;
  image_token?: string;
  image_output?: string;
  discount?: number;
}

interface ModelEndpointsResponse {
  data?: {
    endpoints?: Array<{
      provider_name?: string;
      pricing?: EndpointPricing;
    }>;
  };
}

function extractProvider(modelId: string): string {
  const slash = modelId.indexOf("/");
  return slash > 0 ? modelId.substring(0, slash) : "unknown";
}

function parsePricePer1M(priceStr: string | undefined): number | undefined {
  if (!priceStr) return undefined;
  const parsed = parseFloat(priceStr);
  if (isNaN(parsed)) return undefined;
  return parsed * 1_000_000;
}

function parsePricePerImage(priceStr: string | undefined): number | undefined {
  if (!priceStr) return undefined;
  const parsed = parseFloat(priceStr);
  if (isNaN(parsed) || parsed <= 0) return undefined;
  return parsed;
}

/** Keep SKU price as a string (matches videoCapabilities.pricingSkus shape). */
function normalizeSkuString(priceStr: string | undefined): string | undefined {
  if (!priceStr) return undefined;
  const parsed = parseFloat(priceStr);
  if (isNaN(parsed) || parsed <= 0) return undefined;
  return priceStr;
}

/** True if the model's output modality is image-only (no `text`). */
function isImageOnly(modality: string | undefined): boolean {
  if (!modality) return false;
  const parts = modality.split("->");
  if (parts.length < 2) return false;
  const output = parts[1];
  return output.includes("image") && !output.includes("text");
}

/**
 * Fetch SKU pricing from /api/v1/models/{id}/endpoints. Returns the first
 * endpoint's pricing object (OpenRouter may list multiple providers per
 * model; we pick the primary/first — it is what OpenRouter bills against
 * by default). Null on any error so the caller can proceed without SKUs.
 */
async function fetchEndpointPricing(
  modelId: string,
): Promise<EndpointPricing | null> {
  try {
    const response = await fetch(
      `https://openrouter.ai/api/v1/models/${modelId}/endpoints`,
      {
        headers: {
          "HTTP-Referer": HTTP_REFERER,
          "X-Title": X_TITLE,
        },
      },
    );
    if (!response.ok) return null;
    const data = (await response.json()) as ModelEndpointsResponse;
    const first = data.data?.endpoints?.[0];
    return first?.pricing ?? null;
  } catch (err) {
    console.warn(`[image_sync] /endpoints fetch failed for ${modelId}:`, err);
    return null;
  }
}

// -- Sync action --------------------------------------------------------------

export const syncImageModels = internalAction({
  args: {},
  handler: async (ctx) => {
    const response = await fetch(
      "https://openrouter.ai/api/v1/models?output_modalities=image",
      {
        headers: {
          "HTTP-Referer": HTTP_REFERER,
          "X-Title": X_TITLE,
        },
      },
    );

    if (!response.ok) {
      console.error(
        `Image models sync failed: ${response.status} ${response.statusText}`,
      );
      return;
    }

    const data = await response.json();
    const rawModels: ImageModelResponse[] = Array.isArray(data.data)
      ? data.data
      : [];

    if (rawModels.length === 0) {
      console.log("Image models sync: no models returned — skipping");
      return;
    }

    // Second pass: fetch /endpoints for each model to pick up real SKU
    // pricing (listing endpoint reports $0). Small concurrency cap to avoid
    // hammering OpenRouter — 4 in flight is well under any reasonable limit.
    const ENDPOINT_CONCURRENCY = 4;
    const endpointPricings = new Map<string, EndpointPricing | null>();
    for (let i = 0; i < rawModels.length; i += ENDPOINT_CONCURRENCY) {
      const chunk = rawModels.slice(i, i + ENDPOINT_CONCURRENCY);
      const results = await Promise.all(
        chunk.map((m) =>
          fetchEndpointPricing(m.id).then(
            (pricing) => [m.id, pricing] as const,
          ),
        ),
      );
      for (const [id, pricing] of results) {
        endpointPricings.set(id, pricing);
      }
    }

    const BATCH_SIZE = 20;
    let createdOrPatched = 0;
    let pricingOnly = 0;
    let skipped = 0;
    let withSkus = 0;

    for (let i = 0; i < rawModels.length; i += BATCH_SIZE) {
      const batch = rawModels.slice(i, i + BATCH_SIZE);

      const prepared = batch.map((m) => {
        const modality = m.architecture?.modality;
        const imageOnly = isImageOnly(modality);
        const endpointPricing = endpointPricings.get(m.id);

        // Per-image hint: prefer listing endpoint's `pricing.image`
        // (Gemini-style per-image rate), fall back to endpoints `pricing.image`.
        const pricePerImage =
          parsePricePerImage(m.pricing?.image) ??
          parsePricePerImage(endpointPricing?.image);

        // SKU-level pricing only comes from /endpoints
        const imageTokenSku = normalizeSkuString(endpointPricing?.image_token);
        const imageOutputSku = normalizeSkuString(
          endpointPricing?.image_output,
        );
        const hasSkus = !!(imageTokenSku || imageOutputSku);
        if (hasSkus) withSkus++;

        return {
          modelId: m.id,
          imageOnly,
          // Fields used only when imageOnly (create/patch full row)
          name: m.name ?? m.id,
          canonicalSlug: m.canonical_slug,
          description: m.description,
          provider: extractProvider(m.id),
          contextLength: m.context_length ?? undefined,
          maxCompletionTokens: m.top_provider?.max_completion_tokens ?? undefined,
          inputPricePer1M: parsePricePer1M(m.pricing?.prompt),
          outputPricePer1M: parsePricePer1M(m.pricing?.completion),
          supportedParameters: m.supported_parameters ?? [],
          architecture: m.architecture
            ? {
                tokenizer: m.architecture.tokenizer ?? undefined,
                instructType: m.architecture.instruct_type ?? undefined,
                modality: m.architecture.modality ?? undefined,
              }
            : undefined,
          // Fields set on all image models (both image-only and multimodal)
          pricePerImage,
          pricingSkus: hasSkus
            ? { imageToken: imageTokenSku, imageOutput: imageOutputSku }
            : undefined,
        };
      });

      const result = await ctx.runMutation(
        internal.models.image_sync.upsertImageModelsBatch,
        { models: prepared },
      );
      createdOrPatched += result.createdOrPatched;
      pricingOnly += result.pricingOnly;
      skipped += result.skipped;
    }

    console.log(
      `Image models synced: ${rawModels.length} from API, ` +
        `${withSkus} with SKU pricing from /endpoints, ` +
        `${createdOrPatched} image-only created/patched, ` +
        `${pricingOnly} multimodal pricing patched, ` +
        `${skipped} multimodal skipped (no existing row yet)`,
    );
  },
});

// -- Batch mutation -----------------------------------------------------------

export const upsertImageModelsBatch = internalMutation({
  args: {
    models: v.array(
      v.object({
        modelId: v.string(),
        imageOnly: v.boolean(),
        name: v.string(),
        canonicalSlug: v.optional(v.string()),
        description: v.optional(v.string()),
        provider: v.string(),
        contextLength: v.optional(v.number()),
        maxCompletionTokens: v.optional(v.number()),
        inputPricePer1M: v.optional(v.number()),
        outputPricePer1M: v.optional(v.number()),
        supportedParameters: v.array(v.string()),
        architecture: v.optional(
          v.object({
            tokenizer: v.optional(v.string()),
            instructType: v.optional(v.string()),
            modality: v.optional(v.string()),
          }),
        ),
        pricePerImage: v.optional(v.number()),
        pricingSkus: v.optional(
          v.object({
            imageToken: v.optional(v.string()),
            imageOutput: v.optional(v.string()),
          }),
        ),
      }),
    ),
  },
  returns: v.object({
    createdOrPatched: v.number(),
    pricingOnly: v.number(),
    skipped: v.number(),
  }),
  handler: async (ctx, args) => {
    let createdOrPatched = 0;
    let pricingOnly = 0;
    let skipped = 0;
    const now = Date.now();

    for (const model of args.models) {
      const existing = await ctx.db
        .query("cachedModels")
        .withIndex("by_modelId", (q) => q.eq("modelId", model.modelId))
        .first();

      const imageCapabilities = {
        pricePerImage: model.pricePerImage,
        pricingSkus: model.pricingSkus,
        managedByImageSync: model.imageOnly,
        syncedAt: now,
      };

      if (model.imageOnly) {
        // Image-only models: create or fully refresh the row. Main sync
        // never sees these, so image_sync is the sole owner.
        if (existing) {
          await ctx.db.patch(existing._id, {
            name: model.name,
            canonicalSlug: model.canonicalSlug,
            description: model.description,
            provider: model.provider,
            contextLength: model.contextLength,
            maxCompletionTokens: model.maxCompletionTokens,
            inputPricePer1M: model.inputPricePer1M,
            outputPricePer1M: model.outputPricePer1M,
            supportsImages: true,
            supportsVideo: false,
            supportsTools: false,
            supportedParameters: model.supportedParameters,
            architecture: model.architecture,
            imageCapabilities,
            lastSyncedAt: now,
          });
        } else {
          await ctx.db.insert("cachedModels", {
            modelId: model.modelId,
            name: model.name,
            canonicalSlug: model.canonicalSlug,
            description: model.description,
            provider: model.provider,
            contextLength: model.contextLength,
            maxCompletionTokens: model.maxCompletionTokens,
            inputPricePer1M: model.inputPricePer1M,
            outputPricePer1M: model.outputPricePer1M,
            supportsImages: true,
            supportsVideo: false,
            supportsTools: false,
            supportedParameters: model.supportedParameters,
            architecture: model.architecture,
            imageCapabilities,
            lastSyncedAt: now,
          });
        }
        createdOrPatched++;
      } else {
        // Multimodal image models (Gemini Image, GPT-5 Image, Auto Router):
        // owned by main sync. Only patch the pricing/marker hint. If the row
        // doesn't exist yet, main sync will create it on its next pass and
        // the following image_sync run will attach the hint.
        if (existing) {
          await ctx.db.patch(existing._id, { imageCapabilities });
          pricingOnly++;
        } else {
          skipped++;
        }
      }
    }

    return { createdOrPatched, pricingOnly, skipped };
  },
});
