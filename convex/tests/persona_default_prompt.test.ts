import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PERSONA_SYSTEM_PROMPT, personaSystemPrompt } from "../personas/default_prompt";
import { effectivePersonaConfig } from "../runtime_host/effective_persona_config";
import type { Doc } from "../_generated/dataModel";
test("generic prompts default only when empty; custom instructions retain exact content", () => {
  for (const value of [undefined, null, "", " \n "]) assert.equal(personaSystemPrompt(value), DEFAULT_PERSONA_SYSTEM_PROMPT);
  assert.equal(personaSystemPrompt("  Be concise.\n"), "  Be concise.\n");
});
test("runtime evidence records the effective generic prompt", () => {
  const persona = { _id: "persona", displayName: "Pi", systemPrompt: "" } as Doc<"personas">;
  assert.equal(effectivePersonaConfig(persona).systemPrompt, DEFAULT_PERSONA_SYSTEM_PROMPT);
});
