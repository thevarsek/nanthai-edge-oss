import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { maintenanceWorkpool } from "./components";

export const enqueueMemoryBulkDelete = internalMutation({
  args: { userId: v.string() },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => await maintenanceWorkpool.enqueueMutation(
    ctx,
    internal.memory.operations_internal.deleteAllContinuation,
    args,
    { name: "memory-bulk-delete" },
  ),
});

export const enqueueMemoryBulkApprove = internalMutation({
  args: { userId: v.string() },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => await maintenanceWorkpool.enqueueMutation(
    ctx,
    internal.memory.operations_internal.approveAllContinuation,
    args,
    { name: "memory-bulk-approve" },
  ),
});

export const enqueueMemoryBulkReject = internalMutation({
  args: { userId: v.string() },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => await maintenanceWorkpool.enqueueMutation(
    ctx,
    internal.memory.operations_internal.rejectAllContinuation,
    args,
    { name: "memory-bulk-reject" },
  ),
});
