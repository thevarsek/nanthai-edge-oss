export type GoogleIntegrationId = "base" | "gmail" | "drive" | "calendar";

export const GOOGLE_BASE_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
] as const;

const GOOGLE_CAPABILITY_SCOPE_MAP: Record<GoogleIntegrationId, readonly string[]> = {
  base: GOOGLE_BASE_SCOPES,
  gmail: [
    ...GOOGLE_BASE_SCOPES,
    "https://www.googleapis.com/auth/gmail.modify",
  ],
  drive: [
    ...GOOGLE_BASE_SCOPES,
    "https://www.googleapis.com/auth/drive",
  ],
  calendar: [
    ...GOOGLE_BASE_SCOPES,
    "https://www.googleapis.com/auth/calendar",
  ],
};

const GOOGLE_PROVIDER_SCOPE_BY_INTEGRATION: Record<Exclude<GoogleIntegrationId, "base">, string> = {
  gmail: "https://www.googleapis.com/auth/gmail.modify",
  drive: "https://www.googleapis.com/auth/drive",
  calendar: "https://www.googleapis.com/auth/calendar",
};

export function isGoogleIntegrationId(value: string): value is GoogleIntegrationId {
  return value === "base" || value === "gmail" || value === "drive" || value === "calendar";
}

export function googleScopesForIntegration(
  integrationId: GoogleIntegrationId,
): readonly string[] {
  return GOOGLE_CAPABILITY_SCOPE_MAP[integrationId];
}

export function googleProviderScopeForIntegration(
  integrationId: Exclude<GoogleIntegrationId, "base">,
): string {
  return GOOGLE_PROVIDER_SCOPE_BY_INTEGRATION[integrationId];
}

export function deriveGoogleCapabilityFlags(scopes: readonly string[]): {
  hasGmail: boolean;
  hasDrive: boolean;
  hasCalendar: boolean;
} {
  const scopeSet = new Set(scopes);
  return {
    hasGmail: scopeSet.has(GOOGLE_PROVIDER_SCOPE_BY_INTEGRATION.gmail),
    hasDrive: scopeSet.has(GOOGLE_PROVIDER_SCOPE_BY_INTEGRATION.drive),
    hasCalendar: scopeSet.has(GOOGLE_PROVIDER_SCOPE_BY_INTEGRATION.calendar),
  };
}

export function mergeGoogleScopes(
  existingScopes: readonly string[],
  newScopes: readonly string[],
): string[] {
  return Array.from(new Set([...existingScopes, ...newScopes])).sort();
}
