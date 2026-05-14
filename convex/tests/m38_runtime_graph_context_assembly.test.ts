import assert from "node:assert/strict";
import test from "node:test";

import { assembleRequestContextForGeneration } from "../chat/actions_context_assembly_integration";
import { assembleContext, type AssemblyMemoryCandidate } from "../chat/context_assembler";
import { judgeAssemblyScenario } from "../chat/context_assembly_judgement";
import { resolveMemoryProvenance } from "../chat/provenance_repair";
import {
  insertToolArtifacts,
  listArtifactsForAssembly,
  listSubagentRuntimeRefsForResume,
  listToolMemoriesForAssembly,
  resolveToolMemoryProvenanceForAssembly,
} from "../tools/artifacts";
import {
  canRuntimeOwnerSee,
  estimatePromptTokens,
  resolveAssemblyPolicy,
} from "../chat/runtime_graph";
import { extractToolMemoryDrafts } from "../tools/tool_memory_extractor";

test("resolved assembly policy is versioned, immutable, and deterministic", () => {
  const subject = {
    chatId: "chat_1",
    messageId: "msg_1",
    jobId: "job_1",
    userId: "user_1",
    participantId: "p1",
    providerContextWindowTokens: 128000.0,
  } as any;
  const a = resolveAssemblyPolicy(subject);
  const b = resolveAssemblyPolicy(subject);
  assert.deepEqual(a, b);
  assert.equal(a.policyVersion, "m38.policy.v1");
  assert.equal(Object.isFrozen(a), true);
  (a as any).policyVersion = "changed";
  assert.equal(a.policyVersion, "m38.policy.v1");
});

test("ownership policy blocks sibling participant leakage unless explicitly shared", () => {
  assert.equal(canRuntimeOwnerSee("p1", {
    visibilityScope: "participant",
    ownerParticipantId: "p1",
  }), true);
  assert.equal(canRuntimeOwnerSee("p2", {
    visibilityScope: "participant",
    ownerParticipantId: "p1",
  }), false);
  assert.equal(canRuntimeOwnerSee("p2", {
    visibilityScope: "shared_participants",
    ownerParticipantId: "p1",
    sharedWithParticipants: ["p2"],
  }), true);
  assert.equal(canRuntimeOwnerSee("p1", { visibilityScope: "audit_only" }), false);
});

test("context assembly injects selected tool memories and protects unresolved raw artifacts", () => {
  const assembled = assembleContext({
    chatId: "chat_1" as any,
    messageId: "msg_assistant" as any,
    jobId: "job_1" as any,
    userId: "user_1",
    participantId: "p1",
    legacyMessages: [{ role: "user", content: "continue" }],
    toolMemories: [{
      _id: "mem_1" as any,
      summary: "Tool result from read_document: important quote",
      contextClass: "epistemic",
      promotionPolicy: "durable",
      visibilityScope: "participant",
      ownerParticipantId: "p1",
      privacyClassification: "normal",
      freshnessClass: "durable",
      confidence: 0.9,
      confidenceSource: "tool",
      sourceArtifactIds: ["artifact_1" as any],
    }],
    rawArtifacts: [{
      _id: "artifact_2" as any,
      toolCallId: "call_pending",
      toolName: "drive_picker",
      status: "deferred",
      resultRaw: "{\"requiresDrivePicker\":true}",
      resultBytes: 28.0,
      visibilityScope: "participant",
      ownerParticipantId: "p1",
      privacyClassification: "normal",
    }],
  });

  assert.equal(assembled.memoryRefs[0], "mem_1");
  assert.ok(assembled.artifactRefs.includes("artifact_2" as any));
  assert.match(JSON.stringify(assembled.messages), /call_pending/);
  assert.equal(assembled.exclusionSummary.excludedByOwnership, 0);
});

