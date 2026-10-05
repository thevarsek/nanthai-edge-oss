import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { query, type MutationCtx, type QueryCtx } from "../_generated/server";
import {
  AuthorizedFetchHandleSchema,
  MimeTypeSchema,
  RUNTIME_LIMITS,
} from "./protocol_common";
import { authenticateOnlineRuntimeHost } from "./host_session_auth";
import { runtimeHostError } from "./security";
import { getOwnedGeneratedMessageImages } from "./generated_image_context";

export interface RuntimeAttachmentGrantInput {
  sourceMessageId: Id<"messages">;
  handle: string;
  storageId: Id<"_storage">;
  mimeType: string;
  byteLength: number;
  maxChunkBytes: number;
  sha256: string;
  expiresAt: number;
}

export interface RuntimeAttachmentFetchGrant {
  storageId: Id<"_storage">;
  mimeType: string;
  byteLength: number;
  maxChunkBytes: number;
  sha256: string;
  expiresAt: number;
}

const credentialArgs = {
  deviceId: v.string(),
  credentialId: v.string(),
  credential: v.string(),
  presenceSessionId: v.string(),
};

const fetchGrant = v.object({
  storageId: v.id("_storage"),
  mimeType: v.string(),
  byteLength: v.number(),
  maxChunkBytes: v.number(),
  sha256: v.string(),
  expiresAt: v.number(),
});

export async function registerRuntimeAttachmentFetchHandles(
  ctx: MutationCtx,
  args: {
    turnPacketId: Id<"runtimeTurnPackets">;
    grants: RuntimeAttachmentGrantInput[];
    now?: number;
  },
): Promise<Id<"runtimeAttachmentFetchHandles">[]> {
  if (args.grants.length > RUNTIME_LIMITS.maxPartsPerMessage) {
    throw runtimeHostError(
      "VALIDATION_ERROR",
      "Runtime attachment manifest exceeds the packet part bound",
    );
  }
  const packet = await ctx.db.get(args.turnPacketId);
  if (!packet) throw runtimeHostError("NOT_FOUND", "Runtime turn packet not found");
  const run = await ctx.db.get(packet.runId);
  if (!run?.chatId || run.userId !== packet.userId) {
    throw runtimeHostError(
      "RUNTIME_ROUTE_MISMATCH",
      "Runtime attachment manifest does not belong to the packet owner",
    );
  }
  const now = args.now ?? Date.now();
  if (packet.expiresAt <= now) {
    throw runtimeHostError("VALIDATION_ERROR", "Runtime attachment manifest is expired");
  }
  const seen = new Set<string>();
  const ids: Id<"runtimeAttachmentFetchHandles">[] = [];
  for (const grant of args.grants) {
    validateGrant(grant, packet.expiresAt);
    if (seen.has(grant.handle)) {
      throw runtimeHostError("CONFLICT", "Runtime attachment handle is duplicated");
    }
    seen.add(grant.handle);
    const message = await ctx.db.get(grant.sourceMessageId);
    const uploaded = message?.attachments?.find((candidate) =>
      candidate.type === "image" && candidate.storageId === grant.storageId
    );
    const attachment = uploaded ?? (message?.imageUrls?.length
      ? (await getOwnedGeneratedMessageImages(ctx, { userId: packet.userId,
          chatId: run.chatId, messageId: message._id }))
        .find(image => image.storageId === grant.storageId)
      : undefined);
    if (
      !message
      || message.chatId !== run.chatId
      || !attachment
      || attachment.sizeBytes !== grant.byteLength
      || attachment.mimeType?.toLowerCase() !== grant.mimeType
    ) {
      throw runtimeHostError(
        "FORBIDDEN",
        "Runtime attachment is not an owned canonical message image",
      );
    }
    const metadata = await ctx.storage.getMetadata(grant.storageId);
    if (
      !metadata
      || metadata.size !== grant.byteLength
      || metadata.contentType?.toLowerCase() !== grant.mimeType
    ) {
      throw runtimeHostError(
        "RUNTIME_ATTACHMENT_INVALID",
        "Runtime attachment storage does not match its manifest",
      );
    }
    const existing = await ctx.db.query("runtimeAttachmentFetchHandles")
      .withIndex("by_handle", (queryBuilder) => queryBuilder.eq("handle", grant.handle))
      .unique();
    if (existing) {
      if (!sameGrant(existing, args.turnPacketId, grant)) {
        throw runtimeHostError("CONFLICT", "Runtime attachment handle is already bound");
      }
      ids.push(existing._id);
      continue;
    }
    ids.push(await ctx.db.insert("runtimeAttachmentFetchHandles", {
      userId: packet.userId,
      turnPacketId: packet._id,
      ...grant,
      createdAt: now,
    }));
  }
  return ids;
}

