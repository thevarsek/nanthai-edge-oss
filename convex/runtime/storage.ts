"use node";

import { ConvexError } from "convex/values";
import * as path from "node:path";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { ToolExecutionContext } from "../tools/registry";
import { getWorkspaceSandbox } from "./service";
import { runtimeWorkspacePaths } from "./shared";
import { DeepPartial, mergeTestDeps } from "../lib/test_deps";

const defaultRuntimeStorageDeps = {
  getWorkspaceSandbox,
};

export type RuntimeStorageDeps = typeof defaultRuntimeStorageDeps;

export function createRuntimeStorageDepsForTest(
  overrides: DeepPartial<RuntimeStorageDeps> = {},
): RuntimeStorageDeps {
  return mergeTestDeps(defaultRuntimeStorageDeps, overrides);
}

interface OwnedStorageFile {
  storageId: Id<"_storage">;
  filename: string;
  mimeType: string;
  sizeBytes?: number;
  source: "upload" | "generated";
}

function requireChatId(toolCtx: ToolExecutionContext): string {
  if (!toolCtx.chatId) {
    throw new ConvexError({ code: "INTERNAL_ERROR" as const, message: "Workspace tools require chatId in the tool execution context." });
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
    throw new ConvexError({ code: "NOT_FOUND" as const, message: "The requested file is not available to this user." });
  }

  const blob = await toolCtx.ctx.storage.get(storageId as Id<"_storage">);
  if (!blob) {
    throw new ConvexError({ code: "NOT_FOUND" as const, message: "The requested file could not be loaded from storage." });
  }

  return { record: owned, blob };
}

export async function importOwnedStorageFileToWorkspace(
  toolCtx: ToolExecutionContext,
  storageId: string,
  filename?: string,
  targetPath?: string,
  deps: RuntimeStorageDeps = defaultRuntimeStorageDeps,
) {
  const chatId = requireChatId(toolCtx);
  const { sandbox, cwd } = await deps.getWorkspaceSandbox(toolCtx);
  const workspace = runtimeWorkspacePaths(chatId);
  const { record, blob } = await resolveOwnedStorageFile(toolCtx, storageId);
  const finalFilename = filename?.trim() || record.filename;
  const destination = resolveWorkspacePath(
    cwd,
    workspace.inputs,
    targetPath,
    finalFilename,
  );

  // Write the file into the shared sandbox — it persists for subsequent tool calls
  const parentDir = path.posix.dirname(destination);
  const isText = blob.type.startsWith("text/") || blob.type === "application/json";

  await sandbox.mkDir(parentDir, { recursive: true });

  if (isText) {
    const content = await blob.text();
    await sandbox.writeFiles({ [destination]: content });
  } else {
    // Binary file — use base64 encoding
    const b64 = Buffer.from(await blob.arrayBuffer()).toString("base64");
    await sandbox.writeFiles({ [destination]: { content: b64, encoding: "base64" } });
  }

  return {
    path: destination,
    filename: finalFilename,
    mimeType: record.mimeType || blob.type || "application/octet-stream",
    sizeBytes: record.sizeBytes ?? blob.size,
    storageId: record.storageId,
    source: record.source,
    note:
      "File imported into workspace. It is available at the path above for " +
      "subsequent workspace_exec and workspace_read_file calls.",
  };
}
