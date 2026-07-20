import assert from "node:assert/strict";
import test from "node:test";

import { finalizeResearchPaperOutput } from "../search/research_output";
import {
  buildResearchTemporalContext,
  normalizeResearchQueryForTime,
} from "../search/research_temporal";
import {
  buildPaperGenerationSystemPrompt,
  buildResearchPlanningPrompt,
} from "../search/research_prompts";

test("latest AI news uses the actual research date and a deterministic 30-day window", () => {
  const temporal = buildResearchTemporalContext(
    "latest AI news",
    new Date("2026-07-20T00:39:00.000Z"),
  );

  assert.deepEqual(temporal, {
    referenceDate: "2026-07-20",
    recencySensitive: true,
    windowStart: "2026-06-21",
    windowEnd: "2026-07-20",
    searchAfterBoundary: "2026-06-20",
    windowEndExclusive: "2026-07-21",
    windowDays: 30,
  });
  assert.equal(
    normalizeResearchQueryForTime(
      "site:openai.com AI model release after:2025-02-01",
      temporal,
    ),
    "site:openai.com AI model release after:2026-06-20 before:2026-07-21 " +
      "Focus on sources published from 2026-06-21 through 2026-07-20.",
  );

  const prompt = buildResearchPlanningPrompt("latest AI news", 5, temporal);
  assert.match(prompt, /Research date: 2026-07-20 \(UTC\)/);
  assert.match(prompt, /2026-06-21 through 2026-07-20/);
  assert.match(prompt, /must not be presented as the latest developments/);
});

test("historical research queries are not rewritten as current research", () => {
  const temporal = buildResearchTemporalContext(
    "history of AI regulation in 2023",
    new Date("2026-07-20T00:39:00.000Z"),
  );
  assert.equal(temporal.recencySensitive, false);
  assert.equal(
    normalizeResearchQueryForTime("AI regulation 2023", temporal),
    "AI regulation 2023",
  );
});

test("research papers persist distinct inline links and receive a Sources appendix", () => {
  const paper = [
    "# Briefing",
    "A current release was documented by [OpenAI release notes](https://openai.com/news/release).",
    "The same [release](https://openai.com/news/release) was independently discussed by",
    "[Reuters](https://www.reuters.com/technology/example).",
  ].join("\n\n");
  const finalized = finalizeResearchPaperOutput(paper);

  assert.deepEqual(finalized.citations, [
    { title: "OpenAI release notes", url: "https://openai.com/news/release" },
    { title: "Reuters", url: "https://www.reuters.com/technology/example" },
  ]);
  assert.match(finalized.content, /## Sources/);
  assert.equal(
    finalized.content.match(/\[OpenAI release notes]\(https:\/\/openai\.com\/news\/release\)/g)?.length,
    2,
  );
  assert.match(
    buildPaperGenerationSystemPrompt("Synthesis", { temporal: buildResearchTemporalContext("latest news") }),
    /finish with a Sources section/,
  );
});

test("an existing References section is not duplicated", () => {
  const paper = "Claim [Source](https://example.com).\n\n## References\n\n- [Source](https://example.com)";
  const finalized = finalizeResearchPaperOutput(paper);
  assert.equal(finalized.content, paper);
  assert.equal(finalized.citations.length, 1);
});
