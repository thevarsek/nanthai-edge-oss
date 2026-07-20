/** A terminal Workflow or consumed event makes a repeated signal a no-op. */
export function isSettledWorkflowSignalError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error))
    .toLowerCase();
  const workflowSettled = /\bworkflow\b.{0,120}\b(?:not found|not running|already (?:completed|canceled|cancelled)|is (?:completed|canceled|cancelled))\b/;
  const eventSettled = /\bevent\b.{0,120}\b(?:not found|consumed|already (?:received|completed|canceled|cancelled))\b/;
  return workflowSettled.test(message) || eventSettled.test(message);
}