test("context assembly omits google data memories and raw artifacts by default", () => {
  const assembled = assembleContext({
    chatId: "chat_1" as any,
    messageId: "msg_assistant" as any,
    jobId: "job_1" as any,
    userId: "user_1",
    participantId: "p1",
    legacyMessages: [{ role: "user", content: "continue" }],
    toolMemories: [{
      _id: "mem_google" as any,
      summary: "Gmail thread says launch is Friday",
      contextClass: "epistemic",
      promotionPolicy: "durable",
      visibilityScope: "participant",
      ownerParticipantId: "p1",
      privacyClassification: "google_data",
      freshnessClass: "bounded",
      sourceArtifactIds: [],
    }],
    rawArtifacts: [{
      _id: "artifact_google" as any,
      toolCallId: "call_gmail",
      toolName: "gmail_search",
      status: "completed",
      resultRaw: "Sensitive Gmail body",
      resultBytes: 20.0,
      visibilityScope: "participant",
      ownerParticipantId: "p1",
      privacyClassification: "google_data",
    }],
    exactRehydrationRequested: true,
  });

  const serialized = JSON.stringify(assembled.messages);
  assert.doesNotMatch(serialized, /Gmail thread/);
  assert.doesNotMatch(serialized, /Sensitive Gmail body/);
  assert.equal(assembled.exclusionSummary.excludedByPrivacy, 2);
});

test("context assembly renders persisted provenance resolution status for selected memories", () => {
  const assembled = assembleContext({
    chatId: "chat_1" as any,
    messageId: "msg_assistant" as any,
    jobId: "job_1" as any,
    userId: "user_1",
    participantId: "p1",
    legacyMessages: [{ role: "user", content: "continue" }],
    toolMemories: [{
      _id: "mem_1" as any,
      summary: "Board packet quote from the current appendix",
      contextClass: "epistemic",
      promotionPolicy: "durable",
      visibilityScope: "participant",
      ownerParticipantId: "p1",
      privacyClassification: "normal",
      freshnessClass: "durable",
      confidence: 0.9,
      confidenceSource: "tool",
      provenanceLocators: {
        documentId: "doc_deleted_1",
        contentHash: "sha256:boardpack888",
        sourceToolName: "read_document",
      },
      revalidationToolNames: ["read_document"],
      lastResolutionStatus: "missing",
      repairAttempts: 1.0,
      sourceArtifactIds: ["artifact_1" as any],
    }],
    rawArtifacts: [],
  });

  const serialized = JSON.stringify(assembled.messages);
  assert.match(serialized, /provenance=missing/);
  assert.match(serialized, /revalidate_with=read_document/);
  assert.match(serialized, /repair_attempts=1/);
  assert.doesNotMatch(serialized, /locator:sha256/);
});

test("stored raw artifacts are rehydrated only after assembly selects them", async () => {
  const mutations: Array<Record<string, unknown>> = [];
  let queryCallCount = 0;
  let storageReads = 0;
  const messages = await assembleRequestContextForGeneration({
    ctx: {
      runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
        queryCallCount += 1;
        if ("reachableMessageIds" in args) {
          assert.deepEqual(args.reachableMessageIds, ["msg_assistant", "msg_user"]);
        }
        if (queryCallCount === 1) return [];
        return [{
          _id: "artifact_csv_42",
          toolCallId: "call_csv",
          toolName: "read_text_file",
          status: "completed",
          resultStorageId: "storage_csv",
          resultBytes: 32.0,
          visibilityScope: "participant",
          ownerParticipantId: "p1",
          privacyClassification: "normal",
        }];
      },
      runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
        mutations.push(args);
        if (Array.isArray(args.memoryIds)) return [];
        return undefined;
      },
      storage: {
        get: async () => {
          storageReads += 1;
          return new Blob(["symbol,amount\nBETA,99.70"], { type: "text/csv" });
        },
      },
    } as any,
    chatId: "chat_1" as any,
    userId: "user_1",
    assistantMessageId: "msg_assistant" as any,
    jobId: "job_1" as any,
    participantId: "p1",
    legacyMessages: [{ role: "user", content: "Give me the exact previous CSV row" }],
    allMessages: [
      {
        _id: "msg_user" as any,
        chatId: "chat_1" as any,
        role: "user",
        content: "Give me the exact previous CSV row",
        parentMessageIds: [],
        status: "completed",
        createdAt: 1.0,
      },
      {
        _id: "msg_assistant" as any,
        chatId: "chat_1" as any,
        role: "assistant",
        content: "",
        parentMessageIds: ["msg_user" as any],
        status: "pending",
        createdAt: 2.0,
      },
    ],
  });

  assert.match(JSON.stringify(messages), /BETA,99\.70/);
  assert.equal(storageReads, 1);
  assert.equal(mutations.length, 1);
});

