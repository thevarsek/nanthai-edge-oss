import { MutationCtx } from "../_generated/server";
import { SendParticipantConfig } from "../chat/mutation_send_helpers";

type ToolCapabilityCtx = Pick<MutationCtx, "db">;

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Check which of the given model IDs support tools.
 * Returns the set of model IDs that do NOT support tools.
 */
async function findUnsupportedModelIds(
  ctx: ToolCapabilityCtx,
  modelIds: Array<string | null | undefined>,
): Promise<Set<string>> {
  const uniqueModelIds = Array.from(
    new Set(
      modelIds
        .map((m) => m?.trim())
        .filter((m): m is string => Boolean(m)),
    ),
  );

  const unsupported = new Set<string>();
  for (const modelId of uniqueModelIds) {
    const model = await ctx.db
      .query("cachedModels")
      .withIndex("by_modelId", (q) => q.eq("modelId", modelId))
      .first();
    if (model?.supportsTools !== true) {
      unsupported.add(modelId);
    }
  }
  return unsupported;
}

// ── Silent downgrade (preferred) ───────────────────────────────────────

/**
 * Result of silently stripping tool-dependent options for models that do
 * not support tools.  Callers should use the returned values instead of
 * the originals.
 */
export interface ToolFilterResult {
  enabledIntegrations: string[] | undefined;
  requireToolUse: boolean;
  /** Model IDs that were found to lack tool support. */
  strippedModelIds: string[];
}

/**
 * Instead of throwing when a model lacks tool support, silently strip
 * integrations and subagent flags so the request proceeds without tools.
 *
 * Use this in ALL runtime paths (chat send, retry, personas, jobs) so
 * "always on" means "always on where supported."
 */
export async function filterToolIncompatibleOptions(
  ctx: ToolCapabilityCtx,
  options: {
    enabledIntegrations?: string[];
    modelIds: Array<string | null | undefined>;
    requireToolUse?: boolean;
  },
): Promise<ToolFilterResult> {
  const integrations = options.enabledIntegrations ?? [];
  const requireToolUse = options.requireToolUse ?? false;

  // Nothing to strip — fast path.
  if (integrations.length === 0 && !requireToolUse) {
    return {
      enabledIntegrations: options.enabledIntegrations,
      requireToolUse: false,
      strippedModelIds: [],
    };
  }

  const unsupported = await findUnsupportedModelIds(ctx, options.modelIds);
  if (unsupported.size === 0) {
    // All models support tools — pass through unchanged.
    return {
      enabledIntegrations: options.enabledIntegrations,
      requireToolUse,
      strippedModelIds: [],
    };
  }

  // At least one model lacks tool support → strip tool-dependent options.
  return {
    enabledIntegrations: integrations.length > 0 ? [] : options.enabledIntegrations,
    requireToolUse: false,
    strippedModelIds: Array.from(unsupported),
  };
}

/**
 * Convenience wrapper for chat participants.
 */
export async function filterParticipantToolOptions(
  ctx: ToolCapabilityCtx,
  options: {
    enabledIntegrations?: string[];
    participants: SendParticipantConfig[];
    requireToolUse?: boolean;
  },
): Promise<ToolFilterResult> {
  return filterToolIncompatibleOptions(ctx, {
    enabledIntegrations: options.enabledIntegrations,
    modelIds: options.participants.map((p) => p.modelId),
    requireToolUse: options.requireToolUse,
  });
}

// ── Legacy assert (kept for tests that verify the old shape) ───────────

/** @deprecated Use filterToolIncompatibleOptions instead. */
export async function assertToolCapableModelIds(
  ctx: ToolCapabilityCtx,
  options: {
    enabledIntegrations?: string[];
    modelIds: Array<string | null | undefined>;
    requireToolUse?: boolean;
  },
): Promise<void> {
  const result = await filterToolIncompatibleOptions(ctx, options);
  if (result.strippedModelIds.length > 0) {
    const integrations = options.enabledIntegrations ?? [];
    const ids = result.strippedModelIds;
    const multiple = ids.length !== 1;
    const subject = `The selected model${multiple ? "s" : ""}`;
    const details = ` (${ids.join(", ")})`;
    const { ConvexError } = await import("convex/values");
    throw new ConvexError({
      code: "TOOL_CAPABLE_MODEL_REQUIRED" as const,
      message:
        `${subject}${details} ${multiple ? "do" : "does"} not support tool use. Choose a model with Tool Use when integrations are enabled.`,
      modelIds: ids,
      enabledIntegrations: integrations,
    });
  }
}

/** @deprecated Use filterParticipantToolOptions instead. */
export async function assertParticipantsSupportIntegrations(
  ctx: ToolCapabilityCtx,
  options: {
    enabledIntegrations?: string[];
    participants: SendParticipantConfig[];
    requireToolUse?: boolean;
  },
): Promise<void> {
  await assertToolCapableModelIds(ctx, {
    enabledIntegrations: options.enabledIntegrations,
    modelIds: options.participants.map((p) => p.modelId),
    requireToolUse: options.requireToolUse,
  });
}
