import assert from "node:assert/strict";
import test from "node:test";
import type { Doc, Id } from "../_generated/dataModel";
import type { ContextMessage } from "../chat/helpers_types";
import { runtimeHostSchemaTables } from "../schema_tables_runtime_host";
import { reconcileGenerationWorkflowCompletionHandler } from "../chat/workflow_completion";
import { prepareRequestContextForGeneration } from "../chat/actions_context_assembly_integration";
import { buildRequestMessages } from "../chat/helpers";
import { plan, compactChunkHandler } from "../chat/conversation_context_actions";
import * as mutations from "../chat/conversation_context_mutations";
import { loadConversationMessages, validSummary } from "../chat/conversation_context_loading";
import { contextPrefixPlan, eligibleConversationMessages, summaryChunks } from "../chat/conversation_context_policy";
import { contextFixture, invoke } from "./conversation_context_fixture";
import type { MutationCtx } from "../_generated/server";
import { resolveParentMessageIdsForSend } from "../chat/mutation_send_helpers";

const jobId = "job-1" as Id<"generationJobs">;
const deps = {apiKey: async () => "test-key", summarize: async (_key: string, _model: string, messages: {content: unknown}[]) => ({content: `Summary of ${String(messages[1].content).slice(-180)}`, usage: null, generationId: "test-generation", finishReason: "stop", annotations: [], audioBase64: "", audioTranscript: ""})};

test("paged history contains more than 5000 messages and compaction protects every uncovered tail message", async () => {
  const fixture = await contextFixture(5002);
  const messages = await loadConversationMessages(fixture.action, "chat-1" as Id<"chats">, "user_1");
  assert.equal(messages.length, 5003);
  assert.equal(messages.at(-2)?._id, "source-5001");
  const eligible = eligibleConversationMessages(messages as unknown as ContextMessage[], "message-1");
  const target = contextPrefixPlan(eligible, 0, 8000);
  assert.ok(target > 4900 && target <= 4990);
  const chunks = summaryChunks(eligible.slice(0, target));
  assert.ok(chunks.every(chunk => chunk.content.length <= 24000 && chunk.messageIds.length <= 128));
  assert.match(chunks[0].content, /sentinel-0/);
  assert.match(chunks.at(-1)!.content, new RegExp(`sentinel-${target-1}`));
  assert.equal(eligible.slice(target).at(-1)?._id, "source-5001");
});

test("terminal failed/cancelled ancestors compact without restoring their payloads or losing later context", async () => {
  const {ctx,rows,action} = await contextFixture(180);
  for (const [index,status] of [[1,"failed"],[3,"cancelled"]] as const) {
    Object.assign(rows.messages[index], {status, content:`OMITTED-${status}`,
      toolCalls:[{id:`abandoned-${status}`,name:"unfinished",arguments:"{}"}]});
    assert.deepEqual(await resolveParentMessageIdsForSend(ctx, {chatId:"chat-1" as Id<"chats">,
      activeBranchLeafId:`source-${index}` as Id<"messages">,expandMultiModelGroups:true}), [`source-${index}`]);
  }
  const sources: string[] = [];
  const summarizer = {...deps,summarize:async (...args:Parameters<typeof deps.summarize>) => {
    sources.push(String(args[2][1].content));return deps.summarize(...args);
  }};
  const operationId=await invoke<Id<"conversationCompactions">>(plan,action as unknown as MutationCtx,{jobId,expand:true});
  while(await compactChunkHandler(action,{operationId},summarizer)!==true) { /* bounded staged chunks */ }
  const head=rows.conversationSummaries[0] as unknown as Doc<"conversationSummaries">;
  assert.ok(head.coverageCount>3);
  assert.doesNotMatch(sources.join("\n"),/OMITTED-|abandoned-/);
  assert.match(sources.join("\n"),/source-1: failed; content omitted/);
  const messages=rows.messages as unknown as ContextMessage[];
  assert.ok(await validSummary(action,head,eligibleConversationMessages(messages,"message-1")));
  const prepared=await prepareRequestContextForGeneration({ctx:action,chatId:"chat-1" as Id<"chats">,userId:"user_1",
    assistantMessageId:"message-1" as Id<"messages">,jobId,participantId:"participant-1",allMessages:messages,
    legacyMessages:buildRequestMessages({messages,excludeMessageId:"message-1" as Id<"messages">})});
  assert.match(JSON.stringify(prepared.providerMessages),/sentinel-179/);
  assert.doesNotMatch(JSON.stringify(prepared.providerMessages),/OMITTED-|abandoned-/);
  rows.generationJobs[0].conversationContextPrepared=false;
  assert.equal(await invoke(plan,action as unknown as MutationCtx,{jobId,expand:true}),null);
  assert.equal(rows.conversationSummaries.length,1);
});