test("stored raw artifacts are not read on normal turns when exact detail is not requested", async () => {
  let storageReads = 0;
  let queryCallCount = 0;
  await assembleRequestContextForGeneration({
    ctx: {
      runQuery: async (_ref: unknown) => {
        queryCallCount += 1;
        if (queryCallCount === 1) return [];
        return [{
          _id: "artifact_csv_42",
          toolCallId: "call_csv",
          toolName: "read_text_file",
          status: "completed",
          storageId: "storage_csv",
          resultBytes: 32.0,
          visibilityScope: "participant",
          ownerParticipantId: "p1",
          privacyClassification: "normal",
        }];
      },
      runMutation: async (_ref: unknown, args: Record<string, unknown>) =>
        Array.isArray(args.memoryIds) ? [] : undefined,
      storage: {
        get: async () => {
          storageReads += 1;
          return new Blob(["symbol,amount\nBETA,99.70"], { type: "text/csv" });
        },
      },
    } as any,
    chatId: "chat_1" as any,
    userId: "user_1",
    assistantMessageId: "msg_assistant" as any,
    jobId: "job_1" as any,
    participantId: "p1",
    legacyMessages: [{ role: "user", content: "Summarize the previous result" }],
    allMessages: [
      {
        _id: "msg_user" as any,
        chatId: "chat_1" as any,
        role: "user",
        content: "Summarize the previous result",
        parentMessageIds: [],
        status: "completed",
        createdAt: 1.0,
      },
      {
        _id: "msg_assistant" as any,
        chatId: "chat_1" as any,
        role: "assistant",
        content: "",
        parentMessageIds: ["msg_user" as any],
        status: "pending",
        createdAt: 2.0,
      },
    ],
  });

  assert.equal(storageReads, 0);
});

test("provenance repair only mutates memories selected by assembly policy", async () => {
  const provenanceMutations: Array<Record<string, unknown>> = [];
  let queryCallCount = 0;
  await assembleRequestContextForGeneration({
    ctx: {
      runQuery: async () => {
        queryCallCount += 1;
        if (queryCallCount === 1) {
          return [{
            _id: "mem_visible",
            summary: "Visible document memory",
            contextClass: "epistemic",
            promotionPolicy: "durable",
            visibilityScope: "participant",
            ownerParticipantId: "p1",
            privacyClassification: "normal",
            freshnessClass: "durable",
            provenanceLocators: { documentId: "doc_1", sourceToolName: "read_document" },
            sourceArtifactIds: [],
          }, {
            _id: "mem_other_participant",
            summary: "Private sibling memory",
            contextClass: "epistemic",
            promotionPolicy: "durable",
            visibilityScope: "participant",
            ownerParticipantId: "p2",
            privacyClassification: "normal",
            freshnessClass: "durable",
            provenanceLocators: { documentId: "doc_2", sourceToolName: "read_document" },
            sourceArtifactIds: [],
          }];
        }
        return [];
      },
      runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
        if (Array.isArray(args.memoryIds)) {
          provenanceMutations.push(args);
          return [{ memoryId: "mem_visible", status: "valid", repairAttempts: 0.0 }];
        }
        return undefined;
      },
      storage: { get: async () => null },
    } as any,
    chatId: "chat_1" as any,
    userId: "user_1",
    assistantMessageId: "msg_assistant" as any,
    jobId: "job_1" as any,
    participantId: "p1",
    legacyMessages: [{ role: "user", content: "continue" }],
    allMessages: [
      {
        _id: "msg_user" as any,
        chatId: "chat_1" as any,
        role: "user",
        content: "continue",
        parentMessageIds: [],
        status: "completed",
        createdAt: 1.0,
      },
      {
        _id: "msg_assistant" as any,
        chatId: "chat_1" as any,
        role: "assistant",
        content: "",
        parentMessageIds: ["msg_user" as any],
        status: "pending",
        createdAt: 2.0,
      },
    ],
  });

  assert.deepEqual(provenanceMutations.map((call) => call.memoryIds), [["mem_visible"]]);
});

test("oversized unresolved recovery artifacts remain visible as status stubs", () => {
  const assembled = assembleContext({
    chatId: "chat_1" as any,
    messageId: "msg_assistant" as any,
    jobId: "job_1" as any,
    userId: "user_1",
    participantId: "p1",
    legacyMessages: [{ role: "user", content: "continue" }],
    toolMemories: [],
    rawArtifacts: [{
      _id: "artifact_large_pending" as any,
      toolCallId: "call_large_pending",
      toolName: "drive_picker",
      status: "deferred",
      resultStorageId: "storage_large" as any,
      resultBytes: 500_000.0,
      visibilityScope: "participant",
      ownerParticipantId: "p1",
      privacyClassification: "normal",
    }],
  });

  const serialized = JSON.stringify(assembled.messages);
  assert.match(serialized, /call_large_pending/);
  assert.match(serialized, /raw payload omitted by assembly byte budget/);
  assert.ok(assembled.artifactRefs.includes("artifact_large_pending" as any));
  assert.equal(assembled.rehydrationDirectives.length, 0);
  assert.equal(assembled.exclusionSummary.excludedByBudget, 1);
});

