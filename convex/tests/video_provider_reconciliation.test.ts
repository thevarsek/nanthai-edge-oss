import assert from "node:assert/strict";
import test from "node:test";

import { cancelVideoForExecutionRun } from "../chat/video_cleanup";
import { reconcileCancelledProvider } from "../chat/video_reconciliation";
import { settleVideoGenerationHandler } from "../chat/video_mutation_handlers";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";

test("video cancellation retains provider ownership as a pending external component", async () => {
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  const ctx = {
    db: {
      get: async (id: string) => id === "run_1"
        ? { _id: "run_1", domainType: "video_generation", domainId: "message_1", activeAttemptId: "attempt_1", userId: "user_1" }
        : null,
      query: (table: string) => ({
        withIndex: () => ({
          order: () => ({ first: async () => table === "videoJobs" ? {
            _id: "video_1", status: "in_progress", providerTerminalAt: undefined,
          } : null }),
          first: async () => table === "videoOutputUploads" ? null : null,
          unique: async () => null,
        }),
      }),
      patch: async (id: string, value: Record<string, unknown>) => patches.push({ id, value }),
      insert: async (table: string, value: Record<string, unknown>) => {
        inserts.push({ table, value });
        return "component_1";
      },
      delete: async () => undefined,
    },
    storage: { delete: async () => undefined },
  } as any;

  await cancelVideoForExecutionRun(ctx, "run_1" as any);

  assert.equal(patches[0]?.id, "video_1");
  assert.equal(patches[0]?.value.status, "failed");
  assert.equal(typeof patches[0]?.value.cancellationRequestedAt, "number");
  assert.equal(inserts[0]?.table, "executionComponentRefs");
  assert.equal(inserts[0]?.value.adapterId, "external-cloud");
  assert.equal(inserts[0]?.value.operationId, "openrouter-video:video_1");
  assert.equal(inserts[0]?.value.status, "cancel_requested");
});

test("provider reconciliation releases ownership only after provider terminal state", async () => {
  const originalFetch = globalThis.fetch;
  const mutations: Array<Record<string, unknown>> = [];
  let providerStatus: "in_progress" | "completed" = "in_progress";
  globalThis.fetch = (async () => new Response(JSON.stringify({
    id: "provider_1", polling_url: "https://poll", status: providerStatus,
  }), { status: 200 })) as typeof fetch;
  const ctx = {
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.videoJobId) return {
        _id: "video_1", userId: "user_1", pollingUrl: "https://poll",
      };
      if (args.userId) return "sk-test";
      return null;
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => mutations.push(args),
  } as any;

  try {
    assert.equal(await (reconcileCancelledProvider as any)._handler(ctx, { videoJobId: "video_1" }), false);
    assert.deepEqual(mutations, []);
    providerStatus = "completed";
    assert.equal(await (reconcileCancelledProvider as any)._handler(ctx, { videoJobId: "video_1" }), true);
    assert.deepEqual(mutations, [{ videoJobId: "video_1", status: "completed" }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("local video settlement does not claim provider quiescence", async () => {
  const rows = {
    videoJobs: [{ _id: "video_1", status: "in_progress" }],
    generationJobs: [{
      _id: "job_1",
      messageId: "message_1",
      chatId: "chat_1",
      userId: "user_1",
      status: "streaming",
    }],
    generationContinuations: [],
    streamingMessages: [],
    messages: [{
      _id: "message_1",
      chatId: "chat_1",
      userId: "user_1",
      role: "assistant",
      content: "",
      status: "streaming",
      parentMessageIds: [],
    }],
    usageRecords: [],
    cachedModels: [],
  };
  const ctx = createStatefulMockCtx(rows);

  await settleVideoGenerationHandler(ctx as never, {
    videoJobId: "video_1",
    messageId: "message_1",
    jobId: "job_1",
    chatId: "chat_1",
    content: "Error: local timeout",
    status: "failed",
    error: "local timeout",
    userId: "user_1",
  } as any);

  const videoPatch = ctx.events.find((entry) =>
    entry.op === "patch" && entry.id === "video_1"
  )?.value as Record<string, unknown> | undefined;
  assert.equal(videoPatch?.status, "failed");
  assert.equal("providerTerminalAt" in (videoPatch ?? {}), false);
  assert.equal("providerTerminalStatus" in (videoPatch ?? {}), false);
});
