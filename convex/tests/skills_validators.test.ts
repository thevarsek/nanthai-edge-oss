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

test("validateSkillInstructions: detects USES_BASH", () => {
  const result = validateSkillInstructions(
    "Run this command in the terminal to set up the environment:\n" +
    "npm install express"
  );
  assert.equal(result.isCompatible, false);
  assert.ok(result.unsupportedCapabilityCodes.includes("USES_BASH"));
});

test("validateSkillInstructions: detects shell commands in backticks", () => {
  const result = validateSkillInstructions(
    "Use `mkdir -p output` to create the directory, then proceed with the skill instructions that are quite long enough."
  );
  assert.equal(result.isCompatible, false);
  assert.ok(result.unsupportedCapabilityCodes.includes("USES_BASH"));
});

test("validateSkillInstructions: detects npx command", () => {
  const result = validateSkillInstructions(
    "First run npx create-react-app my-app to bootstrap the project structure for proper setup."
  );
  assert.equal(result.isCompatible, false);
  assert.ok(result.unsupportedCapabilityCodes.includes("USES_BASH"));
});

test("validateSkillInstructions: detects pip install", () => {
  const result = validateSkillInstructions(
    "Install dependencies first: pip install pandas numpy matplotlib for data analysis tasks."
  );
  assert.equal(result.isCompatible, false);
  assert.ok(result.unsupportedCapabilityCodes.includes("USES_BASH"));
});

test("validateSkillInstructions: detects USES_FILESYSTEM", () => {
  const result = validateSkillInstructions(
    "Read the file from local filesystem and parse its contents. Then process each line carefully."
  );
  assert.equal(result.isCompatible, false);
  assert.ok(result.unsupportedCapabilityCodes.includes("USES_FILESYSTEM"));
});

test("validateSkillInstructions: detects fs.readFile", () => {
  const result = validateSkillInstructions(
    "Use fs.readFileSync to load configuration from config.json before starting the generation pipeline."
  );
  assert.equal(result.isCompatible, false);
  assert.ok(result.unsupportedCapabilityCodes.includes("USES_FILESYSTEM"));
});

test("validateSkillInstructions: detects SKILL.md reference", () => {
  const result = validateSkillInstructions(
    "Load the instructions from SKILL.md in the skill directory, then follow them step by step carefully."
  );
  assert.equal(result.isCompatible, false);
  assert.ok(result.unsupportedCapabilityCodes.includes("USES_FILESYSTEM"));
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

test("validateSkillInstructions: detects USES_RAW_FETCH", () => {
  const result = validateSkillInstructions(
    "Call fetch('https://api.example.com/data') to retrieve the latest pricing information from the server."
  );
  assert.equal(result.isCompatible, false);
  assert.ok(result.unsupportedCapabilityCodes.includes("USES_RAW_FETCH"));
});

test("validateSkillInstructions: detects axios", () => {
  const result = validateSkillInstructions(
    "Use the axios library to make API calls with proper retry logic and timeout configuration settings."
  );
  assert.equal(result.isCompatible, false);
  assert.ok(result.unsupportedCapabilityCodes.includes("USES_RAW_FETCH"));
});

test("validateSkillInstructions: detects USES_BUNDLED_SCRIPTS", () => {
  const result = validateSkillInstructions(
    "Execute the python validation script to check formatting before saving the compiled skill instructions."
  );
  assert.equal(result.isCompatible, false);
  assert.ok(result.unsupportedCapabilityCodes.includes("USES_BUNDLED_SCRIPTS"));
});

test("validateSkillInstructions: detects USES_GIT", () => {
  const result = validateSkillInstructions(
    "Run git commit -m 'update docs' to save progress, then git push to share with the team members."
  );
  assert.equal(result.isCompatible, false);
  assert.ok(result.unsupportedCapabilityCodes.includes("USES_GIT"));
});

test("validateSkillInstructions: detects git clone", () => {
  const result = validateSkillInstructions(
    "First git clone the repository locally to get the latest source files before making any modifications."
  );
  assert.equal(result.isCompatible, false);
  assert.ok(result.unsupportedCapabilityCodes.includes("USES_GIT"));
});

test("validateSkillInstructions: multiple violations produce multiple findings", () => {
  const result = validateSkillInstructions(
    "Run this in the terminal: npm install express\n" +
    "Then use playwright to screenshot the result.\n" +
    "Also git push to deploy."
  );
  assert.equal(result.isCompatible, false);
  assert.ok(result.unsupportedCapabilityCodes.length >= 3);
  assert.ok(result.unsupportedCapabilityCodes.includes("USES_BASH"));
  assert.ok(result.unsupportedCapabilityCodes.includes("USES_BROWSER"));
  assert.ok(result.unsupportedCapabilityCodes.includes("USES_GIT"));
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

test("validateSkillInstructions: sandbox runtime downgrades shell and filesystem to warnings", () => {
  const result = validateSkillInstructions(
    "Run npm install and write the file to disk before continuing with the workflow.",
    { allowSandboxRuntime: true },
  );
  assert.equal(result.isCompatible, true);
  assert.ok(result.findings.some((f) => f.code === "USES_BASH" && f.severity === "warning"));
  assert.ok(result.findings.some((f) => f.code === "USES_FILESYSTEM" && f.severity === "warning"));
});

test("validateSkillInstructions: sandbox runtime still blocks MCP", () => {
  const result = validateSkillInstructions(
    "Start an MCP server and spawn a child_process to serve requests.",
    { allowSandboxRuntime: true },
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

// =============================================================================
// MARK: validateIntegrationIds
// =============================================================================

test("validateIntegrationIds: known integrations return empty", () => {
  assert.deepEqual(validateIntegrationIds(["gmail", "drive", "notion"]), []);
});

test("validateIntegrationIds: unknown integrations are returned", () => {
  assert.deepEqual(validateIntegrationIds(["gmail", "slack"]), ["slack"]);
});

test("validateIntegrationIds: empty array returns empty", () => {
  assert.deepEqual(validateIntegrationIds([]), []);
});

// =============================================================================
// MARK: validateCapabilityIds
// =============================================================================

test("validateCapabilityIds: known capabilities return empty", () => {
  assert.deepEqual(validateCapabilityIds(["pro", "sandboxRuntime"]), []);
});

test("validateCapabilityIds: unknown capabilities are returned", () => {
  assert.deepEqual(validateCapabilityIds(["sandboxRuntime", "adminRuntime"]), ["adminRuntime"]);
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
