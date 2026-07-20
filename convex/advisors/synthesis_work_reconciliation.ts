import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { terminalizeExecutionComponentByOperation } from
  "../execution/component_refs";
import { completeBatchForMessageHandler } from "./mutations_internal";
import { failAdvisorSynthesis } from "./synthesis_failure";

export type AdvisorSynthesisWorkResult =
  | { kind: "success"; returnValue: unknown }
  | { kind: "failed"; error: string }
  | { kind: "canceled" };

type SynthesisOutcome = "completed" | "failed" | "cancelled";

function batchOutcome(status: string): SynthesisOutcome | null {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  return null;
}

function messageOutcome(status: string): SynthesisOutcome | null {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  return null;
}

async function deriveCanonicalOutcome(
  ctx: MutationCtx,
  args: {
    operationId: string;
    batchId: Id<"advisorBatches">;
    assistantMessageId?: Id<"messages">;
  },
): Promise<SynthesisOutcome | null> {
  const batch = await ctx.db.get(args.batchId);
  if (!batch) return "failed";

  const terminalBatchOutcome = batchOutcome(batch.status);
  if (terminalBatchOutcome) return terminalBatchOutcome;
  if (
    batch.generationOperationIds
    && !batch.generationOperationIds.includes(args.operationId)
  ) {
    return "cancelled";
  }

  if (args.assistantMessageId) {
    const assistantMessageId = args.assistantMessageId;
    const message = await ctx.db.get(assistantMessageId);
    if (!message || message.advisorBatchId !== batch._id) return "cancelled";
    const outcome = messageOutcome(message.status);
    if (outcome) {
      await completeBatchForMessageHandler(ctx, {
        messageId: assistantMessageId,
      });
      return outcome;
    }

    const searchSession = await ctx.db.query("searchSessions")
      .withIndex("by_message", (query) =>
        query.eq("assistantMessageId", assistantMessageId),
      )
      .first();
    // Advanced search commits its downstream generation Workflow and this
    // handoff marker in one mutation. A failed/lost Workpool result after that
    // boundary must not cancel the generation that now owns terminalization.
    return searchSession?.generationHandoffOperationId ? "completed" : null;
  }

  const messages = await Promise.all(
    batch.assistantMessageIds.map((messageId) => ctx.db.get(messageId)),
  );
  const outcomes = messages.map((message) =>
    message ? messageOutcome(message.status) : null
  );
  if (outcomes.some((outcome) => outcome === null)) return null;
  const firstMessageId = batch.assistantMessageIds[0];
  if (firstMessageId) {
    await completeBatchForMessageHandler(ctx, { messageId: firstMessageId });
  }
  if (outcomes.includes("completed")) return "completed";
  return outcomes.every((outcome) => outcome === "cancelled")
    ? "cancelled"
    : "failed";
}

export async function settleAdvisorSynthesisWorkFromCanonicalState(
  ctx: MutationCtx,
  args: {
    operationId: string;
    batchId: Id<"advisorBatches">;
    assistantMessageId?: Id<"messages">;
  },
): Promise<boolean> {
  const outcome = await deriveCanonicalOutcome(ctx, args);
  if (!outcome) return false;
  await terminalizeExecutionComponentByOperation(
    ctx,
    "interactive-workpool",
    args.operationId,
    outcome,
  );
  return true;
}

export async function reconcileAdvisorSynthesisWorkHandler(
  ctx: MutationCtx,
  args: {
    workId: string;
    result: AdvisorSynthesisWorkResult;
    context: {
      batchId: Id<"advisorBatches">;
      assistantMessageId?: Id<"messages">;
    };
  },
): Promise<void> {
  if (args.result.kind === "success") {
    if (await settleAdvisorSynthesisWorkFromCanonicalState(ctx, {
      operationId: args.workId,
      ...args.context,
    })) return;
    await terminalizeExecutionComponentByOperation(
      ctx,
      "interactive-workpool",
      args.workId,
      "failed",
    );
    await failAdvisorSynthesis(
      ctx,
      args.context.batchId,
      "Advisor synthesis worker returned without a terminal message or durable generation handoff.",
    );
    return;
  }
  if (await settleAdvisorSynthesisWorkFromCanonicalState(ctx, {
    operationId: args.workId,
    ...args.context,
  })) return;

  const outcome = args.result.kind === "canceled" ? "cancelled" : "failed";
  await terminalizeExecutionComponentByOperation(
    ctx,
    "interactive-workpool",
    args.workId,
    outcome,
  );
  await failAdvisorSynthesis(
    ctx,
    args.context.batchId,
    args.result.kind === "failed"
      ? args.result.error
      : "Advisor synthesis was cancelled",
  );
}