export async function getRuntimeAttachmentForHost(
  ctx: QueryCtx,
  args: {
    deviceId: string;
    credentialId: string;
    credential: string;
    presenceSessionId: string;
    handle: string;
  },
  now = Date.now(),
): Promise<RuntimeAttachmentFetchGrant | null> {
  const host = await authenticateOnlineRuntimeHost(ctx, args, now);
  if (host.presence.credentialId !== host.credential.credentialId) {
    throw runtimeHostError("UNAUTHORIZED", "Runtime Host presence credential is stale");
  }
  const grant = await ctx.db.query("runtimeAttachmentFetchHandles")
    .withIndex("by_handle", (queryBuilder) => queryBuilder.eq("handle", args.handle))
    .unique();
  if (!grant || grant.userId !== host.device.userId || grant.expiresAt <= now) return null;
  const packet = await ctx.db.get(grant.turnPacketId);
  if (!packet || packet.expiresAt <= now) return null;
  const [attempt, run, command] = await Promise.all([
    ctx.db.get(packet.attemptId),
    ctx.db.get(packet.runId),
    ctx.db.query("runtimeCommands")
      .withIndex("by_turn_packet", (queryBuilder) =>
        queryBuilder.eq("turnPacketId", packet._id),
      )
      .unique(),
  ]);
  if (!isCurrentClaimedPacket({ grant, packet, attempt, run, command }, host, now)) {
    return null;
  }
  return {
    storageId: grant.storageId,
    mimeType: grant.mimeType,
    byteLength: grant.byteLength,
    maxChunkBytes: grant.maxChunkBytes,
    sha256: grant.sha256,
    expiresAt: grant.expiresAt,
  };
}

export const getForHost = query({
  args: { ...credentialArgs, handle: v.string() },
  returns: v.union(fetchGrant, v.null()),
  handler: async (ctx, args) => await getRuntimeAttachmentForHost(ctx, args),
});

function validateGrant(grant: RuntimeAttachmentGrantInput, packetExpiresAt: number): void {
  const parsed = AuthorizedFetchHandleSchema.safeParse({
    handle: grant.handle,
    expiresAt: grant.expiresAt,
    byteLength: grant.byteLength,
    maxChunkBytes: grant.maxChunkBytes,
    sha256: grant.sha256,
  });
  const mime = MimeTypeSchema.safeParse(grant.mimeType);
  if (
    !parsed.success
    || !mime.success
    || !grant.mimeType.startsWith("image/")
    || grant.byteLength <= 0
    || grant.expiresAt !== packetExpiresAt
  ) {
    throw runtimeHostError("VALIDATION_ERROR", "Runtime attachment manifest is invalid");
  }
}

function sameGrant(
  existing: Doc<"runtimeAttachmentFetchHandles">,
  turnPacketId: Id<"runtimeTurnPackets">,
  grant: RuntimeAttachmentGrantInput,
): boolean {
  return existing.turnPacketId === turnPacketId
    && existing.sourceMessageId === grant.sourceMessageId
    && existing.storageId === grant.storageId
    && existing.mimeType === grant.mimeType
    && existing.byteLength === grant.byteLength
    && existing.maxChunkBytes === grant.maxChunkBytes
    && existing.sha256 === grant.sha256
    && existing.expiresAt === grant.expiresAt;
}

function isCurrentClaimedPacket(
  records: {
    grant: Doc<"runtimeAttachmentFetchHandles">;
    packet: Doc<"runtimeTurnPackets">;
    attempt: Doc<"executionAttempts"> | null;
    run: Doc<"executionRuns"> | null;
    command: Doc<"runtimeCommands"> | null;
  },
  host: Awaited<ReturnType<typeof authenticateOnlineRuntimeHost>>,
  now: number,
): boolean {
  const { grant, packet, attempt, run, command } = records;
  return grant.expiresAt === packet.expiresAt
    && packet.userId === host.device.userId
    && !!attempt
    && !!run
    && !!command
    && run._id === packet.runId
    && run.userId === packet.userId
    && run.activeAttemptId === attempt._id
    && run.state === "running"
    && attempt._id === packet.attemptId
    && attempt.runId === run._id
    && attempt.userId === packet.userId
    && attempt.fence === packet.fence
    && attempt.status === "running"
    && attempt.placement === "local"
    && attempt.executorKind === "local_runtime"
    && attempt.deviceId === host.device.deviceId
    && attempt.claimantId === host.claimantId
    && (attempt.leaseExpiresAt ?? 0) > now
    && command.turnPacketId === packet._id
    && command.runId === run._id
    && command.attemptId === attempt._id
    && command.userId === packet.userId
    && command.commandId === packet.commandId
    && command.expectedFence === packet.fence
    && (command.type === "start" || command.type === "resume")
    && command.status === "acknowledged"
    && command.targetDeviceId === host.device.deviceId
    && command.claimedBy === host.claimantId
    && (command.expiresAt === undefined || command.expiresAt > now);
}
