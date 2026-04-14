"use node";

// convex/runtime/vercel_sandbox_client.ts
// =============================================================================
// Vercel Sandbox client for data_python_sandbox.
//
// Wraps the @vercel/sandbox SDK. Provides:
//   - createVercelSandbox() — spin up a new Python 3.13 sandbox
//   - resumeVercelSandbox() — reconnect to an existing sandbox by ID
//   - runVercelSandboxCode() — full execution entry point (create or resume,
//     inject files, run code, collect output + charts + export files)
//
// Authentication: set VERCEL_SANDBOX_TOKEN Convex environment variable.
// Sandboxes use the `python3.13` runtime preset.
//
// Session tracking: the caller is responsible for persisting `sandbox.sandboxId`
// in the `sandboxSessions` table between tool calls. Pass `existingSandboxId`
// to resume a session.
// =============================================================================

import { Sandbox } from "@vercel/sandbox";
import { guessMimeTypeFromPath } from "./shared";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 min
const CHART_DIR = "/tmp/_nanthai_charts";
const AUTO_CAPTURE_DIR = "/tmp/outputs";

export type VercelSandboxEnvironment = "python" | "node";

// ---------------------------------------------------------------------------
// Public result type
// ---------------------------------------------------------------------------

export interface VercelSandboxExecResult {
  sandboxId: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  error: string | null;
  charts: Array<{ pngBytes: Uint8Array; index: number }>;
  outputFiles: Array<{ path: string; bytes: Uint8Array; mimeType: string }>;
  /**
   * The live Sandbox instance. Callers should store a reference and call
   * `sandbox.stop()` when the generation ends to avoid wasting VM minutes.
   * If null, the sandbox could not be retained (should not happen in practice).
   */
  sandbox: Sandbox | null;
}

// ---------------------------------------------------------------------------
// Chart capture shim (same logic as pyodide_client.ts)
// ---------------------------------------------------------------------------

const CHART_CAPTURE_SHIM = `
import subprocess, sys
# Ensure matplotlib is installed
try:
    import matplotlib
except ImportError:
    subprocess.run([sys.executable, "-m", "pip", "install", "matplotlib", "-q"], check=True)
    import matplotlib

import os as _os
import io as _io
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as _plt_orig

_nanthai_chart_dir = '${CHART_DIR}'
# resetSandboxDir() already cleared this directory before the shim runs.
# makedirs is a no-op safety net in case the reset was skipped.
_os.makedirs(_nanthai_chart_dir, exist_ok=True)
_nanthai_chart_index = [0]

def _nanthai_show(*args, **kwargs):
    for fig in _plt_orig.get_fignums():
        _buf = _io.BytesIO()
        _plt_orig.figure(fig).savefig(_buf, format='png', dpi=100, bbox_inches='tight')
        _plt_orig.close(fig)
        _buf.seek(0)
        _path = f'{_nanthai_chart_dir}/chart_{_nanthai_chart_index[0]}.png'
        with open(_path, 'wb') as _f:
            _f.write(_buf.read())
        _nanthai_chart_index[0] += 1

_plt_orig.show = _nanthai_show
import matplotlib.pyplot as plt
`.trimStart();

// ---------------------------------------------------------------------------
// Setup shim — always prepended to user code.
// Creates /tmp/outputs/ so the model can save files there without boilerplate.
// ---------------------------------------------------------------------------

const SETUP_SHIM = `
import os as _os
# Ensure /tmp/outputs/ exists so the model can save files without boilerplate.
# Stale files from previous turns are filtered out by the snapshot diff in
# the TypeScript layer (snapshotSandboxFiles before vs after execution).
_os.makedirs('/tmp/outputs', exist_ok=True)
`.trimStart();

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

export function getVercelCredentials(): {
  token: string;
  projectId: string;
  teamId: string;
} {
  const token = process.env.VERCEL_SANDBOX_TOKEN?.trim();
  const projectId = process.env.VERCEL_SANDBOX_PROJECT_ID?.trim();
  const teamId = process.env.VERCEL_SANDBOX_TEAM_ID?.trim();

  if (!token || !projectId || !teamId) {
    const missing = [
      !token && "VERCEL_SANDBOX_TOKEN",
      !projectId && "VERCEL_SANDBOX_PROJECT_ID",
      !teamId && "VERCEL_SANDBOX_TEAM_ID",
    ].filter(Boolean).join(", ");
    throw new Error(`Vercel Sandbox not configured: missing ${missing}`);
  }

  return { token, projectId, teamId };
}

