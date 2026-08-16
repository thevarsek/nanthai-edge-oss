import type { Id } from "../_generated/dataModel";
import type { OpenRouterMessage } from "../lib/openrouter";
import type { ContextAssemblyResult } from "./context_assembler";

export interface PreparedTurnCausality {
  exchangeId: Id<"collaborationExchanges">;
  decisionId: Id<"collaborationDecisions">;
  wave: number;
  frontierMessageIds: Id<"messages">[];
  replyToMessageIds: Id<"messages">[];
}

export interface PreparedParticipantTurn {
  providerMessages: OpenRouterMessage[];
  context: {
    assemblerVersion: string;
    policyVersion: string;
    artifactIds: Array<Id<"toolExecutionArtifacts">>;
    memoryIds: Array<Id<"toolMemories">>;
    omissionCounts: ContextAssemblyResult["exclusionSummary"];
    safety: ContextAssemblyResult["safety"];
    policyDecisions: string[];
  };
  causality?: PreparedTurnCausality;
}

const COLLABORATION_HANDOFF = `[NanthAI Collaboration handoff]
Continue from the latest committed messages above. Add only a materially new contribution that answers, corrects, unblocks, implements, or reviews what changed. Do not repeat or paraphrase advice already present. Stay focused on the work that requires your role and leave unrelated points to the other participants.`;

export function appendCollaborationHandoff(
  messages: OpenRouterMessage[],
  causality?: PreparedTurnCausality,
): OpenRouterMessage[] {
  if (!causality || causality.wave <= 1) return messages;
  return [
    ...messages,
    {
      role: "user",
      content: COLLABORATION_HANDOFF,
    },
  ];
}

export function prepareParticipantTurn(
  assembly: ContextAssemblyResult,
  causality?: PreparedTurnCausality,
): PreparedParticipantTurn {
  return {
    providerMessages: assembly.messages,
    context: {
      assemblerVersion: assembly.assemblerVersion,
      policyVersion: assembly.policyVersion,
      artifactIds: assembly.artifactRefs,
      memoryIds: assembly.memoryRefs,
      omissionCounts: assembly.exclusionSummary,
      safety: assembly.safety,
      policyDecisions: assembly.assemblyPlan.policyDecisions,
    },
    causality,
  };
}
