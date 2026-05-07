import assert from "node:assert/strict";
import test from "node:test";

import {
  validateSkillInstructions,
  validateToolIds,
  validateIntegrationIds,
  validateCapabilityIds,
  slugify,
} from "../skills/validators";

// =============================================================================
// MARK: validateSkillInstructions — banned pattern detection
// =============================================================================

test("validateSkillInstructions: clean instructions return compatible", () => {
  const result = validateSkillInstructions(
    "When the user asks you to write a report, follow these steps:\n" +
    "1. Ask clarifying questions about audience and purpose.\n" +
    "2. Draft an outline with section headings.\n" +
    "3. Fill in each section, iterating with the user.\n" +
    "4. Produce the final document using generate_docx."
  );
  assert.equal(result.isCompatible, true);
  assert.equal(result.findings.length, 0);
  assert.equal(result.unsupportedCapabilityCodes.length, 0);
  assert.equal(result.validationWarnings.length, 0);
});

// M27: USES_BASH, USES_FILESYSTEM, USES_RAW_FETCH, USES_BUNDLED_SCRIPTS, USES_GIT
// removed — just-bash workspace and data_python_sandbox handle these capabilities.

test("validateSkillInstructions: bash/shell references are no longer blocked", () => {
  const result = validateSkillInstructions(
    "Run this command in the terminal to set up the environment:\n" +
    "npm install express"
  );
  assert.equal(result.isCompatible, true);
  assert.equal(result.unsupportedCapabilityCodes.length, 0);
});

test("validateSkillInstructions: filesystem references are no longer blocked", () => {
  const result = validateSkillInstructions(
    "Read the file from local filesystem and parse its contents. Then process each line carefully."
  );
  assert.equal(result.isCompatible, true);
  assert.equal(result.unsupportedCapabilityCodes.length, 0);
});

test("validateSkillInstructions: fetch/axios references are no longer blocked", () => {
  const result = validateSkillInstructions(
    "Use the axios library to make API calls with proper retry logic and timeout configuration settings."
  );
  assert.equal(result.isCompatible, true);
  assert.equal(result.unsupportedCapabilityCodes.length, 0);
});

test("validateSkillInstructions: git references are no longer blocked", () => {
  const result = validateSkillInstructions(
    "Run git commit -m 'update docs' to save progress, then git push to share with the team members."
  );
  assert.equal(result.isCompatible, true);
  assert.equal(result.unsupportedCapabilityCodes.length, 0);
});

test("validateSkillInstructions: bundled script references are no longer blocked", () => {
  const result = validateSkillInstructions(
    "Execute the python validation script to check formatting before saving the compiled skill instructions."
  );
  assert.equal(result.isCompatible, true);
  assert.equal(result.unsupportedCapabilityCodes.length, 0);
});

test("validateSkillInstructions: detects USES_BROWSER", () => {
  const result = validateSkillInstructions(
    "Use playwright to open a browser tab and navigate to the target URL for screenshot capture testing."
  );
  assert.equal(result.isCompatible, false);
  assert.ok(result.unsupportedCapabilityCodes.includes("USES_BROWSER"));
});

test("validateSkillInstructions: detects screenshot keyword", () => {
  const result = validateSkillInstructions(
    "Take a screenshot of the current page state and analyze the visual layout for accessibility issues."
  );
  assert.equal(result.isCompatible, false);
  assert.ok(result.unsupportedCapabilityCodes.includes("USES_BROWSER"));
});

test("validateSkillInstructions: detects plural screenshot capture instructions", () => {
  const result = validateSkillInstructions(
    "Capture screenshots for each responsive breakpoint and compare the browser layout."
  );
  assert.equal(result.isCompatible, false);
  assert.ok(result.unsupportedCapabilityCodes.includes("USES_BROWSER"));
});

test("validateSkillInstructions: does not block screenshot as static content noun", () => {
  const result = validateSkillInstructions(
    "When building a presentation, treat an existing product screenshot as supplied source material and describe where it should appear."
  );
  assert.equal(result.isCompatible, true);
  assert.ok(!result.unsupportedCapabilityCodes.includes("USES_BROWSER"));
});

test("validateSkillInstructions: detects USES_MCP", () => {
  const result = validateSkillInstructions(
    "Start an MCP server to handle incoming tool requests from the client. Configure the model context protocol."
  );
  assert.equal(result.isCompatible, false);
  assert.ok(result.unsupportedCapabilityCodes.includes("USES_MCP"));
});

test("validateSkillInstructions: detects child_process", () => {
  const result = validateSkillInstructions(
    "Import child_process and spawn a new background worker for the long-running compilation task in parallel."
  );
  assert.equal(result.isCompatible, false);
  assert.ok(result.unsupportedCapabilityCodes.includes("USES_MCP"));
});

test("validateSkillInstructions: multiple violations from remaining banned patterns", () => {
  const result = validateSkillInstructions(
    "Use playwright to screenshot the result.\n" +
    "Then spawn a child_process for background work."
  );
  assert.equal(result.isCompatible, false);
  assert.ok(result.unsupportedCapabilityCodes.length >= 2);
  assert.ok(result.unsupportedCapabilityCodes.includes("USES_BROWSER"));
  assert.ok(result.unsupportedCapabilityCodes.includes("USES_MCP"));
});

// =============================================================================
// MARK: validateSkillInstructions — warnings
// =============================================================================

