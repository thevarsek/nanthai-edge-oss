// convex/autonomous/mutations.ts
// =============================================================================
// Stable autonomous mutation registrations.
// =============================================================================

import { mutation, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import {
  completeSessionArgs,
  handleUserInterventionArgs,
  pauseSessionArgs,
  resumeSessionArgs,
  shouldContinueArgs,
  startSessionArgs,
  stopSessionArgs,
  updateParentMessageIdsArgs,
  updateProgressArgs,
} from "./mutations_args";
import {
  handleUserInterventionHandler,
  pauseSessionHandler,
  resumeSessionHandler,
  startSessionHandler,
  stopSessionHandler,
} from "./mutations_public_handlers";
import {
  completeSessionHandler,
  shouldContinueHandler,
  updateParentMessageIdsHandler,
  updateProgressHandler,
} from "./mutations_internal_handlers";

export {
  assertTurnConfiguration,
  computeResumeCursor,
  dedupeParticipantIds,
} from "./mutations_public_handlers";

export const startSession = mutation({
  args: startSessionArgs,
  returns: v.id("autonomousSessions"),
  handler: startSessionHandler,
});

export const pauseSession = mutation({
  args: pauseSessionArgs,
  handler: pauseSessionHandler,
});

export const resumeSession = mutation({
  args: resumeSessionArgs,
  handler: resumeSessionHandler,
});

export const stopSession = mutation({
  args: stopSessionArgs,
  handler: stopSessionHandler,
});

export const handleUserIntervention = mutation({
  args: handleUserInterventionArgs,
  handler: handleUserInterventionHandler,
});

export const updateProgress = internalMutation({
  args: updateProgressArgs,
  handler: updateProgressHandler,
});

export const updateParentMessageIds = internalMutation({
  args: updateParentMessageIdsArgs,
  handler: updateParentMessageIdsHandler,
});

export const completeSession = internalMutation({
  args: completeSessionArgs,
  handler: completeSessionHandler,
});

export const shouldContinue = internalMutation({
  args: shouldContinueArgs,
  returns: v.boolean(),
  handler: shouldContinueHandler,
});
