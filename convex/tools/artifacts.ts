import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, query } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { requireAuth } from "../lib/auth";
import { extractToolMemoryDrafts, type PersistedArtifactRef } from "./tool_memory_extractor";

const MAX_ASSEMBLY_LINEAGE_LOOKUPS = 64;

const artifactInput = v.object({
  userId: v.string(),
  chatId: v.id("chats"),
  messageId: v.id("messages"),
  jobId: v.id("generationJobs"),
  branchRootMessageId: v.optional(v.id("messages")),
  sourceUserMessageId: v.optional(v.id("messages")),
  multiModelGroupId: v.optional(v.string()),
  runtimeKind: v.optional(v.union(
    v.literal("chat_generation"),
    v.literal("autonomous_discussion"),
    v.literal("subagent_child"),
    v.literal("subagent_parent_resume"),
    v.literal("scheduled_job"),
  )),
  subagentBatchId: v.optional(v.id("subagentBatches")),
  subagentRunId: v.optional(v.id("subagentRuns")),
  parentMessageId: v.optional(v.id("messages")),
  parentJobId: v.optional(v.id("generationJobs")),
  parentToolCallId: v.optional(v.string()),
  promotionDecision: v.optional(v.union(
    v.literal("child_private"),
    v.literal("parent_resume"),
    v.literal("parent_visible"),
    v.literal("audit_only"),
  )),
  visibilityScope: v.union(
    v.literal("participant"),
    v.literal("shared_participants"),
    v.literal("branch"),
    v.literal("conversation"),
    v.literal("audit_only"),
  ),
  ownerParticipantId: v.optional(v.string()),
  ownerModelRunId: v.optional(v.string()),
  sharedWithParticipants: v.optional(v.array(v.string())),
  runtimeIsolationPolicy: v.union(
    v.literal("isolated"),
    v.literal("shared_readonly"),
    v.literal("shared_mutable"),
    v.literal("audit_only"),
  ),
  toolCallId: v.string(),
  toolName: v.string(),
  round: v.number(),
  argumentsRaw: v.optional(v.string()),
  argumentsHash: v.string(),
  argumentsBytes: v.number(),
  resultRaw: v.optional(v.string()),
  resultHash: v.optional(v.string()),
  resultBytes: v.optional(v.number()),
  argumentsStorageId: v.optional(v.id("_storage")),
  resultStorageId: v.optional(v.id("_storage")),
  status: v.union(
    v.literal("pending"),
    v.literal("completed"),
    v.literal("failed"),
    v.literal("deferred"),
    v.literal("cancelled"),
  ),
  isError: v.optional(v.boolean()),
  errorCode: v.optional(v.string()),
  errorMessage: v.optional(v.string()),
  deferredKind: v.optional(v.union(
    v.literal("spawn_subagents"),
    v.literal("drive_picker"),
    v.literal("presentation_workflow"),
  )),
  provider: v.optional(v.string()),
  runtime: v.optional(v.string()),
  integrationId: v.optional(v.string()),
  skillIds: v.optional(v.array(v.id("skills"))),
  activeProfiles: v.optional(v.array(v.string())),
  privacyClassification: v.union(
    v.literal("normal"),
    v.literal("oauth_data"),
    v.literal("google_data"),
    v.literal("document_data"),
    v.literal("runtime_file_data"),
    v.literal("secret_adjacent"),
  ),
  contextClass: v.union(
    v.literal("operational"),
    v.literal("provenance"),
    v.literal("recovery"),
    v.literal("policy"),
  ),
});

