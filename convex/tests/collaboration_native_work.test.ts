import { api, internal } from "../_generated/api";
import { releaseWork } from "../collaboration/work_mutations";
import assert from "node:assert/strict";
import test from "node:test";
import type { FunctionArgs } from "convex/server";
import type { MutationCtx } from "../_generated/server";
import { publish } from "../runtime_host/work_publication";
import { createPermissionFixture, permissionHost } from "./runtime_host_permission_fixture";
import { claimWorkForJob } from "../collaboration/work_claims";
import { publishCollaborationJobTerminal } from "../collaboration/work_publication";
import type { Doc } from "../_generated/dataModel";

type Args = FunctionArgs<typeof internal.runtime_host.work_publication.publish>;
const handler = (publish as unknown as { _handler: (ctx: MutationCtx, args: Args) => Promise<null> })._handler;
async function fixture() {
  const f = await createPermissionFixture();
  f.rows.generationJobs[0].chatParticipantId = "participant-1";
  f.rows.generationJobs[0].collaborationExchangeId = "exchange-1";
  f.rows.collaborationWork = [{ _id: "work-1", userId: "user_1", chatId: "chat-1", objective: "Write",
    acceptanceCriteria: ["Verified"], assigneeId: "participant-1", reviewerIds: [], dependencyIds: [],
    revision: 1, requirementRevision: 1, evidenceRevision: 0, evidence: [], needsRevalidation: false,
    status: "open", linkedRunIds: [] }];
  const work = f.rows.collaborationWork[0] as unknown as Doc<"collaborationWork">;
  const job = f.rows.generationJobs[0] as unknown as Doc<"generationJobs">;
  await claimWorkForJob(f.ctx, work, job, Date.now() + 60_000);
  const args = { ...permissionHost, attemptId: "attempt-1", fence: 7, callId: "work-1", workId: "work-1",
    action: "publish", description: "Verified result", sourceRevision: "source-1", requirementRevision: 1, evidenceRevision: 0 } as Args;
  return { ...f, work, job, args };
}

test("authenticated native publication stages once and becomes peer evidence only at the committed reply", async () => {
  const f = await fixture();
  await handler(f.ctx, f.args);
  await handler(f.ctx, f.args);
  assert.equal(f.rows.collaborationWorkOperations.length, 1);
  assert.equal(f.work.evidence.length, 0);
  await f.ctx.db.patch(f.job.messageId, { content: "Verified source", status: "completed" });
  await publishCollaborationJobTerminal(f.ctx, { ...f.job, status: "completed" });
  assert.equal(f.work.evidence.length, 1);
  assert.equal(f.work.evidence[0].sourceRevision, "source-1");
});

test("native work publication rejects stale fencing, foreign claims, revocation and changed replay payloads", async () => {
  for (const change of ["fence", "claim", "device", "replay"] as const) {
    const f = await fixture();
    if (change === "fence") f.args.fence = 6;
    if (change === "claim") f.work.claim!.jobId = "foreign" as Doc<"generationJobs">["_id"];
    if (change === "device") f.rows.runtimeDevices[0].status = "revoked";
    if (change === "replay") { await handler(f.ctx, f.args); f.args.description = "Changed payload"; }
    await assert.rejects(handler(f.ctx, f.args));
    assert.equal(f.work.evidence.length, 0);
  }
});

test("human cancellation closes the writer fence and clears unpublished evidence during a handoff", async () => {
  const f = await fixture();
  await handler(f.ctx, f.args);
  Object.defineProperty(f.ctx.db, "system", { value: {} });
  f.ctx.auth.getUserIdentity = async () => ({ subject: "user_1" } as Awaited<ReturnType<MutationCtx["auth"]["getUserIdentity"]>>);
  const release = (releaseWork as unknown as { _handler: (ctx: MutationCtx, args: FunctionArgs<typeof api.collaboration.work_mutations.releaseWork>) => Promise<null> })._handler;
  await release(f.ctx, { workId: f.work._id, revision: f.work.revision, cancel: true, reason: "Stop this work" });
  assert.equal(f.work.status, "cancelled");
  assert.equal(f.work.pendingPublication, undefined);
  assert.equal(f.work.claim, undefined);
  await assert.rejects(handler(f.ctx, { ...f.args, callId: "late" }));
  assert.equal(f.work.evidence.length, 0);
});
