import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { subagentBatchStatus, subagentRunStatus, usageObject } from "../schema_validators";
import { isTerminalSubagentStatus } from "./shared";

export const createBatch = internalMutation({
  args: {
    parentMessageId: v.id("messages"),
    sourceUserMessageId: v.id("messages"),
    parentJobId: v.id("generationJobs"),
    chatId: v.id("chats"),
    userId: v.string(),
    toolCallId: v.string(),
    toolCallArguments: v.string(),
    toolRoundCalls: v.any(),
    toolRoundResults: v.any(),
    childConversationSeed: v.any(),
    resumeConversationSeed: v.any(),
    paramsSnapshot: v.any(),
    participantSnapshot: v.any(),
    tasks: v.array(v.object({
      title: v.string(),
      prompt: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const batchId = await ctx.db.insert("subagentBatches", {
      parentMessageId: args.parentMessageId,
      sourceUserMessageId: args.sourceUserMessageId,
      parentJobId: args.parentJobId,
      chatId: args.chatId,
      userId: args.userId,
      status: "running_children",
      toolCallId: args.toolCallId,
      toolCallArguments: args.toolCallArguments,
      toolRoundCalls: args.toolRoundCalls,
      toolRoundResults: args.toolRoundResults,
      childConversationSeed: args.childConversationSeed,
      resumeConversationSeed: args.resumeConversationSeed,
      paramsSnapshot: args.paramsSnapshot,
      participantSnapshot: args.participantSnapshot,
      childCount: args.tasks.length,
      completedChildCount: 0,
      failedChildCount: 0,
      createdAt: now,
      updatedAt: now,
    });

    const runIds = [];
    for (const [index, task] of args.tasks.entries()) {
      const runId = await ctx.db.insert("subagentRuns", {
        batchId,
        childIndex: index,
        title: task.title,
        taskPrompt: task.prompt,
        status: "queued",
        continuationCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      runIds.push(runId);
    }

    await ctx.db.patch(args.parentMessageId, { subagentBatchId: batchId });
    return { batchId, runIds };
  },
});

export const updateRunStreaming = internalMutation({
  args: {
    runId: v.id("subagentRuns"),
    content: v.optional(v.string()),
    reasoning: v.optional(v.string()),
    usage: v.optional(usageObject),
    toolCalls: v.optional(v.array(v.object({
      id: v.string(),
      name: v.string(),
      arguments: v.string(),
    }))),
    toolResults: v.optional(v.array(v.object({
      toolCallId: v.string(),
      toolName: v.string(),
      result: v.string(),
      isError: v.optional(v.boolean()),
    }))),
    generatedFiles: v.optional(v.array(v.object({
      storageId: v.id("_storage"),
      filename: v.string(),
      mimeType: v.string(),
      sizeBytes: v.optional(v.number()),
      toolName: v.string(),
    }))),
    generatedCharts: v.optional(v.array(v.object({
      toolName: v.string(),
      chartType: v.union(
        v.literal("line"),
        v.literal("bar"),
        v.literal("scatter"),
        v.literal("pie"),
        v.literal("box"),
      ),
      title: v.optional(v.string()),
      xLabel: v.optional(v.string()),
      yLabel: v.optional(v.string()),
      xUnit: v.optional(v.string()),
      yUnit: v.optional(v.string()),
      elements: v.any(),
    }))),
    status: v.optional(subagentRunStatus),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.runId);
    if (!existing || isTerminalSubagentStatus(existing.status)) return;
    await ctx.db.patch(args.runId, {
      ...(args.content !== undefined ? { content: args.content } : {}),
      ...(args.reasoning !== undefined ? { reasoning: args.reasoning } : {}),
      ...(args.usage !== undefined ? { usage: args.usage } : {}),
      ...(args.toolCalls !== undefined ? { toolCalls: args.toolCalls } : {}),
      ...(args.toolResults !== undefined ? { toolResults: args.toolResults } : {}),
      ...(args.generatedFiles !== undefined ? { generatedFiles: args.generatedFiles } : {}),
      ...(args.generatedCharts !== undefined ? { generatedCharts: args.generatedCharts } : {}),
      ...(args.status !== undefined ? { status: args.status } : {}),
      ...((args.status === "streaming" && existing.startedAt === undefined)
        ? { startedAt: Date.now() }
        : {}),
      updatedAt: Date.now(),
    });
  },
});

export const claimRunForExecution = internalMutation({
  args: {
    runId: v.id("subagentRuns"),
    expectedStatuses: v.array(subagentRunStatus),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || isTerminalSubagentStatus(run.status)) return false;
    if (!args.expectedStatuses.includes(run.status)) {
      return false;
    }
    const now = Date.now();
    await ctx.db.patch(args.runId, {
      status: "streaming",
      startedAt: run.startedAt ?? now,
      updatedAt: now,
    });
    return true;
  },
});

export const checkpointRunContinuation = internalMutation({
  args: {
    runId: v.id("subagentRuns"),
    content: v.optional(v.string()),
    reasoning: v.optional(v.string()),
    usage: v.optional(usageObject),
    toolCalls: v.optional(v.array(v.object({
      id: v.string(),
      name: v.string(),
      arguments: v.string(),
    }))),
    toolResults: v.optional(v.array(v.object({
      toolCallId: v.string(),
      toolName: v.string(),
      result: v.string(),
      isError: v.optional(v.boolean()),
    }))),
    conversationSnapshot: v.any(),
    continuationCount: v.number(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || isTerminalSubagentStatus(run.status)) return null;
    const now = Date.now();
    await ctx.db.patch(args.runId, {
      status: "waiting_continuation",
      content: args.content ?? run.content,
      reasoning: args.reasoning ?? run.reasoning,
      usage: args.usage ?? run.usage,
      toolCalls: args.toolCalls ?? run.toolCalls,
      toolResults: args.toolResults ?? run.toolResults,
      conversationSnapshot: args.conversationSnapshot,
      continuationCount: args.continuationCount,
      startedAt: run.startedAt ?? now,
      updatedAt: now,
    });
    return { batchId: run.batchId };
  },
});

export const finalizeRun = internalMutation({
  args: {
    runId: v.id("subagentRuns"),
    status: subagentRunStatus,
    content: v.optional(v.string()),
    reasoning: v.optional(v.string()),
    usage: v.optional(usageObject),
    toolCalls: v.optional(v.array(v.object({
      id: v.string(),
      name: v.string(),
      arguments: v.string(),
    }))),
    toolResults: v.optional(v.array(v.object({
      toolCallId: v.string(),
      toolName: v.string(),
      result: v.string(),
      isError: v.optional(v.boolean()),
    }))),
    generatedFiles: v.optional(v.array(v.object({
      storageId: v.id("_storage"),
      filename: v.string(),
      mimeType: v.string(),
      sizeBytes: v.optional(v.number()),
      toolName: v.string(),
    }))),
    generatedCharts: v.optional(v.array(v.object({
      toolName: v.string(),
      chartType: v.union(
        v.literal("line"),
        v.literal("bar"),
        v.literal("scatter"),
        v.literal("pie"),
        v.literal("box"),
      ),
      title: v.optional(v.string()),
      xLabel: v.optional(v.string()),
      yLabel: v.optional(v.string()),
      xUnit: v.optional(v.string()),
      yUnit: v.optional(v.string()),
      elements: v.any(),
    }))),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const run = await ctx.db.get(args.runId);
    if (!run) return null;
    await ctx.db.patch(args.runId, {
      status: args.status,
      content: args.content ?? run.content,
      reasoning: args.reasoning ?? run.reasoning,
      usage: args.usage ?? run.usage,
      toolCalls: args.toolCalls ?? run.toolCalls,
      toolResults: args.toolResults ?? run.toolResults,
      generatedFiles: args.generatedFiles ?? run.generatedFiles,
      generatedCharts: args.generatedCharts ?? run.generatedCharts,
      error: args.error,
      completedAt: now,
      updatedAt: now,
    });

    const runs = await ctx.db
      .query("subagentRuns")
      .withIndex("by_batch", (q) => q.eq("batchId", run.batchId))
      .collect();
    const nextRuns = runs.map((entry) => entry._id === args.runId
      ? { ...entry, status: args.status }
      : entry);
    const completedChildCount = nextRuns.filter((entry) => isTerminalSubagentStatus(entry.status)).length;
    const failedChildCount = nextRuns.filter((entry) => entry.status === "failed" || entry.status === "timedOut").length;
    await ctx.db.patch(run.batchId, {
      completedChildCount,
      failedChildCount,
      updatedAt: now,
    });

    return { batchId: run.batchId, allTerminal: completedChildCount >= nextRuns.length };
  },
});

export const updateBatchStatus = internalMutation({
  args: {
    batchId: v.id("subagentBatches"),
    status: subagentBatchStatus,
    expectedCurrentStatus: v.optional(subagentBatchStatus),
    continuationScheduledAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId);
    if (!batch) return false;
    if (
      args.expectedCurrentStatus !== undefined
      && batch.status !== args.expectedCurrentStatus
    ) {
      return false;
    }
    await ctx.db.patch(args.batchId, {
      status: args.status,
      continuationScheduledAt: args.continuationScheduledAt,
      updatedAt: Date.now(),
    });
    return true;
  },
});

export const claimBatchForResume = internalMutation({
  args: {
    batchId: v.id("subagentBatches"),
  },
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId);
    if (!batch || batch.status !== "waiting_to_resume") {
      return false;
    }
    const now = Date.now();
    await ctx.db.patch(args.batchId, {
      status: "resuming",
      continuationScheduledAt: now,
      updatedAt: now,
    });
    return true;
  },
});

