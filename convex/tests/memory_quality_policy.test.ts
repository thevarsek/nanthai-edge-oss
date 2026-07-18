import assert from "node:assert/strict";
import test from "node:test";

import {
  evidenceOverlaps,
  findUserEvidenceSpan,
  isLikelyNonAssertiveUserMessage,
  isOneOffTaskContent,
  normalizeMemoryScore,
  resolveAutomaticRetrievalMode,
  resolveImportRetrievalMode,
  shouldAdmitChatCandidate,
} from "../memory/quality_policy";

test("memory scores normalize 1-10 model output into the 0-1 contract", () => {
  assert.equal(normalizeMemoryScore(8, 0.5), 0.8);
  assert.equal(normalizeMemoryScore(0.82, 0.5), 0.82);
  assert.equal(normalizeMemoryScore(12, 0.5), 1);
  assert.equal(normalizeMemoryScore(-2, 0.5), 0);
  assert.equal(normalizeMemoryScore(undefined, 0.6), 0.6);
});

test("chat admission requires distinct user assertions and rejects assistant or question evidence", () => {
  const userMessage = "I prefer concise answers. I work in Edinburgh. Can you suggest a plan?";
  const preference = shouldAdmitChatCandidate({
    userMessage,
    evidenceQuote: "I prefer concise answers",
    evidenceKind: "explicitPreference",
    durability: "durable",
    acceptedEvidence: [],
  });
  assert.equal(preference.accepted, true);
  assert.ok(preference.span);

  const accepted = preference.span ? [preference.span] : [];
  const overlap = shouldAdmitChatCandidate({
    userMessage,
    evidenceQuote: "I prefer concise answers. I work in Edinburgh",
    evidenceKind: "explicitFact",
    durability: "durable",
    acceptedEvidence: accepted,
  });
  assert.equal(overlap.reason, "overlapping_user_evidence");

  const question = shouldAdmitChatCandidate({
    userMessage,
    evidenceQuote: "Can you suggest a plan",
    evidenceKind: "longTermGoal",
    durability: "durable",
    acceptedEvidence: [],
  });
  assert.equal(question.reason, "question_not_assertion");

  const assistantOnly = shouldAdmitChatCandidate({
    userMessage,
    evidenceQuote: "The best plan is weekly",
    evidenceKind: "explicitPreference",
    durability: "durable",
    acceptedEvidence: [],
  });
  assert.equal(assistantOnly.reason, "missing_user_evidence");
});

test("multilingual assertions are admitted while one-off output instructions are rejected", () => {
  const admitted = shouldAdmitChatCandidate({
    userMessage: "Sto costruendo NanthAI e voglio migliorare la retention.",
    evidenceQuote: "voglio migliorare la retention",
    evidenceKind: "longTermGoal",
    durability: "ongoing",
    acceptedEvidence: [],
  });
  assert.equal(admitted.accepted, true);

  const oneOff = shouldAdmitChatCandidate({
    userMessage: "Voglio una presentazione di 16 slide.",
    evidenceQuote: "Voglio una presentazione di 16 slide",
    evidenceKind: "taskInstruction",
    durability: "oneOff",
    acceptedEvidence: [],
  });
  assert.equal(oneOff.reason, "one_off_task");
  assert.equal(isOneOffTaskContent("User wants a 16-slide presentation."), true);
});

test("automatic retrieval modes reserve always-on for core identity and global style", () => {
  assert.equal(resolveAutomaticRetrievalMode({
    category: "identity",
    memoryType: "profile",
    durability: "durable",
    content: "User's preferred name is Dino.",
  }), "alwaysOn");
  assert.equal(resolveAutomaticRetrievalMode({
    category: "writingStyle",
    memoryType: "responsePreference",
    durability: "durable",
    content: "User prefers concise, direct answers.",
  }), "alwaysOn");
  assert.equal(resolveAutomaticRetrievalMode({
    category: "writingStyle",
    memoryType: "responsePreference",
    durability: "durable",
    content: "User prefers punchy LinkedIn posts.",
  }), "contextual");
  assert.equal(resolveAutomaticRetrievalMode({
    category: "preferences",
    memoryType: "responsePreference",
    durability: "durable",
    content: "Prefiero respuestas concisas en todas las conversaciones.",
  }), "alwaysOn");
  assert.equal(resolveAutomaticRetrievalMode({
    category: "preferences",
    memoryType: "responsePreference",
    durability: "durable",
    content: "Always use source footers in LinkedIn posts.",
  }), "contextual");
  assert.equal(resolveImportRetrievalMode("work", "User leads an AI team."), "contextual");
});

test("quality cleanup recognizes non-assertive questions and imperatives", () => {
  assert.equal(isLikelyNonAssertiveUserMessage("What's the best pricing model?"), true);
  assert.equal(isLikelyNonAssertiveUserMessage("Ok give me more!"), true);
  assert.equal(isLikelyNonAssertiveUserMessage("I prefer the first pricing model."), false);
  assert.equal(isLikelyNonAssertiveUserMessage("Mio figlio deve iniziare lo svezzamento."), false);
  assert.equal(isLikelyNonAssertiveUserMessage("Uso una friggitrice ad aria."), false);

  const span = findUserEvidenceSpan("I like tea and I like coffee.", "I like tea");
  assert.ok(span);
  assert.equal(evidenceOverlaps({ start: 2, end: 12 }, span ? [span] : []), true);
});
