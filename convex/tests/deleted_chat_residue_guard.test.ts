import assert from "node:assert/strict";
import test from "node:test";
import { deleteDeletedChatResidueHandler } from "../chat/manage_internal";

test("deleted-chat residue cleanup refuses to touch a live chat", async () => {
  let queriedChildren = false;
  const ctx = {
    db: {
      get: async () => ({ _id: "chat" }),
      query: () => {
        queriedChildren = true;
        throw new Error("must not query children");
      },
    },
  };

  const result = await deleteDeletedChatResidueHandler(ctx as never, {
    chatId: "chat" as never,
  });

  assert.equal(result, false);
  assert.equal(queriedChildren, false);
});
