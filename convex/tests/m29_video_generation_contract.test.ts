import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";
import {
  createFavorite,
  updateFavorite,
} from "../favorites/mutations";
import {
  getVideoJobStatusHandler,
  listKnowledgeBaseFilesHandler,
} from "../chat/queries_handlers_public";
import {
  persistGeneratedImageUrls,
  persistGeneratedImageUrlsWithTracking,
} from "../chat/action_image_helpers";
import {
  snapToSupportedDuration,
  snapToSupportedAspectRatio,
  snapToSupportedResolution,
} from "../chat/actions_video_generation";

// =============================================================================
// Helpers
// =============================================================================

function buildAuth(userId: string | null = "user_1") {
  return {
    getUserIdentity: async () => (userId ? { subject: userId } : null),
  };
}

/**
 * Build a mock DB where queries on different tables return different results.
 * `tableData` maps table names to arrays of records (for .collect()) or
 * single records (for .first()).
 */
function buildMultiTableDb(tableData: Record<string, any[]>) {
  return {
    query: (table: string) => ({
      withIndex: () => ({
        collect: async () => tableData[table] ?? [],
        first: async () => (tableData[table] ?? [])[0] ?? null,
        order: (dir: string) => ({
          take: async (n: number) => (tableData[table] ?? []).slice(0, n),
        }),
      }),
    }),
  };
}

/**
 * Build a mock DB for favorites modality tests where cachedModels lookups
 * resolve based on modelId captured from the index callback.
 */
function buildFavoritesDbWithModels(
  existingFavorites: any[],
  models: Record<string, any>,
) {
  return {
    query: (table: string) => ({
      withIndex: (_name: string, fn?: (q: any) => any) => {
        if (table === "favorites") {
          return {
            collect: async () => existingFavorites,
            first: async () => existingFavorites[0] ?? null,
          };
        }
        // cachedModels lookup by modelId
        let capturedModelId: string | undefined;
        if (fn) {
          const q = {
            eq: (_field: string, value: string) => {
              capturedModelId = value;
              return q;
            },
          };
          fn(q);
        }
        return {
          collect: async () => {
            const m = capturedModelId ? models[capturedModelId] : undefined;
            return m ? [m] : [];
          },
          first: async () =>
            capturedModelId ? models[capturedModelId] ?? null : null,
        };
      },
    }),
    insert: async (_table: string, _value: Record<string, unknown>) => "fav_new",
    get: async (id: string) => {
      const fav = existingFavorites.find((f: any) => f._id === id);
      return fav ?? null;
    },
    patch: async (_id: string, _patch: any) => {},
  };
}

// =============================================================================
// Phase 0.6: getVideoJobStatusHandler
// =============================================================================

test("getVideoJobStatusHandler returns null when unauthenticated", async () => {
  const result = await getVideoJobStatusHandler(
    {
      auth: buildAuth(null),
      db: buildMultiTableDb({}),
    } as any,
    { messageId: "msg_1" as any },
  );
  assert.equal(result, null);
});

test("getVideoJobStatusHandler returns null when no video job exists for message", async () => {
  const result = await getVideoJobStatusHandler(
    {
      auth: buildAuth(),
      db: buildMultiTableDb({ videoJobs: [] }),
    } as any,
    { messageId: "msg_1" as any },
  );
  assert.equal(result, null);
});

test("getVideoJobStatusHandler returns null when video job belongs to different user", async () => {
  const result = await getVideoJobStatusHandler(
    {
      auth: buildAuth("user_1"),
      db: buildMultiTableDb({
        videoJobs: [{
          messageId: "msg_1",
          userId: "user_2",
          status: "polling",
          pollCount: 3,
          model: "bytedance/seedance-2.0",
          createdAt: 1000,
        }],
      }),
    } as any,
    { messageId: "msg_1" as any },
  );
  assert.equal(result, null);
});

test("getVideoJobStatusHandler returns correct shape for owned video job", async () => {
  const result = await getVideoJobStatusHandler(
    {
      auth: buildAuth("user_1"),
      db: buildMultiTableDb({
        videoJobs: [{
          messageId: "msg_1",
          userId: "user_1",
          status: "polling",
          pollCount: 5,
          model: "bytedance/seedance-2.0",
          createdAt: 1000,
          lastPolledAt: 2000,
          error: undefined,
        }],
      }),
    } as any,
    { messageId: "msg_1" as any },
  );

  assert.deepEqual(result, {
    status: "polling",
    pollCount: 5,
    model: "bytedance/seedance-2.0",
    createdAt: 1000,
    lastPolledAt: 2000,
    error: undefined,
  });
});

