import assert from "node:assert/strict";
import test from "node:test";

import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";
import {
  buildVideoOutputUploadUrl,
  failVideoWorkflowHandler,
  modelRequiresOutputUploadUrl,
  pollVideoGenerationHandler,
  snapToSupportedAspectRatio,
  snapToSupportedDuration,
  snapToSupportedResolution,
  submitVideoGenerationHandler,
} from "../chat/actions_video_generation";
import {
  completeVideoOutputUploadHandler,
  createVideoOutputUploadSessionHandler,
  discardVideoOutputUploadCandidateHandler,
} from "../chat/video_mutation_handlers";
import { handleVideoOutputUpload } from "../http";
import {
  hashVideoOutputUploadToken,
  isAllowedVideoUploadMimeType,
} from "../chat/video_output_upload_policy";

const submitArgs = {
  chatId: "chat_1",
  userMessageId: "msg_user",
  assistantMessageIds: ["msg_assistant"],
  generationJobIds: ["job_1"],
  participant: {
    modelId: "video/model",
    messageId: "msg_assistant",
    jobId: "job_1",
  },
  userId: "user_1",
} as any;

const pollArgs = {
  videoJobId: "video_job_1",
  chatId: "chat_1",
  userMessageId: "msg_user",
  assistantMessageIds: ["msg_assistant"],
  generationJobIds: ["job_1"],
  messageId: "msg_assistant",
  jobId: "job_1",
  userId: "user_1",
  drivePickerBatchId: "batch_1",
} as any;

test("video snap helpers preserve exact or unsupported-free requested values", () => {
  assert.equal(snapToSupportedDuration(8, []), 8);
  assert.equal(snapToSupportedDuration(8, [4, 8]), 8);
  assert.equal(snapToSupportedDuration(7, [6, 8]), 6);
  assert.equal(snapToSupportedAspectRatio("4:3", []), "4:3");
  assert.equal(snapToSupportedAspectRatio("16:9", ["16:9"]), "16:9");
  assert.equal(snapToSupportedResolution("1080p", []), "1080p");
  assert.equal(snapToSupportedResolution("720p", ["720p"]), "720p");
  assert.equal(modelRequiresOutputUploadUrl("x-ai/grok-imagine-video"), true);
  assert.equal(modelRequiresOutputUploadUrl("google/veo-3.1"), false);
  assert.equal(
    buildVideoOutputUploadUrl("tok_1", { CONVEX_SITE_URL: "https://uploads.example/" } as any),
    "https://uploads.example/video-output-upload?token=tok_1",
  );
});

test("video output upload guards accept only video-compatible MIME types", () => {
  assert.equal(isAllowedVideoUploadMimeType("video/mp4"), true);
  assert.equal(isAllowedVideoUploadMimeType("application/octet-stream"), true);
  assert.equal(isAllowedVideoUploadMimeType("image/png"), false);
  assert.equal(isAllowedVideoUploadMimeType("text/plain; charset=utf-8"), false);
});

