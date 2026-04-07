import assert from "node:assert/strict";
import test from "node:test";

import { createMockCtx } from "../../test_helpers/convex_mock_ctx";
import {
  createGenerateTitleHandlerDepsForTest,
  generateTitleHandler,
} from "../chat/actions_generate_title_handler";
import {
  createPostProcessHandlerDepsForTest,
  postProcessHandler,
} from "../chat/actions_post_process_handler";

test("postProcessHandler exits when the chat is missing or the user message is a scheduled step", async () => {
  const scheduled: Array<Record<string, unknown>> = [];
  const missingChatCtx = createMockCtx({
    runQuery: async () => null,
    scheduler: {
      runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
        scheduled.push(args);
      },
    },
  });

  await postProcessHandler(missingChatCtx, {
    chatId: "chat_1" as any,
    userMessageId: "msg_user" as any,
    assistantMessageIds: ["msg_assistant" as any],
    userId: "user_1",
  });
  assert.equal(scheduled.length, 0);

  const scheduledStepCtx = createMockCtx({
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.chatId) return { _id: "chat_1", title: "New chat" };
      if (args.messageId === "msg_user") {
        return { _id: "msg_user", source: "scheduled_step", content: "hello" };
      }
      return null;
    },
    scheduler: {
      runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
        scheduled.push(args);
      },
    },
  });

  await postProcessHandler(scheduledStepCtx, {
    chatId: "chat_1" as any,
    userMessageId: "msg_user" as any,
    assistantMessageIds: ["msg_assistant" as any],
    userId: "user_1",
  });
  assert.equal(scheduled.length, 0);
});

test("postProcessHandler schedules title generation and memory extraction with filtered assistant content", async () => {
  const scheduled: Array<Record<string, unknown>> = [];
  const ctx = createMockCtx({
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.chatId) return { _id: "chat_1", title: "New chat" };
      if (args.userId) {
        return {
          titleModelId: "openai/gpt-4.1-mini",
          isMemoryEnabled: true,
          memoryGatingMode: "manualConfirm",
          memoryExtractionModelId: "openai/gpt-4.1",
        };
      }
      if (args.messageId === "msg_user") {
        return {
          _id: "msg_user",
          source: "chat",
          content: "Remember that my favorite editor is neovim.",
        };
      }
      if (args.messageId === "msg_a1") {
        return { _id: "msg_a1", status: "completed", content: "Assistant result A" };
      }
      if (args.messageId === "msg_a2") {
        return { _id: "msg_a2", status: "failed", content: "Should be ignored" };
      }
      if (args.messageId === "msg_a3") {
        return { _id: "msg_a3", status: "completed", content: "   " };
      }
      return null;
    },
    scheduler: {
      runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
        scheduled.push(args);
      },
    },
  });

  await postProcessHandler(ctx, {
    chatId: "chat_1" as any,
    userMessageId: "msg_user" as any,
    assistantMessageIds: ["msg_a1" as any, "msg_a2" as any, "msg_a3" as any],
    userId: "user_1",
  });

  assert.equal(scheduled.length, 2);
  assert.deepEqual(scheduled[0], {
    chatId: "chat_1",
    sourceContent: "Remember that my favorite editor is neovim.",
    assistantContent: "Assistant result A",
    titleModel: "openai/gpt-4.1-mini",
    userId: "user_1",
    messageId: "msg_a1",
  });
  assert.deepEqual(scheduled[1], {
    chatId: "chat_1",
    userMessageContent: "Remember that my favorite editor is neovim.",
    userMessageId: "msg_user",
    assistantMessageId: "msg_a1",
    assistantContent: "Assistant result A",
    userId: "user_1",
    extractionModel: "openai/gpt-4.1",
    isPending: true,
  });
});

test("postProcessHandler skips memory extraction for short content, disabled memory, and disabled gating", async () => {
  const scheduledShort: Array<Record<string, unknown>> = [];
  const shortCtx = createMockCtx({
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.chatId) return { _id: "chat_1", title: "Project chat" };
      if (args.userId) return { isMemoryEnabled: true, memoryGatingMode: "automatic" };
      if (args.messageId === "msg_user") {
        return { _id: "msg_user", source: "chat", content: "short" };
      }
      return { _id: "msg_a1", status: "completed", content: "Done" };
    },
    scheduler: {
      runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
        scheduledShort.push(args);
      },
    },
  });
  await postProcessHandler(shortCtx, {
    chatId: "chat_1" as any,
    userMessageId: "msg_user" as any,
    assistantMessageIds: ["msg_a1" as any],
    userId: "user_1",
  });
  assert.equal(scheduledShort.length, 0);

  const scheduledDisabled: Array<Record<string, unknown>> = [];
  const disabledCtx = createMockCtx({
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.chatId) return { _id: "chat_1", title: "Project chat" };
      if (args.userId) return { isMemoryEnabled: false, memoryGatingMode: "automatic" };
      if (args.messageId === "msg_user") {
        return { _id: "msg_user", source: "chat", content: "Long enough for memory extraction." };
      }
      return { _id: "msg_a1", status: "completed", content: "Done" };
    },
    scheduler: {
      runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
        scheduledDisabled.push(args);
      },
    },
  });
  await postProcessHandler(disabledCtx, {
    chatId: "chat_1" as any,
    userMessageId: "msg_user" as any,
    assistantMessageIds: ["msg_a1" as any],
    userId: "user_1",
  });
  assert.equal(scheduledDisabled.length, 0);

  const scheduledGating: Array<Record<string, unknown>> = [];
  const gatingCtx = createMockCtx({
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.chatId) return { _id: "chat_1", title: "Project chat" };
      if (args.userId) return { isMemoryEnabled: true, memoryGatingMode: "disabled" };
      if (args.messageId === "msg_user") {
        return { _id: "msg_user", source: "chat", content: "Long enough for memory extraction." };
      }
      return { _id: "msg_a1", status: "completed", content: "Done" };
    },
    scheduler: {
      runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
        scheduledGating.push(args);
      },
    },
  });
  await postProcessHandler(gatingCtx, {
    chatId: "chat_1" as any,
    userMessageId: "msg_user" as any,
    assistantMessageIds: ["msg_a1" as any],
    userId: "user_1",
  });
  assert.equal(scheduledGating.length, 0);
});

