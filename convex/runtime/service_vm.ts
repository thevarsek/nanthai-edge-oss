"use node";

import { ConvexError } from "convex/values";
import * as path from "node:path";
import { internal } from "../_generated/api";
import { ToolExecutionContext } from "../tools/registry";
import {
  guessMimeTypeFromPath,
  isTextLikeMime,
  persistentRuntimeWorkspacePaths,
  type PersistentRuntimeEnvironment,
} from "./shared";
import {
  getOrCreateVercelSandbox,
  type VercelSandboxEnvironment,
} from "./vercel_sandbox_client";
import { resolveOwnedStorageFile } from "./storage";
import { storeArtifactBytes } from "./service_artifacts";

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_MAX_READ_BYTES = 64_000;

function requireChatId(toolCtx: ToolExecutionContext): string {
  if (!toolCtx.chatId) {
    throw new ConvexError({
      code: "INTERNAL_ERROR" as const,
      message: "Persistent VM tools require chatId in the tool execution context.",
    });
  }
  return toolCtx.chatId;
}

function sh(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function resolvePersistentRuntimeWorkspacePath(
  targetPath: string,
  workspaceRoot: string,
  options: { allowRoot?: boolean } = {},
): string {
  const trimmed = targetPath.trim();
  if (!trimmed) {
    throw new ConvexError({
      code: "INVALID_ARGUMENT" as const,
      message: "Persistent VM paths must not be empty.",
    });
  }

  const normalizedRoot = path.posix.normalize(workspaceRoot);
  const normalizedPath = path.posix.normalize(
    path.posix.isAbsolute(trimmed)
      ? trimmed
      : path.posix.join(normalizedRoot, trimmed),
  );

  const isWithinWorkspace =
    normalizedPath === normalizedRoot ||
    normalizedPath.startsWith(`${normalizedRoot}/`);
  if (!isWithinWorkspace) {
    throw new ConvexError({
      code: "INVALID_ARGUMENT" as const,
      message: `Path "${targetPath}" is outside the persistent VM workspace.`,
    });
  }

  if (!options.allowRoot && normalizedPath === normalizedRoot) {
    throw new ConvexError({
      code: "INVALID_ARGUMENT" as const,
      message: "Refusing to delete the persistent VM workspace root.",
    });
  }

  return normalizedPath;
}

export async function getOrCreatePersistentRuntime(
  toolCtx: ToolExecutionContext,
  environment: PersistentRuntimeEnvironment,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
) {
  const chatId = requireChatId(toolCtx);
  const existingSession = await toolCtx.ctx.runQuery(
    internal.runtime.queries.getSessionByChatInternal,
    { userId: toolCtx.userId, chatId: chatId as any, environment },
  );
  const existingSandboxId =
    existingSession?.provider === "vercel" &&
    existingSession?.status === "running" &&
    existingSession?.providerSandboxId
      ? existingSession.providerSandboxId
      : undefined;

  const sandbox = await getOrCreateVercelSandbox(
    existingSandboxId,
    timeoutMs,
    environment as VercelSandboxEnvironment,
  );
  const workspace = persistentRuntimeWorkspacePaths(chatId, environment);
  await sandbox.runCommand("bash", [
    "-lc",
    `mkdir -p ${sh(workspace.inputs)} ${sh(workspace.outputs)} ${sh(workspace.charts)}`,
  ]);

  const now = Date.now();
  const sessionId = await toolCtx.ctx.runMutation(
    internal.runtime.mutations.upsertSessionInternal,
    {
      sessionId: existingSession?._id,
      userId: toolCtx.userId,
      chatId: chatId as any,
      environment,
      providerSandboxId: sandbox.sandboxId,
      status: "running",
      cwd: workspace.root,
      lastActiveAt: now,
      timeoutMs,
      internetEnabled: true,
      publicTrafficEnabled: false,
    },
  );
  toolCtx.sandboxSessionId = sessionId;

  return { sandbox, workspace, sessionId };
}

async function runVmShell(
  sandbox: any,
  command: string,
  cwd: string,
  timeoutMs?: number,
) {
  const startedAt = Date.now();
  const result = await sandbox.runCommand(
    "bash",
    ["-lc", `cd ${sh(cwd)} && ${command}`],
    timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : undefined,
  );
  return {
    stdout: await result.stdout(),
    stderr: await result.stderr(),
    exitCode: result.exitCode,
    durationMs: Date.now() - startedAt,
  };
}

export async function execPersistentRuntimeCommand(
  toolCtx: ToolExecutionContext,
  environment: PersistentRuntimeEnvironment,
  command: string,
  cwd?: string,
  timeoutMs?: number,
) {
  const { sandbox, workspace } = await getOrCreatePersistentRuntime(toolCtx, environment, timeoutMs);
  return runVmShell(sandbox, command, cwd?.trim() || workspace.root, timeoutMs);
}

export async function listPersistentRuntimeFiles(
  toolCtx: ToolExecutionContext,
  environment: PersistentRuntimeEnvironment,
  dirPath?: string,
  recursive?: boolean,
) {
  const { sandbox, workspace } = await getOrCreatePersistentRuntime(toolCtx, environment);
  const root = dirPath?.trim() || workspace.root;
  const suffix = recursive ? "" : " -maxdepth 1";
  const command = `find ${sh(root)} -mindepth 1${suffix} \\( -type f -o -type d \\) -printf '%y\\t%p\\n' 2>/dev/null | sort`;
  const result = await runVmShell(sandbox, command, workspace.root);
  const files = result.stdout
    .split("\n")
    .map((line: string) => line.trim())
    .filter(Boolean)
    .map((line: string) => {
      const [kind, fullPath] = line.split("\t");
      return {
        name: fullPath.split("/").pop() || fullPath,
        path: fullPath,
        type: kind === "d" ? "dir" : "file",
      };
    });
  return { root, files };
}

export async function readPersistentRuntimeFile(
  toolCtx: ToolExecutionContext,
  environment: PersistentRuntimeEnvironment,
  filePath: string,
  maxBytes?: number,
) {
  const { sandbox } = await getOrCreatePersistentRuntime(toolCtx, environment);
  const mimeType = guessMimeTypeFromPath(filePath);
  const buf = await sandbox.readFileToBuffer({ path: filePath }).catch(() => null);
  if (!buf) {
    return { path: filePath, mimeType, sizeBytes: 0, truncated: false, content: null, error: `File not found in VM workspace: ${filePath}.` };
  }
  const sizeBytes = buf.byteLength;
  if (!isTextLikeMime(mimeType)) {
    return { path: filePath, mimeType, sizeBytes, isBinary: true, error: "File appears to be binary. Export it or process it inside vm_exec." };
  }
  const limit = maxBytes ?? DEFAULT_MAX_READ_BYTES;
  const truncated = sizeBytes > limit;
  const content = Buffer.from(buf).subarray(0, limit).toString("utf8");
  return { path: filePath, mimeType, sizeBytes, truncated, content };
}

export async function writePersistentRuntimeFile(
  toolCtx: ToolExecutionContext,
  environment: PersistentRuntimeEnvironment,
  filePath: string,
  content: string,
  overwrite: boolean,
) {
  const { sandbox } = await getOrCreatePersistentRuntime(toolCtx, environment);
  const existing = await sandbox.readFileToBuffer({ path: filePath }).catch(() => null);
  if (existing && !overwrite) {
    return { path: filePath, bytesWritten: 0, error: `File already exists at ${filePath} and overwrite=false. Set overwrite=true to replace it.` };
  }
  const parentDir = path.posix.dirname(filePath);
  await sandbox.runCommand("mkdir", ["-p", parentDir]);
  await sandbox.writeFiles([{ path: filePath, content }]);
  return { path: filePath, bytesWritten: Buffer.byteLength(content, "utf8") };
}

export async function deletePersistentRuntimePath(
  toolCtx: ToolExecutionContext,
  environment: PersistentRuntimeEnvironment,
  targetPath: string,
) {
  const { sandbox, workspace } = await getOrCreatePersistentRuntime(toolCtx, environment);
  const resolvedPath = resolvePersistentRuntimeWorkspacePath(targetPath, workspace.root);
  await runVmShell(sandbox, `rm -rf ${sh(resolvedPath)}`, workspace.root);
  return { path: resolvedPath, deleted: true };
}

export async function makePersistentRuntimeDirs(
  toolCtx: ToolExecutionContext,
  environment: PersistentRuntimeEnvironment,
  dirPath: string,
) {
  const { sandbox } = await getOrCreatePersistentRuntime(toolCtx, environment);
  await sandbox.runCommand("mkdir", ["-p", dirPath]);
  return { path: dirPath, created: true };
}

export async function importOwnedStorageFileToPersistentRuntime(
  toolCtx: ToolExecutionContext,
  environment: PersistentRuntimeEnvironment,
  storageId: string,
  filename?: string,
  targetPath?: string,
) {
  const { sandbox, workspace } = await getOrCreatePersistentRuntime(toolCtx, environment);
  const { record, blob } = await resolveOwnedStorageFile(toolCtx, storageId);
  const finalFilename = filename?.trim() || record.filename;
  const destination = targetPath?.trim()
    ? (path.posix.isAbsolute(targetPath) ? targetPath : path.posix.join(workspace.root, targetPath))
    : path.posix.join(workspace.inputs, finalFilename.replace(/[^\w.\-]+/g, "_"));
  await sandbox.runCommand("mkdir", ["-p", path.posix.dirname(destination)]);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  await sandbox.writeFiles([{ path: destination, content: bytes }]);
  return { path: destination, filename: finalFilename, mimeType: record.mimeType || blob.type || "application/octet-stream", sizeBytes: record.sizeBytes ?? blob.size, storageId: record.storageId, source: record.source };
}

export async function exportPersistentRuntimeFile(
  toolCtx: ToolExecutionContext,
  environment: PersistentRuntimeEnvironment,
  filePath: string,
  filename?: string,
) {
  const { sandbox } = await getOrCreatePersistentRuntime(toolCtx, environment);
  const buf = await sandbox.readFileToBuffer({ path: filePath });
  if (!buf) {
    throw new ConvexError({ code: "NOT_FOUND" as const, message: `VM file not found: ${filePath}` });
  }
  return storeArtifactBytes(
    toolCtx,
    new Uint8Array(buf),
    filename?.trim() || path.posix.basename(filePath),
    guessMimeTypeFromPath(filename?.trim() || filePath),
  ).then((result) => ({ path: filePath, ...result }));
}

export async function resetPersistentRuntime(
  toolCtx: ToolExecutionContext,
  environment: PersistentRuntimeEnvironment,
) {
  const chatId = requireChatId(toolCtx);
  const { sandbox, workspace } = await getOrCreatePersistentRuntime(toolCtx, environment);
  await runVmShell(
    sandbox,
    `find ${sh(workspace.root)} -mindepth 1 -delete 2>/dev/null || true && mkdir -p ${sh(workspace.inputs)} ${sh(workspace.outputs)} ${sh(workspace.charts)}`,
    workspace.root,
  );
  return {
    chatId,
    environment,
    message: "Persistent VM workspace reset. The sandbox stays alive, but the workspace contents were cleared.",
  };
}
