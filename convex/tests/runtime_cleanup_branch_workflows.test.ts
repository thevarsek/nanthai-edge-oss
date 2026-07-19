import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanStaleSandboxSessions,
  staleSandboxRetryDelayMs,
} from "../runtime/cleanup";

test("cleanStaleSandboxSessions returns early when there are no stale sessions", async () => {
  const mutations: Array<Record<string, unknown>> = [];
  await (cleanStaleSandboxSessions as any)._handler({
    runQuery: async () => ({ sessions: [], hitBatchLimit: false }),
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => mutations.push(args),
    scheduler: { runAfter: async () => "scheduled" },
  });

  assert.deepEqual(mutations, []);
});

test("cleanStaleSandboxSessions retains unconfirmed provider VMs for reconciliation", async () => {
  const mutations: Array<Record<string, unknown>> = [];
  const scheduled: Array<{ delay: number; args: Record<string, unknown> }> = [];

  await (cleanStaleSandboxSessions as any)._handler({
    runQuery: async () => ({
      hitBatchLimit: true,
      sessions: [
        { id: "session_1", hasVm: true, providerSandboxId: "sbx_1" },
        { id: "session_2", hasVm: false, providerSandboxId: null },
      ],
    }),
    runAction: async () => false,
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => mutations.push(args),
    scheduler: {
      runAfter: async (delay: number, _ref: unknown, args: Record<string, unknown>) => {
        scheduled.push({ delay, args });
        return "scheduled";
      },
    },
  });

  assert.deepEqual(mutations[0].sessionIds, ["session_2"]);
  assert.equal(scheduled.length, 1);
  assert.deepEqual(scheduled[0], { delay: 30_000, args: { failureAttempt: 1 } });
});

test("cleanStaleSandboxSessions bounds persistent stop retries then relies on cron", async () => {
  const scheduled: unknown[] = [];
  await (cleanStaleSandboxSessions as any)._handler({
    runQuery: async () => ({
      hitBatchLimit: false,
      sessions: [{ id: "session_1", hasVm: true, providerSandboxId: "sbx_1" }],
    }),
    runAction: async () => false,
    runMutation: async () => undefined,
    scheduler: { runAfter: async (...args: unknown[]) => scheduled.push(args) },
  }, { failureAttempt: 5 });

  assert.deepEqual(scheduled, []);
  assert.equal(staleSandboxRetryDelayMs(0), 30_000);
  assert.equal(staleSandboxRetryDelayMs(10), 15 * 60 * 1000);
});

test("cleanStaleSandboxSessions releases confirmed VMs and dispositions ID-less rows", async () => {
  const mutations: Array<Record<string, unknown>> = [];

  await (cleanStaleSandboxSessions as any)._handler({
    runQuery: async () => ({
      hitBatchLimit: false,
      sessions: [
        { id: "session_live", hasVm: true, providerSandboxId: "sbx_live" },
        { id: "session_missing", hasVm: true, providerSandboxId: "sbx_missing" },
        { id: "session_no_id", hasVm: true, providerSandboxId: "" },
      ],
    }),
    runAction: async (_ref: unknown, args: { providerSandboxId: string }) =>
      args.providerSandboxId !== "sbx_missing",
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => mutations.push(args),
    scheduler: { runAfter: async () => "scheduled" },
  });

  assert.deepEqual(mutations[0].sessionIds, ["session_no_id", "session_live"]);
});
