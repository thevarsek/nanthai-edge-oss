import assert from "node:assert/strict";
import test from "node:test";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { createBasicCodexPersona } from "../runtime_host/basic_persona";
import { list } from "../personas/queries";
import { resolveChatParticipantConfigs } from "../chat/participant_resolution";
import { canUseLocalController } from "../runtime_host/activation";
import { createPermissionFixture } from "./runtime_host_permission_fixture";

test("intentional extra Persona creation preserves ordinary editing and approved native Sol without changing defaults", async () => {
  const state = await createPermissionFixture();
  state.rows.userPreferences = [{ _id: "prefs", userId: "user_1", defaultPersonaId: "saved", runtimeOnboardingState: "ready" }];
  const device = state.rows.runtimeDevices[0] as unknown as Doc<"runtimeDevices">;
  const first = await createBasicCodexPersona(state.ctx, device, state.now);
  const second = await createBasicCodexPersona(state.ctx, device, state.now + 1);
  assert.notEqual(first, second);
  assert.equal(state.rows.userPreferences[0].defaultPersonaId, "saved");
  assert.equal(state.rows.personas[0].systemPrompt, "You are a helpful assistant.");
  assert.equal(state.rows.personas[0].isDefault, false);
  assert.equal(state.rows.personaRuntimeBindings[0].modelId, "gpt-6.1-sol");
  assert.notEqual(state.rows.personas[0].displayName, state.rows.personas[1].displayName);
});

test("the public Persona catalogue filters by backend identity and a keyless retry resolves its existing participant", async () => {
  const state = await createPermissionFixture();
  state.rows.personas = [
    { _id: "persona-1", userId: "user_1", displayName: "Latest Codex", systemPrompt: "Latest prompt", isDefault: false },
    { _id: "cloud", userId: "user_1", displayName: "Writer", systemPrompt: "Write", isDefault: false },
  ];
  state.rows.personaRuntimeBindings = [{ _id: "binding", personaId: "persona-1", userId: "user_1", adapterId: "codex", status: "active", deviceId: "device-1" }];
  const ctx = { ...state.ctx, runQuery: async () => false, auth: { getUserIdentity: async () => ({ subject: "user_1" }) }, storage: { getUrl: async () => null } } as unknown as QueryCtx;
  const handler = (list as unknown as { _handler: (ctx: QueryCtx, args: { runtimePlacement: "local" | "cloud" }) => Promise<Array<{ _id: string; runtimeAdapterId?: string }>> })._handler;
  assert.deepEqual((await handler(ctx, { runtimePlacement: "local" })).map(row => [row._id, row.runtimeAdapterId]), [["persona-1", "codex"]]);
  assert.deepEqual((await handler(ctx, { runtimePlacement: "cloud" })).map(row => row._id), ["cloud"]);
  const participants = await resolveChatParticipantConfigs(state.ctx, { userId: "user_1", chatId: "chat-1" as Id<"chats">, participants: [{ modelId: "old-model", personaId: "persona-1" as Id<"personas">, systemPrompt: "Stale snapshot" }] });
  assert.equal(participants[0].participantKey, "participant-1");
  assert.equal(participants[0].systemPrompt, "Latest prompt");
  assert.equal(participants[0].personaName, "Latest Codex");
});

test("persisted local setup lets every controller enter independently of presence or OpenRouter", async () => {
  const state = await createPermissionFixture();
  state.rows.userPreferences = [{ _id: "prefs", userId: "user_1" }];
  const ctx = { ...state.ctx, runQuery: async () => false, auth: { getUserIdentity: async () => ({ subject: "user_1" }) } } as unknown as MutationCtx;
  const handler = (canUseLocalController as unknown as { _handler: (ctx: QueryCtx) => Promise<boolean> })._handler;
  assert.equal(await handler(ctx), false);
  state.rows.userPreferences[0].runtimeOnboardingState = "setup";
  assert.equal(await handler(ctx), true);
  state.rows.userPreferences[0].runtimeOnboardingState = "ready";
  state.rows.runtimeDevices[0].status = "revoked";
  assert.equal(await handler(ctx), true, "retained history/setup remains accessible after disconnect");
});
