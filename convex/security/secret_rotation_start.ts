import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { claimExecutionRun } from "../execution/attempts";
import { linkExecutionComponent } from "../execution/component_refs";
import { durableWorkflow } from "../execution/components";
import { scheduleOwnedWorkflowWatchdog } from "../execution/owned_workflow_watchdog";
import { createExecutionRun } from "../execution/runs";
import { ownedWorkflowCompletionRef } from "../execution/workflow_lifecycle";

const ROTATION_MODE_ENV = "CONVEX_SECRET_ROTATION_MODE";
const ACTIVE_KID_ENV = "CONVEX_SECRET_ENCRYPTION_ACTIVE_KID";

export const ensureSecretCryptoRotation = internalMutation({
  args: {},
  handler: async (ctx): Promise<string | null> => {
    const mode = process.env[ROTATION_MODE_ENV]?.trim() ?? "disabled";
    if (mode !== "dry_run" && mode !== "rotate") return null;
    const targetKeyId = process.env[ACTIVE_KID_ENV]?.trim() || "k1";
    if (!/^k[1-9][0-9]*$/.test(targetKeyId)) {
      throw new Error("INVALID_SECRET_ROTATION_TARGET");
    }
    const active = await ctx.db
      .query("secretCryptoRotations")
      .withIndex("by_status")
      .filter((query) => query.or(
        query.eq(query.field("status"), "dry_run"),
        query.eq(query.field("status"), "running"),
        query.eq(query.field("status"), "verifying"),
      ))
      .first();
    if (active?.executionRunId) {
      const run = await ctx.db.get(active.executionRunId);
      const attempt = run?.activeAttemptId ? await ctx.db.get(run.activeAttemptId) : null;
      return attempt?.componentOperationId ?? null;
    }

    const now = Date.now();
    const rotationId = await ctx.db.insert("secretCryptoRotations", {
      sourceKeyIds: targetKeyId === "k1" ? ["plaintext", "v1"] : ["k1"],
      targetKeyId,
      status: mode === "dry_run" ? "dry_run" : "running",
      table: "oauthConnections",
      scannedCount: 0,
      migratedCount: 0,
      conflictCount: 0,
      failureCount: 0,
      startedAt: now,
      updatedAt: now,
    });
    const claimantId = `secret-rotation:${String(rotationId)}`;
    const execution = await createExecutionRun(ctx, {
      userId: "system:secret-crypto",
      runKey: `secret-rotation:${String(rotationId)}`,
      kind: "maintenance",
      requestedPlacement: "cloud",
      domainType: "secret_crypto_rotation",
      domainId: String(rotationId),
      initialAttempt: {
        executorKind: "convex_workflow",
        placement: "cloud",
        adapterId: "convex-workflow",
        provider: "nanthai",
      },
    });
    const claimed = await claimExecutionRun(ctx, {
      runId: execution.runId,
      claimantId,
      leaseMs: 20 * 60 * 1000,
    });
    if (!claimed) throw new Error("SECRET_ROTATION_NOT_CLAIMABLE");
    const workflowId = await durableWorkflow.start(
      ctx,
      internal.security.secret_rotation_workflow.runSecretRotationWorkflow,
      {
        rotationId,
        targetKeyId,
        dryRun: mode === "dry_run",
        executionAttemptId: claimed.attemptId,
        executionFence: claimed.fence,
        claimantId,
      },
      { startAsync: true, onComplete: ownedWorkflowCompletionRef, context: {} },
    );
    await ctx.db.patch(claimed.attemptId, {
      componentOperationId: workflowId,
      updatedAt: Date.now(),
    });
    await linkExecutionComponent(ctx, {
      runId: claimed.runId,
      attemptId: claimed.attemptId,
      fence: claimed.fence,
      adapterId: "convex-workflow",
      operationId: workflowId,
      role: "secret-crypto-rotation-workflow",
    });
    await scheduleOwnedWorkflowWatchdog(ctx, { workflowId, context: {} });
    await ctx.db.patch(rotationId, {
      executionRunId: claimed.runId,
      executionAttemptId: claimed.attemptId,
      updatedAt: Date.now(),
    });
    return workflowId;
  },
});
