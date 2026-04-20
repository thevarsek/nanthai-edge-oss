import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useQuery, useAction, useConvexAuth } from "convex/react";
import { useAuth } from "@clerk/clerk-react";
import { api } from "@convex/_generated/api";

export type ShellData = {
  prefs: ReturnType<typeof useQuery<typeof api.preferences.queries.getPreferences>>;
  modelSettings: ReturnType<typeof useQuery<typeof api.preferences.queries.listModelSettings>>;
  proStatus: ReturnType<typeof useQuery<typeof api.preferences.queries.getProStatus>>;
  accountCapabilities: ReturnType<typeof useQuery<typeof api.capabilities.queries.getAccountCapabilitiesPublic>>;
  personas: ReturnType<typeof useQuery<typeof api.personas.queries.list>>;
  favorites: ReturnType<typeof useQuery<typeof api.favorites.queries.listFavorites>>;
};

type ModelData = {
  modelSummaries: ReturnType<typeof useQuery<typeof api.models.sync.listModelSummaries>>;
};

type SkillsData = {
  skills: ReturnType<typeof useQuery<typeof api.skills.queries.listVisibleSkills>>;
};

type OpenRouterData = {
  hasApiKey: ReturnType<typeof useQuery<typeof api.scheduledJobs.queries.hasApiKey>>;
};

type ConnectionsData = {
  googleConnection: ReturnType<typeof useQuery<typeof api.oauth.google.getGoogleConnection>>;
  microsoftConnection: ReturnType<typeof useQuery<typeof api.oauth.microsoft.getMicrosoftConnection>>;
  notionConnection: ReturnType<typeof useQuery<typeof api.oauth.notion.getNotionConnection>>;
  slackConnection: ReturnType<typeof useQuery<typeof api.oauth.slack.getSlackConnection>>;
  appleCalendarConnection: ReturnType<typeof useQuery<typeof api.oauth.apple_calendar.getAppleCalendarConnection>>;
};

export type SharedDataContextValue = ShellData &
  Partial<ModelData> &
  Partial<SkillsData> &
  Partial<OpenRouterData> &
  Partial<ConnectionsData>;

export const SharedDataContext = createContext<SharedDataContextValue | null>(null);

function useSignedInSkip() {
  const { isSignedIn } = useAuth();
  const { isAuthenticated } = useConvexAuth();
  return isSignedIn && isAuthenticated ? {} : "skip";
}

export function useShellSubscriptions(): ShellData {
  const skip = useSignedInSkip();

  return {
    prefs: useQuery(api.preferences.queries.getPreferences, skip),
    modelSettings: useQuery(api.preferences.queries.listModelSettings, skip),
    proStatus: useQuery(api.preferences.queries.getProStatus, skip),
    accountCapabilities: useQuery(api.capabilities.queries.getAccountCapabilitiesPublic, skip),
    personas: useQuery(api.personas.queries.list, skip),
    favorites: useQuery(api.favorites.queries.listFavorites, skip),
  };
}

export function useSharedData(): SharedDataContextValue {
  const ctx = useContext(SharedDataContext);
  if (!ctx) {
    throw new Error("useSharedData must be used within a SharedDataProvider");
  }
  return ctx;
}

export function useModelSummaries() {
  const skip = useSignedInSkip();
  return useQuery(api.models.sync.listModelSummaries, skip);
}

export function useVisibleSkills() {
  const skip = useSignedInSkip();
  return useQuery(api.skills.queries.listVisibleSkills, skip);
}

export function useOpenRouterStatus() {
  const skip = useSignedInSkip();
  return useQuery(api.scheduledJobs.queries.hasApiKey, skip);
}

export function useConnectedAccounts() {
  const skip = useSignedInSkip();

  return {
    googleConnection: useQuery(api.oauth.google.getGoogleConnection, skip),
    microsoftConnection: useQuery(api.oauth.microsoft.getMicrosoftConnection, skip),
    notionConnection: useQuery(api.oauth.notion.getNotionConnection, skip),
    slackConnection: useQuery(api.oauth.slack.getSlackConnection, skip),
    appleCalendarConnection: useQuery(api.oauth.apple_calendar.getAppleCalendarConnection, skip),
    clozeConnection: useQuery(api.oauth.cloze.getClozeConnection, skip),
  };
}

// ── Credit balance (shared across Settings & Chat) ────────────────────────

export type BalanceTier = "green" | "amber" | "red" | "unknown";

export function balanceTierOf(balance: number | null): BalanceTier {
  if (balance === null) return "unknown";
  if (balance >= 5) return "green";
  if (balance >= 1) return "amber";
  return "red";
}

export function isLowBalance(balance: number | null): boolean {
  return balance !== null && balance < 0.25;
}

export function formatUsd(balance: number): string {
  return `$${balance.toFixed(2)}`;
}

/**
 * Shared credit balance hook. Returns the current balance (or null if not yet
 * fetched) and a refresh() function. Balance is fetched once when OpenRouter is
 * connected, and can be re-fetched on demand (e.g. after generation completes).
 */
export function useCreditBalance() {
  const hasApiKey = useOpenRouterStatus();
  const fetchCreditsAction = useAction(api.scheduledJobs.actions.fetchOpenRouterCredits);
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (hasApiKey !== true) return;
    setLoading(true);
    try {
      const result = await fetchCreditsAction({});
      setBalance(result.balance);
    } catch {
      // Fail silently — keep previous balance
    } finally {
      setLoading(false);
    }
  }, [hasApiKey, fetchCreditsAction]);

  // Auto-fetch on connect (hasApiKey becomes true)
  useEffect(() => {
    if (hasApiKey === true) {
      void (async () => {
        try {
          const result = await fetchCreditsAction({});
          setBalance(result.balance);
        } catch {
          // Fail silently
        }
      })();
    } else if (hasApiKey === false) {
      setBalance(null);
    }
  }, [hasApiKey, fetchCreditsAction]);

  return { balance, loading, refresh };
}
