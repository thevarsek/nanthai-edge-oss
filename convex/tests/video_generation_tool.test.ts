import assert from "node:assert/strict";
import test, { mock } from "node:test";

import { generateVideo } from "../tools/generate_video";
import { pollToolVideoStep } from "../tools/video_generation_actions";
import { prepareToolVideoSubmission } from "../tools/video_generation_submit";

test("generate_video resolves Chat Defaults and supported overrides before deferring", async () => {
  const mutations: Array<Record<string, unknown>> = [];
  let creationAttempts = 0;
  const ctx = {
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.modelId) {
        return {
          hasVideoGeneration: true,
          hasZdrEndpoint: false,
          videoCapabilities: {
            supportedDurations: [5, 10],
            supportedAspectRatios: ["16:9"],
            supportedResolutions: ["720p"],
            supportedFrameImages: [],
            generateAudio: true,
            seed: true,
          },
        };
      }
      return {
        videoModelId: "video/default",
        videoConfig: {
          duration: 5,
          aspectRatio: "16:9",
          resolution: "720p",
          generateAudio: true,
        },
        zdrEnabled: false,
      };
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
      creationAttempts += 1;
      if (creationAttempts === 1) throw new Error("response lost after commit");
      const videoJobId = "video_job_1";
      return {
        videoJobId,
        resultJson: JSON.stringify({
          success: true,
          data: {
            kind: "video",
            status: "generating",
            videoJobId,
            modelId: args.model,
            prompt: args.prompt,
          },
          deferred: { kind: "video_generation", data: { videoJobId } },
        }),
      };
    },
  };

  const result = await generateVideo.execute({
    ctx,
    userId: "user_1",
    chatId: "chat_1",
    messageId: "assistant_1",
    userMessageId: "user_message_1",
    jobId: "generation_1",
    toolCallId: "call_1",
    operationIdempotencyKey: "operation_1",
    executionAttemptId: "attempt_1",
    executionFence: 4,
  } as never, {
    prompt: "A moonlit train crossing an alpine bridge",
    duration: 8,
    aspect_ratio: "1:1",
    resolution: "1080p",
    generate_audio: false,
    seed: 12.8,
  });

  assert.equal(result.success, true);
  assert.equal(creationAttempts, 2);
  assert.deepEqual(result.deferred, {
    kind: "video_generation",
    data: { videoJobId: "video_job_1" },
  });
  assert.deepEqual(mutations[0]?.videoConfig, {
    duration: 10,
    aspectRatio: "16:9",
    generateAudio: false,
    resolution: "720p",
    seed: 12,
  });
  assert.equal(mutations[0]?.model, "video/default");
});

test("tool video provider submission is journaled and preserves supported frame inputs", async (t) => {
  t.after(() => mock.restoreAll());
  const mutations: Array<Record<string, unknown>> = [];
  let requestBody: Record<string, unknown> | undefined;
  mock.method(globalThis, "fetch", async (_url: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ id: "provider_video_1", status: "pending" }), {
      status: 200,
    });
  });
  const ctx = {
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.modelId) {
        return {
          hasVideoGeneration: true,
          hasZdrEndpoint: false,
          videoCapabilities: { supportedFrameImages: ["first_frame"] },
        };
      }
      if (args.messageId) {
        return { attachments: [{ type: "image", storageId: "image_1" }] };
      }
      if (args.userId) return "sk-test";
      return null;
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
      if (args.inputHash) return { decision: "execute" };
      return null;
    },
    storage: { getUrl: async () => "https://files.example/frame.png" },
  };
  const args = {
    videoJobId: "video_job_1",
    userId: "user_1",
    jobId: "generation_1",
    toolCallId: "call_1",
    workflowResumeEventId: "event_1",
    execution: {
      runId: "run_1",
      attemptId: "attempt_1",
      fence: 3,
      claimantId: "video-tool:video_job_1",
    },
  };
  const job = {
    _id: "video_job_1",
    messageId: "assistant_1",
    sourceUserMessageId: "user_message_1",
    chatId: "chat_1",
    userId: "user_1",
    model: "video/model",
    prompt: "Animate this frame",
    videoConfig: { duration: 5, aspectRatio: "16:9" },
    requireZdr: false,
  };

  const result = await prepareToolVideoSubmission(ctx as never, args as never, job as never);

  assert.equal(result.submission.id, "provider_video_1");
  assert.equal(requestBody?.model, "video/model");
  assert.equal((requestBody?.frame_images as unknown[]).length, 1);
  const prepared = mutations.find((entry) => typeof entry.inputHash === "string");
  assert.equal(prepared?.retry, "never");
  assert.ok(mutations.some((entry) => entry.openRouterJobId === "provider_video_1"));
});

