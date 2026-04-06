import { Doc, Id } from "../_generated/dataModel";
import { MutationCtx, QueryCtx } from "../_generated/server";

export type StreamingToolCall = {
  id: string;
  name: string;
  arguments: string;
};

type StreamingReader = Pick<QueryCtx | MutationCtx, "db">;

type MinimalMessage = Pick<Doc<"messages">, "_id" | "chatId" | "status">;
type StreamingMessageRecord = Doc<"streamingMessages">;

function isMeaningfulText(value: string | undefined): value is string {
  return value !== undefined && value.length > 0;
}

export function isTerminalMessageStatus(status: string | undefined): boolean {
  return status === "cancelled" || status === "failed" || status === "completed";
}

function isNewerStreamingRecord(
  candidate: StreamingMessageRecord,
  current: StreamingMessageRecord,
): boolean {
  const candidateUpdatedAt = candidate.updatedAt ?? Number.NEGATIVE_INFINITY;
  const currentUpdatedAt = current.updatedAt ?? Number.NEGATIVE_INFINITY;
  if (candidateUpdatedAt !== currentUpdatedAt) {
    return candidateUpdatedAt > currentUpdatedAt;
  }
  const candidateCreatedAt = candidate.createdAt ?? Number.NEGATIVE_INFINITY;
  const currentCreatedAt = current.createdAt ?? Number.NEGATIVE_INFINITY;
  if (candidateCreatedAt !== currentCreatedAt) {
    return candidateCreatedAt > currentCreatedAt;
  }
  return String(candidate._id) > String(current._id);
}

export function pickPrimaryStreamingMessage(
  records: StreamingMessageRecord[],
): StreamingMessageRecord | null {
  if (records.length === 0) {
    return null;
  }
  return records.reduce((current, candidate) =>
    isNewerStreamingRecord(candidate, current) ? candidate : current,
  );
}

export function splitStreamingMessageRecords(
  records: StreamingMessageRecord[],
): {
  primary: StreamingMessageRecord | null;
  duplicates: StreamingMessageRecord[];
} {
  const primary = pickPrimaryStreamingMessage(records);
  if (!primary) {
    return { primary: null, duplicates: [] };
  }
  return {
    primary,
    duplicates: records.filter((record) => record._id !== primary._id),
  };
}

function pickNewestMeaningfulText(
  records: StreamingMessageRecord[],
  read: (record: StreamingMessageRecord) => string | undefined,
): string | undefined {
  const candidates = records.filter((record) => isMeaningfulText(read(record)));
  if (candidates.length === 0) {
    return undefined;
  }
  const bestRecord = candidates.reduce((best, candidate) =>
    isNewerStreamingRecord(candidate, best) ? candidate : best,
  );
  return read(bestRecord);
}

function pickNewestMeaningfulToolCalls(
  records: StreamingMessageRecord[],
): StreamingToolCall[] | undefined {
  const candidates = records.filter(
    (record) => record.toolCalls !== undefined && record.toolCalls.length > 0,
  );
  if (candidates.length === 0) {
    return undefined;
  }
  return pickPrimaryStreamingMessage(candidates)?.toolCalls;
}

function pickMergedStreamingStatus(records: StreamingMessageRecord[]): Doc<"messages">["status"] {
  const terminalRecords = records.filter((record) => isTerminalMessageStatus(record.status));
  const preferred = pickPrimaryStreamingMessage(terminalRecords) ?? pickPrimaryStreamingMessage(records);
  return preferred?.status ?? "pending";
}

export function mergeStreamingMessageRecords(
  records: StreamingMessageRecord[],
): StreamingMessageRecord | null {
  const primary = pickPrimaryStreamingMessage(records);
  if (!primary) {
    return null;
  }

  const mergedContent = pickNewestMeaningfulText(records, (record) => record.content);
  const mergedReasoning = pickNewestMeaningfulText(records, (record) => record.reasoning);
  const mergedToolCalls = pickNewestMeaningfulToolCalls(records);

  return {
    ...primary,
    content: mergedContent ?? primary.content,
    reasoning: mergedReasoning ?? primary.reasoning,
    status: pickMergedStreamingStatus(records),
    toolCalls: mergedToolCalls ?? primary.toolCalls,
  };
}

export async function listStreamingMessagesByMessageId(
  ctx: StreamingReader,
  messageId: Id<"messages">,
) {
  return await ctx.db
    .query("streamingMessages")
    .withIndex("by_message", (q) => q.eq("messageId", messageId))
    .collect();
}

export async function getStreamingMessageByMessageId(
  ctx: StreamingReader,
  messageId: Id<"messages">,
) {
  const records = await listStreamingMessagesByMessageId(ctx, messageId);
  return mergeStreamingMessageRecords(records);
}

export async function upsertStreamingMessage(
  ctx: MutationCtx,
  message: MinimalMessage,
  patch: {
    content?: string;
    reasoning?: string;
    status?: Doc<"messages">["status"];
    toolCalls?: StreamingToolCall[];
  },
): Promise<void> {
  const records = await listStreamingMessagesByMessageId(ctx, message._id);
  const { primary, duplicates } = splitStreamingMessageRecords(records);
  const mergedExisting = mergeStreamingMessageRecords(records);
  const now = Date.now();

  if (primary) {
    await ctx.db.patch(primary._id, {
      content: patch.content ?? mergedExisting?.content ?? primary.content,
      reasoning: patch.reasoning ?? mergedExisting?.reasoning ?? primary.reasoning,
      status: patch.status ?? mergedExisting?.status ?? primary.status,
      toolCalls: patch.toolCalls ?? mergedExisting?.toolCalls ?? primary.toolCalls,
      updatedAt: now,
    });
    await Promise.all(duplicates.map((record) => ctx.db.delete(record._id)));
    return;
  }

  await ctx.db.insert("streamingMessages", {
    messageId: message._id,
    chatId: message.chatId,
    content: patch.content ?? "",
    reasoning: patch.reasoning,
    status: patch.status ?? message.status,
    toolCalls: patch.toolCalls,
    createdAt: now,
    updatedAt: now,
  });
}

export async function patchStreamingMessageStatus(
  ctx: MutationCtx,
  messageId: Id<"messages">,
  status: Doc<"messages">["status"],
): Promise<void> {
  const records = await listStreamingMessagesByMessageId(ctx, messageId);
  const { primary, duplicates } = splitStreamingMessageRecords(records);
  const mergedExisting = mergeStreamingMessageRecords(records);
  if (!primary) {
    return;
  }

  await ctx.db.patch(primary._id, {
    content: mergedExisting?.content ?? primary.content,
    reasoning: mergedExisting?.reasoning ?? primary.reasoning,
    status,
    toolCalls: mergedExisting?.toolCalls ?? primary.toolCalls,
    updatedAt: Date.now(),
  });
  await Promise.all(duplicates.map((record) => ctx.db.delete(record._id)));
}

export async function deleteStreamingMessage(
  ctx: MutationCtx,
  messageId: Id<"messages">,
): Promise<void> {
  const records = await listStreamingMessagesByMessageId(ctx, messageId);
  if (records.length === 0) {
    return;
  }

  await Promise.all(records.map((record) => ctx.db.delete(record._id)));
}
