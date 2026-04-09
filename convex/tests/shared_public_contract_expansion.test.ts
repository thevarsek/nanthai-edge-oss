import assert from "node:assert/strict";
import test from "node:test";

import { setUserCapabilityInternal } from "../capabilities/mutations";
import {
  getModel,
  listModelSummaries,
  listModelsInternalForSync,
} from "../models/queries";
import { getCatalogHash, setCatalogHash, syncFromOpenRouter, upsertBatch } from "../models/sync";
import {
  deleteConnection as deleteAppleCalendarConnection,
  getAppleCalendarConnection,
  upsertConnection as upsertAppleCalendarConnection,
} from "../oauth/apple_calendar";
import { listByChat } from "../nodePositions/queries";
import { getDeviceTokens } from "../push/queries";
import { upsertSessionInternal } from "../runtime/mutations";
import { runWebSearch } from "../search/actions_web_search";
import { createCheckoutSession } from "../stripe/actions";

function buildAuth(userId: string | null = "user_1") {
  return {
    getUserIdentity: async () => (userId ? { subject: userId } : null),
  };
}

test("model queries filter excluded providers and summarize free models", async () => {
  const models = [
    {
      _id: "m1",
      modelId: "openai/gpt-5.2:free",
      name: "GPT 5.2",
      provider: "openai",
      contextLength: 200_000,
      outputPricePer1M: 5,
      supportsImages: false,
      supportsTools: true,
      supportedParameters: ["reasoning"],
      architecture: { modality: "text->text" },
    },
    {
      _id: "m2",
      modelId: "x-ai/grok-4",
      name: "Grok",
      provider: "x-ai",
      contextLength: 200_000,
      outputPricePer1M: 5,
    },
  ];

  const list = await (listModelSummaries as any)._handler({
    db: {
      query: () => ({
        take: async () => models,
        withIndex: () => ({
          collect: async () => models,
        }),
      }),
    },
  }, {});
  const hidden = await (getModel as any)._handler({
    db: {
      query: () => ({
        withIndex: () => ({
          first: async () => models[1],
        }),
      }),
    },
  }, { modelId: "x-ai/grok-4" });
  const internal = await (listModelsInternalForSync as any)._handler({
    db: { query: () => ({ collect: async () => models }) },
  }, {});

  assert.deepEqual(list.map((model: any) => model._id), ["m1"]);
  assert.equal(list[0]?.isFree, true);
  assert.equal(hidden, null);
  assert.deepEqual(internal, models);
});

test("model sync metadata helpers and upsertBatch avoid unnecessary duplicate inserts", async () => {
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];

  const hash = await (getCatalogHash as any)._handler({
    db: {
      query: () => ({
        withIndex: () => ({
          first: async () => ({ contentHash: "hash_1" }),
        }),
      }),
    },
  }, {});
  await (setCatalogHash as any)._handler({
    db: {
      query: () => ({
        withIndex: () => ({
          first: async () => ({ _id: "meta_1" }),
        }),
      }),
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
    },
  }, { contentHash: "hash_2" });
  await (upsertBatch as any)._handler({
    db: {
      query: () => ({
        withIndex: () => ({
          first: async () => null,
        }),
      }),
      insert: async (table: string, value: Record<string, unknown>) => {
        inserts.push({ table, value });
      },
    },
  }, {
    models: [{
      modelId: "openai/gpt-5.2",
      name: "GPT 5.2",
      provider: "openai",
      contextLength: 200_000,
      outputPricePer1M: 5,
    }],
  });

  assert.equal(hash, "hash_1");
  assert.equal(patches[0]?.id, "meta_1");
  assert.equal(inserts[0]?.table, "cachedModels");
});