test("tool video provider submission replays the journal without dispatching twice", async (t) => {
  t.after(() => mock.restoreAll());
  let fetchCount = 0;
  mock.method(globalThis, "fetch", async () => {
    fetchCount += 1;
    throw new Error("provider must not be called for a replay");
  });
  const ctx = {
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.modelId) {
        return {
          hasVideoGeneration: true,
          videoCapabilities: { supportedFrameImages: [] },
        };
      }
      if (args.messageId) return { attachments: [] };
      return null;
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.inputHash) {
        return {
          decision: "replay",
          resultJson: JSON.stringify({
            submission: { id: "provider_video_replayed", status: "pending" },
            outputUploadId: "upload_original",
          }),
        };
      }
      return null;
    },
    storage: { getUrl: async () => null },
  };

  const result = await prepareToolVideoSubmission(ctx as never, {
    videoJobId: "video_job_1",
    userId: "user_1",
    jobId: "generation_1",
    toolCallId: "call_1",
    workflowResumeEventId: "event_1",
    execution: {
      runId: "run_1",
      attemptId: "attempt_1",
      fence: 3,
      claimantId: "video-tool:video_job_1",
    },
  } as never, {
    _id: "video_job_1",
    messageId: "assistant_1",
    chatId: "chat_1",
    userId: "user_1",
    model: "x-ai/grok-imagine-video",
    prompt: "Animate this frame",
    videoConfig: {},
    requireZdr: false,
  } as never);

  assert.deepEqual(result.submission, { id: "provider_video_replayed", status: "pending" });
  assert.equal(result.outputUploadId, "upload_original");
  assert.equal(fetchCount, 0);
});

test("tool video journals the upload session used by the provider", async (t) => {
  t.after(() => mock.restoreAll());
  const originalSiteUrl = process.env.CONVEX_SITE_URL;
  process.env.CONVEX_SITE_URL = "https://uploads.example";
  t.after(() => {
    if (originalSiteUrl === undefined) delete process.env.CONVEX_SITE_URL;
    else process.env.CONVEX_SITE_URL = originalSiteUrl;
  });
  const mutations: Array<Record<string, unknown>> = [];
  let requestBody: Record<string, unknown> | undefined;
  mock.method(globalThis, "fetch", async (_url: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ id: "provider_upload_video", status: "pending" }), {
      status: 200,
    });
  });
  const ctx = {
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.modelId) {
        return { hasVideoGeneration: true, videoCapabilities: { supportedFrameImages: [] } };
      }
      if (args.messageId) return { attachments: [] };
      if (args.userId) return "sk-test";
      return null;
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
      if (args.inputHash) return { decision: "execute" };
      if (args.tokenHash) return "upload_original";
      return null;
    },
    storage: { getUrl: async () => null },
  };

  const result = await prepareToolVideoSubmission(ctx as never, {
    videoJobId: "video_job_1",
    userId: "user_1",
    jobId: "generation_1",
    toolCallId: "call_1",
    workflowResumeEventId: "event_1",
    execution: {
      runId: "run_1",
      attemptId: "attempt_1",
      fence: 3,
      claimantId: "video-tool:video_job_1",
    },
  } as never, {
    _id: "video_job_1",
    messageId: "assistant_1",
    chatId: "chat_1",
    userId: "user_1",
    model: "x-ai/grok-imagine-video",
    prompt: "Animate this frame",
    videoConfig: {},
    requireZdr: false,
  } as never);

  assert.equal(result.outputUploadId, "upload_original");
  assert.match(String((requestBody?.output as { upload_url?: string }).upload_url), /video-output-upload/);
  const recorded = mutations.find((entry) => entry.openRouterJobId === "provider_upload_video");
  assert.ok(recorded);
  assert.equal(recorded.outputUploadId, "upload_original");
  assert.deepEqual(JSON.parse(String(recorded.resultJson)), {
    submission: { id: "provider_upload_video", status: "pending" },
    outputUploadId: "upload_original",
  });
});

