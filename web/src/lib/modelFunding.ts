export interface FundingGuidance { code?: string | null; freeModelId?: string | null; actions?: string[] | null }

/** Select the first cloud participant needing guidance, preserving all selections. */
export function selectedFundingGuidance(
  participants: { modelId: string; personaId?: string | null }[],
  models: { modelId: string; fundingGuidance?: FundingGuidance | null }[] | undefined,
  personas: { _id: string; runtimePlacement?: string | null }[] | undefined,
): FundingGuidance | undefined {
  for (const participant of participants) {
    if (participant.personaId && personas?.find(p => p._id === participant.personaId)?.runtimePlacement === "local") continue;
    const guidance = models?.find(model => model.modelId === participant.modelId)?.fundingGuidance;
    if (guidance) return guidance;
  }
}
