import assert from "node:assert/strict";
import test from "node:test";

import { saveGenerationContinuationArgs } from "../chat/mutations_args";
import type { GenerationContinuationGroupSnapshot } from "../chat/generation_continuation_shared";

/**
 * Regression guard for the drift between
 * `GenerationContinuationGroupSnapshot` (TS interface in
 * `convex/chat/generation_continuation_shared.ts`) and the `checkpoint.group`
 * object validator in `saveGenerationContinuationArgs`
 * (`convex/chat/mutations_args.ts`).
 *
 * Why this exists: on 2026-04-21 a Gmail Expert run hit
 * `ArgumentValidationError: Object contains extra field skillDefaults that is
 * not in the validator` because the interface had gained 5 optional fields
 * (`chatSkillOverrides`, `chatIntegrationOverrides`, `personaSkillOverrides`,
 * `skillDefaults`, `integrationDefaults`) in commits 9f7eeba4 + bcb6888e but
 * the validator was not updated.
 *
 * This test extracts the declared validator field set at runtime and asserts
 * it is a superset of a fully-populated snapshot fixture. If someone adds a
 * field to `GenerationContinuationGroupSnapshot` without updating the
 * validator, TypeScript will flag the fixture (missing property) and — if
 * they silence that — the runtime assertion below will flag it. Either path
 * catches the drift before it hits a real user checkpoint save.
 */

// Convex validators expose their shape under a `fields` property at the
// top level of an object validator. We reach into it via `as any` because
// that internal type is not part of the public convex/values surface.
function objectValidatorFieldNames(objectValidator: unknown): string[] {
  const fields = (objectValidator as any)?.fields;
  if (!fields || typeof fields !== "object") {
    throw new Error("Expected an object validator with a `fields` map");
  }
  return Object.keys(fields);
}

test("saveGenerationContinuationArgs.checkpoint.group validator covers every GenerationContinuationGroupSnapshot field", () => {
  // Construct a fully-populated snapshot. If someone adds a field to the
  // TS interface, this literal stops compiling until the field is added
  // here too — which forces them to then add it to the validator (below).
  const snapshot: Required<GenerationContinuationGroupSnapshot> = {
    assistantMessageIds: [],
    generationJobIds: [],
    userMessageId: "msg_1" as any,
    userId: "user_1",
    expandMultiModelGroups: false,
    webSearchEnabled: false,
    effectiveIntegrations: [],
    directToolNames: [],
    isPro: false,
    allowSubagents: false,
    searchSessionId: "search_1" as any,
    subagentBatchId: "batch_1" as any,
    drivePickerBatchId: "drive_picker_batch_1" as any,
    chatSkillOverrides: [],
    chatIntegrationOverrides: [],
    personaSkillOverrides: [],
    skillDefaults: [],
    integrationDefaults: [],
  };

  const checkpointValidator = (saveGenerationContinuationArgs.checkpoint as any);
  const groupValidator = checkpointValidator?.fields?.group;
  assert.ok(groupValidator, "checkpoint.group validator must exist");

  const validatorFields = new Set(objectValidatorFieldNames(groupValidator));
  const snapshotFields = Object.keys(snapshot);

  const missing = snapshotFields.filter((field) => !validatorFields.has(field));
  assert.deepEqual(
    missing,
    [],
    `checkpoint.group validator is missing fields present on GenerationContinuationGroupSnapshot: ${missing.join(", ")}. ` +
    `Add them to saveGenerationContinuationArgs.checkpoint.group in convex/chat/mutations_args.ts.`,
  );
});
