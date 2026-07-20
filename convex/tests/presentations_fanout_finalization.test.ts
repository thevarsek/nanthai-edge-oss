import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionName } from "convex/server";
import { runDeferredPresentationSnapshotRef } from "../presentations/deferred_workflow_refs";
import {
  finalizePresentationFanoutHandler,
  recoverPresentationFinalizerCompletion,
} from "../presentations/generation_finalization_handler";
import { failPresentationFanoutHandler } from "../presentations/generation_studio_mutation_handlers";
import { durableWorkflow } from "../execution/components";

type Row = Record<string, unknown> & { _id: string };
const executionIdentity = {
  executionAttemptId: "attempt_run_1" as never,
  executionFence: 1,
};

function slideHtml(id: string, text: string): string {
  return `<section class="slide-root" style="position:relative;width:1280px;height:720px;overflow:hidden"><h1 data-element-id="${id}" style="position:absolute;left:80px;top:80px;width:900px;height:120px;font-size:42px;line-height:52px">${text}</h1></section>`;
}

function severeOverlapSlideHtml(): string {
  return '<section class="slide-root" style="position:relative;width:1280px;height:720px;overflow:hidden">' +
    '<h1 data-element-id="title" style="position:absolute;left:80px;top:100px;width:700px;height:120px;font-size:40px;line-height:48px">The same words occupy this line</h1>' +
    '<p data-element-id="subtitle" style="position:absolute;left:80px;top:120px;width:700px;height:80px;font-size:40px;line-height:48px">More words occupy the same line</p></section>';
}

function state(initial: Record<string, Row[]>) {
  const tables = new Map(Object.entries(initial));
  const generationRuns = tables.get("presentationGenerationRuns") ?? [];
  const executionRuns: Row[] = [];
  const executionAttempts: Row[] = [];
  for (const run of generationRuns) {
    const executionRunId = `execution_${run._id}`;
    const executionAttemptId = `attempt_${run._id}`;
    Object.assign(run, { executionRunId, executionAttemptId, executionFence: 1 });
    executionRuns.push({
      _id: executionRunId,
      userId: run.userId,
      activeAttemptId: executionAttemptId,
      state: "running",
    });
    executionAttempts.push({
      _id: executionAttemptId,
      runId: executionRunId,
      fence: 1,
      status: "running",
      claimantId: `presentation:${String(run.projectId)}`,
      leaseExpiresAt: Date.now() + 60_000,
    });
  }
  tables.set("executionRuns", executionRuns);
  tables.set("executionAttempts", executionAttempts);
  const scheduled: string[] = [];
  const deletedStorage: string[] = [];
  let nextId = 1;
  const allRows = () => [...tables.values()].flat();
  const ctx = {
    db: {
      get: async (id: string) => allRows().find((row) => row._id === id) ?? null,
      insert: async (table: string, value: Record<string, unknown>) => {
        const id = `${table}_new_${nextId++}`;
        tables.set(table, [...(tables.get(table) ?? []), { _id: id, ...value }]);
        return id;
      },
      patch: async (id: string, patch: Record<string, unknown>) => {
        const row = allRows().find((candidate) => candidate._id === id);
        if (row) Object.assign(row, patch);
      },
      delete: async (id: string) => {
        for (const [table, rows] of tables) {
          tables.set(table, rows.filter((row) => row._id !== id));
        }
      },
      query: (table: string) => {
        let rows = tables.get(table) ?? [];
        const chain = {
          withIndex: (_name: string, apply: (builder: { eq: (field: string, value: unknown) => unknown }) => unknown) => {
            const filters: Array<[string, unknown]> = [];
            const builder = {
              eq(field: string, value: unknown) {
                filters.push([field, value]);
                return builder;
              },
            };
            apply(builder);
            rows = rows.filter((row) => filters.every(([field, value]) => row[field] === value));
            return chain;
          },
          collect: async () => [...rows],
          first: async () => rows[0] ?? null,
          unique: async () => rows[0] ?? null,
        };
        return chain;
      },
    },
    scheduler: {
      runAfter: async (_delay: number, ref: unknown) => {
        scheduled.push(getFunctionName(ref as never));
        return `scheduled_${scheduled.length}`;
      },
    },
    storage: {
      delete: async (storageId: string) => {
        deletedStorage.push(storageId);
      },
    },
    runMutation: async () => "cancelled",
  };
  return { ctx, tables, scheduled, deletedStorage };
}

