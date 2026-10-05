import { DEFAULT_PERSONA_SYSTEM_PROMPT } from "../personas/default_prompt";
import assert from "node:assert/strict";
import test from "node:test";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";
import { resolveChatParticipantConfigs } from "../chat/participant_resolution";

function fixture() {
  const rows = {
    personas: [{ _id: "persona_1", userId: "user_1", displayName: "Current name", systemPrompt: "Current prompt",
      modelId: "openai/current", temperature: 0.3, maxTokens: 4000, includeReasoning: true, reasoningEffort: "high" }],
    chatParticipants: [{ _id: "participant_1", chatId: "chat_1", userId: "user_1", personaId: "persona_1",
      modelId: "openai/old", temperature: 0.9, personaName: "Old name" }],
  };
  const ctx = createStatefulMockCtx(rows) as unknown as MutationCtx;
  return { rows, ctx };
}

const request = { chatId: "chat_1" as Id<"chats">, userId: "user_1", participants: [{
  participantKey: "participant_1", modelId: "openai/stale-client", systemPrompt: "Stale prompt",
}] };

test("each new Persona turn uses current defaults, using the generic fallback for an empty prompt", async () => {
  const { rows, ctx } = fixture();
  const [first] = await resolveChatParticipantConfigs(ctx, request);
  assert.equal(first.modelId, "openai/current");
  assert.equal(first.systemPrompt, "Current prompt");
  assert.equal(first.personaName, "Current name");
  assert.equal(first.temperature, 0.3);
  assert.equal(first.maxTokens, 4000);
  assert.equal(first.reasoningEffort, "high");
  rows.personas[0].systemPrompt = "";
  const [next] = await resolveChatParticipantConfigs(ctx, request);
  assert.equal(next.systemPrompt, DEFAULT_PERSONA_SYSTEM_PROMPT);
  assert.equal(first.systemPrompt, "Current prompt");
});

test("deleted or inaccessible Personas fail before creating a new turn", async () => {
  const { rows, ctx } = fixture();
  rows.personas[0].userId = "someone_else";
  await assert.rejects(resolveChatParticipantConfigs(ctx, request), /PERSONA_UNAVAILABLE/);
  rows.personas.length = 0;
  await assert.rejects(resolveChatParticipantConfigs(ctx, request), /PERSONA_UNAVAILABLE/);
});

test("a stale client Persona ID cannot turn a canonical bare model into a Persona", async () => {
  const { rows, ctx } = fixture();
  rows.chatParticipants[0].personaId = undefined as unknown as string;
  const [resolved] = await resolveChatParticipantConfigs(ctx, {
    ...request, participants: [{ ...request.participants[0], personaId: "persona_1" as Id<"personas"> }],
  });
  assert.equal(resolved.personaId, undefined);
  assert.equal(resolved.modelId, "openai/old");
});

test("an explicit retry selects another owned Persona without rewriting its roster slot", async () => {
    const { rows, ctx } = fixture();
    rows.personas.push({ ...rows.personas[0], _id: "persona_2", displayName: "Retry Persona", systemPrompt: "Retry prompt" });
    const [resolved] = await resolveChatParticipantConfigs(ctx, {
        ...request, allowPersonaOverride: true,
        participants: [{ ...request.participants[0], personaId: "persona_2" as Id<"personas"> }],
    });
    assert.equal(resolved.participantKey, "participant_1");
    assert.equal(resolved.personaId, "persona_2");
    assert.equal(resolved.systemPrompt, "Retry prompt");
    assert.equal(rows.chatParticipants[0].personaId, "persona_1");
    const [bare] = await resolveChatParticipantConfigs(ctx, {
        ...request, allowPersonaOverride: true,
        participants: [{ ...request.participants[0], personaId: null, modelId: "openai/retry" }],
    });
    assert.equal(bare.personaId, null);
    assert.equal(bare.modelId, "openai/retry");
});
