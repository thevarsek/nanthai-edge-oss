import { describe, expect, it } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import {
  advisorComposerReducer,
  advisorQueueSnapshot,
  advisorSendProjection,
  INITIAL_ADVISOR_COMPOSER_STATE,
} from "@/advisors/composerReducer";
import type { ChatAdvisorView } from "@/advisors/types";

function personaId(value: string): Id<"personas"> {
  return value as Id<"personas">;
}

function keptAdvisor(value: string): ChatAdvisorView {
  return {
    _id: `assignment-${value}` as Id<"chatAdvisors">,
    personaId: personaId(value),
    instanceName: "Advisor 1",
    sortOrder: 0,
    allowWebSearch: true,
    displayName: value,
    createdAt: 1,
    updatedAt: 1,
    isAvailable: true,
  };
}

describe("advisorComposerReducer", () => {
  it("hydrates kept Advisors and uses sheet defaults for new one-shot selections", () => {
    const hydrated = advisorComposerReducer(INITIAL_ADVISOR_COMPOSER_STATE, {
      type: "hydrate",
      advisors: [keptAdvisor("maya")],
    });
    const opened = advisorComposerReducer(hydrated, { type: "open", allowWebSearch: false });
    const selected = advisorComposerReducer(opened, {
      type: "toggle",
      personaId: personaId("lee"),
      maxAdvisors: 3,
    });

    expect(selected.selections).toEqual([
      { personaId: "maya", allowWebSearch: true, keepAvailable: true },
      { personaId: "lee", allowWebSearch: false, keepAvailable: false },
    ]);
  });

  it("caps selection at three and preserves the draft when saving fails", () => {
    let state = INITIAL_ADVISOR_COMPOSER_STATE;
    for (const id of ["one", "two", "three", "four"]) {
      state = advisorComposerReducer(state, {
        type: "toggle",
        personaId: personaId(id),
        maxAdvisors: 3,
      });
    }
    state = advisorComposerReducer(state, { type: "setBrief", brief: "Focus on risk" });
    state = advisorComposerReducer(state, { type: "saveFailed", message: "Offline" });

    expect(state.selections.map((selection) => selection.personaId)).toEqual(["one", "two", "three"]);
    expect(state.brief).toBe("Focus on risk");
    expect(state.saveError).toBe("Offline");
  });

  it("clears one-shot state only after a successful send while retaining kept Advisors", () => {
    let state = advisorComposerReducer(INITIAL_ADVISOR_COMPOSER_STATE, {
      type: "toggle",
      personaId: personaId("once"),
      maxAdvisors: 3,
    });
    state = advisorComposerReducer(state, { type: "setBrief", brief: "Review tone" });

    expect(state.selections).toHaveLength(1);
    expect(state.brief).toBe("Review tone");

    state = advisorComposerReducer(state, { type: "update", personaId: personaId("once"), patch: { keepAvailable: true } });
    state = advisorComposerReducer(state, { type: "sendCompleted" });
    expect(state.selections).toEqual([
      { personaId: "once", allowWebSearch: false, keepAvailable: true },
    ]);
    expect(state.brief).toBe("");
  });

  it("freezes queued Advisors as one-shot and restores them without unkeeping current assignments", () => {
    let state = advisorComposerReducer(INITIAL_ADVISOR_COMPOSER_STATE, {
      type: "hydrate",
      advisors: [keptAdvisor("maya")],
    });
    state = advisorComposerReducer(state, {
      type: "toggle",
      personaId: personaId("lee"),
      maxAdvisors: 3,
    });
    state = advisorComposerReducer(state, { type: "setBrief", brief: "  Review risk  " });

    const snapshot = advisorQueueSnapshot(state, {
      isAvailable: true,
      maxAdvisors: 3,
      keptCount: 1,
      remainingCapacity: 2,
    });
    expect(snapshot).toEqual({
      advisorSelections: [
        { personaId: "maya", allowWebSearch: true, keepAvailable: false },
        { personaId: "lee", allowWebSearch: false, keepAvailable: false },
      ],
      advisorBrief: "Review risk",
    });

    state = advisorComposerReducer(state, { type: "sendCompleted" });
    state = advisorComposerReducer(state, {
      type: "restoreQueuedSnapshot",
      snapshot,
      maxAdvisors: 3,
    });
    expect(state.selections).toEqual([
      { personaId: "maya", allowWebSearch: true, keepAvailable: true },
      { personaId: "lee", allowWebSearch: false, keepAvailable: false },
    ]);
    expect(state.brief).toBe("Review risk");
  });

  it("drops Advisor payloads for ineligible media or protected turns without deleting the draft", () => {
    let state = advisorComposerReducer(INITIAL_ADVISOR_COMPOSER_STATE, {
      type: "toggle",
      personaId: personaId("maya"),
      maxAdvisors: 3,
    });
    state = advisorComposerReducer(state, { type: "setBrief", brief: "Check the framing" });

    expect(advisorSendProjection(state, {
      isAvailable: false,
      reasonCode: "media_output_turn",
      maxAdvisors: 3,
      keptCount: 0,
      remainingCapacity: 3,
    })).toEqual({});
    expect(state.selections).toHaveLength(1);
    expect(state.brief).toBe("Check the framing");
  });

  it("does not create a brief-only payload and clears the brief with the last Advisor", () => {
    let state = advisorComposerReducer(INITIAL_ADVISOR_COMPOSER_STATE, {
      type: "setBrief",
      brief: "Hidden brief",
    });
    expect(state.brief).toBe("");

    state = advisorComposerReducer(state, {
      type: "toggle",
      personaId: personaId("maya"),
      maxAdvisors: 3,
    });
    state = advisorComposerReducer(state, { type: "setBrief", brief: "Review this" });
    state = advisorComposerReducer(state, {
      type: "toggle",
      personaId: personaId("maya"),
      maxAdvisors: 3,
    });

    expect(state.brief).toBe("");
    expect(advisorSendProjection(state, undefined)).toEqual({});
  });

  it("merges delayed persisted assignments with local selections", () => {
    let state = advisorComposerReducer(INITIAL_ADVISOR_COMPOSER_STATE, {
      type: "toggle",
      personaId: personaId("local"),
      maxAdvisors: 3,
    });
    state = advisorComposerReducer(state, {
      type: "hydrate",
      advisors: [keptAdvisor("persisted")],
    });

    expect(state.selections.map((selection) => selection.personaId)).toEqual(["persisted", "local"]);
  });

  it("keeps the server assignment when a restored one-shot names the same Persona", () => {
    let state = advisorComposerReducer(INITIAL_ADVISOR_COMPOSER_STATE, {
      type: "toggle",
      personaId: personaId("persisted"),
      maxAdvisors: 3,
    });
    state = advisorComposerReducer(state, {
      type: "hydrate",
      advisors: [keptAdvisor("persisted")],
    });

    expect(state.selections).toEqual([
      { personaId: "persisted", allowWebSearch: true, keepAvailable: true },
    ]);
    expect(advisorComposerReducer(state, { type: "sendCompleted" }).selections).toHaveLength(1);
  });

  it("reconciles cross-client kept changes while preserving local one-shot selections", () => {
    let state = advisorComposerReducer(INITIAL_ADVISOR_COMPOSER_STATE, {
      type: "hydrate",
      advisors: [keptAdvisor("old")],
    });
    state = advisorComposerReducer(state, {
      type: "toggle",
      personaId: personaId("local"),
      maxAdvisors: 3,
    });
    state = advisorComposerReducer(state, {
      type: "syncPersisted",
      previousAdvisors: [keptAdvisor("old")],
      advisors: [keptAdvisor("remote")],
    });

    expect(state.selections).toEqual([
      { personaId: "remote", allowWebSearch: true, keepAvailable: true },
      { personaId: "local", allowWebSearch: false, keepAvailable: false },
    ]);
  });

  it("preserves a kept Advisor changed locally to one-shot when the server confirms removal", () => {
    const previous = keptAdvisor("maya");
    let state = advisorComposerReducer(INITIAL_ADVISOR_COMPOSER_STATE, {
      type: "hydrate",
      advisors: [previous],
    });
    state = advisorComposerReducer(state, {
      type: "update",
      personaId: personaId("maya"),
      patch: { keepAvailable: false },
    });
    state = advisorComposerReducer(state, {
      type: "syncPersisted",
      previousAdvisors: [previous],
      advisors: [],
    });

    expect(state.selections).toEqual([
      { personaId: "maya", allowWebSearch: true, keepAvailable: false },
    ]);
  });
});
