"use node";

// convex/runtime/justbash_client.ts
// =============================================================================
// Thin wrapper around just-bash `Sandbox` for workspace tool calls.
//
// A single Sandbox is created per generation run and shared across all tool
// calls. Every exported function receives the shared sandbox as its first
// parameter — no per-call creation or teardown.
//
// The factory `createWorkspaceSandbox()` is called once at the start (lazily on
// first workspace tool use) and `sandbox.stop()` is called in the generation
// cleanup path.
// =============================================================================

import { Sandbox, type WriteFilesInput } from "just-bash";

export interface JustBashCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export interface JustBashFileEntry {
  name: string;
  path: string;
  type: "file" | "dir";
}

export interface JustBashReadResult {
  content: string;
  sizeBytes: number;
  truncated: boolean;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes — matches generation timeout
const DEFAULT_MAX_READ_BYTES = 64_000;

// ---------------------------------------------------------------------------
// Factory — one sandbox per generation
// ---------------------------------------------------------------------------

/**
 * Create the shared workspace sandbox for a generation run.
 * Call once, reuse for all workspace tool calls, then call `sandbox.stop()`.
 */
export async function createWorkspaceSandbox(opts?: {
  timeoutMs?: number;
  cwd?: string;
}): Promise<Sandbox> {
  return Sandbox.create({
    timeoutMs: opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    cwd: opts?.cwd,
  });
}

// ---------------------------------------------------------------------------
// Operations — all take a pre-existing sandbox
// ---------------------------------------------------------------------------

/**
 * Run a shell command on the shared sandbox.
 * Accepts an optional per-command timeout (AbortSignal.timeout).
 */
export async function runCommandInSandbox(
  sandbox: Sandbox,
  command: string,
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<JustBashCommandResult> {
  const startedAt = Date.now();
  // We use the RunCommandParams object overload because it's the only one that
  // supports both `cwd` AND `signal`. The object overload treats `cmd` as a
  // binary name (not a shell command line), so we wrap with bash -c to get
  // proper shell parsing (pipes, redirects, &&, etc.).
  const signal = opts.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : undefined;
  const finished = await sandbox.runCommand({
    cmd: "bash",
    args: ["-c", command],
    cwd: opts.cwd,
    signal,
  });
  const stdout = await finished.stdout();
  const stderr = await finished.stderr();
  return {
    stdout,
    stderr,
    exitCode: finished.exitCode,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * List files in a directory on the shared sandbox.
 * Uses the sandbox's in-memory filesystem directly.
 */
export async function listFilesInSandbox(
  sandbox: Sandbox,
  dirPath: string,
  opts: { recursive?: boolean } = {},
): Promise<JustBashFileEntry[]> {
  // Use `find` with -type to classify files and directories in a single
  // round-trip, avoiding N+1 `test -d` calls per entry.
  const fileCmd = opts.recursive
    ? `find '${dirPath.replace(/'/g, "'\\''")}' -mindepth 1 -type f 2>/dev/null || true`
    : `find '${dirPath.replace(/'/g, "'\\''")}' -mindepth 1 -maxdepth 1 -type f 2>/dev/null || true`;
  const dirCmd = opts.recursive
    ? `find '${dirPath.replace(/'/g, "'\\''")}' -mindepth 1 -type d 2>/dev/null || true`
    : `find '${dirPath.replace(/'/g, "'\\''")}' -mindepth 1 -maxdepth 1 -type d 2>/dev/null || true`;

  const [fileResult, dirResult] = await Promise.all([
    runCommandInSandbox(sandbox, fileCmd),
    runCommandInSandbox(sandbox, dirCmd),
  ]);

  const entries: JustBashFileEntry[] = [];
  const dirPaths = new Set<string>();

  if (dirResult.exitCode === 0 && dirResult.stdout.trim()) {
    for (const line of dirResult.stdout.trim().split("\n")) {
      const fullPath = line.trim();
      if (!fullPath) continue;
      dirPaths.add(fullPath);
      const name = fullPath.split("/").pop() || fullPath;
      entries.push({ name, path: fullPath, type: "dir" });
    }
  }

  if (fileResult.exitCode === 0 && fileResult.stdout.trim()) {
    for (const line of fileResult.stdout.trim().split("\n")) {
      const fullPath = line.trim();
      if (!fullPath) continue;
      const name = fullPath.split("/").pop() || fullPath;
      entries.push({ name, path: fullPath, type: "file" });
    }
  }

  return entries;
}

/**
 * Read a file from the shared sandbox.
 */
export async function readFileInSandbox(
  sandbox: Sandbox,
  filePath: string,
  maxBytes: number = DEFAULT_MAX_READ_BYTES,
): Promise<JustBashReadResult> {
  const content = await sandbox.readFile(filePath, "utf-8");
  const fullBytes = Buffer.byteLength(content, "utf8");
  const truncated = fullBytes > maxBytes;
  let finalContent: string;
  if (truncated) {
    // Truncate to the last complete UTF-8 character at or before maxBytes.
    // Buffer.slice at an arbitrary byte offset can split multi-byte characters
    // (e.g. emoji, CJK, accented Latin), producing U+FFFD when decoded.
    const buf = Buffer.from(content, "utf8");
    let end = maxBytes;
    // Walk back past any continuation bytes (0x80–0xBF) to find the start
    // of the last character. A UTF-8 leading byte is either < 0x80 (ASCII)
    // or >= 0xC0 (multi-byte start). If the leading byte indicates a
    // multi-byte sequence that extends past `maxBytes`, exclude it entirely.
    while (end > 0 && (buf[end] & 0xC0) === 0x80) {
      end--;
    }
    // `end` now points at a leading byte. Check if the full character fits.
    if (end > 0) {
      const leadByte = buf[end];
      const charLen =
        leadByte < 0x80 ? 1 :
        leadByte < 0xE0 ? 2 :
        leadByte < 0xF0 ? 3 : 4;
      if (end + charLen > maxBytes) {
        // The character at `end` doesn't fit — exclude it.
        // (end already points at the start of this char, so just keep bytes before it)
      } else {
        end += charLen;
      }
    }
    finalContent = buf.slice(0, end).toString("utf8");
  } else {
    finalContent = content;
  }
  return { content: finalContent, sizeBytes: fullBytes, truncated };
}

/**
 * Write a file to the shared sandbox.
 */
export async function writeFileInSandbox(
  sandbox: Sandbox,
  filePath: string,
  content: string,
): Promise<{ path: string; bytesWritten: number }> {
  await sandbox.writeFiles({ [filePath]: content });
  return { path: filePath, bytesWritten: Buffer.byteLength(content, "utf8") };
}

/**
 * Write files (including binary via base64) to the shared sandbox.
 */
export async function writeFilesToSandbox(
  sandbox: Sandbox,
  files: WriteFilesInput,
): Promise<void> {
  await sandbox.writeFiles(files);
}

/**
 * Create a directory on the shared sandbox.
 */
export async function makeDirInSandbox(
  sandbox: Sandbox,
  dirPath: string,
): Promise<{ path: string; created: boolean }> {
  await sandbox.mkDir(dirPath, { recursive: true });
  return { path: dirPath, created: true };
}
