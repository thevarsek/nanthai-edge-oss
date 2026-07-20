import assert from "node:assert/strict";
import test from "node:test";
import { deletePresentationProjectData } from
  "../presentations/project_cleanup";

test("presentation project cleanup removes its graph and private storage", async () => {
  const deleted: string[] = [];
  const storageDeleted: string[] = [];
  const tableRows: Record<string, Array<Record<string, unknown>>> = {
    presentationSlides: [{ _id: "slide", projectId: "project" }],
    presentationAssets: [{ _id: "asset", projectId: "project" }],
    generatedFiles: [],
    presentationGenerationRuns: [{ _id: "run", projectId: "project" }],
    presentationGenerationBatches: [{
      _id: "batch",
      runId: "run",
      candidateStorageId: "candidate_storage",
    }],
    presentationSlideCandidates: [{ _id: "candidate", runId: "run" }],
    presentationCuratorTasks: [{ _id: "task", runId: "run" }],
  };
  const ctx = {
    db: {
      query: (table: string) => ({
        withIndex: (_name: string, build: (query: unknown) => unknown) => {
          let expected: unknown;
          const query = {
            eq: (_field: string, value: unknown) => {
              expected = value;
              return query;
            },
          };
          build(query);
          return {
            collect: async () => (tableRows[table] ?? []).filter((row) =>
              row.projectId === expected || row.runId === expected
            ),
          };
        },
      }),
      delete: async (id: string) => deleted.push(id),
    },
    storage: {
      delete: async (id: string) => storageDeleted.push(id),
    },
  };

  await deletePresentationProjectData(ctx as never, {
    _id: "project",
    snapshotStorageId: "snapshot_storage",
  } as never);

  assert.deepEqual(new Set(deleted), new Set([
    "slide",
    "asset",
    "batch",
    "candidate",
    "task",
    "run",
    "project",
  ]));
  assert.deepEqual(new Set(storageDeleted), new Set([
    "candidate_storage",
    "snapshot_storage",
  ]));
});
