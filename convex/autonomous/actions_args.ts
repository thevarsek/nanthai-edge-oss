import { v, type PropertyValidators } from "convex/values";
import {
  moderatorConfigValidator,
  participantConfigValidator,
} from "./shared_validators";

export const runCycleArgs = {
  sessionId: v.id("autonomousSessions"),
  cycle: v.number(),
  startParticipantIndex: v.optional(v.number()),
  userId: v.string(),
  participantConfigs: v.array(participantConfigValidator),
  moderatorConfig: v.optional(moderatorConfigValidator),
  webSearchEnabled: v.boolean(),
} satisfies PropertyValidators;
