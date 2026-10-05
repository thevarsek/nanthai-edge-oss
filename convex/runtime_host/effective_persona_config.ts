import { personaSystemPrompt } from "../personas/default_prompt";
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { sha256Hex } from "./security";

// Execution evidence captured once at a new logical turn, never a chat default.
export const effectivePersonaConfigValidator = v.object({
  personaId: v.id("personas"), displayName: v.string(), systemPrompt: v.string(),
  modelId: v.optional(v.string()), temperature: v.optional(v.number()),
  maxTokens: v.optional(v.number()), includeReasoning: v.optional(v.boolean()),
  reasoningEffort: v.optional(v.string()),
  skillOverrides: v.optional(v.array(v.object({
    skillId: v.id("skills"), state: v.union(v.literal("always"), v.literal("available"), v.literal("never")),
  }))),
  integrationOverrides: v.optional(v.array(v.object({ integrationId: v.string(), enabled: v.boolean() }))),
});

export function effectivePersonaConfig(persona: Doc<"personas">) {
  return {
    personaId: persona._id, displayName: persona.displayName, systemPrompt: personaSystemPrompt(persona.systemPrompt),
    modelId: persona.modelId, temperature: persona.temperature, maxTokens: persona.maxTokens,
    includeReasoning: persona.includeReasoning, reasoningEffort: persona.reasoningEffort,
    skillOverrides: persona.skillOverrides, integrationOverrides: persona.integrationOverrides,
  };
}

export async function effectivePersonaRouteHash(
  routeHash: string,
  persona: Doc<"personas">,
): Promise<string> {
  const { displayName: _displayName, ...configuration } = effectivePersonaConfig(persona);
  return await sha256Hex(JSON.stringify({ routeHash, configuration }));
}
