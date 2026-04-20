import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveEffectiveSkills,
  resolveEffectiveIntegrations,
  systemDefaultSkillState,
  SkillOverrideEntry,
  IntegrationOverrideEntry,
  SkillResolutionInput,
  IntegrationResolutionInput,
} from "../skills/resolver";

// =============================================================================
// Helpers
// =============================================================================

let idCounter = 0;
function makeSkillDoc(overrides: Partial<Record<string, unknown>> = {}): any {
  idCounter += 1;
  const id = overrides._id ?? `skill_${idCounter}`;
  return {
    _id: id,
    slug: overrides.slug ?? `skill-${idCounter}`,
    name: overrides.name ?? `Skill ${idCounter}`,
    summary: overrides.summary ?? `Summary ${idCounter}`,
    runtimeMode: overrides.runtimeMode ?? "textOnly",
    requiredToolIds: overrides.requiredToolIds ?? [],
    requiredToolProfiles: overrides.requiredToolProfiles ?? [],
    requiredIntegrationIds: overrides.requiredIntegrationIds ?? [],
    requiredCapabilities: overrides.requiredCapabilities ?? [],
    visibility: overrides.visibility ?? "visible",
    status: overrides.status ?? "active",
    scope: overrides.scope ?? "system",
    origin: overrides.origin ?? "nanthaiBuiltin",
    ...overrides,
  };
}

function override(skillId: string, state: "always" | "available" | "never"): SkillOverrideEntry {
  return { skillId: skillId as any, state };
}

function intOverride(integrationId: string, enabled: boolean): IntegrationOverrideEntry {
  return { integrationId, enabled };
}

// =============================================================================
// MARK: systemDefaultSkillState
// =============================================================================

test("systemDefaultSkillState: system + visible + active → available", () => {
  const skill = makeSkillDoc({ scope: "system", visibility: "visible", status: "active" });
  assert.equal(systemDefaultSkillState(skill), "available");
});

test("systemDefaultSkillState: user-authored → available", () => {
  const skill = makeSkillDoc({ scope: "user", visibility: "visible", status: "active" });
  assert.equal(systemDefaultSkillState(skill), "available");
});

test("systemDefaultSkillState: integration_managed → available", () => {
  const skill = makeSkillDoc({ visibility: "integration_managed", scope: "system" });
  assert.equal(systemDefaultSkillState(skill), "available");
});

test("systemDefaultSkillState: hidden → never", () => {
  const skill = makeSkillDoc({ visibility: "hidden", scope: "system" });
  assert.equal(systemDefaultSkillState(skill), "never");
});

test("systemDefaultSkillState: archived → never", () => {
  const skill = makeSkillDoc({ scope: "system", visibility: "visible", status: "archived" });
  assert.equal(systemDefaultSkillState(skill), "never");
});

// =============================================================================
// MARK: resolveEffectiveSkills — settings-only resolution
// =============================================================================

test("skills: no overrides, system skill → available by default", () => {
  const s = makeSkillDoc({ _id: "s1", scope: "system" });
  const result = resolveEffectiveSkills({ allSkills: [s] });
  assert.equal(result.availableSkills.length, 1);
  assert.equal(result.resolvedStates.get("s1"), "available");
});

test("skills: no overrides, user skill → available by default", () => {
  const s = makeSkillDoc({ _id: "u1", scope: "user" });
  const result = resolveEffectiveSkills({ allSkills: [s] });
  assert.equal(result.availableSkills.length, 1);
  assert.equal(result.resolvedStates.get("u1"), "available");
});

test("skills: settings override promotes user skill to available", () => {
  const s = makeSkillDoc({ _id: "u1", scope: "user" });
  const result = resolveEffectiveSkills({
    allSkills: [s],
    settingsDefaults: [override("u1", "available")],
  });
  assert.equal(result.availableSkills.length, 1);
  assert.equal(result.resolvedStates.get("u1"), "available");
});

test("skills: settings override sets system skill to always", () => {
  const s = makeSkillDoc({ _id: "s1", scope: "system" });
  const result = resolveEffectiveSkills({
    allSkills: [s],
    settingsDefaults: [override("s1", "always")],
  });
  assert.equal(result.alwaysSkills.length, 1);
  assert.equal(result.availableSkills.length, 0);
});

test("skills: settings override sets system skill to never", () => {
  const s = makeSkillDoc({ _id: "s1", scope: "system" });
  const result = resolveEffectiveSkills({
    allSkills: [s],
    settingsDefaults: [override("s1", "never")],
  });
  assert.equal(result.neverSkillIds.has("s1"), true);
  assert.equal(result.availableSkills.length, 0);
});

// =============================================================================
// MARK: resolveEffectiveSkills — persona overrides settings
// =============================================================================

