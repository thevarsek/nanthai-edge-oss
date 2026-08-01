import assert from "node:assert/strict";
import test from "node:test";
import { applyUserSecretPage } from "../security/secret_rotation_mutations";
import {
  listOAuthCredentialPage,
  listUserSecretPage,
} from "../security/secret_rotation_queries";
import { encryptSecret, userApiKeySecretContext } from "../lib/secret_crypto";

process.env.CONVEX_SECRET_ENCRYPTION_KEY ??= "test-rotation-k1";
process.env.CONVEX_SECRET_ENCRYPTION_KEY_K2 ??= "test-rotation-k2";

function paginationContext(page: Array<Record<string, unknown>>) {
  return {
    db: {
      query: () => ({
        paginate: async () => ({
          page,
          isDone: true,
          continueCursor: "cursor_1",
          pageStatus: "SplitRequired",
          splitCursor: "internal_split_cursor",
        }),
      }),
    },
  } as any;
}

test("OAuth rotation pagination strips undeclared Convex metadata", async () => {
  const result = await (listOAuthCredentialPage as any)._handler(
    paginationContext([{
      _id: "oauth_1",
      userId: "user_1",
      provider: "google",
      accessToken: "fake-access-token",
      refreshToken: "fake-refresh-token",
    }]),
    { paginationOpts: { numItems: 50, cursor: null } },
  );

  assert.deepEqual(Object.keys(result).sort(), ["continueCursor", "isDone", "page"]);
  assert.deepEqual(result.page, [{
    id: "oauth_1",
    userId: "user_1",
    provider: "google",
    accessToken: "fake-access-token",
    refreshToken: "fake-refresh-token",
    lastRefreshedAt: undefined,
    secretKeyId: undefined,
  }]);
});

test("user-secret rotation pagination strips undeclared Convex metadata", async () => {
  const result = await (listUserSecretPage as any)._handler(
    paginationContext([{
      _id: "secret_1",
      userId: "user_1",
      apiKey: "fake-api-key",
      updatedAt: 10,
    }]),
    { paginationOpts: { numItems: 50, cursor: null } },
  );

  assert.deepEqual(Object.keys(result).sort(), ["continueCursor", "isDone", "page"]);
  assert.deepEqual(result.page, [{
    id: "secret_1",
    userId: "user_1",
    apiKey: "fake-api-key",
    updatedAt: 10,
    secretKeyId: undefined,
  }]);
});

function rotationContext(currentUpdatedAt: number) {
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const docs: Record<string, Record<string, unknown>> = {
    attempt_1: {
      _id: "attempt_1",
      runId: "run_1",
      fence: 1,
      status: "running",
      claimantId: "rotation-worker",
      leaseExpiresAt: Date.now() + 60_000,
    },
    run_1: {
      _id: "run_1",
      activeAttemptId: "attempt_1",
      userId: "system:secret-crypto",
      state: "running",
      domainType: "secret_crypto_rotation",
      domainId: "rotation_1",
    },
    rotation_1: {
      _id: "rotation_1",
      scannedCount: 0,
      migratedCount: 0,
      conflictCount: 0,
      failureCount: 0,
      updatedAt: 1,
    },
    secret_1: {
      _id: "secret_1",
      userId: "user_1",
      apiKey: "legacy-plaintext",
      updatedAt: currentUpdatedAt,
    },
  };
  return {
    patches,
    ctx: {
      db: {
        get: async (id: string) => docs[id] ?? null,
        query: () => ({
          withIndex: () => ({ unique: async () => null }),
        }),
        patch: async (id: string, value: Record<string, unknown>) => {
          patches.push({ id, value });
          docs[id] = { ...docs[id], ...value };
        },
      },
    } as any,
  };
}

test("rotation CAS writes only a verified target envelope", async () => {
  const encryptedApiKey = await encryptSecret(
    "legacy-plaintext",
    userApiKeySecretContext("user_1"),
    undefined,
    "k2",
  );
  const fixture = rotationContext(10);
  const result = await (applyUserSecretPage as any)._handler(fixture.ctx, {
    rotationId: "rotation_1",
    executionAttemptId: "attempt_1",
    executionFence: 1,
    claimantId: "rotation-worker",
    targetKeyId: "k2",
    dryRun: false,
    entries: [{
      id: "secret_1",
      originalApiKey: "legacy-plaintext",
      originalUpdatedAt: 10,
      encryptedApiKey,
    }],
    scannedCount: 1,
    failureCount: 0,
    cursor: "cursor_1",
    isDone: true,
  });

  assert.deepEqual(result, { migratedCount: 1, conflictCount: 0 });
  assert.equal(fixture.patches.some((patch) =>
    patch.id === "secret_1" && patch.value.secretKeyId === "k2"), true);
});

test("rotation CAS lets a concurrent credential update win", async () => {
  const encryptedApiKey = await encryptSecret(
    "legacy-plaintext",
    userApiKeySecretContext("user_1"),
    undefined,
    "k2",
  );
  const fixture = rotationContext(11);
  const result = await (applyUserSecretPage as any)._handler(fixture.ctx, {
    rotationId: "rotation_1",
    executionAttemptId: "attempt_1",
    executionFence: 1,
    claimantId: "rotation-worker",
    targetKeyId: "k2",
    dryRun: false,
    entries: [{
      id: "secret_1",
      originalApiKey: "legacy-plaintext",
      originalUpdatedAt: 10,
      encryptedApiKey,
    }],
    scannedCount: 1,
    failureCount: 0,
    cursor: "cursor_1",
    isDone: true,
  });

  assert.deepEqual(result, { migratedCount: 0, conflictCount: 1 });
  assert.equal(fixture.patches.some((patch) => patch.id === "secret_1"), false);
});
