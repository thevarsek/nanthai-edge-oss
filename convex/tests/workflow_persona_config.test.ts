import assert from "node:assert/strict";
import test from "node:test";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";
import { bindWorkflowPersonaConfig } from "../chat/workflow_persona_config";
import type { GenerationParticipantWorkflowArgs } from "../chat/workflow_contract";

function fixture() {
  const rows: Record<string, Array<Record<string, unknown>>> = {
    personas: [{ _id: "persona_1", userId: "user_1", displayName: "Edited name", systemPrompt: "Edited after send" }],
    chats: [{ _id: "chat_1", userId: "user_1" }],
    messages: [{ _id: "message_1", userId: "user_1", chatId: "chat_1", content: "", role: "assistant" }],
    oauthConnections: [], mcpConnections: [], userPreferences: [], purchaseEntitlements: [],
  };
  const config = {
    personaId: "persona_1", displayName: "At send", systemPrompt: "", modelId: "openai/at-send",
    temperature: 0.3, skillOverrides: [{ skillId: "skill_1", state: "available" }],
    integrationOverrides: [{ integrationId: "gmail", enabled: true }],
  };
  const job = {
    _id: "job_1", userId: "user_1", chatId: "chat_1", messageId: "message_1", effectivePersonaConfig: config,
  } as unknown as Doc<"generationJobs">;
  const args = {
    participant: { jobId: "job_1", modelId: "openai/stale", systemPrompt: "Edited after send" },
    effectiveIntegrations: ["gmail"], personaSkillOverrides: [{ skillId: "edited-skill", state: "always" }],
  } as unknown as GenerationParticipantWorkflowArgs;
  const ctx = createStatefulMockCtx(rows) as unknown as MutationCtx;
  return { rows, ctx, args, job };
}

test("workflow uses captured Persona defaults even if the Persona was edited after send", async () => {
  const { ctx, args, job } = fixture();
  const bound = await bindWorkflowPersonaConfig(ctx, args, job);
  assert.equal(bound.participant.systemPrompt, "");
  assert.equal(bound.participant.modelId, "openai/at-send");
  assert.equal(bound.participant.personaName, "At send");
  assert.equal(bound.participant.temperature, 0.3);
  assert.deepEqual(bound.personaSkillOverrides, [{ skillId: "skill_1", state: "available" }]);
  assert.deepEqual(bound.effectiveIntegrations, [], "disconnected integration is not restored by old config");
  assert.equal(args.participant.systemPrompt, "Edited after send");
});

test("captured execution evidence does not restore access to a removed Persona", async () => {
  const { rows, ctx, args, job } = fixture();
  rows.personas.length = 0;
  await assert.rejects(bindWorkflowPersonaConfig(ctx, args, job), /PERSONA_UNAVAILABLE/);
});

test("historical executions keep their already-recorded arguments", async () => {
  const { ctx, args, job } = fixture();
  const { effectivePersonaConfig: _config, ...historical } = job;
  assert.equal(await bindWorkflowPersonaConfig(ctx, args, historical), args);
});