test("skills: persona override overrides settings", () => {
  const s = makeSkillDoc({ _id: "s1", scope: "system" });
  const result = resolveEffectiveSkills({
    allSkills: [s],
    settingsDefaults: [override("s1", "never")],
    personaOverrides: [override("s1", "always")],
  });
  assert.equal(result.alwaysSkills.length, 1);
  assert.equal(result.resolvedStates.get("s1"), "always");
});

test("skills: persona override absent → inherits settings", () => {
  const s = makeSkillDoc({ _id: "s1", scope: "system" });
  const result = resolveEffectiveSkills({
    allSkills: [s],
    settingsDefaults: [override("s1", "never")],
    personaOverrides: [], // present but empty = no overrides
  });
  assert.equal(result.resolvedStates.get("s1"), "never");
});

// =============================================================================
// MARK: resolveEffectiveSkills — chat overrides persona
// =============================================================================

test("skills: chat override overrides persona", () => {
  const s = makeSkillDoc({ _id: "s1", scope: "system" });
  const result = resolveEffectiveSkills({
    allSkills: [s],
    personaOverrides: [override("s1", "always")],
    chatOverrides: [override("s1", "never")],
  });
  assert.equal(result.resolvedStates.get("s1"), "never");
});

test("skills: chat override absent → inherits persona", () => {
  const s = makeSkillDoc({ _id: "s1", scope: "system" });
  const result = resolveEffectiveSkills({
    allSkills: [s],
    personaOverrides: [override("s1", "always")],
    chatOverrides: [],
  });
  assert.equal(result.resolvedStates.get("s1"), "always");
});

// =============================================================================
// MARK: resolveEffectiveSkills — turn overrides chat
// =============================================================================

test("skills: turn override overrides chat", () => {
  const s = makeSkillDoc({ _id: "s1", scope: "system" });
  const result = resolveEffectiveSkills({
    allSkills: [s],
    chatOverrides: [override("s1", "never")],
    turnOverrides: [override("s1", "always")],
  });
  assert.equal(result.resolvedStates.get("s1"), "always");
});

test("skills: full 4-layer precedence chain", () => {
  const s1 = makeSkillDoc({ _id: "s1", scope: "system" });
  const s2 = makeSkillDoc({ _id: "s2", scope: "system" });
  const s3 = makeSkillDoc({ _id: "s3", scope: "system" });
  const s4 = makeSkillDoc({ _id: "s4", scope: "user" });

  const result = resolveEffectiveSkills({
    allSkills: [s1, s2, s3, s4],
    settingsDefaults: [
      override("s1", "never"),
      override("s2", "always"),
      override("s4", "available"),
    ],
    personaOverrides: [
      override("s1", "available"), // overrides settings never
    ],
    chatOverrides: [
      override("s2", "never"), // overrides settings always
    ],
    turnOverrides: [
      override("s1", "always"), // overrides persona available
    ],
  });

  assert.equal(result.resolvedStates.get("s1"), "always");  // turn wins
  assert.equal(result.resolvedStates.get("s2"), "never");    // chat wins
  assert.equal(result.resolvedStates.get("s3"), "available"); // system default
  assert.equal(result.resolvedStates.get("s4"), "available"); // settings override
});

// =============================================================================
// MARK: resolveEffectiveSkills — special visibility handling
// =============================================================================

test("skills: integration_managed skills are always available, ignore user overrides", () => {
  const s = makeSkillDoc({ _id: "im1", visibility: "integration_managed" });
  const result = resolveEffectiveSkills({
    allSkills: [s],
    settingsDefaults: [override("im1", "never")], // should be ignored
  });
  assert.equal(result.resolvedStates.get("im1"), "available");
  assert.equal(result.availableSkills.length, 1);
});

test("skills: hidden skills are always never", () => {
  const s = makeSkillDoc({ _id: "h1", visibility: "hidden" });
  const result = resolveEffectiveSkills({
    allSkills: [s],
    settingsDefaults: [override("h1", "always")],
  });
  assert.equal(result.resolvedStates.get("h1"), "never");
});

test("skills: inactive/archived skills are never", () => {
  const s = makeSkillDoc({ _id: "a1", status: "archived" });
  const result = resolveEffectiveSkills({
    allSkills: [s],
    settingsDefaults: [override("a1", "always")],
  });
  assert.equal(result.resolvedStates.get("a1"), "never");
});

// =============================================================================
// MARK: resolveEffectiveSkills — output classification
// =============================================================================

test("skills: always, available, never correctly classified in output", () => {
  const s1 = makeSkillDoc({ _id: "a", scope: "system" });
  const s2 = makeSkillDoc({ _id: "b", scope: "system" });
  const s3 = makeSkillDoc({ _id: "c", scope: "system" });

  const result = resolveEffectiveSkills({
    allSkills: [s1, s2, s3],
    settingsDefaults: [
      override("a", "always"),
      override("b", "available"),
      override("c", "never"),
    ],
  });

  assert.equal(result.alwaysSkills.length, 1);
  assert.equal(result.alwaysSkills[0]._id, "a");
  assert.equal(result.availableSkills.length, 1);
  assert.equal(result.availableSkills[0]._id, "b");
  assert.equal(result.neverSkillIds.has("c"), true);
});

