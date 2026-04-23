"use node";

import { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import {
  ChatRequestParameters,
  gateParameters,
  OnDelta,
  OnReasoningDelta,
  OpenRouterMessage,
  OpenRouterUsage,
} from "../lib/openrouter";
import {
  buildProgressiveToolRegistry,
  buildRegistryParams,
  extractLoadedSkillsFromConversation,
  extractLoadedSkillsFromLoadSkillResults,
  extractProfilesFromConversation,
  extractProfilesFromLoadSkillResults,
  mergeLoadedSkills,
  patchSameRoundProgressiveToolErrors,
  retrySameRoundProgressiveToolCalls,
} from "../tools/progressive_registry";
import { runGenerationWithCompaction } from "../chat/actions_run_generation_loop";
import { GenerationCancelledError, isGenerationCancelledError } from "../chat/generation_helpers";
import { extractGeneratedCharts, extractGeneratedFiles } from "../chat/generated_file_helpers";
import {
  buildSubagentTaskPrompt,
  isSubagentLeaseStale,
  isTerminalSubagentStatus,
  normalizeOpenRouterMessages,
  SUBAGENT_RECOVERY_LEASE_MS,
} from "./shared";
import { SubagentStreamWriter } from "./stream_writer";
import { COMPACTION } from "../lib/compaction_constants";
import { RecordedToolCall, RecordedToolResult } from "../tools/execute_loop";
import { ToolResult } from "../tools/registry";
import { getRequiredUserOpenRouterApiKey } from "../lib/user_secrets";
import type { LoadedSkillState } from "../tools/progressive_registry_shared";
import { normalizeMessagesForLoadedSkills } from "../chat/loaded_skill_prompt";

interface SubagentConversationSnapshot {
  messages: OpenRouterMessage[];
  totalUsage: OpenRouterUsage | null;
  allToolCalls: RecordedToolCall[];
  allToolResults: RecordedToolResult[];
  loadedSkills: LoadedSkillState[];
  compactionCount: number;
}

const MAX_TOOL_RESULT_STORE_CHARS = 4000;

function truncateForStorage(str: string): string {
  if (str.length <= MAX_TOOL_RESULT_STORE_CHARS) return str;
  return str.slice(0, MAX_TOOL_RESULT_STORE_CHARS) + "…[truncated]";
}

function toRecordedToolResults(
  toolCalls: RecordedToolCall[],
  results: Array<{ toolCallId: string; result: ToolResult }>,
): RecordedToolResult[] {
  return results.map(({ toolCallId, result }) => {
    const matchingCall = toolCalls.find((entry) => entry.id === toolCallId);
    return {
      toolCallId,
      toolName: matchingCall?.name ?? "unknown",
      result: truncateForStorage(
        JSON.stringify(result.success ? result.data : { error: result.error }),
      ),
      isError: result.success ? undefined : true,
    };
  });
}

async function maybeFailStaleStreamingRun(
  ctx: ActionCtx,
  runId: Id<"subagentRuns">,
): Promise<boolean> {
  const run = await ctx.runQuery(internal.subagents.queries.getRunInternal, { runId });
  if (!run || run.status !== "streaming" || !isSubagentLeaseStale(run.updatedAt, Date.now())) {
    return false;
  }

  const finalizeResult = await ctx.runMutation(internal.subagents.mutations.finalizeRun, {
    runId,
    status: "failed",
    content: run.content,
    reasoning: run.reasoning,
    usage: run.usage,
    toolCalls: run.toolCalls,
    toolResults: run.toolResults,
    generatedFiles: run.generatedFiles,
    generatedCharts: run.generatedCharts,
    error: "Subagent execution lease expired before reaching a safe checkpoint.",
  });
  if (finalizeResult?.allTerminal) {
    const didMark = await ctx.runMutation(internal.subagents.mutations.updateBatchStatus, {
      batchId: finalizeResult.batchId,
      status: "waiting_to_resume",
      expectedCurrentStatus: "running_children",
      continuationScheduledAt: Date.now(),
    });
    if (didMark) {
      await ctx.scheduler.runAfter(0, internal.subagents.actions.continueParentAfterSubagents, {
        batchId: finalizeResult.batchId,
      });
    }
  }
  return true;
}

async function ensureRunActive(ctx: ActionCtx, runId: Id<"subagentRuns">): Promise<void> {
  const run = await ctx.runQuery(internal.subagents.queries.getRunInternal, { runId });
  if (!run || isTerminalSubagentStatus(run.status)) {
    throw new GenerationCancelledError();
  }
  const batch = await ctx.runQuery(internal.subagents.queries.getBatchInternal, { batchId: run.batchId });
  if (!batch || batch.status === "cancelled") {
    throw new GenerationCancelledError();
  }
}

export async function runSubagentRunHandler(
  ctx: ActionCtx,
  args: { runId: Id<"subagentRuns"> },
): Promise<void> {
  const claimed = await ctx.runMutation(internal.subagents.mutations.claimRunForExecution, {
    runId: args.runId,
    expectedStatuses: ["queued", "waiting_continuation"],
  });
  if (!claimed) {
    await maybeFailStaleStreamingRun(ctx, args.runId);
    return;
  }

  const run = await ctx.runQuery(internal.subagents.queries.getRunInternal, { runId: args.runId });
  if (!run) return;
  await ctx.scheduler.runAfter(SUBAGENT_RECOVERY_LEASE_MS, internal.subagents.actions.continueSubagentRun, {
    runId: args.runId,
  });
  const batch = await ctx.runQuery(internal.subagents.queries.getBatchInternal, { batchId: run.batchId });
  if (!batch) {
    return;
  }
  const apiKey = await getRequiredUserOpenRouterApiKey(ctx, batch.userId);
  if (batch.status === "cancelled") {
    await ctx.runMutation(internal.subagents.mutations.finalizeRun, {
      runId: run._id,
      status: "cancelled",
      content: run.content,
      reasoning: run.reasoning,
      error: "Subagent batch was cancelled.",
    });
    return;
  }

  const paramsSnapshot = batch.paramsSnapshot as {
    enabledIntegrations?: string[];
    requestParams: ChatRequestParameters;
  };
  const participantSnapshot = batch.participantSnapshot as {
    userId: string;
    chatId?: string;
    participant: { modelId: string };
  };
  const modelId = participantSnapshot.participant.modelId;
  const caps = await ctx.runQuery(internal.chat.queries.getModelCapabilities, { modelId });
  const accountCapabilities = await ctx.runQuery(
    internal.capabilities.queries.getAccountCapabilitiesInternal,
    { userId: participantSnapshot.userId },
  );
  const isProUser = accountCapabilities.isPro;
  const snapshot = run.conversationSnapshot as SubagentConversationSnapshot | undefined;
  const liveToolCalls: RecordedToolCall[] = [...(snapshot?.allToolCalls ?? run.toolCalls ?? [])];
  const liveToolResults: RecordedToolResult[] = [...(snapshot?.allToolResults ?? run.toolResults ?? [])];
  const messages: OpenRouterMessage[] = snapshot?.messages
    ? normalizeOpenRouterMessages(snapshot.messages)
    : [
        ...normalizeOpenRouterMessages(batch.childConversationSeed),
        {
          role: "user",
          content: buildSubagentTaskPrompt({ title: run.title, prompt: run.taskPrompt }),
        },
      ];
  const restoredProfiles = extractProfilesFromConversation(messages);
  let loadedSkills = mergeLoadedSkills(
    snapshot?.loadedSkills,
    extractLoadedSkillsFromConversation(messages),
  );
  // Snapshots already store normalized messages, but re-running normalization
  // keeps seed and resume paths aligned and self-heals older/raw transcripts.
  const normalizedMessages = normalizeMessagesForLoadedSkills(
    messages,
    loadedSkills,
  );
  const toolRegistry = buildProgressiveToolRegistry({
    enabledIntegrations: paramsSnapshot.enabledIntegrations,
    isPro: isProUser,
    allowSubagents: false,
    activeProfiles: restoredProfiles,
  });
  // Subagents inherit webSearchEnabled from the parent's params snapshot.
  // Web search runs via the `plugins: [{id:"web"}]` form (see
  // `openrouter_request.ts`), which searches exactly once per request — so
  // there's no per-subagent cumulative budget to set. `gateParameters` will
  // strip `webSearchEnabled` if the subagent's model doesn't support the
  // plugin (it does on every model we ship).
  const rawParams = {
    ...paramsSnapshot.requestParams,
    ...buildRegistryParams(toolRegistry),
  };
  const gatedParams = gateParameters(
    rawParams,
    caps?.supportedParameters,
    caps?.hasImageGeneration,
    caps?.hasReasoning,
  );
  const activeProfiles = new Set(restoredProfiles);
  const writer = new SubagentStreamWriter({
    ctx,
    runId: run._id,
    beforePatch: async () => ensureRunActive(ctx, run._id),
    initialContent: run.content ?? "",
    initialReasoning: run.reasoning ?? "",
  });
  let deltaEventsSinceCancelCheck = 0;

  // Shared tool execution context — workspace sandbox is lazily created on
  // first workspace tool call. Cleanup is handled in the finally block.
  const subagentToolCtx: import("../tools/registry").ToolExecutionContext = {
    ctx,
    userId: participantSnapshot.userId,
    chatId: participantSnapshot.chatId ?? String(batch.chatId),
  };

  try {
    const callbacks: { onDelta: OnDelta; onReasoningDelta: OnReasoningDelta } = {
      onDelta: async (delta) => {
        await writer.handleContentDeltaBoundary(delta.length);
        await writer.appendContent(delta);
        await writer.patchContentIfNeeded();
        deltaEventsSinceCancelCheck += 1;
        if (deltaEventsSinceCancelCheck % 10 === 0) {
          await ensureRunActive(ctx, run._id);
        }
      },
      onReasoningDelta: async (delta) => {
        await writer.appendReasoning(delta);
        await writer.patchReasoningIfNeeded(writer.hasSeenContentDelta);
      },
    };

    const result = await runGenerationWithCompaction({
      apiKey,
      model: modelId,
      messages: normalizedMessages,
      params: gatedParams,
      callbacks,
      retryConfig: {
        emptyStreamRetries: 2,
        emptyStreamBackoffs: [500, 1500],
        fallbackModel: undefined,
      },
      toolRegistry,
      toolCtx: subagentToolCtx,
      onToolRoundStart: async (_round, _toolCalls) => {
        for (const toolCall of _toolCalls) {
          liveToolCalls.push({
            id: toolCall.id,
            name: toolCall.function.name,
            arguments: truncateForStorage(toolCall.function.arguments),
          });
        }
        await ctx.runMutation(internal.subagents.mutations.updateRunStreaming, {
          runId: run._id,
          status: "streaming",
          toolCalls: liveToolCalls,
        });
      },
      onToolRoundComplete: async (_round, roundResults) => {
        const recordedResults = toRecordedToolResults(liveToolCalls, roundResults);
        liveToolResults.push(...recordedResults);
        await ctx.runMutation(internal.subagents.mutations.updateRunStreaming, {
          runId: run._id,
          toolCalls: liveToolCalls,
          toolResults: liveToolResults,
          generatedFiles: extractGeneratedFiles(liveToolResults),
          generatedCharts: extractGeneratedCharts(liveToolResults),
        });
      },
      onPrepareNextTurn: async (_round, toolCalls, results, conversationMessages) => {
        const newProfiles = extractProfilesFromLoadSkillResults(toolCalls, results);
        loadedSkills = mergeLoadedSkills(
          loadedSkills,
          extractLoadedSkillsFromLoadSkillResults(toolCalls, results),
        );
        const normalizedNextMessages = normalizeMessagesForLoadedSkills(
          conversationMessages,
          loadedSkills,
        );
        let changed = false;
        for (const profile of newProfiles) {
          if (!activeProfiles.has(profile)) {
            activeProfiles.add(profile);
            changed = true;
          }
        }
        if (!changed) {
          return {
            messages: normalizedNextMessages,
          };
        }

        const registry = buildProgressiveToolRegistry({
          enabledIntegrations: paramsSnapshot.enabledIntegrations,
          isPro: isProUser,
          allowSubagents: false,
          activeProfiles: Array.from(activeProfiles),
        });
        await retrySameRoundProgressiveToolCalls(
          toolCalls,
          results,
          registry,
          {
            ctx,
            userId: participantSnapshot.userId,
            chatId: participantSnapshot.chatId ?? String(batch.chatId),
          },
        );
        patchSameRoundProgressiveToolErrors(toolCalls, results, registry);

        return {
          registry,
          messages: normalizedNextMessages,
          params: gateParameters(
            {
              ...gatedParams,
              ...buildRegistryParams(registry),
            },
            caps?.supportedParameters,
            caps?.hasImageGeneration,
            caps?.hasReasoning,
          ),
        };
      },
      modelContextLimit: caps?.contextLength ?? 128_000,
      // SubagentStreamWriter and StreamWriter intentionally share the same
      // runtime surface. This stays casted until the chat/subagent writers are
      // unified behind a shared interface.
      writer: writer as any,
      actionStartTime: Date.now(),
      allowContinuationHandoff: true,
      initialTotalUsage: snapshot?.totalUsage ?? null,
      initialToolCalls: snapshot?.allToolCalls ?? [],
      initialToolResults: snapshot?.allToolResults ?? [],
      initialCompactionCount: snapshot?.compactionCount ?? 0,
    });

    // M23: Store ancillary compaction costs against the parent message.
    for (const cu of result.compactionUsages) {
      await ctx.scheduler.runAfter(0, internal.chat.mutations.storeAncillaryCost, {
        messageId: batch.parentMessageId,
        chatId: batch.chatId,
        userId: batch.userId,
        modelId: cu.modelId,
        promptTokens: cu.usage.promptTokens,
        completionTokens: cu.usage.completionTokens,
        totalTokens: cu.usage.totalTokens,
        cost: cu.usage.cost ?? undefined,
        source: "compaction",
        generationId: cu.generationId ?? undefined,
      });
    }

    await writer.flush();
    if (result.continuation) {
      const nextContinuationCount = (run.continuationCount ?? 0) + 1;
      if (nextContinuationCount > COMPACTION.MAX_CONTINUATIONS) {
        const finalizeResult = await ctx.runMutation(internal.subagents.mutations.finalizeRun, {
          runId: run._id,
          status: "timedOut",
          content: writer.totalContent || undefined,
          reasoning: writer.totalReasoning || undefined,
          usage: result.totalUsage ?? undefined,
          toolCalls: result.allToolCalls.length > 0 ? result.allToolCalls : undefined,
          toolResults: result.allToolResults.length > 0 ? result.allToolResults : undefined,
          generatedFiles: extractGeneratedFiles(result.allToolResults),
          generatedCharts: extractGeneratedCharts(result.allToolResults),
          error: `Subagent exceeded the continuation limit of ${COMPACTION.MAX_CONTINUATIONS}.`,
        });
        // M23: Track subagent generation cost against the parent message.
        if (result.totalUsage) {
          await ctx.scheduler.runAfter(0, internal.chat.mutations.storeAncillaryCost, {
            messageId: batch.parentMessageId,
            chatId: batch.chatId,
            userId: batch.userId,
            modelId,
            promptTokens: result.totalUsage.promptTokens,
            completionTokens: result.totalUsage.completionTokens,
            totalTokens: result.totalUsage.totalTokens,
            cost: result.totalUsage.cost ?? undefined,
            source: "subagent",
            generationId: result.streamResult.generationId ?? undefined,
          });
        }
        if (finalizeResult?.allTerminal) {
          const didMark = await ctx.runMutation(internal.subagents.mutations.updateBatchStatus, {
            batchId: finalizeResult.batchId,
            status: "waiting_to_resume",
            expectedCurrentStatus: "running_children",
            continuationScheduledAt: Date.now(),
          });
          if (didMark) {
            await ctx.scheduler.runAfter(0, internal.subagents.actions.continueParentAfterSubagents, {
              batchId: finalizeResult.batchId,
            });
          }
        }
        return;
      }

      const continuationLoadedSkills = loadedSkills;

      await ctx.runMutation(internal.subagents.mutations.checkpointRunContinuation, {
        runId: run._id,
        content: writer.totalContent || undefined,
        reasoning: writer.totalReasoning || undefined,
        usage: result.totalUsage ?? undefined,
        toolCalls: result.allToolCalls.length > 0 ? result.allToolCalls : undefined,
        toolResults: result.allToolResults.length > 0 ? result.allToolResults : undefined,
        continuationCount: nextContinuationCount,
        conversationSnapshot: {
          messages: normalizeMessagesForLoadedSkills(
            result.continuation.messages,
            continuationLoadedSkills,
          ),
          totalUsage: result.totalUsage,
          allToolCalls: result.allToolCalls,
          allToolResults: result.allToolResults,
          loadedSkills: continuationLoadedSkills,
          compactionCount: result.compactionCount,
        } satisfies SubagentConversationSnapshot,
      });
      await ctx.scheduler.runAfter(0, internal.subagents.actions.continueSubagentRun, {
        runId: run._id,
      });
      return;
    }

    const finalContent = writer.totalContent.trim() || result.streamResult.content.trim() || "[No response received from subagent]";
    const finalizeResult = await ctx.runMutation(internal.subagents.mutations.finalizeRun, {
      runId: run._id,
      status: "completed",
      content: finalContent,
      reasoning: result.streamResult.reasoning || writer.totalReasoning || undefined,
      usage: result.totalUsage ?? result.streamResult.usage ?? undefined,
      toolCalls: result.allToolCalls.length > 0 ? result.allToolCalls : undefined,
      toolResults: result.allToolResults.length > 0 ? result.allToolResults : undefined,
      generatedFiles: extractGeneratedFiles(result.allToolResults),
      generatedCharts: extractGeneratedCharts(result.allToolResults),
    });

    // M23: Track subagent generation cost against the parent message using the
    // subagent's own modelId so ancillary cost breakdowns reflect the actual
    // model that generated this child run.
    const subagentUsage = result.totalUsage ?? result.streamResult.usage;
    if (subagentUsage) {
      await ctx.scheduler.runAfter(0, internal.chat.mutations.storeAncillaryCost, {
        messageId: batch.parentMessageId,
        chatId: batch.chatId,
        userId: batch.userId,
        modelId,
        promptTokens: subagentUsage.promptTokens,
        completionTokens: subagentUsage.completionTokens,
        totalTokens: subagentUsage.totalTokens,
        cost: subagentUsage.cost ?? undefined,
        source: "subagent",
        generationId: result.streamResult.generationId ?? undefined,
      });
    }

    if (finalizeResult?.allTerminal) {
      const didMark = await ctx.runMutation(internal.subagents.mutations.updateBatchStatus, {
        batchId: finalizeResult.batchId,
        status: "waiting_to_resume",
        expectedCurrentStatus: "running_children",
        continuationScheduledAt: Date.now(),
      });
      if (didMark) {
        await ctx.scheduler.runAfter(0, internal.subagents.actions.continueParentAfterSubagents, {
          batchId: finalizeResult.batchId,
        });
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const status = isGenerationCancelledError(error) ? "cancelled" : "failed";
    const finalizeResult = await ctx.runMutation(internal.subagents.mutations.finalizeRun, {
      runId: run._id,
      status,
      content: writer.totalContent || undefined,
      reasoning: writer.totalReasoning || undefined,
      error: errorMessage,
    });
    if (finalizeResult?.allTerminal) {
      const didMark = await ctx.runMutation(internal.subagents.mutations.updateBatchStatus, {
        batchId: finalizeResult.batchId,
        status: "waiting_to_resume",
        expectedCurrentStatus: "running_children",
        continuationScheduledAt: Date.now(),
      });
      if (didMark) {
        await ctx.scheduler.runAfter(0, internal.subagents.actions.continueParentAfterSubagents, {
          batchId: finalizeResult.batchId,
        });
      }
    }
  } finally {
    // Stop the workspace (just-bash) sandbox — it is per-generation, not persistent.
    await subagentToolCtx.workspaceSandboxCleanup?.().catch(() => {});
    // NOTE: The Vercel sandbox is NOT stopped here. It is a per-chat persistent
    // session (shared with the parent generation) that must survive across turns.
    // Idle VMs are reaped by the cleanStaleSandboxSessions cron.
  }
}
