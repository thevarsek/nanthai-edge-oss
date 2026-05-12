import assert from "node:assert/strict";
import test from "node:test";

import {
  inferProfilesFromToolIds,
  normalizeSkillMetadata,
  validateToolProfileIds,
} from "../skills/tool_profiles";

test("inferProfilesFromToolIds covers every product profile family in stable order", () => {
  assert.deepEqual(
    inferProfilesFromToolIds(
      [
        "generate_docx",
        "data_python_sandbox",
        "workspace_exec",
        "vm_exec",
        "spawn_subagents",
        "create_scheduled_job",
        "create_skill",
        "create_persona",
        "unknown_tool",
      ],
      [
        "gmail",
        "outlook",
        "notion",
        "apple_calendar",
        "cloze",
        "slack",
        "unknown_integration",
      ],
    ),
    [
      "docs",
      "analytics",
      "workspace",
      "persistentRuntime",
      "subagents",
      "google",
      "microsoft",
      "notion",
      "appleCalendar",
      "cloze",
      "slack",
      "scheduledJobs",
      "skillsManagement",
      "personas",
    ],
  );
});

test("normalizeSkillMetadata preserves explicit profiles, dedupes fields, and warns for profile-only loading", () => {
  const result = normalizeSkillMetadata({
    instructionsRaw:
      "Use generate_docx data_python_exec workspace_exec vm_exec spawn_subagents " +
      "create_scheduled_job create_skill gmail outlook notion apple_calendar cloze slack.",
    runtimeMode: "textOnly",
    requiredToolIds: ["unknown_tool", "unknown_tool"],
    requiredToolProfiles: ["docs", "analytics", "workspace", "persistentRuntime", "subagents"],
    requiredIntegrationIds: ["gmail", "gmail", "outlook", "notion", "apple_calendar", "cloze", "slack"],
    requiredCapabilities: ["pro", "pro", "runtime"],
  }, [
    { severity: "warning", code: "USES_FILESYSTEM", message: "mentions files" },
    { severity: "warning", code: "USES_BASH", message: "mentions shell" },
  ]);

  assert.equal(result.runtimeMode, "toolAugmented");
  assert.deepEqual(result.requiredToolIds, ["unknown_tool"]);
  assert.deepEqual(result.requiredIntegrationIds, [
    "apple_calendar",
    "cloze",
    "gmail",
    "notion",
    "outlook",
    "slack",
  ]);
  assert.deepEqual(result.requiredCapabilities, ["pro", "runtime"]);
  assert.deepEqual(result.requiredToolProfiles, [
    "docs",
    "analytics",
    "workspace",
    "persistentRuntime",
    "subagents",
    "google",
    "microsoft",
    "notion",
    "appleCalendar",
    "cloze",
    "slack",
    "scheduledJobs",
    "skillsManagement",
  ]);
  assert.ok(result.metadataWarnings.some((warning) => warning.includes("Documents profile")));
  assert.ok(result.metadataWarnings.some((warning) => warning.includes("Analytics profile")));
  assert.ok(result.metadataWarnings.some((warning) => warning.includes("Workspace profile")));
  assert.ok(result.metadataWarnings.some((warning) => warning.includes("Persistent runtime profile")));
  assert.ok(result.metadataWarnings.some((warning) => warning.includes("Subagents profile")));
  assert.ok(result.metadataWarnings.some((warning) => warning.includes("filesystem or shell")));
});

test("normalizeSkillMetadata prunes integration profiles inferred from instructions when integrations are disabled", () => {
  const result = normalizeSkillMetadata({
    instructionsRaw: "Reference gmail outlook notion apple_calendar cloze slack in examples only.",
    runtimeMode: "toolAugmented",
    requiredToolIds: [],
    requiredToolProfiles: [],
    requiredIntegrationIds: [],
    requiredCapabilities: [],
  });

  assert.deepEqual(result.requiredToolProfiles, []);
  assert.deepEqual(result.metadataWarnings, [
    "Apple Calendar profile was inferred from instructions but no Apple Calendar integrations are enabled — profile removed.",
    "Cloze profile was inferred from instructions but no Cloze integrations are enabled — profile removed.",
    "Google profile was inferred from instructions but no Google integrations are enabled — profile removed.",
    "Microsoft profile was inferred from instructions but no Microsoft integrations are enabled — profile removed.",
    "Notion profile was inferred from instructions but no Notion integrations are enabled — profile removed.",
    "Slack profile was inferred from instructions but no Slack integrations are enabled — profile removed.",
  ]);
});

test("validateToolProfileIds rejects every non-profile token while keeping recognized profile ids", () => {
  assert.deepEqual(
    validateToolProfileIds([
      "docs",
      "analytics",
      "workspace",
      "persistentRuntime",
      "subagents",
      "google",
      "microsoft",
      "notion",
      "appleCalendar",
      "cloze",
      "slack",
      "scheduledJobs",
      "skillsManagement",
      "personas",
      "",
      "calendar",
    ]),
    ["", "calendar"],
  );
});
