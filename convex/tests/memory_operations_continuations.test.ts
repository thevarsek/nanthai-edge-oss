import assert from "node:assert/strict";
import test from "node:test";

import * as memoryOperations from "../memory/operations";
import {
  approveAllContinuation,
  deleteAllContinuation,
  rejectAllContinuation,
} from "../memory/operations_internal";

test("memory operation registrations remain exported", () => {
  assert.equal(typeof (memoryOperations.list as any)._handler, "function");
  assert.equal(typeof (memoryOperations.createManual as any)._handler, "function");
  assert.equal(typeof (memoryOperations.deleteAll as any)._handler, "function");
  assert.equal(typeof (memoryOperations.approveAll as any)._handler, "function");
  assert.equal(typeof (memoryOperations.rejectAll as any)._handler, "function");
  assert.equal(typeof (memoryOperations.retrieveRelevant as any)._handler, "function");
  assert.equal(typeof (memoryOperations.purgeUserMemories as any)._handler, "function");
});

test("deleteAllContinuation deletes a full batch and schedules another pass", async () => {
  const deleted: string[] = [];
  const scheduled: Array<Record<string, unknown>> = [];
  const memories = Array.from({ length: 100 }, (_, index) => ({
    _id: `memory_${index}`,
  }));

  await (deleteAllContinuation as any)._handler(
    {
      db: {
        query: (table: string) => ({
          withIndex: (_index: string, cb?: (query: any) => any) => {
            const state: { memoryId?: string } = {};
            cb?.({
              eq: (_field: string, value: string) => {
                state.memoryId = value;
                return state;
              },
            });
            return {
              take: async () => (table === "memories" ? memories : []),
              first: async () =>
                table === "memoryEmbeddings"
                  ? { _id: `embedding_${state.memoryId}`, memoryId: state.memoryId }
                  : null,
            };
          },
        }),
        delete: async (id: string) => {
          deleted.push(id);
        },
      },
      scheduler: {
        runAfter: async (_delay: number, _fn: unknown, payload: Record<string, unknown>) => {
          scheduled.push(payload);
        },
      },
    } as any,
    { userId: "user_1" },
  );

  assert.ok(deleted.includes("embedding_memory_0"));
  assert.ok(deleted.includes("memory_99"));
  assert.deepEqual(scheduled, [{ userId: "user_1" }]);
});

test("approveAllContinuation clears pending flags with one timestamp", async () => {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];

  await (approveAllContinuation as any)._handler(
    {
      db: {
        query: () => ({
          withIndex: () => ({
            take: async () => [
              { _id: "memory_1", isPending: true },
              { _id: "memory_2", isPending: true },
            ],
          }),
        }),
        patch: async (id: string, patch: Record<string, unknown>) => {
          patches.push({ id, patch });
        },
      },
      scheduler: {
        runAfter: async () => {},
      },
    } as any,
    { userId: "user_1" },
  );

  assert.equal(patches.length, 2);
  assert.equal(patches[0]?.patch.isPending, false);
  assert.equal(patches[0]?.patch.updatedAt, patches[1]?.patch.updatedAt);
});

test("rejectAllContinuation removes pending memories and related embeddings", async () => {
  const deleted: string[] = [];

  await (rejectAllContinuation as any)._handler(
    {
      db: {
        query: (table: string) => ({
          withIndex: (_index: string, cb?: (query: any) => any) => {
            const state: { memoryId?: string } = {};
            const queryApi = {
              eq: (_field: string, value: string) => {
                state.memoryId = value;
                return queryApi;
              },
            };
            cb?.(queryApi);
            return {
              take: async () =>
                table === "memories"
                  ? [{ _id: "memory_1", isPending: true }]
                  : [],
              first: async () =>
                table === "memoryEmbeddings"
                  ? { _id: `embedding_${state.memoryId}` }
                  : null,
            };
          },
        }),
        delete: async (id: string) => {
          deleted.push(id);
        },
      },
      scheduler: {
        runAfter: async () => {},
      },
    } as any,
    { userId: "user_1" },
  );

  assert.deepEqual(deleted, ["embedding_memory_1", "memory_1"]);
});
