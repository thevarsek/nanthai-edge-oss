import assert from "node:assert/strict";
import test from "node:test";

import {
  getModelCapabilitiesHandler,
  getPersonaHandler,
  getVideoJobInternalHandler,
  searchMessagesInternalHandler,
} from "../chat/queries_handlers_internal";

function queryChain(rows: any[]) {
  return {
    withIndex: (_index: string, apply?: (q: any) => unknown) => {
      const q = { eq: () => q };
      apply?.(q);
      return queryChain(rows);
    },
    withSearchIndex: (_index: string, apply?: (q: any) => unknown) => {
      const q = { search: () => q, eq: () => q };
      apply?.(q);
      return queryChain(rows);
    },
    order: () => queryChain(rows),
    first: async () => rows[0] ?? null,
    collect: async () => rows,
    take: async (limit: number) => rows.slice(0, limit),
  };
}

test("getModelCapabilities returns null for missing models and derives media capability defaults", async () => {
  const missing = await getModelCapabilitiesHandler({
    db: { query: () => queryChain([]) },
  } as any, { modelId: "missing" });
  assert.equal(missing, null);

  const caps = await getModelCapabilitiesHandler({
    db: {
      query: () => queryChain([{
        provider: "openai",
        supportedParameters: ["include_reasoning"],
        architecture: { modality: "audio+video->audio" },
        supportsImages: true,
        supportsVideo: true,
        hasZdrEndpoint: true,
        contextLength: 128000,
        videoCapabilities: {
          supportedResolutions: ["720p"],
          supportedAspectRatios: ["16:9"],
          supportedDurations: [8],
          supportedFrameImages: ["first"],
          supportedSizes: ["1280x720"],
          generateAudio: true,
          seed: false,
        },
      }]),
    },
  } as any, { modelId: "model_1" });

  assert.equal(caps?.hasAudioInput, true);
  assert.equal(caps?.hasVideoInput, true);
  assert.equal(caps?.hasAudioOutput, true);
  assert.equal(caps?.hasReasoning, true);
  assert.deepEqual(caps?.videoCapabilities?.supportedDurations, [8]);

  const sparse = await getModelCapabilitiesHandler({
    db: { query: () => queryChain([{ provider: "unknown" }]) },
  } as any, { modelId: "model_sparse" });
  assert.equal(sparse?.hasAudioInput, false);
  assert.equal(sparse?.hasImageGeneration, false);
  assert.equal(sparse?.videoCapabilities, undefined);
});

test("getPersona falls back after invalid direct IDs and resolves optional avatar URLs", async () => {
  const persona = await getPersonaHandler({
    db: {
      get: async () => {
        throw new Error("invalid id");
      },
      query: () => queryChain([{
        _id: "persona_1",
        userId: "user_1",
        displayName: "Researcher",
        avatarImageStorageId: "storage_avatar",
      }]),
    },
    storage: {
      getUrl: async () => null,
    },
  } as any, { personaId: "persona_1", userId: "user_1" });

  assert.equal(persona?.displayName, "Researcher");
  assert.equal(persona?.avatarImageUrl, undefined);

  const missing = await getPersonaHandler({
    db: {
      get: async () => ({ _id: "persona_2", userId: "other" }),
      query: () => queryChain([]),
    },
    storage: { getUrl: async () => "unused" },
  } as any, { personaId: "persona_2", userId: "user_1" });
  assert.equal(missing, null);
});

test("searchMessagesInternal clamps limits, filters unusable rows, caches chat lookups, and truncates snippets", async () => {
  const chatLookups: string[] = [];
  const searchRows = [
    { _id: "msg_empty", chatId: "chat_1", userId: "user_1", role: "user", content: "", createdAt: 1 },
    { _id: "msg_system", chatId: "chat_1", userId: "user_1", role: "system", content: "hidden", createdAt: 2 },
    { _id: "msg_foreign", chatId: "chat_foreign", userId: "user_1", role: "assistant", content: "foreign", createdAt: 3 },
    { _id: "msg_long", chatId: "chat_1", userId: "user_1", role: "assistant", content: "x".repeat(305), createdAt: 4 },
    { _id: "msg_cached", chatId: "chat_1", userId: "user_1", role: "user", content: "second hit", createdAt: 5 },
  ];
  const result = await searchMessagesInternalHandler({
    db: {
      query: () => queryChain(searchRows),
      get: async (id: string) => {
        chatLookups.push(id);
        if (id === "chat_1") return { _id: "chat_1", userId: "user_1", title: undefined };
        if (id === "chat_foreign") return { _id: "chat_foreign", userId: "other", title: "Other" };
        return null;
      },
    },
  } as any, { userId: "user_1", searchQuery: "hit", limit: 100.8 });

  assert.equal(result.length, 2);
  assert.equal(result[0].chatTitle, "Untitled Chat");
  assert.equal(result[0].messageContent.length, 303);
  assert.equal(result[0].messageContent.endsWith("..."), true);
  assert.deepEqual(chatLookups, ["chat_foreign", "chat_1"]);
});

test("getVideoJobInternal returns the stored video job row", async () => {
  const result = await getVideoJobInternalHandler({
    db: { get: async (id: string) => ({ _id: id, status: "completed" }) },
  } as any, { videoJobId: "video_1" as any });

  assert.deepEqual(result, { _id: "video_1", status: "completed" });
});
