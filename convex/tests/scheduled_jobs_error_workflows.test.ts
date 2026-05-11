import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";
import {
  createScheduledExecutionTurn,
  updateJobInternal,
} from "../scheduledJobs/mutations";

function queryChain(result: { first?: unknown; collect?: unknown[] }) {
  return {
    withIndex: (_index: string, apply?: (q: any) => unknown) => {
      apply?.({ eq: () => ({ eq: () => ({}) }) });
      return {
        filter: () => ({ first: async () => result.first ?? null }),
        first: async () => result.first ?? null,
        collect: async () => result.collect ?? [],
      };
    },
  };
}

test("scheduled update rejects unauthorized target folders and stale execution turns", async () => {
  await assert.rejects(
    (updateJobInternal as any)._handler({
      db: {
        get: async (id: string) => id === "job_1"
          ? { _id: "job_1", userId: "user_1", prompt: "p", modelId: "m", recurrence: { type: "manual" }, status: "active" }
          : { _id: id, userId: "other" },
        query: () => queryChain({ first: { supportsTools: true } }),
      },
      scheduler: {},
    }, { jobId: "job_1", userId: "user_1", targetFolderId: "folder_bad" }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "NOT_FOUND",
  );

  await assert.rejects(
    (createScheduledExecutionTurn as any)._handler({
      db: {
        get: async () => ({ _id: "job_1", activeExecutionId: "other", activeExecutionChatId: "chat_1" }),
      },
    }, {
      jobId: "job_1",
      chatId: "chat_1",
      userId: "user_1",
      executionId: "exec_1",
      stepIndex: 0,
      stepTitle: "Step",
      content: "Run",
      modelId: "model",
    }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "EXECUTION_STALE",
  );
});

test("scheduled update validates step bounds, personas, knowledge-base ownership, and recurrence status branches", async () => {
  const baseJob = {
    _id: "job_1",
    userId: "user_1",
    prompt: "Existing prompt",
    modelId: "model/tools",
    recurrence: { type: "daily", hourUTC: 8, minuteUTC: 0 },
    timezone: "UTC",
    status: "active",
    scheduledFunctionId: "scheduled_old",
    steps: [{ prompt: "Existing prompt", modelId: "model/tools" }],
  };

  const makeCtx = (overrides: {
    persona?: Record<string, unknown> | null;
    generatedFile?: Record<string, unknown> | null;
    attachment?: Record<string, unknown> | null;
    media?: Record<string, unknown> | null;
  } = {}) => {
    const patches: Array<Record<string, unknown>> = [];
    const cancelled: string[] = [];
    const scheduled: Array<Record<string, unknown>> = [];
    return {
      patches,
      cancelled,
      scheduled,
      ctx: {
        db: {
          get: async (id: string) => {
            if (id === "job_1") return baseJob;
            if (id === "persona_1") return overrides.persona ?? { _id: "persona_1", userId: "user_1", modelId: "model/tools" };
            return null;
          },
          query: (table: string) => {
            if (table === "generatedFiles") return queryChain({ first: overrides.generatedFile ?? null });
            if (table === "fileAttachments") return queryChain({ first: overrides.attachment ?? null });
            if (table === "generatedMedia") return queryChain({ first: overrides.media ?? null });
            if (table === "cachedModels") return queryChain({ first: { supportsTools: true } });
            return queryChain({});
          },
          patch: async (_id: string, patch: Record<string, unknown>) => {
            patches.push(patch);
          },
        },
        scheduler: {
          cancel: async (id: string) => {
            cancelled.push(id);
            throw new Error("already executed");
          },
          runAt: async (_when: number, _ref: unknown, payload: Record<string, unknown>) => {
            scheduled.push(payload);
            return "scheduled_new";
          },
        },
      } as any,
    };
  };

  for (const steps of [
    Array.from({ length: 6 }, (_, index) => ({ prompt: `step ${index}`, modelId: "model/tools" })),
    [{ prompt: "   ", modelId: "model/tools" }],
    [{ prompt: "Prompt", modelId: "   " }],
  ]) {
    const { ctx } = makeCtx();
    await assert.rejects(
      (updateJobInternal as any)._handler(ctx, { jobId: "job_1", userId: "user_1", steps }),
      (error: unknown) => error instanceof ConvexError && error.data?.code === "VALIDATION",
    );
  }

  await assert.rejects(
    (updateJobInternal as any)._handler(makeCtx({ persona: { _id: "persona_1", userId: "other" } }).ctx, {
      jobId: "job_1",
      userId: "user_1",
      steps: [{ prompt: "Prompt", modelId: "model/tools", personaId: "persona_1" }],
    }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "NOT_FOUND",
  );

  await assert.rejects(
    (updateJobInternal as any)._handler(makeCtx().ctx, {
      jobId: "job_1",
      userId: "user_1",
      steps: [{ prompt: "Prompt", modelId: "model/tools", knowledgeBaseFileIds: ["storage_1"] }],
    }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "NOT_FOUND",
  );

  const mediaCtx = makeCtx({ media: { _id: "media_1", userId: "user_1", storageId: "storage_1" } });
  await (updateJobInternal as any)._handler(mediaCtx.ctx, {
    jobId: "job_1",
    userId: "user_1",
    targetFolderId: null,
    status: "paused",
    recurrence: { type: "daily", hourUTC: 9, minuteUTC: 0 },
    steps: [{ prompt: "Prompt", modelId: "model/tools", knowledgeBaseFileIds: ["storage_1"] }],
  });
  assert.deepEqual(mediaCtx.cancelled, ["scheduled_old"]);
  assert.deepEqual(mediaCtx.scheduled, []);
  assert.equal(mediaCtx.patches[0]?.targetFolderId, undefined);
  assert.equal(mediaCtx.patches[0]?.nextRunAt, undefined);
  assert.equal(mediaCtx.patches[0]?.scheduledFunctionId, undefined);

  for (const recurrence of [
    { type: "interval", minutes: 30 },
    { type: "weekly", dayOfWeek: 1, hourUTC: 8, minuteUTC: 0 },
    { type: "cron", expression: "0 * * * *" },
  ]) {
    const recurrenceCtx = makeCtx();
    await (updateJobInternal as any)._handler(recurrenceCtx.ctx, {
      jobId: "job_1",
      userId: "user_1",
      status: "active",
      recurrence,
      steps: [{ prompt: "Prompt", modelId: "model/tools" }],
    });
    assert.deepEqual(recurrenceCtx.cancelled, ["scheduled_old"]);
  }
});
