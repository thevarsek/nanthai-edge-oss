import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";

import type { ConnectionInvalidation } from "../security/credential_invalidation_oauth";
import {
  inspectUserCredentials,
  invalidateUserOpenRouterKey,
  invalidateUsers,
  revokeUserOAuthConnections,
  type InvalidateUsersResult,
} from "../security/credential_invalidation";
import {
  ALL_PROVIDERS,
  assertNoSecrets,
  buildCtx,
  emptyTables,
  idsOf,
  okResponse,
  SENTINEL_TOKENS,
  seedUser,
  withFetch,
} from "./helpers/credential_invalidation.harness";

test("invalidateUserOpenRouterKey deletes only the target user's key rows", async () => {
  const tables = emptyTables();
  await seedUser(tables, "user_1", []);
  await seedUser(tables, "user_2", []);
  const ctx = buildCtx(tables);

  const first = await (invalidateUserOpenRouterKey as any)._handler(ctx, { userId: "user_1" });
  const again = await (invalidateUserOpenRouterKey as any)._handler(ctx, { userId: "user_1" });

  assert.deepEqual(first, { deleted: true });
  assert.deepEqual(again, { deleted: false });
  assert.deepEqual(idsOf(tables.userSecrets), ["secret_user_2"]);
  assert.deepEqual(idsOf(tables.openRouterExchangeAttempts), ["attempt_user_2"]);
});

test("revokeUserOAuthConnections revokes and deletes every provider for one user only", async () => {
  const tables = emptyTables();
  await seedUser(tables, "user_1");
  await seedUser(tables, "user_2");
  const ctx = buildCtx(tables);

  const results = await withFetch<ConnectionInvalidation[]>(okResponse, async (calls) => {
    const out = await (revokeUserOAuthConnections as any)._handler(ctx, { userId: "user_1" });
    assert.deepEqual(
      calls.map((call) => call.url).sort(),
      [
        "https://api.notion.com/v1/oauth/revoke",
        "https://oauth2.googleapis.com/revoke",
        "https://slack.com/api/auth.revoke",
      ],
    );
    const google = calls.find((call) => call.url.includes("googleapis"));
    assert.equal(new URLSearchParams(google?.body).get("token"), SENTINEL_TOKENS[1]);
    return out;
  });

  assert.deepEqual(
    results.map((r) => r.provider),
    [...ALL_PROVIDERS].sort(),
  );
  for (const result of results) {
    assert.equal(result.deleted, true, result.provider);
    assert.equal(result.error, undefined, result.provider);
  }
  const byProvider = Object.fromEntries(results.map((r) => [r.provider, r]));
  for (const provider of ["google", "notion", "slack"]) {
    assert.equal(byProvider[provider].revoked, true);
    assert.equal(byProvider[provider].userActionRequired, false);
  }
  assert.deepEqual(
    tables.oauthConnections.map((row) => row.userId),
    ALL_PROVIDERS.map(() => "user_2"),
  );
  assert.deepEqual(idsOf(tables.googleDriveFileGrants), ["grant_user_2"]);
  assert.equal(tables.userSecrets.length, 2, "OpenRouter rows are not touched by the OAuth action");
  assertNoSecrets(results);
});

test("Microsoft and app-password providers are deleted and flagged for user action", async () => {
  const tables = emptyTables();
  await seedUser(tables, "user_1", ["microsoft", "gmail_manual", "apple_calendar", "cloze"]);
  const ctx = buildCtx(tables);

  const results = await withFetch<ConnectionInvalidation[]>(okResponse, async (calls) => {
    const out = await (revokeUserOAuthConnections as any)._handler(ctx, { userId: "user_1" });
    assert.equal(calls.length, 0, "no provider revoke endpoint exists for these providers");
    return out;
  });

  assert.equal(results.length, 4);
  for (const result of results) {
    assert.deepEqual(
      { ...result, provider: undefined },
      { provider: undefined, revoked: false, deleted: true, userActionRequired: true },
    );
  }
  assert.equal(tables.oauthConnections.length, 0);
});

test("revocation failures never stop deletion and are reported with codes only", async () => {
  const tables = emptyTables();
  await seedUser(tables, "user_1", ["google", "notion", "slack"]);
  const ctx = buildCtx(tables);

  const results = await withFetch<ConnectionInvalidation[]>(
    (url) => {
      if (url.includes("googleapis")) throw new Error("network down with sentinel-access");
      if (url.includes("notion")) return { ok: false, status: 400 } as Response;
      return { ok: true, status: 200, json: async () => ({ ok: false, error: "invalid_auth" }) } as Response;
    },
    () => (revokeUserOAuthConnections as any)._handler(ctx, { userId: "user_1" }),
  );

  const byProvider = Object.fromEntries(results.map((r) => [r.provider, r]));
  assert.equal(byProvider.google.error, "revoke_failed:request_failed");
  assert.equal(byProvider.notion.error, "revoke_failed:http_400");
  assert.equal(byProvider.slack.error, "revoke_failed:slack_invalid_auth");
  for (const result of results) {
    assert.equal(result.revoked, false);
    assert.equal(result.deleted, true);
    assert.equal(result.userActionRequired, true);
  }
  assert.equal(tables.oauthConnections.length, 0);
  assertNoSecrets(results);
});

