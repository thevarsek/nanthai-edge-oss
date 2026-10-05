import { sourceCitationValidator } from "../chat/source_evidence";
import { validateSourceEvidence } from "../chat/source_evidence_quotes";
import { importOfflineUsage } from "./offline_import_usage";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { authenticateRuntimeHost, runtimeHostError, sha256Hex } from "./security";
import { createExecutionRun } from "../execution/runs";
import { appendRunEventUnchecked } from "../execution/events";
import { ensureGeneratedFileRow } from "../chat/generated_file_registration";
import { offlineImportFileValidator } from "./offline_import_contract";
import { resolveEffectiveParticipantRoute } from "./route_resolution";

const argsValidator = {
  deviceId: v.string(), credentialId: v.string(), credential: v.string(),
  id: v.string(), originRunId: v.id("executionRuns"), previousResultId: v.union(v.string(), v.null()),
  inputHash: v.string(), baseOutputHash: v.string(), prompt: v.string(), output: v.string(),
  outcome: v.union(v.literal("completed"), v.literal("failed"), v.literal("interrupted"), v.literal("cancelled")),
  sourceCitations: v.optional(v.array(sourceCitationValidator)),
  createdAt: v.number(), files: v.array(offlineImportFileValidator), usageJson: v.string(),
};
type ImportArgs = import("convex/values").Infer<typeof _importArgs>;
const _importArgs = v.object(argsValidator);

