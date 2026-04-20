import assert from "node:assert/strict";
import test from "node:test";

import {
  buildNanthAIPrelude,
  buildSkillCatalogFromDocs,
  buildSkillCatalogFromResolved,
  formatAlwaysSkillInstructions,
  formatSkillCatalogXml,
  buildRuntimeGuard,
  NANTHAI_RUNTIME_GUARD_BASIC,
  SKILL_DISCOVERY_INSTRUCTION,
  SkillCatalogEntry,
} from "../skills/helpers";
import type { SkillResolutionResult } from "../skills/resolver";

// =============================================================================
// Helper to create mock skill documents (cast as any for Doc<"skills">)
// =============================================================================

let idCounter = 0;
function makeSkillDoc(overrides: Partial<Record<string, unknown>> = {}): any {
  idCounter += 1;
  return {
    _id: overrides._id ?? `skill_${idCounter}`,
    slug: overrides.slug ?? `test-skill-${idCounter}`,
    name: overrides.name ?? `Test Skill ${idCounter}`,
    summary: overrides.summary ?? `Summary for skill ${idCounter}`,
    runtimeMode: overrides.runtimeMode ?? "textOnly",
    requiredToolIds: overrides.requiredToolIds ?? [],
    requiredToolProfiles: overrides.requiredToolProfiles ?? [],
    requiredIntegrationIds: overrides.requiredIntegrationIds ?? [],
    requiredCapabilities: overrides.requiredCapabilities ?? [],
    visibility: overrides.visibility ?? "visible",
    status: overrides.status ?? "active",
    scope: overrides.scope ?? "system",
    ...overrides,
  };
}

// =============================================================================
// MARK: buildSkillCatalogFromDocs — basic behavior
// =============================================================================

test("buildSkillCatalogFromDocs: empty inputs return empty catalog", () => {
  const result = buildSkillCatalogFromDocs([], [], [], []);
  assert.deepEqual(result, []);
});

test("buildSkillCatalogFromDocs: includes system visible active skills", () => {
  const s1 = makeSkillDoc({ slug: "docx" });
  const result = buildSkillCatalogFromDocs([s1], [], [], []);
  assert.equal(result.length, 1);
  assert.equal(result[0].slug, "docx");
});

test("buildSkillCatalogFromDocs: includes persona discoverable skills", () => {
  const persona = makeSkillDoc({ slug: "custom-persona-skill", scope: "user" });
  const result = buildSkillCatalogFromDocs([], [persona], [], []);
  assert.equal(result.length, 1);
  assert.equal(result[0].slug, "custom-persona-skill");
});

test("buildSkillCatalogFromDocs: includes chat discoverable skills", () => {
  const chat = makeSkillDoc({ slug: "chat-skill" });
  const result = buildSkillCatalogFromDocs([], [], [chat], []);
  assert.equal(result.length, 1);
  assert.equal(result[0].slug, "chat-skill");
});

test("buildSkillCatalogFromDocs: deduplicates across all three sources", () => {
  const shared = makeSkillDoc({ _id: "shared_1", slug: "shared-skill" });
  const result = buildSkillCatalogFromDocs([shared], [shared], [shared], []);
  assert.equal(result.length, 1);
});

test("buildSkillCatalogFromDocs: disabled skills are excluded", () => {
  const s1 = makeSkillDoc({ _id: "disabled_1", slug: "good-skill" });
  const s2 = makeSkillDoc({ _id: "disabled_2", slug: "bad-skill" });
  const result = buildSkillCatalogFromDocs([s1, s2], [], [], ["disabled_2" as any]);
  assert.equal(result.length, 1);
  assert.equal(result[0].slug, "good-skill");
});

test("buildSkillCatalogFromDocs: hidden skills are excluded", () => {
  const visible = makeSkillDoc({ slug: "visible-skill", visibility: "visible" });
  const hidden = makeSkillDoc({ slug: "hidden-skill", visibility: "hidden" });
  const result = buildSkillCatalogFromDocs([visible, hidden], [], [], []);
  assert.equal(result.length, 1);
  assert.equal(result[0].slug, "visible-skill");
});

test("buildSkillCatalogFromDocs: archived skills are excluded", () => {
  const active = makeSkillDoc({ slug: "active-skill", status: "active" });
  const archived = makeSkillDoc({ slug: "archived-skill", status: "archived" });
  const result = buildSkillCatalogFromDocs([active, archived], [], [], []);
  assert.equal(result.length, 1);
  assert.equal(result[0].slug, "active-skill");
});

