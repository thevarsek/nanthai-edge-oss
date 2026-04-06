// convex/memory/operations.ts
// =============================================================================
// Stable memory operations registrations.
// =============================================================================

import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "../_generated/server";
import {
  approveArgs,
  commitImportedMemoriesArgs,
  computeAndStoreEmbeddingArgs,
  createManualArgs,
  extractImportCandidatesArgs,
  getEmbeddingDocArgs,
  getMemoryDocArgs,
  listArgs,
  purgeUserMemoriesArgs,
  rejectArgs,
  removeArgs,
  retrieveRelevantArgs,
  storeEmbeddingArgs,
  togglePinArgs,
  updateArgs,
} from "./operations_args";
import {
  computeAndStoreEmbeddingHandler,
  consolidateForUserHandler,
  consolidateHandler,
  getDistinctMemoryUserIdsHandler,
  getEmbeddingDocHandler,
  getMemoryDocHandler,
  purgeUserMemoriesBatchHandler,
  purgeUserMemoriesHandler,
  retrieveRelevantHandler,
  storeEmbeddingHandler,
} from "./operations_internal_handlers";
import { extractImportCandidatesHandler } from "./operations_import_handlers";
import {
  approveAllHandler,
  approveHandler,
  commitImportedMemoriesHandler,
  createManualHandler,
  deleteAllHandler,
  listHandler,
  rejectAllHandler,
  rejectHandler,
  removeHandler,
  togglePinHandler,
  updateHandler,
} from "./operations_public_handlers";

export const list = query({
  args: listArgs,
  handler: listHandler,
});

export const togglePin = mutation({
  args: togglePinArgs,
  handler: togglePinHandler,
});

export const remove = mutation({
  args: removeArgs,
  handler: removeHandler,
});

export const approve = mutation({
  args: approveArgs,
  handler: approveHandler,
});

export const reject = mutation({
  args: rejectArgs,
  handler: rejectHandler,
});

export const update = mutation({
  args: updateArgs,
  handler: updateHandler,
});

export const createManual = mutation({
  args: createManualArgs,
  handler: createManualHandler,
});

export const extractImportCandidates = action({
  args: extractImportCandidatesArgs,
  handler: extractImportCandidatesHandler,
});

export const commitImportedMemories = mutation({
  args: commitImportedMemoriesArgs,
  handler: commitImportedMemoriesHandler,
});

export const deleteAll = mutation({
  args: {},
  handler: deleteAllHandler,
});

export const approveAll = mutation({
  args: {},
  handler: approveAllHandler,
});

export const rejectAll = mutation({
  args: {},
  handler: rejectAllHandler,
});

export const retrieveRelevant = internalAction({
  args: retrieveRelevantArgs,
  handler: retrieveRelevantHandler,
});

export const computeAndStoreEmbedding = internalAction({
  args: computeAndStoreEmbeddingArgs,
  handler: computeAndStoreEmbeddingHandler,
});

export const getEmbeddingDoc = internalQuery({
  args: getEmbeddingDocArgs,
  handler: getEmbeddingDocHandler,
});

export const getMemoryDoc = internalQuery({
  args: getMemoryDocArgs,
  handler: getMemoryDocHandler,
});

export const storeEmbedding = internalMutation({
  args: storeEmbeddingArgs,
  handler: storeEmbeddingHandler,
});

export const consolidate = internalAction({
  args: {},
  handler: consolidateHandler,
});

export const consolidateForUser = internalMutation({
  args: { userId: v.string(), cursor: v.optional(v.string()) },
  handler: consolidateForUserHandler,
});

export const getDistinctMemoryUserIds = internalQuery({
  args: {},
  handler: getDistinctMemoryUserIdsHandler,
});

export const purgeUserMemoriesBatch = internalMutation({
  args: purgeUserMemoriesArgs,
  handler: purgeUserMemoriesBatchHandler,
});

export const purgeUserMemories = internalAction({
  args: purgeUserMemoriesArgs,
  handler: purgeUserMemoriesHandler,
});
