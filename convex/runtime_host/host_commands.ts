import { TERMINAL_RUN_STATES, TERMINAL_ATTEMPT_STATES } from "../execution/validators";
import { decryptRuntimeInputPayload } from "./input_requests";
import { query, mutation, type MutationCtx } from "../_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { assertCurrentExecution, claimExecutionRun } from "../execution/attempts";
import { transitionRuntimeCommand } from "../execution/commands";
import { linkExecutionComponent } from "../execution/component_refs";
import {
  authenticateRuntimeHost,
  runtimeHostError,
} from "./security";

const credentialArgs = {
  deviceId: v.string(),
  credentialId: v.string(),
  credential: v.string(),
  presenceSessionId: v.string(),
};

const commandProjection = v.object({
  commandRecordId: v.id("runtimeCommands"),
  runId: v.id("executionRuns"),
  attemptId: v.id("executionAttempts"),
  fence: v.number(),
  commandId: v.string(),
  type: v.string(),
  authorizationSource: v.string(),
  inputHash: v.string(),
  payload: v.optional(v.string()),
  turnPacketId: v.optional(v.id("runtimeTurnPackets")),
  expiresAt: v.optional(v.number()),
  createdAt: v.number(),
});

async function requireOnlinePresence(
  ctx: MutationCtx,
  runtimeDeviceId: Id<"runtimeDevices">,
  presenceSessionId: string,
  now: number,
) {
  const presence = await ctx.db.query("runtimeDevicePresences")
    .withIndex("by_device_session", (queryBuilder) =>
      queryBuilder.eq("runtimeDeviceId", runtimeDeviceId)
        .eq("presenceSessionId", presenceSessionId),
    )
    .unique();
  if (!presence || presence.status !== "online" || presence.expiresAt <= now) {
    throw runtimeHostError("RUNTIME_HOST_OFFLINE", "Runtime Host presence has expired");
  }
  return presence;
}

export const listPending = query({
  args: credentialArgs,
  returns: v.array(commandProjection),
  handler: async (ctx, args) => {
    const { device } = await authenticateRuntimeHost(ctx, args);
    const now = Date.now();
    const presence = await ctx.db.query("runtimeDevicePresences")
      .withIndex("by_device_session", (queryBuilder) =>
        queryBuilder.eq("runtimeDeviceId", device._id)
          .eq("presenceSessionId", args.presenceSessionId),
      )
      .unique();
    if (!presence || presence.status !== "online" || presence.expiresAt <= now) {
      throw runtimeHostError("RUNTIME_HOST_OFFLINE", "Runtime Host presence has expired");
    }
    const commands = await ctx.db.query("runtimeCommands")
      .withIndex("by_device_status", (queryBuilder) =>
        queryBuilder.eq("targetDeviceId", device.deviceId).eq("status", "pending"),
      )
      .order("asc")
      .take(100);
    return await Promise.all(commands.map(async (command) => ({
      commandRecordId: command._id,
      runId: command.runId,
      attemptId: command.attemptId,
      fence: command.expectedFence,
      commandId: command.commandId,
      type: command.type,
      authorizationSource: command.authorizationSource,
      inputHash: command.inputHash,
      payload: command.type === "prompt" ? await decryptRuntimeInputPayload(command) : command.payload,
      turnPacketId: command.turnPacketId,
      expiresAt: command.expiresAt,
      createdAt: command.createdAt,
    })));
  },
});

export const claim = mutation({
  args: { ...credentialArgs, commandRecordId: v.id("runtimeCommands") },
  returns: v.object({
    claimed: v.boolean(),
    leaseExpiresAt: v.optional(v.number()),
    claimantId: v.optional(v.string()),
  }),
  handler: async (ctx, args) => await claimRuntimeHostCommandHandler(ctx, args),
});

