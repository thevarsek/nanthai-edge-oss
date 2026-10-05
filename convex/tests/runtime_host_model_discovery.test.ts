import assert from "node:assert/strict";
import test from "node:test";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";
import {
  getMyRequestHandler,
  requestModelsHandler,
} from "../runtime_host/model_discovery";
import { expireModelDiscoveryRequestHandler } from "../runtime_host/model_discovery_expiry";
import {
  claimPendingForHostHandler,
  completeForHostHandler,
} from "../runtime_host/model_discovery_host";
import { sha256Hex } from "../runtime_host/security";

type Row = Record<string, any>;
type Rows = Record<string, Row[]>;

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

const host = {
  deviceId: "device-1",
  credentialId: "credential-1",
  credential: "secret-1",
  presenceSessionId: "presence-session-1",
};

async function fixture() {
  const rows: Rows = {
    runtimeDevices: [{
      _id: "runtime-device-1",
      userId: "user-1",
      deviceId: "device-1",
      displayName: "Dino MacBook",
      status: "active",
      currentPresenceId: "presence-1",
    }],
    runtimeDeviceCredentials: [{
      _id: "credential-row-1",
      userId: "user-1",
      runtimeDeviceId: "runtime-device-1",
      deviceId: "device-1",
      credentialId: "credential-1",
      credentialHash: await sha256Hex("secret-1"),
      status: "active",
    }],
    runtimeDevicePresences: [{
      _id: "presence-1",
      userId: "user-1",
      runtimeDeviceId: "runtime-device-1",
      deviceId: "device-1",
      credentialId: "credential-1",
      presenceSessionId: "presence-session-1",
      status: "online",
      expiresAt: 1_000_000,
      adapters: [{
        adapterId: "codex",
        adapterVersion: "0.147.0",
        authState: "ready",
        capabilities: structuredClone(capabilities),
      }],
    }],
    runtimeModelDiscoveryRequests: [],
    runtimeModelDiscoveryModels: [],
  };
  const state = createStatefulMockCtx(rows);
  supportDiscoveryIndex(state as unknown as MutationCtx, rows.runtimeModelDiscoveryRequests);
  return { rows, state, ctx: state as unknown as MutationCtx };
}

test("live model discovery is claimed by the exact presence and expires without a catalog", async () => {
  const { rows, state, ctx } = await fixture();
  const created = await requestModelsHandler(ctx, {
    userId: "user-1",
    deviceId: "device-1",
    adapterId: "codex",
    now: 1_000,
  });
  assert.equal(created.expiresAt, 121_000);
  assert.equal(rows.runtimeModelDiscoveryRequests[0].status, "pending");
  assert.equal(state.scheduled.length, 1);

  const claimed = await claimPendingForHostHandler(ctx, { ...host, now: 1_100 });
  assert.deepEqual(claimed, [{
    requestId: created.requestId,
    adapterId: "codex",
    expiresAt: 121_000,
  }]);
  assert.equal(rows.runtimeModelDiscoveryRequests[0].status, "claimed");

  const models = [{
    provider: "openai",
    modelId: "gpt-5.6-codex",
    displayName: "GPT-5.6 Codex",
    availability: "available" as const,
    unavailableReason: null,
    inputModalities: ["text", "image"],
    supportsTools: true,
    supportsReasoning: true,
  }];
  assert.equal(await completeForHostHandler(ctx, {
    ...host,
    requestId: created.requestId,
    status: "completed",
    models,
    now: 1_200,
  }), true);
  assert.equal(rows.runtimeModelDiscoveryModels.length, 1);
  assert.equal(rows.runtimeModelDiscoveryRequests[0].expiresAt, 121_200);

  const result = await getMyRequestHandler(ctx as unknown as QueryCtx, {
    userId: "user-1",
    requestId: created.requestId,
  });
  assert.equal(result?.status, "completed");
  assert.deepEqual(result?.models, models);
  assert.equal(await getMyRequestHandler(ctx as unknown as QueryCtx, {
    userId: "another-user",
    requestId: created.requestId,
  }), null);
  assert.equal(await completeForHostHandler(ctx, {
    ...host,
    requestId: created.requestId,
    status: "completed",
    models,
    now: 1_300,
  }), false);

  assert.equal(await expireModelDiscoveryRequestHandler(ctx, {
    requestId: created.requestId,
    expectedExpiresAt: 121_000,
    now: 121_000,
  }), false);
  assert.equal(await expireModelDiscoveryRequestHandler(ctx, {
    requestId: created.requestId,
    expectedExpiresAt: 121_200,
    now: 121_200,
  }), true);
  assert.deepEqual(rows.runtimeModelDiscoveryModels, []);
  assert.deepEqual(rows.runtimeModelDiscoveryRequests, []);
});