test("skills: empty input → empty output", () => {
  const result = resolveEffectiveSkills({ allSkills: [] });
  assert.equal(result.alwaysSkills.length, 0);
  assert.equal(result.availableSkills.length, 0);
  assert.equal(result.neverSkillIds.size, 0);
});

// =============================================================================
// MARK: resolveEffectiveIntegrations — basic
// =============================================================================

test("integrations: no overrides, no connections → empty", () => {
  const result = resolveEffectiveIntegrations({});
  assert.deepEqual(result.effectiveIntegrations, []);
});

test("integrations: enabled in settings + connected → effective", () => {
  const result = resolveEffectiveIntegrations({
    settingsDefaults: [intOverride("google_gmail", true)],
    connectedIntegrationIds: ["google_gmail"],
  });
  assert.deepEqual(result.effectiveIntegrations, ["google_gmail"]);
});

test("integrations: enabled in settings but not connected → not effective", () => {
  const result = resolveEffectiveIntegrations({
    settingsDefaults: [intOverride("google_gmail", true)],
    connectedIntegrationIds: [],
  });
  assert.deepEqual(result.effectiveIntegrations, []);
});

test("integrations: connected but disabled in settings → not effective", () => {
  const result = resolveEffectiveIntegrations({
    settingsDefaults: [intOverride("google_gmail", false)],
    connectedIntegrationIds: ["google_gmail"],
  });
  assert.deepEqual(result.effectiveIntegrations, []);
});

test("integrations: system default is disabled", () => {
  const result = resolveEffectiveIntegrations({
    connectedIntegrationIds: ["google_gmail"],
  });
  // No settings default → system default = disabled
  assert.deepEqual(result.effectiveIntegrations, []);
  assert.equal(result.resolvedStates.get("google_gmail"), false);
});

// =============================================================================
// MARK: resolveEffectiveIntegrations — layered override
// =============================================================================

test("integrations: persona overrides settings", () => {
  const result = resolveEffectiveIntegrations({
    settingsDefaults: [intOverride("gmail", false)],
    personaOverrides: [intOverride("gmail", true)],
    connectedIntegrationIds: ["gmail"],
  });
  assert.deepEqual(result.effectiveIntegrations, ["gmail"]);
});

test("integrations: chat overrides persona", () => {
  const result = resolveEffectiveIntegrations({
    personaOverrides: [intOverride("gmail", true)],
    chatOverrides: [intOverride("gmail", false)],
    connectedIntegrationIds: ["gmail"],
  });
  assert.deepEqual(result.effectiveIntegrations, []);
});

test("integrations: turn overrides chat", () => {
  const result = resolveEffectiveIntegrations({
    chatOverrides: [intOverride("gmail", false)],
    turnOverrides: [intOverride("gmail", true)],
    connectedIntegrationIds: ["gmail"],
  });
  assert.deepEqual(result.effectiveIntegrations, ["gmail"]);
});

test("integrations: full 4-layer precedence", () => {
  const result = resolveEffectiveIntegrations({
    settingsDefaults: [
      intOverride("gmail", true),
      intOverride("drive", true),
      intOverride("notion", false),
    ],
    personaOverrides: [
      intOverride("notion", true), // override settings
    ],
    chatOverrides: [
      intOverride("drive", false), // override settings
    ],
    turnOverrides: [
      intOverride("drive", true), // override chat
    ],
    connectedIntegrationIds: ["gmail", "drive", "notion"],
  });

  const effective = new Set(result.effectiveIntegrations);
  assert.equal(effective.has("gmail"), true);   // settings enabled
  assert.equal(effective.has("drive"), true);    // turn re-enabled
  assert.equal(effective.has("notion"), true);   // persona enabled
});

// =============================================================================
// MARK: resolveEffectiveIntegrations — multiple integrations
// =============================================================================

test("integrations: mixed enabled/disabled across multiple integrations", () => {
  const result = resolveEffectiveIntegrations({
    settingsDefaults: [
      intOverride("gmail", true),
      intOverride("drive", true),
      intOverride("notion", true),
      intOverride("slack", false),
    ],
    connectedIntegrationIds: ["gmail", "drive", "notion", "slack", "outlook"],
  });

  const effective = new Set(result.effectiveIntegrations);
  assert.equal(effective.has("gmail"), true);
  assert.equal(effective.has("drive"), true);
  assert.equal(effective.has("notion"), true);
  assert.equal(effective.has("slack"), false);
  assert.equal(effective.has("outlook"), false); // no settings entry → disabled
});
