import {
  isProviderAllowedForGoogle,
  modelHasImageOutput,
  modelIsZdrEligible,
} from "@/components/shared/ModelPickerShared";
import { wizardScore, type WizardPriority, type WizardTask } from "@/components/shared/ModelPickerHelpers.utils";
import type { ModelSummary } from "@/components/shared/ModelPickerHelpers";

export type ScoredWizardModel = ModelSummary & { score: number };

export function isWizardModelDisabled(
  model: ModelSummary,
  zdrEnforced?: boolean,
  googleIntegrationsActive?: boolean,
  generationKind?: keyof NonNullable<ModelSummary["generationCapabilities"]>,
): boolean {
  const isZdrDisabled = zdrEnforced === true && (
    generationKind
      ? model.generationZdrCapabilities?.[generationKind] !== true
      : !modelIsZdrEligible(model)
  );
  const isGoogleBlocked = googleIntegrationsActive === true && (
    !model.hasZdrEndpoint ||
    modelHasImageOutput(model) ||
    !isProviderAllowedForGoogle(model.modelId, model.provider)
  );
  return isZdrDisabled || isGoogleBlocked;
}

export function selectWizardResults({
  models,
  task,
  priority,
  zdrEnforced,
  googleIntegrationsActive,
  generationKind,
  limit = 3,
}: {
  models: ModelSummary[];
  task: WizardTask;
  priority: WizardPriority;
  zdrEnforced?: boolean;
  googleIntegrationsActive?: boolean;
  generationKind?: keyof NonNullable<ModelSummary["generationCapabilities"]>;
  limit?: number;
}): ScoredWizardModel[] {
  const scored = models
    .map((model) => ({ ...model, score: wizardScore(model, task, priority) }))
    .filter((model) => model.score > 0)
    .sort((a, b) => b.score - a.score);
  const enabled = scored.filter((model) => !isWizardModelDisabled(model, zdrEnforced, googleIntegrationsActive, generationKind));
  const blocked = scored.filter((model) => isWizardModelDisabled(model, zdrEnforced, googleIntegrationsActive, generationKind));

  if (enabled.length === 0) {
    return blocked.slice(0, limit);
  }

  const selected = enabled.slice(0, limit);
  return selected.concat(blocked.slice(0, Math.max(0, limit - selected.length)));
}
