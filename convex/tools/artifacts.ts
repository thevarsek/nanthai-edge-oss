import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, query } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { requireAuth } from "../lib/auth";
import {
  artifactInput,
  persistArtifactCapture,
  prepareArtifactCapture,
} from "./artifact_persistence";
import { storeAncillaryCostArgs } from "../chat/mutations_args";

const MAX_ASSEMBLY_LINEAGE_LOOKUPS = 64;

export const insertToolArtifacts = internalMutation({
  args: { artifacts: v.array(artifactInput), extractMemories: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const result = await persistArtifactCapture(ctx, {
      captureKey: `legacy:${crypto.randomUUID()}`,
      artifacts: args.artifacts,
      extractMemories: args.extractMemories,
      legacyUnfenced: true,
    });
    return result.artifactIds;
  },
});

const captureFenceArgs = {
  captureKey: v.string(),
  jobId: v.id("generationJobs"),
  userId: v.string(),
  chatId: v.id("chats"),
  executionAttemptId: v.optional(v.id("executionAttempts")),
  executionFence: v.optional(v.number()),
};

export const prepareToolArtifactCapture = internalMutation({
  args: captureFenceArgs,
  returns: v.any(),
  handler: prepareArtifactCapture,
});

export const commitToolArtifactCapture = internalMutation({
  args: {
    captureKey: v.string(),
    artifacts: v.array(artifactInput),
    usages: v.optional(v.array(v.object({
      ...storeAncillaryCostArgs,
      idempotencyKey: v.string(),
    }))),
    extractMemories: v.optional(v.boolean()),
    executionAttemptId: v.optional(v.id("executionAttempts")),
    executionFence: v.optional(v.number()),
  },
  returns: v.any(),
  handler: persistArtifactCapture,
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