test("tool video records provider cost before publishing a completed artifact", async (t) => {
  t.after(() => mock.restoreAll());
  const mutations: Array<Record<string, unknown>> = [];
  const cleanupRequests: string[][] = [];
  const deleted: string[] = [];
  let publicationAttempts = 0;
  const responses = [
    new Response(JSON.stringify({
      id: "provider_video_1",
      status: "completed",
      generation_id: "generation_video_1",
      usage: { cost: 0.25, is_byok: false },
    }), { status: 200 }),
    new Response(Uint8Array.from([1, 2, 3]), {
      status: 200,
      headers: { "Content-Type": "video/mp4" },
    }),
  ];
  mock.method(globalThis, "fetch", async () => {
    const response = responses.shift();
    assert.ok(response);
    return response;
  });
  const job = {
    _id: "video_job_1",
    userId: "user_1",
    chatId: "chat_1",
    messageId: "assistant_1",
    generationJobId: "generation_1",
    toolCallId: "call_1",
    status: "in_progress",
    openRouterJobId: "provider_video_1",
    model: "video/model",
    pollCount: 0,
    videoConfig: {},
  };
  const ctx = {
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.videoJobId) return job;
      if (args.jobId) return { status: "streaming" };
      if (args.userId) return "sk-test";
      return null;
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
      if (Array.isArray(args.storageIds)) {
        cleanupRequests.push(args.storageIds as string[]);
        return null;
      }
      if (args.storageId) {
        publicationAttempts += 1;
        throw new Error("publication interrupted");
      }
      return null;
    },
    storage: {
      store: async () => "storage_video_1",
      getUrl: async () => "https://files.example/video.mp4",
      delete: async (storageId: string) => { deleted.push(storageId); },
    },
    scheduler: { runAfter: async () => undefined },
  };

  await assert.rejects((pollToolVideoStep as any)._handler(ctx, {
    videoJobId: "video_job_1",
    userId: "user_1",
    jobId: "generation_1",
    toolCallId: "call_1",
    workflowResumeEventId: "event_1",
    execution: {
      runId: "run_1",
      attemptId: "attempt_1",
      fence: 3,
      claimantId: "video-tool:video_job_1",
    },
  }), /publication interrupted/);

  const usageIndex = mutations.findIndex((entry) => entry.idempotencyKey === "video_job_1:usage");
  const publicationIndex = mutations.findIndex((entry) => entry.storageId === "storage_video_1");
  assert.ok(usageIndex >= 0);
  assert.ok(publicationIndex > usageIndex);
  assert.equal(publicationAttempts, 2);
  assert.deepEqual(cleanupRequests, [["storage_video_1"]]);
  assert.deepEqual(deleted, []);
});

