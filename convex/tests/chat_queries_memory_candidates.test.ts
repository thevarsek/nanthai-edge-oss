import assert from "node:assert/strict";
import test from "node:test";

import { getUserMemoriesHandler } from "../chat/queries_handlers_internal";

test("getUserMemoriesHandler keeps older always-on and pinned memories", async () => {
  const result = await getUserMemoriesHandler({
    db: {
      query: () => ({
        withIndex: (index: string) => {
          const rows = index === "by_user"
            ? [{ _id: "recent", content: "Recent" }]
            : index === "by_user_retrieval_mode"
              ? [{ _id: "always", content: "Always" }]
              : index === "by_user_type"
                ? [{ _id: "always", content: "Always" }]
                : [{ _id: "pinned", content: "Pinned" }];
          return {
            order: () => ({ take: async () => rows }),
            take: async () => rows,
          };
        },
      }),
    },
  } as any, { userId: "user_1" });

  assert.deepEqual(result.map((memory) => memory._id), [
    "recent",
    "always",
    "pinned",
  ]);
});