export async function importOfflineResultHandler(ctx: MutationCtx, args: ImportArgs) {
  const { device } = await authenticateRuntimeHost(ctx, args);
  const previous = await ctx.db.query("runtimeOfflineImports")
    .withIndex("by_device_result", q => q.eq("deviceId", device.deviceId).eq("localResultId", args.id)).unique();
  if (previous) {
    if (previous.userId !== device.userId || previous.inputHash !== args.inputHash) throw runtimeHostError("IMPORT_IDENTITY_CHANGED", "Saved result identity changed");
    const message = await ctx.db.get(previous.assistantMessageId);
    const referenced = new Set((await Promise.all((message?.generatedFileIds ?? []).map(id => ctx.db.get(id))))
      .flatMap(file => file ? [file.storageId] : []));
    for (const file of args.files) if (!referenced.has(file.storageId)) await ctx.storage.delete(file.storageId);
    return { disposition: previous.disposition, assistantMessageId: previous.assistantMessageId };
  }
  const origin = await ctx.db.get(args.originRunId);
  const attempt = origin?.activeAttemptId ? await ctx.db.get(origin.activeAttemptId) : null;
  const job = origin?.generationJobId ? await ctx.db.get(origin.generationJobId) : null;
  const message = job ? await ctx.db.get(job.messageId) : null;
  const chat = origin?.chatId ? await ctx.db.get(origin.chatId) : null;
  if (!origin || !attempt || !job || !message || !chat || origin.userId !== device.userId
    || job.userId !== device.userId || message.userId !== device.userId || chat.userId !== device.userId
    || attempt.deviceId !== device.deviceId || attempt.placement !== "local" || chat.isDeleting) {
    throw runtimeHostError("SAVED_TASK_UNAVAILABLE", "The linked NanthAI task is no longer available. Local work is retained on this Mac.");
  }
  const parent = args.previousResultId ? await ctx.db.query("runtimeOfflineImports")
    .withIndex("by_device_result", q => q.eq("deviceId", device.deviceId).eq("localResultId", args.previousResultId!)).unique() : null;
  if (args.previousResultId && (!parent || parent.originRunId !== origin._id || parent.userId !== device.userId)) {
    throw runtimeHostError("IMPORT_PREDECESSOR_PENDING", "Earlier saved work must synchronize first");
  }
  const parentMessageId = parent?.assistantMessageId ?? message._id;
  const currentRoute = attempt.chatParticipantId ? await resolveEffectiveParticipantRoute(ctx, {
    userId: device.userId, chatParticipantId: attempt.chatParticipantId, personaId: job.effectivePersonaConfig?.personaId,
    now: Date.now(),
  }) : null;
  const taskUnchanged = origin.state === "completed" && job.status === "completed"
    && (parent ? parent.disposition === "synced" : await sha256Hex(message.content) === args.baseOutputHash)
    && (chat.activeBranchLeafId === parentMessageId)
    && (!attempt.routeSnapshotHash || currentRoute?.routeSnapshotHash === attempt.routeSnapshotHash);
  const disposition = taskUnchanged ? "synced" as const : "review" as const;
  const now = Date.now();
  const userMessageId = await ctx.db.insert("messages", {
    userId: device.userId, chatId: chat._id, role: "user", content: args.prompt, status: "completed",
    parentMessageIds: [parentMessageId], createdAt: now,
  });
  const offlineResult = { localResultId: args.id, originRunId: origin._id, disposition };
  const assistantMessageId = await ctx.db.insert("messages", {
    userId: device.userId, chatId: chat._id, role: "assistant", content: args.output,
    status: args.outcome === "completed" ? "completed" : args.outcome === "cancelled" ? "cancelled" : "failed",
    parentMessageIds: [userMessageId], chatParticipantId: attempt.chatParticipantId,
    modelId: attempt.modelId, participantId: job.effectivePersonaConfig?.personaId,
    sourceCitations: validateSourceEvidence(`${args.output}<SOURCE_CITATIONS>${JSON.stringify(args.sourceCitations ?? [])}</SOURCE_CITATIONS>`, job.runtimeEvidenceSources ?? []),
    offlineResult, createdAt: now + 1,
  });
  const execution = await createExecutionRun(ctx, {
    userId: device.userId, chatId: chat._id, sourceMessageId: userMessageId,
    kind: "chat_generation", requestedPlacement: "local", runKey: `offline:${device.deviceId}:${args.id}`,
    domainType: "runtime_offline_import", domainId: args.id,
    initialAttempt: { executorKind: "local_runtime", placement: "local", adapterId: attempt.adapterId,
      deviceId: device.deviceId, provider: attempt.provider, modelId: attempt.modelId,
      runtimeLabel: attempt.runtimeLabel, orchestrationEngine: "runtime_adapter" }, now,
  });
  await ctx.db.patch(execution.attemptId, { status: args.outcome, completedAt: now, updatedAt: now });
  await ctx.db.patch(execution.runId, { state: args.outcome === "interrupted" ? "failed" : args.outcome, completedAt: now, updatedAt: now });
  const run = await ctx.db.get(execution.runId);
  if (!run) throw new Error("OFFLINE_IMPORT_RUN_MISSING");
  await appendRunEventUnchecked(ctx, run, { attemptId: execution.attemptId, fence: execution.fence,
    type: args.outcome === "interrupted" ? "interrupted" : args.outcome,
    summary: disposition === "review" ? "Local work retained as a separate result" : "Saved local work synchronized",
    now, eventId: `offline-import:${args.id}` });
  const generatedFileIds: Id<"generatedFiles">[] = [];
  for (const file of args.files) {
    const metadata = await ctx.storage.getMetadata(file.storageId);
    if (!metadata || metadata.size !== file.sizeBytes) throw runtimeHostError("IMPORT_FILE_INVALID", "Saved artifact upload is incomplete");
    const registered = await ensureGeneratedFileRow(ctx, { userId: device.userId, chatId: chat._id,
      messageId: assistantMessageId, file: { ...file, toolName: "nanthai_publish_result" } });
    generatedFileIds.push(registered.id);
  }
  await ctx.db.patch(assistantMessageId, { generatedFileIds });
  await importOfflineUsage(ctx, { json: args.usageJson, localResultId: args.id, messageId: assistantMessageId,
    userId: device.userId, chatId: chat._id, deviceId: device.deviceId, adapterId: attempt.adapterId, modelId: attempt.modelId });
  const patch = { messageCount: (chat.messageCount ?? 0) + 2, updatedAt: now };
  if (disposition === "synced") await ctx.db.patch(chat._id, { ...patch, activeBranchLeafId: assistantMessageId,
    activeBranchLeafFocusOrder: undefined, lastMessageDate: now + 1, lastMessagePreview: args.output.slice(0, 200) });
  else await ctx.db.patch(chat._id, patch);
  await ctx.db.insert("runtimeOfflineImports", { chatId: chat._id, userId: device.userId, deviceId: device.deviceId,
    localResultId: args.id, inputHash: args.inputHash, originRunId: origin._id,
    runId: execution.runId, userMessageId, assistantMessageId, disposition, createdAt: now });
  return { disposition, assistantMessageId };
}
export const importResult = internalMutation({ args: argsValidator, handler: importOfflineResultHandler });

export const authorize = internalMutation({
  args: { deviceId: v.string(), credentialId: v.string(), credential: v.string(), originRunId: v.id("executionRuns") },
  handler: async (ctx, args) => {
    const { device } = await authenticateRuntimeHost(ctx, args);
    const run = await ctx.db.get(args.originRunId);
    const attempt = run?.activeAttemptId ? await ctx.db.get(run.activeAttemptId) : null;
    if (!run || run.userId !== device.userId || attempt?.deviceId !== device.deviceId || attempt.placement !== "local") {
      throw runtimeHostError("SAVED_TASK_UNAVAILABLE", "The linked task is not owned by this Mac");
    }
    return null;
  },
});
