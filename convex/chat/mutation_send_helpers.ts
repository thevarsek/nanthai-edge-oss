import { MutationCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { ConvexError } from "convex/values";
import { cancelGenerationContinuationHandler } from "./mutations_generation_continuation_handlers";
import { RetryContract } from "./retry_contract";
import { TerminalErrorCode } from "./terminal_error";

const MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024;

type RawAttachment = {
  type: string;
  url?: string;
  storageId?: Id<"_storage">;
  name?: string;
  mimeType?: string;
  sizeBytes?: number;
  videoRole?: "first_frame" | "last_frame" | "reference";
};

export type NormalizedAttachment = {
  type: string;
  url: string;
  storageId?: Id<"_storage">;
  name?: string;
  mimeType?: string;
  sizeBytes?: number;
  videoRole?: "first_frame" | "last_frame" | "reference";
};

export type SendParticipantConfig = {
  modelId: string;
  personaId?: Id<"personas"> | null;
  personaName?: string | null;
  personaEmoji?: string | null;
  personaAvatarImageUrl?: string | null;
  systemPrompt?: string | null;
  temperature?: number;
  maxTokens?: number;
  includeReasoning?: boolean;
  reasoningEffort?: string | null;
};

function looksLikeBase64(value: string): boolean {
  if (!value) return false;
  const compact = value.replace(/\s+/g, "");
  return compact.length >= 64 && /^[A-Za-z0-9+/=]+$/.test(compact);
}

export async function normalizeMessageAttachments(
  ctx: MutationCtx,
  attachments: RawAttachment[] | undefined,
) : Promise<NormalizedAttachment[] | undefined> {
  const normalizedAttachments = attachments
    ? await Promise.all(
      attachments.map(async (attachment) => {
        let resolvedUrl = attachment.url?.trim();
        if ((!resolvedUrl || resolvedUrl.length === 0) && attachment.storageId) {
          resolvedUrl = await ctx.storage.getUrl(attachment.storageId) ?? undefined;
        }
        if (!resolvedUrl || resolvedUrl.length === 0) {
          throw new ConvexError({ code: "VALIDATION", message: "Attachment upload failed. Please retry." });
        }

        return {
          type: attachment.type,
          url: resolvedUrl,
          storageId: attachment.storageId,
          name:
            attachment.name && attachment.name.trim().length > 0
              ? attachment.name
              : "attachment",
          mimeType: attachment.mimeType,
          sizeBytes:
            attachment.sizeBytes ??
            (looksLikeBase64(resolvedUrl)
              ? Math.floor((resolvedUrl.length * 3) / 4)
              : 0),
          videoRole: attachment.videoRole,
        };
      }),
    )
    : undefined;

  if (normalizedAttachments && normalizedAttachments.length > 0) {
    const totalBytes = normalizedAttachments.reduce((sum, attachment) => {
      const size =
        attachment.sizeBytes ??
        (looksLikeBase64(attachment.url ?? "")
          ? Math.floor(((attachment.url ?? "").length * 3) / 4)
          : 0);
      return sum + size;
    }, 0);
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new ConvexError({ code: "VALIDATION", message: "Attachments too large. Max total size is 25 MB." });
    }
  }

  return normalizedAttachments;
}