test("cumulative over-budget inline unresolved artifacts serialize compact stubs", () => {
  const firstPayload = `FIRST-${"a".repeat(60_000)}`;
  const secondPayload = `SECOND-${"b".repeat(60_000)}`;
  const assembled = assembleContext({
    chatId: "chat_1" as any,
    messageId: "msg_assistant" as any,
    jobId: "job_1" as any,
    userId: "user_1",
    participantId: "p1",
    legacyMessages: [{ role: "user", content: "continue" }],
    toolMemories: [],
    rawArtifacts: [{
      _id: "artifact_inline_1" as any,
      toolCallId: "call_inline_1",
      toolName: "drive_picker",
      status: "deferred",
      resultRaw: firstPayload,
      resultBytes: firstPayload.length,
      visibilityScope: "participant",
      ownerParticipantId: "p1",
      privacyClassification: "normal",
    }, {
      _id: "artifact_inline_2" as any,
      toolCallId: "call_inline_2",
      toolName: "drive_picker",
      status: "deferred",
      resultRaw: secondPayload,
      resultBytes: secondPayload.length,
      visibilityScope: "participant",
      ownerParticipantId: "p1",
      privacyClassification: "normal",
    }],
  });

  const serialized = JSON.stringify(assembled.messages);
  assert.match(serialized, /call_inline_1/);
  assert.match(serialized, /FIRST-/);
  assert.match(serialized, /call_inline_2/);
  assert.match(serialized, /raw payload omitted by assembly byte budget artifact_id=artifact_inline_2/);
  assert.doesNotMatch(serialized, /SECOND-/);
  assert.equal(assembled.exclusionSummary.excludedByBudget, 1);
  assert.deepEqual(assembled.rehydrationDirectives.map((directive) => directive.artifactId), ["artifact_inline_1"]);
});

test("assembly queries are constrained to the active branch lineage", async () => {
  const seenReachable: unknown[] = [];
  await assembleRequestContextForGeneration({
    ctx: {
      runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
        seenReachable.push(args.reachableMessageIds);
        return [];
      },
      runMutation: async () => undefined,
      storage: { get: async () => null },
    } as any,
    chatId: "chat_1" as any,
    userId: "user_1",
    assistantMessageId: "assistant_active" as any,
    jobId: "job_1" as any,
    participantId: "p1",
    legacyMessages: [{ role: "user", content: "continue active branch" }],
    allMessages: [
      {
        _id: "root" as any,
        chatId: "chat_1" as any,
        role: "user",
        content: "root",
        parentMessageIds: [],
        status: "completed",
        createdAt: 1.0,
      },
      {
        _id: "sibling_tool_owner" as any,
        chatId: "chat_1" as any,
        role: "assistant",
        content: "sibling",
        parentMessageIds: ["root" as any],
        status: "completed",
        createdAt: 2.0,
      },
      {
        _id: "active_user" as any,
        chatId: "chat_1" as any,
        role: "user",
        content: "active",
        parentMessageIds: ["root" as any],
        status: "completed",
        createdAt: 3.0,
      },
      {
        _id: "assistant_active" as any,
        chatId: "chat_1" as any,
        role: "assistant",
        content: "",
        parentMessageIds: ["active_user" as any],
        status: "pending",
        createdAt: 4.0,
      },
    ],
  });

  assert.deepEqual(seenReachable[0], ["assistant_active", "active_user", "root"]);
  assert.deepEqual(seenReachable[1], ["assistant_active", "active_user", "root"]);
  assert.equal((seenReachable[0] as string[]).includes("sibling_tool_owner"), false);
});

