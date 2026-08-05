import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";

import {
  cancelGenerationJobsForMessage,
  mapParticipantsForGeneration,
  normalizeMessageAttachments,
  normalizeParticipants,
  resolveParentMessageIdsForSend,
  scheduleCancelledAssistantResponseAnalytics,
} from "../chat/mutation_send_helpers";

type Row = Record<string, any>;

function buildCtx(options?: {
  records?: Record<string, Row>;
  tableRows?: Record<string, Row[]>;
  storageUrl?: string | null;
  storageMetadata?: { size: number; contentType: string | null } | null;
}) {
  const records = new Map(Object.entries(options?.records ?? {}));
  const tableRows = new Map(Object.entries(options?.tableRows ?? {}));
  const patches: Array<{ id: string; value: Row }> = [];
  const continuationCancels: string[] = [];
  const scheduledAnalytics: Row[] = [];

  const rowsFor = (table: string) => tableRows.get(table) ?? [];
  const chainFor = (table: string) => {
    const chain = {
      withIndex: (_index: string, apply?: (q: any) => unknown) => {
        const q = { eq: () => q };
        apply?.(q);
        return chain;
      },
      order: () => chain,
      first: async () => rowsFor(table)[0] ?? null,
      collect: async () => rowsFor(table),
      take: async (count: number) => rowsFor(table).slice(0, count),
    };
    return chain;
  };

  const ctx = {
    db: {
      get: async (id: string) => records.get(id) ?? null,
      query: (table: string) => chainFor(table),
      patch: async (id: string, value: Row) => {
        patches.push({ id, value });
      },
      delete: async (id: string) => {
        continuationCancels.push(id);
      },
    },
    storage: {
      getUrl: async () => options?.storageUrl ?? null,
      getMetadata: async () => options?.storageMetadata ?? { size: 512, contentType: "application/pdf" },
    },
    scheduler: {
      cancel: async (id: string) => {
        continuationCancels.push(id);
      },
      runAfter: async (_delay: number, _fn: unknown, payload: Row) => {
        scheduledAnalytics.push(payload);
        return "scheduled_analytics";
      },
    },
  } as any;

  return { ctx, patches, continuationCancels, scheduledAnalytics };
}

test("normalizeMessageAttachments resolves uploaded files, base64 sizes, and validation failures", async () => {
  const uploaded = buildCtx({
    storageUrl: "https://files.example/report.pdf",
    tableRows: { fileAttachments: [{ userId: "user_1", storageId: "storage_1" }] },
  });
  const normalized = await normalizeMessageAttachments(uploaded.ctx, "user_1", [
    {
      type: "pdf",
      storageId: "storage_1" as any,
      url: "https://stale.example/report.pdf",
      name: "  ",
      mimeType: "application/pdf",
    },
    {
      type: "image",
      url: `data:image/png;base64,${"A".repeat(68)}`,
      videoRole: "reference",
    },
  ]);

  assert.equal(normalized?.[0].url, "https://files.example/report.pdf");
  assert.equal(normalized?.[0].type, "document");
  assert.equal(normalized?.[0].name, "attachment");
  assert.equal(normalized?.[0].sizeBytes, 512);
  assert.equal(normalized?.[0].mimeType, "application/pdf");
  assert.equal(normalized?.[1].sizeBytes, 51);
  assert.equal(normalized?.[1].videoRole, "reference");
  assert.equal(await normalizeMessageAttachments(uploaded.ctx, "user_1", undefined), undefined);

  await assert.rejects(
    () => normalizeMessageAttachments(buildCtx({
      storageUrl: null,
      tableRows: { fileAttachments: [{ userId: "user_1", storageId: "missing" }] },
    }).ctx, "user_1", [
      { type: "document", storageId: "missing" as any },
    ]),
    (err) =>
      err instanceof ConvexError &&
      err.data.code === "VALIDATION" &&
      /upload failed/i.test(err.data.message),
  );
  await assert.rejects(
    () => normalizeMessageAttachments(buildCtx().ctx, "user_1", [
      {
        type: "document",
        url: "data:application/octet-stream;base64,A",
        sizeBytes: 26 * 1024 * 1024,
      },
    ]),
    /25 MB/i,
  );
  await assert.rejects(
    () => normalizeMessageAttachments(buildCtx({
      storageUrl: "https://files.example/oversized.bin",
      storageMetadata: { size: 26 * 1024 * 1024, contentType: "application/octet-stream" },
      tableRows: { fileAttachments: [{ userId: "user_1", storageId: "oversized" }] },
    }).ctx, "user_1", [
      { type: "document", storageId: "oversized" as any, sizeBytes: 1 },
    ]),
    /25 MB/i,
  );
});

