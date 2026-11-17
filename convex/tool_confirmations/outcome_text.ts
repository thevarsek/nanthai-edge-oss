import type { Doc } from "../_generated/dataModel";

// Model-facing text for confirmation outcomes. Pure so the V8 tool gate can
// import it without pulling in mutation-side delivery code.

export function nonInteractiveDenial(toolName: string): string {
  return `${toolName} needs the user's confirmation, but this turn has no interactive user `
    + "(for example a scheduled job, Telegram or an external MCP client). The action was not "
    + "performed. Tell the user to run it from the NanthAI app if they still want it.";
}

export function confirmationUnavailableDenial(toolName: string): string {
  return `${toolName} needs the user's confirmation, which is not available in this turn. `
    + "The action was not performed.";
}

/** Tool-message content and error flag delivered to the model on resume. */
export function confirmationOutcomeResult(
  request: Pick<Doc<"toolConfirmationRequests">, "status" | "toolName">,
): { result: string; isError?: true } {
  if (request.status === "approved") {
    return {
      result: JSON.stringify({
        confirmation: "approved",
        instruction: `The user approved this exact ${request.toolName} call. Call `
          + `${request.toolName} again now with exactly the same arguments to perform it. `
          + "The approval is single-use and covers only those arguments.",
      }),
    };
  }
  const error = request.status === "expired"
    ? `No confirmation was received before the timeout, so ${request.toolName} was not `
      + "performed. Treat this as declined and ask the user whether they still want it."
    : `The user declined this ${request.toolName} action, so it was not performed. `
      + "Do not retry it unless the user asks again.";
  return { result: JSON.stringify({ error, confirmation: request.status }), isError: true };
}
