import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";

import { createJobInternal } from "../scheduledJobs/mutations";

function queryChain(first: unknown = null) {
  return {
    withIndex: (_index: string, apply?: (q: any) => unknown) => {
      apply?.({ eq: () => ({ eq: () => ({}) }) });
      return { first: async () => first };
    },
  };
}

function buildCtx(options: {
  folder?: Record<string, unknown> | null;
  persona?: Record<string, unknown> | null;
  generatedFile?: Record<string, unknown> | null;
  attachment?: Record<string, unknown> | null;
  media?: Record<string, unknown> | null;
  model?: Record<string, unknown> | null;
} = {}) {
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const scheduled: Array<Record<string, unknown>> = [];

  return {
    inserts,
    patches,
    scheduled,
    ctx: {
      db: {
        get: async (id: string) => {
          if (id === "folder_1") return options.folder ?? { _id: "folder_1", userId: "user_1" };
          if (id === "persona_1") return options.persona ?? { _id: "persona_1", userId: "user_1" };
          return null;
        },
        query: (table: string) => {
          if (table === "generatedFiles") return queryChain(options.generatedFile ?? null);
          if (table === "fileAttachments") return queryChain(options.attachment ?? null);
          if (table === "generatedMedia") return queryChain(options.media ?? null);
          if (table === "cachedModels") return queryChain(options.model ?? { _id: "model_1", supportsTools: true });
          return queryChain();
        },
        insert: async (table: string, value: Record<string, unknown>) => {
          inserts.push({ table, value });
          return `${table}_1`;
        },
        patch: async (id: string, value: Record<string, unknown>) => {
          patches.push({ id, value });
        },
      },
      scheduler: {
        runAt: async (_when: number, _ref: unknown, args: Record<string, unknown>) => {
          scheduled.push(args);
          return "scheduled_1";
        },
      },
    } as any,
  };
}

test("createJobInternal validates AI-created job inputs before inserting or scheduling", async () => {
  for (const args of [
    { name: "Missing step", recurrence: { type: "manual" } },
    {
      name: "Bad recurrence",
      prompt: "Run",
      modelId: "model/plain",
      recurrence: { type: "interval", minutes: 0 },
    },
    {
      name: "   ",
      prompt: "Run",
      modelId: "model/plain",
      recurrence: { type: "manual" },
    },
    {
      name: "x".repeat(201),
      prompt: "Run",
      modelId: "model/plain",
      recurrence: { type: "manual" },
    },
  ]) {
    const { ctx, inserts, scheduled } = buildCtx();
    await assert.rejects(
      (createJobInternal as any)._handler(ctx, { userId: "user_1", ...args }),
      (error: unknown) => error instanceof ConvexError,
    );
    assert.deepEqual(inserts, []);
    assert.deepEqual(scheduled, []);
  }

  await assert.rejects(
    (createJobInternal as any)._handler(buildCtx({
      folder: { _id: "folder_1", userId: "other_user" },
    }).ctx, {
      userId: "user_1",
      name: "Folder scoped job",
      prompt: "Run",
      modelId: "model/plain",
      recurrence: { type: "manual" },
      targetFolderId: "folder_1",
    }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "NOT_FOUND",
  );
});

test("createJobInternal normalizes multi-step jobs, validates owned KB files, and schedules non-manual runs", async () => {
  const state = buildCtx({
    persona: { _id: "persona_1", userId: "user_1", modelId: "model/plain" },
    attachment: { _id: "attachment_1", userId: "user_1", storageId: "storage_1" },
    model: { _id: "model_1", supportsTools: false },
  });

  const jobId = await (createJobInternal as any)._handler(state.ctx, {
    userId: "user_1",
    name: "  AI Digest  ",
    targetFolderId: "folder_1",
    recurrence: { type: "interval", minutes: 30 },
    timezone: "UTC",
    steps: [
      {
        prompt: "Research updates",
        modelId: "model/plain",
        personaId: "persona_1",
        enabledIntegrations: ["gmail"],
        turnSkillOverrides: [{ skillId: "skill_1", state: "always" }],
        turnIntegrationOverrides: [{ integrationId: "gmail", enabled: true }],
        webSearchEnabled: true,
        searchMode: "research",
        searchComplexity: 9,
        knowledgeBaseFileIds: ["storage_1"],
      },
      {
        prompt: "Summarize for the user",
        modelId: "model/plain",
        searchMode: "basic",
        searchComplexity: 0,
      },
    ],
  });

  assert.equal(jobId, "scheduledJobs_1");
  assert.equal(state.inserts[0]?.table, "scheduledJobs");
  assert.equal(state.inserts[0]?.value.name, "AI Digest");
  assert.equal(state.inserts[0]?.value.createdBy, "ai");
  assert.equal(state.inserts[0]?.value.targetFolderId, "folder_1");
  assert.deepEqual(state.inserts[0]?.value.enabledIntegrations, []);
  assert.deepEqual(state.inserts[0]?.value.turnSkillOverrides, []);
  assert.deepEqual(state.inserts[0]?.value.turnIntegrationOverrides, []);
  const steps = state.inserts[0]?.value.steps as Array<Record<string, unknown>>;
  assert.equal(steps[0]?.searchComplexity, 3);
  assert.equal(steps[1]?.searchComplexity, 1);
  assert.equal(steps[0]?.searchMode, "research");
  assert.equal(steps[1]?.searchMode, "basic");
  assert.equal(state.scheduled[0]?.jobId, "scheduledJobs_1");
  assert.match(String(state.scheduled[0]?.occurrenceId), /^scheduled:scheduledJobs_1:/);
  assert.equal(state.patches[0]?.id, "scheduledJobs_1");
  assert.equal(state.patches[0]?.value.scheduledFunctionId, "scheduled_1");
  assert.match(
    String(state.patches[0]?.value.nextScheduledOccurrenceId),
    /^scheduled:scheduledJobs_1:/,
  );
});