function projectRow(): Row {
  return {
    _id: "project_1",
    userId: "user_1",
    status: "generating",
    workflowPhase: "generating",
    revision: 7,
    imageMode: "none",
    assetStorageIds: [],
    modelId: "selected/model",
    effectiveModelIds: ["selected/model"],
    plan: [
      { id: "a", title: "A", purpose: "Open", layout: "Hero", imageIntent: "" },
      { id: "b", title: "B", purpose: "Close", layout: "Statement", imageIntent: "" },
    ],
  };
}

function runRow(overrides: Record<string, unknown> = {}): Row {
  return {
    _id: "run_1",
    userId: "user_1",
    projectId: "project_1",
    projectRevision: 7,
    jobId: "job_1",
    toolCallId: "call_1",
    selectedModelId: "selected/model",
    expectedSlideIds: ["a", "b"],
    completedSlideIds: ["a", "b"],
    deletedSlideIds: [],
    status: "finalizing",
    ...overrides,
  };
}

test("finalization publishes once, records fallback use, and removes private candidates", async () => {
  const testState = state({
    presentationProjects: [projectRow()],
    generationJobs: [{ _id: "job_1", userId: "user_1", status: "running" }],
    presentationGenerationRuns: [runRow()],
    presentationGenerationBatches: [
      { _id: "batch_1", runId: "run_1", batchIndex: 0, effectiveModelIds: ["selected/model"] },
      { _id: "batch_2", runId: "run_1", batchIndex: 1, effectiveModelIds: ["app/default"] },
    ],
    presentationCuratorTasks: [],
    presentationSlideCandidates: [
      { _id: "candidate_b", runId: "run_1", slideId: "b", position: 1, title: "B", html: slideHtml("b", "Beta"), revision: 0, effectiveModelId: "app/default" },
      { _id: "candidate_a", runId: "run_1", slideId: "a", position: 0, title: "A", html: severeOverlapSlideHtml(), revision: 0, effectiveModelId: "selected/model" },
    ],
    presentationSlides: [
      { _id: "old_slide", projectId: "project_1", position: 0, slideId: "old" },
    ],
  });
  const ctx = testState.ctx as unknown as Parameters<typeof finalizePresentationFanoutHandler>[0];
  const result = await finalizePresentationFanoutHandler(ctx, {
    runId: "run_1" as never,
    ...executionIdentity,
  });
  assert.equal(result?.slideCount, 2);
  assert.deepEqual(testState.tables.get("presentationSlides")?.map((row) => row.slideId), ["a", "b"]);
  assert.equal(testState.tables.get("presentationSlideCandidates")?.length, 0);
  const project = testState.tables.get("presentationProjects")?.[0];
  assert.equal(project?.status, "ready");
  assert.equal(project?.modelFallbackUsed, true);
  assert.deepEqual(project?.effectiveModelIds, ["selected/model", "app/default"]);
  assert.equal(testState.scheduled.filter((name) =>
    name === getFunctionName(runDeferredPresentationSnapshotRef)
  ).length, 1);

  const duplicate = await finalizePresentationFanoutHandler(ctx, {
    runId: "run_1" as never,
    ...executionIdentity,
  });
  assert.equal(duplicate, null);
  assert.equal(testState.scheduled.filter((name) =>
    name === getFunctionName(runDeferredPresentationSnapshotRef)
  ).length, 1);
});
test("a finished finalizer with missing lifecycle reconciliation is recovered", async () => {
  const testState = state({
    presentationProjects: [projectRow()],
    generationJobs: [{ _id: "job_1", userId: "user_1", status: "running" }],
    presentationGenerationRuns: [runRow({ finalizerWorkpoolOperationId: "finalizer_work_1" })],
    presentationGenerationBatches: [
      { _id: "batch_1", runId: "run_1", batchIndex: 0, effectiveModelIds: ["selected/model"] }],
    presentationCuratorTasks: [],
    presentationSlideCandidates: [
      { _id: "candidate_a", runId: "run_1", slideId: "a", position: 0, title: "A", html: slideHtml("a", "Alpha"), revision: 0, effectiveModelId: "selected/model" },
      { _id: "candidate_b", runId: "run_1", slideId: "b", position: 1, title: "B", html: slideHtml("b", "Beta"), revision: 0, effectiveModelId: "selected/model" },
    ],
    presentationSlides: [],
  });
  assert.equal(await recoverPresentationFinalizerCompletion(testState.ctx as never, {
    ...executionIdentity,
    runId: "run_1" as never,
    operationId: "finalizer_work_1",
  }), true);
  assert.equal(testState.tables.get("presentationGenerationRuns")?.[0]?.status, "complete");
  assert.equal(testState.tables.get("presentationProjects")?.[0]?.status, "ready");
  assert.deepEqual(testState.tables.get("presentationSlides")?.map((row) => row.slideId), ["a", "b"]);
});

