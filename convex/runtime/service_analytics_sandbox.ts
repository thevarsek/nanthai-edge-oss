"use node";

// convex/runtime/service_analytics_sandbox.ts
// =============================================================================
// Heavy Python analytics via Vercel Sandbox.
//
// data_python_sandbox: runs Python code in a persistent Vercel Sandbox VM.
// Sessions are tracked per chat in `sandboxSessions`. Packages can be installed
// with pip. scipy, scikit-learn, large datasets, and multi-step pipelines are
// all supported.
//
// When a session already exists for the chat, the sandbox is resumed and state
// (installed packages, filesystem) is preserved.
// =============================================================================

import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import { ToolExecutionContext } from "../tools/registry";
import { runVercelSandboxCode } from "./vercel_sandbox_client";
import { storeArtifactBytes } from "./service_artifacts";
import { resolveOwnedStorageFile } from "./storage";
import {
  buildChartPreviewArtifact,
  type NormalizedGeneratedChart,
} from "./service_analytics_charts";
import { DeepPartial, mergeTestDeps } from "../lib/test_deps";
import { processCharts, processOutputFiles, buildResultSummary, type StoredFileEntry } from "./service_analytics_common";

// ---------------------------------------------------------------------------
// Dependency injection (for testing)
// ---------------------------------------------------------------------------

const defaultRuntimeSandboxDeps = {
  runVercelSandboxCode,
  storeArtifactBytes,
  resolveOwnedStorageFile,
  buildChartPreviewArtifact,
};

export type RuntimeSandboxDeps = typeof defaultRuntimeSandboxDeps;

export function createRuntimeSandboxDepsForTest(
  overrides: DeepPartial<RuntimeSandboxDeps> = {},
): RuntimeSandboxDeps {
  return mergeTestDeps(defaultRuntimeSandboxDeps, overrides);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireChatId(toolCtx: ToolExecutionContext): string {
  if (!toolCtx.chatId) {
    throw new ConvexError({
      code: "INTERNAL_ERROR" as const,
      message: "Workspace tools require chatId in the tool execution context.",
    });
  }
  return toolCtx.chatId;
}

// Common data-science packages that are NOT pre-installed in the Vercel
// Sandbox python3.13 runtime. If the model's code imports one of these and
// the model forgot to include them in `packages`, we auto-add them to avoid
// a ModuleNotFoundError on first run.
const AUTO_DETECT_PACKAGES: Record<string, string> = {
  pandas: "pandas",
  numpy: "numpy",
  matplotlib: "matplotlib",
  scipy: "scipy",
  sklearn: "scikit-learn",
  seaborn: "seaborn",
  plotly: "plotly",
  openpyxl: "openpyxl",
  xlsxwriter: "xlsxwriter",
};

/**
 * Scan Python code for `import X` / `from X import ...` statements and return
 * pip package names that should be installed.
 */
function detectPackagesFromCode(code: string): string[] {
  const detected = new Set<string>();
  // Match `import foo` and `from foo import ...` (top-level module only)
  const importRe = /(?:^|\n)\s*(?:import|from)\s+([a-zA-Z_]\w*)/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(code)) !== null) {
    const mod = m[1];
    if (mod in AUTO_DETECT_PACKAGES) {
      detected.add(AUTO_DETECT_PACKAGES[mod]);
    }
  }
  return Array.from(detected);
}

// ---------------------------------------------------------------------------
// runDataPythonSandbox
// ---------------------------------------------------------------------------

