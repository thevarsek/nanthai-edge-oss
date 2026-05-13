import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";

import {
  cancelGenerationJobsForMessage,
  mapParticipantsForGeneration,
  normalizeMessageAttachments,
  normalizeParticipants,
  resolveParentMessageIdsForSend,
} from "../chat/mutation_send_helpers";

type Row = Record<string, any>;

function buildCtx(options?: {
  records?: Record<string, Row>;
  tableRows?: Record<string, Row[]>;
  storageUrl?: string | null;
}) {
  const records = new Map(Object.entries(options?.records ?? {}));
  const tableRows = new Map(Object.entries(options?.tableRows ?? {}));
  const patches: Array<{ id: string; value: Row }> = [];
  const continuationCancels: string[] = [];

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
    },
    scheduler: {
      cancel: async (id: string) => {
        continuationCancels.push(id);
      },
    },
  } as any;

  return { ctx, patches, continuationCancels };
}

test("normalizeMessageAttachments resolves uploaded files, base64 sizes, and validation failures", async () => {
  const uploaded = buildCtx({ storageUrl: "https://files.example/report.pdf" });
  const normalized = await normalizeMessageAttachments(uploaded.ctx, [
    {
      type: "document",
      storageId: "storage_1" as any,
      name: "  ",
      mimeType: "application/pdf",
    },
    {
      type: "image",
      url: "A".repeat(68),
      videoRole: "reference",
    },
  ]);

  assert.equal(normalized?.[0].url, "https://files.example/report.pdf");
  assert.equal(normalized?.[0].name, "attachment");
  assert.equal(normalized?.[0].sizeBytes, 0);
  assert.equal(normalized?.[1].sizeBytes, 51);
  assert.equal(normalized?.[1].videoRole, "reference");
  assert.equal(await normalizeMessageAttachments(uploaded.ctx, undefined), undefined);

  await assert.rejects(
    () => normalizeMessageAttachments(buildCtx({ storageUrl: null }).ctx, [
      { type: "document", storageId: "missing" as any },
    ]),
    (err) =>
      err instanceof ConvexError &&
      err.data.code === "VALIDATION" &&
      /upload failed/i.test(err.data.message),
  );
  await assert.rejects(
    () => normalizeMessageAttachments(buildCtx().ctx, [
      {
        type: "document",
        url: "https://files.example/huge.bin",
        sizeBytes: 26 * 1024 * 1024,
      },
    ]),
    /25 MB/i,
  );
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
        { _id: "cont_1", jobId: "job_running", scheduledFunctionId: "sched_1" },
      ],
    },
  });

  await cancelGenerationJobsForMessage(
    ctx,
    "msg_1" as any,
    123,
    "cancelled_by_retry",
  );

  assert.deepEqual(continuationCancels, ["sched_1", "cont_1"]);
  assert.deepEqual(patches, [
    {
      id: "job_running",
      value: {
        status: "cancelled",
        completedAt: 123,
        scheduledFunctionId: undefined,
        terminalErrorCode: "cancelled_by_retry",
      },
    },
  ]);
});
