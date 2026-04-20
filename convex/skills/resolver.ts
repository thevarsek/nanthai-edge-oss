// convex/skills/resolver.ts
// =============================================================================
// Unified capability resolver for M30 layered skill & integration resolution.
//
// Resolution precedence: Settings → Persona → Chat → Turn (slash chips)
// Missing override at any layer = inherit from parent layer.
//
// This is a pure-function module with no Convex DB dependencies so it can be
// unit-tested without a running backend. Callers load the data and pass it in.
// =============================================================================

import { Id, Doc } from "../_generated/dataModel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Tri-state skill resolution state. */
export type SkillState = "always" | "available" | "never";

/** A single skill override entry as stored in the DB. */
export interface SkillOverrideEntry {
  skillId: Id<"skills">;
  state: SkillState;
}

/** A single integration override entry as stored in the DB. */
export interface IntegrationOverrideEntry {
  integrationId: string;
  enabled: boolean;
}

/** Input layers for skill resolution. */
export interface SkillResolutionInput {
  /** All active skills to consider (pre-fetched). */
  allSkills: Doc<"skills">[];
  /** User-level defaults from `userPreferences.skillDefaults`. */
  settingsDefaults?: SkillOverrideEntry[];
  /** Persona-level overrides from `personas.skillOverrides`. */
  personaOverrides?: SkillOverrideEntry[];
  /** Chat-level overrides from `chats.skillOverrides`. */
  chatOverrides?: SkillOverrideEntry[];
  /** Turn-level overrides from slash chips. */
  turnOverrides?: SkillOverrideEntry[];
}

/** Output of skill resolution. */
export interface SkillResolutionResult {
  /** Skills whose full instructions should be injected every turn. */
  alwaysSkills: Doc<"skills">[];
  /** Skills that appear in the `<available_skills>` catalog XML. */
  availableSkills: Doc<"skills">[];
  /** Skill IDs that are completely excluded. */
  neverSkillIds: Set<string>;
  /** The resolved state for every skill considered. */
  resolvedStates: Map<string, SkillState>;
}

/** Input layers for integration resolution. */
export interface IntegrationResolutionInput {
  /** User-level defaults from `userPreferences.integrationDefaults`. */
  settingsDefaults?: IntegrationOverrideEntry[];
  /** Persona-level overrides from `personas.integrationOverrides`. */
  personaOverrides?: IntegrationOverrideEntry[];
  /** Chat-level overrides from `chats.integrationOverrides`. */
  chatOverrides?: IntegrationOverrideEntry[];
  /** Turn-level overrides from slash chips / per-message `enabledIntegrations`. */
  turnOverrides?: IntegrationOverrideEntry[];
  /** Integration IDs with live OAuth connections (pre-verified). */
  connectedIntegrationIds?: string[];
}

/** Output of integration resolution. */
export interface IntegrationResolutionResult {
  /** Integration IDs that are effectively enabled (passed all layers + OAuth). */
  effectiveIntegrations: string[];
  /** The resolved enabled/disabled state before OAuth filtering. */
  resolvedStates: Map<string, boolean>;
}

// ---------------------------------------------------------------------------
// Skill resolution
// ---------------------------------------------------------------------------

/**
 * Determine the system default state for a skill based on its properties.
 *
 * - `integration_managed` visibility: follows integration state, not user overrides.
 *   Treated as `available` here (callers handle integration gating separately).
 * - System scope + visible + active: `available`
 * - Everything else: `never`
 */
export function systemDefaultSkillState(skill: Doc<"skills">): SkillState {
  if (skill.visibility === "integration_managed") return "available";
  if ((skill.scope === "system" || skill.scope === "user") && skill.visibility === "visible" && skill.status === "active") {
    return "available";
  }
  return "never";
}

/**
 * Resolve the effective skill states across all layers.
 *
 * Precedence: turn > chat > persona > settings > system default.
 * Missing override at any layer = inherit from parent.
 */