test("getVideoJobStatusHandler includes error field when present", async () => {
  const result = await getVideoJobStatusHandler(
    {
      auth: buildAuth("user_1"),
      db: buildMultiTableDb({
        videoJobs: [{
          messageId: "msg_1",
          userId: "user_1",
          status: "failed",
          pollCount: 10,
          model: "google/veo-3.1",
          createdAt: 1000,
          lastPolledAt: 5000,
          error: "Generation timeout",
        }],
      }),
    } as any,
    { messageId: "msg_1" as any },
  );

  assert.equal(result?.status, "failed");
  assert.equal(result?.error, "Generation timeout");
  assert.equal(result?.pollCount, 10);
});

test("getVideoJobStatusHandler omits lastPolledAt when not present", async () => {
  const result = await getVideoJobStatusHandler(
    {
      auth: buildAuth("user_1"),
      db: buildMultiTableDb({
        videoJobs: [{
          messageId: "msg_1",
          userId: "user_1",
          status: "submitted",
          pollCount: 0,
          model: "bytedance/seedance-2.0-fast",
          createdAt: 1000,
        }],
      }),
    } as any,
    { messageId: "msg_1" as any },
  );

  assert.equal(result?.status, "submitted");
  assert.equal(result?.lastPolledAt, undefined);
  assert.equal(result?.pollCount, 0);
});

// =============================================================================
// Phase 0.7: Favorites modality validation
// =============================================================================

test("createFavorite allows single-model favorites without modality check", async () => {
  const result = await (createFavorite as any)._handler(
    {
      auth: buildAuth(),
      db: buildFavoritesDbWithModels([], {}),
    },
    { name: "Solo", modelIds: ["openai/gpt-4o"] },
  );
  assert.equal(result, "fav_new");
});

test("createFavorite allows same-modality text models", async () => {
  const result = await (createFavorite as any)._handler(
    {
      auth: buildAuth(),
      db: buildFavoritesDbWithModels([], {
        "openai/gpt-4o": { architecture: { modality: "text->text" } },
        "anthropic/claude-3.5-sonnet": { architecture: { modality: "text+image->text" } },
      }),
    },
    { name: "Text Duo", modelIds: ["openai/gpt-4o", "anthropic/claude-3.5-sonnet"] },
  );
  assert.equal(result, "fav_new");
});

test("createFavorite rejects text + video model mix", async () => {
  await assert.rejects(
    (createFavorite as any)._handler(
      {
        auth: buildAuth(),
        db: buildFavoritesDbWithModels([], {
          "openai/gpt-4o": { architecture: { modality: "text->text" } },
          "bytedance/seedance-2.0": {
            supportsVideo: true,
            architecture: { modality: "text+image->video" },
          },
        }),
      },
      { name: "Bad Mix", modelIds: ["openai/gpt-4o", "bytedance/seedance-2.0"] },
    ),
    (error: unknown) => {
      assert.ok(error instanceof ConvexError);
      const data = (error as ConvexError<any>).data;
      assert.equal(data.code, "INVALID_ARGS");
      assert.ok(data.message.includes("cannot be mixed"));
      return true;
    },
  );
});

test("createFavorite rejects text + image model mix", async () => {
  await assert.rejects(
    (createFavorite as any)._handler(
      {
        auth: buildAuth(),
        db: buildFavoritesDbWithModels([], {
          "openai/gpt-4o": { architecture: { modality: "text->text" } },
          "openai/dall-e-3": {
            supportsImages: true,
            architecture: { modality: "text->image" },
          },
        }),
      },
      { name: "Bad Mix", modelIds: ["openai/gpt-4o", "openai/dall-e-3"] },
    ),
    (error: unknown) => {
      assert.ok(error instanceof ConvexError);
      const data = (error as ConvexError<any>).data;
      assert.equal(data.code, "INVALID_ARGS");
      assert.ok(data.message.includes("cannot be mixed"));
      return true;
    },
  );
});

