import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";
import {
  cancelResearchPaperHandler,
  startResearchPaper,
} from "../search/mutations_research_paper";
import {
  watchChatSearchSessions,
  watchSearchPhases,
  watchSearchSession,
} from "../search/queries";

function buildAuth(userId: string | null = "user_1") {
  return {
    getUserIdentity: async () => (userId ? { subject: userId } : null),
  };
}

test("startResearchPaper normalizes complexity and schedules title generation for first message", async () => {
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const scheduled: Array<{ payload: Record<string, unknown> }> = [];

  const result = await (startResearchPaper as any)._handler({
    auth: buildAuth(),
    db: {
      get: async (id: string) =>
        id === "chat_1"
          ? { _id: "chat_1", userId: "user_1", messageCount: 0 }
          : null,
      query: (table: string) => ({
        withIndex: (_index: string) => ({
          first: async () => {
            if (table === "purchaseEntitlements") return { userId: "user_1", status: "active" };
            if (table === "userPreferences") return { _id: "prefs_1", titleModelId: "openai/gpt-5.2-mini" };
            return null;
          },
          collect: async () => {
            if (table === "chatParticipants") {
              return [{ _id: "participant_1", chatId: "chat_1" }];
            }
            return [];
          },
          order: () => ({
            take: async () => [],
          }),
        }),
      }),
      insert: async (table: string, value: Record<string, unknown>) => {
        inserts.push({ table, value });
        if (table === "messages") return inserts.filter((item) => item.table === "messages").length === 1 ? "message_user" : "message_assistant";
        if (table === "generationJobs") return "job_1";
        if (table === "searchSessions") return "session_1";
        return `${table}_id`;
      },
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
      },
    },
    scheduler: {
      runAfter: async (_delay: number, _fnRef: unknown, payload: Record<string, unknown>) => {
        scheduled.push({ payload });
      },
    },
    storage: {
      getUrl: async () => null,
    },
  }, {
    chatId: "chat_1",
    text: "Research prompt",
    participant: { modelId: "openai/gpt-5.2" },
    complexity: 9,
    subagentsEnabled: true,
  });

  assert.deepEqual(result, {
    sessionId: "session_1",
    userMessageId: "message_user",
    assistantMessageId: "message_assistant",
  });
  const sessionInsert = inserts.find((entry) => entry.table === "searchSessions");
  assert.equal(sessionInsert?.value.complexity, 3);
  const chatPatch = patches.find((entry) => entry.id === "chat_1");
  assert.equal(chatPatch?.patch.activeBranchLeafId, "message_assistant");
  assert.equal(scheduled.length, 2);
  const researchRun = scheduled.find((entry) => entry.payload.sessionId === "session_1");
  assert.equal(researchRun?.payload.subagentsEnabled, false);
});

test("startResearchPaper rejects non-Pro users", async () => {
  await assert.rejects(
    (startResearchPaper as any)._handler({
      auth: buildAuth(),
      db: {
        get: async () => ({ _id: "chat_1", userId: "user_1", messageCount: 0 }),
        query: () => ({
          withIndex: () => ({
            first: async () => null,
            collect: async () => [{ _id: "participant_1" }],
          }),
        }),
      },
    }, {
      chatId: "chat_1",
      text: "Research prompt",
      participant: { modelId: "openai/gpt-5.2" },
      complexity: 2,
    }),
    (error: unknown) => {
      assert.ok(error instanceof ConvexError);
      return (error as ConvexError<any>).data?.code === "PRO_REQUIRED";
    },
  );
});

test("cancelResearchPaperHandler is idempotent for terminal sessions", async () => {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];

  await cancelResearchPaperHandler({
    auth: buildAuth(),
    db: {
      get: async (id: string) =>
        id === "session_1"
          ? { _id: "session_1", userId: "user_1", status: "cancelled" }
          : null,
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
      },
    },
  } as any, {
    sessionId: "session_1" as any,
  });

  assert.equal(patches.length, 0);
});

test("watchSearchSession and watchSearchPhases hide foreign sessions", async () => {
  const db = {
    get: async (id: string) =>
      id === "session_1"
        ? { _id: "session_1", userId: "user_2", chatId: "chat_2" }
        : null,
    query: () => ({
      withIndex: () => ({
        collect: async () => [{ _id: "phase_1" }],
        take: async () => [],
      }),
    }),
  };

  const session = await (watchSearchSession as any)._handler({
    auth: buildAuth(),
    db,
  }, {
    sessionId: "session_1",
  });
  const phases = await (watchSearchPhases as any)._handler({
    auth: buildAuth(),
    db,
  }, {
    sessionId: "session_1",
  });

  assert.equal(session, null);
  assert.deepEqual(phases, []);
});

test("watchChatSearchSessions returns only authorized chat sessions", async () => {
  const result = await (watchChatSearchSessions as any)._handler({
    auth: buildAuth(),
    db: {
      get: async (id: string) =>
        id === "chat_1" ? { _id: "chat_1", userId: "user_1" } : null,
      query: () => ({
        withIndex: () => ({
          take: async () => [
            { _id: "session_1", chatId: "chat_1" },
            { _id: "session_2", chatId: "chat_1" },
          ],
        }),
      }),
    },
  }, {
    chatId: "chat_1",
  });

  assert.deepEqual(result.map((row: any) => row._id), ["session_1", "session_2"]);
});
