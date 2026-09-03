import assert from "node:assert/strict";
import test from "node:test";
import { ConvexError } from "convex/values";
import { preferCurrentPresentationSnapshot } from "../chat/presentation_generated_file_snapshot";
import {
  registerPptxReferenceAsset,
  resolveProjectAssets,
} from "../presentations/asset_ownership";
import { recordPresentationSnapshotHandler } from "../presentations/snapshot_persistence";

function queryResult(value: unknown) {
  const chain = {
    withIndex: () => chain,
    order: () => chain,
    first: async () => value,
    collect: async () => Array.isArray(value) ? value : [],
  };
  return chain;
}

function errorCode(error: unknown): string | undefined {
  return error instanceof ConvexError
    ? (error.data as { code?: string } | undefined)?.code
    : undefined;
}

test("reference PPTX images become user-owned presentation assets", async () => {
  const inserted: Array<{ table: string; value: Record<string, unknown> }> = [];
  const ctx = {
    db: {
      query: (table: string) => {
        if (table === "fileAttachments") {
          return queryResult({ userId: "user_1", storageId: "source_1" });
        }
        if (table === "generatedFiles") return queryResult(null);
        if (table === "presentationAssets") return queryResult([]);
        throw new Error(`Unexpected table ${table}`);
      },
      insert: async (table: string, value: Record<string, unknown>) => {
        inserted.push({ table, value });
        return "asset_row_1";
      },
    },
  } as any;

  const storageId = await registerPptxReferenceAsset(ctx, {
    userId: "user_1",
    sourceStorageId: "source_1" as any,
    storageId: "image_1" as any,
    filename: "image1.png",
    mimeType: "image/png",
    sizeBytes: 1024,
    altText: "Hero image from slide 1",
  });

  assert.equal(storageId, "image_1");
  assert.equal(inserted[0]?.table, "presentationAssets");
  assert.equal(inserted[0]?.value.kind, "pptx_extracted");
  assert.equal(inserted[0]?.value.sourceStorageId, "source_1");
});

test("generated images are reusable presentation assets for their owner", async () => {
  const ctx = {
    db: {
      query: (table: string) => {
        if (table === "generatedMedia") {
          return queryResult({
            userId: "user_1",
            storageId: "generated_image_1",
            type: "image",
            mimeType: "image/jpeg",
            sizeBytes: 2048,
            prompt: "A cobalt-blue paper airplane on cream",
          });
        }
        return queryResult(null);
      },
    },
  } as any;

  const assets = await resolveProjectAssets(
    ctx,
    "user_1",
    ["generated_image_1" as any],
  );

  assert.deepEqual(assets, [{
    storageId: "generated_image_1",
    filename: "generated-image.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 2048,
    altText: "A cobalt-blue paper airplane on cream",
    kind: "attachment",
  }]);
});

test("browser snapshot persistence is revision checked and refreshes the latest file card", async () => {
  const patches: Array<{ table: string; id: string; value: Record<string, unknown> }> = [];
  const project = { _id: "project_1", userId: "user_1", revision: 7 };
  const generatedFile = { _id: "file_1", userId: "user_1" };
  const ctx = {
    db: {
      get: async () => project,
      query: (table: string) => table === "generatedFiles"
        ? queryResult(generatedFile)
        : queryResult(null),
      patch: async (table: string, id: string, value: Record<string, unknown>) => {
        patches.push({ table, id, value });
      },
    },
  } as any;

  const result = await recordPresentationSnapshotHandler(ctx, {
    projectId: "project_1" as any,
    userId: "user_1",
    expectedRevision: 7,
    storageId: "snapshot_7" as any,
    sizeBytes: 2048,
    kind: "browser_html",
  });

  assert.equal(result.snapshotRevision, 7);
  assert.equal(typeof patches[0]?.value.updatedAt, "number");
  delete patches[0]?.value.updatedAt;
  assert.deepEqual(patches, [
    {
      table: "presentationProjects",
      id: "project_1",
      value: {
        snapshotStorageId: "snapshot_7",
        snapshotRevision: 7,
        snapshotSizeBytes: 2048,
        snapshotKind: "browser_html",
        workflowPhase: "complete",
      },
    },
    {
      table: "generatedFiles",
      id: "file_1",
      value: {
        storageId: "snapshot_7",
        sizeBytes: 2048,
        presentationRevision: 7,
      },
    },
  ]);

  await assert.rejects(
    () => recordPresentationSnapshotHandler(ctx, {
      projectId: "project_1" as any,
      userId: "user_1",
      expectedRevision: 6,
      storageId: "stale" as any,
      sizeBytes: 2048,
      kind: "browser_html",
    }),
    (error: unknown) => errorCode(error) === "REVISION_CONFLICT",
  );
});

