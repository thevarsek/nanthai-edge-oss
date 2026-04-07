"use node";

import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { ToolExecutionContext } from "../tools/registry";
import { exportWorkspaceFile } from "./service_artifacts";
import { ensureSandboxForChat, markSandboxSessionRunning } from "./service";
import { importOwnedStorageFileToWorkspace } from "./storage";
import {
  buildChartDataArtifact,
  buildChartPreviewArtifact,
  normalizeE2BChart,
  NormalizedGeneratedChart,
  RuntimeArtifactBlob,
} from "./service_analytics_charts";
import {
  RUNTIME_MAX_CHARTS_PER_TOOL_CALL,
  RUNTIME_MAX_EXPORTED_FILES_PER_TOOL_CALL,
  runtimeWorkspacePaths,
} from "./shared";
import { DeepPartial, mergeTestDeps } from "../lib/test_deps";

const defaultRuntimeAnalyticsDeps = {
  exportWorkspaceFile,
  ensureSandboxForChat,
  markSandboxSessionRunning,
  importOwnedStorageFileToWorkspace,
  buildChartDataArtifact,
  buildChartPreviewArtifact,
  normalizeE2BChart,
};

export type RuntimeAnalyticsDeps = typeof defaultRuntimeAnalyticsDeps;

export function createRuntimeAnalyticsDepsForTest(
  overrides: DeepPartial<RuntimeAnalyticsDeps> = {},
): RuntimeAnalyticsDeps {
  return mergeTestDeps(defaultRuntimeAnalyticsDeps, overrides);
}

function requireChatId(toolCtx: ToolExecutionContext): string {
  if (!toolCtx.chatId) {
    throw new ConvexError({ code: "INTERNAL_ERROR" as const, message: "Workspace tools require chatId in the tool execution context." });
  }
  return toolCtx.chatId;
}

function buildRuntimeShim(chatId: string): string {
  const workspace = runtimeWorkspacePaths(chatId);
  return [
    "import os",
    "import matplotlib",
    "matplotlib.use('Agg')",
    `workspace_root = ${JSON.stringify(workspace.root)}`,
    `inputs_dir = ${JSON.stringify(workspace.inputs)}`,
    `outputs_dir = ${JSON.stringify(workspace.outputs)}`,
    `charts_dir = ${JSON.stringify(workspace.charts)}`,
    "for directory in (workspace_root, inputs_dir, outputs_dir, charts_dir):",
    "    os.makedirs(directory, exist_ok=True)",
    "os.chdir(workspace_root)",
    "",
  ].join("\n");
}

function summarizeExecutionResults(results: any[]): string[] {
  return results.map((result, index) => {
    const formats = typeof result?.formats === "function" ? result.formats() : [];
    const parts = [`result ${index + 1}`];
    if (typeof result?.text === "string" && result.text.trim().length > 0) {
      parts.push(`text=${result.text.trim().slice(0, 120)}`);
    }
    if (result?.chart) parts.push(`chart=${result.chart.type}`);
    if (result?.png) parts.push("png");
    if (formats.length > 0) parts.push(`formats=${formats.join(",")}`);
    return parts.join(" | ");
  });
}

async function storeDurableArtifact(
  toolCtx: ToolExecutionContext,
  sessionId: Id<"sandboxSessions">,
  path: string,
  artifact: RuntimeArtifactBlob,
) {
  const chatId = requireChatId(toolCtx);
  const storageId = await toolCtx.ctx.storage.store(artifact.blob);
  await toolCtx.ctx.runMutation(internal.runtime.mutations.recordSandboxArtifactInternal, {
    userId: toolCtx.userId,
    chatId: chatId as Id<"chats">,
    sandboxSessionId: sessionId,
    path,
    filename: artifact.filename,
    mimeType: artifact.mimeType,
    sizeBytes: artifact.blob.size,
    storageId,
    isDurable: true,
  });
  return {
    path,
    filename: artifact.filename,
    mimeType: artifact.mimeType,
    sizeBytes: artifact.blob.size,
    storageId,
    toolName: "data_python_exec",
  };
}

