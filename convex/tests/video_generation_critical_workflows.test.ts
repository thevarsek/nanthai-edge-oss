import assert from "node:assert/strict";
import test from "node:test";

import {
  pollVideoGenerationHandler,
  snapToSupportedAspectRatio,
  snapToSupportedDuration,
  snapToSupportedResolution,
  submitVideoGenerationHandler,
} from "../chat/actions_video_generation";

function baseArgs() {
  return {
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
    searchSessionId: "search_1",
    drivePickerBatchId: "batch_1",
  } as any;
}

test("video submit step snaps config and leaves polling to the owning Workflow", async () => {
  const originalFetch = globalThis.fetch;
  const mutations: Array<Record<string, unknown>> = [];
  const scheduled: Array<{ delay: number; payload: Record<string, unknown> }> = [];
  const requests: Array<{ url: string; body?: unknown }> = [];

  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify({
      id: "or_video_1",
      polling_url: "https://openrouter.ai/api/v1/videos/or_video_1",
      status: "pending",
    }), { status: 200 });
  }) as any;

	  const ctx = {
	    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
	      if (args.jobId) return { _id: "job_1", status: "queued" };
	      if (args.userId) return "sk-test";
	      if (args.messageId) {
        return {
          _id: "msg_user",
          content: "Make a launch video",
          attachments: [
            { type: "image", url: "https://example.com/first.png" },
            { mimeType: "image/png", storageId: "storage_last" },
            { type: "image", url: "https://example.com/ref.png", videoRole: "reference" },
          ],
        };
      }
      if (args.modelId) {
        return {
          videoCapabilities: {
            supportedDurations: [5, 10],
            supportedAspectRatios: ["16:9"],
            supportedResolutions: ["720p"],
            supportedFrameImages: ["first_frame", "last_frame"],
          },
        };
      }
      return null;
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
      if (args.openRouterJobId) return "video_job_1";
      return undefined;
    },
    scheduler: {
      runAfter: async (delay: number, _ref: unknown, payload: Record<string, unknown>) => {
        scheduled.push({ delay, payload });
      },
    },
    storage: {
      getUrl: async () => "https://files.example.com/last.png",
    },
  } as any;

  try {
    await submitVideoGenerationHandler(ctx, {
      ...baseArgs(),
      videoConfig: {
        duration: 8,
        aspectRatio: "1:1",
        resolution: "1080p",
        generateAudio: false,
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(snapToSupportedDuration(8, [5, 10]), 10);
  assert.equal(snapToSupportedAspectRatio("1:1", ["16:9"]), "16:9");
  assert.equal(snapToSupportedResolution("1080p", ["720p"]), "720p");
  assert.equal((requests[0]?.body as any).duration, 10);
  assert.equal((requests[0]?.body as any).resolution, "720p");
  assert.equal((requests[0]?.body as any).frame_images.length, 2);
  assert.equal((requests[0]?.body as any).input_references.length, 1);
  assert.ok(mutations.some((args) => args.openRouterJobId === "or_video_1"));
  assert.ok(mutations.some((args) => args.status === "streaming" && typeof args.startedAt === "number"));
  const startedAnalytics = scheduled.find((entry) => entry.payload.event === "assistant_response_started");
  assert.equal(startedAnalytics?.delay, 0);
  assert.equal((startedAnalytics?.payload.properties as any)?.source, "video_generation");
  const pollSchedule = scheduled.find((entry) => "videoJobId" in entry.payload);
  assert.equal(pollSchedule, undefined);
});

test("video submit step never owns legacy poll scheduling", async () => {
  const originalFetch = globalThis.fetch;
  const mutations: Array<Record<string, unknown>> = [];

  globalThis.fetch = (async () => new Response(JSON.stringify({
    id: "or_video_1",
    polling_url: "https://openrouter.ai/api/v1/videos/or_video_1",
    status: "pending",
  }), { status: 200 })) as any;

  const ctx = {
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.jobId) return { _id: "job_1", status: "queued" };
      if (args.userId) return "sk-test";
      if (args.messageId) return { _id: "msg_user", content: "Make a launch video" };
      if (args.modelId) return { videoCapabilities: {} };
      return null;
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
      if (args.openRouterJobId) return "video_job_1";
      return undefined;
    },
    scheduler: {
      runAfter: async (_delay: number, _ref: unknown, payload: Record<string, unknown>) => {
        if ("videoJobId" in payload) {
          throw new Error("poll schedule failed");
        }
      },
    },
    storage: {
      getUrl: async () => null,
    },
  } as any;

  try {
    await submitVideoGenerationHandler(ctx, baseArgs());
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.ok(mutations.some((args) =>
    args.openRouterJobId === "or_video_1",
  ));
  assert.equal(mutations.some((args) =>
    args.videoJobId === "video_job_1" && args.status === "failed"
  ), false);
  assert.equal(mutations.some((args) =>
    args.messageId === "msg_assistant" && args.status === "failed"
  ), false);
});

test("an ambiguous video provider submit is journaled outcome-unknown and never retried", async () => {
  const originalFetch = globalThis.fetch;
  const mutations: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async () => {
    throw new Error("connection reset after dispatch");
  }) as any;
  const ctx = {
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.jobId) return { _id: "job_1", status: "queued" };
      if (args.userId) return "sk-test";
      if (args.messageId) return { _id: "msg_user", content: "Make a launch video" };
      if (args.modelId) return { videoCapabilities: {} };
      return null;
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
      if ("inputHash" in args) return { decision: "execute" };
      return undefined;
    },
    scheduler: { runAfter: async () => undefined },
    storage: { getUrl: async () => null },
  } as any;
  try {
    await submitVideoGenerationHandler(ctx, {
      ...baseArgs(),
      execution: {
        runId: "execution_1",
        attemptId: "attempt_1",
        fence: 4,
        claimantId: "video-workflow:job_1",
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  const prepared = mutations.find((entry) => "inputHash" in entry);
  assert.equal(prepared?.retry, "never");
  assert.ok(mutations.some((entry) =>
    entry.operationKey === prepared?.operationKey
      && entry.errorSummary === "connection reset after dispatch"
  ));
  assert.equal(mutations.some((entry) => "openRouterJobId" in entry), false);
});

test("a provider job returned after fence loss is retained in the operation ledger", async () => {
  const originalFetch = globalThis.fetch;
  const mutations: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async () => new Response(JSON.stringify({
    id: "or_video_stale",
    polling_url: "https://openrouter.ai/api/v1/videos/or_video_stale",
    status: "pending",
  }), { status: 200 })) as any;
  const ctx = {
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.jobId) return { _id: "job_1", status: "streaming" };
      if (args.userId) return "sk-test";
      if (args.messageId) return { _id: "msg_user", content: "Make a launch video" };
      if (args.modelId) return { videoCapabilities: {} };
      return null;
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
      if ("inputHash" in args) return { decision: "execute" };
      if (args.externalId === "or_video_stale" && "fence" in args) {
        throw new Error("STALE_EXECUTION_ATTEMPT");
      }
      if (args.status === "failed" && args.executionAttemptId === "attempt_1") {
        throw new Error("STALE_EXECUTION_ATTEMPT");
      }
      return undefined;
    },
    scheduler: { runAfter: async () => undefined },
    storage: { getUrl: async () => null },
  } as any;
  try {
    await assert.rejects(submitVideoGenerationHandler(ctx, {
      ...baseArgs(),
      execution: {
        runId: "execution_1",
        attemptId: "attempt_1",
        fence: 4,
        claimantId: "video-workflow:job_1",
      },
    }), /STALE_EXECUTION_ATTEMPT/);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.ok(mutations.some((entry) =>
    entry.externalId === "or_video_stale" && !("fence" in entry)
  ));
  assert.equal(mutations.some((entry) => "openRouterJobId" in entry), false);
});

