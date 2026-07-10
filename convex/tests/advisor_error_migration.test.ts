import assert from "node:assert/strict";
import test from "node:test";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { scrubUnsafeAdvisorErrors } from "../advisors/migrations";
import { GENERIC_ADVISOR_FAILURE } from "../lib/openrouter_responses_error";

type MigrationHandler = (
  ctx: MutationCtx,
  args: { cursor?: string; dryRun?: boolean },
) => Promise<{
  scannedCount: number;
  scrubbedCount: number;
  isComplete: boolean;
  nextCursor?: string;
}>;

const handler = (scrubUnsafeAdvisorErrors as unknown as {
  _handler: MigrationHandler;
})._handler;

test("legacy Advisor error migration scrubs request dumps and preserves safe messages", async () => {
  const patches: Array<{ id: Id<"advisorRuns">; errorMessage: string }> = [];
  const runs = [
    {
      _id: "run_unsafe" as Id<"advisorRuns">,
      errorMessage: 'ChatSend failed: {"request":{"content":"PRIVATE_SENTINEL"}}',
    },
    {
      _id: "run_safe" as Id<"advisorRuns">,
      errorMessage: "Provider capacity is temporarily unavailable",
    },
  ] as Array<Doc<"advisorRuns">>;
  const ctx = {
    db: {
      query: () => ({
        paginate: async () => ({
          page: runs,
          isDone: true,
          continueCursor: "",
        }),
      }),
      patch: async (id: Id<"advisorRuns">, value: { errorMessage: string }) => {
        patches.push({ id, errorMessage: value.errorMessage });
      },
    },
  } as unknown as MutationCtx;

  const result = await handler(ctx, {});

  assert.deepEqual(result, {
    scannedCount: 2,
    scrubbedCount: 1,
    isComplete: true,
    nextCursor: undefined,
  });
  assert.deepEqual(patches, [{
    id: "run_unsafe",
    errorMessage: GENERIC_ADVISOR_FAILURE,
  }]);
});

test("legacy Advisor error migration supports dry-run pagination", async () => {
  let patchCount = 0;
  const ctx = {
    db: {
      query: () => ({
        paginate: async () => ({
          page: [{
            _id: "run_unsafe" as Id<"advisorRuns">,
            errorMessage: '[{"input":"PRIVATE_SENTINEL"}]',
          }] as Array<Doc<"advisorRuns">>,
          isDone: false,
          continueCursor: "next-page",
        }),
      }),
      patch: async () => {
        patchCount += 1;
      },
    },
  } as unknown as MutationCtx;

  const result = await handler(ctx, { dryRun: true });

  assert.equal(result.scrubbedCount, 1);
  assert.equal(result.isComplete, false);
  assert.equal(result.nextCursor, "next-page");
  assert.equal(patchCount, 0);
});
