import assert from "node:assert/strict";
import test from "node:test";
import { ConvexError } from "convex/values";
import { createChatProjectHandler } from "../presentations/mutations_project_handlers";

function context(existingToolCallId: string) {
  return {
    db: {
      query: (table: string) => {
        assert.equal(table, "presentationProjects");
        return {
          withIndex: () => ({
            order: () => ({
              first: async () => ({
                _id: "project_1",
                userId: "user_1",
                originToolCallId: existingToolCallId,
              }),
            }),
          }),
        };
      },
    },
  } as never;
}

const args = {
  userId: "user_1",
  chatId: "chat_1",
  originAssistantMessageId: "assistant_1",
  originToolCallId: "call_1",
  prompt: "Create one presentation",
  direction: "editorial" as const,
  imageMode: "none" as const,
};

test("presentation creation rejects a second project in the same assistant turn", async () => {
  await assert.rejects(
    () => createChatProjectHandler(context("call_previous"), args as never),
    (error: unknown) => error instanceof ConvexError &&
      (error.data as { code?: string } | undefined)?.code === "PRESENTATION_ALREADY_ATTEMPTED",
  );
});