test("completeVideoOutputUploadHandler only patches pending unexpired sessions", async () => {
  const patches: Array<Record<string, unknown>> = [];
  const expectedTokenHash = await hashVideoOutputUploadToken("tok");
  const makeCtx = (session: Record<string, unknown> | null) => ({
    db: {
      get: async () => session,
      patch: async (_id: string, value: Record<string, unknown>) => {
        patches.push(value);
      },
    },
  }) as any;

  const accepted = await completeVideoOutputUploadHandler(makeCtx({
    _id: "upload_1",
    status: "pending",
    createdAt: Date.now(),
    expiresAt: Date.now() + 30 * 60 * 1000,
    tokenHash: expectedTokenHash,
  }), {
    uploadId: "upload_1",
    expectedTokenHash,
    storageId: "storage_1",
    mimeType: "video/mp4",
    sizeBytes: 10,
  } as any);
  const duplicate = await completeVideoOutputUploadHandler(makeCtx({
    _id: "upload_2",
    status: "uploaded",
    createdAt: Date.now(),
    expiresAt: Date.now() + 30 * 60 * 1000,
    tokenHash: expectedTokenHash,
    storageId: "storage_2",
    mimeType: "video/mp4",
    sizeBytes: 10,
  }), {
    uploadId: "upload_2",
    expectedTokenHash,
    storageId: "storage_2",
    mimeType: "video/mp4",
    sizeBytes: 10,
  } as any);
  const conflictingDuplicate = await completeVideoOutputUploadHandler(makeCtx({
    _id: "upload_4",
    status: "uploaded",
    createdAt: Date.now(),
    expiresAt: Date.now() + 30 * 60 * 1000,
    tokenHash: expectedTokenHash,
    storageId: "storage_committed",
    mimeType: "video/mp4",
    sizeBytes: 10,
  }), {
    uploadId: "upload_4",
    expectedTokenHash,
    storageId: "storage_conflict",
    mimeType: "video/mp4",
    sizeBytes: 10,
  } as any);
  const expired = await completeVideoOutputUploadHandler(makeCtx({
    _id: "upload_3",
    status: "pending",
    createdAt: Date.now() - 31 * 60 * 1000,
    expiresAt: Date.now() - 60 * 1000,
    tokenHash: expectedTokenHash,
  }), {
    uploadId: "upload_3",
    expectedTokenHash,
    storageId: "storage_3",
    mimeType: "video/mp4",
    sizeBytes: 10,
  } as any);

  assert.equal(patches.length, 1);
  assert.equal(patches[0].storageId, "storage_1");
  assert.equal(patches[0].status, "uploaded");
  assert.equal(accepted, true);
  assert.equal(duplicate, true);
  assert.equal(conflictingDuplicate, false);
  assert.equal(expired, false);
});

test("video output upload session creation and candidate cleanup are idempotent", async () => {
  const rows = {
    videoJobs: [{
      _id: "video_job_1",
      userId: "user_1",
      chatId: "chat_1",
      messageId: "message_1",
    }],
    videoOutputUploads: [],
  };
  const ctx = createStatefulMockCtx(rows);
  const args = {
    videoJobId: "video_job_1",
    tokenHash: "token_hash",
    expiresAt: 123_456,
    messageId: "message_1",
    chatId: "chat_1",
    userId: "user_1",
  };

  const created = await createVideoOutputUploadSessionHandler(ctx as any, args as any);
  const repeated = await createVideoOutputUploadSessionHandler(ctx as any, args as any);
  assert.equal(created, "videoOutputUploads_1");
  assert.equal(repeated, created);
  assert.equal(rows.videoOutputUploads.length, 1);
  assert.equal(
    (rows.videoJobs[0] as Record<string, unknown> | undefined)?.outputUploadId,
    created,
  );

  const upload = rows.videoOutputUploads[0] as Record<string, unknown>;
  upload.status = "uploaded";
  upload.storageId = "storage_committed";
  await discardVideoOutputUploadCandidateHandler(ctx as any, {
    uploadId: created,
    storageId: "storage_committed",
  } as any);
  await discardVideoOutputUploadCandidateHandler(ctx as any, {
    uploadId: created,
    storageId: "storage_loser",
  } as any);
  assert.deepEqual(ctx.storageDeletes, ["storage_loser"]);

  rows.videoOutputUploads.splice(0);
  Object.assign(rows, {
    generatedMedia: [{ _id: "media_1", storageId: "storage_published" }],
  });
  await discardVideoOutputUploadCandidateHandler(ctx as any, {
    uploadId: created,
    storageId: "storage_published",
  } as any);
  assert.deepEqual(ctx.storageDeletes, ["storage_loser"]);
});

