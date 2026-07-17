import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionName } from "convex/server";
import { expireWorkflowRef } from "../presentations/action_refs";
import {
  PRESENTATION_DEFERRED_MODEL_TIMEOUT_MS,
  PRESENTATION_MODEL_TIMEOUT_MS,
  PRESENTATION_WORKFLOW_LEASE_MS,
} from "../presentations/limits";
import {
  beginGenerationHandler,
  beginPlanningHandler,
  expireWorkflowHandler,
  setWorkflowPhaseHandler,
} from "../presentations/workflow_mutation_handlers";

function project() {
  return {
    _id: "project_1",
    _creationTime: 1,
    userId: "user_1",
    title: "Deck",
    status: "draft",
    sourceKind: "scratch",
    prompt: "Original brief",
    direction: "editorial",
    imageMode: "none",
    aspectRatio: "16:9",
    revision: 0,
    createdAt: 1,
    updatedAt: 1,
  } as any;
}

test("deferred model work reserves one minute below the action ceiling", () => {
  const actionCeilingMs = 10 * 60 * 1_000;
  assert.equal(PRESENTATION_DEFERRED_MODEL_TIMEOUT_MS, 9 * 60 * 1_000);
  assert.equal(
    actionCeilingMs - PRESENTATION_DEFERRED_MODEL_TIMEOUT_MS,
    60 * 1_000,
  );
  assert.equal(PRESENTATION_WORKFLOW_LEASE_MS, actionCeilingMs);
});

test("planning schedules a revision-scoped durable workflow expiry", async () => {
  assert.ok(PRESENTATION_WORKFLOW_LEASE_MS > PRESENTATION_MODEL_TIMEOUT_MS * 2);
  const row = project();
  const scheduled: Array<{ delay: number; name: string; args: Record<string, unknown> }> = [];
  const ctx = {
    db: {
      get: async () => row,
      patch: async (...args: unknown[]) => {
        Object.assign(row, args.length === 3 ? args[2] : args[1]);
      },
    },
    scheduler: {
      runAfter: async (delay: number, ref: unknown, args: Record<string, unknown>) => {
        scheduled.push({ delay, name: getFunctionName(ref as any), args });
        return "scheduled_1";
      },
    },
  } as any;

  const result = await beginPlanningHandler(ctx, {
    projectId: "project_1" as any,
    userId: "user_1",
    expectedRevision: 0,
    prompt: "Updated brief",
    direction: "minimal",
    imageMode: "none",
    modelId: "test/model",
  });

  assert.equal(result.projectRevision, 1);
  assert.equal(row.status, "planning");
  assert.deepEqual(scheduled, [{
    delay: PRESENTATION_WORKFLOW_LEASE_MS,
    name: getFunctionName(expireWorkflowRef),
    args: { projectId: "project_1", userId: "user_1", expectedRevision: 1 },
  }]);

  assert.equal(await expireWorkflowHandler(ctx, {
    projectId: "project_1" as any,
    userId: "user_1",
    expectedRevision: 1,
  }), true);
  assert.equal(row.status, "failed");
  assert.equal(row.revision, 2);
  assert.match(row.error ?? "", /timed out/i);
});

test("generation schedules its own revision-scoped durable expiry", async () => {
  const row = project();
  row.status = "planned";
  row.revision = 4;
  row.plan = [{
    id: "slide_01",
    title: "Opening",
    purpose: "Open",
    layout: "hero",
    imageIntent: "",
  }];
  const scheduled: Array<{ delay: number; args: Record<string, unknown> }> = [];
  const ctx = {
    db: {
      get: async () => row,
      patch: async (...args: unknown[]) => {
        Object.assign(row, args.length === 3 ? args[2] : args[1]);
      },
    },
    scheduler: {
      runAfter: async (delay: number, _ref: unknown, args: Record<string, unknown>) => {
        scheduled.push({ delay, args });
        return "scheduled_generation";
      },
    },
  } as any;

  const result = await beginGenerationHandler(ctx, {
    projectId: "project_1" as any,
    userId: "user_1",
    expectedRevision: 4,
    modelId: "test/model",
  });
  assert.equal(result.projectRevision, 5);
  assert.equal(row.status, "generating");
  assert.deepEqual(scheduled, [{
    delay: PRESENTATION_WORKFLOW_LEASE_MS,
    args: { projectId: "project_1", userId: "user_1", expectedRevision: 5 },
  }]);
});

