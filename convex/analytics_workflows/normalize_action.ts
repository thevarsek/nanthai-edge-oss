"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { deserializeAnalyticsEnvelope } from "../runtime/analytics_execution_envelope";
import { buildResultSummary, type StoredFileEntry } from "../runtime/service_analytics_common";
import {
  buildInlineParentResult,
  buildStorageBackedParentResult,
} from "./normalized_parent_result";

export const normalize = internalAction({
  args: {
    analyticsRunId: v.id("analyticsWorkflowRuns"),
    claimantId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const [run, intents] = await Promise.all([
      ctx.runQuery(internal.analytics_workflows.queries.getRun, {
        analyticsRunId: args.analyticsRunId,
      }),
      ctx.runQuery(internal.analytics_workflows.queries.listArtifacts, {
        analyticsRunId: args.analyticsRunId,
      }),
    ]);
    if (!run?.executionEnvelopeStorageId || run.status !== "running") return null;
    const blob = await ctx.storage.get(run.executionEnvelopeStorageId);
    if (!blob) throw new Error("ANALYTICS_EXECUTION_ENVELOPE_MISSING");
    const envelope = deserializeAnalyticsEnvelope(await blob.text());
    const artifactIntents = intents as Doc<"analyticsArtifactIntents">[];
    const stored = artifactIntents.filter((intent) =>
      intent.status === "stored" && intent.storageId
    );
    const exportedFiles: StoredFileEntry[] = await Promise.all(stored.map(async (intent) => {
      const storageId = intent.storageId;
      if (!storageId) throw new Error("ANALYTICS_ARTIFACT_STORAGE_MISSING");
      const siteUrl = process.env.CONVEX_SITE_URL?.replace(/\/$/, "");
      const downloadUrl = siteUrl
        ? `${siteUrl}/download?storageId=${encodeURIComponent(storageId)}&filename=${encodeURIComponent(intent.filename)}`
        : await ctx.storage.getUrl(storageId);
      return {
        storageId,
        filename: intent.filename,
        mimeType: intent.mimeType,
        sizeBytes: intent.sizeBytes,
        downloadUrl,
      };
    }));
    const chartCount = stored.filter((intent) => intent.kind === "chart").length;
    const summary = buildResultSummary(
      envelope.stdout,
      envelope.stderr,
      chartCount,
      exportedFiles,
      envelope.warnings,
    );
    const input = {
      text: summary.join("\n\n") || "Code executed successfully (no output).",
      resultsSummary: summary,
      importedFiles: envelope.importedFiles,
      exportedFiles,
      warnings: envelope.warnings,
    };
    const normalized = buildInlineParentResult(input);
    let candidateStorageId: Id<"_storage"> | undefined;
    try {
      if (normalized.overflowJson) {
        candidateStorageId = await ctx.storage.store(new Blob(
          [normalized.overflowJson],
          { type: "application/json" },
        ));
      }
      const resultJson = candidateStorageId
        ? buildStorageBackedParentResult(input, String(candidateStorageId))
        : normalized.resultJson;
      const stored = await ctx.runMutation(
        internal.analytics_workflows.result_mutations.storeNormalized,
        {
          analyticsRunId: run._id,
          claimantId: args.claimantId,
          resultJson,
          resultStorageId: candidateStorageId,
          resultBytes: normalized.resultBytes,
        },
      );
      if (!stored && candidateStorageId) {
        await ctx.storage.delete(candidateStorageId).catch(() => undefined);
      }
    } catch (error) {
      if (candidateStorageId) {
        const canonical = await ctx.runQuery(
          internal.analytics_workflows.queries.getRun,
          { analyticsRunId: run._id },
        );
        if (canonical?.normalizedResultStorageId === candidateStorageId) return null;
        await ctx.storage.delete(candidateStorageId).catch(() => undefined);
      }
      throw error;
    }
    return null;
  },
});