test("buildSkillCatalogFromDocs: ordering is system then persona then chat", () => {
  const system = makeSkillDoc({ slug: "system-skill" });
  const persona = makeSkillDoc({ slug: "persona-skill" });
  const chat = makeSkillDoc({ slug: "chat-skill" });
  const result = buildSkillCatalogFromDocs([system], [persona], [chat], []);
  assert.equal(result.length, 3);
  assert.equal(result[0].slug, "system-skill");
  assert.equal(result[1].slug, "persona-skill");
  assert.equal(result[2].slug, "chat-skill");
});

test("buildSkillCatalogFromDocs: disabled skill from persona source is excluded", () => {
  const personaSkill = makeSkillDoc({ _id: "ps_1", slug: "persona-bound" });
  const result = buildSkillCatalogFromDocs([], [personaSkill], [], ["ps_1" as any]);
  assert.equal(result.length, 0);
});

test("buildSkillCatalogFromDocs: catalog entries have correct shape", () => {
  const s1 = makeSkillDoc({
    slug: "docx",
    name: "DOCX",
    summary: "Word docs",
    runtimeMode: "toolAugmented",
    requiredToolIds: ["generate_docx"],
    requiredIntegrationIds: [],
  });
  const result = buildSkillCatalogFromDocs([s1], [], [], []);
  assert.equal(result.length, 1);
  const entry = result[0];
  assert.equal(entry.slug, "docx");
  assert.equal(entry.name, "DOCX");
  assert.equal(entry.summary, "Word docs");
  assert.equal(entry.runtimeMode, "toolAugmented");
  assert.deepEqual(entry.requiredToolIds, ["generate_docx"]);
  assert.deepEqual(entry.requiredToolProfiles, []);
  assert.deepEqual(entry.requiredIntegrationIds, []);
  assert.deepEqual(entry.requiredCapabilities, []);
});

test("buildSkillCatalogFromDocs: excludes skills whose profiles are unavailable", () => {
  const docsSkill = makeSkillDoc({
    slug: "docx",
    requiredToolProfiles: ["docs"],
  });
  const runtimeSkill = makeSkillDoc({
    slug: "code-workspace",
    requiredToolProfiles: ["workspace"],
    requiredCapabilities: ["mcpRuntime"],
  });

  const result = buildSkillCatalogFromDocs([docsSkill, runtimeSkill], [], [], [], {
    availableCapabilities: ["pro"],
    availableProfiles: ["docs"],
    availableIntegrationIds: [],
  });

  assert.deepEqual(result.map((entry) => entry.slug), ["docx"]);
});

test("buildSkillCatalogFromDocs: excludes integration-bound skills when no matching integration is active", () => {
  const googleSkill = makeSkillDoc({
    slug: "gmail",
    requiredToolProfiles: ["google"],
    requiredIntegrationIds: ["gmail"],
  });

  const result = buildSkillCatalogFromDocs([googleSkill], [], [], [], {
    availableCapabilities: ["pro"],
    availableProfiles: ["google"],
    availableIntegrationIds: [],
  });

  assert.equal(result.length, 0);
});

// =============================================================================
// MARK: formatSkillCatalogXml
// =============================================================================

test("formatSkillCatalogXml: empty array returns empty string", () => {
  assert.equal(formatSkillCatalogXml([]), "");
});

test("formatSkillCatalogXml: single text-only skill produces valid XML", () => {
  const entry: SkillCatalogEntry = {
    _id: "id1" as any,
    slug: "doc-coauthoring",
    name: "Doc Co-Authoring",
    summary: "Write docs together",
    runtimeMode: "textOnly",
    requiredToolIds: [],
    requiredToolProfiles: [],
    requiredIntegrationIds: [],
  };
  const xml = formatSkillCatalogXml([entry]);
  assert.ok(xml.startsWith("<available_skills>"));
  assert.ok(xml.endsWith("</available_skills>"));
  assert.ok(xml.includes("<name>doc-coauthoring</name>"));
  assert.ok(xml.includes("<description>Write docs together</description>"));
  // No requires_tools for text-only
  assert.ok(!xml.includes("<requires_tools>"));
  assert.ok(!xml.includes("<requires_integrations>"));
});

test("formatSkillCatalogXml: tool-augmented skill includes requires_tools", () => {
  const entry: SkillCatalogEntry = {
    _id: "id2" as any,
    slug: "docx",
    name: "DOCX",
    summary: "Create Word docs",
    runtimeMode: "toolAugmented",
    requiredToolIds: ["generate_docx", "read_docx"],
    requiredToolProfiles: ["docs"],
    requiredIntegrationIds: [],
  };
  const xml = formatSkillCatalogXml([entry]);
  assert.ok(xml.includes("<requires_tools>generate_docx, read_docx</requires_tools>"));
  assert.ok(xml.includes("<requires_profiles>docs</requires_profiles>"));
});

