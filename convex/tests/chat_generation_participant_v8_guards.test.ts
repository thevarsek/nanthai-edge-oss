import assert from "node:assert/strict";
import test from "node:test";

import {
  generateForParticipant,
  shouldForceParticipantReasoningPatch,
  shouldInjectDateContext,
  shouldPersistParticipantReasoning,
} from "../chat/actions_run_generation_participant";

function makeArgs(overrides: Record<string, unknown> = {}) {
  return {
    chatId: "chat_1",
    userId: "user_1",
    userMessageId: "msg_user",
    assistantMessageIds: ["msg_assistant"],
    generationJobIds: ["job_1"],
    expandMultiModelGroups: false,
    webSearchEnabled: false,
    enabledIntegrations: [],
    ...overrides,
  } as any;
}

function makeParticipant(overrides: Record<string, unknown> = {}) {
  return {
    messageId: "msg_assistant",
    jobId: "job_1",
    modelId: "model_1",
    temperature: 0.7,
    maxTokens: null,
    includeReasoning: null,
    reasoningEffort: null,
    personaId: null,
    systemPrompt: null,
    ...overrides,
  } as any;
}

function makeCtx(overrides: {
  cancelled?: boolean;
  userPrefs?: Record<string, unknown> | null;
  documents?: unknown[];
} = {}) {
  const mutations: Array<{ args: Record<string, unknown> }> = [];
  return {
    mutations,
    ctx: {
      runQuery: async (_ref: unknown, queryArgs: Record<string, unknown>) => {
        if ("jobId" in queryArgs) return overrides.cancelled === true;
        if ("userId" in queryArgs && !("chatId" in queryArgs)) return overrides.userPrefs ?? null;
        return null;
      },
      runMutation: async (_ref: unknown, mutationArgs: Record<string, unknown>) => {
        mutations.push({ args: mutationArgs });
        if ("chatId" in mutationArgs && "userId" in mutationArgs && !("status" in mutationArgs)) {
          return overrides.documents ?? [];
        }
        return null;
      },
      scheduler: {
        runAfter: async () => "scheduled_1",
      },
      storage: {
        get: async () => null,
      },
    } as any,
  };
}

test("generateForParticipant exits before request assembly when the job was already cancelled", async () => {
  const { ctx, mutations } = makeCtx({ cancelled: true });

  const result = await generateForParticipant({
    ctx,
    args: makeArgs(),
    participant: makeParticipant(),
    allMessages: [],
    memoryContext: undefined,
    modelCapabilities: new Map(),
    isPro: true,
    runtimeProfile: "mobileBasic",
    apiKey: "key",
    actionStartTime: Date.now(),
  });

  assert.deepEqual(result, {
    deferredForSubagents: false,
    cancelled: true,
    failed: false,
    continued: false,
  });
  assert.equal(mutations.some((entry) => entry.args.status === "failed"), false);
});

test("generateForParticipant finalizes failed when request assembly produces no messages", async () => {
  const { ctx, mutations } = makeCtx();

  const result = await generateForParticipant({
    ctx,
    args: makeArgs(),
    participant: makeParticipant(),
    allMessages: [],
    memoryContext: undefined,
    modelCapabilities: new Map([["model_1", { supportedParameters: [], contextLength: 1024 } as any]]),
    isPro: true,
    runtimeProfile: "mobileBasic",
    apiKey: "key",
    actionStartTime: Date.now(),
    requestMessagesOverride: [],
  });

  assert.equal(result.failed, true);
  const finalize = mutations.find((entry) => entry.args.status === "failed");
  assert.match(String(finalize?.args.content), /No request messages to send/);
  assert.equal(finalize?.args.terminalErrorCode, "unknown_error");
});

