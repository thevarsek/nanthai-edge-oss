// Product availability for integrations whose backend support stays in place
// while the client-facing connect flow is switched off. Re-enable an
// integration by flipping its flag; existing connections keep their
// disconnect control either way.

export const isSlackIntegrationAvailable = false;

/** Whether settings should offer the Slack connect row. */
export function shouldShowSlackConnectionRow(isConnected: boolean): boolean {
  return isSlackIntegrationAvailable || isConnected;
}

/** Whether a Slack-backed option can be offered to users who have not already chosen it. */
export function isIntegrationOffered(integrationId: string): boolean {
  return integrationId !== "slack" || isSlackIntegrationAvailable;
}