test("artifact assembly queries apply branch filtering before limiting candidates", async () => {
  function queryRows(rows: any[]) {
    return {
      withIndex: (_name: string, builder: (q: { eq: (_field: string, value: string) => string }) => string) => {
        const selectedId = builder({ eq: (_field, value) => value });
        return {
          order: () => ({
            take: async () => selectedId === "chat_1"
              ? rows
              : rows.filter((row) => row.messageId === selectedId),
          }),
        };
      },
    };
  }
  const activeRows = Array.from({ length: 2 }, (_, index) => ({
    _id: `active_${index}`,
    userId: "user_1",
    chatId: "chat_1",
    messageId: "active_msg",
    createdAt: 10.0 + index,
  }));
  const siblingRows = Array.from({ length: 100 }, (_, index) => ({
    _id: `sibling_${index}`,
    userId: "user_1",
    chatId: "chat_1",
    messageId: "sibling_msg",
    createdAt: 1000.0 + index,
  }));
  const ctx = {
    db: {
      query: (table: string) => {
        assert.ok(table === "toolMemories" || table === "toolExecutionArtifacts");
        return queryRows([...activeRows, ...siblingRows]);
      },
    },
  };

  const memories = await (listToolMemoriesForAssembly as any)._handler(ctx, {
    chatId: "chat_1",
    userId: "user_1",
    reachableMessageIds: ["active_msg"],
    limit: 80,
  });
  const artifacts = await (listArtifactsForAssembly as any)._handler(ctx, {
    chatId: "chat_1",
    userId: "user_1",
    reachableMessageIds: ["active_msg"],
    limit: 80,
  });

  assert.deepEqual(memories.rows.map((row: any) => row._id), ["active_1", "active_0"]);
  assert.deepEqual(artifacts.rows.map((row: any) => row._id), ["active_1", "active_0"]);
  assert.equal(memories.branchExcludedCount, 100);
  assert.equal(artifacts.branchExcludedCount, 100);
});

test("assembly candidate queries avoid sibling branches instead of post-filtering them", async () => {
  const rows = [
    {
      _id: "active_1",
      userId: "user_1",
      chatId: "chat_1",
      messageId: "active_msg",
      visibilityScope: "participant",
      createdAt: 30.0,
    },
    {
      _id: "shared_1",
      userId: "user_1",
      chatId: "chat_1",
      messageId: "sibling_msg",
      visibilityScope: "conversation",
      createdAt: 20.0,
    },
    {
      _id: "sibling_private",
      userId: "user_1",
      chatId: "chat_1",
      messageId: "sibling_msg",
      visibilityScope: "participant",
      createdAt: 10.0,
    },
  ];
  const ctx = {
    db: {
      query: () => ({
        withIndex: (_name: string, builder: (q: { eq: (_field: string, value: string) => string }) => string) => {
          const selectedId = builder({ eq: (_field, value) => value });
          return {
            order: () => ({
              take: async () => selectedId === "chat_1"
                ? rows
                : rows.filter((row) => row.messageId === selectedId),
            }),
          };
        },
      }),
    },
  };

  const result = await (listToolMemoriesForAssembly as any)._handler(ctx, {
    chatId: "chat_1",
    userId: "user_1",
    reachableMessageIds: ["active_msg"],
    limit: 80,
  });

  assert.deepEqual(result.rows.map((row: any) => row._id), ["active_1", "shared_1"]);
  assert.equal(result.branchExcludedCount, 1);
});

test("assembly candidate queries cap per-message lineage lookups", async () => {
  let memoryLineageQueries = 0;
  let artifactLineageQueries = 0;
  const ctx = {
    db: {
      query: (table: string) => ({
        withIndex: (indexName: string, builder: (q: { eq: (_field: string, value: string) => string }) => string) => {
          builder({ eq: (_field, value) => value });
          if (indexName === "by_message" && table === "toolMemories") memoryLineageQueries += 1;
          if (indexName === "by_message" && table === "toolExecutionArtifacts") artifactLineageQueries += 1;
          return {
            order: () => ({
              take: async () => [],
            }),
          };
        },
      }),
    },
  };
  const reachableMessageIds = Array.from({ length: 150 }, (_, index) => `msg_${index}`);

  const memories = await (listToolMemoriesForAssembly as any)._handler(ctx, {
    chatId: "chat_1",
    userId: "user_1",
    reachableMessageIds,
    limit: 80,
  });
  const artifacts = await (listArtifactsForAssembly as any)._handler(ctx, {
    chatId: "chat_1",
    userId: "user_1",
    reachableMessageIds,
    limit: 80,
  });

  assert.equal(memoryLineageQueries, 64);
  assert.equal(artifactLineageQueries, 64);
  assert.equal(memories.branchExcludedCount, 0);
  assert.equal(artifacts.branchExcludedCount, 0);
  assert.equal(memories.lineageCappedMessageCount, 86);
  assert.equal(artifacts.lineageCappedMessageCount, 86);
});

