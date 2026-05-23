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

/** Return provider identifiers derived from both provider metadata and model slug. */
export function googleDataProviderIdentifiers(
  modelId: string | undefined | null,
  provider: string | undefined | null,
): Set<string> {
  const identifiers = new Set<string>();
  const normalizedProvider = provider?.trim().toLowerCase();
  if (normalizedProvider) identifiers.add(normalizedProvider);

  const slug = modelId?.split("/")[0]?.trim().toLowerCase();
  if (slug) identifiers.add(slug);

  return identifiers;
}

/** Check if a model's provider is allowed for Google Workspace data. */
export function isGoogleDataAllowedProvider(
  provider: string | undefined | null,
): boolean {
  if (!provider) return false;
  return GOOGLE_DATA_ALLOWED_PROVIDERS.has(provider.trim().toLowerCase());
}

/** Check if a model's provider metadata or OpenRouter slug is allowed for Google Workspace data. */
export function isGoogleDataAllowedModel(
  modelId: string | undefined | null,
  provider: string | undefined | null,
): boolean {
  for (const identifier of googleDataProviderIdentifiers(modelId, provider)) {
    if (GOOGLE_DATA_ALLOWED_PROVIDERS.has(identifier)) return true;
  }
  return false;
}

/** Check if any enabled integrations require Google data protection. */
export function hasGoogleIntegrations(
  enabledIntegrations: string[] | undefined,
): boolean {
  if (!enabledIntegrations || enabledIntegrations.length === 0) return false;
  return enabledIntegrations.some((id) => GOOGLE_INTEGRATION_IDS.has(id));
}
