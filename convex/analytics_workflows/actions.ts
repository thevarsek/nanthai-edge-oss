"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalAction, type ActionCtx } from "../_generated/server";
import { runDataPythonExec } from "../runtime/service_analytics";
import { runDataPythonSandbox } from "../runtime/service_analytics_sandbox";
import type { ToolExecutionContext } from "../tools/registry";
import {
  deserializeAnalyticsEnvelope,
  serializeAnalyticsEnvelope,
  type AnalyticsExecutionEnvelope,
} from "../runtime/analytics_execution_envelope";
import { ANALYTICS_ERROR_MAX_CHARS } from "./limits";

const runArgs = {
  analyticsRunId: v.id("analyticsWorkflowRuns"),
  claimantId: v.string(),
};

export const execute = internalAction({
  args: runArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.analytics_workflows.mutations.setPhase, {
      analyticsRunId: args.analyticsRunId,
      claimantId: args.claimantId,
      phase: "execute",
    });
    const run = await ctx.runQuery(internal.analytics_workflows.queries.getRun, {
      analyticsRunId: args.analyticsRunId,
    });
    if (!run || run.status !== "running") return null;
    // The runtime has already completed and its exact result is durably
    // checkpointed. A Workflow replay must collect this envelope instead of
    // executing user code a second time.
    if (run.executionEnvelopeStorageId) return null;
    const toolCtx: ToolExecutionContext = {
      ctx,
      userId: run.userId,
      chatId: String(run.chatId),
      messageId: String(run.messageId),
      userMessageId: String(run.userMessageId),
      jobId: String(run.jobId),
      toolCallId: run.toolCallId,
      generationKey: String(run.jobId),
      executionAttemptId: run.executionAttemptId,
      executionFence: run.executionFence,
      operationIdempotencyKey: run.artifactKey,
    };
    try {
      const input = {
        code: run.code,
        inputFiles: run.inputFiles,
        exportPaths: run.exportPaths,
        captureCharts: run.captureCharts,
        timeoutMs: run.timeoutMs,
      };
      const onExecutionReady = async (envelope: AnalyticsExecutionEnvelope) => {
        const raw = serializeAnalyticsEnvelope(envelope);
        const storageId = await ctx.storage.store(new Blob([raw], { type: "application/json" }));
        try {
          const adopted = await ctx.runMutation(internal.analytics_workflows.mutations.storeEnvelope, {
            analyticsRunId: run._id,
            claimantId: args.claimantId,
            storageId,
          });
          if (!adopted) await ctx.storage.delete(storageId).catch(() => undefined);
        } catch (error) {
          const canonical = await ctx.runQuery(
            internal.analytics_workflows.queries.getRun,
            { analyticsRunId: run._id },
          );
          if (canonical?.executionEnvelopeStorageId === storageId) return;
          await ctx.storage.delete(storageId).catch(() => undefined);
          throw error;
        }
      };
      if (run.toolName === "data_python_exec") {
        await runDataPythonExec(toolCtx, { ...input, onExecutionReady });
      } else {
        await runDataPythonSandbox(toolCtx, { ...input, packages: run.packages, onExecutionReady });
      }
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error))
        .slice(0, ANALYTICS_ERROR_MAX_CHARS);
      await ctx.runMutation(internal.analytics_workflows.mutations.storeResult, {
        analyticsRunId: run._id,
        resultBytes: new TextEncoder().encode(message).byteLength,
        error: message,
        claimantId: args.claimantId,
      });
    }
    return null;
  },
});

