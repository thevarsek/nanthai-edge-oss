import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ToolExecutionContext, ToolResult } from "./registry_types";
import { confirmationCandidate } from "./confirmation_policy";
import { confirmationUnavailableDenial, nonInteractiveDenial } from "../tool_confirmations/outcome_text";

/**
 * Server-enforced confirmation gate for consequential tool calls. Returns
 * null when the call may run now, or the tool result to return instead (a
 * denial, or a deferred handoff that pauses the turn for the user).
 */
export async function gateToolConfirmation(
  toolName: string,
  args: Record<string, unknown>,
  inputHash: string,
  toolCallId: string,
  toolCtx: ToolExecutionContext,
): Promise<ToolResult | null> {
  const candidate = confirmationCandidate(toolName, args);
  if (!candidate) return null;
  if (
    !toolCtx.jobId
    || !toolCtx.chatId
    || !toolCtx.messageId
    || !toolCtx.executionAttemptId
    || toolCtx.executionFence === undefined
  ) {
    return denial(toolCtx.confirmationAvailable === true
      ? confirmationUnavailableDenial(toolName)
      : nonInteractiveDenial(toolName));
  }
  const decision = await toolCtx.ctx.runMutation(internal.tool_confirmations.gate.evaluate, {
    userId: toolCtx.userId,
    chatId: toolCtx.chatId as Id<"chats">,
    messageId: toolCtx.messageId as Id<"messages">,
    ...(toolCtx.userMessageId ? { userMessageId: toolCtx.userMessageId as Id<"messages"> } : {}),
    jobId: toolCtx.jobId as Id<"generationJobs">,
    attemptId: toolCtx.executionAttemptId,
    fence: toolCtx.executionFence,
    toolCallId,
    toolName,
    inputHash,
    configuredAutomation: toolCtx.authorizationSource === "configured_automation",
    confirmationAvailable: toolCtx.confirmationAvailable === true,
    candidate: {
      kind: candidate.kind,
      summary: candidate.summary,
      ...(candidate.detail ? { detail: candidate.detail } : {}),
      recipients: candidate.recipients,
      integrations: candidate.integrations,
    },
  });
  if (decision.decision === "proceed") return null;
  if (decision.decision === "defer") {
    return {
      success: true,
      data: { status: "awaiting_user_confirmation" },
      deferred: {
        kind: "tool_confirmation",
        data: { confirmationId: decision.confirmationId },
      },
    };
  }
  if (decision.reason === "non_interactive") return denial(nonInteractiveDenial(toolName));
  if (decision.reason === "declined") {
    return denial(`The user already declined this ${toolName} action. It was not performed.`);
  }
  return denial(confirmationUnavailableDenial(toolName));
}

function denial(error: string): ToolResult {
  return { success: false, data: { confirmation: "denied" }, error };
}
