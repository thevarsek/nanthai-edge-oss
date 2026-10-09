import { v } from "convex/values";

export const workStatus = v.union(
  v.literal("open"), v.literal("claimed"), v.literal("in_progress"),
  v.literal("review"), v.literal("blocked"), v.literal("done"), v.literal("cancelled"),
);
export const workEvidence = v.object({
  messageId: v.id("messages"),
  description: v.string(),
  sourceRevision: v.string(),
});
export const teamSettings = v.object({
  durationMinutes: v.number(),
  maxWaves: v.number(),
  maxPublicReplies: v.number(),
  consensusAutoStop: v.boolean(),
});
export const ordinaryTeamSettings = {
  durationMinutes: 15, maxWaves: 5, maxPublicReplies: 8, consensusAutoStop: false,
};
export const extendedTeamSettings = {
  durationMinutes: 60, maxWaves: 50, maxPublicReplies: 50, consensusAutoStop: false,
};