test("undecryptable credentials and missing Notion config still delete the rows", async () => {
  const tables = emptyTables();
  await seedUser(tables, "user_1", ["google", "notion"]);
  tables.oauthConnections[0].accessToken = "enc:v2:k1:AAAA:BBBB";
  const ctx = buildCtx(tables);

  const results = await withFetch<ConnectionInvalidation[]>(okResponse, async (calls) => {
    delete process.env.NOTION_CLIENT_ID;
    const out = await (revokeUserOAuthConnections as any)._handler(ctx, { userId: "user_1" });
    assert.equal(calls.length, 0);
    return out;
  });

  const byProvider = Object.fromEntries(results.map((r) => [r.provider, r]));
  assert.equal(byProvider.google.error, "revoke_failed:decrypt_failed");
  assert.equal(byProvider.notion.error, "revoke_failed:revocation_unavailable");
  assert.ok(results.every((r: any) => r.deleted && r.userActionRequired));
  assert.equal(tables.oauthConnections.length, 0);
});

test("unrecognised provider rows are deleted through the fallback and flagged", async () => {
  const tables = emptyTables();
  await seedUser(tables, "user_1", ["future_provider"]);
  await seedUser(tables, "user_2", ["future_provider"]);
  const ctx = buildCtx(tables);

  const results = await (revokeUserOAuthConnections as any)._handler(ctx, { userId: "user_1" });

  assert.deepEqual(results, [
    { provider: "future_provider", revoked: false, deleted: true, userActionRequired: true },
  ]);
  assert.deepEqual(idsOf(tables.oauthConnections), ["oauth_user_2_future_provider"]);
});

test("invalidateUsers dry run reports credentials and changes nothing", async () => {
  const tables = emptyTables();
  await seedUser(tables, "user_1");
  await seedUser(tables, "user_2", ["microsoft"]);
  const before = JSON.stringify(tables);
  const ctx = buildCtx(tables);

  const result = await withFetch(okResponse, async (calls) => {
    const out = await (invalidateUsers as any)._handler(ctx, {
      userIds: ["user_1", "user_2", "user_3"],
      dryRun: true,
    });
    assert.equal(calls.length, 0, "dry run must not contact providers");
    return out;
  });

  assert.equal(JSON.stringify(tables), before);
  assert.equal(result.dryRun, true);
  assert.deepEqual(result.totals, {
    users: 3,
    usersWithOpenRouterKey: 2,
    openRouterKeysDeleted: 0,
    oauthConnectionsFound: 8,
    oauthConnectionsRevoked: 0,
    oauthConnectionsDeleted: 0,
    connectionsNeedingUserAction: 0,
    failedUsers: 0,
  });
  assert.deepEqual(result.users[0].oauthProviders, [...ALL_PROVIDERS].sort());
  assert.equal(result.users[2].openRouterKeyPresent, false);
  assert.deepEqual(result.users[2].oauthProviders, []);
  assertNoSecrets(result);
});

test("invalidateUsers applies both invalidations sequentially and leaves other users alone", async () => {
  const tables = emptyTables();
  await seedUser(tables, "user_1");
  await seedUser(tables, "user_2");
  await seedUser(tables, "user_3");
  const ctx = buildCtx(tables, { failInspectFor: "user_bad" });

  const result = await withFetch<InvalidateUsersResult>(okResponse, () =>
    (invalidateUsers as any)._handler(ctx, {
      userIds: [" user_1 ", "user_bad", "user_3", "user_1", "user_unknown"],
      dryRun: false,
    }),
  );

  assert.deepEqual(result.users.map((u) => u.userId), ["user_1", "user_bad", "user_3", "user_unknown"]);
  assert.equal(result.users[1].error, "invalidation_failed");
  assert.equal(result.users[3].openRouterKeyDeleted, false);
  assert.deepEqual(result.totals, {
    users: 4,
    usersWithOpenRouterKey: 2,
    openRouterKeysDeleted: 2,
    oauthConnectionsFound: 14,
    oauthConnectionsRevoked: 6,
    oauthConnectionsDeleted: 14,
    connectionsNeedingUserAction: 8,
    failedUsers: 1,
  });
  assert.deepEqual(idsOf(tables.userSecrets), ["secret_user_2"]);
  assert.deepEqual(idsOf(tables.openRouterExchangeAttempts), ["attempt_user_2"]);
  assert.deepEqual(idsOf(tables.googleDriveFileGrants), ["grant_user_2"]);
  assert.deepEqual(
    [...new Set(tables.oauthConnections.map((row) => row.userId))],
    ["user_2"],
  );
  assert.equal(tables.oauthConnections.length, ALL_PROVIDERS.length);
  assertNoSecrets(result);
});

test("invalidateUsers rejects blank, empty and oversized user lists", async () => {
  const ctx = buildCtx(emptyTables());
  const isValidation = (error: unknown) =>
    error instanceof ConvexError && (error.data as { code?: string }).code === "VALIDATION";

  await assert.rejects((invalidateUsers as any)._handler(ctx, { userIds: [], dryRun: true }), isValidation);
  await assert.rejects((invalidateUsers as any)._handler(ctx, { userIds: ["a", "  "], dryRun: true }), isValidation);
  await assert.rejects(
    (invalidateUsers as any)._handler(ctx, {
      userIds: Array.from({ length: 201 }, (_, i) => `user_${i}`),
      dryRun: true,
    }),
    isValidation,
  );
});

test("inspectUserCredentials returns metadata without token fields", async () => {
  const tables = emptyTables();
  await seedUser(tables, "user_1", ["google", "slack"]);
  const ctx = buildCtx(tables);

  const found = await (inspectUserCredentials as any)._handler(ctx, { userId: "user_1" });

  assert.deepEqual(found, { openRouterKeyPresent: true, oauthProviders: ["google", "slack"] });
  assertNoSecrets(found);
});
