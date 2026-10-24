import assert from "node:assert/strict";
import test from "node:test";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";
import {
  beginPairingHandler,
  claimPairingHandler,
} from "../runtime_host/pairing";
import { heartbeatPresenceHandler } from "../runtime_host/presence";
import {
  expireRuntimePresenceHandler,
  expireStaleRuntimePresencesHandler,
} from "../runtime_host/presence_expiry";
import { authenticateRuntimeHost } from "../runtime_host/security";
import { listMyDevices } from "../runtime_host/devices";

const capabilities = {
  protocolVersion: "nanthai.runtime.v1",
  adapterId: "codex",
  adapterVersion: "0.147.0",
  transport: "stdio_jsonrpc" as const,
  inputModalities: ["text", "image"],
  eventTypes: ["session_started", "text_delta", "terminal"],
  operations: {
    listModels: true,
    cancel: true,
    resume: true,
    permissionResponse: true,
    inputResponse: true,
  },
  adapterNative: {
    tools: true,
    plugins: true,
    mcpServers: true,
    skills: true,
  },
};

test("pairing command carries its deployment origin without storing the one-time secret", async () => {
  const previous = process.env.CONVEX_SITE_URL;
  try {
    process.env.CONVEX_SITE_URL = "https://dev.convex.site";
    const rows: Record<string, Array<Record<string, unknown>>> = { runtimePairingRequests: [] };
    const session = await beginPairingHandler(createStatefulMockCtx(rows) as unknown as MutationCtx, "user_1", 1_000);
    assert.equal(session.pairingCommand, `nanthai pair ${session.pairingId} ${session.oneTimeCode} --server https://dev.convex.site`);
    assert.equal(rows.runtimePairingRequests[0].oneTimeCode, undefined);
    assert.equal(rows.runtimePairingRequests[0].pairingCommand, undefined);
  } finally {
    if (previous === undefined) delete process.env.CONVEX_SITE_URL;
    else process.env.CONVEX_SITE_URL = previous;
  }
});

test("pairing consumes its one-time secret and stores only a credential hash", async () => {
  const rows: Record<string, Array<Record<string, unknown>>> = {
    runtimePairingRequests: [],
    purchaseEntitlements: [{ _id: "pro", userId: "user_1", status: "active" }],
    runtimeDevices: [],
    runtimeDeviceCredentials: [],
    runtimeDevicePresences: [],
  };
  const ctx = createStatefulMockCtx(rows) as unknown as MutationCtx;
  const initiation = await beginPairingHandler(ctx, "user_1", 1_000);
  const claim = {
    pairingId: initiation.pairingId,
    oneTimeCode: initiation.oneTimeCode,
    hostNonce: "host-nonce",
    hostPublicKey: "host-public-key",
    displayName: "Dino MacBook",
    operatingSystem: "macos" as const,
    architecture: "arm64" as const,
    platformRelease: "26.0",
    hostVersion: "0.1.0",
    now: 1_100,
  };
  const grant = await claimPairingHandler(ctx, claim);

  assert.equal(rows.runtimePairingRequests[0].status, "claimed");
  assert.equal(rows.runtimeDeviceCredentials[0].credential, undefined);
  assert.notEqual(rows.runtimeDeviceCredentials[0].credentialHash, grant.credential);
  assert.equal(rows.runtimeDevices[0].currentCredentialId, grant.credentialId);
  await assert.rejects(claimPairingHandler(ctx, claim), /already used/);
  await assert.rejects(authenticateRuntimeHost(ctx, {
    deviceId: grant.deviceId,
    credentialId: grant.credentialId,
    credential: `${grant.credential}-wrong`,
  }), /invalid or revoked/);
});

