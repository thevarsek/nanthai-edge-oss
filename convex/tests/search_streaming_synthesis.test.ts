import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionName } from "convex/server";

import { internal } from "../_generated/api";
import {
  createSearchSynthesisDepsForTest,
  synthesizeWithStreaming,
} from "../search/actions_web_search_synthesis";
import { createMockCtx } from "../../test_helpers/convex_mock_ctx";

const listAllMessagesRef = getFunctionName(internal.chat.queries.listAllMessages);
const getPersonaRef = getFunctionName(internal.chat.queries.getPersona);
const getModelCapabilitiesRef = getFunctionName(internal.chat.queries.getModelCapabilities);

test("synthesizeWithStreaming injects citation guidance and finalizes reasoning-only outputs", async () => {
  const mutationCalls: Record<string, unknown>[] = [];
  const builtRequests: Record<string, unknown>[] = [];
  const gatedParams: Record<string, unknown>[] = [];
  const writer = {
    totalContent: "",
    totalReasoning: "",
    hasSeenContentDelta: false,
    handleContentDeltaBoundary: async () => undefined,
    appendContent: async (delta: string) => {
      writer.totalContent += delta;
      writer.hasSeenContentDelta = writer.hasSeenContentDelta || delta.length > 0;
    },
    patchContentIfNeeded: async () => undefined,
    appendReasoning: async (delta: string) => {
      writer.totalReasoning += delta;
    },
    patchReasoningIfNeeded: async () => undefined,
    flush: async () => undefined,
  };

  const deps = createSearchSynthesisDepsForTest({
    getRequiredUserOpenRouterApiKey: async () => "key",
    buildRequestMessages: (args: unknown) => {
      builtRequests.push(args as Record<string, unknown>);
      return [{ role: "user", content: "req" }] as any;
    },
    gateParameters: (params: unknown) => {
      gatedParams.push(params as Record<string, unknown>);
      return params as any;
    },
    clampMessageContent: (content: string) => content.trim(),
    createStreamWriter: () => writer as any,
    callOpenRouterStreaming: async (
      _apiKey: unknown,
      _modelId: unknown,
      _messages: unknown,
      _params: unknown,
      callbacks: unknown,
    ) => {
      await (callbacks as { onReasoningDelta?: (delta: string) => Promise<void> })
        ?.onReasoningDelta?.("Reasoning only");
      return {
        content: "",
        reasoning: "Reasoning only",
        usage: { promptTokens: 10, completionTokens: 3, totalTokens: 13, cost: 0.1 },
        finishReason: "stop",
        imageUrls: [],
        audioBase64: "",
        audioTranscript: "",
        toolCalls: [],
        annotations: [],
        generationId: "gen_1",
      };
    },
  });

  const ctx = createMockCtx({
    runQuery: async (ref: unknown) => {
      const refKey = getFunctionName(ref as any);
      if (refKey === listAllMessagesRef) {
        return [
          { _id: "msg_user", role: "user", content: "hello" },
          { _id: "msg_assistant", role: "assistant", content: "" },
        ];
      }
      if (refKey === getPersonaRef) {
        return { systemPrompt: "Persona prompt" };
      }
      if (refKey === getModelCapabilitiesRef) {
        return {
          supportedParameters: ["temperature", "maxTokens", "includeReasoning", "reasoningEffort"],
          hasImageGeneration: false,
          hasReasoning: true,
        };
      }
      throw new Error("unexpected query");
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutationCalls.push(args);
      return false;
    },
  });

  await synthesizeWithStreaming(
    ctx,
    {
      chatId: "chat_1",
      assistantMessageId: "msg_assistant",
      jobId: "job_1",
      userId: "user_1",
      query: "swift actors",
      modelId: "openai/gpt-5",
      personaId: "persona_1",
      expandMultiModelGroups: false,
    } as any,
    [{ query: "swift actors", success: true, content: "Actor info", citations: [] }],
    deps,
  );

  assert.match(builtRequests[0]?.systemPrompt as string, /cite/i);
  assert.equal(gatedParams[0]?.webSearchEnabled, false);
  assert.equal(mutationCalls.at(-1)?.content, "Model returned reasoning only.");
  assert.equal(mutationCalls.at(-1)?.reasoning, "Reasoning only");
});

test("synthesizeWithStreaming checks cancellation every ten deltas", async () => {
  let cancellationChecks = 0;

  const deps = createSearchSynthesisDepsForTest({
    getRequiredUserOpenRouterApiKey: async () => "key",
    buildRequestMessages: () => [{ role: "user", content: "req" }] as any,
    gateParameters: (params: unknown) => params as any,
    clampMessageContent: (content: string) => content,
    createStreamWriter: () => ({
      totalContent: "",
      totalReasoning: "",
      hasSeenContentDelta: false,
      handleContentDeltaBoundary: async () => undefined,
      appendContent: async () => undefined,
      patchContentIfNeeded: async () => undefined,
      appendReasoning: async () => undefined,
      patchReasoningIfNeeded: async () => undefined,
      flush: async () => undefined,
    }) as any,
    callOpenRouterStreaming: async (
      _apiKey: unknown,
      _modelId: unknown,
      _messages: unknown,
      _params: unknown,
      callbacks: unknown,
    ) => {
      for (let i = 0; i < 10; i += 1) {
        await (callbacks as { onDelta?: (delta: string) => Promise<void> })
          ?.onDelta?.("x");
      }
      return {
        content: "unused",
        reasoning: "",
        usage: null,
        finishReason: "stop",
        imageUrls: [],
        audioBase64: "",
        audioTranscript: "",
        toolCalls: [],
        annotations: [],
        generationId: null,
      };
    },
  });

  const ctx = createMockCtx({
    runQuery: async (ref: unknown, args?: unknown) => {
      const refKey = getFunctionName(ref as any);
      if (refKey === getModelCapabilitiesRef) {
        return {
          supportedParameters: ["temperature"],
          hasImageGeneration: false,
          hasReasoning: true,
        };
      }
      if (refKey === listAllMessagesRef) {
        return [
          { _id: "msg_user", role: "user", content: "hello" },
          { _id: "msg_assistant", role: "assistant", content: "" },
        ];
      }
      // isJobCancelled (now an internalQuery)
      if (args && typeof args === "object" && "jobId" in (args as Record<string, unknown>)) {
        cancellationChecks += 1;
        return true;
      }
      throw new Error("unexpected query");
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      if ("messageId" in args) {
        throw new Error("unexpected mutation");
      }
      throw new Error("unexpected mutation");
    },
  });

  await assert.rejects(
    () =>
      synthesizeWithStreaming(
        ctx,
        {
          chatId: "chat_1",
          assistantMessageId: "msg_assistant",
          jobId: "job_1",
          userId: "user_1",
          query: "swift actors",
          modelId: "openai/gpt-5",
          expandMultiModelGroups: false,
        } as any,
        [{ query: "swift actors", success: true, content: "Actor info", citations: [] }],
        deps,
      ),
    /cancelled/i,
  );

  assert.equal(cancellationChecks, 1);
});