test("submitVideoGeneration handles missing prompts and default config failure paths", async () => {
  const mutations: Array<Record<string, unknown>> = [];
  const missingPromptCtx = {
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.userId) return "sk-test";
      if (args.messageId) return null;
      if (args.jobId) return { _id: "job_1", status: "queued" };
      return null;
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
      if (Object.keys(args).length === 1 && args.jobId === "job_1") {
        return true;
      }
      return false;
    },
    scheduler: { runAfter: async () => {} },
  } as any;

  await submitVideoGenerationHandler(missingPromptCtx, {
    ...submitArgs,
    drivePickerBatchId: "batch_1",
  });
  assert.ok(mutations.some((entry) => String(entry.error).includes("User message not found")));
  assert.ok(mutations.some((entry) => entry.batchId === "batch_1" && entry.status === "failed"));

  const originalFetch = globalThis.fetch;
  const originalSiteUrl = process.env.CONVEX_SITE_URL;
  process.env.CONVEX_SITE_URL = "https://uploads.example";
  const requests: Array<Record<string, unknown>> = [];
  const successMutations: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({
      id: "video_provider_1",
      polling_url: "https://poll",
      status: "pending",
    }), { status: 200 });
  }) as any;
  const successCtx = {
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.userId) return "sk-test";
      if (args.jobId) return { _id: "job_1", status: "queued" };
      if (args.messageId) {
        return {
          _id: "msg_user",
          content: "Make video",
          attachments: [
            { type: "file", storageId: "not_image" },
            { type: "image", storageId: "missing_url" },
          ],
        };
      }
      if (args.modelId) return {};
      return null;
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      successMutations.push(args);
      if (args.tokenHash) return "upload_1";
      if (args.messageId === "msg_assistant" && args.model && !("videoJobId" in args)) {
        return "video_job_1";
      }
      return undefined;
    },
    scheduler: { runAfter: async () => {} },
    storage: {
      getUrl: async () => null,
    },
  } as any;

  try {
    await submitVideoGenerationHandler(successCtx, submitArgs);
    assert.equal(requests[0].duration, 5);
    assert.equal(requests[0].aspect_ratio, "16:9");
    assert.equal("generate_audio" in requests[0], false);
    assert.equal("frame_images" in requests[0], false);
    assert.equal(successMutations.some((entry) => entry.openRouterJobId === "video_provider_1"), true);

    requests.length = 0;
    await submitVideoGenerationHandler(successCtx, {
      ...submitArgs,
      participant: {
        ...submitArgs.participant,
        modelId: "x-ai/grok-imagine-video",
      },
    });
    const uploadUrl = new URL(String((requests[0].output as any).upload_url));
    assert.equal(uploadUrl.origin, "https://uploads.example");
    assert.equal(uploadUrl.pathname, "/video-output-upload");
    const uploadToken = uploadUrl.searchParams.get("token");
    assert.ok(uploadToken);
    const expectedHash = await hashVideoOutputUploadToken(String(uploadToken));
    assert.ok(successMutations.some((entry) =>
      entry.tokenHash === expectedHash &&
      entry.videoJobId === "video_job_1" &&
      entry.messageId === "msg_assistant" &&
      !("token" in entry)));
    assert.ok(successMutations.some((entry) =>
      entry.openRouterJobId === "video_provider_1" &&
      entry.outputUploadId === "upload_1" &&
      !("outputUploadToken" in entry)));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalSiteUrl === undefined) delete process.env.CONVEX_SITE_URL;
    else process.env.CONVEX_SITE_URL = originalSiteUrl;
  }
});

test("pollVideoGeneration exits for missing and terminal video jobs", async () => {
  const mutations: Array<Record<string, unknown>> = [];
  const ctx = {
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.videoJobId === "missing") return null;
      if (args.videoJobId === "completed") return { _id: "completed", status: "completed" };
      return { _id: "failed", status: "failed" };
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
    },
    scheduler: { runAfter: async () => {} },
  } as any;

  await pollVideoGenerationHandler(ctx, { ...pollArgs, videoJobId: "missing" });
  await pollVideoGenerationHandler(ctx, { ...pollArgs, videoJobId: "completed" });
  await pollVideoGenerationHandler(ctx, { ...pollArgs, videoJobId: "failed" });

  assert.deepEqual(mutations, []);
});