test("presence renews one host session and rejects a competing owner", async () => {
  const rows: Record<string, Array<Record<string, unknown>>> = {
    runtimePairingRequests: [],
    purchaseEntitlements: [{ _id: "pro", userId: "user_1", status: "active" }],
    runtimeDevices: [],
    runtimeDeviceCredentials: [],
    runtimeDevicePresences: [],
  };
  const stateful = createStatefulMockCtx(rows);
  const ctx = stateful as unknown as MutationCtx;
  const initiation = await beginPairingHandler(ctx, "user_1", 1_000);
  const grant = await claimPairingHandler(ctx, {
    pairingId: initiation.pairingId,
    oneTimeCode: initiation.oneTimeCode,
    hostNonce: "host-nonce",
    hostPublicKey: "host-public-key",
    displayName: "Dino MacBook",
    operatingSystem: "macos",
    architecture: "arm64",
    platformRelease: "26.0",
    hostVersion: "0.1.0",
    now: 1_100,
  });
  const heartbeat = {
    deviceId: grant.deviceId,
    credentialId: grant.credentialId,
    credential: grant.credential,
    presenceSessionId: "presence-1",
    owner: "foreground_cli" as const,
    connectedAt: 1_200,
    heartbeatAt: 1_200,
    hostVersion: "0.1.0",
    platform: {
      operatingSystem: "macos" as const,
      architecture: "arm64" as const,
      release: "26.0",
    },
    adapters: [{
      adapterId: "codex",
      adapterVersion: "0.147.0",
      authState: "ready" as const,
      capabilities,
    }],
  };
  const first = await heartbeatPresenceHandler(ctx, {
    ...heartbeat, adapters: [{ ...heartbeat.adapters[0], authState: "signed_out" }], now: 1_200,
  });
  assert.equal(rows.personas?.length ?? 0, 0, "pairing and signed-out presence do not provision a Persona");
  const renewed = await heartbeatPresenceHandler(ctx, { ...heartbeat, now: 1_250 });
  assert.equal(rows.personas.length, 1);
  assert.equal(rows.personas[0].userId, "user_1");
  assert.equal(rows.personas[0].isDefault, false, "chat defaults use preferences.defaultPersonaId");
  assert.equal(rows.runtimeDevices[0].starterPersonaId, rows.personas[0]._id);
  assert.equal(rows.personaRuntimeBindings[0].personaId, rows.personas[0]._id);
  assert.equal(rows.personaRuntimeBindings[0].deviceId, grant.deviceId);
  assert.equal(rows.personaRuntimeBindings[0].modelSelectionMode, "explicit");
  assert.equal(rows.personaRuntimeBindings[0].modelId, "gpt-6.1-sol");
  const list = listMyDevices as unknown as { _handler: (ctx: QueryCtx) => Promise<Array<{ starterPersonaId?: string }>> };
  const queryCtx = { db: ctx.db, auth: { getUserIdentity: async () => ({ subject: "user_1" }) } } as unknown as QueryCtx;
  assert.equal((await list._handler(queryCtx))[0].starterPersonaId, rows.personas[0]._id);
  assert.equal(first.presenceId, renewed.presenceId);
  assert.equal(rows.runtimeDevicePresences.length, 1);
  assert.equal(rows.runtimeDevicePresences[0].expiresAt, 151_250);
  assert.equal(stateful.scheduled.length, 0, "heartbeats do not schedule a per-beat expiry");
  assert.equal(await expireRuntimePresenceHandler(ctx, {
    runtimeDeviceId: "runtimeDevices_1" as Id<"runtimeDevices">,
    presenceId: first.presenceId as Id<"runtimeDevicePresences">,
    presenceSessionId: "presence-1",
    expectedExpiresAt: 151_200,
    now: 151_200,
  }), false);
  await assert.rejects(
    heartbeatPresenceHandler(ctx, {
      ...heartbeat,
      presenceSessionId: "presence-2",
      owner: "tray",
      now: 1_300,
    }),
    /already has an active Runtime Host/,
  );
  assert.equal(await expireStaleRuntimePresencesHandler(ctx, 151_249), 0, "a live lease survives the sweep");
  assert.equal(rows.runtimeDevicePresences[0].status, "online");
  assert.equal(await expireStaleRuntimePresencesHandler(ctx, 151_250), 1);
  assert.equal(rows.runtimeDevicePresences[0].status, "offline");
  assert.equal(rows.runtimeDevices[0].currentPresenceId, undefined);
  rows.personas[0].displayName = "My renamed assistant";
  rows.personas[0].systemPrompt = "Keep my instructions";
  await heartbeatPresenceHandler(ctx, { ...heartbeat, presenceSessionId: "presence-2", now: 160_000 });
  assert.equal(rows.personas.length, 1, "reconnect does not duplicate the starter Persona");
  assert.equal(rows.personas[0].displayName, "My renamed assistant");
  assert.equal(rows.personas[0].systemPrompt, "Keep my instructions");
  await ctx.db.delete(rows.personas[0]._id as Id<"personas">);
  await heartbeatPresenceHandler(ctx, { ...heartbeat, presenceSessionId: "presence-2", now: 160_100 });
  assert.equal(rows.personas.length, 0, "intentional deletion is not undone by a heartbeat");
  assert.equal((await list._handler(queryCtx))[0].starterPersonaId, undefined);
});
