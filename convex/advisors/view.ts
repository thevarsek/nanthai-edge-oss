import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { AdvisorBatchView, AdvisorRunView } from "./types";
import type { AdvisorPersonaUnavailableReason } from "./types";
import { resolveAdvisorModelAvailability } from "./eligibility";
import { resolveAdvisorModel } from "./shared";
import { projectedAdvisorFailure } from "../lib/openrouter_responses_error";

export type ChatAdvisorView = {
  _id: Id<"chatAdvisors">;
  personaId: Id<"personas">;
  instanceName: string;
  sortOrder: number;
  allowWebSearch: boolean;
  displayName: string;
  avatarEmoji?: string;
  avatarImageUrl?: string;
  avatarSFSymbol?: string;
  avatarColor?: string;
  isAvailable: boolean;
  unavailableReasonCode?: AdvisorPersonaUnavailableReason;
  createdAt: number;
  updatedAt: number;
};

export async function chatAdvisorView(
  ctx: QueryCtx | MutationCtx,
  assignment: Doc<"chatAdvisors">,
  options: {
    defaultModelId?: string;
    participantPersonaIds?: Set<string>;
  } = {},
): Promise<ChatAdvisorView | null> {
  const persona = await ctx.db.get(assignment.personaId);
  if (!persona || persona.userId !== assignment.userId) return null;
  const avatarImageUrl = persona.avatarImageStorageId
    ? await ctx.storage.getUrl(persona.avatarImageStorageId)
    : null;
  const participantConflict = options.participantPersonaIds?.has(String(persona._id)) === true;
  const model = resolveAdvisorModel(persona.modelId, options.defaultModelId);
  const modelAvailability = participantConflict
    ? { isAvailable: false, reasonCode: "participant_conflict" as const }
    : await resolveAdvisorModelAvailability(ctx, model.modelId);
  return {
    _id: assignment._id,
    personaId: assignment.personaId,
    instanceName: assignment.instanceName,
    sortOrder: assignment.sortOrder,
    allowWebSearch: assignment.allowWebSearch,
    displayName: persona.displayName,
    avatarEmoji: persona.avatarEmoji,
    avatarImageUrl: avatarImageUrl ?? undefined,
    avatarSFSymbol: persona.avatarSFSymbol,
    avatarColor: persona.avatarColor,
    isAvailable: modelAvailability.isAvailable,
    unavailableReasonCode: modelAvailability.reasonCode,
    createdAt: assignment.createdAt,
    updatedAt: assignment.updatedAt,
  };
}

export function advisorRunView(run: Doc<"advisorRuns">): AdvisorRunView {
  const snapshot = run.personaSnapshot;
  return {
    _id: run._id,
    personaId: run.personaId,
    personaSnapshot: {
      displayName: snapshot.displayName,
      avatarEmoji: snapshot.avatarEmoji,
      avatarImageUrl: snapshot.avatarImageUrl,
      avatarSFSymbol: snapshot.avatarSFSymbol,
      avatarColor: snapshot.avatarColor,
    },
    instanceName: run.instanceName,
    sortOrder: run.sortOrder,
    status: run.status,
    stage: run.stage,
    allowWebSearch: run.allowWebSearch,
    requestedModelId: run.requestedModelId,
    actualModelId: run.actualModelId,
    partialAdvice: run.partialAdvice,
    advice: run.advice,
    errorCode: run.errorCode,
    errorMessage: run.errorMessage === undefined
      ? undefined
      : projectedAdvisorFailure(run.errorMessage, run.errorCode),
    usage: run.usage,
    cost: run.cost,
    durationMs:
      run.startedAt != null && run.completedAt != null
        ? Math.max(0, run.completedAt - run.startedAt)
        : undefined,
    startedAt: run.startedAt,
    lastActivityAt: run.lastActivityAt,
    completedAt: run.completedAt,
  };
}

export function advisorBatchView(
  batch: Doc<"advisorBatches">,
  runs: Doc<"advisorRuns">[],
): AdvisorBatchView {
  return {
    _id: batch._id,
    chatId: batch.chatId,
    userMessageId: batch.userMessageId,
    assistantMessageIds: batch.assistantMessageIds,
    status: batch.status,
    brief: batch.brief,
    expectedRunCount: batch.expectedRunCount,
    completedRunCount: batch.completedRunCount,
    failedRunCount: batch.failedRunCount,
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
    runs: runs.map(advisorRunView),
  };
}