export async function runDataPythonSandbox(
  toolCtx: ToolExecutionContext,
  args: {
    code: string;
    inputFiles?: Array<{ storageId: string; filename?: string }>;
    exportPaths?: string[];
    captureCharts?: boolean;
    packages?: string[];
    timeoutMs?: number;
  },
  deps: RuntimeSandboxDeps = defaultRuntimeSandboxDeps,
): Promise<{
  text: string;
  resultsSummary: string[];
  importedFiles: unknown[];
  exportedFiles: StoredFileEntry[];
  chartsCreated: NormalizedGeneratedChart[];
  warnings: string[];
}> {
  const chatId = requireChatId(toolCtx);

  const warnings: string[] = [];
  const importedFiles: unknown[] = [];
  const exportedFiles: StoredFileEntry[] = [];
  // chartsCreated is intentionally empty. Chart PNGs are stored in
  // exportedFiles and rendered inline via download URL in markdown.
  // The native chart card UI (generatedCharts table) is not populated —
  // it would duplicate the inline image with no additional value since
  // sandbox charts are PNG-only (no structured data).
  const chartsCreated: NormalizedGeneratedChart[] = [];

  // Look up existing sandbox session for this chat
  const existingSession = await toolCtx.ctx.runQuery(
    internal.runtime.queries.getSessionByChatInternal,
    { userId: toolCtx.userId, chatId: chatId as any, environment: "python" },
  );

  const existingSandboxId =
    existingSession?.provider === "vercel" &&
    existingSession?.status === "running" &&
    existingSession?.providerSandboxId
      ? existingSession.providerSandboxId
      : undefined;

  // Resolve input files from Convex storage
  const inputFilesForSandbox: Array<{ path: string; bytes: Uint8Array }> = [];
  if (args.inputFiles && args.inputFiles.length > 0) {
    for (const inputFile of args.inputFiles) {
      try {
        const { record, blob } = await deps.resolveOwnedStorageFile(toolCtx, inputFile.storageId);
        const finalFilename = inputFile.filename?.trim() || record.filename;
        const inputPath = `/tmp/inputs/${finalFilename}`;
        const arrayBuffer = await blob.arrayBuffer();
        inputFilesForSandbox.push({ path: inputPath, bytes: new Uint8Array(arrayBuffer) });
        importedFiles.push({ path: inputPath, filename: finalFilename, sizeBytes: record.sizeBytes ?? blob.size });
      } catch (err) {
        warnings.push(
          `Failed to import file ${inputFile.storageId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  // Auto-detect common packages from import statements and merge with explicit list
  const autoDetected = detectPackagesFromCode(args.code);
  const explicitPkgs = args.packages ?? [];
  const explicitSet = new Set(explicitPkgs.map((p) => p.toLowerCase()));
  const mergedPackages = [
    ...explicitPkgs,
    ...autoDetected.filter((p) => !explicitSet.has(p.toLowerCase())),
  ];

  // When chart capture is enabled, the chart shim imports matplotlib.
  // Ensure it's pre-installed via runCommand so the shim's fallback
  // subprocess.run(pip install) doesn't become the sole install path
  // (which can fail and crash the entire script with check=True).
  const captureCharts = args.captureCharts ?? true;
  if (captureCharts && !mergedPackages.some((p) => p.toLowerCase() === "matplotlib")) {
    mergedPackages.push("matplotlib");
  }

  // Run in Vercel Sandbox
  const result = await deps.runVercelSandboxCode(
    args.code,
    existingSandboxId,
    inputFilesForSandbox.length > 0 ? inputFilesForSandbox : undefined,
    captureCharts,
    mergedPackages.length > 0 ? mergedPackages : undefined,
    args.timeoutMs,
    args.exportPaths,
  );

  // NOTE: We intentionally do NOT stop the Vercel sandbox here or register a
  // cleanup function. The sandbox is a per-chat persistent session — stopping
  // it would discard installed packages, files, and state between turns. Idle
  // VMs are reaped by the cleanStaleSandboxSessions cron (30-min interval,
  // 1-hr idle threshold).

  // Persist / update the session record and link artifacts to the session.
  try {
    const now = Date.now();
    if (existingSession && existingSession.providerSandboxId === result.sandboxId) {
      // Existing session — just update lastActiveAt.
      // Always keep status "running" — a Python script error does NOT mean
      // the sandbox VM is dead. Marking "failed" would prevent session reuse
      // and lose installed packages/files.
      await toolCtx.ctx.runMutation(
        internal.runtime.mutations.upsertSessionInternal,
        {
          sessionId: existingSession._id,
          userId: toolCtx.userId,
          chatId: chatId as any,
          environment: "python",
          providerSandboxId: result.sandboxId,
          status: "running",
          cwd: "/tmp",
          lastActiveAt: now,
          timeoutMs: args.timeoutMs ?? 5 * 60 * 1000,
          internetEnabled: true,
          publicTrafficEnabled: false,
        },
      );
      toolCtx.sandboxSessionId = existingSession._id;
    } else {
      // New sandbox — insert record.
      // Same rationale: script errors don't kill the VM.
      const sessionId = await toolCtx.ctx.runMutation(
        internal.runtime.mutations.upsertSessionInternal,
        {
          userId: toolCtx.userId,
          chatId: chatId as any,
          environment: "python",
          providerSandboxId: result.sandboxId,
          status: "running",
          cwd: "/tmp",
          lastActiveAt: now,
          timeoutMs: args.timeoutMs ?? 5 * 60 * 1000,
          internetEnabled: true,
          publicTrafficEnabled: false,
        },
      );
      toolCtx.sandboxSessionId = sessionId;
    }
  } catch (sessionErr) {
    // Non-fatal — session tracking failure should not block tool result
    warnings.push(
      `Session tracking failed: ${sessionErr instanceof Error ? sessionErr.message : String(sessionErr)}`,
    );
  }

  // If execution failed, return error text
  if (result.error) {
    const lines: string[] = [];
    if (result.stdout) lines.push("stdout:\n" + result.stdout);
    if (result.stderr) lines.push("stderr:\n" + result.stderr);
    lines.push(result.error);

    return {
      text: lines.join("\n\n"),
      resultsSummary: [result.error],
      importedFiles,
      exportedFiles,
      chartsCreated,
      warnings,
    };
  }

  // Process charts — store PNGs in Convex storage (images render inline via
  // download URL in the model's markdown response).
  await processCharts(toolCtx, result.charts, exportedFiles, warnings, deps);

  // Collect output files — store in Convex durable storage for download.
  // Limit to RUNTIME_MAX_EXPORTED_FILES_PER_TOOL_CALL (minus charts already stored).
  await processOutputFiles(toolCtx, result.outputFiles, exportedFiles, warnings, deps);

  // Build text summary
  const chartCount = result.charts.slice(0, 5).length;
  const summary = buildResultSummary(result.stdout, result.stderr, chartCount, exportedFiles, warnings);

  return {
    text: summary.join("\n\n") || "Code executed successfully (no output).",
    resultsSummary: summary,
    importedFiles,
    exportedFiles,
    chartsCreated,
    warnings,
  };
}
