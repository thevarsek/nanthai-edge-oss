import { useMemo } from "react";
import type { AdvisorComposerState } from "@/advisors/composerReducer";
import type { ChatAdvisorView } from "@/advisors/types";
import type { PersonaItem } from "@/components/chat/ChatParticipantPicker.helpers";
import type { ModelSummary } from "@/components/shared/ModelPickerHelpers";
import { modelHasTextOnlyOutput } from "@/components/shared/ModelPickerShared";
import type { Participant } from "@/hooks/useChat";

interface ProjectionArgs {
  state: AdvisorComposerState;
  persistedAdvisors: ChatAdvisorView[];
  participants: Participant[];
  personas: readonly PersonaItem[] | undefined;
  modelSummaries: readonly ModelSummary[] | undefined;
  defaultModelId: string | undefined;
}

/** Derives presentation and send-safe selections from hydrated Advisor state. */
export function useAdvisorComposerProjection({
  state,
  persistedAdvisors,
  participants,
  personas,
  modelSummaries,
  defaultModelId,
}: ProjectionArgs) {
  const serverPersistedPersonaIds = useMemo(
    () => new Set(persistedAdvisors.map((advisor) => String(advisor.personaId))),
    [persistedAdvisors],
  );
  const persistedPersonaIds = useMemo(() => new Set([
    ...serverPersistedPersonaIds,
    ...state.selections
      .filter((selection) => selection.keepAvailable)
      .map((selection) => String(selection.personaId)),
  ]), [serverPersistedPersonaIds, state.selections]);
  const participantPersonaIds = useMemo(
    () => new Set(participants.flatMap((participant) => (
      participant.personaId ? [String(participant.personaId)] : []
    ))),
    [participants],
  );
  const personaMap = useMemo(
    () => new Map((personas ?? []).map((persona) => [String(persona._id), persona])),
    [personas],
  );
  const modelMap = useMemo(
    () => new Map((modelSummaries ?? []).map((model) => [model.modelId, model])),
    [modelSummaries],
  );
  const unavailablePersonaIds = useMemo(() => new Set([
    ...persistedAdvisors
      .filter((advisor) => advisor.isAvailable === false)
      .map((advisor) => String(advisor.personaId)),
    ...(personas ?? []).flatMap((persona) => {
      const modelId = persona.modelId?.replace(/:online$/, "") || defaultModelId;
      if (!modelId || modelSummaries === undefined) return [];
      const model = modelMap.get(modelId);
      return !model || !modelHasTextOnlyOutput(model) ? [String(persona._id)] : [];
    }),
  ]), [defaultModelId, modelMap, modelSummaries, persistedAdvisors, personas]);
  const selectedPersonas = useMemo(
    () => state.selections.flatMap((selection) => {
      const persona = personaMap.get(String(selection.personaId));
      return persona ? [persona] : [];
    }),
    [personaMap, state.selections],
  );
  const eligibleState = useMemo(() => ({
    ...state,
    selections: state.selections.filter(
      (selection) => !unavailablePersonaIds.has(String(selection.personaId)),
    ),
  }), [state, unavailablePersonaIds]);
  const savableKeptSelections = useMemo(() => state.selections.filter((selection) => (
    selection.keepAvailable && (
      !unavailablePersonaIds.has(String(selection.personaId)) ||
      serverPersistedPersonaIds.has(String(selection.personaId))
    )
  )), [serverPersistedPersonaIds, state.selections, unavailablePersonaIds]);

  return {
    eligibleState,
    personaMap,
    participantPersonaIds,
    persistedPersonaIds,
    savableKeptSelections,
    selectedPersonas,
    unavailablePersonaIds,
  };
}