test("normalizeMessageAttachments enforces storage ownership and consumes chat upload sessions", async () => {
  const foreign = buildCtx({
    records: { foreign_storage: { _id: "foreign_storage", userId: "user_other" } },
    tableRows: { fileAttachments: [{ userId: "user_other", storageId: "foreign_storage" }] },
  });
  await assert.rejects(
    () => normalizeMessageAttachments(foreign.ctx, "user_1", [{
      type: "document",
      storageId: "foreign_storage" as any,
    }]),
    /not owned/i,
  );

  const ownedSession = buildCtx({
    records: {
      upload_session: {
        _id: "upload_session",
        userId: "user_1",
        storageId: "storage_new",
        status: "pending",
      },
    },
    storageUrl: "https://files.example/new.pdf",
  });
  const normalized = await normalizeMessageAttachments(ownedSession.ctx, "user_1", [{
    type: "document",
    storageId: "storage_new" as any,
    uploadSessionId: "upload_session" as any,
  }]);
  assert.equal(normalized?.[0].uploadSessionId, "upload_session");
  assert.equal(ownedSession.patches[0].id, "upload_session");
  assert.equal(ownedSession.patches[0].value.status, "consumed");
  assert.equal(typeof ownedSession.patches[0].value.consumedAt, "number");
});

test("resolveParentMessageIdsForSend validates explicit parents and expands multi-model groups", async () => {
  const { ctx } = buildCtx({
    records: {
      explicit_valid: { _id: "explicit_valid", chatId: "chat_1" },
      explicit_foreign: { _id: "explicit_foreign", chatId: "chat_2" },
      leaf_1: { _id: "leaf_1", chatId: "chat_1", multiModelGroupId: "group_1" },
      latest_1: { _id: "latest_1", chatId: "chat_1", multiModelGroupId: "group_2" },
    },
    tableRows: {
      messages: [
        { _id: "sibling_b", chatId: "chat_1", multiModelGroupId: "group_1", createdAt: 20 },
        { _id: "sibling_a", chatId: "chat_1", multiModelGroupId: "group_1", createdAt: 10 },
      ],
    },
  });

  assert.deepEqual(
    await resolveParentMessageIdsForSend(ctx, {
      chatId: "chat_1" as any,
      explicitParentIds: ["explicit_valid", "explicit_valid", "explicit_foreign"] as any,
      expandMultiModelGroups: true,
    }),
    ["explicit_valid"],
  );
  assert.deepEqual(
    await resolveParentMessageIdsForSend(ctx, {
      chatId: "chat_1" as any,
      activeBranchLeafId: "leaf_1" as any,
      expandMultiModelGroups: true,
    }),
    ["leaf_1", "sibling_a", "sibling_b"],
  );
  assert.deepEqual(
    await resolveParentMessageIdsForSend(ctx, {
      chatId: "chat_1" as any,
      activeBranchLeafId: "leaf_1" as any,
      expandMultiModelGroups: false,
    }),
    ["leaf_1"],
  );
});

test("send helper defaults participants, maps optional fields, and cancels non-terminal jobs", async () => {
  assert.deepEqual(normalizeParticipants([], "openai/default"), [{ modelId: "openai/default" }]);

  const mapped = mapParticipantsForGeneration(
    [{ modelId: "model_a", personaId: null, personaName: null, reasoningEffort: null }],
    ["msg_1" as any],
    ["job_1" as any],
  );
  assert.equal(mapped[0].personaId, undefined);
  assert.equal(mapped[0].reasoningEffort, undefined);
  assert.equal(mapped[0].streamingMessageId, undefined);

  const { ctx, patches, continuationCancels } = buildCtx({
    tableRows: {
      generationJobs: [
        { _id: "job_running", messageId: "msg_1", status: "running" },
        { _id: "job_done", messageId: "msg_1", status: "completed" },
        { _id: "job_failed", messageId: "msg_1", status: "failed" },
      ],
      generationContinuations: [
        { _id: "cont_1", jobId: "job_running" },
      ],
    },
  });

  await cancelGenerationJobsForMessage(
    ctx,
    "msg_1" as any,
    123,
    "cancelled_by_retry",
  );

  assert.deepEqual(continuationCancels, ["cont_1"]);
  assert.deepEqual(patches, [
    {
      id: "job_running",
      value: {
        status: "cancelled",
        completedAt: 123,
        terminalErrorCode: "cancelled_by_retry",
      },
    },
  ]);
});

