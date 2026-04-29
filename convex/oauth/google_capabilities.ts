export type GoogleIntegrationId = "base" | "gmail" | "drive" | "calendar" | "workspace";

export const GOOGLE_BASE_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
] as const;

const GOOGLE_CAPABILITY_SCOPE_MAP: Record<GoogleIntegrationId, readonly string[]> = {
  base: GOOGLE_BASE_SCOPES,
  gmail: [
    ...GOOGLE_BASE_SCOPES,
  ],
  drive: [
    ...GOOGLE_BASE_SCOPES,
    "https://www.googleapis.com/auth/drive.file",
  ],
  calendar: [
    ...GOOGLE_BASE_SCOPES,
    "https://www.googleapis.com/auth/calendar.events",
  ],
  workspace: [
    ...GOOGLE_BASE_SCOPES,
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/calendar.events",
  ],
};

const GOOGLE_PROVIDER_SCOPE_BY_INTEGRATION: Record<Exclude<GoogleIntegrationId, "base" | "workspace">, string> = {
  gmail: "",
  drive: "https://www.googleapis.com/auth/drive.file",
  calendar: "https://www.googleapis.com/auth/calendar.events",
};

export function isGoogleIntegrationId(value: string): value is GoogleIntegrationId {
  return value === "base" || value === "gmail" || value === "drive" || value === "calendar" || value === "workspace";
}

export function googleScopesForIntegration(
  integrationId: GoogleIntegrationId,
): readonly string[] {
  return GOOGLE_CAPABILITY_SCOPE_MAP[integrationId];
}

export function googleProviderScopeForIntegration(
  integrationId: Exclude<GoogleIntegrationId, "base" | "workspace">,
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
    hasGmail: false,
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
