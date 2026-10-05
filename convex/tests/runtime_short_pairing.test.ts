import assert from "node:assert/strict";
import test from "node:test";
import type { MutationCtx } from "../_generated/server";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";
import { beginPairingHandler } from "../runtime_host/pairing";
import { claimShortPairingHandler } from "../runtime_host/short_pairing";

const host = { hostNonce: "nonce", hostPublicKey: "key", displayName: "QA Mac", operatingSystem: "macos" as const,
  architecture: "arm64" as const, platformRelease: "26", hostVersion: "0.3.0" };

test("mobile codes use the canonical hashed, single-use ten-minute pairing grant", async () => {
  const rows: Record<string, Array<Record<string, unknown>>> = { runtimePairingRequests: [], runtimeDevices: [], runtimeDeviceCredentials: [] };
  const ctx = createStatefulMockCtx(rows) as unknown as MutationCtx;
  const session = await beginPairingHandler(ctx, "review", 1000, true);
  assert.match(session.pairingCode ?? "", /^[A-F0-9]{4}(-[A-F0-9]{4}){3}$/);
  assert.equal(session.expiresAt, 601000);
  assert.equal(rows.runtimePairingRequests[0].pairingCode, undefined);
  assert.notEqual(rows.runtimePairingRequests[0].codeHash, session.oneTimeCode);
  await assert.rejects(claimShortPairingHandler(ctx, { ...host, shortCode: "0000-0000-0000-0000", now: 2000 }), /invalid/);
  const grant = await claimShortPairingHandler(ctx, { ...host, shortCode: ` ${session.pairingCode?.toLowerCase()} `, now: 2000 });
  assert.equal(grant.pairingId, session.pairingId);
  assert.equal(rows.runtimeDevices[0].userId, "review");
  assert.equal(rows.runtimePairingRequests[0].status, "claimed");
  assert.equal(rows.runtimeDeviceCredentials[0].credential, undefined);
  await assert.rejects(claimShortPairingHandler(ctx, { ...host, shortCode: session.pairingCode ?? "", now: 2001 }), /already used/);
});

test("short-code claims reject expired and malformed codes without creating a device", async () => {
  const rows: Record<string, Array<Record<string, unknown>>> = { runtimePairingRequests: [], runtimeDevices: [], runtimeDeviceCredentials: [] };
  const ctx = createStatefulMockCtx(rows) as unknown as MutationCtx;
  const session = await beginPairingHandler(ctx, "review", 1000, true);
  await assert.rejects(claimShortPairingHandler(ctx, { ...host, shortCode: session.pairingCode ?? "", now: 601000 }), /expired/);
  await assert.rejects(claimShortPairingHandler(ctx, { ...host, shortCode: "too-short", now: 2000 }), /complete pairing code/);
  assert.equal(rows.runtimeDevices.length, 0);
  const legacy = await beginPairingHandler(ctx, "review", 2000);
  assert.equal(legacy.pairingCode, undefined);
  assert.match(legacy.oneTimeCode, /^nrp_[a-f0-9]{64}$/);
});
