"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { killE2BSandbox } from "./e2b_client";

export const cleanupMarkedSessions = internalAction({
  args: {},
  handler: async (ctx) => {
    const sessions = await ctx.runQuery(internal.runtime.queries.listMarkedForCleanupInternal, {});
    for (const session of sessions) {
      const hasActiveGeneration = await ctx.runQuery(
        internal.runtime.queries.hasActiveGenerationForChatInternal,
        { chatId: session.chatId },
      );
      if (hasActiveGeneration) {
        continue;
      }

      try {
        if (session.providerSandboxId) {
          await killE2BSandbox(session.providerSandboxId);
        }
      } catch {
        // Best-effort kill; we still tombstone the session.
      }

      await ctx.runMutation(internal.runtime.mutations.upsertSessionInternal, {
        sessionId: session._id,
        userId: session.userId,
        chatId: session.chatId,
        providerSandboxId: undefined,
        templateName: session.templateName,
        templateVersion: session.templateVersion,
        status: "deleted",
        cwd: session.cwd,
        lastActiveAt: session.lastActiveAt,
        lastPausedAt: session.lastPausedAt,
        lastResumedAt: session.lastResumedAt,
        lastHealthcheckAt: session.lastHealthcheckAt,
        timeoutMs: session.timeoutMs,
        internetEnabled: session.internetEnabled,
        publicTrafficEnabled: session.publicTrafficEnabled,
        pendingDeletionReason: session.pendingDeletionReason ?? "cleanup",
        failureCount: session.failureCount,
        metadata: session.metadata,
      });
      await ctx.runMutation(internal.runtime.mutations.recordSandboxEventInternal, {
        sandboxSessionId: session._id,
        userId: session.userId,
        chatId: session.chatId,
        eventType: "sandbox_deleted",
        details: { reason: session.pendingDeletionReason ?? "cleanup" },
      });
    }
  },
});