export async function claimRuntimeHostCommandHandler(
  ctx: MutationCtx,
  args: {
    deviceId: string;
    credentialId: string;
    credential: string;
    presenceSessionId: string;
    commandRecordId: Id<"runtimeCommands">;
  },
) {
    const { credential, device } = await authenticateRuntimeHost(ctx, args);
    const now = Date.now();
    const presence = await requireOnlinePresence(ctx, device._id, args.presenceSessionId, now);
    const command = await ctx.db.get(args.commandRecordId);
    if (!command || command.targetDeviceId !== device.deviceId) {
      throw runtimeHostError("NOT_FOUND", "Runtime command not found");
    }
    if (command.expiresAt !== undefined && command.expiresAt <= now) {
      if (command.status === "pending") {
        await transitionRuntimeCommand(ctx, command, { status: "expired", now });
      }
      return { claimed: false };
    }
    const [run, attempt] = await Promise.all([ctx.db.get(command.runId), ctx.db.get(command.attemptId)]);
    if (!run || !attempt || run.activeAttemptId !== attempt._id || attempt.fence !== command.expectedFence
      || TERMINAL_RUN_STATES.has(run.state as "completed" | "failed" | "cancelled")
      || TERMINAL_ATTEMPT_STATES.has(attempt.status as "completed" | "failed" | "cancelled" | "superseded")) {
      if (command.status === "pending") await transitionRuntimeCommand(ctx, command, { status: "expired", now });
      return { claimed: false };
    }
    const claimantId = `runtime-host:${device.deviceId}:${presence.presenceSessionId}`;
    const isCancellation = command.type === "cancel" || command.type === "shutdown";
    const current = isCancellation
      ? await assertCurrentExecution(ctx, {
          attemptId: command.attemptId,
          fence: command.expectedFence,
          claimantId,
          now,
          allowExpiredLease: true,
          allowCancelling: true,
          allowWaiting: true,
        })
      : null;
    const execution = current
      ? {
          runId: current.run._id,
          attemptId: current.attempt._id,
          fence: current.attempt.fence,
          leaseExpiresAt: current.attempt.leaseExpiresAt,
        }
      : await claimExecutionRun(ctx, {
          runId: command.runId,
          claimantId,
          now,
        });
    if (!execution || execution.attemptId !== command.attemptId
      || execution.fence !== command.expectedFence) {
      return { claimed: false };
    }
    if (!isCancellation) {
      await linkExecutionComponent(ctx, {
        runId: command.runId,
        attemptId: execution.attemptId,
        fence: execution.fence,
        adapterId: "local-runtime",
        operationId: `runtime-host:${String(execution.attemptId)}`,
        role: "runtime-host-attempt",
        now,
      });
    }
    if (command.status === "pending") {
      await transitionRuntimeCommand(ctx, command, {
        status: "acknowledged",
        claimantId,
        now,
      });
    } else if (command.status !== "acknowledged" || command.claimedBy !== claimantId) {
      return { claimed: false };
    }
    await ctx.db.patch(credential._id, { lastUsedAt: now });
    return {
      claimed: true,
      ...(execution.leaseExpiresAt === undefined
        ? {}
        : { leaseExpiresAt: execution.leaseExpiresAt }),
      claimantId,
    };
}

export const complete = mutation({
  args: {
    ...credentialArgs,
    commandRecordId: v.id("runtimeCommands"),
    status: v.union(v.literal("completed"), v.literal("rejected")),
    rejectionReason: v.optional(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => await completeRuntimeHostCommandHandler(ctx, args),
});

export async function completeRuntimeHostCommandHandler(
  ctx: MutationCtx,
  args: {
    deviceId: string;
    credentialId: string;
    credential: string;
    presenceSessionId: string;
    commandRecordId: Id<"runtimeCommands">;
    status: "completed" | "rejected";
    rejectionReason?: string;
  },
): Promise<boolean> {
    const { credential, device } = await authenticateRuntimeHost(ctx, args);
    const now = Date.now();
    const presence = await requireOnlinePresence(ctx, device._id, args.presenceSessionId, now);
    const command = await ctx.db.get(args.commandRecordId);
    if (!command || command.targetDeviceId !== device.deviceId) {
      throw runtimeHostError("NOT_FOUND", "Runtime command not found");
    }
    const claimantId = `runtime-host:${device.deviceId}:${presence.presenceSessionId}`;
    if (command.status === args.status) return false;
    const settledCancellation = await isSettledCancellationCompletion(
      ctx,
      command,
      claimantId,
      args.status,
    );
    if (!settledCancellation) {
      await assertCurrentExecution(ctx, {
        attemptId: command.attemptId,
        fence: command.expectedFence,
        allowCancelling: command.type === "cancel" || command.type === "shutdown",
        allowWaiting: true,
      });
    }
    await transitionRuntimeCommand(ctx, command, {
      status: args.status,
      claimantId,
      rejectionReason: args.rejectionReason,
      now,
    });
    await ctx.db.patch(credential._id, { lastUsedAt: now });
    return true;
}

async function isSettledCancellationCompletion(
  ctx: MutationCtx,
  command: Doc<"runtimeCommands">,
  claimantId: string,
  status: "completed" | "rejected",
): Promise<boolean> {
  if (
    status !== "completed"
    || (command.type !== "cancel" && command.type !== "shutdown")
    || command.status !== "acknowledged"
    || command.claimedBy !== claimantId
  ) return false;
  const attempt = await ctx.db.get(command.attemptId);
  if (
    !attempt
    || attempt.fence !== command.expectedFence
    || attempt.status !== "cancelled"
  ) return false;
  const run = await ctx.db.get(attempt.runId);
  return run?.activeAttemptId === attempt._id && run.state === "cancelled";
}
