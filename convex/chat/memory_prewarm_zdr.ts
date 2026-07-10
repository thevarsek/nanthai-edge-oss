import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { hasGoogleIntegrations } from "../models/google_data_providers";
import { deriveGoogleCapabilityFlags } from "../oauth/google_capabilities";
import {
  resolveEffectiveIntegrations,
  type IntegrationOverrideEntry,
} from "../skills/resolver";
import type { SendParticipantConfig } from "./mutation_send_helpers";

const GOOGLE_ZDR_OAUTH_PROVIDERS = [
  "google",
  "gmail_manual",
] as const;

type ZdrResolutionCtx = MutationCtx | QueryCtx;

function explicitTurnIntegrationOverrides(
  enabledIntegrations: string[] | undefined,
  turnIntegrationOverrides: IntegrationOverrideEntry[] | undefined,
): IntegrationOverrideEntry[] | undefined {
  return turnIntegrationOverrides
    ?? enabledIntegrations?.map((integrationId) => ({
      integrationId,
      enabled: true,
    }));
}

async function loadUserIntegrationDefaults(
  ctx: ZdrResolutionCtx,
  userId: string,
): Promise<IntegrationOverrideEntry[] | undefined> {
  const prefs = await ctx.db
    .query("userPreferences")
    .withIndex("by_user", (query) => query.eq("userId", userId))
    .first();

  return prefs?.integrationDefaults;
}

async function loadConnectedIntegrationIds(
  ctx: ZdrResolutionCtx,
  userId: string,
): Promise<string[]> {
  const connectionEntries = await Promise.all(
    GOOGLE_ZDR_OAUTH_PROVIDERS.map(async (provider) => ({
      provider,
      connection: await ctx.db
        .query("oauthConnections")
        .withIndex("by_user_provider", (query) =>
          query.eq("userId", userId).eq("provider", provider),
        )
        .first(),
    })),
  );

  const connectedIntegrationIds: string[] = [];
  for (const { provider, connection } of connectionEntries) {
    if (!connection || connection.status !== "active") continue;

    switch (provider) {
      case "google": {
        const flags = deriveGoogleCapabilityFlags(connection.scopes);
        if (flags.hasDrive) connectedIntegrationIds.push("drive");
        if (flags.hasCalendar) connectedIntegrationIds.push("calendar");
        break;
      }
      case "gmail_manual":
        connectedIntegrationIds.push("gmail");
        break;
    }
  }

  return connectedIntegrationIds;
}

async function loadPersonaIntegrationOverrides(
  ctx: ZdrResolutionCtx,
  userId: string,
  personaId: Id<"personas">,
): Promise<IntegrationOverrideEntry[] | undefined> {
  try {
    const persona = await ctx.db.get(personaId);
    if (persona && persona.userId === userId) {
      return persona.integrationOverrides;
    }
  } catch {
    // Historical retry contracts may contain string-shaped persona IDs.
  }

  const personas = await ctx.db
    .query("personas")
    .withIndex("by_user", (query) => query.eq("userId", userId))
    .collect();
  const matched = personas.find((persona) => String(persona._id) === String(personaId));
  return matched?.integrationOverrides;
}

export async function shouldRequireZdrForMemoryPrewarm(
  ctx: ZdrResolutionCtx,
  args: {
    userId: string;
    chat: Pick<Doc<"chats">, "integrationOverrides">;
    participants: SendParticipantConfig[];
    enabledIntegrations?: string[];
    turnIntegrationOverrides?: IntegrationOverrideEntry[];
  },
): Promise<boolean> {
  if (args.participants.length === 0) {
    return false;
  }

  const [
    settingsDefaults,
    connectedIntegrationIds,
  ] = await Promise.all([
    loadUserIntegrationDefaults(ctx, args.userId),
    loadConnectedIntegrationIds(ctx, args.userId),
  ]);
  const turnOverrides = explicitTurnIntegrationOverrides(
    args.enabledIntegrations,
    args.turnIntegrationOverrides,
  );

  const personaIds = [...new Set(
    args.participants
      .map((participant) => participant.personaId)
      .filter((personaId): personaId is Id<"personas"> => personaId != null),
  )];
  const personaOverrideEntries = await Promise.all(
    personaIds.map(async (personaId) => [
      String(personaId),
      await loadPersonaIntegrationOverrides(ctx, args.userId, personaId),
    ] as const),
  );
  const personaOverridesById = new Map(personaOverrideEntries);

  for (const participant of args.participants) {
    const personaOverrides = participant.personaId
      ? personaOverridesById.get(String(participant.personaId))
      : undefined;
    const resolved = resolveEffectiveIntegrations({
      settingsDefaults,
      personaOverrides,
      chatOverrides: args.chat.integrationOverrides,
      turnOverrides,
      connectedIntegrationIds,
    });

    if (hasGoogleIntegrations(resolved.effectiveIntegrations)) {
      return true;
    }
  }

  return false;
}
