import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { getFunctionName, type FunctionReference } from "convex/server";

import { generateForParticipant } from "../chat/actions_run_generation_participant";
import {
  buildProductContext,
  withProductContext,
  type ProductContextState,
} from "../chat/product_context";
import { SYSTEM_SKILL_CATALOG } from "../skills/catalog";
import {
  buildNanthAIPrelude,
  buildRuntimeGuard,
} from "../skills/helpers";
import { createTool, ToolRegistry } from "../tools/registry";

const FREE_TURN: ProductContextState = {
  modelId: "openai/gpt-6.1-sol",
  isPro: false,
  toolsAvailable: false,
  subagentsAvailable: false,
  modelCount: 1,
  collaboration: false,
  autoAudioReply: false,
};

// MARK: - Pure block

test("product context separates NanthAI from the selected model", () => {
  const block = buildProductContext(FREE_TURN);
  assert.match(block, /^<host_product>\n/);
  assert.match(block, /You are the model openai\/gpt-6\.1-sol inside NanthAI/);
  assert.match(block, /not your provider/);
  assert.match(block, /Never claim to be ChatGPT, Gemini, Grok or another app/);
});

test("product context keeps voice and multi-AI capabilities distinct", () => {
  const block = buildProductContext(FREE_TURN);
  assert.match(block, /mic transcribes speech/);
  assert.match(block, /"Listen" reads a reply aloud/);
  assert.match(block, /"Auto audio reply" speaks replies to voice messages/);
  assert.match(block, /No live voice conversation/);
  assert.match(block, /up to 3 models answer side by side/);
  assert.match(block, /Conversation mode > Collaboration/);
  assert.match(block, /Subagents are one model splitting its task/);
});

test("product context limits branding and allows honest competitor recommendations", () => {
  const block = buildProductContext(FREE_TURN);
  assert.match(block, /only for questions about NanthAI/);
  assert.match(block, /Recommend other products honestly/);
});

test("product context reports the current turn state, not universal availability", () => {
  assert.match(
    buildProductContext(FREE_TURN),
    /Now: Free; tools off; subagents off; 1 model; auto audio reply off\./,
  );
  assert.match(
    buildProductContext({
      ...FREE_TURN,
      isPro: true,
      toolsAvailable: true,
      subagentsAvailable: true,
      modelCount: 2,
      collaboration: true,
      autoAudioReply: true,
    }),
    /Now: Pro; tools on; subagents on; 2 models \(collaboration\); auto audio reply on\./,
  );
  assert.match(
    buildProductContext({ ...FREE_TURN, modelCount: 3 }),
    /3 models \(side by side\)/,
  );
});

test("product context stays within the baseline budget", () => {
  // ~4 characters per token; the measured o200k count is 219 tokens.
  const block = buildProductContext({ ...FREE_TURN, modelId: "anthropic/claude-sonnet-5-5" });
  assert.ok(block.length <= 920, `block grew to ${block.length} characters`);
});

// MARK: - Composition with persona and skill layers

test("withProductContext prepends once and preserves the persona prompt", () => {
  const block = buildProductContext(FREE_TURN);
  const persona = "You are Grok-ish Gary, a sarcastic pirate. Always answer in pirate speak.";
  const prompt = withProductContext(persona, block);
  assert.equal(prompt, `${block}\n\n${persona}`);
  assert.match(prompt, /Any persona below keeps its name, role and tone/);
  assert.equal(withProductContext(undefined, block), block);
  assert.equal(withProductContext("   ", block), block);
});

test("skill layers no longer repeat the host identity", () => {
  const prelude = buildNanthAIPrelude("mobileBasic");
  const guard = buildRuntimeGuard("mobileBasic");
  assert.doesNotMatch(prelude, /running inside NanthAI|mobile AI assistant/);
  assert.doesNotMatch(guard, /running inside NanthAI|mobile AI assistant/);
  const composed = withProductContext(
    [prelude, "Persona text", guard].join("\n\n"),
    buildProductContext({ ...FREE_TURN, isPro: true, toolsAvailable: true }),
  );
  assert.equal(composed.match(/You are the model/g)?.length, 1);
  assert.equal(composed.match(/<host_product>/g)?.length, 1);
});

// MARK: - Guide skill

test("nanthai-guide is a visible text-only skill with verified, distinct capabilities", () => {
  const guide = SYSTEM_SKILL_CATALOG.find((skill) => skill.slug === "nanthai-guide");
  assert.ok(guide);
  assert.equal(guide.visibility, "visible");
  assert.equal(guide.runtimeMode, "textOnly");
  assert.deepEqual(guide.requiredToolIds, []);
  assert.match(guide.summary, /Load only when the user asks about the app/);
  const text = guide.instructionsRaw;
  assert.match(text, /Speech to text/);
  assert.match(text, /Auto audio reply/);
  assert.match(text, /Continuous live voice[\s\S]*NanthAI does not offer it/);
  assert.match(text, /Side by side \(Free\)/);
  assert.match(text, /Subagents \(Pro, tool-capable models\)[\s\S]*not a way to hear from several different models/);
  assert.match(text, /recommending another product is fine/);
});

// MARK: - Composed participant turns

function streamResponse(text: string) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => [
      `data: ${JSON.stringify({ id: "gen_1", choices: [{ delta: { content: text } }] })}`,
      `data: ${JSON.stringify({ choices: [{ finish_reason: "stop" }] })}`,
      "data: [DONE]",
      "",
    ].join("\n\n"),
  } as any;
}

