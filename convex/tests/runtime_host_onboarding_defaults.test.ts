import assert from "node:assert/strict";
import test from "node:test";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";
import { createChatHandler } from "../chat/mutations_public_handlers";
import { MODEL_IDS } from "../lib/model_constants";
import { begin } from "../runtime_host/activation";
import { resolveEffectiveParticipantRoute } from "../runtime_host/route_resolution";
import { provisionStarterPersona } from "../runtime_host/starter_persona";

function fixture(preferences: Record<string, unknown> = {}) {
  const rows: Record<string, Array<Record<string, unknown>>> = {
    purchaseEntitlements: [{ _id: "entitlement-1", userId: "user_1", status: "active" }],
    userPreferences: [{
      _id: "prefs-1", userId: "user_1", onboardingCompleted: false,
      defaultModelId: MODEL_IDS.appDefault, ...preferences,
    }],
    runtimeDevices: [{
      _id: "device-row-1", userId: "user_1", deviceId: "device-1",
      displayName: "My Mac", status: "active", currentPresenceId: "presence-1",
    }],
    runtimeDevicePresences: [{
      _id: "presence-1", status: "online", expiresAt: 10_000,
      adapters: [{ adapterId: "codex", authState: "ready", capabilities: { operations: { listModels: true } } }],
    }],
  };
  const state = createStatefulMockCtx(rows) as unknown as MutationCtx;
  const ctx = { db: state.db, auth: { getUserIdentity: async () => ({ subject: "user_1" }) } } as unknown as MutationCtx;
  return {
    rows, ctx,
    begin: () => (begin as unknown as { _handler: (ctx: MutationCtx) => Promise<void> })._handler(ctx),
    provision: () => provisionStarterPersona(ctx, rows.runtimeDevices[0] as Doc<"runtimeDevices">, 1_000),
  };
}

test("first-run local onboarding selects the starter and ordinary chat creation resolves the approved local Sol default", async () => {
  const { rows, ctx, begin, provision } = fixture();
  await begin();
  await provision();
  const prefs = rows.userPreferences[0];
  assert.equal(prefs.defaultPersonaId, rows.personas[0]._id);
  assert.equal(prefs.defaultModelId, MODEL_IDS.appDefault);
  assert.equal(prefs.runtimeOnboardingDefaultAssigned, true);
  assert.equal(prefs.runtimeOnboardingState, "setup");
  assert.equal(prefs.onboardingCompleted, false, "only a successful real turn completes activation");
  await createChatHandler(ctx, {
    mode: "chat",
    participants: [{ modelId: prefs.defaultModelId as string, personaId: prefs.defaultPersonaId as Id<"personas"> }],
  });
  const route = await resolveEffectiveParticipantRoute(ctx, {
    userId: "user_1", chatParticipantId: rows.chatParticipants[0]._id as Id<"chatParticipants">, now: 1_001,
  });
  assert.equal(route?.placement, "local");
  assert.equal(route?.availability, "ready");
  assert.equal(route?.modelSelectionMode, "explicit");
  assert.equal(route?.modelId, "gpt-6.1-sol", "the native model ID has no OpenRouter provider slug");

  await ctx.db.patch(prefs._id as Id<"userPreferences">, { defaultPersonaId: undefined });
  await provision();
  rows.runtimeDevices.unshift({ ...rows.runtimeDevices[0], _id: "device-row-2", deviceId: "device-2", starterPersonaId: undefined, starterPersonaBindings: undefined });
  await provision();
  assert.equal(rows.personas.length, 2);
  assert.equal(rows.userPreferences[0].defaultPersonaId, undefined, "heartbeats and a second Mac preserve a later manual choice");
});

test("adding Pi provisions its own starter while preserving the user's default and deletion receipt", async () => {
  const { rows, ctx, begin, provision } = fixture({ defaultPersonaId: "my-persona" });
  await begin();
  await provision();
  const presence = rows.runtimeDevicePresences[0];
  const adapters = presence.adapters as Array<Record<string, unknown>>;
  adapters.push({ ...adapters[0], adapterId: "pi" });
  await provision();
  assert.equal(rows.personas.length, 2);
  assert.equal(rows.userPreferences[0].defaultPersonaId, "my-persona");
  const pi = rows.personas.find(persona => String(persona.displayName).startsWith("Pi ·"));
  assert.ok(pi);
  const binding = rows.personaRuntimeBindings.find(binding => binding.personaId === pi._id);
  assert.ok(binding);
  assert.equal(binding.adapterId, "pi");
  assert.equal(binding.modelSelectionMode, "adapter_default");
  await ctx.db.delete(pi._id as Id<"personas">);
  await provision();
  assert.equal(rows.personas.length, 1, "presence must not recreate a deleted Pi Persona");
});

for (const scenario of [
  { name: "Settings pairing without onboarding intent", preferences: {}, replay: false },
  { name: "completed onboarding replay", preferences: { onboardingCompleted: true }, replay: true },
]) {
  test(`${scenario.name} preserves existing defaults`, async () => {
    const { rows, begin, provision } = fixture({ ...scenario.preferences, defaultPersonaId: "my-persona" });
    if (scenario.replay) await begin();
    await provision();
    assert.equal(rows.personas.length, 1);
    assert.equal(rows.userPreferences[0].defaultPersonaId, "my-persona");
    assert.equal(rows.userPreferences[0].runtimeOnboardingDefaultAssigned, undefined);
  });
}

test("unfinished onboarding can adopt an existing starter, but never a deleted one", async () => {
  const { rows, begin, provision } = fixture();
  await provision();
  const personaId = rows.personas[0]._id as Id<"personas">;
  await begin();
  await provision();
  assert.equal(rows.personas.length, 1);
  assert.equal(rows.userPreferences[0].defaultPersonaId, personaId);

  const deleted = fixture();
  await deleted.provision();
  await deleted.ctx.db.delete(deleted.rows.personas[0]._id as Id<"personas">);
  await deleted.begin();
  await deleted.provision();
  assert.equal(deleted.rows.personas.length, 0);
  assert.equal(deleted.rows.userPreferences[0].defaultPersonaId, undefined);
  assert.equal(deleted.rows.userPreferences[0].runtimeOnboardingDefaultAssigned, undefined);
});