test("generateForParticipant enforces ZDR before opening a model stream", async () => {
  const { ctx, mutations } = makeCtx({ userPrefs: { zdrEnabled: true } });

  const result = await generateForParticipant({
    ctx,
    args: makeArgs(),
    participant: makeParticipant(),
    allMessages: [{ _id: "msg_user", role: "user", content: "Hello" }],
    memoryContext: undefined,
    modelCapabilities: new Map([[
      "model_1",
      {
        provider: "openai",
        supportedParameters: [],
        contextLength: 1024,
        hasZdrEndpoint: false,
      } as any,
    ]]),
    isPro: true,
    runtimeProfile: "mobileBasic",
    apiKey: "key",
    actionStartTime: Date.now(),
    requestMessagesOverride: [{ role: "user", content: "Hello" }],
  });

  assert.equal(result.failed, true);
  const finalize = mutations.find((entry) => entry.args.status === "failed");
  assert.match(String(finalize?.args.content), /Zero Data Retention/);
});

test("generateForParticipant rejects Google Workspace data on disallowed providers", async () => {
  const { ctx, mutations } = makeCtx();

  const result = await generateForParticipant({
    ctx,
    args: makeArgs(),
    participant: makeParticipant(),
    allMessages: [{ _id: "msg_user", role: "user", content: "Summarize my Drive file" }],
    memoryContext: undefined,
    modelCapabilities: new Map([[
      "model_1",
      {
        provider: "mistral",
        supportedParameters: [],
        contextLength: 1024,
        hasZdrEndpoint: true,
      } as any,
    ]]),
    progressiveTools: {
      enabledIntegrations: ["drive"],
      allowSubagents: false,
    },
    isPro: true,
    runtimeProfile: "mobileBasic",
    apiKey: "key",
    actionStartTime: Date.now(),
    requestMessagesOverride: [{ role: "user", content: "Summarize my Drive file" }],
  });

  assert.equal(result.failed, true);
  const finalize = mutations.find((entry) => entry.args.status === "failed");
  assert.match(String(finalize?.args.content), /Google Workspace data/);
});

test("generation participant helpers cover date context and reasoning patch branches", () => {
  assert.equal(shouldPersistParticipantReasoning(""), false);
  assert.equal(shouldPersistParticipantReasoning("thinking"), true);

  assert.equal(shouldForceParticipantReasoningPatch("unfinished", false), false);
  assert.equal(shouldForceParticipantReasoningPatch("Sentence complete.", false), true);
  assert.equal(shouldForceParticipantReasoningPatch("anything", true), true);

  assert.equal(shouldInjectDateContext({ webSearchEnabled: true }), true);
  assert.equal(shouldInjectDateContext({
    webSearchEnabled: false,
    enabledIntegrations: ["calendar"],
  }), true);
  assert.equal(shouldInjectDateContext({
    webSearchEnabled: false,
    enabledIntegrations: ["gmail"],
    activeProfiles: ["microsoft"],
  }), true);
  assert.equal(shouldInjectDateContext({
    webSearchEnabled: false,
    loadedSkills: [{
      skill: "calendar_skill",
      instructions: "Use calendar context.",
      requiredIntegrationIds: ["apple_calendar"],
      requiredToolIds: [],
      requiredToolProfiles: [],
      requiredCapabilities: [],
    }],
  }), true);
  assert.equal(shouldInjectDateContext({
    webSearchEnabled: false,
    loadedSkills: [{
      skill: "scheduled_skill",
      instructions: "Use scheduled jobs context.",
      requiredIntegrationIds: [],
      requiredToolIds: [],
      requiredToolProfiles: ["scheduledJobs"],
      requiredCapabilities: [],
    }],
  }), true);
  assert.equal(shouldInjectDateContext({
    webSearchEnabled: false,
    enabledIntegrations: ["gmail"],
    activeProfiles: ["personas"],
    loadedSkills: [{
      skill: "plain_skill",
      instructions: "No date context required.",
      requiredIntegrationIds: ["gmail"],
      requiredToolIds: [],
      requiredToolProfiles: ["personas"],
      requiredCapabilities: [],
    }],
  }), false);
  assert.equal(shouldInjectDateContext({ webSearchEnabled: false }), false);
});
