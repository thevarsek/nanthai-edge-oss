"use node";

// convex/runtime/service.ts
// =============================================================================
// Workspace tool service layer — just-bash with per-generation sandbox.
//
// A single just-bash Sandbox is lazily created on the first workspace tool call
// and reused for all subsequent calls within the same generation run. The
// sandbox's in-memory filesystem persists across calls, so files created by one
// tool call are naturally available to the next.
//
// There is no cross-generation persistence — each generation starts fresh.
// The sandbox is stopped in the generation cleanup path (finally block).
// =============================================================================

import { ConvexError } from "convex/values";
import { ToolExecutionContext } from "../tools/registry";
import {
  createWorkspaceSandbox,
  runCommandInSandbox,
  listFilesInSandbox,
  readFileInSandbox,
  writeFileInSandbox,
  makeDirInSandbox,
} from "./justbash_client";
import {
  guessMimeTypeFromPath,
  isTextLikeMime,
  runtimeWorkspacePaths,
} from "./shared";

const DEFAULT_MAX_READ_BYTES = 64_000;

function requireChatId(toolCtx: ToolExecutionContext): string {
  if (!toolCtx.chatId) {
    throw new ConvexError({
      code: "INTERNAL_ERROR" as const,
      message: "Workspace tools require chatId in the tool execution context.",
    });
  }
  return toolCtx.chatId;
}

// ---------------------------------------------------------------------------
// Lazy sandbox lifecycle — one per generation
// ---------------------------------------------------------------------------

/**
 * Get or create the shared workspace sandbox for this generation.
 * On first call, creates the sandbox and sets up the workspace directory
 * structure. On subsequent calls, returns the existing sandbox.
 */
async function getOrCreateWorkspaceSandbox(
  toolCtx: ToolExecutionContext,
): Promise<{ sandbox: import("just-bash").Sandbox; cwd: string }> {
  const chatId = requireChatId(toolCtx);
  const workspace = runtimeWorkspacePaths(chatId);

  if (toolCtx.workspaceSandbox) {
    return { sandbox: toolCtx.workspaceSandbox, cwd: workspace.root };
  }

  const sandbox = await createWorkspaceSandbox({ cwd: workspace.root });

  // Create workspace directories
  await sandbox.mkDir(workspace.inputs, { recursive: true });
  await sandbox.mkDir(workspace.outputs, { recursive: true });
  await sandbox.mkDir(workspace.charts, { recursive: true });

  // Store on context for reuse
  toolCtx.workspaceSandbox = sandbox;
  toolCtx.workspaceSandboxCleanup = async () => {
    await sandbox.stop().catch(() => {});
  };

  return { sandbox, cwd: workspace.root };
}

// ---------------------------------------------------------------------------
// Workspace tool handlers — shared sandbox, no re-seeding
// ---------------------------------------------------------------------------

export async function runWorkspaceCommand(
  toolCtx: ToolExecutionContext,
  command: string,
  cwd?: string,
  timeoutMs?: number,
) {
  const { sandbox, cwd: workspaceRoot } = await getOrCreateWorkspaceSandbox(toolCtx);
  const effectiveCwd = cwd?.trim() || workspaceRoot;

  return runCommandInSandbox(sandbox, command, { cwd: effectiveCwd, timeoutMs });
}

export async function listWorkspaceFiles(
  toolCtx: ToolExecutionContext,
  dirPath?: string,
  recursive?: boolean,
) {
  const { sandbox, cwd: workspaceRoot } = await getOrCreateWorkspaceSandbox(toolCtx);
  const root = dirPath?.trim() || workspaceRoot;
  const entries = await listFilesInSandbox(sandbox, root, {
    recursive: recursive ?? false,
  });
  return { root, files: entries };
}

export async function readWorkspaceFile(
  toolCtx: ToolExecutionContext,
  filePath: string,
  maxBytes?: number,
) {
  requireChatId(toolCtx);
  const mimeType = guessMimeTypeFromPath(filePath);

  if (!isTextLikeMime(mimeType)) {
    return {
      path: filePath,
      mimeType,
      sizeBytes: 0,
      isBinary: true,
      error:
        "File appears to be binary. Use workspace_import_file to bring it into scope, " +
        "or process it within a single workspace_exec call.",
    };
  }

  const { sandbox } = await getOrCreateWorkspaceSandbox(toolCtx);
  const limit = maxBytes ?? DEFAULT_MAX_READ_BYTES;

  try {
    const result = await readFileInSandbox(sandbox, filePath, limit);
    return {
      path: filePath,
      mimeType,
      sizeBytes: result.sizeBytes,
      truncated: result.truncated,
      content: result.content,
    };
  } catch {
    return {
      path: filePath,
      mimeType,
      sizeBytes: 0,
      truncated: false,
      content: null,
      error:
        `File not found in workspace: ${filePath}. ` +
        "Use workspace_write_file or workspace_exec to create the file first.",
    };
  }
}

export async function writeWorkspaceFile(
  toolCtx: ToolExecutionContext,
  filePath: string,
  content: string,
  overwrite: boolean,
) {
  requireChatId(toolCtx);
  const { sandbox } = await getOrCreateWorkspaceSandbox(toolCtx);

  // Honour overwrite flag — check if file already exists
  if (!overwrite) {
    try {
      await sandbox.readFile(filePath, "utf-8");
      // If readFile succeeds, the file exists — refuse to overwrite
      return {
        path: filePath,
        bytesWritten: 0,
        error:
          `File already exists at ${filePath} and overwrite=false. ` +
          "Set overwrite=true to replace it, or choose a different path.",
      };
    } catch {
      // readFile threw → file does not exist → safe to write
    }
  }

  // Ensure parent directory exists
  const parentDir = filePath.substring(0, filePath.lastIndexOf("/"));
  if (parentDir) {
    await sandbox.mkDir(parentDir, { recursive: true });
  }

  return writeFileInSandbox(sandbox, filePath, content);
}

export async function makeWorkspaceDirs(
  toolCtx: ToolExecutionContext,
  dirPath: string,
) {
  requireChatId(toolCtx);
  const { sandbox } = await getOrCreateWorkspaceSandbox(toolCtx);
  return makeDirInSandbox(sandbox, dirPath);
}

// ---------------------------------------------------------------------------
// Shared sandbox access for storage.ts (workspace_import_file)
// ---------------------------------------------------------------------------

/**
 * Get the shared sandbox for importing files into the workspace.
 * Uses the same per-generation sandbox as other workspace tools.
 */
export async function getWorkspaceSandbox(
  toolCtx: ToolExecutionContext,
): Promise<{ sandbox: import("just-bash").Sandbox; cwd: string }> {
  return getOrCreateWorkspaceSandbox(toolCtx);
}