test("snapshot replacement reclaims an unreferenced prior Convex storage blob", async () => {
  const deleted: string[] = [];
  const project = {
    _id: "project_1",
    userId: "user_1",
    revision: 7,
    snapshotStorageId: "snapshot_6",
  };
  const ctx = {
    db: {
      get: async () => project,
      query: (table: string) => {
        let index = "";
        const chain = {
          withIndex: (name: string) => {
            index = name;
            return chain;
          },
          order: () => chain,
          first: async () => {
            if (table === "generatedFiles" && index === "by_presentation_project") {
              return { _id: "file_1", userId: "user_1" };
            }
            return null;
          },
        };
        return chain;
      },
      patch: async () => undefined,
    },
    storage: {
      delete: async (storageId: string) => {
        deleted.push(storageId);
      },
    },
  } as any;

  await recordPresentationSnapshotHandler(ctx, {
    projectId: "project_1" as any,
    userId: "user_1",
    expectedRevision: 7,
    storageId: "snapshot_7" as any,
    sizeBytes: 2048,
    kind: "browser_html",
  });

  assert.deepEqual(deleted, ["snapshot_6"]);
});

test("snapshot replacement preserves prior blobs that still back a generated file", async () => {
  const deleted: string[] = [];
  const project = {
    _id: "project_1",
    userId: "user_1",
    revision: 7,
    snapshotStorageId: "snapshot_6",
  };
  const ctx = {
    db: {
      get: async () => project,
      query: (table: string) => {
        let index = "";
        const chain = {
          withIndex: (name: string) => {
            index = name;
            return chain;
          },
          order: () => chain,
          first: async () => {
            if (table === "generatedFiles" && index === "by_presentation_project") {
              return { _id: "file_1", userId: "user_1" };
            }
            if (table === "generatedFiles" && index === "by_storage") {
              return { _id: "historical_file" };
            }
            return null;
          },
        };
        return chain;
      },
      patch: async () => undefined,
    },
    storage: {
      delete: async (storageId: string) => {
        deleted.push(storageId);
      },
    },
  } as any;

  await recordPresentationSnapshotHandler(ctx, {
    projectId: "project_1" as any,
    userId: "user_1",
    expectedRevision: 7,
    storageId: "snapshot_7" as any,
    sizeBytes: 2048,
    kind: "browser_html",
  });

  assert.deepEqual(deleted, []);
});

test("late generated-file insertion prefers an already-current browser snapshot", async () => {
  const file = {
    storageId: "fallback_9" as any,
    sizeBytes: 90_000,
    filename: "Deck.pptx",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    toolName: "edit_presentation",
    presentationProjectId: "project_1" as any,
    presentationRevision: 9,
  };
  const ctx = {
    db: {
      get: async () => ({
        userId: "user_1",
        snapshotKind: "browser_html",
        snapshotRevision: 9,
        snapshotStorageId: "browser_9",
        snapshotSizeBytes: 54_000,
      }),
    },
  } as any;

  const resolved = await preferCurrentPresentationSnapshot(ctx, "user_1", file);

  assert.equal(resolved.storageId, "browser_9");
  assert.equal(resolved.sizeBytes, 54_000);
  assert.equal(resolved.presentationRevision, 9);
});
