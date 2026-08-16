import assert from "node:assert/strict";
import test from "node:test";
import type { Id } from "../_generated/dataModel";
import type { ContextAssemblyResult } from "../chat/context_assembler";
import {
  appendCollaborationHandoff,
  prepareParticipantTurn,
} from "../chat/prepared_participant_turn";

function assembly(messages: ContextAssemblyResult["messages"]): ContextAssemblyResult {
  return {
    messages,
    policyVersion: "policy-v1",
    assemblerVersion: "assembler-v1",
    resolvedPolicy: {} as ContextAssemblyResult["resolvedPolicy"],
    artifactRefs: [],
    memoryRefs: [],
    rehydrationDirectives: [],
    exclusionSummary: {
      excludedByPolicy: 0,
      excludedByBudget: 0,
      excludedByVisibility: 0,
      excludedByOwnership: 0,
      excludedByPrivacy: 0,
      excludedByBranch: 0,
      lineageMessagesSkippedByCap: 0,
      excludedByFreshness: 0,
      excludedByContradiction: 0,
      excludedAsStale: 0,
      excludedAsSuperseded: 0,
    },
    safety: { ok: true, mismatchReasons: [] },
    assemblyPlan: {
      graphCandidateCount: 0,
      graphSelectedCount: 0,
      policyDecisions: [],
    },
    provenanceResolutions: [],
    timings: { graphQueryMs: 0, policyEvaluationMs: 0, serializationMs: 0 },
  };
}

function causality(wave: number) {
  return {
    exchangeId: "exchange" as Id<"collaborationExchanges">,
    decisionId: "decision" as Id<"collaborationDecisions">,
    wave,
    frontierMessageIds: ["frontier" as Id<"messages">],
    replyToMessageIds: ["frontier" as Id<"messages">],
  };
}

test("first Collaboration wave preserves the human-ended provider transcript", () => {
  const messages = [{ role: "user" as const, content: "Please review this." }];
  const prepared = prepareParticipantTurn(assembly(messages), causality(1));

  assert.deepEqual(prepared.providerMessages, messages);
});

test("later Collaboration waves append a bounded user-role handoff", () => {
  const prepared = prepareParticipantTurn(assembly([
    { role: "user", content: "Please review this." },
    { role: "assistant", content: "Initial review." },
  ]), causality(2));
  const messages = appendCollaborationHandoff(
    prepared.providerMessages,
    prepared.causality,
  );

  assert.equal(messages.at(-1)?.role, "user");
  assert.match(
    String(messages.at(-1)?.content),
    /materially new contribution/,
  );
  assert.match(
    String(messages.at(-1)?.content),
    /Do not repeat or paraphrase/,
  );
});
