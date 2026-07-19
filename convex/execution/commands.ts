import { internalMutation, mutation } from "../_generated/server";
import { ConvexError, v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { requireAuth } from "../lib/auth";
import { appendExecutionEvent, assertCurrentFence } from "./control_plane";
import { authorizationSource, runtimeCommandStatus, runtimeCommandType } from "./validators";

export function stableInputHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function commandReplayMatches(
  existing: {
    inputHash: string; expectedFence: number; type: string;
    authorizationSource: string; payload?: string;
  },
  requested: {
    inputHash: string; expectedFence: number; type: string;
    authorizationSource: string; payload?: string;
  },
): boolean {
  return existing.inputHash === requested.inputHash
    && existing.expectedFence === requested.expectedFence
    && existing.type === requested.type
    && existing.authorizationSource === requested.authorizationSource
    && existing.payload === requested.payload;
}

const terminalStatuses = new Set(["completed", "rejected", "expired"] as const);

export async function transitionRuntimeCommand(
  ctx: MutationCtx,
  command: Doc<"runtimeCommands">,
  args: {
    status: "acknowledged" | "completed" | "rejected" | "expired";
    claimantId?: string;
    rejectionReason?: string;
    now?: number;
  },
): Promise<boolean> {
  if (command.status === args.status) return false;
  if (terminalStatuses.has(command.status as "completed" | "rejected" | "expired")) {
    throw new Error("RUNTIME_COMMAND_TERMINAL");
  }
  if (command.status === "pending" && args.status === "completed") {
    throw new Error("RUNTIME_COMMAND_NOT_CLAIMED");
  }
  if (command.status === "acknowledged" && args.status === "expired") {
    throw new Error("RUNTIME_COMMAND_ALREADY_CLAIMED");
  }
  if (command.claimedBy && args.claimantId && command.claimedBy !== args.claimantId) {
    throw new Error("RUNTIME_COMMAND_CLAIMANT_MISMATCH");
  }
  const now = args.now ?? Date.now();
  await ctx.db.patch(command._id, {
    status: args.status,
    claimedBy: command.claimedBy ?? args.claimantId,
    claimedAt: command.claimedAt ?? (args.status === "acknowledged" ? now : undefined),
    acknowledgedAt: command.acknowledgedAt ?? (args.status === "acknowledged" ? now : undefined),
    completedAt: args.status === "acknowledged" ? undefined : now,
    rejectionReason: args.rejectionReason?.slice(0, 2_000),
    updatedAt: now,
  });
  return true;
}

export const issue = mutation({
  args: {
    runId: v.id("executionRuns"), commandId: v.string(), expectedFence: v.number(),
    type: runtimeCommandType, authorizationSource, payload: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
  },
  returns: v.id("runtimeCommands"),
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    if (args.authorizationSource !== "explicit_user_turn") {
      throw new ConvexError({
        code: "FORBIDDEN" as const,
        message: "User-issued runtime commands require explicit user authorization",
      });
    }
    const run = await ctx.db.get(args.runId);
    if (!run || run.userId !== userId || !run.activeAttemptId) {
      throw new ConvexError({ code: "NOT_FOUND" as const, message: "Run not found" });
    }
    await assertCurrentFence(ctx, run.activeAttemptId, args.expectedFence);
    const now = Date.now();
    if (args.expiresAt !== undefined && args.expiresAt <= now) {
      throw new ConvexError({ code: "VALIDATION" as const, message: "Command is already expired" });
    }
    const existing = await ctx.db.query("runtimeCommands")
      .withIndex("by_run_command", (q) => q.eq("runId", run._id).eq("commandId", args.commandId))
      .unique();
    const inputHash = stableInputHash(`${args.type}\n${args.authorizationSource}\n${args.payload ?? ""}`);
    if (existing) {
      if (!commandReplayMatches(existing, { ...args, inputHash })) {
        throw new ConvexError({
          code: "CONFLICT" as const,
          message: "Command ID was already used for different input",
        });
      }
      return existing._id;
    }
    const id = await ctx.db.insert("runtimeCommands", {
      runId: run._id, attemptId: run.activeAttemptId, userId,
      commandId: args.commandId, expectedFence: args.expectedFence, type: args.type,
      status: "pending", authorizationSource: args.authorizationSource, initiatedBy: userId,
      inputHash, payload: args.payload, expiresAt: args.expiresAt, createdAt: now, updatedAt: now,
    });
    if (args.type === "cancel") {
      await appendExecutionEvent(ctx, {
        attemptId: run.activeAttemptId, fence: args.expectedFence, type: "cancel_requested",
        summary: "Cancellation requested by user command", now,
      });
      await ctx.db.patch(run._id, {
        state: "cancelling", cancelRequestedAt: now, cancelRequestedBy: userId, updatedAt: now,
      });
    }
    return id;
  },
});

export const claim = internalMutation({
  args: { commandId: v.id("runtimeCommands"), claimantId: v.string(), expectedFence: v.number() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const command = await ctx.db.get(args.commandId);
    if (!command || command.expectedFence !== args.expectedFence) return false;
    await assertCurrentFence(ctx, command.attemptId, args.expectedFence, {
      allowCancelling: command.type === "cancel",
    });
    const now = Date.now();
    if (command.expiresAt !== undefined && command.expiresAt <= now) {
      await transitionRuntimeCommand(ctx, command, { status: "expired", now });
      return false;
    }
    if (command.status === "acknowledged") return command.claimedBy === args.claimantId;
    await transitionRuntimeCommand(ctx, command, {
      status: "acknowledged", claimantId: args.claimantId, now,
    });
    return true;
  },
});

export const consume = internalMutation({
  args: {
    commandId: v.id("runtimeCommands"), claimantId: v.string(), expectedFence: v.number(),
    status: v.union(v.literal("completed"), v.literal("rejected")),
    rejectionReason: v.optional(v.string()),
  },
  returns: runtimeCommandStatus,
  handler: async (ctx, args) => {
    const command = await ctx.db.get(args.commandId);
    if (!command || command.expectedFence !== args.expectedFence) {
      throw new Error("RUNTIME_COMMAND_NOT_FOUND");
    }
    if (command.status === args.status) return command.status;
    await assertCurrentFence(ctx, command.attemptId, args.expectedFence, {
      allowCancelling: command.type === "cancel",
    });
    await transitionRuntimeCommand(ctx, command, {
      status: args.status, claimantId: args.claimantId, rejectionReason: args.rejectionReason,
    });
    return args.status;
  },
});

export const expire = internalMutation({
  args: { commandId: v.id("runtimeCommands"), now: v.optional(v.number()) },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const command = await ctx.db.get(args.commandId);
    const now = args.now ?? Date.now();
    if (!command || command.status !== "pending" || (command.expiresAt ?? Infinity) > now) return false;
    await transitionRuntimeCommand(ctx, command, { status: "expired", now });
    return true;
  },
});