test("validateSkillInstructions: short instructions produce TOO_SHORT warning", () => {
  const result = validateSkillInstructions("Be helpful.");
  assert.equal(result.isCompatible, true, "short but compatible");
  assert.equal(result.validationWarnings.length, 1);
  assert.ok(result.validationWarnings[0].includes("very short"));
});

test("validateSkillInstructions: very long instructions produce VERY_LONG warning", () => {
  const longText = "Follow these guidelines carefully.\n".repeat(500);
  assert.ok(longText.length > 10_000);
  const result = validateSkillInstructions(longText);
  assert.equal(result.isCompatible, true, "long but compatible");
  assert.ok(result.validationWarnings.some((w) => w.includes("10,000 characters")));
});

test("validateSkillInstructions: warnings do not appear in unsupportedCapabilityCodes", () => {
  const result = validateSkillInstructions("Be helpful.");
  assert.equal(result.unsupportedCapabilityCodes.length, 0);
  assert.ok(result.findings.some((f) => f.severity === "warning"));
});

test("validateSkillInstructions: shell and filesystem patterns are now compatible (workspace tools)", () => {
  const result = validateSkillInstructions(
    "Run npm install and write the file to disk before continuing with the workflow.",
    {},
  );
  // USES_BASH and USES_FILESYSTEM were removed in M27 — workspace tools handle these natively
  assert.equal(result.isCompatible, true);
  assert.ok(!result.findings.some((f) => f.code === "USES_BASH"));
  assert.ok(!result.findings.some((f) => f.code === "USES_FILESYSTEM"));
});

test("validateSkillInstructions: MCP usage is still blocked regardless of options", () => {
  const result = validateSkillInstructions(
    "Start an MCP server and spawn a child_process to serve requests.",
    {},
  );
  assert.equal(result.isCompatible, false);
  assert.ok(result.unsupportedCapabilityCodes.includes("USES_MCP"));
});

// =============================================================================
// MARK: validateToolIds
// =============================================================================

test("validateToolIds: known tools return empty array", () => {
  assert.deepEqual(validateToolIds(["generate_docx", "read_docx", "edit_docx"]), []);
});

test("validateToolIds: unknown tools are returned", () => {
  assert.deepEqual(validateToolIds(["generate_docx", "fake_tool"]), ["fake_tool"]);
});

test("validateToolIds: all unknown", () => {
  assert.deepEqual(validateToolIds(["foo", "bar"]), ["foo", "bar"]);
});

test("validateToolIds: empty array returns empty", () => {
  assert.deepEqual(validateToolIds([]), []);
});

test("validateToolIds: skill tool IDs are known", () => {
  assert.deepEqual(
    validateToolIds(["load_skill", "list_skills", "create_skill", "update_skill", "delete_skill"]),
    [],
  );
});

test("validateToolIds: slack tool IDs are known", () => {
  assert.deepEqual(
    validateToolIds([
      "slack_search_messages",
      "slack_search_users",
      "slack_search_channels",
      "slack_send_message",
      "slack_read_channel",
      "slack_read_thread",
      "slack_create_canvas",
      "slack_update_canvas",
      "slack_read_canvas",
      "slack_read_user_profile",
    ]),
    [],
  );
});

test("validateToolIds: cloze tool IDs are known", () => {
  assert.deepEqual(
    validateToolIds([
      "cloze_person_find",
      "cloze_person_count",
      "cloze_person_add",
      "cloze_person_change",
      "cloze_project_find",
      "cloze_project_change",
      "cloze_add_note",
      "cloze_add_todo",
      "cloze_timeline",
      "cloze_save_draft",
      "cloze_about_me",
    ]),
    [],
  );
});

// =============================================================================
// MARK: validateIntegrationIds
// =============================================================================

test("validateIntegrationIds: known integrations return empty", () => {
  assert.deepEqual(validateIntegrationIds(["gmail", "drive", "notion"]), []);
});

test("validateIntegrationIds: unknown integrations are returned", () => {
  assert.deepEqual(validateIntegrationIds(["gmail", "slack"]), []);
  assert.deepEqual(validateIntegrationIds(["gmail", "unknown_provider"]), ["unknown_provider"]);
});

test("validateIntegrationIds: empty array returns empty", () => {
  assert.deepEqual(validateIntegrationIds([]), []);
});

// =============================================================================
// MARK: validateCapabilityIds
// =============================================================================

test("validateCapabilityIds: known capabilities return empty", () => {
  assert.deepEqual(validateCapabilityIds(["pro", "mcpRuntime"]), []);
});

test("validateCapabilityIds: unknown capabilities are returned", () => {
  assert.deepEqual(validateCapabilityIds(["adminRuntime"]), ["adminRuntime"]);
});

// =============================================================================
// MARK: slugify
// =============================================================================

test("slugify: lowercases and hyphenates", () => {
  assert.equal(slugify("Doc Co-Authoring"), "doc-co-authoring");
});

test("slugify: replaces spaces with hyphens", () => {
  assert.equal(slugify("Internal Comms"), "internal-comms");
});

test("slugify: removes special characters", () => {
  assert.equal(slugify("My Skill! (v2)"), "my-skill-v2");
});

test("slugify: trims leading and trailing hyphens", () => {
  assert.equal(slugify("  -Trimmed Skill-  "), "trimmed-skill");
});

test("slugify: collapses consecutive hyphens", () => {
  assert.equal(slugify("double--hyphen"), "double-hyphen");
});

test("slugify: handles empty string", () => {
  assert.equal(slugify(""), "");
});
