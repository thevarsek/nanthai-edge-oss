import assert from "node:assert/strict";
import test from "node:test";

import {
  buildVideoOutputUploadUrl,
  modelRequiresOutputUploadUrl,
  pollVideoGenerationHandler,
  snapToSupportedAspectRatio,
  snapToSupportedDuration,
  snapToSupportedResolution,
  submitVideoGenerationHandler,
} from "../chat/actions_video_generation";
import { completeVideoOutputUploadHandler } from "../chat/mutations_internal_handlers";
import { isAllowedVideoUploadMimeType } from "../chat/video_output_upload_policy";

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
  const makeCtx = (session: Record<string, unknown> | null) => ({
    db: {
      query: () => ({
        withIndex: () => ({
          first: async () => session,
        }),
      }),
      patch: async (_id: string, value: Record<string, unknown>) => {
        patches.push(value);
      },
    },
  }) as any;

  await completeVideoOutputUploadHandler(makeCtx({
    _id: "upload_1",
    status: "pending",
    createdAt: Date.now(),
  }), {
    token: "tok",
    storageId: "storage_1",
    mimeType: "video/mp4",
    sizeBytes: 10,
  } as any);
  await completeVideoOutputUploadHandler(makeCtx({
    _id: "upload_2",
    status: "uploaded",
    createdAt: Date.now(),
  }), {
    token: "tok",
    storageId: "storage_2",
    mimeType: "video/mp4",
    sizeBytes: 10,
  } as any);
  await completeVideoOutputUploadHandler(makeCtx({
    _id: "upload_3",
    status: "pending",
    createdAt: Date.now() - 31 * 60 * 1000,
  }), {
    token: "tok",
    storageId: "storage_3",
    mimeType: "video/mp4",
    sizeBytes: 10,
  } as any);

  assert.equal(patches.length, 1);
  assert.equal(patches[0].storageId, "storage_1");
  assert.equal(patches[0].status, "uploaded");
});

test("submitVideoGeneration handles missing prompts and default config failure paths", async () => {
  const mutations: Array<Record<string, unknown>> = [];
  const missingPromptCtx = {
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.userId) return "sk-test";
      if (args.messageId) return null;
      if (args.jobId) return { _id: "job_1", status: "failed" };
      return null;
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
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
      if (args.openRouterJobId) return "video_job_1";
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
    assert.equal(requests[0].generate_audio, true);
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
    assert.ok(successMutations.some((entry) => entry.token === uploadToken && entry.messageId === "msg_assistant"));
    assert.ok(successMutations.some((entry) => entry.outputUploadToken === uploadToken));
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

test("pollVideoGeneration fails completed jobs when storage URL resolution fails", async () => {
  const originalFetch = globalThis.fetch;
  const mutations: Array<Record<string, unknown>> = [];
  const responses = [
    new Response(JSON.stringify({
      status: "completed",
      polling_url: "https://poll",
      unsigned_urls: ["https://cdn/video.mp4"],
    }), { status: 200 }),
    new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
  ];
  globalThis.fetch = (async () => {
    const next = responses.shift();
    assert.ok(next);
    return next;
  }) as any;
  const ctx = {
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.videoJobId) return { _id: "video_job_1", status: "in_progress", pollCount: 1, pollingUrl: "https://poll" };
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
      store: async () => "storage_video",
      getUrl: async () => null,
    },
  } as any;

  try {
    await pollVideoGenerationHandler(ctx, pollArgs);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.ok(mutations.some((entry) => entry.error === "Failed to get storage URL for video"));
  assert.ok(mutations.some((entry) => entry.batchId === "batch_1" && entry.status === "failed"));
});

test("pollVideoGeneration finalizes Grok uploads from tracked output upload storage", async () => {
  const originalFetch = globalThis.fetch;
  const mutations: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async () => new Response(JSON.stringify({
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
          pollingUrl: "https://poll",
          outputUploadToken: "upload_tok",
        };
      }
      if (args.token) {
        return {
          token: "upload_tok",
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
  assert.ok(mutations.some((entry) =>
    entry.storageId === "storage_uploaded_video" &&
    entry.type === "video" &&
    entry.sizeBytes === 42
  ));
});

test("pollVideoGeneration waits when Grok completed before output upload arrives", async () => {
  const originalFetch = globalThis.fetch;
  const scheduled: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async () => new Response(JSON.stringify({
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
          pollingUrl: "https://poll",
          outputUploadToken: "upload_tok",
        };
      }
      if (args.token) return { token: "upload_tok", status: "pending" };
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

  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].videoJobId, "video_job_1");
});

test("pollVideoGeneration final catch still finalizes when video status patch fails", async () => {
  const mutations: Array<Record<string, unknown>> = [];
  const ctx = {
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.videoJobId) return { _id: "video_job_1", status: "in_progress", pollCount: 1, pollingUrl: "https://poll" };
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

  await pollVideoGenerationHandler(ctx, pollArgs);

  assert.ok(mutations.some((entry) => entry.videoJobId === "video_job_1" && entry.status === "failed"));
  assert.ok(mutations.some((entry) => entry.messageId === "msg_assistant" && entry.status === "failed"));
  assert.ok(mutations.some((entry) => entry.batchId === "batch_1" && entry.status === "failed"));
});