test("workflow expiry cannot overwrite a completed or newer revision", async () => {
  const row = project();
  row.status = "ready";
  row.revision = 2;
  const ctx = {
    db: {
      get: async () => row,
      patch: async () => assert.fail("completed workflow must not be patched"),
    },
  } as any;

  assert.equal(await expireWorkflowHandler(ctx, {
    projectId: "project_1" as any,
    userId: "user_1",
    expectedRevision: 1,
  }), false);
});

test("workflow expiry terminalizes fanout state and retains the latest repair candidate", async () => {
  const tables = new Map<string, Array<Record<string, any>>>([
    ["presentationProjects", [{
      ...project(), status: "generating", revision: 8,
    }]],
    ["presentationGenerationRuns", [{
      _id: "run_1", projectId: "project_1", projectRevision: 8, status: "curating",
    }]],
    ["presentationGenerationBatches", [{
      _id: "batch_1", runId: "run_1", status: "repairing", candidateStorageId: "blob_1",
    }]],
    ["presentationSlideCandidates", [{
      _id: "candidate_1", runId: "run_1", slideId: "slide_01",
    }]],
    ["presentationCuratorTasks", [{
      _id: "task_1", runId: "run_1", status: "running",
    }]],
  ]);
  const allRows = () => [...tables.values()].flat();
  const deletedStorage: string[] = [];
  const ctx = {
    db: {
      get: async (...args: any[]) => {
        const id = args.at(-1);
        return allRows().find((row) => row._id === id) ?? null;
      },
      patch: async (...args: any[]) => {
        const id = args.length === 3 ? args[1] : args[0];
        const value = args.length === 3 ? args[2] : args[1];
        const row = allRows().find((candidate) => candidate._id === id);
        if (row) Object.assign(row, value);
      },
      delete: async (id: string) => {
        for (const [table, rows] of tables) {
          tables.set(table, rows.filter((row) => row._id !== id));
        }
      },
      query: (table: string) => {
        let rows = tables.get(table) ?? [];
        const chain = {
          withIndex: (_name: string, apply: (builder: any) => unknown) => {
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
          first: async () => rows[0] ?? null,
          collect: async () => [...rows],
        };
        return chain;
      },
    },
    storage: {
      delete: async (storageId: string) => deletedStorage.push(storageId),
    },
  } as any;

  assert.equal(await expireWorkflowHandler(ctx, {
    projectId: "project_1" as any,
    userId: "user_1",
    expectedRevision: 8,
  }), true);
  assert.equal(tables.get("presentationProjects")?.[0]?.status, "failed");
  assert.equal(tables.get("presentationGenerationRuns")?.[0]?.status, "failed");
  assert.equal(tables.get("presentationGenerationBatches")?.[0]?.status, "failed");
  assert.equal(tables.get("presentationGenerationBatches")?.[0]?.candidateStorageId, "blob_1");
  assert.equal(tables.get("presentationSlideCandidates")?.length, 0);
  assert.equal(tables.get("presentationCuratorTasks")?.[0]?.status, "complete");
  assert.deepEqual(deletedStorage, []);
});

test("a repair phase renews the revision-scoped workflow lease", async () => {
  const row = project();
  row.status = "generating";
  row.revision = 5;
  const scheduled: Array<Record<string, unknown>> = [];
  const ctx = {
    db: {
      get: async () => row,
      patch: async (...args: unknown[]) => {
        Object.assign(row, args.length === 3 ? args[2] : args[1]);
      },
    },
    scheduler: {
      runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
        scheduled.push(args);
        return "scheduled_repair";
      },
    },
  } as any;

  assert.equal(await setWorkflowPhaseHandler(ctx, {
    projectId: "project_1" as any,
    userId: "user_1",
    expectedRevision: 5,
    phase: "repairing_generation",
  }), true);
  assert.equal(row.revision, 6);
  assert.deepEqual(scheduled, [{
    projectId: "project_1",
    userId: "user_1",
    expectedRevision: 6,
  }]);
  assert.equal(await expireWorkflowHandler(ctx, {
    projectId: "project_1" as any,
    userId: "user_1",
    expectedRevision: 5,
  }), false);
});
