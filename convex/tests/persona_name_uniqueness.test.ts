import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";

import { create, createPersonaInternal, update } from "../personas/mutations";

type Row = Record<string, unknown>;

function buildCtx(options: {
  records?: Record<string, Row>;
  personas: Row[];
}) {
  const records = new Map(Object.entries(options.records ?? {}));
  const patches: Array<{ id: string; value: Row }> = [];
  const rowsByTable: Record<string, Row[]> = {
    personas: options.personas,
    purchaseEntitlements: [{ userId: "user_1", status: "active" }],
  };
  const ctx = {
    auth: { getUserIdentity: async () => ({ subject: "user_1" }) },
    db: {
      get: async (id: string) => records.get(id) ?? null,
      insert: async () => "created_persona",
      patch: async (id: string, value: Row) => {
        patches.push({ id, value });
      },
      query: (table: string) => ({
        withIndex: (_index: string, apply?: (query: Row) => unknown) => {
          const filters: Array<[string, unknown]> = [];
          const query = {
            eq: (field: string, value: unknown) => {
              filters.push([field, value]);
              return query;
            },
          };
          apply?.(query);
          const filtered = () => (rowsByTable[table] ?? []).filter((row) =>
            filters.every(([field, value]) => row[field] === value),
          );
          return {
            collect: async () => filtered(),
            first: async () => filtered()[0] ?? null,
          };
        },
      }),
    },
  };
  return { ctx, patches };
}

const reviewer = {
  _id: "persona_1",
  userId: "user_1",
  displayName: "Reviewer",
};

function isDuplicateNameError(error: unknown): boolean {
  return error instanceof ConvexError && error.data?.code === "DUPLICATE_PERSONA_NAME";
}

test("public and internal persona creation reject a case-insensitive trimmed duplicate", async () => {
  await assert.rejects(
    (create as any)._handler(buildCtx({ personas: [reviewer] }).ctx, {
      displayName: " reviewer ",
      systemPrompt: "Review carefully.",
    }),
    isDuplicateNameError,
  );
  await assert.rejects(
    (createPersonaInternal as any)._handler(buildCtx({ personas: [reviewer] }).ctx, {
      userId: "user_1",
      displayName: "REVIEWER",
      systemPrompt: "Review carefully.",
    }),
    isDuplicateNameError,
  );
});

test("persona rename rejects another persona's name but permits the current persona's name", async () => {
  const writer = { _id: "persona_2", userId: "user_1", displayName: "Writer" };
  await assert.rejects(
    (update as any)._handler(buildCtx({
      records: { persona_2: writer },
      personas: [reviewer, writer],
    }).ctx, {
      personaId: "persona_2",
      displayName: "Reviewer",
    }),
    isDuplicateNameError,
  );

  const selfUpdate = buildCtx({
    records: { persona_1: reviewer },
    personas: [reviewer],
  });
  await (update as any)._handler(selfUpdate.ctx, {
    personaId: "persona_1",
    displayName: " reviewer ",
  });
  assert.equal(selfUpdate.patches[0]?.value.displayName, " reviewer ");
});
