import { defineTable } from "convex/server";
import { v } from "convex/values";

const modelSelectionMode = v.union(
  v.literal("adapter_default"),
  v.literal("explicit"),
);

const routeStatus = v.union(
  v.literal("active"),
  v.literal("superseded"),
  v.literal("cleared"),
);

const routeFields = {
  deviceId: v.string(),
  adapterId: v.string(),
  modelSelectionMode,
  provider: v.optional(v.string()),
  modelId: v.optional(v.string()),
  routeHash: v.string(),
};

export const runtimeRoutingSchemaTables = {
  personaRuntimeBindings: defineTable({
    userId: v.string(),
    personaId: v.id("personas"),
    revision: v.number(),
    status: routeStatus,
    ...routeFields,
    createdAt: v.number(),
    updatedAt: v.number(),
    supersededAt: v.optional(v.number()),
  })
    .index("by_persona_status", ["personaId", "status"])
    .index("by_user_status", ["userId", "status", "updatedAt"]),

  chatParticipantRuntimeRoutes: defineTable({
    userId: v.string(),
    chatId: v.id("chats"),
    chatParticipantId: v.id("chatParticipants"),
    personaId: v.id("personas"),
    placement: v.union(v.literal("cloud"), v.literal("local")),
    sourceBindingId: v.optional(v.id("personaRuntimeBindings")),
    sourceBindingRevision: v.optional(v.number()),
    status: routeStatus,
    deviceId: v.optional(v.string()),
    adapterId: v.optional(v.string()),
    modelSelectionMode: v.optional(modelSelectionMode),
    provider: v.optional(v.string()),
    modelId: v.optional(v.string()),
    routeHash: v.string(),
    capturedAt: v.number(),
    supersededAt: v.optional(v.number()),
  })
    .index("by_participant_status", ["chatParticipantId", "status"])
    .index("by_chat_status", ["chatId", "status", "capturedAt"])
    .index("by_route_hash", ["routeHash"]),

  chatRuntimeOverrides: defineTable({
    userId: v.string(),
    chatId: v.id("chats"),
    revision: v.number(),
    status: routeStatus,
    ...routeFields,
    createdAt: v.number(),
    updatedAt: v.number(),
    supersededAt: v.optional(v.number()),
  })
    .index("by_chat_status", ["chatId", "status"])
    .index("by_user_status", ["userId", "status", "updatedAt"]),
};
