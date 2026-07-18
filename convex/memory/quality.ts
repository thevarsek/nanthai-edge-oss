import { v } from "convex/values";
import { internalAction, internalMutation } from "../_generated/server";
import {
  repairMemoryQualityPageHandler,
  runMemoryQualitySweepHandler,
} from "./quality_maintenance_handlers";

export const repairPage = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    dryRun: v.optional(v.boolean()),
  },
  returns: v.object({
    scannedCount: v.number(),
    normalizedScoreCount: v.number(),
    downgradedAlwaysOnCount: v.number(),
    promotedAlwaysOnCount: v.number(),
    taskExpiryCount: v.number(),
    assistantDerivedDisabledCount: v.number(),
    duplicateSupersededCount: v.number(),
    isComplete: v.boolean(),
    nextCursor: v.optional(v.string()),
  }),
  handler: repairMemoryQualityPageHandler,
});

export const sweep = internalAction({
  args: { dryRun: v.optional(v.boolean()) },
  returns: v.object({
    scannedCount: v.number(),
    normalizedScoreCount: v.number(),
    downgradedAlwaysOnCount: v.number(),
    promotedAlwaysOnCount: v.number(),
    taskExpiryCount: v.number(),
    assistantDerivedDisabledCount: v.number(),
    duplicateSupersededCount: v.number(),
  }),
  handler: runMemoryQualitySweepHandler,
});