test("a partial studio failure terminalizes once and retains the latest private candidate", async () => {
  const testState = state({
    presentationProjects: [projectRow()],
    generationJobs: [{ _id: "job_1", userId: "user_1", status: "running" }],
    presentationGenerationRuns: [runRow({ status: "generating" })],
    presentationGenerationBatches: [{
      _id: "batch_1", runId: "run_1", status: "running", candidateStorageId: "storage_1",
    }],
    presentationCuratorTasks: [],
    presentationSlideCandidates: [{
      _id: "candidate_a", runId: "run_1", slideId: "a", position: 0,
    }],
  });
  const ctx = testState.ctx as unknown as Parameters<typeof failPresentationFanoutHandler>[0];
  assert.equal(await failPresentationFanoutHandler(ctx, {
    ...executionIdentity,
    runId: "run_1" as never,
    batchId: "batch_1" as never,
    error: "Studio B failed",
  }), true);
  assert.equal(await failPresentationFanoutHandler(ctx, {
    ...executionIdentity,
    runId: "run_1" as never,
    batchId: "batch_1" as never,
    error: "late duplicate",
  }), false);
  assert.equal(testState.tables.get("presentationSlideCandidates")?.length, 0);
  assert.deepEqual(testState.deletedStorage, []);
  assert.equal(
    testState.tables.get("presentationGenerationBatches")?.[0]?.candidateStorageId,
    "storage_1",
  );
  assert.equal(testState.tables.get("presentationProjects")?.[0]?.status, "failed");
  assert.equal(testState.tables.get("presentationGenerationRuns")?.[0]?.error, "Studio B failed");
});

test("a Workflow-owned fanout failure never swallows its terminal signal", async (t) => {
  t.mock.method(durableWorkflow, "sendEvent", async () => {
    throw new Error("terminal signal unavailable");
  });
  const testState = state({
    presentationProjects: [{ ...projectRow(), workflowId: "workflow_1" }],
    generationJobs: [{ _id: "job_1", userId: "user_1", status: "running" }],
    presentationGenerationRuns: [runRow({
      status: "generating",
      workflowId: "workflow_1",
    })],
    presentationGenerationBatches: [],
    presentationCuratorTasks: [],
    presentationSlideCandidates: [],
  });

  await assert.rejects(
    failPresentationFanoutHandler(testState.ctx as never, {
      ...executionIdentity,
      runId: "run_1" as never,
      error: "worker failed",
    }),
    /terminal signal unavailable/,
  );
});

test("Workflow-owned finalization never schedules a legacy snapshot", async () => {
  const project = { ...projectRow(), workflowId: "workflow_1" };
  const run = runRow({ workflowId: "workflow_1" });
  const testState = state({
    presentationProjects: [project],
    generationJobs: [{ _id: "job_1", userId: "user_1", status: "running" }],
    presentationGenerationRuns: [run],
    presentationGenerationBatches: [
      { _id: "batch_1", runId: "run_1", batchIndex: 0, effectiveModelIds: ["selected/model"] },
    ],
    presentationCuratorTasks: [],
    presentationSlideCandidates: [
      { _id: "candidate_a", runId: "run_1", slideId: "a", position: 0, title: "A", html: slideHtml("a", "Alpha"), revision: 0, effectiveModelId: "selected/model" },
      { _id: "candidate_b", runId: "run_1", slideId: "b", position: 1, title: "B", html: slideHtml("b", "Beta"), revision: 0, effectiveModelId: "selected/model" },
    ],
    presentationSlides: [],
  });
  const result = await finalizePresentationFanoutHandler(testState.ctx as never, {
    ...executionIdentity,
    runId: "run_1" as never,
  });
  assert.equal(result?.slideCount, 2);
  assert.deepEqual(testState.scheduled, []);
});