test("generateTitleHandler overwrites placeholder or seed titles, stores ancillary cost, and respects latest-title guard", async () => {
  const mutations: Array<Record<string, unknown>> = [];
  const deps = createGenerateTitleHandlerDepsForTest({
    getRequiredUserOpenRouterApiKey: async () => "key",
    callOpenRouterNonStreaming: async () => ({
      content: "Typed Arrays in Swift",
      finishReason: "stop",
      audioBase64: "",
      audioTranscript: "",
      generationId: "gen_1",
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3, cost: 0.01 },
    }),
  });

  const ctx = createMockCtx({
    runQuery: async () => ({ _id: "chat_1", title: "New chat" }),
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
    },
  });

  await generateTitleHandler(ctx, {
    chatId: "chat_1" as any,
    sourceContent: "How do typed arrays behave in Swift?",
    assistantContent: "Here is how ArraySlice and UnsafeBufferPointer differ.",
    seedTitle: "How do typed arrays behave in Swift?",
    titleModel: "openai/gpt-4.1-mini",
    userId: "user_1",
    messageId: "msg_1" as any,
  }, deps);

  assert.equal(mutations.length, 2);
  assert.deepEqual(mutations[0], {
    messageId: "msg_1",
    chatId: "chat_1",
    userId: "user_1",
    modelId: "openai/gpt-4.1-mini",
    promptTokens: 1,
    completionTokens: 2,
    totalTokens: 3,
    cost: 0.01,
    source: "title",
    generationId: "gen_1",
  });
  assert.deepEqual(mutations[1], {
    chatId: "chat_1",
    title: "Typed Arrays in Swift",
  });

  const guardedMutations: Array<Record<string, unknown>> = [];
  let readCount = 0;
  const guardedCtx = createMockCtx({
    runQuery: async () => {
      readCount += 1;
      return readCount === 1
        ? { _id: "chat_2", title: "New chat" }
        : { _id: "chat_2", title: "Custom title" };
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      guardedMutations.push(args);
    },
  });

  await generateTitleHandler(guardedCtx, {
    chatId: "chat_2" as any,
    sourceContent: "Please summarize my build issue",
    userId: "user_1",
  }, deps);
  assert.equal(guardedMutations.length, 0);
});

test("generateTitleHandler no-ops for missing chats or user-edited titles and falls back when the model output is unusable", async () => {
  let modelCalls = 0;
  const deps = createGenerateTitleHandlerDepsForTest({
    getRequiredUserOpenRouterApiKey: async () => "key",
    callOpenRouterNonStreaming: async () => {
      modelCalls += 1;
      return {
        content: "new chat",
        finishReason: "stop",
        audioBase64: "",
        audioTranscript: "",
        generationId: null,
        usage: null,
      };
    },
  });

  const missingCtx = createMockCtx({
    runQuery: async () => null,
    runMutation: async () => undefined,
  });
  await generateTitleHandler(missingCtx, {
    chatId: "chat_1" as any,
    sourceContent: "Anything",
    userId: "user_1",
  }, deps);
  assert.equal(modelCalls, 0);

  const userEditedCtx = createMockCtx({
    runQuery: async () => ({ _id: "chat_1", title: "Already named by user" }),
    runMutation: async () => undefined,
  });
  await generateTitleHandler(userEditedCtx, {
    chatId: "chat_1" as any,
    sourceContent: "Anything",
    userId: "user_1",
  }, deps);
  assert.equal(modelCalls, 0);

  const fallbackMutations: Array<Record<string, unknown>> = [];
  const fallbackCtx = createMockCtx({
    runQuery: async () => ({ _id: "chat_3", title: "New chat" }),
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      fallbackMutations.push(args);
    },
  });
  await generateTitleHandler(fallbackCtx, {
    chatId: "chat_3" as any,
    sourceContent: "Build a recovery plan for nightly imports",
    userId: "user_1",
  }, deps);
  assert.equal(modelCalls, 1);
  assert.deepEqual(fallbackMutations, [{
    chatId: "chat_3",
    title: "Build a recovery plan for nightly",
  }]);
});

test("generateTitleHandler falls back to source-derived titles when the model call throws", async () => {
  const mutations: Array<Record<string, unknown>> = [];
  const deps = createGenerateTitleHandlerDepsForTest({
    getRequiredUserOpenRouterApiKey: async () => "key",
    callOpenRouterNonStreaming: async () => {
      throw new Error("upstream unavailable");
    },
  });

  const ctx = createMockCtx({
    runQuery: async () => ({ _id: "chat_4", title: "seed title" }),
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
    },
  });

  await generateTitleHandler(ctx, {
    chatId: "chat_4" as any,
    sourceContent: "",
    assistantContent: "Assistant fallback summary works too",
    seedTitle: "seed title",
    userId: "user_1",
  }, deps);

  assert.deepEqual(mutations, [{
    chatId: "chat_4",
    title: "Assistant fallback summary works too",
  }]);
});