const SNAPSHOT_FILES_SCRIPT = [
  "import hashlib, json, pathlib, sys",
  "root = pathlib.Path(sys.argv[1])",
  "out = []",
  "if root.exists():",
  "    for child in sorted(root.iterdir()):",
  "        if child.is_file():",
  "            stat = child.stat()",
  "            out.append({",
  "                'path': str(child),",
  "                'signature': f\"{stat.st_mtime_ns}:{stat.st_size}:{hashlib.sha256(child.read_bytes()).hexdigest()}\",",
  "            })",
  "print(json.dumps(out))",
].join("\n");

const RESET_DIR_SCRIPT = [
  "import pathlib, shutil, sys",
  "root = pathlib.Path(sys.argv[1])",
  "shutil.rmtree(root, ignore_errors=True)",
  "root.mkdir(parents=True, exist_ok=True)",
].join("\n");

async function snapshotSandboxFiles(
  sandbox: Sandbox,
  dirPath: string,
): Promise<Map<string, string>> {
  try {
    const result = await sandbox.runCommand("python3", [
      "-c",
      SNAPSHOT_FILES_SCRIPT,
      dirPath,
    ]);
    const stdout = await result.stdout();
    const entries = JSON.parse(stdout) as Array<{ path?: string; signature?: string }>;
    return new Map(
      entries
        .filter((entry) => typeof entry.path === "string" && typeof entry.signature === "string")
        .map((entry) => [entry.path!, entry.signature!]),
    );
  } catch {
    return new Map();
  }
}

async function resetSandboxDir(
  sandbox: Sandbox,
  dirPath: string,
): Promise<void> {
  await sandbox.runCommand("python3", [
    "-c",
    RESET_DIR_SCRIPT,
    dirPath,
  ]);
}

export function vercelSandboxRuntime(environment: VercelSandboxEnvironment): "python3.13" | "node24" {
  return environment === "node" ? "node24" : "python3.13";
}

export async function createVercelSandbox(
  timeoutMs: number,
  environment: VercelSandboxEnvironment = "python",
): Promise<Sandbox> {
  const credentials = getVercelCredentials();
  return await Sandbox.create({
    runtime: vercelSandboxRuntime(environment),
    timeout: timeoutMs,
    ...credentials,
  });
}

export async function resumeVercelSandbox(sandboxId: string): Promise<Sandbox> {
  const credentials = getVercelCredentials();
  return await Sandbox.get({
    sandboxId,
    ...credentials,
  });
}

