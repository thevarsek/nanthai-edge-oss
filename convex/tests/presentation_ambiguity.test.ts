import assert from "node:assert/strict";
import test from "node:test";
import { ConvexError } from "convex/values";

import { getUnambiguousReadyProjectInternal } from "../presentations/queries";

function queryContext(projects: Array<Record<string, unknown>>) {
  return {
    db: {
      query: (table: string) => {
        const chain = {
          withIndex: () => chain,
          order: () => chain,
          take: async () => table === "presentationProjects" ? projects : [],
          collect: async () => [],
        };
        return chain;
      },
    },
  } as never;
}

function project(id: string) {
  return {
    _id: id,
    _creationTime: 1,
    userId: "user_1",
    chatId: "chat_1",
    title: id,
    status: "ready",
    sourceKind: "scratch",
    prompt: "Brief",
    direction: "minimal",
    imageMode: "none",
    aspectRatio: "16:9",
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

test("presentation editing rejects chat-wide fallback when multiple ready decks exist", async () => {
  await assert.rejects(
    () => (getUnambiguousReadyProjectInternal as unknown as {
      _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
    })._handler(queryContext([project("project_1"), project("project_2")]), {
      userId: "user_1",
      chatId: "chat_1",
    }),
    (error: unknown) =>
      error instanceof ConvexError &&
      (error.data as { code?: string }).code === "AMBIGUOUS_PRESENTATION",
  );
});
