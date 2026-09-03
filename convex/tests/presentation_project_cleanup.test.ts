import assert from "node:assert/strict";
import test from "node:test";
import { deletePresentationProjectData } from
  "../presentations/project_cleanup";

test("presentation project cleanup removes its graph and private storage", async () => {
  const deleted: string[] = [];
  const storageDeleted: string[] = [];
  const tableRows: Record<string, Array<Record<string, unknown>>> = {
    presentationSlides: [{ _id: "slide", projectId: "project" }],
    presentationAssets: [{ _id: "asset", projectId: "project", storageId: "asset_storage" }],
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
          const filters: Array<[string, unknown]> = [];
          const query = {
            eq: (field: string, value: unknown) => {
              filters.push([field, value]);
              return query;
            },
          };
          build(query);
          const matchingRows = () => (tableRows[table] ?? []).filter((row) =>
            filters.every(([field, value]) => row[field] === value)
          );
          return {
            collect: async () => matchingRows(),
            first: async () => matchingRows()[0] ?? null,
          };
        },
      }),
      delete: async (id: string) => {
        deleted.push(id);
        for (const rows of Object.values(tableRows)) {
          const index = rows.findIndex((row) => row._id === id);
          if (index >= 0) rows.splice(index, 1);
        }
      },
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
    "asset_storage",
    "candidate_storage",
    "snapshot_storage",
  ]));
});

test("presentation project cleanup preserves an asset reused by a generated file", async () => {
  const storageDeleted: string[] = [];
  const rows: Record<string, Array<Record<string, unknown>>> = {
    presentationSlides: [],
    presentationAssets: [{ _id: "asset", projectId: "project", storageId: "shared_storage" }],
    generatedFiles: [{ _id: "file", storageId: "shared_storage" }],
    generatedMedia: [],
    fileAttachments: [],
    messages: [],
    presentationGenerationRuns: [],
  };
  const ctx = {
    db: {
      query: (table: string) => ({
        withIndex: (_name: string, build: (query: unknown) => unknown) => {
          const filters: Array<[string, unknown]> = [];
          const query = {
            eq: (field: string, value: unknown) => {
              filters.push([field, value]);
              return query;
            },
          };
          build(query);
          const matchingRows = () => (rows[table] ?? []).filter((row) =>
            filters.every(([field, value]) => row[field] === value)
          );
          return {
            collect: async () => matchingRows(),
            first: async () => matchingRows()[0] ?? null,
          };
        },
      }),
      delete: async (id: string) => {
        for (const values of Object.values(rows)) {
          const index = values.findIndex((row) => row._id === id);
          if (index >= 0) values.splice(index, 1);
        }
      },
    },
    storage: { delete: async (id: string) => storageDeleted.push(id) },
  };

  await deletePresentationProjectData(ctx as never, { _id: "project" } as never);

  assert.deepEqual(storageDeleted, []);
});
