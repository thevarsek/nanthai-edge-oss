import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";

import { compareFoldersForDisplay, resolveNextFolderSortOrder } from "../folders/shared";
import { create, moveChat, remove } from "../folders/mutations";
import { createFavorite, reorderFavorites, updateFavorite } from "../favorites/mutations";
import {
  resolveGoogleOAuthClientConfigForRedirect,
  resolveStoredGoogleOAuthClientConfig,
} from "../oauth/google_client_config";
import { createPersona, deletePersona } from "../tools/persona";
import { searchChats } from "../tools/search_chats";

type Row = Record<string, any>;

function authCtx(options?: { rows?: Record<string, Row>; tableRows?: Record<string, Row[]> }) {
  const rows = new Map(Object.entries(options?.rows ?? {}));
  const tableRows = new Map(Object.entries(options?.tableRows ?? {}));
  const inserts: Array<{ table: string; value: Row; id: string }> = [];
  const patches: Array<{ id: string; value: Row }> = [];
  const deletes: string[] = [];
  const rowsFor = (table: string) => tableRows.get(table) ?? [];
  const chainFor = (table: string) => ({
    withIndex: (_index: string, apply?: (q: any) => unknown) => {
      const filters: Record<string, unknown> = {};
      const q = {
        eq: (field: string, value: unknown) => {
          filters[field] = value;
          return q;
        },
      };
      apply?.(q);
      const filteredRows = () => rowsFor(table).filter((row) =>
        Object.entries(filters).every(([field, value]) => row[field] === value)
      );
      return {
        collect: async () => filteredRows(),
        first: async () => filteredRows()[0] ?? null,
      };
    },
  });
  const ctx = {
    auth: { getUserIdentity: async () => ({ subject: "user_1" }) },
    db: {
      get: async (id: string) => rows.get(id) ?? null,
      query: (table: string) => chainFor(table),
      insert: async (table: string, value: Row) => {
        const id = `${table}_${inserts.length + 1}`;
        inserts.push({ table, value, id });
        return id;
      },
      patch: async (id: string, value: Row) => patches.push({ id, value }),
      delete: async (id: string) => deletes.push(id),
    },
  } as any;
  return { ctx, inserts, patches, deletes };
}

test("folder ordering, creation defaults, move, and delete sync document folder ownership", async () => {
  assert.equal(compareFoldersForDisplay({ sortOrder: 2 }, { sortOrder: 1 }), 1);
  assert.equal(compareFoldersForDisplay({ sortOrder: 1, createdAt: 2 }, { sortOrder: 1, createdAt: 1 }), 1);
  assert.equal(compareFoldersForDisplay({ name: "B" }, { name: "A" }), 1);
  assert.equal(resolveNextFolderSortOrder([{ sortOrder: null }, { sortOrder: 4 }]), 5);

  const state = authCtx({
    rows: {
      folder_1: { _id: "folder_1", userId: "user_1" },
      chat_1: { _id: "chat_1", userId: "user_1" },
    },
    tableRows: {
      folders: [{ _id: "folder_old", userId: "user_1", sortOrder: 3 }],
      chats: [{ _id: "chat_1", userId: "user_1", folderId: "folder_1" }],
      documents: [
        { _id: "doc_owned", userId: "user_1", originChatId: "chat_1" },
        { _id: "doc_foreign", userId: "user_2", originChatId: "chat_1" },
      ],
    },
  });

  const folderId = await (create as any)._handler(state.ctx, { name: " Inbox " });
  await (moveChat as any)._handler(state.ctx, { chatId: "chat_1", folderId: "folder_1" });
  await (remove as any)._handler(state.ctx, { folderId: "folder_1" });

  assert.equal(folderId, "folders_1");
  assert.equal(state.inserts[0].value.sortOrder, 4);
  assert.ok(state.patches.some((entry) => entry.id === "doc_owned" && entry.value.folderId === "folder_1"));
  assert.ok(state.patches.some((entry) => entry.id === "doc_owned" && entry.value.folderId === undefined));
  assert.equal(state.patches.some((entry) => entry.id === "doc_foreign"), false);
  assert.deepEqual(state.deletes, ["folder_1"]);
});

