import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import {
  cancelOwnedComponents,
  stopSandboxSessions,
  type SandboxSessionRef,
} from "./teardown_components";

interface RootRunPage {
  runIds: Id<"executionRuns">[];
  continueCursor: string;
  isDone: boolean;
}

export function deletionTeardownRetryDelay(
  components: Array<{ cancelSafeAfter?: number }>,
  now: number,
): number {
  const latestDrainBoundary = components.reduce<number | undefined>(
    (latest, component) => component.cancelSafeAfter === undefined
      ? latest
      : Math.max(latest ?? 0, component.cancelSafeAfter),
    undefined,
  );
  return latestDrainBoundary === undefined
    ? 1_000
    : Math.max(1_000, latestDrainBoundary - now);
}

export async function cancelUserExecutionsHandler(
  ctx: ActionCtx,
  args: { userId: string; reason: string },
): Promise<boolean> {
  const sessions: SandboxSessionRef[] = await ctx.runQuery(
    internal.runtime.queries.listActiveSessionsForUserInternal,
    { userId: args.userId },
  );
  const sessionsConfirmed = await stopSandboxSessions(ctx, sessions, args.reason);
  if (!sessionsConfirmed || sessions.length >= 100) {
    await ctx.scheduler.runAfter(5_000, internal.execution.teardown.cancelUserExecutions, args);
    return false;
  }
  const state = await ctx.runQuery(
    internal.execution.teardown_queries.getAccountCancellationState,
    { userId: args.userId },
  );
  if (!state) return false;
  const page: RootRunPage = await ctx.runQuery(
    internal.execution.teardown_queries.listUserRootRuns,
    { userId: args.userId, cursor: state.cancellationCursor ?? null },
  );
  let pageConfirmed = true;
  const pendingComponents: Array<{ cancelSafeAfter?: number }> = [];
  for (const runId of page.runIds) {
    const advanced = await ctx.runMutation(
      internal.execution.teardown.requestRunTeardown,
      { runId, requestedBy: args.userId, reason: args.reason },
    );
    pendingComponents.push(...advanced.components);
    const confirmed = await cancelOwnedComponents(ctx, advanced.components);
    pageConfirmed = advanced.done && confirmed && pageConfirmed;
  }
  await ctx.runMutation(internal.execution.teardown_cursors.saveAccountCancellationCursor, {
    userId: args.userId,
    cursor: page.isDone ? undefined : page.continueCursor,
  });
  const pending: boolean = await ctx.runQuery(
    internal.execution.teardown_queries.hasPendingUserTeardown,
    { userId: args.userId },
  );
  const done = page.isDone && pageConfirmed && !pending;
  if (!done) {
    await ctx.scheduler.runAfter(
      deletionTeardownRetryDelay(pendingComponents, Date.now()),
      internal.execution.teardown.cancelUserExecutions,
      args,
    );
  }
  return done;
}

export async function cancelChatExecutionsAndDeleteHandler(
  ctx: ActionCtx,
  args: { chatId: Id<"chats">; userId: string },
): Promise<null> {
  const state = await ctx.runQuery(
    internal.execution.teardown_queries.getChatCancellationState,
    args,
  );
  if (!state) return null;
  const sessions: SandboxSessionRef[] = await ctx.runQuery(
    internal.runtime.queries.listActiveSessionsForChatInternal,
    args,
  );
  const sessionsConfirmed = await stopSandboxSessions(ctx, sessions, "Chat deleted");
  if (!sessionsConfirmed || sessions.length >= 100) {
    await ctx.scheduler.runAfter(
      1_000,
      internal.execution.teardown.cancelChatExecutionsAndDelete,
      args,
    );
    return null;
  }
  const page: RootRunPage = await ctx.runQuery(
    internal.execution.teardown_queries.listChatRootRuns,
    { chatId: args.chatId, cursor: state.executionTeardownCursor ?? null },
  );
  let pageConfirmed = true;
  const pendingComponents: Array<{ cancelSafeAfter?: number }> = [];
  for (const runId of page.runIds) {
    const advanced = await ctx.runMutation(
      internal.execution.teardown.requestRunTeardown,
      { runId, requestedBy: args.userId, reason: "Chat deleted" },
    );
    pendingComponents.push(...advanced.components);
    const confirmed = await cancelOwnedComponents(ctx, advanced.components);
    pageConfirmed = advanced.done && confirmed && pageConfirmed;
  }
  await ctx.runMutation(internal.execution.teardown_cursors.saveChatCancellationCursor, {
    ...args,
    cursor: page.isDone ? undefined : page.continueCursor,
  });
  const pending = await ctx.runQuery(
    internal.execution.teardown_queries.hasPendingChatTeardown,
    { chatId: args.chatId },
  );
  if (!page.isDone || !pageConfirmed || pending) {
    await ctx.scheduler.runAfter(
      deletionTeardownRetryDelay(pendingComponents, Date.now()),
      internal.execution.teardown.cancelChatExecutionsAndDelete,
      args,
    );
    return null;
  }
  await ctx.runMutation(internal.chat.manage_internal.deleteSingleChat, args);
  return null;
}
