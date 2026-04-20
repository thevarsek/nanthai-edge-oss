// convex/tests/skill_integration_migration.test.ts
// =============================================================================
// Tests for M30 skill/integration migration logic.
//
// Tests the conversion rules and verifies the resolver produces identical
// behavior before and after migration.
// =============================================================================

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  resolveEffectiveSkills,
  resolveEffectiveIntegrations,
  type SkillOverrideEntry,
  type IntegrationOverrideEntry,
} from "../skills/resolver";
import { Id, Doc } from "../_generated/dataModel";

// ── Helpers ──────────────────────────────────────────────────────────────

function migratePersonaSkills(ids: Id<"skills">[]): SkillOverrideEntry[] {
  return ids.map((id) => ({ skillId: id, state: "available" as const }));
}

function migratePersonaIntegrations(ids: string[]): IntegrationOverrideEntry[] {
  return ids.map((id) => ({ integrationId: id, enabled: true }));
}

function migrateChatSkills(
  disco: Id<"skills">[],
  disabled: Id<"skills">[],
): SkillOverrideEntry[] {
  const overrides: SkillOverrideEntry[] = [];
  for (const id of disco) {
    overrides.push({ skillId: id, state: "available" });
  }
  for (const id of disabled) {
    if (!overrides.some((o) => String(o.skillId) === String(id))) {
      overrides.push({ skillId: id, state: "never" });
    }
  }
  return overrides;
}

function makeSkillDoc(id: string, visibility: "visible" | "hidden" | "integration_managed" = "visible"): Doc<"skills"> {
  return {
    _id: id as Id<"skills">,
    _creationTime: Date.now(),
    name: `Skill ${id}`,
    slug: id,
    summary: `Summary for ${id}`,
    instructionsRaw: "raw instructions",
    instructionsCompiled: "compiled instructions",
    compilationStatus: "success",
    runtimeMode: "textOnly",
    scope: "system",
    origin: "system",
    visibility,
    status: "active",
    version: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as unknown as Doc<"skills">;
}

// ── Test data ────────────────────────────────────────────────────────────

const ALL_SKILLS = [
  makeSkillDoc("skill_1", "visible"),
  makeSkillDoc("skill_2", "visible"),
  makeSkillDoc("skill_3", "visible"),
  makeSkillDoc("skill_4", "hidden"),
  makeSkillDoc("skill_5", "integration_managed"),
];

// ── Tests ────────────────────────────────────────────────────────────────

describe("M30 migration: conversion functions", () => {
  test("persona discoverableSkillIds converts to available overrides", () => {
    const result = migratePersonaSkills(["skill_1" as Id<"skills">, "skill_2" as Id<"skills">]);
    assert.equal(result.length, 2);
    assert.equal(result[0].state, "available");
    assert.equal(result[1].state, "available");
  });

  test("persona enabledIntegrations converts to enabled overrides", () => {
    const result = migratePersonaIntegrations(["gmail", "drive"]);
    assert.deepEqual(result, [
      { integrationId: "gmail", enabled: true },
      { integrationId: "drive", enabled: true },
    ]);
  });

  test("chat disco+disabled converts correctly", () => {
    const result = migrateChatSkills(
      ["skill_1" as Id<"skills">],
      ["skill_3" as Id<"skills">],
    );
    assert.equal(result.length, 2);
    assert.equal(result[0].state, "available");
    assert.equal(result[1].state, "never");
  });

  test("chat duplicate in disco and disabled uses disco (available)", () => {
    const result = migrateChatSkills(
      ["skill_1" as Id<"skills">],
      ["skill_1" as Id<"skills">],
    );
    assert.equal(result.length, 1);
    assert.equal(result[0].state, "available");
  });
});

describe("M30 migration: migrated overrides preserve expected resolution", () => {
  test("migrated persona skills resolve as available", () => {
    const migratedResult = resolveEffectiveSkills({
      allSkills: ALL_SKILLS,
      personaOverrides: migratePersonaSkills(["skill_1" as Id<"skills">, "skill_2" as Id<"skills">]),
      chatOverrides: [],
      turnOverrides: [],
    });

    assert.equal(migratedResult.resolvedStates.get("skill_1"), "available");
    assert.equal(migratedResult.resolvedStates.get("skill_2"), "available");
  });

  test("migrated chat disabled skills resolve as never", () => {
    const migratedResult = resolveEffectiveSkills({
      allSkills: ALL_SKILLS,
      personaOverrides: [],
      chatOverrides: migrateChatSkills(
        ["skill_1" as Id<"skills">],
        ["skill_3" as Id<"skills">],
      ),
      turnOverrides: [],
    });

    assert.equal(migratedResult.resolvedStates.get("skill_1"), "available");
    assert.equal(migratedResult.resolvedStates.get("skill_3"), "never");
  });

  test("migrated persona integrations resolve when connected", () => {
    const migratedResult = resolveEffectiveIntegrations({
      settingsDefaults: [],
      personaOverrides: migratePersonaIntegrations(["gmail", "drive"]),
      chatOverrides: [],
      turnOverrides: [],
      connectedIntegrationIds: ["gmail", "drive", "calendar"],
    });

    assert.equal(migratedResult.resolvedStates.get("gmail"), true);
    assert.equal(migratedResult.resolvedStates.get("drive"), true);
    assert.equal(migratedResult.resolvedStates.get("calendar"), false);
  });
});
