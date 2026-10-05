import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalQuery, type QueryCtx } from "../_generated/server";
import { runtimeHostError } from "./security";

export async function getLocalGenerationDispatchContextHandler(
  ctx: QueryCtx,
  args: { jobId: Id<"generationJobs">; sourceMessageId?: Id<"messages">; webSearchEnabled?: boolean },
) {
  const job = await ctx.db.get(args.jobId);
  if (!job?.executionRunId || !job.executionAttemptId || job.executionFence === undefined) {
    return null;
  }
  const run = await ctx.db.get(job.executionRunId);
  if (!run?.sourceMessageId) return null;
  const [attempt, sourceMessage, assistantMessage, chat] = await Promise.all([
    ctx.db.get(job.executionAttemptId),
    ctx.db.get(args.sourceMessageId ?? run.sourceMessageId),
    ctx.db.get(job.messageId),
    ctx.db.get(job.chatId),
  ]);
  if (
    !run
    || !attempt
    || !sourceMessage
    || !assistantMessage
    || !chat
    || run.activeAttemptId !== attempt._id
    || attempt.fence !== job.executionFence
    || sourceMessage.chatId !== job.chatId
  ) return null;
  if (attempt.placement !== "local" || attempt.executorKind !== "local_runtime") {
    return { placement: "cloud" as const };
  }
  if (
    !attempt.chatParticipantId
    || !attempt.routeSnapshotHash
    || !attempt.deviceId
  ) {
    throw new Error("LOCAL_GENERATION_ROUTE_INCOMPLETE");
  }
  const participant = await ctx.db.get(attempt.chatParticipantId);
  const personaConfig = job.effectivePersonaConfig;
  if (!personaConfig) throw new Error("LOCAL_GENERATION_CONFIGURATION_MISSING");
  const persona = await ctx.db.get(personaConfig.personaId);
  if (
    !participant
    || !persona
    || participant.userId !== job.userId
    || persona.userId !== job.userId
    || participant.chatId !== job.chatId
  ) throw new Error("LOCAL_GENERATION_PERSONA_MISMATCH");
  const routeSnapshotHash = attempt.routeSnapshotHash;
  if (args.webSearchEnabled) {
    const deviceId = attempt.deviceId;
    const device = await ctx.db.query("runtimeDevices")
      .withIndex("by_device_id", (query) => query.eq("deviceId", deviceId)).unique();
    const presence = device?.currentPresenceId ? await ctx.db.get(device.currentPresenceId) : null;
    const adapter = presence?.adapters.find((candidate) => candidate.adapterId === attempt.adapterId);
    if (adapter?.capabilities.adapterNative.webSearch !== true) {
      throw runtimeHostError("RUNTIME_SEARCH_UNAVAILABLE", attempt.adapterId === "codex"
        ? "Update NanthAI Runtime Host on this computer to use Basic search with Codex"
        : "Basic search is not available for Pi. Turn off Basic search to use this Persona.");
    }
  }
  const device = await ctx.db.query("runtimeDevices").withIndex("by_device_id", q => q.eq("deviceId", attempt.deviceId!)).unique();
  const presence = device?.currentPresenceId ? await ctx.db.get(device.currentPresenceId) : null;
  const includeSourceEvidence = presence?.adapters.some(adapter => adapter.adapterId === attempt.adapterId && adapter.capabilities.nanthaiSourceCitations === true) === true;
  const binding = await ctx.db.query("runtimeConversationBindings")
    .withIndex("by_participant_route_status", (query) =>
      query.eq("chatParticipantId", participant._id)
        .eq("routeSnapshotHash", routeSnapshotHash)
        .eq("status", "active"),
    )
    .unique();
  return {
    placement: "local" as const,
    includeSourceEvidence,
    job,
    run,
    attempt,
    sourceMessage,
    assistantMessage,
    chat,
    participant,
    persona,
    personaConfig,
    binding,
  };
}

export const getLocalGenerationDispatchContext = internalQuery({
  args: {
    jobId: v.id("generationJobs"),
    sourceMessageId: v.optional(v.id("messages")),
    webSearchEnabled: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: getLocalGenerationDispatchContextHandler,
});
