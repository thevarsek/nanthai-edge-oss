import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeSkillMetadata,
  validateToolProfileIds,
} from "../skills/tool_profiles";

test("validateToolProfileIds: known profiles are accepted", () => {
  assert.deepEqual(validateToolProfileIds(["docs", "analytics", "workspace", "persistentRuntime", "subagents"]), []);
});

test("validateToolProfileIds: unknown profiles are returned", () => {
  assert.deepEqual(validateToolProfileIds(["docs", "mystery"]), ["mystery"]);
});

test("normalizeSkillMetadata: plain text skill yields no heavy profiles", () => {
  const result = normalizeSkillMetadata({
    instructionsRaw: "Write concise summaries for the user.",
    runtimeMode: "textOnly",
    requiredToolIds: [],
    requiredToolProfiles: [],
    requiredIntegrationIds: [],
    requiredCapabilities: [],
  });

  assert.equal(result.runtimeMode, "textOnly");
  assert.deepEqual(result.requiredToolProfiles, []);
  assert.deepEqual(result.requiredCapabilities, []);
});

test("normalizeSkillMetadata: doc tool IDs infer docs profile", () => {
  const result = normalizeSkillMetadata({
    instructionsRaw: "Use generate_docx for final output.",
    runtimeMode: "toolAugmented",
    requiredToolIds: ["generate_docx"],
    requiredToolProfiles: [],
    requiredIntegrationIds: [],
    requiredCapabilities: [],
  });

  assert.deepEqual(result.requiredToolProfiles, ["docs"]);
});

test("normalizeSkillMetadata: sandboxAugmented with no tools infers workspace profile, no required capabilities", () => {
  const result = normalizeSkillMetadata({
    instructionsRaw: "Work in the chat workspace.",
    runtimeMode: "sandboxAugmented",
    requiredToolIds: [],
    requiredToolProfiles: [],
    requiredIntegrationIds: [],
    requiredCapabilities: [],
  });

  assert.deepEqual(result.requiredToolProfiles, ["workspace"]);
  assert.deepEqual(result.requiredCapabilities, []);
});

test("normalizeSkillMetadata: analytics tools infer analytics profile, no required capabilities", () => {
  const result = normalizeSkillMetadata({
    instructionsRaw: "Use data_python_exec for charts.",
    runtimeMode: "toolAugmented",
    requiredToolIds: ["data_python_exec"],
    requiredToolProfiles: [],
    requiredIntegrationIds: [],
    requiredCapabilities: [],
  });

  assert.equal(result.runtimeMode, "toolAugmented");
  assert.deepEqual(result.requiredToolProfiles, ["analytics"]);
  assert.deepEqual(result.requiredCapabilities, []);
});

test("normalizeSkillMetadata: google integration infers google profile", () => {
  const result = normalizeSkillMetadata({
    instructionsRaw: "Use gmail to send replies.",
    runtimeMode: "toolAugmented",
    requiredToolIds: [],
    requiredToolProfiles: [],
    requiredIntegrationIds: ["gmail"],
    requiredCapabilities: [],
  });

  assert.deepEqual(result.requiredToolProfiles, ["google"]);
});

test("normalizeSkillMetadata: subagent tool infers subagents profile", () => {
  const result = normalizeSkillMetadata({
    instructionsRaw: "Use spawn_subagents only for independent workstreams.",
    runtimeMode: "toolAugmented",
    requiredToolIds: ["spawn_subagents"],
    requiredToolProfiles: [],
    requiredIntegrationIds: [],
    requiredCapabilities: [],
  });

  assert.equal(result.runtimeMode, "toolAugmented");
  assert.deepEqual(result.requiredToolProfiles, ["subagents"]);
});

test("normalizeSkillMetadata: persistent runtime tool IDs infer persistentRuntime profile", () => {
  const result = normalizeSkillMetadata({
    instructionsRaw: "Use read_pdf and generate_pdf for PDF workflows.",
    runtimeMode: "toolAugmented",
    requiredToolIds: ["read_pdf"],
    requiredToolProfiles: [],
    requiredIntegrationIds: [],
    requiredCapabilities: [],
  });

  assert.equal(result.runtimeMode, "toolAugmented");
  assert.deepEqual(result.requiredToolProfiles, ["persistentRuntime"]);
});
