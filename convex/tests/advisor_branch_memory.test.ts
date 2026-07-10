import assert from "node:assert/strict";
import test from "node:test";
import {
  branchAwareAdvisorReplayItems,
  getRunExecutionContext,
} from "../advisors/queries";

const executionContextHandler = (getRunExecutionContext as unknown as {
  _handler: (ctx: unknown, args: { runId: string }) => Promise<{
    messages: Array<{ _id: string }>;
    replayItems: unknown[];
  } | null>;
})._handler;

test("Advisor memory replays only prior successful consultations on the active branch", () => {
  const activeItem = {
    type: "openrouter:advisor",
    id: "item_active",
    instance_name: "persona_1",
    advice: "Active advice",
  };
  const divergentItem = {
    type: "openrouter:advisor",
    id: "item_divergent",
    instance_name: "persona_1",
    advice: "Divergent advice",
  };
  const selected = branchAwareAdvisorReplayItems([
    {
      _id: "run_active",
      status: "completed",
      userMessageId: "message_active",
      createdAt: 10,
      replayItems: [activeItem],
    },
    {
      _id: "run_divergent",
      status: "completed",
      userMessageId: "message_other_branch",
      createdAt: 11,
      replayItems: [divergentItem],
    },
    {
      _id: "run_failed",
      status: "failed",
      userMessageId: "message_active",
      createdAt: 12,
      replayItems: [{ type: "openrouter:advisor", id: "failed" }],
    },
  ] as Parameters<typeof branchAwareAdvisorReplayItems>[0], {
    currentRunId: "run_current",
    currentCreatedAt: 20,
    branchMessageIds: new Set(["message_active"]),
  });
  assert.deepEqual(selected, [activeItem]);
  assert.strictEqual(selected[0], activeItem);
});

test("Advisor execution context bounds the active branch after excluding newer divergent traffic", async () => {
  const activeMessages = Array.from({ length: 45 }, (_, index) => ({
    _id: `active_${index}`,
    chatId: "chat_1",
    role: index % 2 === 0 ? "user" : "assistant",
    parentMessageIds: index === 0 ? [] : [`active_${index - 1}`],
    createdAt: index + 1,
  }));
  const divergentMessages = Array.from({ length: 50 }, (_, index) => ({
    _id: `divergent_${index}`,
    chatId: "chat_1",
    role: index % 2 === 0 ? "assistant" : "user",
    parentMessageIds: index === 0 ? ["active_0"] : [`divergent_${index - 1}`],
    createdAt: 100 + index,
  }));
  const assistantAnchor = {
    _id: "assistant_current",
    chatId: "chat_1",
    role: "assistant",
    parentMessageIds: ["active_44"],
    createdAt: 200,
  };
  const messages = [...activeMessages, ...divergentMessages, assistantAnchor];
  const activeItem = {
    type: "openrouter:advisor",
    id: "active_history",
    advice: "Older advice on this branch",
  };
  const priorRuns = [
    ...Array.from({ length: 45 }, (_, index) => ({
      _id: `divergent_run_${index}`,
      status: "completed",
      userMessageId: `divergent_${index}`,
      createdAt: 70 + index,
      replayItems: [{ type: "openrouter:advisor", id: `divergent_${index}` }],
    })),
    {
      _id: "active_run",
      status: "completed",
      userMessageId: "active_20",
      createdAt: 60,
      replayItems: [activeItem],
    },
  ];
  const messagesById = new Map(messages.map((message) => [message._id, message]));
  let messageReads = 0;
  const result = await executionContextHandler({
    db: {
      get: async (id: string) => {
        if (id === "run_current") {
          return {
            _id: "run_current",
            batchId: "batch_1",
            personaId: "persona_1",
            createdAt: 200,
          };
        }
        if (id === "batch_1") {
          return {
            _id: "batch_1",
            userMessageId: "active_44",
            assistantMessageIds: ["assistant_current"],
            chatId: "chat_1",
          };
        }
        messageReads += 1;
        return messagesById.get(id) ?? null;
      },
      query: (table: string) => ({
        withIndex: (_index: string, apply?: (query: {
          eq: (field: string, value: unknown) => unknown;
        }) => void) => {
          const filters = new Map<string, unknown>();
          const query = {
            eq: (field: string, value: unknown) => {
              filters.set(field, value);
              return query;
            },
          };
          apply?.(query);
          return {
            collect: async () => {
              if (table === "messages") return [];
              return priorRuns.filter((run) =>
                run.userMessageId === filters.get("userMessageId")
              );
            },
          };
        },
      }),
    },
  }, { runId: "run_current" });

  assert.ok(messageReads <= 42, `expected bounded branch reads, received ${messageReads}`);
  assert.deepEqual(result?.messages.map((message) => message._id), [
    ...Array.from({ length: 40 }, (_, index) => `active_${index + 5}`),
    "assistant_current",
  ]);
  assert.deepEqual(result?.replayItems, [activeItem]);
});
