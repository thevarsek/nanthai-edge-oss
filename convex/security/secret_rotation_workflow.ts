import { v } from "convex/values";
import { internal } from "../_generated/api";
import { durableWorkflow } from "../execution/components";

export const runSecretRotationWorkflow = durableWorkflow
  .define({
    args: {
      rotationId: v.id("secretCryptoRotations"),
      targetKeyId: v.string(),
      dryRun: v.boolean(),
      executionAttemptId: v.id("executionAttempts"),
      executionFence: v.number(),
      claimantId: v.string(),
    },
    returns: v.null(),
  })
  .handler(async (step, args): Promise<null> => {
    const executionArgs = {
      rotationId: args.rotationId,
      executionAttemptId: args.executionAttemptId,
      executionFence: args.executionFence,
      claimantId: args.claimantId,
    };
    const processTable = async (
      table: "oauthConnections" | "userSecrets" | "mcpCredentials",
      verifying: boolean,
    ): Promise<void> => {
      let cursor: string | undefined;
      while (true) {
        const result = table === "mcpCredentials"
          ? await step.runAction(
            internal.security.secret_rotation_mcp_action.processMcpRotationPage,
            { ...args, cursor, verifying },
            { retry: true },
          )
          : await step.runAction(
            internal.security.secret_rotation_actions.processRotationPage,
            { ...args, table, cursor, verifying },
            { retry: true },
          );
        if (result.isDone) return;
        cursor = result.cursor;
      }
    };

    try {
      await processTable("oauthConnections", false);
      await step.runMutation(
        internal.security.secret_rotation_mutations.setRotationPhase,
        {
          ...executionArgs,
          status: args.dryRun ? "dry_run" : "running",
          table: "userSecrets",
        },
      );
      await processTable("userSecrets", false);
      await step.runMutation(
        internal.security.secret_rotation_mutations.setRotationPhase,
        {
          ...executionArgs,
          status: args.dryRun ? "dry_run" : "running",
          table: "mcpCredentials",
        },
      );
      await processTable("mcpCredentials", false);
      if (!args.dryRun) {
        await step.runMutation(
          internal.security.secret_rotation_mutations.setRotationPhase,
          { ...executionArgs, status: "verifying", table: "oauthConnections" },
        );
        await processTable("oauthConnections", true);
        await step.runMutation(
          internal.security.secret_rotation_mutations.setRotationPhase,
          { ...executionArgs, status: "verifying", table: "userSecrets" },
        );
        await processTable("userSecrets", true);
        await step.runMutation(
          internal.security.secret_rotation_mutations.setRotationPhase,
          { ...executionArgs, status: "verifying", table: "mcpCredentials" },
        );
        await processTable("mcpCredentials", true);
      }
      const state = await step.runQuery(
        internal.security.secret_rotation_queries.getRotationState,
        { rotationId: args.rotationId },
      );
      const succeeded = state !== null && state.failureCount === 0;
      await step.runMutation(
        internal.security.secret_rotation_mutations.setRotationPhase,
        {
          ...executionArgs,
          status: succeeded ? "completed" : "failed",
          table: "mcpCredentials",
          lastSafeErrorCode: succeeded ? undefined : "CREDENTIAL_UNAVAILABLE",
        },
      );
      if (!succeeded) throw new Error("SECRET_ROTATION_VERIFICATION_FAILED");
      await step.runMutation(internal.execution.mutations.terminalize, {
        attemptId: args.executionAttemptId,
        fence: args.executionFence,
        claimantId: args.claimantId,
        outcome: "completed",
        summary: args.dryRun
          ? "Secret credential rotation dry run completed"
          : "Secret credential rotation completed",
      });
      return null;
    } catch (error) {
      await step.runMutation(
        internal.security.secret_rotation_mutations.setRotationPhase,
        {
          ...executionArgs,
          status: "failed",
          table: "mcpCredentials",
          lastSafeErrorCode: "SECRET_ROTATION_FAILED",
        },
      ).catch(() => undefined);
      throw error;
    }
  });
