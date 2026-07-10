import assert from "node:assert/strict";
import test from "node:test";
import { deleteAdvisorDataForMessage } from "../advisors/deletion";

test("deleting the original response re-anchors Advisor history to a surviving retry", async () => {
  const batch = {
    _id: "batch_1",
    userMessageId: "user_1",
    assistantMessageIds: ["assistant_original"],
  };
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const deleted: string[] = [];
  const ctx = {
    db: {
      get: async (id: string) => id === "batch_1" ? batch : null,
      query: (table: string) => ({
        withIndex: () => ({
          collect: async () => {
            if (table === "advisorBatches") return [];
            if (table === "messages") {
              return [
                {
                  _id: "assistant_original",
                  role: "assistant",
                  advisorBatchId: "batch_1",
                },
                {
                  _id: "assistant_retry",
                  role: "assistant",
                  advisorBatchId: "batch_1",
                },
              ];
            }
            return [];
          },
        }),
      }),
      patch: async (id: string, patch: Record<string, unknown>) => patches.push({ id, patch }),
      delete: async (id: string) => deleted.push(id),
    },
  } as unknown as Parameters<typeof deleteAdvisorDataForMessage>[0];

  await deleteAdvisorDataForMessage(ctx, {
    _id: "assistant_original",
    role: "assistant",
    advisorBatchId: "batch_1",
  } as unknown as Parameters<typeof deleteAdvisorDataForMessage>[1]);

  assert.equal(patches.length, 1);
  assert.equal(patches[0]?.id, "batch_1");
  assert.deepEqual(patches[0]?.patch.assistantMessageIds, ["assistant_retry"]);
  assert.equal(typeof patches[0]?.patch.updatedAt, "number");
  assert.deepEqual(deleted, []);
});
