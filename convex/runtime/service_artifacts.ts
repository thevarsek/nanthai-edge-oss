"use node";

import { internal } from "../_generated/api";
import { ToolExecutionContext } from "../tools/registry";
import { killE2BSandbox } from "./e2b_client";
import { ensureSandboxForChat, ensureWorkspaceDirectories } from "./service";
import {
  guessMimeTypeFromPath,
  RUNTIME_TEMPLATE_NAME,
  RUNTIME_TEMPLATE_VERSION,
  RUNTIME_TIMEOUT_MS,
} from "./shared";

function requireChatId(toolCtx: ToolExecutionContext): string {
  if (!toolCtx.chatId) {
    throw new Error("Workspace tools require chatId in the tool execution context.");
  }
  return toolCtx.chatId;
}

export async function exportWorkspaceFile(
  toolCtx: ToolExecutionContext,
  path: string,
  filename?: string,
) {
  const chatId = requireChatId(toolCtx);
  const session = await ensureSandboxForChat(toolCtx);
  const blob = await session.sandbox.files.read(path, { format: "blob" });
  const finalFilename = filename?.trim() || path.split("/").pop() || "runtime-artifact";
  const storageId = await toolCtx.ctx.storage.store(blob);
  const mimeType = blob.type || guessMimeTypeFromPath(path);
  await toolCtx.ctx.runMutation(internal.runtime.mutations.recordSandboxArtifactInternal, {
    userId: toolCtx.userId,
    chatId: chatId as any,
    sandboxSessionId: session.sessionId as any,
    path,
    filename: finalFilename,
    mimeType,
    sizeBytes: blob.size,
    storageId,
    isDurable: true,
  });
  await toolCtx.ctx.runMutation(internal.runtime.mutations.recordSandboxEventInternal, {
    sandboxSessionId: session.sessionId as any,
    userId: toolCtx.userId,
    chatId: chatId as any,
    eventType: "artifact_exported",
    details: { path, filename: finalFilename, storageId },
  });
  const siteUrl = process.env.CONVEX_SITE_URL;
  const downloadUrl = siteUrl
    ? `${siteUrl}/download?storageId=${encodeURIComponent(storageId)}&filename=${encodeURIComponent(finalFilename)}`
    : await toolCtx.ctx.storage.getUrl(storageId);
  return {
    path,
    filename: finalFilename,
    storageId,
    mimeType,
    sizeBytes: blob.size,
    downloadUrl,
    markdownLink: `[${finalFilename}](${downloadUrl})`,
    message:
      `File exported to durable storage. Present the download link to the user using markdown: ` +
      `[${finalFilename}](${downloadUrl})`,
  };
}

export async function resetWorkspace(toolCtx: ToolExecutionContext) {
  const chatId = requireChatId(toolCtx);
  const existing = await toolCtx.ctx.runQuery(internal.runtime.queries.getSessionByChatInternal, {
    userId: toolCtx.userId,
    chatId: chatId as any,
  });

  if (existing?.providerSandboxId) {
    try {
      await killE2BSandbox(existing.providerSandboxId);
    } catch {
      // Best-effort reset.
    }
  }

  const now = Date.now();
  if (existing) {
    await toolCtx.ctx.runMutation(internal.runtime.mutations.upsertSessionInternal, {
      sessionId: existing._id,
      userId: toolCtx.userId,
      chatId: chatId as any,
      providerSandboxId: undefined,
      templateName: existing.templateName,
      templateVersion: existing.templateVersion,
      status: "deleted",
      cwd: existing.cwd,
      lastActiveAt: now,
      lastPausedAt: existing.lastPausedAt,
      lastResumedAt: existing.lastResumedAt,
      lastHealthcheckAt: existing.lastHealthcheckAt,
      timeoutMs: existing.timeoutMs,
      internetEnabled: existing.internetEnabled,
      publicTrafficEnabled: existing.publicTrafficEnabled,
      pendingDeletionReason: "manual_reset",
      failureCount: existing.failureCount + 1,
      metadata: existing.metadata,
    });
  }

  const session = await ensureSandboxForChat(toolCtx);
  await ensureWorkspaceDirectories(session.sandbox, chatId);
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
  });
  return { chatId, sandboxId: session.sandbox.sandboxId, cwd: session.cwd };
}