test("createFavorite rejects image + video model mix", async () => {
  await assert.rejects(
    (createFavorite as any)._handler(
      {
        auth: buildAuth(),
        db: buildFavoritesDbWithModels([], {
          "openai/dall-e-3": {
            supportsImages: true,
            architecture: { modality: "text->image" },
          },
          "bytedance/seedance-2.0": {
            supportsVideo: true,
            architecture: { modality: "text+image->video" },
          },
        }),
      },
      { name: "Bad Mix", modelIds: ["openai/dall-e-3", "bytedance/seedance-2.0"] },
    ),
    (error: unknown) => {
      assert.ok(error instanceof ConvexError);
      assert.ok((error as ConvexError<any>).data.message.includes("cannot be mixed"));
      return true;
    },
  );
});

test("updateFavorite rejects mixed modality when modelIds are updated", async () => {
  const existing = [
    { _id: "fav_1", userId: "user_1", sortOrder: 0, modelIds: ["openai/gpt-4o"] },
  ];

  await assert.rejects(
    (updateFavorite as any)._handler(
      {
        auth: buildAuth(),
        db: buildFavoritesDbWithModels(existing, {
          "openai/gpt-4o": { architecture: { modality: "text->text" } },
          "bytedance/seedance-2.0": {
            supportsVideo: true,
            architecture: { modality: "text+image->video" },
          },
        }),
      },
      {
        favoriteId: "fav_1",
        modelIds: ["openai/gpt-4o", "bytedance/seedance-2.0"],
      },
    ),
    (error: unknown) => {
      assert.ok(error instanceof ConvexError);
      assert.equal((error as ConvexError<any>).data.code, "INVALID_ARGS");
      assert.ok((error as ConvexError<any>).data.message.includes("cannot be mixed"));
      return true;
    },
  );
});

test("updateFavorite allows same-modality update", async () => {
  const existing = [
    { _id: "fav_1", userId: "user_1", sortOrder: 0, modelIds: ["openai/gpt-4o"] },
  ];
  const patches: any[] = [];

  const db = buildFavoritesDbWithModels(existing, {
    "openai/gpt-4o": { architecture: { modality: "text->text" } },
    "anthropic/claude-3.5-sonnet": { architecture: { modality: "text+image->text" } },
  });
  db.patch = async (_id: string, patch: any) => { patches.push(patch); };

  await (updateFavorite as any)._handler(
    { auth: buildAuth(), db },
    {
      favoriteId: "fav_1",
      modelIds: ["openai/gpt-4o", "anthropic/claude-3.5-sonnet"],
    },
  );

  assert.equal(patches.length, 1);
  assert.deepEqual(patches[0].modelIds, ["openai/gpt-4o", "anthropic/claude-3.5-sonnet"]);
});

test("updateFavorite skips modality check when modelIds not provided", async () => {
  const existing = [
    { _id: "fav_1", userId: "user_1", sortOrder: 0, modelIds: ["openai/gpt-4o"] },
  ];
  const patches: any[] = [];

  const db = buildFavoritesDbWithModels(existing, {});
  db.patch = async (_id: string, patch: any) => { patches.push(patch); };

  // Only updating name, not modelIds — should skip modality validation entirely
  await (updateFavorite as any)._handler(
    { auth: buildAuth(), db },
    { favoriteId: "fav_1", name: "Renamed" },
  );

  assert.equal(patches.length, 1);
  assert.equal(patches[0].name, "Renamed");
});

// =============================================================================
// Phase 0.8: persistGeneratedImageUrlsWithTracking
// =============================================================================

test("persistGeneratedImageUrlsWithTracking returns empty arrays for empty input", async () => {
  const result = await persistGeneratedImageUrlsWithTracking(
    {
      storage: {
        store: async () => { throw new Error("should not be called"); },
        get: async () => null,
        getUrl: async () => null,
      },
    } as any,
    [],
  );
  assert.deepEqual(result, { urls: [], stored: [] });
});

test("persistGeneratedImageUrlsWithTracking passes through HTTP URLs without storing", async () => {
  const result = await persistGeneratedImageUrlsWithTracking(
    {
      storage: {
        store: async () => { throw new Error("should not store HTTP URLs"); },
        get: async () => null,
        getUrl: async () => null,
      },
    } as any,
    ["https://example.com/image.png", "https://cdn.other.com/photo.jpg"],
  );

  assert.deepEqual(result.urls, [
    "https://example.com/image.png",
    "https://cdn.other.com/photo.jpg",
  ]);
  assert.deepEqual(result.stored, []);
});

