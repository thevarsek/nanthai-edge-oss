"use node";

// convex/runtime/service_artifacts.ts
// =============================================================================
// Workspace artifact export and reset — per-generation just-bash sandbox.
//
// exportWorkspaceFile: reads the file from the per-generation sandbox's
// in-memory filesystem, stores it in Convex durable storage, and returns
// download metadata (storageId, URL, etc.). Supports both text and binary
// files — text is read as utf-8, binary as base64.
//
// resetWorkspace: clears all user-created files from the sandbox's workspace
// directories (inputs/, outputs/, charts/) and recreates the empty directory
// structure. The sandbox itself stays alive for the rest of the generation.
// =============================================================================

import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import { ToolExecutionContext } from "../tools/registry";
import { guessMimeTypeFromPath, isTextLikeMime, runtimeWorkspacePaths } from "./shared";
import { getWorkspaceSandbox } from "./service";
import { runCommandInSandbox } from "./justbash_client";

function requireChatId(toolCtx: ToolExecutionContext): string {
  if (!toolCtx.chatId) {
    throw new ConvexError({
      code: "INTERNAL_ERROR" as const,
      message: "Workspace tools require chatId in the tool execution context.",
    });
  }
  return toolCtx.chatId;
}

/**
 * Export a file from the per-generation sandbox to Convex durable storage.
 *
 * Reads the file from the sandbox's in-memory filesystem (which persists for
 * the lifetime of the generation), stores it in Convex storage, and returns
 * download metadata including storageId.
 *
 * For binary files (images, PDFs, etc.) we read as base64 and decode.
 * For text files we read as utf-8.
 */
export async function exportWorkspaceFile(
  toolCtx: ToolExecutionContext,
  _path: string,
  filename?: string,
): Promise<{
  path: string;
  filename: string;
  storageId: string;
  mimeType: string;
  sizeBytes: number;
  downloadUrl: string | null;
  markdownLink: string;
}> {
  requireChatId(toolCtx);
  const finalFilename = filename?.trim() || _path.split("/").pop() || "runtime-artifact";
  const mimeType = guessMimeTypeFromPath(finalFilename);

  const { sandbox } = await getWorkspaceSandbox(toolCtx);

  let bytes: Uint8Array;
  if (isTextLikeMime(mimeType)) {
    // Text file — read as utf-8, convert to bytes
    const textContent = await sandbox.readFile(_path, "utf-8");
    bytes = new Uint8Array(Buffer.from(textContent, "utf-8"));
  } else {
    // Binary file — read as base64, decode to bytes
    const base64Content = await sandbox.readFile(_path, "base64");
    bytes = new Uint8Array(Buffer.from(base64Content, "base64"));
  }

  const result = await storeArtifactBytes(toolCtx, bytes, finalFilename, mimeType);
  return {
    path: _path,
    filename: result.filename,
    storageId: result.storageId,
    mimeType: result.mimeType,
    sizeBytes: result.sizeBytes,
    downloadUrl: result.downloadUrl,
    markdownLink: result.markdownLink,
  };
}

/**
 * Reset the workspace — clears all files from workspace directories and
 * recreates the empty directory structure. The sandbox itself stays alive
 * for the rest of the generation, so subsequent tool calls get a clean slate
 * without the overhead of creating a new sandbox.
 */
export async function resetWorkspace(
  toolCtx: ToolExecutionContext,
): Promise<{ chatId: string; message: string }> {
  const chatId = requireChatId(toolCtx);

  // If no sandbox exists yet, nothing to clean — just return.
  if (!toolCtx.workspaceSandbox) {
    return {
      chatId,
      message:
        "Workspace reset confirmed. No sandbox was active — the next workspace " +
        "tool call will start with a fresh environment.",
    };
  }

  const { sandbox } = await getWorkspaceSandbox(toolCtx);
  const workspace = runtimeWorkspacePaths(chatId);

  // Nuke everything inside the workspace root (including custom nested
  // directories like build/, src/tmp/, etc.) and recreate the standard
  // subdirectories so subsequent tool calls find them ready.
  const cleanCmd = [
    // Remove all children of the workspace root (files and directories).
    `find '${workspace.root}' -mindepth 1 -delete 2>/dev/null || true`,
    // Recreate the standard subdirectories.
    `mkdir -p '${workspace.inputs}' '${workspace.outputs}' '${workspace.charts}'`,
  ].join(" && ");

  await runCommandInSandbox(sandbox, cleanCmd, { cwd: workspace.root });

  return {
    chatId,
    message:
      "Workspace reset confirmed. All files in the workspace have been cleared. " +
      "The sandbox is still active — subsequent workspace_exec calls will run in " +
      "the same sandbox with a clean workspace.",
  };
}

/**
 * Store raw bytes in Convex durable storage and return download metadata.
 * Used by the analytics pipeline (Pyodide chart output, etc.).
 */
export async function storeArtifactBytes(
  toolCtx: ToolExecutionContext,
  bytes: Uint8Array,
  filename: string,
  mimeType: string,
): Promise<{
  storageId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  downloadUrl: string | null;
  markdownLink: string;
}> {
  const chatId = requireChatId(toolCtx);
  // Use bytes.buffer sliced to the viewed portion (not the entire backing
  // ArrayBuffer) to avoid storing extra data from shared buffers.
  const viewedBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const blob = new Blob([viewedBuffer], { type: mimeType });
  const storageId = await toolCtx.ctx.storage.store(blob);
  const finalMime = mimeType || guessMimeTypeFromPath(filename);

  if (chatId) {
    await toolCtx.ctx.runMutation(internal.runtime.mutations.recordSandboxArtifactInternal, {
      userId: toolCtx.userId,
      chatId: chatId as any,
      sandboxSessionId: toolCtx.sandboxSessionId as any,
      path: filename,
      filename,
      mimeType: finalMime,
      sizeBytes: bytes.byteLength,
      storageId,
      isDurable: true,
    });
  }

  const siteUrl = process.env.CONVEX_SITE_URL;
  const downloadUrl = siteUrl
    ? `${siteUrl}/download?storageId=${encodeURIComponent(storageId)}&filename=${encodeURIComponent(filename)}`
    : await toolCtx.ctx.storage.getUrl(storageId);

  return {
    storageId,
    filename,
    mimeType: finalMime,
    sizeBytes: bytes.byteLength,
    downloadUrl,
    markdownLink: `[${filename}](${downloadUrl})`,
  };
}