test("assembly memory fallback can recover reachable rows beyond the lineage lookup cap", async () => {
  const reachableMessageIds = Array.from({ length: 70 }, (_, index) => `msg_${index}`);
  const rows = [
    {
      _id: "tail_reachable_memory",
      userId: "user_1",
      chatId: "chat_1",
      messageId: "msg_69",
      visibilityScope: "participant",
      createdAt: 100.0,
    },
    {
      _id: "sibling_private",
      userId: "user_1",
      chatId: "chat_1",
      messageId: "sibling_msg",
      visibilityScope: "participant",
      createdAt: 90.0,
    },
  ];
  const ctx = {
    db: {
      query: () => ({
        withIndex: (_name: string, builder: (q: { eq: (_field: string, value: string) => string }) => string) => {
          const selectedId = builder({ eq: (_field, value) => value });
          return {
            order: () => ({
              take: async () => selectedId === "chat_1"
                ? rows
                : rows.filter((row) => row.messageId === selectedId),
            }),
          };
        },
      }),
    },
  };

  const result = await (listToolMemoriesForAssembly as any)._handler(ctx, {
    chatId: "chat_1",
    userId: "user_1",
    reachableMessageIds,
    limit: 80,
  });

  assert.deepEqual(result.rows.map((row: any) => row._id), ["tail_reachable_memory"]);
  assert.equal(result.branchExcludedCount, 1);
  assert.equal(result.lineageCappedMessageCount, 6);
});

test("provenance resolution uses real document/version/storage lookups and persists status", async () => {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const rows: Record<string, any> = {
    mem_valid_doc: {
      _id: "mem_valid_doc",
      userId: "user_1",
      provenanceLocators: { documentId: "doc_1", sourceToolName: "read_document" },
      repairAttempts: 0,
    },
    mem_missing_hash: {
      _id: "mem_missing_hash",
      userId: "user_1",
      provenanceLocators: { contentHash: "sha256:missing", sourceToolName: "read_document" },
      repairAttempts: 0,
    },
    doc_1: { _id: "doc_1", userId: "user_1" },
  };
  const result = await (resolveToolMemoryProvenanceForAssembly as any)._handler({
    db: {
      get: async (id: string) => rows[id] ?? null,
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
      },
      query: () => ({
        withIndex: () => ({
          take: async () => [],
        }),
      }),
    },
    storage: { getUrl: async () => null },
  }, {
    userId: "user_1",
    memoryIds: ["mem_valid_doc", "mem_missing_hash"],
    maxRepairAttempts: 2,
  });

  assert.deepEqual(result.map((entry: any) => ({
    memoryId: entry.memoryId,
    status: entry.status,
    repairAttempts: entry.repairAttempts,
  })), [
    { memoryId: "mem_valid_doc", status: "valid", repairAttempts: 0 },
    { memoryId: "mem_missing_hash", status: "missing", repairAttempts: 1 },
  ]);
  assert.equal(patches.find((entry) => entry.id === "mem_valid_doc")?.patch.lastResolutionStatus, "valid");
  assert.equal(patches.find((entry) => entry.id === "mem_missing_hash")?.patch.lastResolutionStatus, "missing");
});

test("subagent parent resume refs include only promoted child artifacts and memories", async () => {
  const ctx = {
    db: {
      get: async (id: string) =>
        id === "batch_1" ? { _id: "batch_1", userId: "user_1", chatId: "chat_1" } : null,
      query: (table: string) => ({
        withIndex: () => ({
          order: () => ({
            take: async () => table === "toolExecutionArtifacts"
              ? [{
                _id: "artifact_private",
                userId: "user_1",
                chatId: "chat_1",
                subagentBatchId: "batch_1",
                promotionDecision: "child_private",
              }, {
                _id: "artifact_promoted",
                userId: "user_1",
                chatId: "chat_1",
                subagentBatchId: "batch_1",
                promotionDecision: "parent_resume",
              }]
              : [{
                _id: "memory_private",
                userId: "user_1",
                chatId: "chat_1",
                subagentBatchId: "batch_1",
                promotionDecision: "child_private",
              }, {
                _id: "memory_promoted",
                userId: "user_1",
                chatId: "chat_1",
                subagentBatchId: "batch_1",
                promotionDecision: "parent_visible",
              }],
          }),
        }),
      }),
    },
  };

  const result = await (listSubagentRuntimeRefsForResume as any)._handler(ctx, {
    userId: "user_1",
    batchId: "batch_1",
    limit: 200,
  });

  assert.deepEqual(result.artifactRefs, ["artifact_promoted"]);
  assert.deepEqual(result.memoryRefs, ["memory_promoted"]);
  assert.equal(result.childPrivateArtifactCount, 1);
  assert.equal(result.childPrivateMemoryCount, 1);
  assert.equal(result.promotedArtifactCount, 1);
  assert.equal(result.promotedMemoryCount, 1);
});

