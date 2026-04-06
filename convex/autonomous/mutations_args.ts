import { v, type PropertyValidators } from "convex/values";
import {
  moderatorConfigValidator,
  participantConfigValidator,
} from "./shared_validators";

export const startSessionArgs = {
  chatId: v.id("chats"),
  turnOrder: v.array(v.string()),
  maxCycles: v.number(),
  pauseBetweenTurns: v.number(),
  moderatorParticipantId: v.optional(v.string()),
  autoStopOnConsensus: v.boolean(),
  participantConfigs: v.array(participantConfigValidator),
  moderatorConfig: v.optional(moderatorConfigValidator),
  webSearchEnabled: v.optional(v.boolean()),
} satisfies PropertyValidators;

export const pauseSessionArgs = {
  sessionId: v.id("autonomousSessions"),
} satisfies PropertyValidators;

export const resumeSessionArgs = {
  sessionId: v.id("autonomousSessions"),
  participantConfigs: v.array(participantConfigValidator),
  moderatorConfig: v.optional(moderatorConfigValidator),
  webSearchEnabled: v.optional(v.boolean()),
} satisfies PropertyValidators;

export const stopSessionArgs = {
  sessionId: v.id("autonomousSessions"),
} satisfies PropertyValidators;

export const handleUserInterventionArgs = {
  sessionId: v.id("autonomousSessions"),
  forceSendNow: v.optional(v.boolean()),
} satisfies PropertyValidators;

export const updateProgressArgs = {
  sessionId: v.id("autonomousSessions"),
  currentCycle: v.number(),
  currentParticipantIndex: v.optional(v.number()),
} satisfies PropertyValidators;

export const updateParentMessageIdsArgs = {
  sessionId: v.id("autonomousSessions"),
  parentMessageIds: v.array(v.id("messages")),
} satisfies PropertyValidators;

export const completeSessionArgs = {
  sessionId: v.id("autonomousSessions"),
  status: v.union(
    v.literal("completed_consensus"),
    v.literal("completed_max_cycles"),
    v.literal("failed"),
  ),
  stopReason: v.optional(v.string()),
  error: v.optional(v.string()),
} satisfies PropertyValidators;

export const shouldContinueArgs = {
  sessionId: v.id("autonomousSessions"),
} satisfies PropertyValidators;