export const attachGeneratedFilesToMessage = internalMutation({
  args: {
    messageId: v.id("messages"),
    chatId: v.id("chats"),
    userId: v.string(),
    generatedFiles: v.array(v.object({
      storageId: v.id("_storage"),
      filename: v.string(),
      mimeType: v.string(),
      sizeBytes: v.optional(v.number()),
      toolName: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    if (args.generatedFiles.length === 0) return [];
    const now = Date.now();
    const existing = await ctx.db.get(args.messageId);
    if (!existing) return [];
    const existingRows = await ctx.db
      .query("generatedFiles")
      .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
      .collect();
    const existingByStorageId = new Map(
      existingRows.map((row) => [row.storageId, row._id] as const),
    );
    const mergedIds = [...(existing.generatedFileIds ?? [])];
    const insertedIds = [];
    for (const file of args.generatedFiles) {
      const existingId = existingByStorageId.get(file.storageId);
      if (existingId) {
        if (!mergedIds.includes(existingId)) {
          mergedIds.push(existingId);
        }
        continue;
      }
      const id = await ctx.db.insert("generatedFiles", {
        userId: args.userId,
        chatId: args.chatId,
        messageId: args.messageId,
        storageId: file.storageId,
        filename: file.filename,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        toolName: file.toolName,
        createdAt: now,
      });
      insertedIds.push(id);
      mergedIds.push(id);
    }
    await ctx.db.patch(args.messageId, {
      generatedFileIds: mergedIds,
    });
    return insertedIds;
  },
});

export const attachGeneratedChartsToMessage = internalMutation({
  args: {
    messageId: v.id("messages"),
    chatId: v.id("chats"),
    userId: v.string(),
    generatedCharts: v.array(v.object({
      toolName: v.string(),
      chartType: v.union(
        v.literal("line"),
        v.literal("bar"),
        v.literal("scatter"),
        v.literal("pie"),
        v.literal("box"),
      ),
      title: v.optional(v.string()),
      xLabel: v.optional(v.string()),
      yLabel: v.optional(v.string()),
      xUnit: v.optional(v.string()),
      yUnit: v.optional(v.string()),
      elements: v.any(),
    })),
  },
  handler: async (ctx, args) => {
    if (args.generatedCharts.length === 0) return [];
    const now = Date.now();
    const existing = await ctx.db.get(args.messageId);
    if (!existing) return [];
    const existingRows = await ctx.db
      .query("generatedCharts")
      .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
      .collect();
    const existingKeys = new Map(
      existingRows.map((row) => [
        JSON.stringify([row.chartType, row.title ?? "", JSON.stringify(row.elements)]),
        row._id,
      ] as const),
    );
    const mergedIds = [...(existing.generatedChartIds ?? [])];
    const insertedIds = [];
    for (const chart of args.generatedCharts) {
      const key = JSON.stringify([chart.chartType, chart.title ?? "", JSON.stringify(chart.elements)]);
      const existingId = existingKeys.get(key);
      if (existingId) {
        if (!mergedIds.includes(existingId)) {
          mergedIds.push(existingId);
        }
        continue;
      }
      const id = await ctx.db.insert("generatedCharts", {
        userId: args.userId,
        chatId: args.chatId,
        messageId: args.messageId,
        toolName: chart.toolName,
        chartType: chart.chartType,
        title: chart.title,
        xLabel: chart.xLabel,
        yLabel: chart.yLabel,
        xUnit: chart.xUnit,
        yUnit: chart.yUnit,
        elements: chart.elements,
        createdAt: now,
      });
      insertedIds.push(id);
      mergedIds.push(id);
    }
    await ctx.db.patch(args.messageId, {
      generatedChartIds: mergedIds,
    });
    return insertedIds;
  },
});
