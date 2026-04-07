import assert from "node:assert/strict";
import test from "node:test";

import { createPersona, deletePersona } from "../tools/persona";
import { searchChats } from "../tools/search_chats";

test("searchChats validates queries and clamps the requested limit", async () => {
  const empty = await searchChats.execute(
    {
      userId: "user_1",
      ctx: {
        runQuery: async () => [],
      },
    } as any,
    { query: "   " },
  );

  const successful = await searchChats.execute(
    {
      userId: "user_1",
      ctx: {
        runQuery: async (_fn: unknown, args: Record<string, unknown>) => {
          assert.equal(args.limit, 25);
          return [
            { chatId: "chat_1", messageId: "msg_1", snippet: "project alpha" },
            { chatId: "chat_2", messageId: "msg_2", snippet: "project alpha follow-up" },
          ];
        },
      },
    } as any,
    { query: "project alpha", limit: 99 },
  );

  assert.equal(empty.success, false);
  assert.equal(successful.success, true);
  assert.equal((successful.data as any).totalFound, 2);
  assert.match((successful.data as any).message, /across 2 chats/);
});

test("createPersona rejects duplicate names and validates temperature bounds", async () => {
  const duplicate = await createPersona.execute(
    {
      userId: "user_1",
      ctx: {
        runQuery: async () => [{ _id: "persona_1", displayName: "Researcher" }],
      },
    } as any,
    { name: " researcher ", systemPrompt: "Help with research." },
  );

  const invalidTemp = await createPersona.execute(
    {
      userId: "user_1",
      ctx: {
        runQuery: async () => [],
      },
    } as any,
    { name: "Writer", systemPrompt: "Write", temperature: 4 },
  );

  assert.equal(duplicate.success, false);
  assert.equal((duplicate.data as any).existingPersonaId, "persona_1");
  assert.equal(invalidTemp.success, false);
  assert.match(invalidTemp.error ?? "", /between 0.0 and 2.0/);
});

test("createPersona creates a new persona with trimmed metadata", async () => {
  const mutations: Array<Record<string, unknown>> = [];

  const result = await createPersona.execute(
    {
      userId: "user_1",
      ctx: {
        runQuery: async () => [],
        runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
          mutations.push(args);
          return "persona_new";
        },
      },
    } as any,
    {
      name: " Coding Coach ",
      systemPrompt: "Be precise and practical.",
      description: "Typescript help",
      enabledIntegrations: ["gmail"],
    },
  );

  assert.equal(result.success, true);
  assert.equal((result.data as any).personaId, "persona_new");
  assert.equal(mutations[0]?.displayName, "Coding Coach");
});

test("deletePersona reports ambiguous name matches and deletes exact matches", async () => {
  const ambiguous = await deletePersona.execute(
    {
      userId: "user_1",
      ctx: {
        runQuery: async () => [
          { _id: "persona_1", displayName: "Research Analyst" },
          { _id: "persona_2", displayName: "Research Assistant" },
        ],
      },
    } as any,
    { personaName: "research" },
  );

  const deleted: Array<Record<string, unknown>> = [];
  const success = await deletePersona.execute(
    {
      userId: "user_1",
      ctx: {
        runQuery: async () => [{ _id: "persona_1", displayName: "Research Analyst" }],
        runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
          deleted.push(args);
        },
      },
    } as any,
    { personaName: "analyst" },
  );

  assert.equal(ambiguous.success, false);
  assert.deepEqual((ambiguous.data as any).ambiguousMatches, [
    "Research Analyst",
    "Research Assistant",
  ]);
  assert.equal(success.success, true);
  assert.deepEqual(deleted, [{ personaId: "persona_1", userId: "user_1" }]);
});
