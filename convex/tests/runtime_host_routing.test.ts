import assert from "node:assert/strict";
import test from "node:test";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";
import { setPersonaRuntimeBindingHandler } from "../runtime_host/persona_routes";
import { resolveEffectiveParticipantRoute } from "../runtime_host/route_resolution";

const adapter = {
  adapterId: "codex",
  adapterVersion: "0.147.0",
  authState: "ready",
  capabilities: {
    protocolVersion: "nanthai.runtime.v1",
    adapterId: "codex",
    adapterVersion: "0.147.0",
    transport: "stdio_jsonrpc",
    inputModalities: ["text"],
    eventTypes: ["session_started", "text_delta", "terminal"],
    operations: {
      listModels: true,
      cancel: true,
      resume: true,
      permissionResponse: true,
      inputResponse: true,
    },
    adapterNative: { tools: true, plugins: true, mcpServers: true, skills: true },
  },
};

function fixture() {
  const rows: Record<string, Array<Record<string, unknown>>> = {
    chats: [{ _id: "chat_1", userId: "user_1", title: "QA", mode: "chat", createdAt: 1_000, updatedAt: 1_000 }],
    personas: [
      { _id: "persona_1", userId: "user_1", displayName: "Architect", systemPrompt: "Original prompt", modelId: "openai/gpt-5.6" },
      { _id: "persona_2", userId: "user_1", displayName: "Developer", systemPrompt: "Develop" },
    ],
    chatParticipants: [
      {
        _id: "participant_1", userId: "user_1", chatId: "chat_1",
        personaId: "persona_1", modelId: "openai/gpt-5.6", sortOrder: 0,
      },
      {
        _id: "participant_2", userId: "user_1", chatId: "chat_1",
        personaId: "persona_2", modelId: "openai/gpt-5.6", sortOrder: 1,
      },
      {
        _id: "participant_copy", userId: "user_1", chatId: "chat_2",
        personaId: "persona_1", modelId: "openai/gpt-5.6", sortOrder: 0,
      },
      {
        _id: "participant_bare", userId: "user_1", chatId: "chat_1",
        modelId: "anthropic/claude-sonnet-4.6", sortOrder: 2,
      },
    ],
    runtimeDevices: [
      {
        _id: "runtime_device_a", userId: "user_1", deviceId: "device-a",
        displayName: "Mac A", status: "active", currentPresenceId: "presence_a",
      },
      {
        _id: "runtime_device_b", userId: "user_1", deviceId: "device-b",
        displayName: "Mac B", status: "active", currentPresenceId: "presence_b",
      },
      {
        _id: "runtime_device_offline", userId: "user_1", deviceId: "device-offline",
        displayName: "Offline Mac", status: "active",
      },
    ],
    runtimeDevicePresences: [
      {
        _id: "presence_a", status: "online", expiresAt: 100_000,
        adapters: [adapter],
      },
      {
        _id: "presence_b", status: "online", expiresAt: 100_000,
        adapters: [adapter],
      },
    ],
    personaRuntimeBindings: [],
    chatParticipantRuntimeRoutes: [],
    chatRuntimeOverrides: [],
  };
  return { rows, ctx: createStatefulMockCtx(rows) as unknown as MutationCtx };
}

async function setRoute(ctx: MutationCtx, deviceId: string, now = 1_000) {
  return await setPersonaRuntimeBindingHandler(ctx, {
    userId: "user_1", personaId: "persona_1" as Id<"personas">,
    deviceId, adapterId: "codex", modelSelectionMode: "adapter_default", now,
  });
}

async function resolve(ctx: MutationCtx, participantId = "participant_1") {
  return await resolveEffectiveParticipantRoute(ctx, {
    userId: "user_1", chatParticipantId: participantId as Id<"chatParticipants">, now: 2_000,
  });
}

test("new turns use current Persona routes and retain prior resolution as execution evidence", async () => {
  const { rows, ctx } = fixture();
  await setRoute(ctx, "device-a");
  const first = await resolve(ctx);
  rows.chatParticipantRuntimeRoutes.push({
    _id: "legacy", chatParticipantId: "participant_1", status: "active",
    placement: "local", deviceId: "device-a", adapterId: "codex", routeHash: "old",
  });
  await setRoute(ctx, "device-b", 1_200);
  const second = await resolve(ctx);
  assert.equal(first?.deviceId, "device-a");
  assert.equal(second?.deviceId, "device-b");
  assert.equal(second?.source, "persona_current");
  assert.equal(second?.availability, "ready");
  assert.notEqual(first?.routeSnapshotHash, second?.routeSnapshotHash);
  assert.equal(rows.chatParticipantRuntimeRoutes.length, 1);
});

