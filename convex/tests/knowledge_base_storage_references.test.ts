import assert from "node:assert/strict";
import test from "node:test";

import { storageHasContentReferences } from "../knowledge_base/delete_helpers";

function ctxWithSnapshot(snapshotStorageId?: string) {
  return {
    db: {
      query: (table: string) => ({
        withIndex: (
          _index: string,
          configure: (query: { eq: (field: string, value: string) => unknown }) => unknown,
        ) => {
          configure({ eq: () => undefined });
          return {
            first: async () => table === "presentationProjects" && snapshotStorageId
              ? { _id: "presentation_1", snapshotStorageId }
              : null,
          };
        },
      }),
    },
  } as any;
}

test("presentation snapshots are retained as content references", async () => {
  assert.equal(
    await storageHasContentReferences(ctxWithSnapshot("snapshot_1"), "snapshot_1" as any),
    true,
  );
  assert.equal(
    await storageHasContentReferences(ctxWithSnapshot(), "unreferenced_1" as any),
    false,
  );
});