test("workflow failure settles its video owner before completing related flows", async () => {
  const mutations: Array<Record<string, unknown>> = [];
  let generationStatus = "streaming";
  const ctx = {
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.jobId) return { _id: "job_1", status: generationStatus };
      if (args.messageId) {
        return {
          _id: "video_job_1",
          status: "in_progress",
          openRouterJobId: "provider_video_1",
        };
      }
      return null;
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
      if (args.videoJobId === "video_job_1" && args.status === "failed") {
        generationStatus = "failed";
      }
      return null;
    },
  } as any;

  await failVideoWorkflowHandler(ctx, {
    ...submitArgs,
    drivePickerBatchId: "batch_1",
    execution: {
      runId: "video_run_1",
      attemptId: "video_attempt_1",
      fence: 3,
      claimantId: "video-workflow:job_1",
    },
    error: "provider polling failed",
  });

  assert.ok(mutations.some((entry) =>
    entry.videoJobId === "video_job_1"
    && entry.status === "failed"
    && entry.executionAttemptId === "video_attempt_1"
    && entry.executionFence === 3
  ));
  assert.ok(mutations.some((entry) =>
    entry.batchId === "batch_1" && entry.status === "failed"
  ));
});

test("workflow failure still completes the drive batch when the generation is already terminal", async () => {
  const mutations: Array<Record<string, unknown>> = [];
  const ctx = {
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.jobId) return { _id: "job_1", status: "failed" };
      if (args.messageId) return { _id: "video_job_1", status: "failed" };
      return null;
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
      return null;
    },
  } as any;

  await failVideoWorkflowHandler(ctx, {
    ...submitArgs,
    drivePickerBatchId: "batch_1",
    error: "already settled",
  });

  assert.ok(mutations.some((entry) =>
    entry.batchId === "batch_1" && entry.status === "failed"
  ));
});

test("pollVideoGeneration retries local publication after a transient storage URL failure", async () => {
  const originalFetch = globalThis.fetch;
  const mutations: Array<Record<string, unknown>> = [];
  let providerTerminalAt: number | undefined;
  let providerTerminalStatus: "completed" | undefined;
  const responses = [
    new Response(JSON.stringify({
      id: "or_video_1",
      status: "completed",
      polling_url: "https://poll",
      unsigned_urls: ["https://cdn/video.mp4"],
    }), { status: 200 }),
    new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "content-type": "video/mp4" },
    }),
  ];
  globalThis.fetch = (async () => {
    const next = responses.shift();
    assert.ok(next);
    return next;
  }) as any;
  const ctx = {
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.videoJobId) return {
        _id: "video_job_1",
        status: "in_progress",
        pollCount: 1,
        openRouterJobId: "or_video_1",
        providerTerminalAt,
        providerTerminalStatus,
      };
      if (args.jobId) return { _id: "job_1", status: "streaming" };
      if (args.userId) return "sk-test";
      return null;
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
      if (args.videoJobId === "video_job_1" && "generationId" in args) {
        providerTerminalAt = Date.now();
        providerTerminalStatus = args.status as "completed";
      }
      return false;
    },
    scheduler: { runAfter: async () => {} },
    storage: {
      store: async () => "storage_video",
      getUrl: async () => null,
      delete: async () => undefined,
    },
  } as any;

  try {
    await pollVideoGenerationHandler(ctx, pollArgs);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(mutations.some((entry) => entry.error === "Failed to get storage URL for video"), false);
  assert.equal(mutations.some((entry) => entry.batchId === "batch_1"), false);
});

