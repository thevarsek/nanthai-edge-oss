import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanupConnectionReferencePage,
  type ConnectionReferenceCleanupState,
} from "../mcp/connection_references";
import { unknownOwnedRemoteMcpIntegrationIds } from "../mcp/integration_targets";

type StoredRow = Record<string, unknown> & { _id: string };

function integrationOverrides(...integrationIds: string[]) {
  return integrationIds.map((integrationId) => ({ integrationId, enabled: true }));
}

test("Remote MCP disconnect removes every mutable integration reference in bounded idempotent pages", async () => {
  const disconnected = "mcp:disconnected";
  const rows: Record<string, StoredRow[]> = {
    userPreferences: [{
      _id: "preferences_1",
      integrationDefaults: integrationOverrides("gmail", disconnected),
      updatedAt: 1,
    }],
    personas: [
      { _id: "persona_without_reference", integrationOverrides: integrationOverrides("gmail") },
      { _id: "persona_1", integrationOverrides: integrationOverrides(disconnected, "slack") },
    ],
    chats: [{
      _id: "chat_1",
      integrationOverrides: integrationOverrides("notion", disconnected),
      updatedAt: 10,
    }],
    skills: [{
      _id: "skill_1",
      requiredIntegrationIds: ["drive", disconnected],
      updatedAt: 1,
    }],
    scheduledJobs: [{
      _id: "job_1",
      enabledIntegrations: [disconnected, "calendar"],
      turnIntegrationOverrides: integrationOverrides("gmail", disconnected),
      steps: [{
        prompt: "Run",
        modelId: "openai/gpt-5",
        enabledIntegrations: ["slack", disconnected],
        turnIntegrationOverrides: integrationOverrides(disconnected, "drive"),
      }],
      updatedAt: 1,
    }],
  };
  const patchIds: string[] = [];
  const requestedPageSizes: number[] = [];
  let queriedTable = "";
  const ctx = {
    db: {
      query: (table: string) => {
        queriedTable = table;
        return {
          withIndex: () => ({
            first: async () => rows[table]?.[0] ?? null,
            paginate: async ({ cursor, numItems }: { cursor: string | null; numItems: number }) => {
              requestedPageSizes.push(numItems);
              const offset = cursor ? Number(cursor) : 0;
              const pageLength = table === "personas" ? 1 : numItems;
              const page = (rows[table] ?? []).slice(offset, offset + pageLength);
              const nextOffset = offset + page.length;
              return {
                page,
                continueCursor: String(nextOffset),
                isDone: nextOffset >= (rows[table]?.length ?? 0),
              };
            },
          }),
        };
      },
      patch: async (id: string, patch: Record<string, unknown>) => {
        const row = Object.values(rows).flat().find((candidate) => candidate._id === id);
        assert.ok(row, `Missing test row ${id} while querying ${queriedTable}`);
        Object.assign(row, patch);
        patchIds.push(id);
      },
    },
  };

  const sweep = async () => {
    let state: ConnectionReferenceCleanupState | undefined;
    for (let calls = 0; calls < 20; calls += 1) {
      state = await cleanupConnectionReferencePage(ctx as never, {
        userId: "user_1",
        integrationId: disconnected,
        state,
      });
      if (!state) return;
    }
    assert.fail("Reference cleanup did not terminate");
  };

  await sweep();

  assert.deepEqual(patchIds, [
    "preferences_1",
    "persona_1",
    "chat_1",
    "skill_1",
    "job_1",
  ]);
  assert.deepEqual(rows.userPreferences?.[0]?.integrationDefaults, integrationOverrides("gmail"));
  assert.deepEqual(rows.personas?.[1]?.integrationOverrides, integrationOverrides("slack"));
  assert.deepEqual(rows.chats?.[0]?.integrationOverrides, integrationOverrides("notion"));
  assert.equal(rows.chats?.[0]?.updatedAt, 10);
  assert.deepEqual(rows.skills?.[0]?.requiredIntegrationIds, ["drive"]);
  assert.deepEqual(rows.scheduledJobs?.[0]?.enabledIntegrations, ["calendar"]);
  assert.deepEqual(
    rows.scheduledJobs?.[0]?.turnIntegrationOverrides,
    integrationOverrides("gmail"),
  );
  const steps = rows.scheduledJobs?.[0]?.steps as Array<Record<string, unknown>> | undefined;
  assert.deepEqual(steps?.[0]?.enabledIntegrations, ["slack"]);
  assert.deepEqual(steps?.[0]?.turnIntegrationOverrides, integrationOverrides("drive"));
  assert.ok(requestedPageSizes.every((size) => size === 50));

  await sweep();
  assert.equal(patchIds.length, 5);
});

test("Remote MCP targets cannot be reintroduced after disconnect begins", async () => {
  const connections = [
    { integrationId: "mcp:active", status: "active" },
    { integrationId: "mcp:disabled", status: "disabled" },
    { integrationId: "mcp:disconnecting", status: "disconnecting" },
  ];
  const ctx = {
    db: {
      query: () => ({
        withIndex: () => ({ take: async () => connections }),
      }),
    },
  };

  assert.deepEqual(await unknownOwnedRemoteMcpIntegrationIds(
    ctx as never,
    "user_1",
    connections.map((connection) => connection.integrationId),
  ), ["mcp:disconnecting"]);
  assert.deepEqual(await unknownOwnedRemoteMcpIntegrationIds(
    ctx as never,
    "user_1",
    connections.map((connection) => connection.integrationId),
    { activeOnly: true },
  ), ["mcp:disabled", "mcp:disconnecting"]);
});
