"use node";

import { ConvexError } from "convex/values";
import { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { ToolExecutionContext } from "../tools/registry";
import { connectE2BSandbox, createE2BSandbox } from "./e2b_client";
import {
  guessMimeTypeFromPath,
  isTextLikeMime,
  RUNTIME_TEMPLATE_NAME,
  RUNTIME_TEMPLATE_VERSION,
  RUNTIME_TIMEOUT_MS,
  runtimeWorkspacePaths,
} from "./shared";

const DEFAULT_MAX_READ_BYTES = 64_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 60_000;

function requireChatId(toolCtx: ToolExecutionContext): string {
  if (!toolCtx.chatId) {
    throw new ConvexError({ code: "INTERNAL_ERROR" as const, message: "Workspace tools require chatId in the tool execution context." });
  }
  return toolCtx.chatId;
}

export async function ensureWorkspaceDirectories(
  sandbox: { files: { makeDir: (path: string) => Promise<boolean> } },
  chatId: string,
) {
  const workspace = runtimeWorkspacePaths(chatId);
  for (const dir of [
    workspace.root,
    workspace.inputs,
    workspace.outputs,
    workspace.charts,
  ]) {
    await sandbox.files.makeDir(dir);
  }
  return workspace;
}

async function recordEvent(
  ctx: ActionCtx,
  args: {
    sessionId?: string;
    userId: string;
    chatId: string;
    eventType: string;
    details?: unknown;
  },
) {
  await ctx.runMutation(internal.runtime.mutations.recordSandboxEventInternal, {
    sandboxSessionId: args.sessionId as any,
    userId: args.userId,
    chatId: args.chatId as any,
    eventType: args.eventType,
    details: args.details,
  });
}

async function healthcheckSandbox(sandbox: Awaited<ReturnType<typeof connectE2BSandbox>>) {
  await sandbox.commands.run("echo runtime_ready", { timeoutMs: 5_000 });
}

export async function ensureSandboxForChat(toolCtx: ToolExecutionContext) {
  const chatId = requireChatId(toolCtx);
  const existing = await toolCtx.ctx.runQuery(internal.runtime.queries.getSessionByChatInternal, {
    userId: toolCtx.userId,
    chatId: chatId as any,
  });

  if (existing?.providerSandboxId && existing.status !== "deleted") {
    try {
      const sandbox = await connectE2BSandbox(existing.providerSandboxId);
      await sandbox.setTimeout(RUNTIME_TIMEOUT_MS);
      await healthcheckSandbox(sandbox);
      const now = Date.now();
      await toolCtx.ctx.runMutation(internal.runtime.mutations.upsertSessionInternal, {
        sessionId: existing._id,
        userId: toolCtx.userId,
        chatId: chatId as any,
        providerSandboxId: existing.providerSandboxId,
        templateName: existing.templateName,
        templateVersion: existing.templateVersion,
        status: existing.status === "paused" ? "running" : existing.status,
        cwd: existing.cwd,
        lastActiveAt: now,
        lastPausedAt: existing.lastPausedAt,
        lastResumedAt: now,
        lastHealthcheckAt: now,
        timeoutMs: existing.timeoutMs,
        internetEnabled: existing.internetEnabled,
        publicTrafficEnabled: existing.publicTrafficEnabled,
        pendingDeletionReason: null,
        failureCount: existing.failureCount,
        metadata: existing.metadata,
      });
      return { sandbox, sessionId: existing._id, cwd: existing.cwd };
    } catch (error) {
      await recordEvent(toolCtx.ctx, {
        sessionId: String(existing._id),
        userId: toolCtx.userId,
        chatId,
        eventType: "sandbox_reconnect_failed",
        details: { message: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  const workspace = runtimeWorkspacePaths(chatId);
  const cwd = workspace.root;
  const metadata = {
    userId: toolCtx.userId,
    chatId,
    environment: process.env.CONVEX_CLOUD_URL ? "prod" : "dev",
    feature: "max-runtime",
    templateVersion: RUNTIME_TEMPLATE_VERSION,
  };
  const sandbox = await createE2BSandbox(metadata);
  await ensureWorkspaceDirectories(sandbox, chatId);
  const now = Date.now();
  const sessionId = await toolCtx.ctx.runMutation(internal.runtime.mutations.upsertSessionInternal, {
    sessionId: existing?._id,
    userId: toolCtx.userId,
    chatId: chatId as any,
    providerSandboxId: sandbox.sandboxId,
    templateName: RUNTIME_TEMPLATE_NAME,
    templateVersion: RUNTIME_TEMPLATE_VERSION,
    status: "running",
    cwd,
    lastActiveAt: now,
    lastPausedAt: undefined,
    lastResumedAt: now,
    lastHealthcheckAt: now,
    timeoutMs: RUNTIME_TIMEOUT_MS,
    internetEnabled: true,
    publicTrafficEnabled: false,
    pendingDeletionReason: null,
    failureCount: 0,
    metadata,
  });
  await recordEvent(toolCtx.ctx, {
    sessionId: String(sessionId),
    userId: toolCtx.userId,
    chatId,
    eventType: existing ? "sandbox_recreated" : "sandbox_created",
    details: { sandboxId: sandbox.sandboxId, cwd },
  });
  return { sandbox, sessionId, cwd };
}

export async function markSandboxSessionRunning(
  toolCtx: ToolExecutionContext,
  session: { sessionId: string; cwd: string; sandbox: any },
) {
  const chatId = requireChatId(toolCtx);
  const now = Date.now();
  await toolCtx.ctx.runMutation(internal.runtime.mutations.upsertSessionInternal, {
    sessionId: session.sessionId as any,
    userId: toolCtx.userId,
    chatId: chatId as any,
    providerSandboxId: session.sandbox.sandboxId,
    templateName: RUNTIME_TEMPLATE_NAME,
    templateVersion: RUNTIME_TEMPLATE_VERSION,
    status: "running",
    cwd: session.cwd,
    lastActiveAt: now,
    lastPausedAt: undefined,
    lastResumedAt: now,
    lastHealthcheckAt: now,
    timeoutMs: RUNTIME_TIMEOUT_MS,
    internetEnabled: true,
    publicTrafficEnabled: false,
    pendingDeletionReason: null,
    failureCount: 0,
    metadata: undefined,
  });
}

export async function runWorkspaceCommand(
  toolCtx: ToolExecutionContext,
  command: string,
  cwd?: string,
  timeoutMs?: number,
) {
  const session = await ensureSandboxForChat(toolCtx);
  const effectiveCwd = cwd?.trim() || session.cwd;
  const startedAt = Date.now();
  const result = await session.sandbox.commands.run(command, {
    cwd: effectiveCwd,
    timeoutMs: timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
  });
  await markSandboxSessionRunning(toolCtx, session);
  return {
    cwd: effectiveCwd,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    durationMs: Date.now() - startedAt,
  };
}

export async function listWorkspaceFiles(
  toolCtx: ToolExecutionContext,
  path?: string,
  recursive?: boolean,
) {
  const session = await ensureSandboxForChat(toolCtx);
  const root = path?.trim() || session.cwd;
  const collect = async (currentPath: string): Promise<any[]> => {
    const entries = await session.sandbox.files.list(currentPath);
    if (!recursive) return entries;
    const children = await Promise.all(
      entries
        .filter((entry: any) => entry.type === "dir")
        .map((entry: any) => collect(entry.path)),
    );
    return [...entries, ...children.flat()];
  };
  const files = await collect(root);
  await markSandboxSessionRunning(toolCtx, session);
  return { root, files };
}

export async function readWorkspaceFile(
  toolCtx: ToolExecutionContext,
  path: string,
  maxBytes?: number,
) {
  const session = await ensureSandboxForChat(toolCtx);
  const bytes = await session.sandbox.files.read(path, { format: "bytes" });
  const limited = bytes.slice(0, maxBytes ?? DEFAULT_MAX_READ_BYTES);
  const mimeType = guessMimeTypeFromPath(path);
  await markSandboxSessionRunning(toolCtx, session);

  if (!isTextLikeMime(mimeType)) {
    return {
      path,
      mimeType,
      sizeBytes: bytes.byteLength,
      isBinary: true,
      error: "File appears to be binary. Export it instead of reading as text.",
    };
  }

  const content = new TextDecoder().decode(limited);
  return {
    path,
    mimeType,
    sizeBytes: bytes.byteLength,
    truncated: bytes.byteLength > limited.byteLength,
    content,
  };
}

export async function writeWorkspaceFile(
  toolCtx: ToolExecutionContext,
  path: string,
  content: string,
  overwrite: boolean,
) {
  const session = await ensureSandboxForChat(toolCtx);
  const exists = await session.sandbox.files.exists(path);
  if (exists && !overwrite) {
    throw new ConvexError({ code: "INVALID_INPUT" as const, message: `File already exists at ${path}. Pass overwrite=true to replace it.` });
  }
  await session.sandbox.files.write(path, content);
  await markSandboxSessionRunning(toolCtx, session);
  return { path, bytesWritten: Buffer.byteLength(content, "utf8") };
}

export async function makeWorkspaceDirs(toolCtx: ToolExecutionContext, path: string) {
  const session = await ensureSandboxForChat(toolCtx);
  const created = await session.sandbox.files.makeDir(path);
  await markSandboxSessionRunning(toolCtx, session);
  return { path, created };
}