test("favorites validate limits, modality failures, nullable persona clears, and reorder ownership", async () => {
  const state = authCtx({
    rows: {
      favorite_1: { _id: "favorite_1", userId: "user_1", sortOrder: 2 },
      favorite_2: { _id: "favorite_2", userId: "user_1", sortOrder: 0 },
      favorite_3: { _id: "favorite_3", userId: "user_2", sortOrder: 1 },
    },
    tableRows: {
      favorites: [
        { _id: "favorite_1", userId: "user_1", sortOrder: 2 },
        { _id: "favorite_2", userId: "user_1", sortOrder: 0 },
      ],
      cachedModels: [
        { modelId: "model_text", architecture: { modality: "text->text" } },
        { modelId: "model_image", architecture: { modality: "text->image" } },
      ],
    },
  });

  await assert.rejects(
    () => (createFavorite as any)._handler(state.ctx, { name: "Empty", modelIds: [] }),
    /At least one model/,
  );
  await assert.rejects(
    () => (createFavorite as any)._handler(state.ctx, { name: "Too many", modelIds: ["a", "b", "c", "d"] }),
    /at most 3/,
  );
  await assert.rejects(
    () => (createFavorite as any)._handler(state.ctx, { name: "Mixed", modelIds: ["model_text", "model_image"] }),
    /cannot be mixed/,
  );
  await (updateFavorite as any)._handler(state.ctx, {
    favoriteId: "favorite_1",
    name: " Updated ",
    personaId: null,
    personaName: null,
    personaEmoji: null,
    personaAvatarImageUrl: null,
  });
  await assert.rejects(
    () => (reorderFavorites as any)._handler(state.ctx, { orderedIds: ["favorite_1"] }),
    /full ordered list/,
  );
  await assert.rejects(
    () => (reorderFavorites as any)._handler(state.ctx, { orderedIds: ["favorite_1", "favorite_1"] }),
    /duplicate/,
  );
  await assert.rejects(
    () => (reorderFavorites as any)._handler(state.ctx, { orderedIds: ["favorite_1", "favorite_3"] }),
    /Favorite not found/,
  );

  assert.equal(state.patches[0].value.name, "Updated");
  assert.equal(state.patches[0].value.personaId, undefined);
});

test("Google OAuth config resolves native and web clients from redirect shape", () => {
  const previous = {
    native: process.env.GOOGLE_CLIENT_ID,
    web: process.env.GOOGLE_WEB_CLIENT_ID,
    webSecret: process.env.GOOGLE_WEB_CLIENT_SECRET,
  };
  process.env.GOOGLE_CLIENT_ID = " native-id ";
  process.env.GOOGLE_WEB_CLIENT_ID = " web-id ";
  process.env.GOOGLE_WEB_CLIENT_SECRET = " web-secret ";

  assert.deepEqual(resolveGoogleOAuthClientConfigForRedirect("nanthai://oauth"), {
    clientId: "native-id",
    clientType: "native",
  });
  assert.deepEqual(resolveGoogleOAuthClientConfigForRedirect("https://app.example/callback"), {
    clientId: "web-id",
    clientSecret: "web-secret",
    clientType: "web",
  });
  assert.deepEqual(resolveStoredGoogleOAuthClientConfig("web").clientType, "web");

  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_WEB_CLIENT_ID;
  assert.throws(() => resolveStoredGoogleOAuthClientConfig("native"), ConvexError);

  if (previous.native === undefined) delete process.env.GOOGLE_CLIENT_ID;
  else process.env.GOOGLE_CLIENT_ID = previous.native;
  if (previous.web === undefined) delete process.env.GOOGLE_WEB_CLIENT_ID;
  else process.env.GOOGLE_WEB_CLIENT_ID = previous.web;
  if (previous.webSecret === undefined) delete process.env.GOOGLE_WEB_CLIENT_SECRET;
  else process.env.GOOGLE_WEB_CLIENT_SECRET = previous.webSecret;
});

test("search and persona tools return validation, success, ambiguity, and failure results", async () => {
  const toolCtx = (overrides: Row = {}) => ({
    userId: "user_1",
    ctx: {
      runQuery: async (_ref: unknown, args: Row) => {
        if (overrides.throwQuery) throw new Error("query unavailable");
        if (args.searchQuery) return overrides.searchResults ?? [];
        return overrides.personas ?? [];
      },
      runMutation: async () => overrides.mutationResult ?? "persona_new",
    },
  } as any);

  assert.equal((await searchChats.execute(toolCtx(), { query: "" })).success, false);
  const emptySearch = await searchChats.execute(toolCtx({ searchResults: [] }), { query: " budget ", limit: 100 });
  assert.match(String((emptySearch.data as { message?: string } | null)?.message), /No messages/);
  assert.match(String((await searchChats.execute(toolCtx({ throwQuery: true }), { query: "budget" })).error), /query unavailable/);

  assert.equal((await createPersona.execute(toolCtx(), { name: "", systemPrompt: "x" })).success, false);
  assert.match(String((await createPersona.execute(toolCtx({ personas: [{ _id: "p1", displayName: "Planner" }] }), { name: " planner ", systemPrompt: "x" })).error), /already exists/);
  assert.match(String((await createPersona.execute(toolCtx(), { name: "New", systemPrompt: "x", temperature: 3 })).error), /Temperature/);
  assert.equal((await createPersona.execute(toolCtx({ mutationResult: "persona_1" }), { name: " New ", systemPrompt: "x", enabledIntegrations: ["gmail"] })).success, true);

  assert.equal((await deletePersona.execute(toolCtx(), {})).success, false);
  assert.match(String((await deletePersona.execute(toolCtx({ personas: [{ _id: "p1", displayName: "Planner" }, { _id: "p2", displayName: "Planning Coach" }] }), { personaName: "Plan" })).error), /Multiple personas/);
  assert.equal((await deletePersona.execute(toolCtx({ personas: [{ _id: "p1", displayName: "Planner" }] }), { personaId: "p1" })).success, true);
});
