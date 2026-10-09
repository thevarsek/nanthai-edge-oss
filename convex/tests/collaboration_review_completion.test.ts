import assert from "node:assert/strict";
import test from "node:test";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";
import { claimWorkForJob } from "../collaboration/work_claims";
import { eligibleWork } from "../collaboration/work_context";
import { commitWorkReview, proposeWorkResultHandler } from "../collaboration/work_reviews";
import { pendingWorkReviewerIds } from "../collaboration/work_review_policy";
import { selectedWork } from "../collaboration/work_selection";
import { selectWorkSpeakers } from "../collaboration/work_progress";
import { invoke } from "./conversation_context_fixture";

function fixture() {
  const rows: Record<string, Array<Record<string, unknown>>> = {
    chats:[{_id:"chat",userId:"owner",isDeleting:false}],
    collaborationWork:[{_id:"work",userId:"owner",chatId:"chat",revision:1,requirementRevision:1,
      evidenceRevision:1,sourceRevision:"v1",status:"review",reviewerIds:["a","b"],dependencyIds:[],
      needsRevalidation:false,linkedRunIds:[],evidence:[{messageId:"result",sourceRevision:"v1",description:"Evidence"}]}],
    executionRuns:["a","b","team"].map(id=>({_id:`run-${id}`,userId:"owner",chatId:"chat",state:"running",activeAttemptId:`attempt-${id}`})),
    executionAttempts:["a","b","team"].map(id=>({_id:`attempt-${id}`,runId:`run-${id}`,userId:"owner",status:"running",fence:1,leaseExpiresAt:Date.now()+60_000})),
    generationJobs:["a","b"].map(id=>({_id:`job-${id}`,userId:"owner",chatId:"chat",chatParticipantId:id,
      executionRunId:`run-${id}`,executionAttemptId:`attempt-${id}`,executionFence:1,status:"streaming"})),
    chatParticipants:["a","b"].map(id=>({_id:id,userId:"owner",chatId:"chat",modelId:"model"})),
    collaborationExchanges:[{_id:"exchange",userId:"owner",chatId:"chat",status:"waiting",workEnabled:true,
      activeParticipantIds:[],failedParticipantIds:[],participantSnapshot:[{participantId:"a"},{participantId:"b"}],
      frontierMessageIds:[],publishedMessageCount:0,bounds:{maxParticipantMessages:8,deadlineAt:Date.now()+60_000},
      executionRunId:"run-team",executionAttemptId:"attempt-team",executionFence:1,executionClaimantId:"team"}],
  };
  const ctx=createStatefulMockCtx(rows) as unknown as MutationCtx;
  const work=()=>rows.collaborationWork[0] as unknown as Doc<"collaborationWork">;
  const review=async (reviewer:string,action:"accept"|"rework"="accept")=>{
    const job=rows.generationJobs.find(row=>row.chatParticipantId===reviewer) as unknown as Doc<"generationJobs">;
    await claimWorkForJob(ctx,work(),job,Date.now()+30_000);
    const args={userId:"owner",workId:work()._id,jobId:job._id,attemptId:job.executionAttemptId as Id<"executionAttempts">,
      fence:1,action,description:`${reviewer} ${action}`,sourceRevision:"v1",requirementRevision:1,evidenceRevision:1,operationKey:`review-${reviewer}`};
    await proposeWorkResultHandler(ctx,args);
    await proposeWorkResultHandler(ctx,args); // The same fenced tool result is replay-safe.
  };
  return {ctx,rows,work,review};
}

test("all selected reviewers accept the same evidence before automatic completion",async()=>{
  const f=fixture();await f.review("a");
  assert.equal(f.work().status,"review");assert.equal(f.rows.collaborationReviews.length,1);
  const {candidates}=await eligibleWork(f.ctx,"chat" as Id<"chats">);
  assert.deepEqual(candidates[0].pendingReviewerIds,["b"]);
  assert.equal(selectedWork(candidates,{participantId:"a" as Id<"chatParticipants">,workId:f.work()._id,reasonCode:"review_work",replyToMessageIds:[]}),undefined);
  const next=await invoke<{selections:Array<{participantId:string}>}>(selectWorkSpeakers,f.ctx,{
    exchangeId:"exchange",execution:{runId:"run-team",attemptId:"attempt-team",fence:1,claimantId:"team"},
  });
  assert.deepEqual(next.selections.map(row=>row.participantId),["b"]);
  await f.review("b");
  assert.equal(f.work().status,"done");assert.equal(f.rows.collaborationReviews.length,2);
  assert.equal((await eligibleWork(f.ctx,"chat" as Id<"chats">)).candidates.length,0);
});

test("acceptances are scoped to requirement, evidence and source revisions",async()=>{
  for(const patch of [{requirementRevision:2},{evidenceRevision:2},{sourceRevision:"v2"}]) {
    const f=fixture();await f.review("a");
    await f.ctx.db.patch(f.work()._id,patch);
    assert.deepEqual(await pendingWorkReviewerIds(f.ctx,f.work()),["a","b"]);
  }
});

test("rework reopens the goal and explicit human decisions retain their existing completion behavior",async()=>{
  const f=fixture();await f.review("a");await f.review("b","rework");
  assert.equal(f.work().status,"open");assert.equal(f.work().blocker,"b rework");
  for(const outcome of ["override","accept"] as const) {
    const g=fixture();await g.review("a");
    await commitWorkReview(g.ctx,g.work(),{outcome,author:"owner",reason:"Human decision",
      requirementRevision:1,evidenceRevision:1,sourceRevision:"v1"});
    assert.equal(g.work().status,"done");
  }
});
