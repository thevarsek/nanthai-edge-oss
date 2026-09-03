import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { failClosedProviderActionOptions } from
  "../execution/workflow_retry_policy";

test("ambiguous provider actions fail closed instead of replaying", () => {
  assert.deepEqual(failClosedProviderActionOptions, { retry: false });
});

test("provider-backed Workflow steps use the fail-closed policy", () => {
  const sources = [
    readFileSync("convex/autonomous/session_workflow.ts", "utf8"),
    readFileSync("convex/chat/audio_workflow.ts", "utf8"),
    readFileSync("convex/presentations/presentation_workflow.ts", "utf8"),
    readFileSync("convex/search/research_workflow.ts", "utf8"),
    readFileSync("convex/search/research_regeneration_workflow.ts", "utf8"),
  ].join("\n");
  for (const action of [
    "generateAudioForMessage",
    "runAutonomousTurn",
    "finishAutonomousCycle",
    "runPresentationPlanStepRef",
    "runPlanningAction",
    "runAnalysisAction",
    "runSynthesisAction",
    "runPaperArchitectureAction",
  ]) {
    assert.match(
      sources,
      new RegExp(`${action}[\\s\\S]{0,500}failClosedProviderActionOptions`),
      `${action} must not be automatically replayed`,
    );
  }
});
