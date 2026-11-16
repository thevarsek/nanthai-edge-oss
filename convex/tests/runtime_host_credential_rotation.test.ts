import assert from "node:assert/strict";
import test from "node:test";
import type { MutationCtx } from "../_generated/server";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";
import { beginPairingHandler, claimPairingHandler } from "../runtime_host/pairing";
import { authenticateRuntimeHost } from "../runtime_host/security";
import { prepareRotation, finishRotation } from "../runtime_host/credentials";

type Auth = { deviceId: string; credentialId: string; credential: string };
const prepare = prepareRotation as unknown as { _handler(ctx: MutationCtx, args: Auth & { nextCredentialId: string; nextCredential: string }): Promise<null> };
const finish = finishRotation as unknown as { _handler(ctx: MutationCtx, args: Auth & { previousCredentialId: string }): Promise<null> };

test("rotation retains old Macs until local persistence, then revokes the predecessor idempotently", async () => {
  const rows: Record<string, Array<Record<string, unknown>>> = { runtimePairingRequests: [], runtimeDevices: [], runtimeDeviceCredentials: [] };
  const ctx = createStatefulMockCtx(rows) as unknown as MutationCtx;
  const pairing = await beginPairingHandler(ctx, "user_owner");
  const grant = await claimPairingHandler(ctx, { pairingId: pairing.pairingId, oneTimeCode: pairing.oneTimeCode,
    includeAccountIdentity: true, hostNonce: "nonce", hostPublicKey: "key", displayName: "Mac", operatingSystem: "macos",
    architecture: "arm64", platformRelease: "26", hostVersion: "0.4.6" });
  assert.equal(grant.accountId, "user_owner");
  const replacement = { deviceId: grant.deviceId, credentialId: "credential_11111111-1111-4111-8111-111111111111", credential: `nrh_${"a".repeat(64)}` };
  const args = { deviceId: grant.deviceId, credentialId: grant.credentialId, credential: grant.credential,
    nextCredentialId: replacement.credentialId, nextCredential: replacement.credential };
  await assert.rejects(prepare._handler(ctx, { ...args, credential: "wrong" }), /invalid or revoked/);
  await prepare._handler(ctx, args);
  await prepare._handler(ctx, args); // A lost preparation response is safe to repeat.
  assert.equal(rows.runtimeDeviceCredentials.length, 2);
  await authenticateRuntimeHost(ctx, grant); // No expiry is retroactively imposed on legacy devices.
  await authenticateRuntimeHost(ctx, replacement);
  await assert.rejects(finish._handler(ctx, { ...replacement, previousCredentialId: "foreign" }), /does not match/);
  await authenticateRuntimeHost(ctx, grant);
  await finish._handler(ctx, { ...replacement, previousCredentialId: grant.credentialId });
  await finish._handler(ctx, { ...replacement, previousCredentialId: grant.credentialId });
  await assert.rejects(authenticateRuntimeHost(ctx, grant), /invalid or revoked/);
  await authenticateRuntimeHost(ctx, replacement);
  assert.equal(rows.runtimeDevices[0].currentCredentialId, replacement.credentialId);
  assert.ok(rows.runtimeDeviceCredentials.every(row => row.credential === undefined));
});

test("legacy pairing claims keep their response shape while new hosts request account identity", async () => {
  const rows: Record<string, Array<Record<string, unknown>>> = { runtimePairingRequests: [], runtimeDevices: [], runtimeDeviceCredentials: [] };
  const ctx = createStatefulMockCtx(rows) as unknown as MutationCtx;
  const pairing = await beginPairingHandler(ctx, "user_legacy");
  const grant = await claimPairingHandler(ctx, { pairingId: pairing.pairingId, oneTimeCode: pairing.oneTimeCode,
    hostNonce: "nonce", hostPublicKey: "key", displayName: "Mac", operatingSystem: "macos",
    architecture: "arm64", platformRelease: "26", hostVersion: "0.4.5" });
  assert.equal(grant.accountId, undefined);
});