test("syncFromOpenRouter skips writes when the content hash matches", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const data = [{ id: "openai/gpt-5.2", name: "GPT 5.2", pricing: { prompt: "0.000001", completion: "0.000002" }, context_length: 200000, supported_parameters: [] }];
    const hashInput = data
      .map((m: any) => `${m.id}|${m.name}|${m.pricing?.prompt}|${m.pricing?.completion}|${m.context_length}|${(m.supported_parameters ?? []).join(",")}`)
      .sort()
      .join("\n");
    const hashBuffer = await globalThis.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(hashInput),
    );
    const previousHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({ data }),
      status: 200,
      statusText: "OK",
    })) as any;

    const mutations: Array<Record<string, unknown>> = [];
    await (syncFromOpenRouter as any)._handler({
      runQuery: async () => previousHash,
      runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
        mutations.push(args);
      },
    }, {});

    assert.equal(mutations.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("apple calendar connection helpers redact secrets and delete idempotently", async () => {
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const inserts: Array<Record<string, unknown>> = [];
  const deleted: string[] = [];

  await (upsertAppleCalendarConnection as any)._handler({
    db: {
      query: () => ({
        withIndex: () => ({
          unique: async () => null,
        }),
      }),
      insert: async (_table: string, value: Record<string, unknown>) => {
        inserts.push(value);
        return "oauth_1";
      },
    },
  }, {
    userId: "user_1",
    appleId: "user@example.com",
    appSpecificPassword: "secret",
    displayName: "Personal",
  });

  const connection = await (getAppleCalendarConnection as any)._handler({
    auth: buildAuth(),
    db: {
      query: () => ({
        withIndex: () => ({
          unique: async () => ({
            _id: "oauth_1",
            email: "user@example.com",
            displayName: "Personal",
            status: "active",
            scopes: ["caldav"],
            connectedAt: 1,
          }),
        }),
      }),
    },
  }, {});

  await (deleteAppleCalendarConnection as any)._handler({
    db: {
      query: () => ({
        withIndex: () => ({
          unique: async () => ({ _id: "oauth_1" }),
        }),
      }),
      delete: async (id: string) => {
        deleted.push(id);
      },
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
    },
  }, { userId: "user_1" });

  assert.equal(inserts[0]?.provider, "apple_calendar");
  assert.equal("accessToken" in (connection ?? {}), false);
  assert.deepEqual(deleted, ["oauth_1"]);
  assert.equal(patches.length, 0);
});

test("node positions, push tokens, runtime sessions, and capabilities mutations honor core contract semantics", async () => {
  const runtimePatches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const capabilityPatches: Array<{ id: string; value: Record<string, unknown> }> = [];

  const positions = await (listByChat as any)._handler({
    auth: buildAuth(),
    db: {
      get: async () => ({ _id: "chat_1", userId: "user_1" }),
      query: () => ({
        withIndex: () => ({
          take: async () => [{ _id: "pos_1" }, { _id: "pos_2" }],
        }),
      }),
    },
  }, { chatId: "chat_1" });
  const tokens = await (getDeviceTokens as any)._handler({
    db: {
      query: () => ({
        withIndex: () => ({
          collect: async () => [{ _id: "token_1" }],
        }),
      }),
    },
  }, { userId: "user_1" });

  await (upsertSessionInternal as any)._handler({
    db: {
      patch: async (id: string, value: Record<string, unknown>) => {
        runtimePatches.push({ id, value });
      },
    },
  }, {
    sessionId: "session_1",
    userId: "user_1",
    chatId: "chat_1",
    status: "running",
    cwd: "/tmp/chat_1",
    lastActiveAt: 10,
    timeoutMs: 60_000,
    internetEnabled: true,
    publicTrafficEnabled: false,
    pendingDeletionReason: null,
  });

  await (setUserCapabilityInternal as any)._handler({
    db: {
      query: () => ({
        withIndex: () => ({
          first: async () => ({ _id: "cap_1", grantedAt: 1 }),
          collect: async () => [{ _id: "cap_1" }],
        }),
      }),
      patch: async (id: string, value: Record<string, unknown>) => {
        capabilityPatches.push({ id, value });
      },
    },
  }, {
    userId: "user_1",
    capability: "mcpRuntime",
    source: "manual_override",
    active: false,
  });

  assert.deepEqual(positions.map((row: any) => row._id), ["pos_1", "pos_2"]);
  assert.deepEqual(tokens, [{ _id: "token_1" }]);
  assert.equal(runtimePatches[0]?.value.pendingDeletionReason, undefined);
  assert.equal(capabilityPatches[0]?.value.status, "revoked");
});

test("runWebSearch finalizes missing-API-key failures and Stripe checkout maps config and upstream errors", async () => {
  const originalFetch = globalThis.fetch;
  const originalSecretKey = process.env.STRIPE_SECRET_KEY;
  const originalPriceId = process.env.STRIPE_PRICE_ID;
  const originalWebAppUrl = process.env.WEB_APP_URL;

  const searchMutations: Array<Record<string, unknown>> = [];
  try {
    await (runWebSearch as any)._handler({
      runQuery: async () => null,
      runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
        searchMutations.push(args);
        if (Object.prototype.hasOwnProperty.call(args, "jobId") && args.status === "streaming") {
          return undefined;
        }
        if (Object.prototype.hasOwnProperty.call(args, "jobId") && args.status === "failed") {
          return undefined;
        }
        return false;
      },
      scheduler: {
        runAfter: async () => undefined,
      },
    }, {
      jobId: "job_1",
      sessionId: "session_1",
      chatId: "chat_1",
      userMessageId: "msg_user",
      assistantMessageId: "msg_assistant",
      userId: "user_1",
      query: "AI pricing",
      complexity: 1,
      modelId: "openai/gpt-5.2",
      expandMultiModelGroups: false,
    });

    assert.ok(searchMutations.some((args) => args.status === "streaming"));
    assert.ok(searchMutations.some((args) => args.status === "failed"));

    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_PRICE_ID;
    delete process.env.WEB_APP_URL;
    await assert.rejects(
      (createCheckoutSession as any)._handler({ auth: buildAuth() }, {}),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        return String(error).includes("CONFIG_ERROR");
      },
    );

    process.env.STRIPE_SECRET_KEY = "sk_test";
    process.env.STRIPE_PRICE_ID = "price_123";
    process.env.WEB_APP_URL = "https://app.example";
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({ url: "https://checkout.stripe.com/session" }),
    })) as any;

    const checkout = await (createCheckoutSession as any)._handler({ auth: buildAuth() }, {});
    assert.deepEqual(checkout, { url: "https://checkout.stripe.com/session" });
  } finally {
    globalThis.fetch = originalFetch;
    process.env.STRIPE_SECRET_KEY = originalSecretKey;
    process.env.STRIPE_PRICE_ID = originalPriceId;
    process.env.WEB_APP_URL = originalWebAppUrl;
  }
});