test("persistGeneratedImageUrlsWithTracking stores base64 images and returns metadata", async () => {
  const storedBlobs: Blob[] = [];
  let storeCount = 0;

  const result = await persistGeneratedImageUrlsWithTracking(
    {
      storage: {
        store: async (blob: Blob) => {
          storedBlobs.push(blob);
          storeCount++;
          return `storage_${storeCount}` as any;
        },
        get: async () => null,
        getUrl: async (storageId: string) => `https://cdn.example/${storageId}`,
      },
    } as any,
    ["data:image/png;base64,AAEC", "data:image/jpeg;base64,/9j/"],
  );

  assert.equal(storedBlobs.length, 2);
  assert.equal(result.urls.length, 2);
  assert.equal(result.stored.length, 2);

  // First image
  assert.equal(result.stored[0].storageId, "storage_1");
  assert.equal(result.stored[0].mimeType, "image/png");
  assert.ok(result.stored[0].sizeBytes > 0);

  // Second image
  assert.equal(result.stored[1].storageId, "storage_2");
  assert.equal(result.stored[1].mimeType, "image/jpeg");
});

test("persistGeneratedImageUrlsWithTracking returns mixed HTTP and stored results", async () => {
  let storeCount = 0;

  const result = await persistGeneratedImageUrlsWithTracking(
    {
      storage: {
        store: async () => {
          storeCount++;
          return `storage_${storeCount}` as any;
        },
        get: async () => null,
        getUrl: async (storageId: string) => `https://cdn.example/${storageId}`,
      },
    } as any,
    [
      "https://example.com/existing.png",
      "data:image/webp;base64,AQID",
    ],
  );

  assert.equal(result.urls.length, 2);
  assert.equal(result.urls[0], "https://example.com/existing.png");
  assert.ok(result.urls[1].includes("cdn.example"));

  // Only the base64 image was stored
  assert.equal(result.stored.length, 1);
  assert.equal(result.stored[0].mimeType, "image/webp");
});

test("persistGeneratedImageUrlsWithTracking deduplicates URLs", async () => {
  let storeCount = 0;

  const result = await persistGeneratedImageUrlsWithTracking(
    {
      storage: {
        store: async () => {
          storeCount++;
          return `storage_${storeCount}` as any;
        },
        get: async () => null,
        getUrl: async (storageId: string) => `https://cdn.example/${storageId}`,
      },
    } as any,
    [
      "https://example.com/a.png",
      "https://example.com/a.png",
    ],
  );

  assert.equal(result.urls.length, 1);
  assert.equal(result.stored.length, 0);
});

test("persistGeneratedImageUrlsWithTracking skips oversized images", async () => {
  const result = await persistGeneratedImageUrlsWithTracking(
    {
      storage: {
        store: async () => { throw new Error("should not store oversized"); },
        get: async () => null,
        getUrl: async () => null,
      },
    } as any,
    // 30MB base64 payload (over 20MB limit)
    ["data:image/png;base64," + "A".repeat(30_000_000)],
  );

  assert.equal(result.urls.length, 0);
  assert.equal(result.stored.length, 0);
});

test("persistGeneratedImageUrls wrapper returns only URLs (backwards compatibility)", async () => {
  let storeCount = 0;

  const result = await persistGeneratedImageUrls(
    {
      storage: {
        store: async () => {
          storeCount++;
          return `storage_${storeCount}` as any;
        },
        get: async () => null,
        getUrl: async (storageId: string) => `https://cdn.example/${storageId}`,
      },
    } as any,
    ["https://example.com/a.png", "data:image/png;base64,AAEC"],
  );

  // Should be a flat string array (not the rich object)
  assert.ok(Array.isArray(result));
  assert.equal(typeof result[0], "string");
  assert.equal(result.length, 2);
});

// =============================================================================
// Phase 0.8: listKnowledgeBaseFilesHandler — generatedMedia integration
// =============================================================================

function buildKBDb(tableData: Record<string, any[]>) {
  return {
    query: (table: string) => ({
      withIndex: () => ({
        order: (_dir: string) => ({
          take: async (n: number) => (tableData[table] ?? []).slice(0, n),
        }),
      }),
    }),
  };
}