test("mixed-artifact memory extraction preserves source privacy classification", async () => {
  const insertedMemories: Array<Record<string, unknown>> = [];
  let artifactCounter = 0;
  await (insertToolArtifacts as any)._handler({
    db: {
      insert: async (table: string, value: Record<string, unknown>) => {
        if (table === "toolExecutionArtifacts") {
          artifactCounter += 1;
          return `artifact_${artifactCounter}`;
        }
        if (table === "toolMemories") {
          insertedMemories.push(value);
          return `memory_${insertedMemories.length}`;
        }
        throw new Error(`Unexpected table ${table}`);
      },
    },
  }, {
    artifacts: [{
      userId: "user_1",
      chatId: "chat_1",
      messageId: "msg_1",
      jobId: "job_1",
      visibilityScope: "participant",
      runtimeIsolationPolicy: "isolated",
      toolCallId: "call_normal",
      toolName: "read_document",
      round: 1.0,
      argumentsRaw: "{}",
      argumentsHash: "hash_args_1",
      argumentsBytes: 2.0,
      resultRaw: JSON.stringify({ documentId: "doc_1", quote: "normal" }),
      resultHash: "hash_result_1",
      resultBytes: 32.0,
      status: "completed",
      privacyClassification: "normal",
      contextClass: "operational",
    }, {
      userId: "user_1",
      chatId: "chat_1",
      messageId: "msg_1",
      jobId: "job_1",
      visibilityScope: "participant",
      runtimeIsolationPolicy: "isolated",
      toolCallId: "call_gmail",
      toolName: "gmail_fetch",
      round: 1.0,
      argumentsRaw: "{}",
      argumentsHash: "hash_args_2",
      argumentsBytes: 2.0,
      resultRaw: JSON.stringify({ externalId: "gmail_1", subject: "private" }),
      resultHash: "hash_result_2",
      resultBytes: 32.0,
      status: "completed",
      privacyClassification: "google_data",
      contextClass: "operational",
    }],
  });

  const googleMemory = insertedMemories.find((memory) =>
    (memory.sourceToolNames as string[] | undefined)?.includes("gmail_fetch")
  );
  assert.equal(googleMemory?.privacyClassification, "google_data");
  assert.deepEqual(googleMemory?.sourceArtifactIds, ["artifact_2"]);
  assert.deepEqual(googleMemory?.artifactIds, ["artifact_2"]);
});

test("context assembly records omission reasons for privacy, ownership, stale, superseded, and budget exclusions", () => {
  const memories: AssemblyMemoryCandidate[] = Array.from({ length: 87 }, (_, index) => ({
    _id: `mem_${index}` as any,
    summary: `memory ${index}`,
    contextClass: "epistemic",
    promotionPolicy: index === 0 ? "audit_only" : "durable",
    visibilityScope: index === 1 ? "participant" : "conversation",
    ownerParticipantId: index === 1 ? "other" : undefined,
    privacyClassification: index === 2 ? "oauth_data" : "normal",
    freshnessClass: index === 3 ? "bounded" : "durable",
    staleAfter: index === 3 ? 1.0 : undefined,
    requiresRevalidation: index === 3,
    supersededBy: index === 4 ? ["newer" as any] : undefined,
    sourceArtifactIds: [],
  }));
  const assembled = assembleContext({
    chatId: "chat_1" as any,
    messageId: "msg_1" as any,
    jobId: "job_1" as any,
    userId: "user_1",
    participantId: "p1",
    legacyMessages: [{ role: "user", content: "hi" }],
    toolMemories: memories,
    rawArtifacts: [],
    now: 2.0,
  });

  assert.equal(assembled.exclusionSummary.excludedByPolicy, 1);
  assert.equal(assembled.exclusionSummary.excludedByOwnership, 1);
  assert.equal(assembled.exclusionSummary.excludedByPrivacy, 1);
  assert.equal(assembled.exclusionSummary.excludedAsStale, 1);
  assert.equal(assembled.exclusionSummary.excludedAsSuperseded, 1);
  assert.equal(assembled.exclusionSummary.excludedByBudget, 3);
});

