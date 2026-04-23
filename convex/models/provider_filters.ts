const EXCLUDED_OPENROUTER_PROVIDERS = new Set<string>();

export function isExcludedOpenRouterProvider(
  provider: string | undefined | null,
): boolean {
  if (!provider) return false;
  return EXCLUDED_OPENROUTER_PROVIDERS.has(provider.trim().toLowerCase());
}

export function filterExcludedOpenRouterProviders<T extends { provider?: string | null }>(
  models: T[],
): T[] {
  return models.filter((model) => !isExcludedOpenRouterProvider(model.provider));
}
