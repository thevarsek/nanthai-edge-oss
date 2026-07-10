import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { generateForParticipant } from "../chat/actions_run_generation_participant";

test("generation fails before transport when a saved model was pruned", async (t) => {
  t.after(() => mock.restoreAll());
  let fetched = false;
  mock.method(globalThis, "fetch", async () => {
    fetched = true;
    return new Response();
  });
  const mutations: Array<Record<string, unknown>> = [];
  const ctx = {
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if ("jobId" in args) return false;
      if ("userId" in args) return {};
      return null;
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
      return null;
    },
    scheduler: { runAfter: async () => "scheduled_1" },
    storage: { get: async () => null },
  };

  const result = await generateForParticipant({
    ctx: ctx as never,
    args: {
      chatId: "chat_1",
      userId: "user_1",
      userMessageId: "user_message_1",
      assistantMessageIds: ["assistant_1"],
      generationJobIds: ["job_1"],
      participants: [],
      expandMultiModelGroups: false,
      webSearchEnabled: false,
    } as never,
    participant: {
      messageId: "assistant_1",
      jobId: "job_1",
      modelId: "openai/pruned-image-model",
    } as never,
    allMessages: [{
      _id: "user_message_1",
      role: "user",
      content: "Draw a cat",
    }] as never,
    memoryContext: undefined,
    modelCapabilities: new Map(),
    isPro: true,
    runtimeProfile: "mobileBasic",
    apiKey: "test-key",
    actionStartTime: Date.now(),
    requestMessagesOverride: [{ role: "user", content: "Draw a cat" }],
  });

  assert.equal(result.failed, true);
  assert.equal(fetched, false);
  const failure = mutations.find((entry) => entry.status === "failed");
  assert.equal(failure?.error, "Generation cannot use openai/pruned-image-model because it is no longer available. Choose another model and try again.");
  assert.match(String(failure?.content), /no longer available/);
});
