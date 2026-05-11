import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";
import {
  deleteConnection as deleteSlackConnection,
  disconnectSlack,
  exchangeSlackCode,
  getSlackConnection,
  markConnectionExpired,
  upsertConnection as upsertSlackConnection,
} from "../oauth/slack";
import {
  exchangeNotionCode,
  getNotionConnection,
  upsertConnection as upsertNotionConnection,
} from "../oauth/notion";

function authCtx(subject = "user_1") {
  return {
    auth: { getUserIdentity: async () => ({ subject, email: "ada@example.com", name: "Ada" }) },
  };
}

function oauthDb(existing: any = null) {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const deletes: string[] = [];
  const inserts: Array<Record<string, unknown>> = [];
  return {
    patches,
    deletes,
    inserts,
    db: {
      query: () => ({
        withIndex: () => ({
          unique: async () => existing,
          first: async () => existing,
        }),
      }),
      patch: async (id: string, patch: Record<string, unknown>) => patches.push({ id, patch }),
      delete: async (id: string) => deletes.push(id),
      insert: async (_table: string, row: Record<string, unknown>) => {
        inserts.push(row);
        return "conn_new";
      },
    },
  };
}

test("Slack OAuth actions cover config, HTTP, token, auth-test, and disconnect branches", async () => {
  const originalClientId = process.env.SLACK_CLIENT_ID;
  const originalClientSecret = process.env.SLACK_CLIENT_SECRET;
  const originalFetch = globalThis.fetch;
  delete process.env.SLACK_CLIENT_ID;
  delete process.env.SLACK_CLIENT_SECRET;

  await assert.rejects(
    (exchangeSlackCode as any)._handler(authCtx(), { code: "code", redirectUri: "app://slack" }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "CONFIG_ERROR",
  );

  process.env.SLACK_CLIENT_ID = "client";
  process.env.SLACK_CLIENT_SECRET = "secret";
  globalThis.fetch = (async () => new Response("bad", { status: 500 })) as any;
  await assert.rejects(
    (exchangeSlackCode as any)._handler(authCtx(), { code: "code", redirectUri: "app://slack" }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "EXTERNAL_SERVICE",
  );

  globalThis.fetch = (async () => new Response(JSON.stringify({ ok: false, error: "invalid_code" }), { status: 200 })) as any;
  await assert.rejects(
    (exchangeSlackCode as any)._handler(authCtx(), { code: "code", redirectUri: "app://slack" }),
    (error: unknown) => error instanceof ConvexError && /invalid_code/.test(String(error.data?.message)),
  );

  const mutations: Array<Record<string, unknown>> = [];
  let call = 0;
  globalThis.fetch = (async () => {
    call += 1;
    if (call === 1) {
      return new Response(JSON.stringify({
        ok: true,
        access_token: "xoxp-top",
        scope: "chat:write, users:read",
        expires_in: 60,
        team: { id: "T1", name: "Team" },
      }), { status: 200 });
    }
    throw new Error("auth.test unavailable");
  }) as any;
  const fallback = await (exchangeSlackCode as any)._handler({
    ...authCtx(),
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => mutations.push(args),
  }, { code: "code", redirectUri: "app://slack" });
  assert.equal(fallback.success, true);
  assert.equal(mutations[0]?.workspaceName, "Team");

  const deleted: string[] = [];
  globalThis.fetch = (async () => { throw new Error("revoke offline"); }) as any;
  await assert.rejects(
    (disconnectSlack as any)._handler({ ...authCtx(), runQuery: async () => null }, {}),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "NOT_FOUND",
  );
  const disconnected = await (disconnectSlack as any)._handler({
    ...authCtx(),
    runQuery: async () => ({ accessToken: "xoxp" }),
    runMutation: async () => deleted.push("deleted"),
  }, {});
  assert.equal(disconnected.success, true);
  assert.deepEqual(deleted, ["deleted"]);

  process.env.SLACK_CLIENT_ID = originalClientId;
  process.env.SLACK_CLIENT_SECRET = originalClientSecret;
  globalThis.fetch = originalFetch;
});

test("Slack and Notion OAuth mutations and public metadata queries preserve lifecycle rules", async () => {
  const slackExisting = {
    _id: "slack_1",
    provider: "slack",
    status: "expired",
    scopes: ["old"],
    connectedAt: 1,
    lastRefreshedAt: 10,
  };
  const slack = oauthDb(slackExisting);
  assert.equal(await (upsertSlackConnection as any)._handler({ db: slack.db }, {
    userId: "user_1",
    accessToken: "new",
    refreshToken: "refresh",
    expiresAt: 20,
    scopes: ["chat:write"],
    expectedLastRefreshedAt: 5,
  }), "slack_1");
  assert.equal(slack.patches.length, 0);

  await (markConnectionExpired as any)._handler({ db: slack.db }, { userId: "user_1" });
  await (deleteSlackConnection as any)._handler({ db: slack.db }, { userId: "user_1" });
  assert.equal(slack.patches[0].patch.status, "expired");
  assert.deepEqual(slack.deletes, ["slack_1"]);

  const slackView = await (getSlackConnection as any)._handler({ ...authCtx(), db: slack.db }, {});
  assert.equal(slackView.id, "slack_1");
  assert.equal(slackView.lastUsedAt, null);

  const notionExisting = {
    _id: "notion_1",
    userId: "user_1",
    provider: "notion",
    sourceStorageId: "old",
    status: "expired",
    scopes: [],
    connectedAt: 1,
  };
  const notion = oauthDb(notionExisting);
  await (upsertNotionConnection as any)._handler({ db: notion.db }, {
    userId: "user_1",
    accessToken: "notion-token",
    refreshToken: "",
    expiresAt: 99,
    scopes: [],
    email: "",
    displayName: "Ada",
    workspaceId: "W1",
    workspaceName: "",
  });
  assert.equal(notion.patches[0].patch.refreshToken, undefined);
  assert.equal(notion.patches[0].patch.displayName, "Ada");
  assert.equal(notion.patches[0].patch.workspaceName, undefined);

  const notionView = await (getNotionConnection as any)._handler({ ...authCtx(), db: notion.db }, {});
  assert.equal(notionView.email, null);
  assert.equal(notionView.workspaceName, null);
});

test("Notion OAuth exchange covers config, HTTP failure, missing token, and owner metadata", async () => {
  const originalClientId = process.env.NOTION_CLIENT_ID;
  const originalClientSecret = process.env.NOTION_CLIENT_SECRET;
  const originalFetch = globalThis.fetch;
  delete process.env.NOTION_CLIENT_ID;
  delete process.env.NOTION_CLIENT_SECRET;

  await assert.rejects(
    (exchangeNotionCode as any)._handler(authCtx(), { code: "code", redirectUri: "app://notion" }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "CONFIG_ERROR",
  );

  process.env.NOTION_CLIENT_ID = "client";
  process.env.NOTION_CLIENT_SECRET = "secret";
  globalThis.fetch = (async () => new Response("nope", { status: 400 })) as any;
  await assert.rejects(
    (exchangeNotionCode as any)._handler(authCtx(), { code: "code", redirectUri: "app://notion" }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "EXTERNAL_SERVICE",
  );

  globalThis.fetch = (async () => new Response(JSON.stringify({ workspace_id: "W1" }), { status: 200 })) as any;
  await assert.rejects(
    (exchangeNotionCode as any)._handler(authCtx(), { code: "code", redirectUri: "app://notion" }),
    (error: unknown) => error instanceof ConvexError && /access token/.test(String(error.data?.message)),
  );

  const mutations: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async () => new Response(JSON.stringify({
    access_token: "secret",
    token_type: "bearer",
    bot_id: "bot",
    workspace_id: "W1",
    workspace_name: "Workspace",
    owner: { type: "user", user: { id: "u1", name: "Ada", person: { email: "ada@example.com" } } },
  }), { status: 200 })) as any;
  const result = await (exchangeNotionCode as any)._handler({
    ...authCtx(),
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => mutations.push(args),
  }, { code: "code", redirectUri: "app://notion" });
  assert.equal(result.email, "ada@example.com");
  assert.equal(mutations[0].displayName, "Ada");

  process.env.NOTION_CLIENT_ID = originalClientId;
  process.env.NOTION_CLIENT_SECRET = originalClientSecret;
  globalThis.fetch = originalFetch;
});
