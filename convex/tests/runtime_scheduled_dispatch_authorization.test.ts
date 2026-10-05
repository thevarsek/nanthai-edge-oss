import assert from "node:assert/strict";
import test from "node:test";
import { commitLocalGenerationDispatchHandler } from "../runtime_host/chat_dispatch_mutations";
import { createPermissionFixture } from "./runtime_host_permission_fixture";
import type { Id } from "../_generated/dataModel";

for (const scheduled of [false, true]) {
  test(`local command records ${scheduled ? "configured automation" : "explicit turn"} authorization`, async () => {
    const { ctx, rows, now } = await createPermissionFixture();
    if (scheduled) rows.generationJobs[0].sourceJobId = "scheduled-1";
    const result = await commitLocalGenerationDispatchHandler(ctx, {
      jobId: "job-1" as Id<"generationJobs">,
      runId: "run-1" as Id<"executionRuns">,
      attemptId: "attempt-1" as Id<"executionAttempts">,
      fence: 7, userId: "user_1", targetDeviceId: "device-1",
      commandId: "scheduled-turn-2", commandType: "start", commandPayload: "{}",
      packetHash: "a".repeat(64), packetStorageId: "storage-1" as Id<"_storage">,
      packetByteLength: 1, packetExpiresAt: now + 120_000,
      attachmentGrants: [], completionEventId: "completion-1",
      sourceMessageId: "user-message-1" as Id<"messages">,
    });
    const command = rows.runtimeCommands.find((row) => row._id === result.commandRecordId);
    assert.equal(command?.authorizationSource, scheduled ? "configured_automation" : "explicit_user_turn");
    assert.equal(command?.initiatedBy, "user_1");
  });
}
