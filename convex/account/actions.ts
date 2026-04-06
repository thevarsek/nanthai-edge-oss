// convex/account/actions.ts
// Account deletion action — orchestrates full user data purge.
// Required by Apple App Store guideline 5.1.1(v).

import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { requireAuth } from "../lib/auth";

/**
 * Tables to purge, ordered leaf-first for foreign-key safety.
 * Each table is processed in batches until fully drained.
 *
 * Index types used:
 * - Most tables: by_user index (prefix match on userId)
 * - messages: cascaded via chats (no by_user index)
 * - nodePositions: cascaded via chats (has userId but no by_user index)
 * - generationJobs, autonomousSessions: by_user_status index
 * - searchPhases: cascaded via searchSessions
 * - memoryEmbeddings: cascaded via memories
 * - subagentRuns: cascaded via subagentBatches (by_batch index)
 * - sandboxArtifacts: cascaded via sandboxSessions (by_session index, has storageId)
 * - sandboxEvents: by_user index
 * - sandboxSessions: by_user_status index
 * - integrationRequestGates: by_user_provider index (no by_user)
 * - skills: by_owner index (scope="user" + ownerUserId)
 */
const PURGE_ORDER = [
  // Cascade-dependent tables first (no direct userId or no by_user index)
  "searchPhases",
  "memoryEmbeddings",
  "nodePositions", // has userId but no by_user index; cascaded via chats
  // Subagent children before parents: runs (with inline storage) → batches
  "subagentRuns",    // cascade via subagentBatches; inline generatedFiles need blob cleanup
  "subagentBatches", // has by_user index
  // Sandbox children before parent: events & artifacts → sessions
  "sandboxEvents",    // has by_user index
  "sandboxArtifacts", // cascade via sandboxSessions; storageId needs blob cleanup
  "sandboxSessions",  // has by_user_status index
  // Leaf tables with userId
  "jobRuns",
  "generationJobs",
  "chatParticipants",
  "searchContexts",
  "searchSessions",
  "autonomousSessions",
  "modelSettings",
  "oauthConnections",
  "deviceTokens",
  "usageRecords",
  "userSecrets",
  "purchaseEntitlements",
  "favorites",
  "integrationRequestGates",
  "userCapabilities",
  "generatedCharts",
  // User-scoped skills (scope="user", ownerUserId)
  "skills",
  // Storage-bearing tables (blobs cleaned up during batch delete)
  "generatedFiles",
  "fileAttachments",
  // Messages cascaded via chats (also cleans up attachment storage)
  "messages",
  // Remaining parent tables
  "memories",
  "personas",
  "folders",
  "userPreferences",
  "scheduledJobs",
  "chats",
];

/**
 * Delete all user data from Convex. Called from the iOS client before
 * deleting the Clerk account and clearing the Keychain.
 *
 * Processes each table in batches to stay within Convex transaction limits.
 * Returns the total number of rows deleted.
 */
export const deleteAccount = action({
  args: {},
  handler: async (ctx): Promise<{ totalDeleted: number }> => {
    const { userId } = await requireAuth(ctx);
    let totalDeleted = 0;

    // Process each table in batches until fully drained
    for (const tableName of PURGE_ORDER) {
      let hasMore = true;
      while (hasMore) {
        const result: { deleted: number } = await ctx.runMutation(
          internal.account.mutations.deleteUserTableBatch,
          { userId, tableName },
        );
        totalDeleted += result.deleted;
        // If fewer than batch size (200) were deleted, the table is drained
        hasMore = result.deleted >= 200;
      }
    }

    return { totalDeleted };
  },
});
