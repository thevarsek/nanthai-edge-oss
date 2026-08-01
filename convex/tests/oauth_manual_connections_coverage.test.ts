import assert from "node:assert/strict";
import test from "node:test";

import {
  connectCloze,
  deleteConnection as deleteClozeConnection,
  disconnectCloze,
  getClozeConnection,
  getConnectionInternal as getClozeConnectionInternal,
  markConnectionExpired as markClozeConnectionExpired,
  upsertConnection as upsertClozeConnection,
} from "../oauth/cloze";
import {
  connectGmailManual,
  disconnectGmailManual,
} from "../oauth/gmail_manual_actions";
import { testEncryptedOAuthArgs } from "./helpers/credential_envelopes";

function buildAuth(userId: string | null = "user_1") {
  return {
    getUserIdentity: async () => (userId ? { subject: userId } : null),
  };
}

function buildSingleConnectionDb(initialConnection: Record<string, unknown> | null) {
  let connection = initialConnection;
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  const deletes: string[] = [];

  const db = {
    query: (table: string) => {
      assert.equal(table, "oauthConnections");
      return {
        withIndex: (_index: string, apply: (query: any) => unknown) => {
          apply({
            eq: () => ({
              eq: () => ({}),
            }),
          });
          return {
            unique: async () => connection,
          };
        },
      };
    },
    patch: async (id: string, value: Record<string, unknown>) => {
      patches.push({ id, value });
      connection = { ...(connection ?? { _id: id }), ...value };
    },
    insert: async (table: string, value: Record<string, unknown>) => {
      inserts.push({ table, value });
      connection = { _id: `oauth_${inserts.length}`, ...value };
      return (connection as { _id: string })._id;
    },
    delete: async (id: string) => {
      deletes.push(id);
      connection = null;
    },
  };

  return { db, patches, inserts, deletes };
}

test("manual OAuth actions validate local input before external provider calls", async () => {
  await assert.rejects(
    (connectCloze as any)._handler({ auth: buildAuth() }, { apiKey: "   " }),
    /Cloze API key is required/,
  );

  await assert.rejects(
    (connectGmailManual as any)._handler(
      { auth: buildAuth() },
      { email: "   ", appPassword: "    " },
    ),
    /Gmail address and app password are required/,
  );
});

test("manual disconnect actions forward authenticated deletes", async () => {
  const mutations: Array<{ args: Record<string, unknown> }> = [];

  const gmail = await (disconnectGmailManual as any)._handler({
    auth: buildAuth(),
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push({ args });
    },
  });

  assert.deepEqual(gmail, { success: true });
  assert.deepEqual(mutations, [{ args: { userId: "user_1" } }]);

  await assert.rejects(
    (disconnectCloze as any)._handler({
      auth: buildAuth(),
      runQuery: async () => null,
    }),
    /No Cloze connection found/,
  );
});

test("Cloze connection mutations create, patch, expire, query, and delete rows", async () => {
  const createdDb = buildSingleConnectionDb(null);
  const createdId = await (upsertClozeConnection as any)._handler(
    { db: createdDb.db },
    {
      userId: "user_1",
      ...testEncryptedOAuthArgs(),
      email: "user@example.com",
      displayName: "Primary Cloze",
    },
  );

  assert.equal(createdId, "oauth_1");
  assert.equal(createdDb.inserts[0]?.table, "oauthConnections");
  assert.equal(createdDb.inserts[0]?.value.provider, "cloze");
  assert.deepEqual(createdDb.inserts[0]?.value.scopes, ["api_key"]);

  const existingDb = buildSingleConnectionDb({
    _id: "oauth_existing",
    userId: "user_1",
    provider: "cloze",
    accessToken: "old_key",
    scopes: ["api_key"],
    status: "active",
    connectedAt: 1.0,
  });

  const patchedId = await (upsertClozeConnection as any)._handler(
    { db: existingDb.db },
    {
      userId: "user_1",
      ...testEncryptedOAuthArgs(),
      email: "new@example.com",
      displayName: "Updated Cloze",
    },
  );
  assert.equal(patchedId, "oauth_existing");
  assert.match(String(existingDb.patches[0]?.value.accessToken), /^enc:v2:k1:/);
  assert.equal(existingDb.patches[0]?.value.errorMessage, undefined);

  await (markClozeConnectionExpired as any)._handler(
    { db: existingDb.db },
    { userId: "user_1", errorMessage: "expired" },
  );
  assert.equal(existingDb.patches[1]?.value.status, "expired");

  const publicConnection = await (getClozeConnection as any)._handler(
    { auth: buildAuth(), db: existingDb.db },
    {},
  );
  assert.equal(publicConnection.id, "oauth_existing");
  assert.equal(publicConnection.email, "new@example.com");

  const internalConnection = await (getClozeConnectionInternal as any)._handler(
    { db: existingDb.db },
    { userId: "user_1" },
  );
  assert.equal(internalConnection._id, "oauth_existing");

  await (deleteClozeConnection as any)._handler(
    { db: existingDb.db },
    { userId: "user_1" },
  );
  assert.deepEqual(existingDb.deletes, ["oauth_existing"]);
});