export function resolveEffectiveSkills(input: SkillResolutionInput): SkillResolutionResult {
  const {
    allSkills,
    settingsDefaults,
    personaOverrides,
    chatOverrides,
    turnOverrides,
  } = input;

  // Build lookup maps for each layer
  const settingsMap = arrayToMap(settingsDefaults);
  const personaMap = arrayToMap(personaOverrides);
  const chatMap = arrayToMap(chatOverrides);
  const turnMap = arrayToMap(turnOverrides);

  const resolvedStates = new Map<string, SkillState>();
  const alwaysSkills: Doc<"skills">[] = [];
  const availableSkills: Doc<"skills">[] = [];
  const neverSkillIds = new Set<string>();

  for (const skill of allSkills) {
    const id = String(skill._id);

    // Skip inactive skills entirely
    if (skill.status !== "active") {
      neverSkillIds.add(id);
      resolvedStates.set(id, "never");
      continue;
    }

    // integration_managed skills are not affected by user skill overrides.
    // They follow integration enablement (handled by caller).
    // We include them as "available" if active.
    if (skill.visibility === "integration_managed") {
      resolvedStates.set(id, "available");
      availableSkills.push(skill);
      continue;
    }

    // Hidden skills are never user-discoverable
    if (skill.visibility === "hidden") {
      neverSkillIds.add(id);
      resolvedStates.set(id, "never");
      continue;
    }

    // Resolve through layers: turn > chat > persona > settings > system default
    const state =
      turnMap.get(id) ??
      chatMap.get(id) ??
      personaMap.get(id) ??
      settingsMap.get(id) ??
      systemDefaultSkillState(skill);

    resolvedStates.set(id, state);

    switch (state) {
      case "always":
        alwaysSkills.push(skill);
        break;
      case "available":
        availableSkills.push(skill);
        break;
      case "never":
        neverSkillIds.add(id);
        break;
    }
  }

  return { alwaysSkills, availableSkills, neverSkillIds, resolvedStates };
}

// ---------------------------------------------------------------------------
// Integration resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the effective integration states across all layers.
 *
 * Precedence: turn > chat > persona > settings > system default (disabled).
 * Final result is intersected with live OAuth connections.
 */
export function resolveEffectiveIntegrations(
  input: IntegrationResolutionInput,
): IntegrationResolutionResult {
  const {
    settingsDefaults,
    personaOverrides,
    chatOverrides,
    turnOverrides,
    connectedIntegrationIds,
  } = input;

  // Build lookup maps
  const settingsMap = integrationArrayToMap(settingsDefaults);
  const personaMap = integrationArrayToMap(personaOverrides);
  const chatMap = integrationArrayToMap(chatOverrides);
  const turnMap = integrationArrayToMap(turnOverrides);

  // Collect all integration IDs mentioned in any layer + connected
  const allIds = new Set<string>();
  for (const m of [settingsMap, personaMap, chatMap, turnMap]) {
    for (const id of m.keys()) allIds.add(id);
  }
  if (connectedIntegrationIds) {
    for (const id of connectedIntegrationIds) allIds.add(id);
  }

  const resolvedStates = new Map<string, boolean>();

  for (const id of allIds) {
    // Resolve: turn > chat > persona > settings > default (disabled)
    const state =
      turnMap.get(id) ??
      chatMap.get(id) ??
      personaMap.get(id) ??
      settingsMap.get(id) ??
      false; // system default: disabled

    resolvedStates.set(id, state);
  }

  // Intersect with live OAuth connections
  const connectedSet = new Set(connectedIntegrationIds ?? []);
  const effectiveIntegrations: string[] = [];

  for (const [id, enabled] of resolvedStates) {
    if (enabled && connectedSet.has(id)) {
      effectiveIntegrations.push(id);
    }
  }

  return { effectiveIntegrations, resolvedStates };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function arrayToMap(entries?: SkillOverrideEntry[]): Map<string, SkillState> {
  const map = new Map<string, SkillState>();
  if (!entries) return map;
  for (const e of entries) {
    map.set(String(e.skillId), e.state);
  }
  return map;
}

function integrationArrayToMap(entries?: IntegrationOverrideEntry[]): Map<string, boolean> {
  const map = new Map<string, boolean>();
  if (!entries) return map;
  for (const e of entries) {
    map.set(e.integrationId, e.enabled);
  }
  return map;
}