test("prompt and capability edits invalidate native reuse but a display rename does not", async () => {
  const { rows, ctx } = fixture();
  await setRoute(ctx, "device-a");
  const original = await resolve(ctx);
  rows.personas[0].displayName = "Renamed";
  assert.equal((await resolve(ctx))?.routeSnapshotHash, original?.routeSnapshotHash);
  rows.personas[0].systemPrompt = "Changed prompt";
  const changed = await resolve(ctx);
  assert.notEqual(changed?.routeSnapshotHash, original?.routeSnapshotHash);
  assert.equal(original?.personaConfig?.systemPrompt, "Original prompt");
  rows.personas[0].integrationOverrides = [{ integrationId: "drive", enabled: true }];
  assert.notEqual((await resolve(ctx))?.routeSnapshotHash, changed?.routeSnapshotHash);
});

test("clearing a Persona route returns new turns to cloud, including copied participants", async () => {
  const { rows, ctx } = fixture();
  await setRoute(ctx, "device-a");
  assert.equal((await resolve(ctx, "participant_copy"))?.placement, "local");
  rows.personaRuntimeBindings[0].status = "cleared";
  assert.equal((await resolve(ctx))?.placement, "cloud");
  assert.equal((await resolve(ctx, "participant_copy"))?.placement, "cloud");
});

test("a chat override wins for Personas while bare models remain cloud", async () => {
  const { rows, ctx } = fixture();
  await setRoute(ctx, "device-a");
  rows.chatRuntimeOverrides.push({
    _id: "override", chatId: "chat_1", status: "active", deviceId: "device-b",
    adapterId: "codex", modelSelectionMode: "adapter_default", routeHash: "override-route",
  });
  assert.equal((await resolve(ctx))?.deviceId, "device-b");
  assert.equal((await resolve(ctx))?.source, "chat_override");
  assert.equal((await resolve(ctx, "participant_bare"))?.placement, "cloud");
});

test("missing Personas and revoked devices cannot silently select cloud", async () => {
  const { rows, ctx } = fixture();
  await setRoute(ctx, "device-a");
  rows.runtimeDevices[0].status = "revoked";
  assert.equal((await resolve(ctx))?.availability, "device_unavailable");
  rows.personas[0].userId = "other_user";
  assert.equal((await resolve(ctx))?.availability, "persona_unavailable");
  rows.personas.length = 0;
  assert.equal((await resolve(ctx))?.availability, "persona_unavailable");
});

test("explicit model selection still requires live adapter discovery", async () => {
  const { ctx } = fixture();
  await assert.rejects(setPersonaRuntimeBindingHandler(ctx, {
    userId: "user_1", personaId: "persona_1" as Id<"personas">,
    deviceId: "device-offline", adapterId: "codex", modelSelectionMode: "explicit",
    provider: "openai", modelId: "gpt-5.6-codex", now: 1_600,
  }), /Reconnect the Runtime Host/);
});

test("a retry uses its selected local Persona on the existing canonical slot", async () => {
  const { rows, ctx } = fixture();
  await setRoute(ctx, "device-a");
  const selected = await resolveEffectiveParticipantRoute(ctx, {
    userId: "user_1", chatParticipantId: "participant_2" as Id<"chatParticipants">,
    personaId: "persona_1" as Id<"personas">, now: 2_000,
  });
  assert.equal(selected?.placement, "local");
  assert.equal(selected?.personaConfig?.personaId, "persona_1");
  assert.equal(selected?.chatParticipantId, "participant_2");
  assert.equal(rows.chatParticipants[1].personaId, "persona_2");
  const bare = await resolveEffectiveParticipantRoute(ctx, {
    userId: "user_1", chatParticipantId: "participant_1" as Id<"chatParticipants">,
    personaId: null, now: 2_000,
  });
  assert.equal(bare?.placement, "cloud");
});

test("selected retry Persona reaches the generation attempt and captured configuration", async () => {
  const { ctx } = fixture();
  await setRoute(ctx, "device-a");
  const { resolveChatParticipantConfigs } = await import("../chat/participant_resolution");
  const { createAssistantMessagesAndJobs } = await import("../chat/mutation_send_helpers");
  const participants = await resolveChatParticipantConfigs(ctx, {
    userId: "user_1", chatId: "chat_1" as Id<"chats">, allowPersonaOverride: true,
    participants: [{ participantKey: "participant_2", personaId: "persona_1" as Id<"personas">, modelId: "openai/gpt-6.1-sol" }],
  });
  const created = await createAssistantMessagesAndJobs(ctx, {
    userId: "user_1", chatId: "chat_1" as Id<"chats">, participants,
    parentMessageIds: [], assistantCreatedAt: 2_000, jobCreatedAt: 2_000,
  });
  const job = await ctx.db.get(created.generationJobIds[0]);
  assert.equal(job?.effectivePersonaConfig?.personaId, "persona_1");
  const attempt = job?.executionAttemptId ? await ctx.db.get(job.executionAttemptId) : null;
  assert.equal(attempt?.placement, "local");
  assert.equal(attempt?.chatParticipantId, "participant_2");
  assert.equal(attempt?.deviceId, "device-a");
});