test("tool video recovers when completion commits but its response is lost", async (t) => {
  t.after(() => mock.restoreAll());
  const cleanupRequests: string[][] = [];
  const deleted: string[] = [];
  let publicationAttempts = 0;
  const responses = [
    new Response(JSON.stringify({
      id: "provider_video_1",
      status: "completed",
      generation_id: "generation_video_1",
    }), { status: 200 }),
    new Response(Uint8Array.from([1, 2, 3]), {
      status: 200,
      headers: { "Content-Type": "video/mp4" },
    }),
  ];
  mock.method(globalThis, "fetch", async () => {
    const response = responses.shift();
    assert.ok(response);
    return response;
  });
  const job = {
    _id: "video_job_1",
    userId: "user_1",
    chatId: "chat_1",
    messageId: "assistant_1",
    generationJobId: "generation_1",
    toolCallId: "call_1",
    status: "in_progress",
    openRouterJobId: "provider_video_1",
    model: "video/model",
    pollCount: 0,
    videoConfig: {},
  };
  const ctx = {
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.videoJobId) return job;
      if (args.jobId) return { status: "streaming" };
      if (args.userId) return "sk-test";
      return null;
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      if (Array.isArray(args.storageIds)) {
        cleanupRequests.push(args.storageIds as string[]);
        return null;
      }
      if (args.storageId) {
        publicationAttempts += 1;
        if (publicationAttempts === 1) throw new Error("response lost after commit");
        return true;
      }
      return null;
    },
    storage: {
      store: async () => "storage_video_1",
      getUrl: async () => "https://files.example/video.mp4",
      delete: async (storageId: string) => { deleted.push(storageId); },
    },
    scheduler: { runAfter: async () => undefined },
  };

  await (pollToolVideoStep as any)._handler(ctx, {
    videoJobId: "video_job_1",
    userId: "user_1",
    jobId: "generation_1",
    toolCallId: "call_1",
    workflowResumeEventId: "event_1",
    execution: {
      runId: "run_1",
      attemptId: "attempt_1",
      fence: 3,
      claimantId: "video-tool:video_job_1",
    },
  });

  assert.equal(publicationAttempts, 2);
  assert.deepEqual(cleanupRequests, []);
  assert.deepEqual(deleted, []);
});

test("tool video downloads completed output when the callback is still pending at the final poll", async (t) => {
  t.after(() => mock.restoreAll());
  const mutations: Array<Record<string, unknown>> = [];
  const responses = [
    new Response(JSON.stringify({
      id: "provider_video_1",
      status: "completed",
      generation_id: "generation_video_1",
    }), { status: 200 }),
    new Response(Uint8Array.from([1, 2, 3, 4]), {
      status: 200,
      headers: { "Content-Type": "video/mp4" },
    }),
  ];
  mock.method(globalThis, "fetch", async () => {
    const response = responses.shift();
    assert.ok(response);
    return response;
  });
  const job = {
    _id: "video_job_1",
    userId: "user_1",
    chatId: "chat_1",
    messageId: "assistant_1",
    generationJobId: "generation_1",
    toolCallId: "call_1",
    status: "in_progress",
    openRouterJobId: "provider_video_1",
    outputUploadId: "upload_1",
    model: "x-ai/grok-imagine-video",
    pollCount: 39,
    videoConfig: {},
  };
  const ctx = {
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.videoJobId) return job;
      if (args.uploadId) return { _id: "upload_1", status: "pending" };
      if (args.jobId) return { status: "streaming" };
      if (args.userId) return "sk-test";
      return null;
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
      if (args.storageId === "storage_downloaded_video") {
        job.status = "completed";
        return true;
      }
      return null;
    },
    storage: {
      store: async () => "storage_downloaded_video",
      getUrl: async () => "https://files.example/downloaded.mp4",
      delete: async () => undefined,
    },
    scheduler: { runAfter: async () => undefined },
  };

  const state = await (pollToolVideoStep as any)._handler(ctx, {
    videoJobId: "video_job_1",
    userId: "user_1",
    jobId: "generation_1",
    toolCallId: "call_1",
    workflowResumeEventId: "event_1",
    execution: {
      runId: "run_1",
      attemptId: "attempt_1",
      fence: 3,
      claimantId: "video-tool:video_job_1",
    },
  });

  assert.equal(state, "completed");
  assert.equal(responses.length, 0);
  assert.ok(mutations.some((entry) =>
    entry.storageId === "storage_downloaded_video" &&
    entry.sizeBytes === 4
  ));
});
