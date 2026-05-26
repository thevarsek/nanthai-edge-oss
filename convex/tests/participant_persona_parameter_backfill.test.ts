import assert from "node:assert/strict";
import test from "node:test";

import { backfillChatParticipantPersonaParameters } from "../models/migrations";

test("backfillChatParticipantPersonaParameters snapshots persona parameter fields", async () => {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const personas = new Map([
    ["persona_with_params", {
      _id: "persona_with_params",
      temperature: 0.4,
      maxTokens: 2048,
      includeReasoning: true,
      reasoningEffort: "high",
    }],
    ["persona_without_params", {
      _id: "persona_without_params",
    }],
  ]);
  const ctx = {
    db: {
      query: (table: string) => ({
        collect: async () => {
          if (table !== "chatParticipants") return [];
          return [
            {
              _id: "participant_1",
              personaId: "persona_with_params",
              temperature: undefined,
              maxTokens: undefined,
              includeReasoning: undefined,
              reasoningEffort: undefined,
            },
            {
              _id: "participant_current",
              personaId: "persona_with_params",
              temperature: 0.4,
              maxTokens: 2048,
              includeReasoning: true,
              reasoningEffort: "high",
            },
            {
              _id: "participant_no_params",
              personaId: "persona_without_params",
            },
            {
              _id: "participant_missing_persona",
              personaId: "persona_missing",
            },
            {
              _id: "participant_no_persona",
            },
          ];
        },
      }),
      get: async (id: string) => personas.get(id) ?? null,
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
      },
    },
  } as any;

  const result = await (backfillChatParticipantPersonaParameters as any)._handler(ctx, {});

  assert.deepEqual(result, {
    scanned: 4,
    missingPersona: 1,
    personasWithoutParameters: 1,
    patched: 1,
    alreadyCurrent: 1,
  });
  assert.deepEqual(patches, [{
    id: "participant_1",
    patch: {
      temperature: 0.4,
      maxTokens: 2048,
      includeReasoning: true,
      reasoningEffort: "high",
    },
  }]);
});

test("backfillChatParticipantPersonaParameters dry run counts without patching", async () => {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const ctx = {
    db: {
      query: () => ({
        collect: async () => [{
          _id: "participant_1",
          personaId: "persona_1",
        }],
      }),
      get: async () => ({
        _id: "persona_1",
        temperature: 0.9,
      }),
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
      },
    },
  } as any;

  const result = await (backfillChatParticipantPersonaParameters as any)._handler(ctx, { dryRun: true });

  assert.equal(result.patched, 1);
  assert.deepEqual(patches, []);
});