test("listKnowledgeBaseFilesHandler includes generatedMedia video rows", async () => {
  const result = await listKnowledgeBaseFilesHandler(
    {
      auth: buildAuth(),
      db: buildKBDb({
        generatedFiles: [],
        generatedMedia: [
          {
            _id: "gm_1",
            userId: "user_1",
            storageId: "stor_v1",
            type: "video",
            mimeType: "video/mp4",
            sizeBytes: 1100000,
            chatId: "chat_1",
            messageId: "msg_1",
            createdAt: 2000,
          },
        ],
        fileAttachments: [],
      }),
      storage: {
        getUrl: async (id: string) => `https://cdn.example/${id}`,
      },
    } as any,
    { source: "generated" },
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].mimeType, "video/mp4");
  assert.equal(result[0].filename, "generated-video.mp4");
  assert.equal(result[0].source, "generated");
  assert.equal(result[0].toolName, "video_generation");
  assert.equal(result[0].downloadUrl, "https://cdn.example/stor_v1");
});

test("listKnowledgeBaseFilesHandler includes generatedMedia image rows", async () => {
  const result = await listKnowledgeBaseFilesHandler(
    {
      auth: buildAuth(),
      db: buildKBDb({
        generatedFiles: [],
        generatedMedia: [
          {
            _id: "gm_2",
            userId: "user_1",
            storageId: "stor_img1",
            type: "image",
            mimeType: "image/png",
            sizeBytes: 50000,
            chatId: "chat_1",
            messageId: "msg_2",
            createdAt: 3000,
          },
        ],
        fileAttachments: [],
      }),
      storage: {
        getUrl: async (id: string) => `https://cdn.example/${id}`,
      },
    } as any,
    { source: "generated" },
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].mimeType, "image/png");
  assert.equal(result[0].filename, "generated-image.png");
  assert.equal(result[0].toolName, "image_generation");
});

test("listKnowledgeBaseFilesHandler merges generatedFiles and generatedMedia", async () => {
  const result = await listKnowledgeBaseFilesHandler(
    {
      auth: buildAuth(),
      db: buildKBDb({
        generatedFiles: [
          {
            _id: "gf_1",
            userId: "user_1",
            storageId: "stor_doc1",
            filename: "report.docx",
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            sizeBytes: 10000,
            toolName: "document_generation",
            chatId: "chat_1",
            messageId: "msg_1",
            createdAt: 1000,
          },
        ],
        generatedMedia: [
          {
            _id: "gm_1",
            userId: "user_1",
            storageId: "stor_vid1",
            type: "video",
            mimeType: "video/mp4",
            sizeBytes: 1100000,
            chatId: "chat_1",
            messageId: "msg_2",
            createdAt: 2000,
          },
        ],
        fileAttachments: [],
      }),
      storage: {
        getUrl: async (id: string) => `https://cdn.example/${id}`,
      },
    } as any,
    { source: "generated" },
  );

  // Should be sorted by createdAt desc: video first (2000), then doc (1000)
  assert.equal(result.length, 2);
  assert.equal(result[0].mimeType, "video/mp4");
  assert.equal(result[1].filename, "report.docx");
});

test("listKnowledgeBaseFilesHandler deduplicates by storageId across generatedFiles and generatedMedia", async () => {
  const result = await listKnowledgeBaseFilesHandler(
    {
      auth: buildAuth(),
      db: buildKBDb({
        generatedFiles: [
          {
            _id: "gf_1",
            userId: "user_1",
            storageId: "stor_shared",
            filename: "output.png",
            mimeType: "image/png",
            sizeBytes: 5000,
            toolName: "image_tool",
            chatId: "chat_1",
            messageId: "msg_1",
            createdAt: 1000,
          },
        ],
        generatedMedia: [
          {
            _id: "gm_1",
            userId: "user_1",
            storageId: "stor_shared", // same storageId
            type: "image",
            mimeType: "image/png",
            sizeBytes: 5000,
            chatId: "chat_1",
            messageId: "msg_1",
            createdAt: 1000,
          },
        ],
        fileAttachments: [],
      }),
      storage: {
        getUrl: async (id: string) => `https://cdn.example/${id}`,
      },
    } as any,
    { source: "generated" },
  );

  // Deduplication should reduce to 1
  assert.equal(result.length, 1);
});

