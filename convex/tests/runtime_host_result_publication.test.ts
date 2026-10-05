import assert from "node:assert/strict";
import test from "node:test";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { publish } from "../runtime_host/result_publication";
import { contextDigest } from "../runtime_host/context_receipt";
import { getGeneratedFilesByIdsHandler } from "../chat/queries_generated_files_handlers";
import { assembleContext, type AssemblyMemoryCandidate, type AssemblyArtifactCandidate } from "../chat/context_assembler";
import { createPermissionFixture, permissionHost } from "./runtime_host_permission_fixture";

type Args = typeof permissionHost & { attemptId: Id<"executionAttempts">; fence: number; callId: string; inputHash: string; storageId: Id<"_storage">; filename: string; mimeType: string; sizeBytes: number; content: string };
const handler = (publish as unknown as { _handler: (ctx: MutationCtx, args: Args) => Promise<{ generatedFileId: Id<"generatedFiles">; storageId: Id<"_storage">; filename: string }> })._handler;
async function setup() {
  const fixture = await createPermissionFixture();
  fixture.rows.generatedFiles = [];
  fixture.rows.toolExecutionArtifacts = [];
  fixture.rows.toolMemories = [];
  fixture.ctx.storage.getMetadata = async () => ({ size: 12 } as Awaited<ReturnType<MutationCtx["storage"]["getMetadata"]>>);
  const file = { filename: "result.csv", mimeType: "text/csv", content: "answer\n42.00" };
  const args: Args = { ...permissionHost, ...file, attemptId: "attempt-1" as Id<"executionAttempts">, fence: 7, callId: "call-1", inputHash: await contextDigest(file), storageId: "blob-1" as Id<"_storage">, sizeBytes: 12 };
  return { ...fixture, args };
}

test("a committed result is readable by another client, available to a peer, and replayed without duplicate publication", async () => {
  const { ctx, rows, args, state } = await setup();
  const first = await handler(ctx, args);
  const replay = await handler(ctx, { ...args, storageId: "blob-retry" as Id<"_storage"> });
  assert.deepEqual(replay, first);
  assert.equal(rows.generatedFiles.length, 1);
  assert.equal(rows.toolExecutionArtifacts.length, 1);
  assert.deepEqual(state.storageDeletes, ["blob-retry"]);
  ctx.auth.getUserIdentity = async () => ({ subject: "user_1" } as Awaited<ReturnType<MutationCtx["auth"]["getUserIdentity"]>>);
  const files = await getGeneratedFilesByIdsHandler({ auth: ctx.auth, db: ctx.db, storage: ctx.storage } as unknown as Parameters<typeof getGeneratedFilesByIdsHandler>[0], { fileIds: [first.generatedFileId] });
  assert.equal(files[0]?.filename, "result.csv");
  assert.ok(files[0]?.downloadUrl);
  const assembled = assembleContext({ chatId: "chat-1" as Id<"chats">, messageId: "peer-answer" as Id<"messages">, jobId: "peer-job" as Id<"generationJobs">, userId: "user_1", participantId: "another-participant", legacyMessages: [{ role: "user", content: "Read the published result" }], toolMemories: rows.toolMemories as unknown as AssemblyMemoryCandidate[], rawArtifacts: rows.toolExecutionArtifacts as unknown as AssemblyArtifactCandidate[] });
  assert.match(JSON.stringify(assembled.messages), /42.00/);
  assert.equal(rows.runEvents.filter((event) => event.type === "artifact_created").length, 1);
});

test("publication is refused after cancellation, stale fencing or device revocation", async () => {
  for (const change of ["cancel", "fence", "revoke"]) {
    const { ctx, rows, args } = await setup();
    if (change === "cancel") rows.executionAttempts[0].status = "cancelled";
    if (change === "fence") args.fence = 6;
    if (change === "revoke") rows.runtimeDevices[0].status = "revoked";
    await assert.rejects(handler(ctx, args));
    assert.equal(rows.generatedFiles.length, 0);
    assert.equal(rows.toolExecutionArtifacts.length, 0);
  }
});
