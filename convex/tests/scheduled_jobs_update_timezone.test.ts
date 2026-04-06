import assert from "node:assert/strict";
import test from "node:test";

import { updateJob } from "../scheduledJobs/mutations";

test("updateJob reschedules when only timezone changes", async () => {
  const cancelled: string[] = [];
  const scheduled: Array<{ when: number; args: Record<string, unknown> }> = [];
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];

  const job = {
    _id: "job_1",
    userId: "user_1",
    name: "Morning summary",
    prompt: "Prompt",
    modelId: "openai/gpt-5",
    personaId: undefined,
    enabledIntegrations: undefined,
    webSearchEnabled: false,
    searchMode: "none",
    searchComplexity: undefined,
    knowledgeBaseFileIds: undefined,
    includeReasoning: false,
    reasoningEffort: undefined,
    steps: undefined,
    recurrence: { type: "daily", hourUTC: 8, minuteUTC: 0 },
    timezone: "Europe/London",
    targetFolderId: undefined,
    status: "active",
    scheduledFunctionId: "scheduled_1",
  };

  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    db: {
      get: async (id: string) => {
        if (id === "job_1") return job;
        return null;
      },
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
      query: (table: string) => {
        if (table === "purchaseEntitlements") {
          return {
            withIndex: () => ({
              first: async () => ({ userId: "user_1", status: "active" }),
            }),
          };
        }
        if (table === "userPreferences") {
          return {
            withIndex: () => ({
              first: async () => ({ userId: "user_1" }),
            }),
          };
        }
        if (table === "cachedModels") {
          return {
            withIndex: (_index: string, apply: (query: any) => any) => {
              let selectedModelId = "";
              apply({
                eq: (_field: string, modelId: string) => {
                  selectedModelId = modelId;
                  return {};
                },
              });
              return {
                first: async () => (selectedModelId === "openai/gpt-5" ? { supportsTools: true } : null),
              };
            },
          };
        }
        throw new Error(`Unexpected table query: ${table}`);
      },
    },
    scheduler: {
      cancel: async (id: string) => {
        cancelled.push(id);
      },
      runAt: async (when: number, _ref: unknown, args: Record<string, unknown>) => {
        scheduled.push({ when, args });
        return "scheduled_2";
      },
    },
  } as any;

  await (updateJob as any)._handler(ctx, {
    jobId: "job_1",
    timezone: "America/New_York",
  });

  assert.deepEqual(cancelled, ["scheduled_1"]);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].args.jobId, "job_1");
  assert.equal(patches.length, 1);
  assert.equal(patches[0].id, "job_1");
  assert.equal(patches[0].value.timezone, "America/New_York");
  assert.equal(patches[0].value.scheduledFunctionId, "scheduled_2");
  assert.ok(typeof patches[0].value.nextRunAt === "number");
});
