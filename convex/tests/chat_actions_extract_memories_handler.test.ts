import assert from "node:assert/strict";
import test from "node:test";

import {
  detectMemoryExclusionRules,
  isDuplicateMemory,
  memoryLikelyUserFact,
  normalizeMemoryContent,
  parseMemoryExtractionPayload,
  shouldExcludeMemoryContent,
} from "../chat/actions_extract_memories_handler";

test("parseMemoryExtractionPayload handles fenced JSON and array fallback", () => {
  const fenced = "```json\n[{\"content\":\"User prefers tea\",\"category\":\"preference\"}]\n```";
  const parsedFenced = parseMemoryExtractionPayload(fenced);
  assert.equal(parsedFenced.length, 1);
  assert.equal(parsedFenced[0].content, "User prefers tea");

  const embedded = "Some text before [ {\"content\":\"User lives in Berlin\"} ] after";
  const parsedEmbedded = parseMemoryExtractionPayload(embedded);
  assert.equal(parsedEmbedded.length, 1);
  assert.equal(parsedEmbedded[0].content, "User lives in Berlin");

  const stringArray = "```json\n[\"User's name is Dino\", \"User is director of data and development\"]\n```";
  const parsedStringArray = parseMemoryExtractionPayload(stringArray);
  assert.equal(parsedStringArray.length, 2);
  assert.equal(parsedStringArray[0].content, "User's name is Dino");

  const wrapped = "{\"memories\":[{\"text\":\"User prefers concise updates\"}]}";
  const parsedWrapped = parseMemoryExtractionPayload(wrapped);
  assert.equal(parsedWrapped.length, 1);
  assert.equal(parsedWrapped[0].content, "User prefers concise updates");

  const typed = "{\"facts\":[{\"content\":\"El usuario prefiere respuestas breves\",\"memoryType\":\"responsePreference\",\"importanceScore\":0.92,\"confidenceScore\":0.87,\"expiresInDays\":30}]}";
  const parsedTyped = parseMemoryExtractionPayload(typed);
  assert.equal(parsedTyped.length, 1);
  assert.equal(parsedTyped[0].memoryType, "responsePreference");
  assert.equal(parsedTyped[0].importanceScore, 0.92);
  assert.equal(parsedTyped[0].confidenceScore, 0.87);
  assert.equal(parsedTyped[0].expiresInDays, 30);

  const typedStringScores = "{\"facts\":[{\"content\":\"L'utilisateur préfère les réponses courtes\",\"type\":\"responsePreference\",\"importance\":\"0.9\",\"confidence\":\"0.8\",\"ttlDays\":\"14\"}]}";
  const parsedTypedStringScores = parseMemoryExtractionPayload(typedStringScores);
  assert.equal(parsedTypedStringScores.length, 1);
  assert.equal(parsedTypedStringScores[0].importanceScore, 0.9);
  assert.equal(parsedTypedStringScores[0].confidenceScore, 0.8);
  assert.equal(parsedTypedStringScores[0].expiresInDays, 14);

  const structured = "{\"facts\":[{\"content\":\"User goes by Dino\",\"category\":\"identity\",\"retrievalMode\":\"alwaysOn\",\"tags\":[\"name\",\"bio\"]}]}";
  const parsedStructured = parseMemoryExtractionPayload(structured);
  assert.equal(parsedStructured.length, 1);
  assert.equal(parsedStructured[0].category, "identity");
  assert.equal(parsedStructured[0].retrievalMode, "alwaysOn");
  assert.deepEqual(parsedStructured[0].tags, ["name", "bio"]);
});

test("memoryLikelyUserFact applies user-focused heuristic", () => {
  assert.equal(
    memoryLikelyUserFact("User prefers concise answers for code review feedback."),
    true,
  );
  assert.equal(
    memoryLikelyUserFact("User is interested in trying Rust this week."),
    false,
  );
  assert.equal(
    memoryLikelyUserFact("User asked about Swift concurrency in this chat."),
    false,
  );
  assert.equal(
    memoryLikelyUserFact("User is exploring options today."),
    false,
  );
  assert.equal(
    memoryLikelyUserFact("El usuario prefiere respuestas breves y directas."),
    true,
  );
  assert.equal(
    memoryLikelyUserFact("L'utilisateur préfère les réponses structurées."),
    true,
  );
  assert.equal(
    memoryLikelyUserFact("Assistant should always ask follow-up questions."),
    false,
  );
  assert.equal(
    memoryLikelyUserFact("¿Cuál es la mejor base de datos?"),
    false,
  );
  assert.equal(
    memoryLikelyUserFact("ユーザーは簡潔な回答を好みます。"),
    true,
  );
  assert.equal(
    memoryLikelyUserFact("User is interested in hiking and has loved mountain trips for years."),
    true,
  );
  assert.equal(
    memoryLikelyUserFact("User is interested in trying one new framework this week."),
    false,
  );
});

test("isDuplicateMemory detects exact and high-overlap matches", () => {
  const existing = [
    { content: "The user enjoys hiking in the Alps during summer." },
  ];

  assert.equal(
    isDuplicateMemory("The user enjoys hiking in the Alps during summer.", existing),
    true,
  );

  assert.equal(
    isDuplicateMemory(
      "The user enjoys hiking in the Alps during summer.",
      existing,
    ),
    true,
  );

  assert.equal(
    isDuplicateMemory("The user collects vintage typewriters.", existing),
    false,
  );
});

test("normalizeMemoryContent normalizes punctuation and preserves language", () => {
  assert.equal(
    normalizeMemoryContent('  - "the user prefers direct answers"  '),
    "the user prefers direct answers.",
  );
  assert.equal(
    normalizeMemoryContent("El usuario prefiere respuestas directas"),
    "El usuario prefiere respuestas directas.",
  );
  assert.equal(
    normalizeMemoryContent("ユーザーは簡潔な回答を好みます"),
    "ユーザーは簡潔な回答を好みます.",
  );
  assert.equal(
    normalizeMemoryContent("User goes by Dino"),
    "User goes by Dino.",
  );
});

test("memory exclusion rules honor don't-save requests for phone/email", () => {
  const rules = detectMemoryExclusionRules(
    "Keep phone number out of memory and do not save my email.",
  );

  assert.equal(rules.excludePhone, true);
  assert.equal(rules.excludeEmail, true);

  assert.equal(
    shouldExcludeMemoryContent("User phone: +44 7401 181779.", rules),
    true,
  );
  assert.equal(
    shouldExcludeMemoryContent("User email: ferdinando@example.com.", rules),
    true,
  );
  assert.equal(
    shouldExcludeMemoryContent("User name is Dino.", rules),
    false,
  );

  const outOfMemoryRules = detectMemoryExclusionRules(
    "Leave my phone out of memory, please.",
  );
  assert.equal(outOfMemoryRules.excludePhone, true);
  assert.equal(outOfMemoryRules.excludeEmail, false);
});
