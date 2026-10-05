import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import schema from "../schema";
import { PURGE_TABLES } from "../account/purge_tables";

type TableShape = {
  validator: { fields: Record<string, unknown> };
  indexes: Array<{ indexDescriptor: string }>;
};

function tables(): Record<string, TableShape> {
  return (schema as unknown as { tables: Record<string, TableShape> }).tables;
}

function indexNames(table: TableShape): string[] {
  return table.indexes.map((index) => index.indexDescriptor);
}

test("runtime host schema owns credential, presence, route, conversation, and packet state", () => {
  const all = tables();
  const expected = [
    "runtimePairingRequests",
    "runtimeDevices",
    "runtimeDeviceCredentials",
    "runtimeDevicePresences",
    "runtimeModelDiscoveryRequests",
    "runtimeModelDiscoveryModels",
    "runtimeConversationBindings",
    "runtimeTurnPackets",
    "runtimeAttachmentFetchHandles",
    "runtimePermissionRequests",
    "runtimeNativeAgentGroups",
    "runtimeNativeAgents",
    "personaRuntimeBindings",
    "chatParticipantRuntimeRoutes",
    "chatRuntimeOverrides",
  ];
  for (const table of expected) {
    assert.ok(table in all, `missing ${table}`);
    assert.ok(PURGE_TABLES.includes(table as (typeof PURGE_TABLES)[number]));
  }
  assert.deepEqual(indexNames(all.runtimeTurnPackets), [
    "by_attempt",
    "by_attempt_command",
    "by_user",
    "by_expiry",
  ]);
  assert.deepEqual(indexNames(all.runtimeAttachmentFetchHandles), [
    "by_handle",
    "by_packet",
    "by_user",
    "by_expiry",
  ]);
  assert.deepEqual(indexNames(all.runtimeModelDiscoveryRequests), [
    "by_device_presence_status",
    "by_user",
    "by_status_expiry",
  ]);
  assert.deepEqual(indexNames(all.runtimeModelDiscoveryModels), [
    "by_request_ordinal",
    "by_user",
  ]);
  assert.deepEqual(indexNames(all.runtimePermissionRequests), [
    "by_user_chat_status",
    "by_attempt_request",
    "by_attempt_status",
    "by_run",
    "by_run_status",
    "by_response_command",
    "by_status_expiry",
  ]);
  assert.ok("nativeAgentThreadId" in all.runtimePermissionRequests.validator.fields);
  assert.deepEqual(indexNames(all.runtimeNativeAgentGroups), [
    "by_message", "by_attempt", "by_run", "by_chat", "by_user",
  ]);
  assert.deepEqual(indexNames(all.runtimeNativeAgents), [
    "by_group_thread", "by_group_ordinal", "by_group_status", "by_chat", "by_user",
  ]);
  assert.ok("runtimeNativeAgentGroupId" in all.messages.validator.fields);
  assert.ok(indexNames(all.runtimeCommands).includes("by_device_status"));
  assert.ok(indexNames(all.runtimeCommands).includes("by_turn_packet"));
  assert.ok(indexNames(all.executionAttempts).includes("by_device_status"));
  assert.ok("chatParticipantId" in all.executionAttempts.validator.fields);
  assert.ok("routeSnapshotHash" in all.executionAttempts.validator.fields);
  assert.deepEqual(indexNames(all.chatParticipantRuntimeRoutes), [
    "by_participant_status",
    "by_chat_status",
    "by_route_hash",
  ]);
});

test("chat creation and copying no longer write persistent Persona route defaults", () => {
  for (const path of [
    "../chat/mutations_public_handlers.ts", "../participants/mutations.ts",
    "../scheduledJobs/mutations.ts", "../chat/manage_copy_helpers.ts", "../runtime_host/chat_routes.ts",
  ]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(source, /snapshotParticipantRuntime|copyParticipantRuntimeSnapshot/);
    assert.doesNotMatch(source, /insert\(\s*"chatParticipantRuntimeRoutes"/);
  }
});

test("Persona create and update keep runtime route changes in the same mutation", () => {
  const source = readFileSync(
    new URL("../personas/mutations.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /runtimeRoute: v\.optional\(v\.object\(runtimeRouteArgs\)\)/);
  assert.match(
    source,
    /runtimeRoute: v\.optional\(v\.union\(v\.object\(runtimeRouteArgs\), v\.null\(\)\)\)/,
  );
  assert.match(source, /setPersonaRuntimeBindingHandler\(ctx/);
  assert.match(source, /clearPersonaRuntimeBindingHandler\(ctx/);
});
