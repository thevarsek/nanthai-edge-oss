import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveAdvisorEligibility,
  resolveAdvisorModelAvailability,
} from "../advisors/eligibility";

type EligibilityFixture = {
  pro?: boolean;
  zdr?: boolean;
  autonomousStatus?: string;
  modelModalities?: Record<string, string>;
  connectedGmail?: boolean;
};
type EligibilityArgs = Parameters<typeof resolveAdvisorEligibility>[1];
type IndexQuery = { eq: (field: string, value: unknown) => IndexQuery };

function eligibilityCtx(fixture: EligibilityFixture = {}) {
  const rows = (table: string): Array<Record<string, unknown>> => {
    if (table === "purchaseEntitlements") {
      return fixture.pro ? [{ userId: "user_1", status: "active" }] : [];
    }
    if (table === "userPreferences") {
      return [{ userId: "user_1", zdrEnabled: fixture.zdr === true }];
    }
    if (table === "autonomousSessions") {
      return fixture.autonomousStatus
        ? [{ chatId: "chat_1", status: fixture.autonomousStatus }]
        : [];
    }
    if (table === "cachedModels") {
      return Object.entries(fixture.modelModalities ?? { text_model: "text->text" })
        .map(([modelId, modality]) => ({ modelId, architecture: { modality } }));
    }
    if (table === "oauthConnections" && fixture.connectedGmail) {
      return [{ userId: "user_1", provider: "gmail_manual", status: "active" }];
    }
    return [];
  };
  return {
    db: {
      get: async () => null,
      query: (table: string) => ({
        withIndex: (_index: string, apply?: (query: IndexQuery) => void) => {
          const filters: Array<[string, unknown]> = [];
          const query: IndexQuery = {
            eq: (field: string, value: unknown) => {
              filters.push([field, value]);
              return query;
            },
          };
          apply?.(query);
          const filtered = () => rows(table).filter((row) =>
            filters.every(([field, value]) => row[field] === value)
          );
          return {
            first: async () => filtered()[0] ?? null,
            collect: async () => filtered(),
            order: () => ({ first: async () => filtered()[0] ?? null }),
          };
        },
      }),
    },
  } as unknown as Parameters<typeof resolveAdvisorEligibility>[0];
}

function eligibilityArgs(overrides: Record<string, unknown> = {}): EligibilityArgs {
  return {
    userId: "user_1",
    chat: { _id: "chat_1", source: "user" },
    participants: [{ modelId: "text_model" }],
    keptPersonaIds: [],
    ...overrides,
  } as unknown as EligibilityArgs;
}

test("Advisor eligibility enforces Pro, privacy, and user-initiated text turns", async () => {
  assert.equal((await resolveAdvisorEligibility(eligibilityCtx(), eligibilityArgs())).reasonCode, "not_pro");
  assert.equal((await resolveAdvisorEligibility(
    eligibilityCtx({ pro: true, zdr: true }),
    eligibilityArgs(),
  )).reasonCode, "zdr_enabled");
  assert.equal((await resolveAdvisorEligibility(
    eligibilityCtx({ pro: true }),
    eligibilityArgs({ chat: { _id: "chat_1", source: "scheduled_job" } }),
  )).reasonCode, "unsupported_turn");
  assert.equal((await resolveAdvisorEligibility(
    eligibilityCtx({ pro: true, autonomousStatus: "running" }),
    eligibilityArgs(),
  )).reasonCode, "unsupported_turn");
  assert.equal((await resolveAdvisorEligibility(
    eligibilityCtx({ pro: true, modelModalities: { image_model: "text->image" } }),
    eligibilityArgs({ participants: [{ modelId: "image_model" }] }),
  )).reasonCode, "media_output_turn");
  assert.equal((await resolveAdvisorEligibility(
    eligibilityCtx({ pro: true, modelModalities: { hybrid_model: "text->text+image" } }),
    eligibilityArgs({ participants: [{ modelId: "hybrid_model" }] }),
  )).reasonCode, "media_output_turn");
});

test("Advisor eligibility detects Persona conflicts, Google protection, and capacity", async () => {
  const conflict = await resolveAdvisorEligibility(eligibilityCtx({ pro: true }), eligibilityArgs({
    participants: [{ modelId: "text_model", personaId: "persona_1" }],
    selectedPersonaIds: ["persona_1"],
  }));
  assert.equal(conflict.isAvailable, true);
  assert.equal(conflict.reasonCode, undefined);
  assert.deepEqual(conflict.conflictingPersonaIds, ["persona_1"]);

  const google = await resolveAdvisorEligibility(eligibilityCtx({
    pro: true,
    connectedGmail: true,
  }), eligibilityArgs({
    enabledIntegrations: ["gmail"],
  }));
  assert.equal(google.reasonCode, "google_protected");

  const capacity = await resolveAdvisorEligibility(eligibilityCtx({ pro: true }), eligibilityArgs({
    keptPersonaIds: ["persona_1", "persona_2", "persona_3"],
    selectedPersonaIds: ["persona_4"],
  }));
  assert.equal(capacity.reasonCode, "no_capacity");
  assert.equal(capacity.remainingCapacity, 0);
});

test("Advisor model availability distinguishes missing and media-output models", async () => {
  const ctx = eligibilityCtx({
    pro: true,
    modelModalities: {
      text_model: "text->text",
      image_model: "text->image",
    },
  });
  assert.deepEqual(await resolveAdvisorModelAvailability(ctx, "text_model"), {
    isAvailable: true,
  });
  assert.deepEqual(await resolveAdvisorModelAvailability(ctx, "image_model"), {
    isAvailable: false,
    reasonCode: "media_output_model",
  });
  assert.deepEqual(await resolveAdvisorModelAvailability(ctx, "missing_model"), {
    isAvailable: false,
    reasonCode: "model_unavailable",
  });
});
