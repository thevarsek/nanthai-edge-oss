import type { OpenRouterMessage } from "../lib/openrouter";
import { compareAssemblyToLegacy } from "./context_assembler";

export interface AssemblyJudgementScenario {
  name: string;
  legacyMessages: OpenRouterMessage[];
  assembledMessages: OpenRouterMessage[];
  expectedUnresolvedToolCallIds?: string[];
  expectedPrivacyTermsAbsent?: string[];
  expectedTokenDeltaDirection?: "lower" | "neutral_or_lower" | "higher_allowed";
}

export interface AssemblyJudgement {
  name: string;
  passed: boolean;
  rationale: string;
  legacyEstimatedTokens: number;
  assembledEstimatedTokens: number;
}

function serialized(messages: OpenRouterMessage[]): string {
  return JSON.stringify(messages).toLowerCase();
}

export function judgeAssemblyScenario(
  scenario: AssemblyJudgementScenario,
): AssemblyJudgement {
  const comparison = compareAssemblyToLegacy(scenario);
  const assembled = serialized(scenario.assembledMessages);
  const failures: string[] = [];
  for (const callId of scenario.expectedUnresolvedToolCallIds ?? []) {
    if (!assembled.includes(callId.toLowerCase())) {
      failures.push(`missing unresolved tool call ${callId}`);
    }
  }
  for (const term of scenario.expectedPrivacyTermsAbsent ?? []) {
    if (assembled.includes(term.toLowerCase())) {
      failures.push(`privacy term leaked: ${term}`);
    }
  }
  if (
    scenario.expectedTokenDeltaDirection === "lower" &&
    comparison.assembledEstimatedTokens >= comparison.legacyEstimatedTokens
  ) {
    failures.push("assembled context did not reduce estimated prompt tokens");
  }
  if (
    scenario.expectedTokenDeltaDirection === "neutral_or_lower" &&
    comparison.assembledEstimatedTokens > comparison.legacyEstimatedTokens
  ) {
    failures.push("assembled context grew when it should have been neutral or lower");
  }
  return {
    name: scenario.name,
    passed: failures.length === 0,
    rationale: failures.length === 0
      ? "assembled context preserved required recovery/privacy constraints"
      : failures.join("; "),
    legacyEstimatedTokens: comparison.legacyEstimatedTokens,
    assembledEstimatedTokens: comparison.assembledEstimatedTokens,
  };
}