test("cancelled assistant analytics preserves deferred source metadata", async () => {
  const { ctx, scheduledAnalytics } = buildCtx({
    records: {
      message_1: { _id: "message_1", chatId: "chat_1" },
    },
    tableRows: {
      subagentBatches: [
        {
          _id: "batch_1",
          parentMessageId: "message_1",
          status: "running_children",
          paramsSnapshot: {
            analyticsSource: "research_paper",
            analytics: { platform: "web" },
          },
        },
      ],
    },
  });

  await scheduleCancelledAssistantResponseAnalytics(ctx, {
    _id: "job_1",
    userId: "user_1",
    chatId: "chat_1",
    messageId: "message_1",
    modelId: "openai/gpt-5",
    status: "streaming",
    startedAt: 123,
    analyticsStartedAt: 124,
  } as any);

  assert.equal(scheduledAnalytics[0]?.source, "research_paper");
  assert.deepEqual(scheduledAnalytics[0]?.analytics, { platform: "web" });
  assert.equal(scheduledAnalytics[0]?.subagentBatchId, "batch_1");
  assert.equal(scheduledAnalytics[0]?.emitStarted, false);
});

test("streaming handoff cancellation without a started timestamp emits a synthetic start", async () => {
  const { ctx, scheduledAnalytics } = buildCtx({
    records: {
      message_1: {
        _id: "message_1",
        chatId: "chat_1",
        searchSessionId: "search_1",
      },
      search_1: {
        _id: "search_1",
        mode: "paper",
      },
    },
  });

  await scheduleCancelledAssistantResponseAnalytics(ctx, {
    _id: "job_1",
    userId: "user_1",
    chatId: "chat_1",
    messageId: "message_1",
    modelId: "openai/gpt-5",
    status: "streaming",
    analytics: { platform: "web" },
  } as any);

  assert.equal(scheduledAnalytics[0]?.source, "research_paper");
  assert.deepEqual(scheduledAnalytics[0]?.analytics, { platform: "web" });
  assert.equal(scheduledAnalytics[0]?.emitStarted, true);
});

test("streaming video cancellation emits terminal analytics without a duplicate start", async () => {
  const { ctx, scheduledAnalytics } = buildCtx({
    records: {
      message_1: { _id: "message_1", chatId: "chat_1" },
    },
    tableRows: {
      videoJobs: [
        {
          _id: "video_job_1",
          messageId: "message_1",
          status: "in_progress",
        },
      ],
    },
  });

  await scheduleCancelledAssistantResponseAnalytics(ctx, {
    _id: "job_1",
    userId: "user_1",
    chatId: "chat_1",
    messageId: "message_1",
    modelId: "video/model",
    status: "streaming",
    startedAt: 123,
    analyticsStartedAt: 124,
    analytics: { platform: "web" },
  } as any);

  assert.equal(scheduledAnalytics[0]?.source, "video_generation");
  assert.deepEqual(scheduledAnalytics[0]?.analytics, { platform: "web" });
  assert.equal(scheduledAnalytics[0]?.emitStarted, false);
});

test("queued cancellation asks the analytics action to emit a matching start", async () => {
  const { ctx, scheduledAnalytics } = buildCtx({
    records: {
      message_1: { _id: "message_1", chatId: "chat_1" },
    },
  });

  await scheduleCancelledAssistantResponseAnalytics(ctx, {
    _id: "job_1",
    userId: "user_1",
    chatId: "chat_1",
    messageId: "message_1",
    modelId: "openai/gpt-5",
    status: "queued",
    analyticsSource: "web_search",
  } as any);

  assert.equal(scheduledAnalytics[0]?.source, "web_search");
  assert.equal(scheduledAnalytics[0]?.emitStarted, true);
});