export async function getOrCreateVercelSandbox(
  existingSandboxId: string | undefined,
  timeoutMs: number,
  environment: VercelSandboxEnvironment = "python",
): Promise<Sandbox> {
  if (existingSandboxId) {
    try {
      const sandbox = await resumeVercelSandbox(existingSandboxId);
      await sandbox.extendTimeout(timeoutMs).catch(() => {});
      return sandbox;
    } catch {
      return createVercelSandbox(timeoutMs, environment);
    }
  }
  return createVercelSandbox(timeoutMs, environment);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function runVercelSandboxCode(
  code: string,
  existingSandboxId?: string,
  inputFiles?: Array<{ path: string; bytes: Uint8Array }>,
  captureCharts?: boolean,
  packages?: string[],
  timeoutMs?: number,
  exportPaths?: string[],
): Promise<VercelSandboxExecResult> {
  const effectiveTimeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const sandbox = await getOrCreateVercelSandbox(
    existingSandboxId,
    effectiveTimeout,
    "python",
  );

  const sandboxId = sandbox.sandboxId;
  const outputSnapshot = await snapshotSandboxFiles(sandbox, AUTO_CAPTURE_DIR);

  // Install pip packages (idempotent — pip is fast for already-installed packages)
  if (packages && packages.length > 0) {
    try {
      await sandbox.runCommand("pip", ["install", "-q", ...packages]);
    } catch (err) {
      console.warn("[sandbox] pip install failed:", err instanceof Error ? err.message : String(err));
    }
  }

  // Write input files
  if (inputFiles && inputFiles.length > 0) {
    // Ensure the /tmp/inputs/ directory exists before writing files
    try {
      await sandbox.runCommand("mkdir", ["-p", "/tmp/inputs"]);
    } catch {
      // directory may already exist
    }
    const filesToWrite = inputFiles.map((f) => ({
      path: f.path,
      content: f.bytes,
    }));
    try {
      await sandbox.writeFiles(filesToWrite);
    } catch (err) {
      console.error("[sandbox] writeFiles failed:", err instanceof Error ? err.message : String(err));
    }
  }

  if (captureCharts) {
    await resetSandboxDir(sandbox, CHART_DIR).catch(() => {
      // If chart dir reset fails, execution can still continue. Worst case:
      // no charts are collected for this run.
    });
  }

  // Build final code: always prepend setup shim (creates /tmp/outputs/),
  // optionally prepend chart shim if requested.
  const chartShim = captureCharts ? CHART_CAPTURE_SHIM + "\n" : "";
  const finalCode = SETUP_SHIM + chartShim + code;

  // Write code to a temp file and run it
  const codeFile = "/tmp/_nanthai_run.py";
  await sandbox.writeFiles([{ path: codeFile, content: finalCode }]);

  let execResult: { stdout: string; stderr: string; exitCode: number; error: string | null };
  try {
    const result = await sandbox.runCommand("python3", [codeFile], {
      signal: AbortSignal.timeout(effectiveTimeout),
    });

    const stdout = await result.stdout();
    const stderr = await result.stderr();

    execResult = {
      stdout,
      stderr,
      exitCode: result.exitCode,
      error: result.exitCode !== 0
        ? `Process exited with code ${result.exitCode}${stderr ? `\n${stderr}` : ""}`
        : null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    execResult = {
      stdout: "",
      stderr: message,
      exitCode: 1,
      error: /timed? ?out|abort/i.test(message)
        ? `Execution timed out after ${effectiveTimeout}ms.`
        : message,
    };
  }

  // Collect charts if requested and execution succeeded
  const charts: Array<{ pngBytes: Uint8Array; index: number }> = [];
  if (captureCharts && !execResult.error) {
    try {
      const listResult = await sandbox.runCommand("bash", ["-c", `ls ${CHART_DIR}/*.png 2>/dev/null | sort`]);
      const lsStdout = await listResult.stdout();
      const chartFiles = lsStdout
        .split("\n")
        .map((f) => f.trim())
        .filter((f) => f.endsWith(".png"))
        .sort();

      for (let i = 0; i < chartFiles.length; i++) {
        try {
          const buf = await sandbox.readFileToBuffer({ path: chartFiles[i] });
          if (buf) {
            charts.push({ pngBytes: new Uint8Array(buf), index: i });
          }
        } catch { /* skip unreadable */ }
      }
    } catch { /* chart dir may not exist */ }
  }

  // Collect exported files if requested and execution succeeded
  const outputFiles: Array<{ path: string; bytes: Uint8Array; mimeType: string }> = [];

  // 1. Explicit exportPaths (model-specified)
  if (exportPaths && exportPaths.length > 0 && !execResult.error) {
    for (const exportPath of exportPaths) {
      try {
        const buf = await sandbox.readFileToBuffer({ path: exportPath });
        if (buf) {
          outputFiles.push({
            path: exportPath,
            bytes: new Uint8Array(buf),
            mimeType: guessMimeTypeFromPath(exportPath),
          });
        }
      } catch { /* skip missing/unreadable export files */ }
    }
  }

  // 2. Auto-capture: scan /tmp/outputs/ for any files the code wrote there.
  //    This makes CSV/JSON/etc. exports "just work" without requiring the model
  //    to pass exportPaths — the model only needs to write to /tmp/outputs/.
  if (!execResult.error) {
    const alreadyCaptured = new Set(outputFiles.map((f) => f.path));
    try {
      const afterSnapshot = await snapshotSandboxFiles(sandbox, AUTO_CAPTURE_DIR);
      const autoFiles = Array.from(afterSnapshot.entries())
        .filter(([filePath, hash]) =>
          outputSnapshot.get(filePath) !== hash && !alreadyCaptured.has(filePath),
        )
        .map(([filePath]) => filePath)
        .sort();

      for (const filePath of autoFiles) {
        try {
          const buf = await sandbox.readFileToBuffer({ path: filePath });
          if (buf) {
            outputFiles.push({
              path: filePath,
              bytes: new Uint8Array(buf),
              mimeType: guessMimeTypeFromPath(filePath),
            });
          }
        } catch { /* skip unreadable files */ }
      }
    } catch { /* /tmp/outputs/ may not exist */ }
  }

  return {
    sandboxId,
    stdout: execResult.stdout,
    stderr: execResult.stderr,
    exitCode: execResult.exitCode,
    error: execResult.error,
    charts,
    outputFiles,
    sandbox,
  };
}
