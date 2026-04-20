// convex/models/google_data_providers.ts
// =============================================================================
// Provider allowlist for conversations that include Google Workspace data
// (Gmail, Drive, Calendar). Only providers with documented data protection
// policies compatible with Google's Limited Use requirements are allowed.
// =============================================================================

/**
 * Providers allowed to receive Google Workspace data.
 * Each has contractual or policy-based ZDR / no-training guarantees.
 */
export const GOOGLE_DATA_ALLOWED_PROVIDERS = new Set([
  "openai",
  "anthropic",
  "google",
]);

/** Google integration identifiers that trigger the provider allowlist. */
export const GOOGLE_INTEGRATION_IDS = new Set([
  "gmail",
  "drive",
  "calendar",
]);

/** Check if a model's provider is allowed for Google Workspace data. */
export function isGoogleDataAllowedProvider(
  provider: string | undefined | null,
): boolean {
  if (!provider) return false;
  return GOOGLE_DATA_ALLOWED_PROVIDERS.has(provider.trim().toLowerCase());
}

/** Check if any enabled integrations require Google data protection. */
export function hasGoogleIntegrations(
  enabledIntegrations: string[] | undefined,
): boolean {
  if (!enabledIntegrations || enabledIntegrations.length === 0) return false;
  return enabledIntegrations.some((id) => GOOGLE_INTEGRATION_IDS.has(id));
}