export const resumeParent = internalAction({
  args: runArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.analytics_workflows.mutations.setPhase, {
      analyticsRunId: args.analyticsRunId,
      claimantId: args.claimantId,
      phase: "resume",
    });
    const run = await ctx.runQuery(internal.analytics_workflows.queries.getRun, {
      analyticsRunId: args.analyticsRunId,
    });
    if (!run || !run.parentEventId) throw new Error("ANALYTICS_PARENT_EVENT_NOT_FOUND");
    const artifacts = run.resultJson
      ? []
      : await ctx.runQuery(internal.analytics_workflows.queries.listArtifacts, {
        analyticsRunId: run._id,
      }) as Doc<"analyticsArtifactIntents">[];
    const result = run.resultJson ?? JSON.stringify({
      text: "Analytics completed. The detailed result is stored outside the model context.",
      resultStorageId: run.resultStorageId,
      artifactStorageIds: artifacts.flatMap((artifact) =>
        artifact.storageId ? [String(artifact.storageId)] : []),
    });
    const isError = run.status === "failed" || run.error !== undefined;
    const resumeStatus = await ctx.runMutation(internal.chat.workflow_events.completeDeferredTool, {
      jobId: run.jobId,
      userId: run.userId,
      toolCallId: run.toolCallId,
      toolName: run.toolName,
      result: isError ? JSON.stringify({ error: run.error ?? "Analytics execution failed" }) : result,
      isError: isError ? true : undefined,
      eventId: run.parentEventId,
    });
    // A successful delivery is replay-safe: completeDeferredTool returns
    // `duplicate` after the exact result was stored. `missing` means the
    // expected checkpoint/fence/event was never matched and must not be
    // mistaken for delivery merely because this action already set its phase.
    if (resumeStatus === "missing") {
      throw new Error("ANALYTICS_PARENT_CHECKPOINT_NOT_FOUND");
    }
    return null;
  },
});

async function storeArtifact(
  ctx: ActionCtx,
  run: Doc<"analyticsWorkflowRuns">,
  claimantId: string,
  artifact: {
    ordinal: number;
    kind: "chart" | "output";
    filename: string;
    mimeType: string;
    bytes: Uint8Array;
  },
): Promise<void> {
  const intent = await ctx.runMutation(internal.analytics_workflows.artifacts.prepare, {
    analyticsRunId: run._id,
    claimantId,
    ordinal: artifact.ordinal,
    kind: artifact.kind,
    filename: artifact.filename,
    mimeType: artifact.mimeType,
    sizeBytes: artifact.bytes.byteLength,
  });
  let storageId = intent.storageId;
  if (!storageId) {
    const viewed = artifact.bytes.buffer.slice(
      artifact.bytes.byteOffset,
      artifact.bytes.byteOffset + artifact.bytes.byteLength,
    ) as ArrayBuffer;
    const candidate = await ctx.storage.store(new Blob([viewed], { type: artifact.mimeType }));
    try {
      storageId = await ctx.runMutation(internal.analytics_workflows.artifacts.commit, {
        analyticsRunId: run._id,
        claimantId,
        intentId: intent.intentId,
        storageId: candidate,
      });
    } catch (error) {
      const intents = await ctx.runQuery(
        internal.analytics_workflows.queries.listArtifacts,
        { analyticsRunId: run._id },
      ) as Doc<"analyticsArtifactIntents">[];
      const canonical = intents.find((entry) => entry._id === intent.intentId);
      if (canonical?.storageId === candidate) return;
      await ctx.storage.delete(candidate).catch(() => undefined);
      throw error;
    }
    if (storageId !== candidate) await ctx.storage.delete(candidate).catch(() => undefined);
  }
}

export const collect = internalAction({
  args: runArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.runQuery(internal.analytics_workflows.queries.getRun, {
      analyticsRunId: args.analyticsRunId,
    });
    if (!run?.executionEnvelopeStorageId || run.status !== "running") return null;
    const blob = await ctx.storage.get(run.executionEnvelopeStorageId);
    if (!blob) throw new Error("ANALYTICS_EXECUTION_ENVELOPE_MISSING");
    const envelope = deserializeAnalyticsEnvelope(await blob.text());
    if (envelope.error) {
      await ctx.runMutation(internal.analytics_workflows.mutations.storeResult, {
        analyticsRunId: run._id,
        claimantId: args.claimantId,
        resultBytes: new TextEncoder().encode(envelope.error).byteLength,
        error: envelope.error,
      });
      return null;
    }
    const charts = envelope.charts;
    for (const [index, chart] of charts.entries()) {
      await storeArtifact(ctx, run, args.claimantId, {
        ordinal: index,
        kind: "chart",
        filename: `chart-${chart.index + 1}.png`,
        mimeType: "image/png",
        bytes: chart.pngBytes,
      });
    }
    const outputs = envelope.outputFiles;
    for (const [index, output] of outputs.entries()) {
      await storeArtifact(ctx, run, args.claimantId, {
        ordinal: charts.length + index,
        kind: "output",
        filename: (output.path.split("/").pop() || `output-${index + 1}`).slice(0, 240),
        mimeType: output.mimeType.slice(0, 200),
        bytes: output.bytes,
      });
    }
    return null;
  },
});