test("listKnowledgeBaseFilesHandler excludes generatedMedia when source is 'upload'", async () => {
  const result = await listKnowledgeBaseFilesHandler(
    {
      auth: buildAuth(),
      db: buildKBDb({
        generatedFiles: [],
        generatedMedia: [
          {
            _id: "gm_1",
            userId: "user_1",
            storageId: "stor_vid1",
            type: "video",
            mimeType: "video/mp4",
            sizeBytes: 1100000,
            chatId: "chat_1",
            messageId: "msg_1",
            createdAt: 2000,
          },
        ],
        fileAttachments: [
          {
            _id: "fa_1",
            userId: "user_1",
            storageId: "stor_up1",
            filename: "photo.jpg",
            mimeType: "image/jpeg",
            sizeBytes: 3000,
            chatId: "chat_1",
            messageId: "msg_1",
            createdAt: 1000,
          },
        ],
      }),
      storage: {
        getUrl: async (id: string) => `https://cdn.example/${id}`,
      },
    } as any,
    { source: "upload" },
  );

  // Only uploads, no generated media
  assert.equal(result.length, 1);
  assert.equal(result[0].source, "upload");
  assert.equal(result[0].filename, "photo.jpg");
});

test("listKnowledgeBaseFilesHandler includes generatedMedia in 'all' source filter", async () => {
  const result = await listKnowledgeBaseFilesHandler(
    {
      auth: buildAuth(),
      db: buildKBDb({
        generatedFiles: [],
        generatedMedia: [
          {
            _id: "gm_1",
            userId: "user_1",
            storageId: "stor_vid1",
            type: "video",
            mimeType: "video/mp4",
            sizeBytes: 1100000,
            chatId: "chat_1",
            messageId: "msg_1",
            createdAt: 2000,
          },
        ],
        fileAttachments: [
          {
            _id: "fa_1",
            userId: "user_1",
            storageId: "stor_up1",
            filename: "photo.jpg",
            mimeType: "image/jpeg",
            sizeBytes: 3000,
            chatId: "chat_1",
            messageId: "msg_2",
            createdAt: 1000,
          },
        ],
      }),
      storage: {
        getUrl: async (id: string) => `https://cdn.example/${id}`,
      },
    } as any,
    { source: "all" },
  );

  assert.equal(result.length, 2);
  // Sorted desc: video (2000), upload (1000)
  assert.equal(result[0].mimeType, "video/mp4");
  assert.equal(result[1].filename, "photo.jpg");
});

test("listKnowledgeBaseFilesHandler returns empty for unauthenticated user", async () => {
  const result = await listKnowledgeBaseFilesHandler(
    {
      auth: buildAuth(null),
      db: buildKBDb({ generatedFiles: [], generatedMedia: [], fileAttachments: [] }),
      storage: { getUrl: async () => null },
    } as any,
    {},
  );
  assert.deepEqual(result, []);
});

test("listKnowledgeBaseFilesHandler applies search filter to generatedMedia", async () => {
  const result = await listKnowledgeBaseFilesHandler(
    {
      auth: buildAuth(),
      db: buildKBDb({
        generatedFiles: [],
        generatedMedia: [
          {
            _id: "gm_1",
            userId: "user_1",
            storageId: "stor_vid1",
            type: "video",
            mimeType: "video/mp4",
            sizeBytes: 1100000,
            chatId: "chat_1",
            messageId: "msg_1",
            createdAt: 2000,
          },
          {
            _id: "gm_2",
            userId: "user_1",
            storageId: "stor_img1",
            type: "image",
            mimeType: "image/png",
            sizeBytes: 5000,
            chatId: "chat_1",
            messageId: "msg_2",
            createdAt: 3000,
          },
        ],
        fileAttachments: [],
      }),
      storage: {
        getUrl: async (id: string) => `https://cdn.example/${id}`,
      },
    } as any,
    { source: "generated", search: "video" },
  );

  // Search for "video" should match "generated-video.mp4" but not "generated-image.png"
  assert.equal(result.length, 1);
  assert.equal(result[0].filename, "generated-video.mp4");
});