test("pending messages and unresolved live tool calls remain outside compactable coverage", async () => {
  for(const status of ["pending","streaming","completed"]) {
    const {rows}=await contextFixture(180);
    Object.assign(rows.messages[1],{status,...(status==="completed" ? {
      toolCalls:[{id:"active-call",name:"running",arguments:"{}"}],
    } : {})});
    const messages=eligibleConversationMessages(rows.messages as unknown as ContextMessage[],"message-1");
    assert.equal(contextPrefixPlan(messages,0,8000),1);
    assert.throws(()=>contextPrefixPlan(messages,1,8000,"Prior summary"),/protected conversation context is too large/);
  }
});

test("two committed boundaries reuse summaries below threshold and summarise only newly covered sources", async () => {
  const {rows, action} = await contextFixture();
  let calls = 0; const inputs: string[] = [];
  const summarizer = {...deps, summarize: async (...args: Parameters<typeof deps.summarize>) => {calls++; inputs.push(String(args[2][1].content)); return deps.summarize(...args);}};
  const run = async () => {
    const operationId = await invoke<Id<"conversationCompactions"> | null>(plan, action as unknown as MutationCtx, {jobId, expand: true});
    if (operationId) while (await compactChunkHandler(action, {operationId}, summarizer) !== true) { /* actual staged owner */ }
    return rows.conversationSummaries?.at(-1) as unknown as Doc<"conversationSummaries">;
  };
  const first = await run();
  assert.ok(first.coverageCount > 0); assert.equal(calls, 1);
  assert.match(inputs[0], /sentinel-0/);
  const before = calls;
  rows.generationJobs[0].conversationContextPrepared = false;
  await run(); assert.equal(calls, before); assert.equal(rows.conversationSummaries.length, 1);
  // A new logical turn with a larger tail crosses the next boundary.
  const last = rows.messages.pop()!;
  for (let index=40;index<80;index++) rows.messages.push({_id: `source-${index}`, chatId: "chat-1", userId: "user_1", role: "user", content: `second-${index} ${"data ".repeat(100)}`, status: "completed", parentMessageIds: [`source-${index-1}`], createdAt: index+1});
  last.parentMessageIds = ["source-79"]; rows.messages.push(last);
  rows.generationJobs[0].conversationContextPrepared = false;
  // Each logical job owns one operation; reuse a new job/run for the next turn.
  rows.generationJobs[0]._id = "job-2"; rows.executionRuns[0].generationJobId = "job-2";
  const secondOp = await invoke<Id<"conversationCompactions">>(plan, action as unknown as MutationCtx, {jobId: "job-2", expand:true});
  while (await compactChunkHandler(action,{operationId:secondOp},summarizer)!==true) { /* bounded chunks */ }
  const second = rows.conversationSummaries.at(-1) as unknown as Doc<"conversationSummaries">;
  assert.equal(second.previousId, first._id); assert.ok(second.coverageCount > first.coverageCount);
  assert.match(inputs[1], /Prior committed\/staged summary:\nSummary/);
  assert.doesNotMatch(inputs[1].split("New complete source chunk:\n")[1], /sentinel-0\b/);
  assert.ok(await validSummary(action,second,eligibleConversationMessages(rows.messages as unknown as ContextMessage[],"message-1")));
  rows.messages[0].content = "edited early instruction";
  assert.equal(await validSummary(action,second,eligibleConversationMessages(rows.messages as unknown as ContextMessage[],"message-1")), null);
  assert.equal(await validSummary(action,second,(rows.messages as unknown as ContextMessage[]).slice(1)), null);
});

test("empty/failed summarisation, stale source revision and cancellation never publish or advance coverage", async () => {
  for (const failure of ["empty", "provider", "edit", "cancel"]) {
    const {ctx,rows,action} = await contextFixture();
    const operationId = await invoke<Id<"conversationCompactions">>(plan, action as unknown as MutationCtx, {jobId,expand:true});
    if (failure === "edit") rows.chats[0].conversationSourceRevision=1;
    if (failure === "cancel") rows.executionRuns[0].state="cancelled";
    const failing = {...deps, summarize: async (...args: Parameters<typeof deps.summarize>) => {
      if (failure === "provider") throw new Error("provider unavailable");
      if (failure === "empty") return {...await deps.summarize(...args), content: ""};
      return deps.summarize(...args);
    }};
    await assert.rejects(compactChunkHandler(action,{operationId},failing));
    assert.equal(rows.conversationSummaries?.length ?? 0,0);
    assert.equal(rows.conversationCompactions[0].nextChunk,0);
    assert.equal(rows.generationJobs[0].conversationContextPrepared,undefined);
    if (failure !== "cancel") await assert.rejects(invoke(mutations.publish,ctx,{operationId,modelId:"test"}),/COMPACTION_NOT_PUBLISHABLE/);
  }
});

test("large individual source chunks retain content beyond the old 8000 character limit", () => {
  const message = {_id:"source",role:"user",content:"a".repeat(50000)+"END-SENTINEL",status:"completed",createdAt:1,parentMessageIds:[]} as unknown as ContextMessage;
  const chunks=summaryChunks([message]);
  assert.equal(chunks.length,3);assert.match(chunks.at(-1)!.content,/END-SENTINEL/);
});