test("tool memory extraction separates promotion, confidence, freshness, and provenance", () => {
  const drafts = extractToolMemoryDrafts({
    now: 1000.0,
    artifacts: [{
      _id: "artifact_1" as any,
      toolName: "read_document",
      status: "completed",
      resultRaw: JSON.stringify({
        documentId: "doc_1",
        versionId: "ver_1",
        filename: "brief.docx",
        quote: "hello",
      }),
      resultBytes: 100.0,
      privacyClassification: "document_data",
      contextClass: "operational",
    }],
  });
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]?.promotionPolicy, "durable");
  assert.equal(drafts[0]?.confidenceSource, "tool");
  assert.equal(drafts[0]?.freshnessClass, "durable");
  assert.equal((drafts[0]?.provenanceLocators as any).documentId, "doc_1");
  assert.deepEqual(drafts[0]?.revalidationToolNames, ["read_document"]);
});

test("tool memory extraction does not promote transient or audit-only artifacts", () => {
  const drafts = extractToolMemoryDrafts({
    artifacts: [{
      _id: "artifact_1" as any,
      toolName: "bash_exec",
      status: "completed",
      resultRaw: "{\"stdout\":\"tmp\"}",
      privacyClassification: "oauth_data",
      contextClass: "operational",
    }],
  });
  assert.equal(drafts.length, 0);
});

test("broken provenance repair validates, repairs, bounds revalidation, and avoids fabricated IDs", () => {
  const direct = resolveMemoryProvenance({
    locators: { documentId: "doc_1", sourceToolName: "read_document" },
    policy: { allowToolRevalidation: true, allowedToolNames: ["read_document"], maxRepairAttempts: 2 },
    directLookup: (_kind, id) => id === "doc_1",
    localRepair: () => null,
  });
  assert.equal(direct.status, "valid");

  const repaired = resolveMemoryProvenance({
    locators: { filename: "brief.docx", sourceToolName: "read_document" },
    policy: { allowToolRevalidation: true, allowedToolNames: ["read_document"], maxRepairAttempts: 2 },
    directLookup: () => false,
    localRepair: () => "doc_2",
  });
  assert.equal(repaired.status, "repaired");
  assert.equal(repaired.repairedId, "doc_2");

  const revalidate = resolveMemoryProvenance({
    locators: { filename: "brief.docx", sourceToolName: "read_document" },
    repairAttempts: 1,
    policy: { allowToolRevalidation: true, allowedToolNames: ["read_document"], maxRepairAttempts: 2 },
    directLookup: () => false,
    localRepair: () => null,
  });
  assert.equal(revalidate.status, "missing");
  assert.deepEqual(revalidate.revalidationToolNames, ["read_document"]);

  const forbidden = resolveMemoryProvenance({
    locators: { filename: "brief.docx", sourceToolName: "read_document" },
    policy: { allowToolRevalidation: false, allowedToolNames: ["read_document"], maxRepairAttempts: 2 },
    directLookup: () => false,
    localRepair: () => null,
  });
  assert.equal(forbidden.status, "forbidden");
  assert.equal(forbidden.repairedId, undefined);
});

test("automated before/after judgement flags missing recovery state and token drift", () => {
  const pass = judgeAssemblyScenario({
    name: "deferred picker",
    legacyMessages: [{ role: "user", content: "x".repeat(400) }],
    assembledMessages: [{ role: "system", content: "call_drive stale" }],
    expectedUnresolvedToolCallIds: ["call_drive"],
    expectedTokenDeltaDirection: "lower",
  });
  assert.equal(pass.passed, true);

  const fail = judgeAssemblyScenario({
    name: "missing picker",
    legacyMessages: [{ role: "user", content: "short" }],
    assembledMessages: [{ role: "system", content: "summary" }],
    expectedUnresolvedToolCallIds: ["call_drive"],
  });
  assert.equal(fail.passed, false);
  assert.match(fail.rationale, /missing unresolved tool call/);
});

test("estimated token helper stays deterministic for audit comparisons", () => {
  assert.equal(estimatePromptTokens([{ content: "abcd" }, { content: "ef" }]), 2);
});
