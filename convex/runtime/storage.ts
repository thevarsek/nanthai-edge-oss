"use node";

import * as path from "node:path";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { ToolExecutionContext } from "../tools/registry";
import { ensureSandboxForChat, markSandboxSessionRunning } from "./service";
import { runtimeWorkspacePaths } from "./shared";

interface OwnedStorageFile {
  storageId: Id<"_storage">;
  filename: string;
  mimeType: string;
  sizeBytes?: number;
  source: "upload" | "generated";
}

function requireChatId(toolCtx: ToolExecutionContext): string {
  if (!toolCtx.chatId) {
    throw new Error("Workspace tools require chatId in the tool execution context.");
  }
  return toolCtx.chatId;
}

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^\w.\-]+/g, "_");
}

function resolveWorkspacePath(
  root: string,
  fallbackDir: string,
  providedPath: string | undefined,
  filename: string,
): string {
  const trimmed = providedPath?.trim();
  if (!trimmed) {
    return path.posix.join(fallbackDir, sanitizeFilename(filename));
  }
  if (path.posix.isAbsolute(trimmed)) {
    return trimmed;
  }
  return path.posix.join(root, trimmed);
}

export async function resolveOwnedStorageFile(
  toolCtx: ToolExecutionContext,
  storageId: string,
): Promise<{ record: OwnedStorageFile; blob: Blob }> {
  const owned = await toolCtx.ctx.runQuery(
    internal.runtime.queries.resolveOwnedStorageFileInternal,
    { userId: toolCtx.userId, storageId: storageId as Id<"_storage"> },
  );
  if (!owned) {
    throw new Error("The requested file is not available to this user.");
  }

  const blob = await toolCtx.ctx.storage.get(storageId as Id<"_storage">);
  if (!blob) {
    throw new Error("The requested file could not be loaded from storage.");
  }

  return { record: owned, blob };
}

export async function importOwnedStorageFileToWorkspace(
  toolCtx: ToolExecutionContext,
  storageId: string,
  filename?: string,
  targetPath?: string,
) {
  const chatId = requireChatId(toolCtx);
  const session = await ensureSandboxForChat(toolCtx);
  const workspace = runtimeWorkspacePaths(chatId);
  const { record, blob } = await resolveOwnedStorageFile(toolCtx, storageId);
  const finalFilename = filename?.trim() || record.filename;
  const destination = resolveWorkspacePath(
    session.cwd,
    workspace.inputs,
    targetPath,
    finalFilename,
  );
  const parentDir = path.posix.dirname(destination);

  await session.sandbox.files.makeDir(parentDir);
  await session.sandbox.files.write(destination, blob);
  await markSandboxSessionRunning(toolCtx, session);
  await toolCtx.ctx.runMutation(internal.runtime.mutations.recordSandboxEventInternal, {
    sandboxSessionId: session.sessionId as Id<"sandboxSessions">,
    userId: toolCtx.userId,
    chatId: chatId as Id<"chats">,
    eventType: "storage_file_imported",
    details: {
      storageId,
      source: record.source,
      destination,
      filename: finalFilename,
    },
  });

  return {
    path: destination,
    filename: finalFilename,
    mimeType: record.mimeType || blob.type || "application/octet-stream",
    sizeBytes: record.sizeBytes ?? blob.size,
    storageId: record.storageId,
    source: record.source,
  };
}