test("formatSkillCatalogXml: skill with integrations includes requires_integrations", () => {
  const entry: SkillCatalogEntry = {
    _id: "id3" as any,
    slug: "gmail-writer",
    name: "Gmail Writer",
    summary: "Compose emails",
    runtimeMode: "toolAugmented",
    requiredToolIds: ["gmail_send"],
    requiredToolProfiles: ["google"],
    requiredIntegrationIds: ["gmail"],
  };
  const xml = formatSkillCatalogXml([entry]);
  assert.ok(xml.includes("<requires_integrations>gmail</requires_integrations>"));
});

test("formatSkillCatalogXml: skill with capability requirements includes requires_capabilities", () => {
  const entry: SkillCatalogEntry = {
    _id: "id-cap" as any,
    slug: "runtime-analyst",
    name: "Runtime Analyst",
    summary: "Uses the chat workspace.",
    runtimeMode: "sandboxAugmented",
    requiredToolIds: ["workspace_exec"],
    requiredToolProfiles: ["workspace"],
    requiredIntegrationIds: [],
    requiredCapabilities: ["mcpRuntime"],
  };
  const xml = formatSkillCatalogXml([entry]);
  assert.ok(xml.includes("<requires_capabilities>mcpRuntime</requires_capabilities>"));
});

test("formatSkillCatalogXml: escapes XML special characters", () => {
  const entry: SkillCatalogEntry = {
    _id: "id4" as any,
    slug: "test-skill",
    name: "Test & Skill",
    summary: 'Handle <special> "chars" & \'quotes\'',
    runtimeMode: "textOnly",
    requiredToolIds: [],
    requiredToolProfiles: [],
    requiredIntegrationIds: [],
  };
  const xml = formatSkillCatalogXml([entry]);
  assert.ok(xml.includes("&amp;"));
  assert.ok(xml.includes("&lt;special&gt;"));
  assert.ok(xml.includes("&quot;chars&quot;"));
  assert.ok(xml.includes("&apos;quotes&apos;"));
  // Must NOT contain unescaped < or > in description
  assert.ok(!xml.includes("<special>"));
});

test("formatSkillCatalogXml: multiple skills produce multiple <skill> entries", () => {
  const entries: SkillCatalogEntry[] = [
    {
      _id: "id5" as any,
      slug: "skill-a",
      name: "Skill A",
      summary: "First skill",
      runtimeMode: "textOnly",
      requiredToolIds: [],
      requiredToolProfiles: [],
      requiredIntegrationIds: [],
    },
    {
      _id: "id6" as any,
      slug: "skill-b",
      name: "Skill B",
      summary: "Second skill",
      runtimeMode: "textOnly",
      requiredToolIds: [],
      requiredToolProfiles: [],
      requiredIntegrationIds: [],
    },
  ];
  const xml = formatSkillCatalogXml(entries);
  const skillCount = (xml.match(/<skill>/g) || []).length;
  assert.equal(skillCount, 2);
});

// =============================================================================
// MARK: Constants sanity checks
// =============================================================================

test("runtime guards are non-empty strings", () => {
  assert.ok(typeof NANTHAI_RUNTIME_GUARD_BASIC === "string");
  assert.ok(NANTHAI_RUNTIME_GUARD_BASIC.length > 50);
});

test("buildNanthAIPrelude: basic profile emphasises direct conversation and skills", () => {
  const prompt = buildNanthAIPrelude("mobileBasic");
  assert.ok(prompt.includes("Use direct conversation by default"));
  assert.ok(prompt.includes("load_skill"));
  assert.ok(!prompt.includes("coding, file-processing"));
});

test("buildRuntimeGuard returns the basic guard for mobileBasic profile", () => {
  assert.equal(buildRuntimeGuard("mobileBasic"), NANTHAI_RUNTIME_GUARD_BASIC);
});

test("basic runtime guard mentions key restrictions", () => {
  assert.ok(NANTHAI_RUNTIME_GUARD_BASIC.includes("shell"));
  assert.ok(NANTHAI_RUNTIME_GUARD_BASIC.includes("filesystem"));
  assert.ok(NANTHAI_RUNTIME_GUARD_BASIC.includes("Browser"));
  assert.ok(NANTHAI_RUNTIME_GUARD_BASIC.includes("MCP"));
});

test("SKILL_DISCOVERY_INSTRUCTION is a non-empty string mentioning load_skill", () => {
  assert.ok(typeof SKILL_DISCOVERY_INSTRUCTION === "string");
  assert.ok(SKILL_DISCOVERY_INSTRUCTION.length > 20);
  assert.ok(SKILL_DISCOVERY_INSTRUCTION.includes("load_skill"));
});

// =============================================================================
// MARK: buildSkillCatalogFromResolved — M30
// =============================================================================

