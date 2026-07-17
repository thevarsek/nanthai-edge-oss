import { Id } from "../_generated/dataModel";
import { QueryCtx } from "../_generated/server";
import { optionalAuth } from "../lib/auth";
import { getAuthorizedChat, getAuthorizedMessage } from "./query_helpers";
import {
  getStreamingMessageByMessageId,
  isTerminalMessageStatus,
  mergeStreamingMessageRecords,
} from "./streaming_state";

export interface ListStreamingMessagesArgs extends Record<string, unknown> {
  chatId: Id<"chats">;
}

export type PresentationGenerationProgress = {
  phase: "queued" | "planning" | "repairing_plan" | "generating" |
    "repairing_generation" | "exporting" | "complete" | "failed";
  progress: number;
  title: string;
  slideCount?: number;
  error?: string;
};

type StreamingToolResult = {
  toolCallId: string;
  toolName: string;
  result: string;
  isError?: boolean;
};

function projectPhase(project: {
  workflowPhase?: PresentationGenerationProgress["phase"];
  status: string;
  snapshotStorageId?: Id<"_storage">;
}): PresentationGenerationProgress["phase"] {
  if (project.workflowPhase) return project.workflowPhase;
  if (project.status === "draft") return "queued";
  if (project.status === "planning") return "planning";
  if (project.status === "planned" || project.status === "generating") return "generating";
  if (project.status === "failed") return "failed";
  return project.snapshotStorageId ? "complete" : "exporting";
}

const PHASE_PROGRESS: Record<PresentationGenerationProgress["phase"], number> = {
  queued: 0.05,
  planning: 0.18,
  repairing_plan: 0.32,
  generating: 0.58,
  repairing_generation: 0.76,
  exporting: 0.9,
  complete: 1,
  failed: 0,
};

function projectProgress(
  phase: PresentationGenerationProgress["phase"],
  hasPlan: boolean,
): number {
  if (phase !== "failed") return PHASE_PROGRESS[phase];
  return hasPlan
    ? PHASE_PROGRESS.repairing_generation
    : PHASE_PROGRESS.repairing_plan;
}

export async function listStreamingMessagesHandler(
  ctx: QueryCtx,
  args: ListStreamingMessagesArgs,
): Promise<
  Array<{
    messageId: Id<"messages">;
    content: string;
    reasoning?: string;
    status: string;
    toolCalls?: Array<{
      id: string;
      name: string;
      arguments: string;
    }>;
    activeToolCallIds?: string[];
    toolResults?: StreamingToolResult[];
    updatedAt: number;
    presentationProgress?: PresentationGenerationProgress;
  }>
> {
  const auth = await optionalAuth(ctx);
  if (!auth) return [];

  const chat = await getAuthorizedChat(ctx, args.chatId, auth.userId);
  if (!chat) return [];

  const records = await ctx.db
    .query("streamingMessages")
    .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
    .collect();

  const dedupedByMessageId = new Map<string, typeof records>();
  for (const record of records) {
    const key = String(record.messageId);
    const existing = dedupedByMessageId.get(key) ?? [];
    existing.push(record);
    dedupedByMessageId.set(key, existing);
  }

  const merged = [...dedupedByMessageId.values()]
    .map((group) => mergeStreamingMessageRecords(group))
    .filter((record): record is NonNullable<typeof record> => record !== null);

  const activeRecords = [];
  for (const record of merged) {
    const message = await ctx.db.get(record.messageId);
    const isStaleActiveOverlay =
      message && isTerminalMessageStatus(message.status) && !isTerminalMessageStatus(record.status);
    if (!message || message.chatId !== args.chatId || isStaleActiveOverlay) {
      continue;
    }
    activeRecords.push(record);
  }

  return await Promise.all(activeRecords.map(async (record) => {
    const createCalls = (record.toolCalls ?? []).filter((call) => call.name === "create_presentation");
    const projects = createCalls.length > 0
      ? await ctx.db
        .query("presentationProjects")
        .withIndex("by_origin_assistant", (query) =>
          query.eq("originAssistantMessageId", record.messageId)
        )
        .order("desc")
        .take(10)
      : [];
    const fallbackCallId = createCalls.at(-1)?.id;
    const activeIds = new Set(record.activeToolCallIds ?? []);
    const resultByCallId = new Map(
      (record.toolResults ?? []).map((result) => [result.toolCallId, result]),
    );
    for (const [index, project] of projects.entries()) {
      const toolCallId = project.originToolCallId ?? (index === 0 ? fallbackCallId : undefined);
      if (!toolCallId) continue;
      const phase = projectPhase(project);
      if (phase === "failed" && !resultByCallId.has(toolCallId)) {
        resultByCallId.set(toolCallId, {
          toolCallId,
          toolName: "create_presentation",
          result: JSON.stringify({ error: project.error ?? "Presentation generation failed." }),
          isError: true,
        });
      } else if (phase !== "complete" && phase !== "failed") {
        activeIds.add(toolCallId);
      }
    }
    const latestProject = projects[0];
    const latestPhase = latestProject ? projectPhase(latestProject) : undefined;
    const presentationProgress = latestProject && latestPhase ? {
      phase: latestPhase,
      progress: projectProgress(latestPhase, Boolean(latestProject.plan?.length)),
      title: latestProject.title,
      slideCount: latestProject.plan?.length,
      error: latestPhase === "failed" ? latestProject.error : undefined,
    } : undefined;
    return {
      messageId: record.messageId,
      content: record.content,
      reasoning: record.reasoning,
      status: record.status,
      toolCalls: record.toolCalls,
      toolResults: resultByCallId.size > 0 ? [...resultByCallId.values()] : undefined,
      activeToolCallIds:
        record.activeToolCallIds !== undefined || activeIds.size > 0 ? [...activeIds] : undefined,
      updatedAt: Math.max(record.updatedAt, latestProject?.updatedAt ?? 0),
      presentationProgress,
    };
  }));
}

export interface GetStreamingContentArgs extends Record<string, unknown> {
  messageId: Id<"messages">;
}

export async function getStreamingContentHandler(
  ctx: QueryCtx,
  args: GetStreamingContentArgs,
): Promise<
  | {
      content: string;
      reasoning?: string;
      status: string;
      modelId?: string;
      participantName?: string;
      toolCalls?: Array<{
        id: string;
        name: string;
        arguments: string;
      }>;
      activeToolCallIds?: string[];
      usage?: unknown;
    }
  | null
> {
  const auth = await optionalAuth(ctx);
  if (!auth) return null;

  const msg = await getAuthorizedMessage(ctx, args.messageId, auth.userId);
  if (!msg) return null;

  const streaming = await getStreamingMessageByMessageId(ctx, args.messageId);
  const isStaleActiveOverlay =
    streaming && isTerminalMessageStatus(msg.status) && !isTerminalMessageStatus(streaming.status);
  if (streaming && !isStaleActiveOverlay) {
    return {
      content: streaming.content,
      reasoning: streaming.reasoning,
      status: streaming.status,
      modelId: msg.modelId,
      participantName: msg.participantName,
      toolCalls: streaming.toolCalls,
      ...(streaming.activeToolCallIds !== undefined
        ? { activeToolCallIds: streaming.activeToolCallIds }
        : {}),
      usage: msg.usage,
    };
  }

  return {
    content: msg.content,
    reasoning: msg.reasoning,
    status: msg.status,
    modelId: msg.modelId,
    participantName: msg.participantName,
    toolCalls: msg.toolCalls,
    usage: msg.usage,
  };
}
