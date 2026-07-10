import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { shouldRequireZdrForMemoryPrewarm } from "../chat/memory_prewarm_zdr";
import { isUserPro } from "../preferences/entitlements";
import type { IntegrationOverrideEntry } from "../skills/resolver";
import type {
  AdvisorEligibilityReason,
  AdvisorPersonaUnavailableReason,
} from "./types";
import { MAX_ADVISORS_PER_CHAT } from "./constants";

type EligibilityCtx = QueryCtx | MutationCtx;

export type AdvisorParticipantRef = {
  modelId: string;
  personaId?: Id<"personas"> | null;
};

export type AdvisorEligibility = {
  isAvailable: boolean;
  reasonCode?: AdvisorEligibilityReason;
  maxAdvisors: number;
  keptCount: number;
  remainingCapacity: number;
  conflictingPersonaIds?: string[];
};

export type AdvisorPersonaAvailability = {
  isAvailable: boolean;
  reasonCode?: AdvisorPersonaUnavailableReason;
};

export function advisorEligibilityMessage(reason: AdvisorEligibilityReason | undefined): string {
  const messages: Record<AdvisorEligibilityReason, string> = {
    not_pro: "Persona Advisors require NanthAI Pro.",
    zdr_enabled: "Advisors are unavailable while Zero Data Retention is enabled.",
    google_protected: "Advisors are unavailable for turns protected by Google data routing.",
    media_output_turn: "Advisors are available only for text-generation turns.",
    participant_conflict: "A Persona cannot be both a chat participant and a private Advisor on the same turn.",
    unsupported_turn: "Advisors are unavailable for this type of turn.",
    no_capacity: "Remove a kept Advisor before adding another.",
  };
  return reason ? messages[reason] : "Advisors are unavailable.";
}

export async function resolveAdvisorEligibility(
  ctx: EligibilityCtx,
  args: {
    userId: string;
    chat: Doc<"chats">;
    participants: AdvisorParticipantRef[];
    keptPersonaIds: Array<Id<"personas">>;
    selectedPersonaIds?: Array<Id<"personas">>;
    enabledIntegrations?: string[];
    turnIntegrationOverrides?: IntegrationOverrideEntry[];
  },
): Promise<AdvisorEligibility> {
  const keptCount = args.keptPersonaIds.length;
  const base = {
    maxAdvisors: MAX_ADVISORS_PER_CHAT,
    keptCount,
    remainingCapacity: Math.max(0, MAX_ADVISORS_PER_CHAT - keptCount),
  };
  if (!await isUserPro(ctx, args.userId)) {
    return { ...base, isAvailable: false, reasonCode: "not_pro" };
  }
  if (args.chat.source === "scheduled_job" || await hasActiveAutonomousSession(ctx, args.chat._id)) {
    return { ...base, isAvailable: false, reasonCode: "unsupported_turn" };
  }

  const preferences = await ctx.db
    .query("userPreferences")
    .withIndex("by_user", (query) => query.eq("userId", args.userId))
    .first();
  if (preferences?.zdrEnabled === true) {
    return { ...base, isAvailable: false, reasonCode: "zdr_enabled" };
  }
  if (await hasMediaOutputParticipant(ctx, args.participants)) {
    return { ...base, isAvailable: false, reasonCode: "media_output_turn" };
  }

  const participantPersonaIds = new Set(
    args.participants.flatMap((participant) => participant.personaId ? [String(participant.personaId)] : []),
  );
  const intendedAdvisorIds = [...args.keptPersonaIds, ...(args.selectedPersonaIds ?? [])];
  const conflictingPersonaIds = [...new Set(
    intendedAdvisorIds.map(String).filter((personaId) => participantPersonaIds.has(personaId)),
  )];
  const googleProtected = await shouldRequireZdrForMemoryPrewarm(ctx, {
    userId: args.userId,
    chat: args.chat,
    participants: args.participants,
    enabledIntegrations: args.enabledIntegrations,
    turnIntegrationOverrides: args.turnIntegrationOverrides,
  });
  if (googleProtected) {
    return { ...base, isAvailable: false, reasonCode: "google_protected" };
  }

  const selectedDistinct = new Set(args.selectedPersonaIds?.map(String) ?? []);
  const keptSet = new Set(args.keptPersonaIds.map(String));
  const newSelectionCount = [...selectedDistinct].filter((id) => !keptSet.has(id)).length;
  if (keptCount + newSelectionCount > MAX_ADVISORS_PER_CHAT) {
    return {
      ...base,
      isAvailable: false,
      reasonCode: "no_capacity",
      conflictingPersonaIds: conflictingPersonaIds.length > 0 ? conflictingPersonaIds : undefined,
    };
  }
  return {
    ...base,
    isAvailable: true,
    conflictingPersonaIds: conflictingPersonaIds.length > 0 ? conflictingPersonaIds : undefined,
  };
}

export async function isTextOutputModel(
  ctx: EligibilityCtx,
  modelId: string,
): Promise<boolean> {
  return (await resolveAdvisorModelAvailability(ctx, modelId)).isAvailable;
}

export async function resolveAdvisorModelAvailability(
  ctx: EligibilityCtx,
  modelId: string,
): Promise<AdvisorPersonaAvailability> {
  const model = await ctx.db
    .query("cachedModels")
    .withIndex("by_modelId", (query) => query.eq("modelId", modelId))
    .first();
  if (!model) return { isAvailable: false, reasonCode: "model_unavailable" };
  const modality = model.architecture?.modality;
  if (!modality) {
    const isText = model.supportsVideo !== true && model.imageCapabilities?.isAvailable !== true;
    return isText
      ? { isAvailable: true }
      : { isAvailable: false, reasonCode: "media_output_model" };
  }
  const output = modality.split("->")[1] ?? "text";
  const outputModalities = output.split("+");
  const isText = outputModalities.includes("text") &&
    !outputModalities.some((entry) => entry === "image" || entry === "video" || entry === "audio");
  return isText
    ? { isAvailable: true }
    : { isAvailable: false, reasonCode: "media_output_model" };
}

async function hasMediaOutputParticipant(
  ctx: EligibilityCtx,
  participants: AdvisorParticipantRef[],
): Promise<boolean> {
  const results = await Promise.all(
    participants.map((participant) => isTextOutputModel(ctx, participant.modelId)),
  );
  return results.some((isText) => !isText);
}

async function hasActiveAutonomousSession(
  ctx: EligibilityCtx,
  chatId: Id<"chats">,
): Promise<boolean> {
  const session = await ctx.db
    .query("autonomousSessions")
    .withIndex("by_chat", (query) => query.eq("chatId", chatId))
    .order("desc")
    .first();
  return session?.status === "running" || session?.status === "paused";
}
