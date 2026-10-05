import assert from "node:assert/strict";
import test from "node:test";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { addBasicPersona } from "../runtime_host/basic_persona";
import { listMyDevices } from "../runtime_host/devices";
import { provisionStarterPersona } from "../runtime_host/starter_persona";
import { createPermissionFixture } from "./runtime_host_permission_fixture";

type RecoveryArgs = { deviceId: string; adapterId: "codex" | "pi"; personaId?: Id<"personas">; createAnother?: boolean };
const recover = (addBasicPersona as unknown as { _handler: (ctx: MutationCtx, args: RecoveryArgs) => Promise<Id<"personas">> })._handler;
const list = (listMyDevices as unknown as { _handler: (ctx: QueryCtx) => Promise<Array<{ deviceId: string; runtimePersonas: Array<{ personaId: string; adapterId: string; needsReconnect: boolean }> }>> })._handler;

for (const withPi of [false, true]) {
  test(`re-pair recovery preserves IDs, prompts, model choices and chat references (${withPi ? "Codex and Pi" : "Codex"})`, async () => {
    const { rows, ctx: baseCtx, now } = await createPermissionFixture();
    const ctx = { ...baseCtx, runQuery: async () => false } as unknown as MutationCtx;
    rows.purchaseEntitlements = [{ _id: "pro", userId: "user_1", status: "active" }];
    rows.userPreferences = [{ _id: "prefs", userId: "user_1", defaultPersonaId: "saved" }];
    if (withPi) {
      const adapters = rows.runtimeDevicePresences[0].adapters as Array<Record<string, unknown>>;
      adapters.push({ ...adapters[0], adapterId: "pi" });
    }
    const old = rows.runtimeDevices[0] as Doc<"runtimeDevices">;
    for (let i = 0; i < 3; i++) await provisionStarterPersona(ctx, old, now);
    const originalIds = rows.personas.map(persona => persona._id as Id<"personas">);
    rows.personas[0].systemPrompt = "My custom prompt";
    rows.personaRuntimeBindings[0].modelId = "my-selected-model";
    rows.chatParticipants[0].personaId = originalIds[0];
    old.status = "revoked";
    const replacement = { ...old, _id: "new-device", deviceId: "new-mac", status: "active",
      starterPersonaId: undefined, starterPersonaBindings: undefined } as Doc<"runtimeDevices">;
    rows.runtimeDevices.push(replacement);
    for (let i = 0; i < 3; i++) await provisionStarterPersona(ctx, replacement, now);
    assert.deepEqual(rows.personas.map(persona => persona._id), originalIds, "new authority never silently creates duplicates");
    const projected = (await list(ctx)).find(device => device.deviceId === "new-mac")!;
    assert.equal(projected.runtimePersonas.length, originalIds.length);
    assert.ok(projected.runtimePersonas.every(persona => persona.needsReconnect));
    for (const choice of projected.runtimePersonas) {
      const args: RecoveryArgs = { deviceId: "new-mac", adapterId: choice.adapterId as "codex" | "pi", personaId: choice.personaId as Id<"personas"> };
      assert.equal(await recover(ctx, args), choice.personaId);
      assert.equal(await recover(ctx, args), choice.personaId, "retries reuse the exact Persona");
    }
    await provisionStarterPersona(ctx, replacement, now);
    assert.deepEqual(rows.personas.map(persona => persona._id), originalIds);
    assert.equal(rows.personas[0].systemPrompt, "My custom prompt");
    assert.equal(rows.personaRuntimeBindings.find(binding => binding.personaId === originalIds[0] && binding.status === "active")?.modelId, "my-selected-model");
    assert.equal(rows.chatParticipants[0].personaId, originalIds[0]);
    assert.equal(rows.userPreferences[0].defaultPersonaId, "saved");
    assert.ok((await list(ctx)).find(device => device.deviceId === "new-mac")?.runtimePersonas.every(persona => !persona.needsReconnect));
    assert.equal(await recover(ctx, { deviceId: "new-mac", adapterId: "codex" }), originalIds[0]);
    const extra = await recover(ctx, { deviceId: "new-mac", adapterId: "codex", createAnother: true });
    assert.ok(!originalIds.includes(extra), "intentional extras remain available");
    assert.equal(rows.personas.length, originalIds.length + 1);
  });
}

test("an active second Mac, deleted starter and another account's Persona are never silently adopted", async () => {
  const { rows, ctx: baseCtx, now } = await createPermissionFixture();
    const ctx = { ...baseCtx, runQuery: async () => false } as unknown as MutationCtx;
  rows.purchaseEntitlements = [{ _id: "pro", userId: "user_1", status: "active" }];
  const first = rows.runtimeDevices[0] as Doc<"runtimeDevices">;
  await provisionStarterPersona(ctx, first, now);
  const second = { ...first, _id: "second", deviceId: "second-mac", starterPersonaId: undefined, starterPersonaBindings: undefined } as Doc<"runtimeDevices">;
  rows.runtimeDevices.push(second);
  await provisionStarterPersona(ctx, second, now);
  assert.equal(rows.personas.length, 2, "a genuinely separate active Mac gets its own starter");
  await assert.rejects(recover(ctx, { deviceId: "second-mac", adapterId: "codex", personaId: rows.personas[0]._id as Id<"personas"> }), /NOT_FOUND/);
  rows.personas[0].userId = "other-user";
  first.status = "revoked";
  assert.equal((await list(ctx)).find(device => device.deviceId === "second-mac")?.runtimePersonas.length, 1);
  await ctx.db.delete(rows.personas[1]._id as Id<"personas">);
  await provisionStarterPersona(ctx, second, now);
  assert.equal(rows.personas.length, 1, "a deletion receipt still prevents resurrection");
});
