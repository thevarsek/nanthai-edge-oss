import assert from "node:assert/strict";
import test from "node:test";

import {
  claimRequestSlot,
  releaseRequestSlot,
} from "../integrations/request_gates";

function makeCtx(initialGate: Record<string, unknown> | null = null) {
  let gate = initialGate ? { ...initialGate } : null;
  let insertCount = 0;

  return {
    ctx: {
      db: {
        query: (_table: string) => ({
          withIndex: (
            _index: string,
            _builder: (query: {
              eq: (field: string, value: unknown) => unknown;
            }) => unknown,
          ) => ({
            unique: async () => gate,
          }),
        }),
        insert: async (_table: string, value: Record<string, unknown>) => {
          insertCount += 1;
          gate = { _id: `gate_${insertCount}`, ...value };
          return gate._id;
        },
        patch: async (_id: string, value: Record<string, unknown>) => {
          gate = gate ? { ...gate, ...value } : { _id, ...value };
        },
      },
    } as any,
    getGate: () => gate,
  };
}

test("claimRequestSlot inserts and grants the first slot", async () => {
  const { ctx, getGate } = makeCtx();

  const result = await (claimRequestSlot as any)._handler(ctx, {
    userId: "user_1",
    provider: "notion",
    requestId: "req_1",
    now: 1_000,
    leaseMs: 500,
  });

  assert.deepEqual(result, { granted: true, waitMs: 0 });
  assert.deepEqual(getGate(), {
    _id: "gate_1",
    userId: "user_1",
    provider: "notion",
    activeRequestId: "req_1",
    activeLeaseExpiresAt: 1_500,
    nextAllowedAt: 1_000,
    lastRequestStartedAt: 1_000,
    updatedAt: 1_000,
  });
});

test("claimRequestSlot blocks another active holder until the lease expires", async () => {
  const { ctx } = makeCtx({
    _id: "gate_1",
    userId: "user_1",
    provider: "notion",
    activeRequestId: "req_1",
    activeLeaseExpiresAt: 1_500,
    nextAllowedAt: 1_000,
    updatedAt: 1_000,
  });

  const result = await (claimRequestSlot as any)._handler(ctx, {
    userId: "user_1",
    provider: "notion",
    requestId: "req_2",
    now: 1_100,
    leaseMs: 500,
  });

  assert.deepEqual(result, { granted: false, waitMs: 400 });
});

test("releaseRequestSlot clears the active holder and enforces nextAllowedAt", async () => {
  const { ctx, getGate } = makeCtx({
    _id: "gate_1",
    userId: "user_1",
    provider: "notion",
    activeRequestId: "req_1",
    activeLeaseExpiresAt: 1_500,
    nextAllowedAt: 1_000,
    updatedAt: 1_000,
  });

  await (releaseRequestSlot as any)._handler(ctx, {
    userId: "user_1",
    provider: "notion",
    requestId: "req_1",
    now: 1_200,
    nextAllowedAt: 1_700,
    lastResponseStatus: 429,
  });

  assert.deepEqual(getGate(), {
    _id: "gate_1",
    userId: "user_1",
    provider: "notion",
    activeRequestId: undefined,
    activeLeaseExpiresAt: undefined,
    nextAllowedAt: 1_700,
    lastRequestFinishedAt: 1_200,
    lastResponseStatus: 429,
    updatedAt: 1_200,
  });

  const blocked = await (claimRequestSlot as any)._handler(ctx, {
    userId: "user_1",
    provider: "notion",
    requestId: "req_2",
    now: 1_300,
    leaseMs: 500,
  });
  const granted = await (claimRequestSlot as any)._handler(ctx, {
    userId: "user_1",
    provider: "notion",
    requestId: "req_2",
    now: 1_701,
    leaseMs: 500,
  });

  assert.deepEqual(blocked, { granted: false, waitMs: 400 });
  assert.deepEqual(granted, { granted: true, waitMs: 0 });
});

test("releaseRequestSlot does not clear a newer active holder", async () => {
  const { ctx, getGate } = makeCtx({
    _id: "gate_1",
    userId: "user_1",
    provider: "notion",
    activeRequestId: "req_2",
    activeLeaseExpiresAt: 2_000,
    nextAllowedAt: 1_000,
    updatedAt: 1_000,
  });

  await (releaseRequestSlot as any)._handler(ctx, {
    userId: "user_1",
    provider: "notion",
    requestId: "req_1",
    now: 1_250,
    nextAllowedAt: 1_600,
    lastResponseStatus: 503,
  });

  assert.equal(getGate()?.activeRequestId, "req_2");
  assert.equal(getGate()?.activeLeaseExpiresAt, 2_000);
  assert.equal(getGate()?.nextAllowedAt, 1_600);
  assert.equal(getGate()?.lastResponseStatus, 503);
});

test("claimRequestSlot can proceed once a stale lease expires", async () => {
  const { ctx } = makeCtx({
    _id: "gate_1",
    userId: "user_1",
    provider: "notion",
    activeRequestId: "req_1",
    activeLeaseExpiresAt: 1_000,
    nextAllowedAt: 900,
    updatedAt: 900,
  });

  const result = await (claimRequestSlot as any)._handler(ctx, {
    userId: "user_1",
    provider: "notion",
    requestId: "req_2",
    now: 1_100,
    leaseMs: 500,
  });

  assert.deepEqual(result, { granted: true, waitMs: 0 });
});