function dedupeIds<T extends string>(ids: T[]): T[] {
  const seen = new Set<T>();
  return ids.filter((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

async function resolveGroupParents(
  ctx: MutationCtx,
  chatId: Id<"chats">,
  anchorId: Id<"messages">,
  groupId: string,
): Promise<Id<"messages">[]> {
  const siblings = await ctx.db
    .query("messages")
    .withIndex("by_chat_group", (query) =>
      query.eq("chatId", chatId).eq("multiModelGroupId", groupId),
    )
    .collect();

  const siblingIds = siblings
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((message) => message._id);

  return [anchorId, ...siblingIds.filter((id) => id !== anchorId)];
}

export async function resolveParentMessageIdsForSend(
  ctx: MutationCtx,
  args: {
    chatId: Id<"chats">;
    activeBranchLeafId?: Id<"messages">;
    explicitParentIds?: Id<"messages">[];
    expandMultiModelGroups: boolean;
  },
): Promise<Id<"messages">[]> {
  let parentMessageIds: Id<"messages">[] = [];

  if (args.explicitParentIds && args.explicitParentIds.length > 0) {
    const uniqueExplicitParents = dedupeIds(args.explicitParentIds);
    const validatedExplicitParents: Id<"messages">[] = [];

    for (const parentId of uniqueExplicitParents) {
      const parentMessage = await ctx.db.get(parentId);
      if (parentMessage && parentMessage.chatId === args.chatId) {
        validatedExplicitParents.push(parentId);
      }
    }

    parentMessageIds = validatedExplicitParents;
  }

  if (parentMessageIds.length > 0) {
    return parentMessageIds;
  }

  let resolvedParents: Id<"messages">[] = [];

  if (args.activeBranchLeafId) {
    const leaf = await ctx.db.get(args.activeBranchLeafId);
    if (leaf && leaf.chatId === args.chatId) {
      if (args.expandMultiModelGroups && leaf.multiModelGroupId) {
        resolvedParents = await resolveGroupParents(
          ctx,
          args.chatId,
          args.activeBranchLeafId,
          leaf.multiModelGroupId,
        );
      } else {
        resolvedParents = [args.activeBranchLeafId];
      }
    }
  }

  if (resolvedParents.length === 0) {
    const recentMessages = await ctx.db
      .query("messages")
      .withIndex("by_chat", (query) => query.eq("chatId", args.chatId))
      .order("desc")
      .take(1);
    if (recentMessages.length > 0) {
      const latest = recentMessages[0];
      if (args.expandMultiModelGroups && latest.multiModelGroupId) {
        resolvedParents = await resolveGroupParents(
          ctx,
          args.chatId,
          latest._id,
          latest.multiModelGroupId,
        );
      } else {
        resolvedParents = [latest._id];
      }
    }
  }

  return dedupeIds(resolvedParents);
}

export function normalizeParticipants(
  participants: SendParticipantConfig[],
  defaultModelId: string,
): SendParticipantConfig[] {
  return participants.length > 0 ? participants : [{ modelId: defaultModelId }];
}

export async function createAssistantMessagesAndJobs(
  ctx: MutationCtx,
  args: {
    chatId: Id<"chats">;
    userId: string;
    participants: SendParticipantConfig[];
    parentMessageIds: Id<"messages">[];
    assistantCreatedAt: number;
    jobCreatedAt: number;
    enabledIntegrations?: string[];
    subagentsEnabled?: boolean;
    // M30 — Turn-level overrides for auditing
    turnSkillOverrides?: Array<{ skillId: Id<"skills">; state: "always" | "available" | "never" }>;
    turnIntegrationOverrides?: Array<{ integrationId: string; enabled: boolean }>;
    retryContract?: RetryContract;
  },
): Promise<{
  assistantMessageIds: Id<"messages">[];
  generationJobIds: Id<"generationJobs">[];
  streamingMessageIds: Id<"streamingMessages">[];
}> {
  const isMultiParticipant = args.participants.length > 1;
  const multiModelGroupId = isMultiParticipant ? crypto.randomUUID() : undefined;

  const assistantMessageIds: Id<"messages">[] = [];
  const generationJobIds: Id<"generationJobs">[] = [];
  const streamingMessageIds: Id<"streamingMessages">[] = [];

  for (const participant of args.participants) {
    const assistantMessageId = await ctx.db.insert("messages", {
      chatId: args.chatId,
      userId: args.userId,
      role: "assistant",
      content: "",
      modelId: participant.modelId,
      participantId: participant.personaId ?? undefined,
      participantName: participant.personaName ?? undefined,
      participantEmoji: participant.personaEmoji ?? undefined,
      participantAvatarImageUrl: participant.personaAvatarImageUrl ?? undefined,
      parentMessageIds: args.parentMessageIds,
      multiModelGroupId,
      isMultiModelResponse: isMultiParticipant,
      status: "pending",
      enabledIntegrations: args.enabledIntegrations,
      subagentsEnabled: args.subagentsEnabled,
      turnSkillOverrides: args.turnSkillOverrides,
      turnIntegrationOverrides: args.turnIntegrationOverrides,
      retryContract: args.retryContract,
      createdAt: args.assistantCreatedAt,
    });
    assistantMessageIds.push(assistantMessageId);

    const streamingMessageId = await ctx.db.insert("streamingMessages", {
      messageId: assistantMessageId,
      chatId: args.chatId,
      content: "",
      reasoning: undefined,
      status: "pending",
      toolCalls: undefined,
      createdAt: args.jobCreatedAt,
      updatedAt: args.jobCreatedAt,
    });
    streamingMessageIds.push(streamingMessageId);

    const jobId = await ctx.db.insert("generationJobs", {
      chatId: args.chatId,
      messageId: assistantMessageId,
      streamingMessageId,
      userId: args.userId,
      modelId: participant.modelId,
      status: "queued",
      createdAt: args.jobCreatedAt,
    });
    generationJobIds.push(jobId);
  }

  return { assistantMessageIds, generationJobIds, streamingMessageIds };
}

export function mapParticipantsForGeneration(
  participants: SendParticipantConfig[],
  assistantMessageIds: Id<"messages">[],
  generationJobIds: Id<"generationJobs">[],
  streamingMessageIds?: Id<"streamingMessages">[],
) {
  return participants.map((participant, index) => ({
    ...participant,
    personaId: participant.personaId ?? undefined,
    personaName: participant.personaName ?? undefined,
    personaEmoji: participant.personaEmoji ?? undefined,
    systemPrompt: participant.systemPrompt ?? undefined,
    reasoningEffort: participant.reasoningEffort ?? undefined,
    messageId: assistantMessageIds[index],
    jobId: generationJobIds[index],
    streamingMessageId: streamingMessageIds?.[index],
  }));
}

export async function cancelGenerationJobsForMessage(
  ctx: MutationCtx,
  messageId: Id<"messages">,
  now: number,
  terminalErrorCode?: Extract<TerminalErrorCode, "cancelled_by_retry" | "cancelled_by_user">,
): Promise<void> {
  const existingJobs = await ctx.db
    .query("generationJobs")
    .withIndex("by_message", (query) => query.eq("messageId", messageId))
    .collect();
  for (const job of existingJobs) {
    if (job.status !== "completed" && job.status !== "failed") {
      await cancelGenerationContinuationHandler(ctx, {
        jobId: job._id,
      });
      await ctx.db.patch(job._id, {
        status: "cancelled",
        completedAt: now,
        scheduledFunctionId: undefined,
        terminalErrorCode,
      });
    }
  }
}