test("video polling completes, stores media, finalizes message, and marks related flows complete", async () => {
  const originalFetch = globalThis.fetch;
  const mutations: Array<Record<string, unknown>> = [];
  const scheduled: Array<Record<string, unknown>> = [];
  const stored: Blob[] = [];
  const pollArgs = {
    videoJobId: "video_job_1",
    chatId: "chat_1",
    userMessageId: "msg_user",
    assistantMessageIds: ["msg_assistant"],
    generationJobIds: ["job_1"],
    messageId: "msg_assistant",
    jobId: "job_1",
    userId: "user_1",
    searchSessionId: "search_1",
    drivePickerBatchId: "batch_1",
  } as any;

  const responses = [
    new Response(JSON.stringify({
      id: "or_video_1",
      polling_url: "https://poll",
      status: "completed",
      unsigned_urls: ["https://cdn.example.com/video.mp4"],
      usage: { cost: 0.25, is_byok: true },
    }), { status: 200 }),
    new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
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
          _creationTime: Date.now() - 12_000,
          status: "in_progress",
          pollCount: 3,
          openRouterJobId: "or_video_1",
        };
      }
      if (args.jobId) return { _id: "job_1", status: "completed" };
      if (args.userId) return "sk-test";
      return null;
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
      if (args.messageId === "msg_assistant" && !("content" in args)) return true;
      return undefined;
    },
    scheduler: {
      runAfter: async (_delay: number, _ref: unknown, payload: Record<string, unknown>) => {
        scheduled.push(payload);
      },
    },
    storage: {
      store: async (blob: Blob) => {
        stored.push(blob);
        return "storage_video";
      },
      getUrl: async () => "https://files.example.com/video.mp4",
    },
  } as any;

  try {
    await pollVideoGenerationHandler(ctx, pollArgs);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(stored.length, 1);
  assert.ok(mutations.some((args) =>
    args.status === "completed" &&
    (args.videoUrls as string[] | undefined)?.[0] === "https://files.example.com/video.mp4",
  ));
  assert.ok(mutations.some((args) =>
    (args.media as { storageId?: string } | undefined)?.storageId === "storage_video"
  ));
  assert.ok(mutations.some((args) => (args.patch as { status?: string } | undefined)?.status === "completed"));
  assert.ok(mutations.some((args) => args.batchId === "batch_1" && args.status === "completed"));
  const completedAnalytics = scheduled.find((entry) => entry.event === "assistant_response_completed");
  const durationMs = (completedAnalytics?.properties as { duration_ms?: unknown } | undefined)?.duration_ms;
  assert.equal(typeof durationMs, "number");
  assert.ok((durationMs as number) >= 0);
});

