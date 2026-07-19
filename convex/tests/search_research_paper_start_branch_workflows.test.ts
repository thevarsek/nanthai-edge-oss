import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";
import { startResearchPaper } from "../search/mutations_research_paper";

function buildCtx(options: {
  chat?: Record<string, unknown> | null;
  participants?: Record<string, unknown>[];
  titleModelId?: string | null;
} = {}) {
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const scheduled: Array<Record<string, unknown>> = [];
  const chat = options.chat === undefined
    ? { _id: "chat_1", userId: "user_1", messageCount: 1, activeBranchLeafId: "leaf_1" }
    : options.chat;
  return {
    inserts,
    patches,
    scheduled,
    ctx: {
      auth: { getUserIdentity: async () => ({ subject: "user_1" }) },
      db: {
        get: async (id: string) => id === "chat_1" ? chat : null,
        query: (table: string) => ({
          withIndex: () => ({
            first: async () => {
              if (table === "purchaseEntitlements") return { _id: "ent_1", userId: "user_1", status: "active" };
              if (table === "userPreferences") return { _id: "prefs_1", titleModelId: options.titleModelId };
              return null;
            },
            collect: async () => table === "chatParticipants"
              ? options.participants ?? [{ _id: "participant_1", chatId: "chat_1" }]
              : [],
            order: () => ({ take: async () => [] }),
          }),
        }),
        insert: async (table: string, value: Record<string, unknown>) => {
          const id = table === "messages"
            ? `message_${inserts.filter((entry) => entry.table === "messages").length + 1}`
            : `${table}_1`;
          inserts.push({ table, value });
          return id;
        },
        patch: async (id: string, patch: Record<string, unknown>) => {
          patches.push({ id, patch });
        },
      },
      scheduler: {
        runAfter: async (_delay: number, _ref: unknown, payload: Record<string, unknown>) => {
          scheduled.push(payload);
          return "scheduled_1";
        },
      },
      storage: { getUrl: async (storageId: string) => `https://files.example/${storageId}` },
    } as any,
  };
}

function args(overrides: Record<string, unknown> = {}) {
  return {
    chatId: "chat_1",
    text: "  Draft a rigorous literature review about edge AI.  ",
    participant: {
      modelId: "openai/gpt-5.2",
      personaId: null,
      personaName: null,
      systemPrompt: null,
      temperature: 0.4,
      maxTokens: 2000,
      includeReasoning: true,
      reasoningEffort: "medium",
    },
    complexity: 2,
    ...overrides,
  } as any;
}

test("startResearchPaper rejects invalid chat, participant, prompt, and audio states before scheduling", async () => {
  const cases = [
    { ctx: buildCtx({ chat: null }).ctx, args: args(), code: "NOT_FOUND" },
    { ctx: buildCtx({ chat: { _id: "chat_1", userId: "other_user" } }).ctx, args: args(), code: "NOT_FOUND" },
    {
      ctx: buildCtx({ participants: [{ _id: "p1" }, { _id: "p2" }] }).ctx,
      args: args(),
      code: "VALIDATION",
    },
    { ctx: buildCtx().ctx, args: args({ text: "   " }), code: "VALIDATION" },
    {
      ctx: buildCtx().ctx,
      args: args({
        recordedAudio: { storageId: "audio_recorded", transcript: "voice" },
        attachments: [{ type: "audio", url: "https://files.example/audio.mp3", mimeType: "audio/mpeg" }],
      }),
      code: "VALIDATION",
    },
    {
      ctx: buildCtx().ctx,
      args: args({
        complexity: 3,
        attachments: [{ type: "file", url: "https://files.example/source.pdf", mimeType: "application/pdf" }],
      }),
      code: "VALIDATION",
    },
  ];

  for (const testCase of cases) {
    await assert.rejects(
      (startResearchPaper as any)._handler(testCase.ctx, testCase.args),
      (error: unknown) => error instanceof ConvexError && error.data?.code === testCase.code,
    );
  }
});

test("startResearchPaper stores audio-attachment transcript fallback and truncates chat preview", async () => {
  const longPrompt = `${"A".repeat(240)} trailing text`;
  const state = buildCtx({
    chat: { _id: "chat_1", userId: "user_1", messageCount: 0 },
    titleModelId: "openai/gpt-title",
  });

  const result = await (startResearchPaper as any)._handler(state.ctx, args({
    text: longPrompt,
    complexity: 0.4,
    expandMultiModelGroups: false,
    enabledIntegrations: ["drive"],
    attachments: [{
      type: "audio",
      storageId: "audio_storage",
      mimeType: "audio/wav",
      name: "spoken brief.wav",
      sizeBytes: 1024,
    }],
  }));

  assert.deepEqual(result, {
    sessionId: "searchSessions_1",
    userMessageId: "message_1",
    assistantMessageId: "message_2",
  });
  const userMessage = state.inserts.find((entry) =>
    entry.table === "messages" && entry.value.role === "user"
  )?.value;
  assert.equal(userMessage?.audioTranscript, longPrompt);
  assert.equal((userMessage?.attachments as any[])?.[0]?.url, "https://files.example/audio_storage");
  const session = state.inserts.find((entry) => entry.table === "searchSessions")?.value;
  assert.equal(session?.complexity, 1);
  const assistantMessage = state.inserts.find((entry) =>
    entry.table === "messages" && entry.value.role === "assistant"
  )?.value;
  assert.deepEqual(assistantMessage?.retryContract, {
    participants: [{
      modelId: "openai/gpt-5.2",
      personaId: null,
      personaName: null,
      personaEmoji: null,
      personaAvatarImageUrl: null,
      systemPrompt: null,
      temperature: 0.4,
      maxTokens: 2000,
      includeReasoning: true,
      reasoningEffort: "medium",
    }],
    searchMode: "paper",
    searchComplexity: 1,
    enabledIntegrations: ["drive"],
    subagentsEnabled: false,
    turnSkillOverrides: undefined,
    turnIntegrationOverrides: undefined,
    videoConfig: undefined,
    imageConfig: undefined,
  });
  const chatPatch = state.patches.find((entry) => entry.id === "chat_1")?.patch;
  assert.equal(String(chatPatch?.lastMessagePreview).length, 200);
  assert.ok(state.scheduled.some((payload) =>
    payload.sessionId === "searchSessions_1"
    && payload.expandMultiModelGroups === false
    && (payload.enabledIntegrations as unknown[] | undefined)?.[0] === "drive"
  ));
  assert.ok(state.scheduled.some((payload) => payload.titleModel === "openai/gpt-title"));
});