test("pollVideoGeneration finalizes Grok uploads from tracked output upload storage", async () => {
  const originalFetch = globalThis.fetch;
  const mutations: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async () => new Response(JSON.stringify({
    id: "or_video_1",
    status: "completed",
    polling_url: "https://poll",
  }), { status: 200 })) as any;
  const ctx = {
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.videoJobId) {
        return {
          _id: "video_job_1",
          status: "in_progress",
          pollCount: 1,
          openRouterJobId: "or_video_1",
          outputUploadId: "upload_1",
        };
      }
      if (args.uploadId) {
        return {
          _id: "upload_1",
          status: "uploaded",
          storageId: "storage_uploaded_video",
          mimeType: "video/mp4",
          sizeBytes: 42,
        };
      }
      if (args.jobId) return { _id: "job_1", status: "streaming" };
      if (args.userId) return "sk-test";
      return null;
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
      return false;
    },
    scheduler: { runAfter: async () => {} },
    storage: {
      getUrl: async (storageId: string) => `https://storage.example/${storageId}.mp4`,
    },
  } as any;

  try {
    await pollVideoGenerationHandler(ctx, pollArgs);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.ok(mutations.some((entry) =>
    entry.status === "completed" &&
    Array.isArray(entry.videoUrls) &&
    entry.videoUrls[0] === "https://storage.example/storage_uploaded_video.mp4"
  ));
  assert.ok(mutations.some((entry) => {
    const media = entry.media as { storageId?: string; sizeBytes?: number } | undefined;
    return media?.storageId === "storage_uploaded_video" && media.sizeBytes === 42;
  }));
});

test("persisted provider completion publishes an uploaded video without an API key or re-poll", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  const mutations: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async () => {
    fetchCalled = true;
    throw new Error("provider should not be contacted");
  }) as any;
  const ctx = {
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.videoJobId) {
        return {
          _id: "video_job_1",
          status: "in_progress",
          pollCount: 2,
          openRouterJobId: "or_video_1",
          outputUploadId: "upload_1",
          providerTerminalAt: 123,
          providerTerminalStatus: "completed",
          providerGenerationId: "generation_1",
          providerCost: 0.25,
          providerIsByok: false,
          model: "video/model",
        };
      }
      if (args.uploadId) {
        return {
          _id: "upload_1",
          status: "uploaded",
          storageId: "storage_uploaded_video",
          mimeType: "video/mp4",
          sizeBytes: 42,
        };
      }
      if (args.jobId) return { _id: "job_1", status: "streaming" };
      if (args.userId) throw new Error("API key should not be requested");
      return null;
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
      return false;
    },
    scheduler: { runAfter: async () => undefined },
    storage: {
      getUrl: async () => "https://storage.example/video.mp4",
    },
  } as any;

  try {
    await pollVideoGenerationHandler(ctx, pollArgs);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(fetchCalled, false);
  assert.ok(mutations.some((entry) => entry.idempotencyKey === "video_job_1:usage"));
  assert.ok(mutations.some((entry) => entry.status === "completed" && "videoUrls" in entry));
});

test("pollVideoGeneration leaves pending Grok upload polling to Workflow", async () => {
  const originalFetch = globalThis.fetch;
  const scheduled: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async () => new Response(JSON.stringify({
    id: "or_video_1",
    status: "completed",
    polling_url: "https://poll",
  }), { status: 200 })) as any;
  const ctx = {
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.videoJobId) {
        return {
          _id: "video_job_1",
          status: "in_progress",
          pollCount: 1,
          openRouterJobId: "or_video_1",
          outputUploadId: "upload_1",
        };
      }
      if (args.uploadId) return { _id: "upload_1", status: "pending" };
      if (args.jobId) return { _id: "job_1", status: "streaming" };
      if (args.userId) return "sk-test";
      return null;
    },
    runMutation: async () => false,
    scheduler: {
      runAfter: async (delay: number, _ref: unknown, args: Record<string, unknown>) => {
        scheduled.push({ delay, ...args });
      },
    },
  } as any;

  try {
    await pollVideoGenerationHandler(ctx, pollArgs);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(scheduled.length, 0);
});

