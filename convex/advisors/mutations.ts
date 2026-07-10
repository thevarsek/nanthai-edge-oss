import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireAuth, requirePro } from "../lib/auth";
import { scheduleBackendAnalytics } from "../analytics/backend_events";
import { advisorInstanceName, resolveAdvisorModel } from "./shared";
import { chatAdvisorInput } from "./validators";
import { chatAdvisorView } from "./view";
import {
  advisorEligibilityMessage,
  resolveAdvisorModelAvailability,
  resolveAdvisorEligibility,
} from "./eligibility";
import { MAX_ADVISORS_PER_CHAT } from "./constants";
import { stopAdvisorBatchConsultations } from "./lifecycle";

export const setChatAdvisors = mutation({
  args: {
    chatId: v.id("chats"),
    advisors: v.array(chatAdvisorInput),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    if (args.advisors.length > 0) await requirePro(ctx, userId);
    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.userId !== userId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Chat not found" });
    }
    const distinct = new Set(args.advisors.map((advisor) => String(advisor.personaId)));
    if (distinct.size !== args.advisors.length || args.advisors.length > MAX_ADVISORS_PER_CHAT) {
      throw new ConvexError({
        code: "ADVISOR_LIMIT",
        message: `Choose up to ${MAX_ADVISORS_PER_CHAT} distinct Advisors.`,
      });
    }
    const existing = await ctx.db
      .query("chatAdvisors")
      .withIndex("by_chat", (builder) => builder.eq("chatId", args.chatId))
      .collect();
    const participants = await ctx.db
      .query("chatParticipants")
      .withIndex("by_chat", (builder) => builder.eq("chatId", args.chatId))
      .collect();
    const existingByPersona = new Map(existing.map((row) => [String(row.personaId), row]));
    const newlyAdded = args.advisors.filter((advisor) =>
      !existingByPersona.has(String(advisor.personaId))
    );
    if (args.advisors.length > 0) {
      const eligibility = await resolveAdvisorEligibility(ctx, {
        userId,
        chat,
        participants,
        keptPersonaIds: [],
        selectedPersonaIds: args.advisors.map((advisor) => advisor.personaId),
      });
      if (!eligibility.isAvailable && newlyAdded.length > 0) {
        throw new ConvexError({
          code: "ADVISORS_UNAVAILABLE",
          message: advisorEligibilityMessage(eligibility.reasonCode),
        });
      }
    }
    const preferences = await ctx.db
      .query("userPreferences")
      .withIndex("by_user", (builder) => builder.eq("userId", userId))
      .first();
    const participantPersonaIds = new Set(
      participants.flatMap((participant) =>
        participant.personaId ? [String(participant.personaId)] : []
      ),
    );
    await Promise.all(args.advisors.map(async (advisor) => {
      const persona = await ctx.db.get(advisor.personaId);
      if (!persona || persona.userId !== userId) {
        throw new ConvexError({ code: "NOT_FOUND", message: "Advisor Persona not found" });
      }
      if (!existingByPersona.has(String(advisor.personaId))) {
        const model = resolveAdvisorModel(persona.modelId, preferences?.defaultModelId);
        const availability = participantPersonaIds.has(String(persona._id))
          ? { isAvailable: false, reasonCode: "participant_conflict" as const }
          : await resolveAdvisorModelAvailability(ctx, model.modelId);
        if (!availability.isAvailable) {
          throw new ConvexError({
            code: "ADVISOR_PERSONA_UNAVAILABLE",
            message: availability.reasonCode === "participant_conflict"
              ? `${persona.displayName} is already a chat participant and cannot be added as an Advisor.`
              : `${persona.displayName} needs an available text-output model to act as an Advisor.`,
          });
        }
      }
      return persona;
    }));

    const now = Date.now();
    const requestedIds = new Set(args.advisors.map((advisor) => String(advisor.personaId)));
    for (const row of existing) {
      if (!requestedIds.has(String(row.personaId))) {
        await ctx.db.delete(row._id);
        await scheduleBackendAnalytics(ctx, userId, "advisor_removed_from_chat", {
          chat_id: String(args.chatId),
          persona_id: String(row.personaId),
        });
      }
    }
    const assignmentIds = [];
    for (let index = 0; index < args.advisors.length; index++) {
      const advisor = args.advisors[index];
      const current = existingByPersona.get(String(advisor.personaId));
      if (current) {
        await ctx.db.patch(current._id, {
          sortOrder: index,
          allowWebSearch: advisor.allowWebSearch,
          updatedAt: now,
        });
        assignmentIds.push(current._id);
      } else {
        const assignmentId = await ctx.db.insert("chatAdvisors", {
          userId,
          chatId: args.chatId,
          personaId: advisor.personaId,
          instanceName: advisorInstanceName(advisor.personaId),
          sortOrder: index,
          allowWebSearch: advisor.allowWebSearch,
          createdAt: now,
          updatedAt: now,
        });
        assignmentIds.push(assignmentId);
        await scheduleBackendAnalytics(ctx, userId, "advisor_kept_for_chat", {
          chat_id: String(args.chatId),
          persona_id: String(advisor.personaId),
          web_search_enabled: advisor.allowWebSearch,
        });
      }
    }
    const views = await Promise.all(assignmentIds.map(async (assignmentId) => {
      const assignment = await ctx.db.get(assignmentId);
      return assignment ? await chatAdvisorView(ctx, assignment, {
        defaultModelId: preferences?.defaultModelId,
        participantPersonaIds,
      }) : null;
    }));
    return { advisors: views.filter((view) => view != null) };
  },
});

export const removeChatAdvisor = mutation({
  args: { chatId: v.id("chats"), personaId: v.id("personas") },
  returns: v.object({ removed: v.boolean() }),
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.userId !== userId) return { removed: false };
    const assignment = await ctx.db
      .query("chatAdvisors")
      .withIndex("by_chat_and_persona", (builder) =>
        builder.eq("chatId", args.chatId).eq("personaId", args.personaId),
      )
      .first();
    if (!assignment || assignment.userId !== userId) return { removed: false };
    await ctx.db.delete(assignment._id);
    await scheduleBackendAnalytics(ctx, userId, "advisor_removed_from_chat", {
      chat_id: String(args.chatId),
      persona_id: String(args.personaId),
    });
    return { removed: true };
  },
});

export const cancelBatch = mutation({
  args: { batchId: v.id("advisorBatches") },
  returns: v.object({ cancelled: v.boolean() }),
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const batch = await ctx.db.get(args.batchId);
    if (!batch || batch.userId !== userId) return { cancelled: false };
    return { cancelled: await stopAdvisorBatchConsultations(ctx, batch) };
  },
});