export async function runDataPythonExec(
  toolCtx: ToolExecutionContext,
  args: {
    code: string;
    inputFiles?: Array<{ storageId: string; filename?: string }>;
    exportPaths?: string[];
    captureCharts?: boolean;
    timeoutMs?: number;
  },
  deps: RuntimeAnalyticsDeps = defaultRuntimeAnalyticsDeps,
) {
  const chatId = requireChatId(toolCtx);
  const session = await deps.ensureSandboxForChat(toolCtx);
  const importedFiles = [];
  for (const file of args.inputFiles ?? []) {
    importedFiles.push(await deps.importOwnedStorageFileToWorkspace(
      toolCtx,
      file.storageId,
      file.filename,
      undefined,
    ));
  }

  const execution = await session.sandbox.runCode(
    `${buildRuntimeShim(chatId)}\n${args.code}`,
    { timeoutMs: args.timeoutMs ?? 120_000 },
  );
  await deps.markSandboxSessionRunning(toolCtx, session);

  if (execution.error) {
    throw new ConvexError({ code: "INTERNAL_ERROR" as const, message: `${execution.error.name}: ${execution.error.value}` });
  }

  const warnings: string[] = [];
  const exportedFiles: Array<{
    path: string;
    filename: string;
    mimeType: string;
    sizeBytes?: number;
    storageId: string;
    toolName: string;
  }> = [];
  const chartsCreated: NormalizedGeneratedChart[] = [];
  const results = Array.isArray(execution.results) ? execution.results : [];

  if (args.captureCharts !== false) {
    const limitedResults = results.slice(0, RUNTIME_MAX_CHARTS_PER_TOOL_CALL);
    if (results.length > limitedResults.length) {
      warnings.push(`Only the first ${RUNTIME_MAX_CHARTS_PER_TOOL_CALL} charts were persisted.`);
    }

    for (const [index, result] of limitedResults.entries()) {
      if (result?.chart) {
        const normalized = deps.normalizeE2BChart(result.chart);
        if (normalized) {
          chartsCreated.push(normalized);
          if (result.png && exportedFiles.length < RUNTIME_MAX_EXPORTED_FILES_PER_TOOL_CALL) {
            exportedFiles.push(await storeDurableArtifact(
              toolCtx,
              session.sessionId as Id<"sandboxSessions">,
              `${runtimeWorkspacePaths(chatId).charts}/${index + 1}.png`,
              deps.buildChartPreviewArtifact(
                result.png,
                index + 1,
                normalized.title,
              ),
            ));
          }
          const companion = deps.buildChartDataArtifact(
            normalized,
            index + 1,
          );
          if (companion && exportedFiles.length < RUNTIME_MAX_EXPORTED_FILES_PER_TOOL_CALL) {
            exportedFiles.push(await storeDurableArtifact(
              toolCtx,
              session.sessionId as Id<"sandboxSessions">,
              `${runtimeWorkspacePaths(chatId).charts}/${companion.filename}`,
              companion,
            ));
          }
        } else if (result.png && exportedFiles.length < RUNTIME_MAX_EXPORTED_FILES_PER_TOOL_CALL) {
          warnings.push(`Chart ${index + 1} could not be normalized for native rendering.`);
          exportedFiles.push(await storeDurableArtifact(
            toolCtx,
            session.sessionId as Id<"sandboxSessions">,
            `${runtimeWorkspacePaths(chatId).charts}/${index + 1}.png`,
            deps.buildChartPreviewArtifact(result.png, index + 1),
          ));
        }
      } else if (result?.png && exportedFiles.length < RUNTIME_MAX_EXPORTED_FILES_PER_TOOL_CALL) {
        exportedFiles.push(await storeDurableArtifact(
          toolCtx,
          session.sessionId as Id<"sandboxSessions">,
          `${runtimeWorkspacePaths(chatId).charts}/${index + 1}.png`,
          deps.buildChartPreviewArtifact(result.png, index + 1),
        ));
      }
    }
  }

  for (const exportPath of args.exportPaths ?? []) {
    if (exportedFiles.length >= RUNTIME_MAX_EXPORTED_FILES_PER_TOOL_CALL) {
      warnings.push(`Only the first ${RUNTIME_MAX_EXPORTED_FILES_PER_TOOL_CALL} exported files were persisted.`);
      break;
    }
    const exported = await deps.exportWorkspaceFile(
      toolCtx,
      exportPath,
    );
    exportedFiles.push({
      path: exported.path,
      filename: exported.filename,
      mimeType: exported.mimeType,
      sizeBytes: exported.sizeBytes,
      storageId: exported.storageId,
      toolName: "data_python_exec",
    });
  }

  await toolCtx.ctx.runMutation(internal.runtime.mutations.recordSandboxEventInternal, {
    sandboxSessionId: session.sessionId as Id<"sandboxSessions">,
    userId: toolCtx.userId,
    chatId: chatId as Id<"chats">,
    eventType: "data_python_exec_completed",
    details: {
      importedCount: importedFiles.length,
      exportedCount: exportedFiles.length,
      chartCount: chartsCreated.length,
    },
  });

  return {
    text: execution.text ?? execution.logs.stdout.join("\n"),
    resultsSummary: summarizeExecutionResults(results),
    importedFiles,
    exportedFiles,
    chartsCreated,
    warnings,
    logs: execution.logs,
  };
}