test("prepared native and cloud contexts contain the committed summary and complete uncovered tail", async () => {
  const {rows, action} = await contextFixture();
  const operationId = await invoke<Id<"conversationCompactions">>(plan, action as unknown as MutationCtx, {jobId, expand:true});
  while (await compactChunkHandler(action, {operationId}, deps) !== true) { /* commit */ }
  const head = rows.conversationSummaries[0] as unknown as Doc<"conversationSummaries">;
  const messages = rows.messages as unknown as ContextMessage[];
  for (const preserveMessageBoundaries of [false, true]) {
    const prepared = await prepareRequestContextForGeneration({ctx:action,chatId:"chat-1" as Id<"chats">,userId:"user_1",
      assistantMessageId:"message-1" as Id<"messages">,jobId,participantId:"participant-1",allMessages:messages,
      preserveMessageBoundaries,legacyMessages:buildRequestMessages({messages,excludeMessageId:"message-1" as Id<"messages">})});
    const serialized=JSON.stringify(prepared.providerMessages);
    assert.match(serialized,/Committed conversation summary/);assert.match(serialized,/sentinel-39/);
    assert.doesNotMatch(serialized,/sentinel-0\b/);
    assert.ok(prepared.context.policyVersion.includes(String(head._id)));
    for (let index=head.coverageCount;index<40;index++) assert.ok(serialized.includes(`sentinel-${index}`));
    assert.ok(!(prepared.evidenceSources ?? []).some(source=>source.id === "message:source-0"));
  }
});

test("native compaction starts an owned local helper without requesting a cloud key", async () => {
  const {rows,action} = await contextFixture();
  const operationId=await invoke<Id<"conversationCompactions">>(plan,action as unknown as MutationCtx,{jobId,expand:true});
  rows.executionAttempts[0].placement="local";
  rows.executionAttempts[0].modelId="gpt-6.1-sol";
  rows.personas=[{_id:"persona-1",userId:"user_1",displayName:"Native",systemPrompt:"Be useful"}];
  rows.personaRuntimeBindings=[{_id:"route",userId:"user_1",personaId:"persona-1",deviceId:"device-1",adapterId:"codex",status:"active",routeHash:"test",modelId:"gpt-6-luna",provider:"openai",modelSelectionMode:"explicit"}];
  const result=await compactChunkHandler(action,{operationId},{...deps,apiKey:async()=>{throw new Error("Cloud key must not be requested");}});
  assert.equal(typeof result,"object");
  const task=rows.runtimeHelperTasks[0];assert.equal(task.purpose,"compaction");
  const validator = runtimeHostSchemaTables.runtimeHelperTasks.validator as unknown as {json: {value: Record<string, unknown>}};
  const allowed = new Set(["_id", "_creationTime", ...Object.keys(validator.json.value)]);
  assert.deepEqual(Object.keys(task).filter(key => !allowed.has(key)), [], "local helper write must satisfy the real persisted schema");
  const run=rows.executionRuns.find(run=>run._id===task.runId);assert.equal(run?.parentRunId,"run-1");
  assert.equal(rows.conversationCompactionChunks[0].status,"calling");
  const operation=rows.conversationCompactions.find(item=>item._id===operationId)!;
  operation.nextChunk=operation.chunks;operation.text="Native summary preserves the corrected budget";
  assert.equal(await compactChunkHandler(action,{operationId},deps),true);
  assert.equal(rows.conversationSummaries[0].modelId,"gpt-6.1-sol","native summary provenance must identify the selected native model");
});

test("preparation failure terminates the canonical turn instead of starting automatic recovery repeatedly", async () => {
  const {ctx,rows} = await contextFixture();
  rows.generationJobs[0].conversationContextPreparing=true;
  rows.executionComponentRefs=[{_id:"driver",runId:"run-1",attemptId:"attempt-1",adapterId:"convex-workflow",operationId:"workflow",status:"active"}];
  let failed=0;let interrupted=0;
  await reconcileGenerationWorkflowCompletionHandler(ctx, {workflowId:"workflow",result:{kind:"failed",error:"compaction provider unavailable"},
    context:{participantArgs:{chatId:"chat-1",userMessageId:"source-39",assistantMessageIds:["message-1"],generationJobIds:["job-1"],participant:{jobId:"job-1",messageId:"message-1",modelId:"test"},userId:"user_1"} as never}}, {
    startWorkflow:async()=>{throw new Error("A failed summariser must not be repeatedly dispatched");},
    interruptAttempt:async()=>{interrupted++;return {changed:true,outcome:"failed"} as never;},
    failGeneration:async(_ctx,_args,summary)=>{assert.match(summary,/previous summary and raw history are retained/);failed++;},
  });
  assert.equal(failed,1);assert.equal(interrupted,1);
});