test("listKnowledgeBaseFilesHandler respects limit across merged sources", async () => {
  const result = await listKnowledgeBaseFilesHandler(
    {
      auth: buildAuth(),
      db: buildKBDb({
        generatedFiles: [
          { _id: "gf_1", userId: "user_1", storageId: "s1", filename: "a.docx", mimeType: "app/docx", toolName: "doc", chatId: "c1", messageId: "m1", createdAt: 3000 },
          { _id: "gf_2", userId: "user_1", storageId: "s2", filename: "b.docx", mimeType: "app/docx", toolName: "doc", chatId: "c1", messageId: "m2", createdAt: 2000 },
        ],
        generatedMedia: [
          { _id: "gm_1", userId: "user_1", storageId: "s3", type: "video", mimeType: "video/mp4", chatId: "c1", messageId: "m3", createdAt: 1000 },
        ],
        fileAttachments: [],
      }),
      storage: {
        getUrl: async (id: string) => `https://cdn.example/${id}`,
      },
    } as any,
    { source: "generated", limit: 2 },
  );

  // Limit 2, sorted desc: gf_1 (3000), gf_2 (2000) — video (1000) gets cut
  assert.equal(result.length, 2);
  assert.equal(result[0].createdAt, 3000);
  assert.equal(result[1].createdAt, 2000);
});

// =============================================================================
// snapToSupportedDuration
// =============================================================================

test("snapToSupportedDuration — exact match returns requested", () => {
  assert.equal(snapToSupportedDuration(5, [4, 5, 6, 7, 8]), 5);
});

test("snapToSupportedDuration — snaps to nearest (Veo 3.1: 5→4)", () => {
  // Veo 3.1 supports [4, 6, 8] — requesting 5 should snap to 4 (tie favors shorter)
  assert.equal(snapToSupportedDuration(5, [4, 6, 8]), 4);
});

test("snapToSupportedDuration — snaps to nearest (Sora: 5→4)", () => {
  // Sora 2 Pro supports [4, 8, 12, 16, 20] — requesting 5 should snap to 4
  assert.equal(snapToSupportedDuration(5, [4, 8, 12, 16, 20]), 4);
});

test("snapToSupportedDuration — snaps up when closer to higher value", () => {
  // Requesting 7 with [4, 8, 12] → snaps to 8
  assert.equal(snapToSupportedDuration(7, [4, 8, 12]), 8);
});

test("snapToSupportedDuration — tie favors shorter duration", () => {
  // Requesting 6 with [4, 8] → equidistant, favors 4
  assert.equal(snapToSupportedDuration(6, [4, 8]), 4);
});

test("snapToSupportedDuration — empty supported returns requested", () => {
  assert.equal(snapToSupportedDuration(5, []), 5);
});

test("snapToSupportedDuration — single supported option always returned", () => {
  assert.equal(snapToSupportedDuration(100, [4]), 4);
});

test("snapToSupportedDuration — snaps to highest when above all", () => {
  assert.equal(snapToSupportedDuration(30, [4, 8, 12, 16, 20]), 20);
});

test("snapToSupportedDuration — snaps to lowest when below all", () => {
  assert.equal(snapToSupportedDuration(1, [4, 8, 12]), 4);
});

// =============================================================================
// snapToSupportedAspectRatio
// =============================================================================

test("snapToSupportedAspectRatio — exact match returns requested", () => {
  assert.equal(snapToSupportedAspectRatio("16:9", ["16:9", "9:16", "1:1"]), "16:9");
});

test("snapToSupportedAspectRatio — unsupported falls back to first", () => {
  assert.equal(snapToSupportedAspectRatio("21:9", ["16:9", "9:16"]), "16:9");
});

test("snapToSupportedAspectRatio — empty supported returns requested", () => {
  assert.equal(snapToSupportedAspectRatio("16:9", []), "16:9");
});

// =============================================================================
// snapToSupportedResolution
// =============================================================================

test("snapToSupportedResolution — exact match returns requested", () => {
  assert.equal(snapToSupportedResolution("720p", ["480p", "720p", "1080p"]), "720p");
});

test("snapToSupportedResolution — unsupported falls back to first", () => {
  assert.equal(snapToSupportedResolution("4K", ["480p", "720p"]), "480p");
});

test("snapToSupportedResolution — empty supported returns requested", () => {
  assert.equal(snapToSupportedResolution("720p", []), "720p");
});