function makeResolvedResult(overrides: Partial<SkillResolutionResult> = {}): SkillResolutionResult {
  return {
    alwaysSkills: [],
    availableSkills: [],
    neverSkillIds: new Set(),
    resolvedStates: new Map(),
    ...overrides,
  };
}

test("buildSkillCatalogFromResolved: empty resolved returns empty catalog and alwaysSkills", () => {
  const { catalog, alwaysSkills } = buildSkillCatalogFromResolved(makeResolvedResult());
  assert.equal(catalog.length, 0);
  assert.equal(alwaysSkills.length, 0);
});

test("buildSkillCatalogFromResolved: available skills become catalog entries", () => {
  const s1 = makeSkillDoc({ _id: "s1", slug: "data-viz" });
  const resolved = makeResolvedResult({ availableSkills: [s1] });
  const { catalog, alwaysSkills } = buildSkillCatalogFromResolved(resolved);
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].slug, "data-viz");
  assert.equal(alwaysSkills.length, 0);
});

test("buildSkillCatalogFromResolved: always skills are returned separately", () => {
  const s1 = makeSkillDoc({ _id: "s1", slug: "always-skill" });
  const resolved = makeResolvedResult({ alwaysSkills: [s1] });
  const { catalog, alwaysSkills } = buildSkillCatalogFromResolved(resolved);
  assert.equal(catalog.length, 0);
  assert.equal(alwaysSkills.length, 1);
  assert.equal(alwaysSkills[0].slug, "always-skill");
});

test("buildSkillCatalogFromResolved: filters available skills by profile", () => {
  const needsProfile = makeSkillDoc({ _id: "s1", requiredToolProfiles: ["docs"] });
  const noProfile = makeSkillDoc({ _id: "s2", requiredToolProfiles: [] });
  const resolved = makeResolvedResult({ availableSkills: [needsProfile, noProfile] });
  const { catalog } = buildSkillCatalogFromResolved(resolved, {
    availableProfiles: ["runtime"],
  });
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0]._id, "s2");
});

test("buildSkillCatalogFromResolved: filters always skills by integration", () => {
  const needsGmail = makeSkillDoc({ _id: "s1", requiredIntegrationIds: ["gmail"] });
  const resolved = makeResolvedResult({ alwaysSkills: [needsGmail] });
  const { alwaysSkills } = buildSkillCatalogFromResolved(resolved, {
    availableIntegrationIds: ["drive"],
  });
  assert.equal(alwaysSkills.length, 0);
});

test("buildSkillCatalogFromResolved: filters always skills by capability", () => {
  const needsCap = makeSkillDoc({ _id: "s1", requiredCapabilities: ["python_sandbox"] });
  const resolved = makeResolvedResult({ alwaysSkills: [needsCap] });
  const { alwaysSkills } = buildSkillCatalogFromResolved(resolved, {
    availableCapabilities: [],
  });
  assert.equal(alwaysSkills.length, 0);
});

// =============================================================================
// MARK: formatAlwaysSkillInstructions — M30
// =============================================================================

test("formatAlwaysSkillInstructions: empty array returns empty string", () => {
  assert.equal(formatAlwaysSkillInstructions([]), "");
});

test("formatAlwaysSkillInstructions: wraps instructions in XML tags", () => {
  const skill = makeSkillDoc({
    slug: "data-viz",
    instructionsRaw: "Use charts for data.",
    instructionsCompiled: "Use charts for data. (compiled)",
  });
  const result = formatAlwaysSkillInstructions([skill]);
  assert.ok(result.includes('<always_skill name="data-viz">'));
  assert.ok(result.includes("(compiled)"));
  assert.ok(result.includes("</always_skill>"));
});

test("formatAlwaysSkillInstructions: prefers compiled over raw", () => {
  const skill = makeSkillDoc({
    slug: "s1",
    instructionsRaw: "raw text",
    instructionsCompiled: "compiled text",
  });
  const result = formatAlwaysSkillInstructions([skill]);
  assert.ok(result.includes("compiled text"));
  assert.ok(!result.includes("raw text"));
});

test("formatAlwaysSkillInstructions: falls back to raw when compiled absent", () => {
  const skill = makeSkillDoc({
    slug: "s1",
    instructionsRaw: "raw only",
    instructionsCompiled: undefined,
  });
  const result = formatAlwaysSkillInstructions([skill]);
  assert.ok(result.includes("raw only"));
});

test("formatAlwaysSkillInstructions: multiple skills separated by double newline", () => {
  const s1 = makeSkillDoc({ slug: "a", instructionsRaw: "A" });
  const s2 = makeSkillDoc({ slug: "b", instructionsRaw: "B" });
  const result = formatAlwaysSkillInstructions([s1, s2]);
  assert.ok(result.includes("</always_skill>\n\n<always_skill"));
});