test("stale video completion deletes a newly stored orphan and cannot publish", async () => {
  const originalFetch = globalThis.fetch;
  const mutations: Array<Record<string, unknown>> = [];
  const deleted: string[] = [];
  let fenceValidationCount = 0;
  const responses = [
    new Response(JSON.stringify({
      id: "or_video_1",
      status: "completed",
      polling_url: "https://poll",
      unsigned_urls: ["https://cdn.example/video.mp4"],
    }), { status: 200 }),
    new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
  ];
  globalThis.fetch = (async () => {
    const response = responses.shift();
    assert.ok(response);
    return response;
  }) as any;
  const args = {
    ...baseArgs(),
    videoJobId: "video_job_1",
    messageId: "msg_assistant",
    jobId: "job_1",
    workflowManaged: true,
    executionAttemptId: "attempt_1",
    executionFence: 4,
    executionClaimantId: "video-workflow:job_1",
  } as any;
  const ctx = {
    runQuery: async (_ref: unknown, queryArgs: Record<string, unknown>) => {
      if (queryArgs.videoJobId) {
        return {
          _id: "video_job_1",
          status: "in_progress",
          pollCount: 1,
          openRouterJobId: "or_video_1",
          model: "video/model",
        };
      }
      if (queryArgs.jobId) return { _id: "job_1", status: "streaming" };
      if (queryArgs.userId) return "sk-test";
      return null;
    },
    runMutation: async (_ref: unknown, mutationArgs: Record<string, unknown>) => {
      mutations.push(mutationArgs);
      const isFenceValidation = mutationArgs.attemptId === "attempt_1"
        && mutationArgs.fence === 4
        && !("claimantId" in mutationArgs)
        && !("videoJobId" in mutationArgs);
      if (isFenceValidation) {
        fenceValidationCount += 1;
        if (fenceValidationCount >= 3) throw new Error("STALE_EXECUTION_ATTEMPT");
      }
      if (mutationArgs.videoJobId && mutationArgs.status === "failed") {
        throw new Error("STALE_EXECUTION_ATTEMPT");
      }
      return undefined;
    },
    scheduler: { runAfter: async () => undefined },
    storage: {
      store: async () => "storage_orphan",
      getUrl: async () => "https://files.example/video.mp4",
      delete: async (storageId: string) => deleted.push(storageId),
    },
  } as any;
  try {
    await assert.rejects(
      pollVideoGenerationHandler(ctx, args),
      /STALE_EXECUTION_ATTEMPT/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(deleted, ["storage_orphan"]);
  assert.equal(mutations.some((entry) =>
    entry.status === "completed" && ("content" in entry || "media" in entry)
  ), false);
});

test("video polling handles cancelled, failed, timeout, and download-failure terminal paths", async () => {
  const originalFetch = globalThis.fetch;
  const mutations: Array<Record<string, unknown>> = [];
  const scheduled: Array<{ delay: number; payload?: Record<string, unknown> }> = [];
  let mode: "cancelled" | "failed" | "timeout" | "missing" | "progress" = "cancelled";

  const ctx = {
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.videoJobId) {
        return {
          _id: "video_job_1",
          _creationTime: Date.now() - 1_000,
          status: "in_progress",
          pollCount: mode === "timeout" ? 39 : 0,
          openRouterJobId: "or_video_1",
        };
      }
      if (args.jobId) return { _id: "job_1", status: mode === "cancelled" ? "cancelled" : "failed" };
      if (args.userId) return "sk-test";
      return null;
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
      return args.messageId === "msg_assistant" && !("content" in args);
    },
    scheduler: {
      runAfter: async (delay: number, _ref: unknown, payload?: Record<string, unknown>) => {
        scheduled.push({ delay, payload });
      },
    },
  } as any;

  const args = {
    ...baseArgs(),
    videoJobId: "video_job_1",
    messageId: "msg_assistant",
    jobId: "job_1",
  } as any;

  try {
    await pollVideoGenerationHandler(ctx, args);
    assert.ok(scheduled.some((entry) =>
      entry.delay === 0 &&
      entry.payload?.event === "assistant_response_failed" &&
      (entry.payload?.properties as Record<string, unknown> | undefined)?.source === "video_generation"));

    mode = "failed";
    globalThis.fetch = (async () => new Response(JSON.stringify({
      id: "or_video_1",
      status: "failed",
      polling_url: "https://poll",
      error: { message: "provider failed" },
    }), { status: 200 })) as any;
    await pollVideoGenerationHandler(ctx, args);

    mode = "timeout";
    globalThis.fetch = (async () => new Response(JSON.stringify({
      id: "or_video_1",
      status: "in_progress",
      polling_url: "https://poll",
    }), { status: 200 })) as any;
    await pollVideoGenerationHandler(ctx, args);

    mode = "missing";
    let missingFetchCount = 0;
    globalThis.fetch = (async () => {
      missingFetchCount += 1;
      if (missingFetchCount === 1) {
        return new Response(JSON.stringify({
          id: "or_video_1",
          status: "completed",
          polling_url: "https://poll",
        }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }) as any;
    await pollVideoGenerationHandler(ctx, args);

    mode = "progress";
    globalThis.fetch = (async () => new Response(JSON.stringify({
      id: "or_video_1",
      status: "pending",
      polling_url: "https://poll",
    }), { status: 200 })) as any;
    await pollVideoGenerationHandler(ctx, args);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.ok(mutations.some((entry) => entry.error === "Cancelled by user"));
  assert.ok(mutations.some((entry) => entry.error === "Video generation failed"));
  assert.ok(mutations.some((entry) => String(entry.error).includes("timed out")));
  assert.ok(mutations.some((entry) => entry.error === "Video download failed (HTTP 404)."));
  const providerTerminalMarks = mutations.filter((entry) =>
    Object.keys(entry).sort().join(",") === "status,videoJobId"
  );
  assert.deepEqual(providerTerminalMarks.map((entry) => entry.status), ["failed", "completed"]);
  assert.equal(scheduled.some((entry) => entry.delay > 0), false);
});

test("video submit failure finalizes generation and drive-picker batch", async () => {
  const mutations: Array<Record<string, unknown>> = [];
  const ctx = {
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.jobId) return { _id: "job_1", status: "queued" };
      if (args.userId) return "";
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

  await submitVideoGenerationHandler(ctx, baseArgs());

  assert.ok(mutations.some((entry) => entry.status === "failed" && String(entry.error).includes("No OpenRouter API key")));
  assert.ok(mutations.some((entry) => entry.batchId === "batch_1" && entry.status === "failed"));
});

test("video submit cancellation after provider submission emits terminal analytics without duplicate start", async () => {
  const originalFetch = globalThis.fetch;
  const mutations: Array<Record<string, unknown>> = [];
  const scheduled: Array<Record<string, unknown>> = [];
  let jobQueryCount = 0;
  let didFetch = false;

  globalThis.fetch = (async () => {
    didFetch = true;
    return new Response(JSON.stringify({
      id: "or_video_cancelled",
      polling_url: "https://openrouter.ai/api/v1/videos/or_video_cancelled",
      status: "pending",
    }), { status: 200 });
  }) as any;

  const ctx = {
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.jobId) {
        jobQueryCount += 1;
        return {
          _id: "job_1",
          status: jobQueryCount >= 4 ? "cancelled" : "streaming",
        };
      }
      if (args.userId) return "sk-test";
      if (args.messageId) return { _id: "msg_user", content: "Make a launch video" };
      if (args.modelId) return { videoCapabilities: {} };
      return null;
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
      if (args.openRouterJobId) return "video_job_1";
      return undefined;
    },
    scheduler: {
      runAfter: async (_delay: number, _ref: unknown, payload: Record<string, unknown>) => {
        scheduled.push(payload);
      },
    },
    storage: {
      getUrl: async () => null,
    },
  } as any;

  try {
    await submitVideoGenerationHandler(ctx, baseArgs());
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(mutations.some((entry) => entry.openRouterJobId === "or_video_cancelled"), true);
  assert.equal(didFetch, true);
  assert.ok(mutations.some((entry) => entry.batchId === "batch_1" && entry.status === "cancelled"));
  assert.equal(
    scheduled.filter((entry) => entry.event === "assistant_response_started").length,
    1,
  );
  assert.equal(
    scheduled.filter((entry) => entry.event === "assistant_response_failed").length,
    1,
  );
});

test("video submit exits without provider work when generation job is already cancelled", async () => {
  const originalFetch = globalThis.fetch;
  const mutations: Array<Record<string, unknown>> = [];
  const scheduled: Array<Record<string, unknown>> = [];
  let fetchCalled = false;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    return new Response("{}", { status: 200 });
  }) as any;

  const ctx = {
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.jobId) return { _id: "job_1", status: "cancelled" };
      return null;
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
      return undefined;
    },
    scheduler: {
      runAfter: async (_delay: number, _ref: unknown, payload: Record<string, unknown>) => {
        scheduled.push(payload);
      },
    },
  } as any;

  try {
    await submitVideoGenerationHandler(ctx, baseArgs());
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(fetchCalled, false);
  assert.ok(mutations.some((entry) => entry.batchId === "batch_1" && entry.status === "cancelled"));
  assert.equal(scheduled.some((entry) => entry.event === "assistant_response_started"), false);
});