test("pollVideoGeneration downloads completed output when a callback exceeds the HTTP limit", async () => {
  const originalFetch = globalThis.fetch;
  const mutations: Array<Record<string, unknown>> = [];
  const responses = [
    new Response(JSON.stringify({
      id: "or_video_1",
      status: "completed",
      generation_id: "generation_1",
    }), { status: 200 }),
    new Response(new Uint8Array([1, 2, 3, 4]), {
      status: 200,
      headers: { "content-type": "video/mp4" },
    }),
  ];
  globalThis.fetch = (async () => {
    const response = responses.shift();
    assert.ok(response);
    return response;
  }) as any;
  const ctx = {
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.videoJobId) {
        return {
          _id: "video_job_1",
          status: "in_progress",
          pollCount: 39,
          openRouterJobId: "or_video_1",
          outputUploadId: "upload_1",
          model: "x-ai/grok-imagine-video",
        };
      }
      if (args.uploadId) return { _id: "upload_1", status: "pending" };
      if (args.jobId) return { _id: "job_1", status: "streaming" };
      if (args.userId) return "sk-test";
      return null;
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
      return false;
    },
    scheduler: { runAfter: async () => undefined },
    storage: {
      store: async () => "storage_downloaded_video",
      getUrl: async () => "https://storage.example/downloaded.mp4",
      delete: async () => undefined,
    },
  } as any;

  try {
    await pollVideoGenerationHandler(ctx, pollArgs);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(responses.length, 0);
  assert.ok(mutations.some((entry) => {
    const media = entry.media as { storageId?: string; sizeBytes?: number } | undefined;
    return entry.status === "completed" &&
      media?.storageId === "storage_downloaded_video" &&
      media.sizeBytes === 4;
  }));
});

test("pollVideoGeneration propagates an atomic settlement failure for Workflow recovery", async () => {
  const mutations: Array<Record<string, unknown>> = [];
  const ctx = {
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.videoJobId) return { _id: "video_job_1", status: "in_progress", pollCount: 1 };
      if (args.jobId) return { _id: "job_1", status: "streaming" };
      if (args.userId) return "";
      return null;
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
      if (args.videoJobId && args.status === "failed") throw new Error("patch race");
      return false;
    },
    scheduler: { runAfter: async () => {} },
  } as any;

  await assert.rejects(pollVideoGenerationHandler(ctx, pollArgs), /patch race/);

  assert.ok(mutations.some((entry) => entry.videoJobId === "video_job_1" && entry.status === "failed"));
  assert.equal(mutations.some((entry) => entry.batchId === "batch_1"), false);
});

test("video output upload safely discards the losing blob when a concurrent request wins", async () => {
  const deleted: string[] = [];
  const mutations: Array<Record<string, unknown>> = [];
  const ctx = {
    runQuery: async () => ({
      _id: "upload_1",
      status: "pending",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    }),
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
      return false;
    },
    storage: {
      store: async () => "storage_loser",
      delete: async (storageId: string) => deleted.push(storageId),
    },
  } as any;
  const response = await handleVideoOutputUpload(ctx, new Request(
    "https://example.convex.site/video-output-upload?token=tok",
    { method: "PUT", headers: { "Content-Type": "video/mp4" }, body: new Uint8Array([1, 2]) },
  ));
  assert.equal(response.status, 409);
  assert.ok(mutations.some((entry) =>
    entry.uploadId === "upload_1" &&
    entry.storageId === "storage_loser" &&
    !("expectedTokenHash" in entry)
  ));
  assert.deepEqual(deleted, []);
});

test("video output upload retries an exact completion after its response is lost", async () => {
  let completionAttempts = 0;
  const discarded: string[] = [];
  const deleted: string[] = [];
  const ctx = {
    runQuery: async () => ({
      _id: "upload_1",
      status: "pending",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    }),
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      if ("expectedTokenHash" in args) {
        completionAttempts += 1;
        if (completionAttempts === 1) throw new Error("response lost after commit");
        return true;
      }
      if (typeof args.storageId === "string") discarded.push(args.storageId);
      return null;
    },
    storage: {
      store: async () => "storage_committed",
      delete: async (storageId: string) => deleted.push(storageId),
    },
  } as any;
  const response = await handleVideoOutputUpload(ctx, new Request(
    "https://example.convex.site/video-output-upload?token=tok",
    { method: "PUT", headers: { "Content-Type": "video/mp4" }, body: new Uint8Array([1, 2]) },
  ));

  assert.equal(response.status, 200);
  assert.equal(completionAttempts, 2);
  assert.deepEqual(discarded, []);
  assert.deepEqual(deleted, []);
});