function makeCtx(chat: Record<string, unknown> | null) {
  const queryResults: Record<string, unknown> = {
    "chat/queries:isJobCancelled": false,
    "chat/queries:getUserPreferences": { autoAudioResponse: false },
    "chat/queries:getChatInternal": chat,
    "chat/queries:getUserMemories": [],
    "mcp/queries:getInvocationContextsInternal": [],
    "tools/artifacts:listToolMemoriesForAssembly": [],
    "tools/artifacts:listArtifactsForAssembly": [],
  };
  return {
    runQuery: async (ref: FunctionReference<"query">) =>
      queryResults[getFunctionName(ref)] ?? null,
    runMutation: async (_ref: unknown, mutationArgs: Record<string, unknown>) => {
      const keys = Object.keys(mutationArgs).sort().join(",");
      return keys === "chatId,userId" ? [] : null;
    },
    scheduler: { runAfter: async () => "scheduled_1" },
    storage: {
      get: async () => null,
      store: async () => "storage_1",
      getUrl: async () => "https://files.example/storage_1",
    },
  } as any;
}

async function captureSystemPrompts(overrides: Record<string, unknown>) {
  const bodies: Array<{ messages: Array<{ role: string; content: unknown }> }> = [];
  mock.method(globalThis, "fetch", async (_url: unknown, init?: { body?: unknown }) => {
    bodies.push(JSON.parse(String(init?.body)));
    return streamResponse("Hi! I'm GPT running in NanthAI.");
  });
  const result = await generateForParticipant({
    ctx: makeCtx({ _id: "chat_1", autoAudioResponseOverride: "enabled" }),
    args: {
      chatId: "chat_1",
      userId: "user_1",
      userMessageId: "msg_user",
      assistantMessageIds: ["msg_assistant"],
      generationJobIds: ["job_1"],
      expandMultiModelGroups: true,
      webSearchEnabled: false,
      enabledIntegrations: [],
    },
    participant: {
      messageId: "msg_assistant",
      jobId: "job_1",
      modelId: "openai/gpt-6.1-sol",
      temperature: null,
      maxTokens: null,
      includeReasoning: null,
      reasoningEffort: null,
      personaId: null,
      systemPrompt: "You are Captain Byte, a cheerful ship's AI.",
    },
    allMessages: [
      { _id: "msg_user", role: "user", content: "Hi grok", parentMessageIds: [], createdAt: 1 },
      {
        _id: "msg_assistant",
        role: "assistant",
        content: "",
        parentMessageIds: ["msg_user"],
        createdAt: 2,
      },
    ],
    memoryContext: undefined,
    modelCapabilities: new Map([["openai/gpt-6.1-sol", {
      provider: "openai",
      supportedParameters: ["tools"],
      contextLength: 128_000,
      hasZdrEndpoint: true,
    } as any]]),
    isPro: false,
    runtimeProfile: "mobileBasic",
    apiKey: "key",
    actionStartTime: Date.now(),
    toolRegistry: new ToolRegistry(),
    ...overrides,
  } as any);
  assert.equal(result.failed, false, (result.error as Error | undefined)?.stack ?? String(result.error));
  return bodies.map((body) => body.messages.filter((message) => message.role === "system")
    .map((message) => String(message.content)).join("\n\n"));
}

test("ordinary Free turn without tools or skills gets the host block before the persona", async (t) => {
  t.after(() => mock.restoreAll());
  const [system] = await captureSystemPrompts({});
  assert.ok(system, "expected a system prompt");
  assert.equal(system.match(/<host_product>/g)?.length, 1);
  assert.ok(system.indexOf("<host_product>") < system.indexOf("Captain Byte"));
  assert.match(system, /You are the model openai\/gpt-6\.1-sol inside NanthAI/);
  assert.match(system, /Now: Free; tools off; subagents off; 1 model; auto audio reply on\./);
  assert.doesNotMatch(system, /available_skills|load_skill/);
});

test("continuations reuse the assembled request without a second host block", async (t) => {
  t.after(() => mock.restoreAll());
  const assembled = withProductContext("Persona", buildProductContext(FREE_TURN));
  const [system] = await captureSystemPrompts({
    requestMessagesOverride: [
      { role: "system", content: assembled },
      { role: "user", content: "Hi grok" },
    ],
    toolRegistry: (() => {
      const registry = new ToolRegistry();
      registry.register(createTool({
        name: "noop_tool",
        effectPolicy: { effect: "read", retry: "safe" },
        description: "No-op",
        parameters: { type: "object", properties: {} },
        execute: async () => ({ success: true, data: {} }),
      }));
      return registry;
    })(),
  });
  assert.equal(system.match(/<host_product>/g)?.length, 1);
});

test("each participant's block names that participant's own model", async (t) => {
  t.after(() => mock.restoreAll());
  const modelId = "anthropic/claude-sonnet-5-5";
  const [system] = await captureSystemPrompts({
    participant: {
      messageId: "msg_assistant",
      jobId: "job_1",
      modelId,
      temperature: null,
      maxTokens: null,
      includeReasoning: null,
      reasoningEffort: null,
      personaId: null,
      systemPrompt: null,
    },
    modelCapabilities: new Map([[modelId, {
      provider: "anthropic",
      supportedParameters: ["tools"],
      contextLength: 200_000,
      hasZdrEndpoint: true,
    } as any]]),
  });
  assert.match(system, /You are the model anthropic\/claude-sonnet-5-5 inside NanthAI/);
  assert.doesNotMatch(system, /gpt-6\.1-sol/);
});