export const insertToolArtifacts = internalMutation({
  args: { artifacts: v.array(artifactInput), extractMemories: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const inserted = [];
    for (const artifact of args.artifacts) {
      const now = Date.now();
      const id = await ctx.db.insert("toolExecutionArtifacts", {
        ...artifact,
        createdAt: now,
        updatedAt: now,
      });
      inserted.push({ _id: id, ...artifact });
    }

    if (args.extractMemories !== false) {
      const memoryArtifacts: PersistedArtifactRef[] = inserted.map((artifact) => ({
        _id: artifact._id,
        toolName: artifact.toolName,
        status: artifact.status,
        resultRaw: artifact.resultRaw,
        resultBytes: artifact.resultBytes,
        storageId: artifact.resultStorageId,
        isError: artifact.isError,
        privacyClassification: artifact.privacyClassification,
        contextClass: artifact.contextClass,
      }));
      const drafts = extractToolMemoryDrafts({ artifacts: memoryArtifacts });
      for (const draft of drafts) {
        const sourceIds = draft.sourceArtifactIds?.length
          ? draft.sourceArtifactIds
          : inserted.map((artifact) => artifact._id);
        const sourceIdSet = new Set(sourceIds.map((id) => String(id)));
        const sourceArtifacts = inserted.filter((artifact) => sourceIdSet.has(String(artifact._id)));
        const first = sourceArtifacts[0] ?? inserted[0];
        if (!first) continue;
        const now = Date.now();
        await ctx.db.insert("toolMemories", {
          userId: first.userId,
          chatId: first.chatId,
          messageId: first.messageId,
          branchScope: "message",
          runtimeKind: first.runtimeKind,
          subagentBatchId: first.subagentBatchId,
          subagentRunId: first.subagentRunId,
          parentMessageId: first.parentMessageId,
          parentJobId: first.parentJobId,
          parentToolCallId: first.parentToolCallId,
          promotionDecision: first.promotionDecision,
          visibilityScope: first.visibilityScope,
          ownerParticipantId: first.ownerParticipantId,
          ownerModelRunId: first.ownerModelRunId,
          sharedWithParticipants: first.sharedWithParticipants,
          runtimeIsolationPolicy: first.runtimeIsolationPolicy,
          kind: draft.kind,
          contextClass: draft.contextClass,
          promotionPolicy: draft.promotionPolicy,
          summary: draft.summary,
          structuredPayload: draft.structuredPayload,
          artifactIds: sourceIds,
          sourceArtifactIds: sourceIds,
          sourceToolNames: draft.sourceToolNames,
          confidence: draft.confidence,
          confidenceSource: draft.confidenceSource,
          confidenceRationale: draft.confidenceRationale,
          ambiguities: draft.ambiguities,
          limitations: draft.limitations,
          privacyClassification: draft.privacyClassification,
          freshnessClass: draft.freshnessClass,
          observedAt: now,
          staleAfter: draft.staleAfter,
          confidenceDecayCurve: "none",
          requiresRevalidation: draft.requiresRevalidation,
          provenanceLocators: draft.provenanceLocators,
          revalidationToolNames: draft.revalidationToolNames,
          expiresAt: draft.expiresAt,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    return inserted.map((artifact) => artifact._id);
  },
});

export const recordMemoryResolution = internalMutation({
  args: {
    memoryId: v.id("toolMemories"),
    status: v.union(
      v.literal("valid"),
      v.literal("missing"),
      v.literal("repaired"),
      v.literal("unavailable"),
      v.literal("forbidden"),
    ),
    incrementRepairAttempts: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const memory = await ctx.db.get(args.memoryId);
    if (!memory) return;
    await ctx.db.patch(args.memoryId, {
      lastResolvedAt: Date.now(),
      lastResolutionStatus: args.status,
      repairAttempts: (memory.repairAttempts ?? 0) + (args.incrementRepairAttempts ? 1 : 0),
      updatedAt: Date.now(),
    });
  },
});

export const listForMessage = query({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const message = await ctx.db.get(args.messageId);
    if (!message || message.userId !== userId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Message not found" });
    }
    return await ctx.db
      .query("toolExecutionArtifacts")
      .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
      .collect();
  },
});

export const getArtifactRaw = query({
  args: { artifactId: v.id("toolExecutionArtifacts") },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const artifact = await ctx.db.get(args.artifactId);
    if (!artifact || artifact.userId !== userId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Artifact not found" });
    }
    return artifact;
  },
});

export const listToolMemoriesForAssembly = internalQuery({
  args: {
    chatId: v.id("chats"),
    userId: v.string(),
    reachableMessageIds: v.optional(v.array(v.id("messages"))),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const reachable = args.reachableMessageIds
      ? new Set(args.reachableMessageIds)
      : null;
    const limit = args.limit ?? 80;
    if (reachable && args.reachableMessageIds && args.reachableMessageIds.length > 0) {
      const lineageMessageIds = args.reachableMessageIds.slice(0, MAX_ASSEMBLY_LINEAGE_LOOKUPS);
      const lineageCappedMessageCount = Math.max(0, args.reachableMessageIds.length - lineageMessageIds.length);
      let branchExcludedCount = 0;
      const lineageRows = (await Promise.all(lineageMessageIds.map(async (messageId) =>
        await ctx.db
          .query("toolMemories")
          .withIndex("by_message", (q) => q.eq("messageId", messageId))
          .order("desc")
          .take(limit)
      ))).flat()
        .filter((row) => row.userId === args.userId && row.chatId === args.chatId)
        .sort((a, b) => b.createdAt - a.createdAt);
      const selected = lineageRows.slice(0, limit);
      if (selected.length < limit) {
        const selectedIds = new Set(selected.map((row) => String(row._id)));
        const sharedRows = await ctx.db
          .query("toolMemories")
          .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
          .order("desc")
          .take(Math.max((limit - selected.length) * 3, 40));
        for (const row of sharedRows) {
          if (selected.length >= limit) break;
          if (row.userId !== args.userId || selectedIds.has(String(row._id))) continue;
          if (reachable.has(row.messageId)) {
            selected.push(row);
            selectedIds.add(String(row._id));
            continue;
          }
          if (row.visibilityScope === "conversation" || row.visibilityScope === "shared_participants") {
            selected.push(row);
            selectedIds.add(String(row._id));
            continue;
          }
          branchExcludedCount += 1;
        }
      }
      return {
        rows: selected,
        branchExcludedCount,
        lineageCappedMessageCount,
      };
    }
    const rows = await ctx.db
      .query("toolMemories")
      .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
      .order("desc")
      .take(limit);
    return {
      rows: rows.filter((row) => row.userId === args.userId),
      branchExcludedCount: 0,
      lineageCappedMessageCount: 0,
    };
  },
});

export const listArtifactsForAssembly = internalQuery({
  args: {
    chatId: v.id("chats"),
    userId: v.string(),
    reachableMessageIds: v.optional(v.array(v.id("messages"))),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const reachable = args.reachableMessageIds
      ? new Set(args.reachableMessageIds)
      : null;
    const limit = args.limit ?? 80;
    if (reachable && args.reachableMessageIds && args.reachableMessageIds.length > 0) {
      const lineageMessageIds = args.reachableMessageIds.slice(0, MAX_ASSEMBLY_LINEAGE_LOOKUPS);
      const lineageCappedMessageCount = Math.max(0, args.reachableMessageIds.length - lineageMessageIds.length);
      let branchExcludedCount = 0;
      const lineageRows = (await Promise.all(lineageMessageIds.map(async (messageId) =>
        await ctx.db
          .query("toolExecutionArtifacts")
          .withIndex("by_message", (q) => q.eq("messageId", messageId))
          .order("desc")
          .take(limit)
      ))).flat()
        .filter((row) => row.userId === args.userId && row.chatId === args.chatId)
        .sort((a, b) => b.createdAt - a.createdAt);
      const selected = lineageRows.slice(0, limit);
      if (selected.length < limit) {
        const selectedIds = new Set(selected.map((row) => String(row._id)));
        const sharedRows = await ctx.db
          .query("toolExecutionArtifacts")
          .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
          .order("desc")
          .take(Math.max((limit - selected.length) * 3, 40));
        for (const row of sharedRows) {
          if (selected.length >= limit) break;
          if (row.userId !== args.userId || selectedIds.has(String(row._id))) continue;
          if (
            reachable.has(row.messageId) ||
            (row.sourceUserMessageId != null && reachable.has(row.sourceUserMessageId)) ||
            (row.branchRootMessageId != null && reachable.has(row.branchRootMessageId))
          ) {
            selected.push(row);
            selectedIds.add(String(row._id));
            continue;
          }
          if (row.visibilityScope === "conversation" || row.visibilityScope === "shared_participants") {
            selected.push(row);
            selectedIds.add(String(row._id));
            continue;
          }
          branchExcludedCount += 1;
        }
      }
      return {
        rows: selected,
        branchExcludedCount,
        lineageCappedMessageCount,
      };
    }
    const rows = await ctx.db
      .query("toolExecutionArtifacts")
      .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
      .order("desc")
      .take(limit);
    return {
      rows: rows.filter((row) => row.userId === args.userId),
      branchExcludedCount: 0,
      lineageCappedMessageCount: 0,
    };
  },
});

export const listSubagentRuntimeRefsForResume = internalQuery({
  args: {
    userId: v.string(),
    batchId: v.id("subagentBatches"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId);
    if (!batch || batch.userId !== args.userId) {
      return {
        artifactRefs: [],
        memoryRefs: [],
        childPrivateArtifactCount: 0,
        promotedArtifactCount: 0,
        childPrivateMemoryCount: 0,
        promotedMemoryCount: 0,
      };
    }
    const limit = args.limit ?? 200;
    const artifacts = await ctx.db
      .query("toolExecutionArtifacts")
      .withIndex("by_chat", (q) => q.eq("chatId", batch.chatId))
      .order("desc")
      .take(limit);
    const memories = await ctx.db
      .query("toolMemories")
      .withIndex("by_chat", (q) => q.eq("chatId", batch.chatId))
      .order("desc")
      .take(limit);
    const batchArtifacts = artifacts.filter((artifact) =>
      artifact.userId === args.userId && artifact.subagentBatchId === args.batchId
    );
    const batchMemories = memories.filter((memory) =>
      memory.userId === args.userId && memory.subagentBatchId === args.batchId
    );
    const promotedArtifacts = batchArtifacts.filter((artifact) =>
      artifact.promotionDecision === "parent_resume" || artifact.promotionDecision === "parent_visible"
    );
    const promotedMemories = batchMemories.filter((memory) =>
      memory.promotionDecision === "parent_resume" || memory.promotionDecision === "parent_visible"
    );
    return {
      artifactRefs: promotedArtifacts.map((artifact) => String(artifact._id)),
      memoryRefs: promotedMemories.map((memory) => String(memory._id)),
      childPrivateArtifactCount: batchArtifacts.filter((artifact) =>
        artifact.promotionDecision === "child_private"
      ).length,
      promotedArtifactCount: promotedArtifacts.length,
      childPrivateMemoryCount: batchMemories.filter((memory) =>
        memory.promotionDecision === "child_private"
      ).length,
      promotedMemoryCount: promotedMemories.length,
    };
  },
});

export const resolveToolMemoryProvenanceForAssembly = internalMutation({
  args: {
    userId: v.string(),
    memoryIds: v.array(v.id("toolMemories")),
    maxRepairAttempts: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const maxRepairAttempts = args.maxRepairAttempts ?? 2;
    const resolved = [];
    for (const memoryId of args.memoryIds) {
      const memory = await ctx.db.get(memoryId);
      if (!memory || memory.userId !== args.userId) continue;
      const locators = memory.provenanceLocators as {
        documentId?: Id<"documents">;
        versionId?: Id<"documentVersions">;
        storageId?: Id<"_storage">;
        filename?: string;
      } | undefined;

      let status: "valid" | "missing" | "repaired" | "unavailable" | "forbidden" = "unavailable";
      let repairedId: string | undefined;
      if (locators?.documentId) {
        const document = await ctx.db.get(locators.documentId);
        if (document?.userId === args.userId) {
          status = "valid";
          repairedId = String(document._id);
        }
      }
      if (status !== "valid" && locators?.versionId) {
        const version = await ctx.db.get(locators.versionId);
        if (version?.userId === args.userId) {
          status = "valid";
          repairedId = String(version._id);
        }
      }
      if (status !== "valid" && locators?.storageId) {
        const storageUrl = await ctx.storage.getUrl(locators.storageId);
        if (storageUrl) {
          status = "valid";
          repairedId = String(locators.storageId);
        }
      }
      if (status !== "valid" && locators?.filename) {
        const documents = await ctx.db
          .query("documents")
          .withIndex("by_user", (q) => q.eq("userId", args.userId))
          .take(100);
        const match = documents.find((document) =>
          document.filename === locators.filename ||
          document.title === locators.filename
        );
        if (match) {
          status = "repaired";
          repairedId = String(match._id);
        }
      }
      if (status === "unavailable" && locators) {
        const attempts = memory.repairAttempts ?? 0;
        status = attempts >= maxRepairAttempts ? "unavailable" : "missing";
      }

      const nextAttempts = status === "missing"
        ? (memory.repairAttempts ?? 0) + 1
        : (memory.repairAttempts ?? 0);
      await ctx.db.patch(memory._id, {
        lastResolutionStatus: status,
        lastResolvedAt: Date.now(),
        repairAttempts: nextAttempts,
      });
      resolved.push({
        memoryId: memory._id,
        status,
        repairedId,
        repairAttempts: nextAttempts,
      });
    }
    return resolved;
  },
});
