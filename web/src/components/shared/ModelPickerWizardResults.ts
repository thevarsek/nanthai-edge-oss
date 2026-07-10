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
): boolean {
  const isZdrDisabled = zdrEnforced === true && !modelIsZdrEligible(model);
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
  limit = 3,
}: {
  models: ModelSummary[];
  task: WizardTask;
  priority: WizardPriority;
  zdrEnforced?: boolean;
  googleIntegrationsActive?: boolean;
  limit?: number;
}): ScoredWizardModel[] {
  const scored = models
    .map((model) => ({ ...model, score: wizardScore(model, task, priority) }))
    .filter((model) => model.score > 0)
    .sort((a, b) => b.score - a.score);
  const enabled = scored.filter((model) => !isWizardModelDisabled(model, zdrEnforced, googleIntegrationsActive));
  const blocked = scored.filter((model) => isWizardModelDisabled(model, zdrEnforced, googleIntegrationsActive));

  if (enabled.length === 0) {
    return blocked.slice(0, limit);
  }

  const selected = enabled.slice(0, limit);
  return selected.concat(blocked.slice(0, Math.max(0, limit - selected.length)));
}