test("request and host claim revalidate current adapter model-list capability", async () => {
  const { rows, ctx } = await fixture();
  await assert.rejects(requestModelsHandler(ctx, {
    userId: "another-user",
    deviceId: "device-1",
    adapterId: "codex",
    now: 1_000,
  }), /paired machine is unavailable/i);
  await assert.rejects(requestModelsHandler(ctx, {
    userId: "user-1",
    deviceId: "device-1",
    adapterId: "missing",
    now: 1_000,
  }), /cannot currently list/i);

  const created = await requestModelsHandler(ctx, {
    userId: "user-1",
    deviceId: "device-1",
    adapterId: "codex",
    now: 1_000,
  });
  const adapter = rows.runtimeDevicePresences[0].adapters[0];
  adapter.capabilities.operations.listModels = false;
  assert.deepEqual(
    await claimPendingForHostHandler(ctx, { ...host, now: 1_100 }),
    [],
  );
  assert.equal(rows.runtimeModelDiscoveryRequests[0].status, "failed");
  assert.equal(
    rows.runtimeModelDiscoveryRequests[0].errorCode,
    "RUNTIME_ADAPTER_UNAVAILABLE",
  );
  assert.equal(await getMyRequestHandler(ctx as unknown as QueryCtx, {
    userId: "user-1",
    requestId: created.requestId,
  }).then((result) => result?.models.length), 0);
});

test("unanswered discovery exposes expiry briefly before deleting its rows", async () => {
  const { rows, ctx } = await fixture();
  const created = await requestModelsHandler(ctx, {
    userId: "user-1", deviceId: "device-1", adapterId: "codex", now: 1_000,
  });
  assert.equal(await expireModelDiscoveryRequestHandler(ctx, {
    requestId: created.requestId, expectedExpiresAt: 121_000, now: 121_000,
  }), true);
  const expired = await getMyRequestHandler(ctx as unknown as QueryCtx, {
    userId: "user-1", requestId: created.requestId,
  });
  assert.equal(expired?.status, "expired");
  assert.equal(expired?.error?.code, "REQUEST_EXPIRED");
  assert.equal(rows.runtimeModelDiscoveryRequests[0].expiresAt, 181_000);
  assert.equal(await expireModelDiscoveryRequestHandler(ctx, {
    requestId: created.requestId, expectedExpiresAt: 181_000, now: 181_000,
  }), true);
  assert.deepEqual(rows.runtimeModelDiscoveryRequests, []);
});

test("claimed results reject another presence and conflicting terminal replay", async () => {
  const { rows, ctx } = await fixture();
  const created = await requestModelsHandler(ctx, {
    userId: "user-1",
    deviceId: "device-1",
    adapterId: "codex",
    now: 1_000,
  });
  await claimPendingForHostHandler(ctx, { ...host, now: 1_100 });
  await assert.rejects(completeForHostHandler(ctx, {
    ...host,
    presenceSessionId: "another-presence",
    requestId: created.requestId,
    status: "failed",
    errorCode: "LIST_FAILED",
    errorMessage: "Codex could not list models",
    now: 1_200,
  }), /presence has expired/i);
  assert.equal(await completeForHostHandler(ctx, {
    ...host,
    requestId: created.requestId,
    status: "failed",
    errorCode: "LIST_FAILED",
    errorMessage: "Codex could not list models",
    now: 1_200,
  }), true);
  await assert.rejects(completeForHostHandler(ctx, {
    ...host,
    requestId: created.requestId,
    status: "failed",
    errorCode: "DIFFERENT_FAILURE",
    errorMessage: "A different result",
    now: 1_300,
  }), /another result/i);
  assert.equal(rows.runtimeModelDiscoveryRequests[0].status, "failed");
});

function supportDiscoveryIndex(ctx: MutationCtx, requests: Row[]): void {
  type Builder = { eq: (field: string, value: unknown) => Builder };
  const database = ctx.db as unknown as { query: (table: string) => any };
  const fallback = database.query.bind(database);
  database.query = (table: string) => {
    if (table !== "runtimeModelDiscoveryRequests") return fallback(table);
    const filters: Array<[string, unknown]> = [];
    let descending = false;
    const builder: Builder = {
      eq: (field, value) => {
        filters.push([field, value]);
        return builder;
      },
    };
    const matching = () => requests.filter((row) =>
      filters.every(([field, value]) => row[field] === value)
    );
    const chain = {
      withIndex: (_name: string, build?: (query: Builder) => unknown) => {
        build?.(builder);
        return chain;
      },
      order: (direction: "asc" | "desc") => {
        descending = direction === "desc";
        return chain;
      },
      take: async (count: number) => {
        const values = matching();
        return (descending ? values.reverse() : values).slice(0, count);
      },
    };
    return chain;
  };
}
