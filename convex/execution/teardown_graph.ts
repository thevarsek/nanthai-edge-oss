import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  cancelRunState,
  finalizeRunCancellationIfSettled,
  type OwnedComponent,
} from "./teardown_run";
import { closeRunWriterForCancellation } from "./cancel_fence";

export { finalizeRunCancellationIfSettled } from "./teardown_run";

export async function requestExecutionTreeTeardown(
  ctx: MutationCtx,
  roots: Doc<"executionRuns">[],
  requestedBy: string,
  reason: string,
): Promise<OwnedComponent[]> {
  const components: OwnedComponent[] = [];
  for (const root of roots) {
    const advanced = await advanceRunTreeTeardown(
      ctx,
      root,
      requestedBy,
      reason,
    );
    components.push(...advanced.components);
  }
  return components;
}

export interface TeardownAdvanceResult {
  components: OwnedComponent[];
  done: boolean;
}

// Every task may need a child-page query. Convex permits only one paginated
// query per function call, so advance exactly one durable frontier task at a
// time. The owning action reschedules until the frontier is settled.
const TEARDOWN_TASKS_PER_MUTATION = 1;
const TEARDOWN_CHILDREN_PER_PAGE = 50;

export async function advanceRunTreeTeardown(
  ctx: MutationCtx,
  root: Doc<"executionRuns">,
  requestedBy: string,
  reason: string,
): Promise<TeardownAdvanceResult> {
  const now = Date.now();
  const rootTask = await ctx.db
    .query("executionTeardownTasks")
    .withIndex("by_root_run", (q) =>
      q.eq("rootRunId", root._id).eq("runId", root._id),
    )
    .unique();
  if (!rootTask) {
    await ctx.db.insert("executionTeardownTasks", {
      rootRunId: root._id,
      runId: root._id,
      userId: root.userId,
      chatId: root.chatId,
      requestedBy,
      reason: reason.slice(0, 2_000),
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
  }

  const candidates = (await Promise.all(
    // Prefer leaf progress over parents waiting on those leaves. Within one
    // status, newest-first also selects descendants inserted after a parent.
    (["cancelling", "pending", "expanding", "waiting_for_children"] as const).map((status) =>
      ctx.db
        .query("executionTeardownTasks")
        .withIndex("by_root_status", (q) =>
          q.eq("rootRunId", root._id).eq("status", status),
        )
        .order("desc")
        .take(TEARDOWN_TASKS_PER_MUTATION),
    ),
  )).flat().slice(0, TEARDOWN_TASKS_PER_MUTATION);
  const components: OwnedComponent[] = [];

  for (const task of candidates) {
    const run = await ctx.db.get(task.runId);
    if (!run) {
      await ctx.db.patch(task._id, { status: "settled", updatedAt: now });
      continue;
    }
    if (task.status === "cancelling") {
      if (["completed", "failed", "cancelled"].includes(run.state)) {
        const pendingComponent = await Promise.all(
          (["active", "cancel_requested"] as const).map((status) => ctx.db
            .query("executionComponentRefs")
            .withIndex("by_run_status", (q) => q
              .eq("runId", run._id)
              .eq("status", status))
            .first()),
        );
        if (!pendingComponent.some(Boolean)) {
          await ctx.db.patch(task._id, { status: "settled", updatedAt: now });
          continue;
        }
        const cancelled = await cancelRunState(ctx, run, requestedBy, reason, now);
        components.push(...cancelled.components);
        continue;
      }
      const cancelled = await cancelRunState(ctx, run, requestedBy, reason, now);
      components.push(...cancelled.components);
      if (cancelled.localDone && cancelled.components.length === 0) {
        const settled = await finalizeRunCancellationIfSettled(ctx, run._id, now);
        if (settled) {
          await ctx.db.patch(task._id, { status: "settled", updatedAt: now });
        }
      }
      continue;
    }

    if (task.status === "waiting_for_children") {
      const childPage = await ctx.db
        .query("executionRuns")
        .withIndex("by_parent", (q) => q.eq("parentRunId", run._id))
        .paginate({
          cursor: task.childCursor ?? null,
          numItems: TEARDOWN_CHILDREN_PER_PAGE,
        });
      let pageSettled = true;
      for (const child of childPage.page) {
        const childTask = await ctx.db
          .query("executionTeardownTasks")
          .withIndex("by_root_run", (q) => q
            .eq("rootRunId", root._id)
            .eq("runId", child._id))
          .unique();
        if (!childTask || childTask.status !== "settled") {
          pageSettled = false;
          break;
        }
      }
      if (!pageSettled) continue;
      if (!childPage.isDone) {
        await ctx.db.patch(task._id, {
          childCursor: childPage.continueCursor,
          updatedAt: now,
        });
        continue;
      }
      const cancelled = await cancelRunState(ctx, run, requestedBy, reason, now);
      components.push(...cancelled.components);
      await ctx.db.patch(task._id, {
        status: "cancelling",
        childCursor: undefined,
        updatedAt: now,
      });
      continue;
    }

    const childPage = await ctx.db
      .query("executionRuns")
      .withIndex("by_parent", (q) => q.eq("parentRunId", run._id))
      .paginate({
        cursor: task.childCursor ?? null,
        numItems: TEARDOWN_CHILDREN_PER_PAGE,
      });
    for (const child of childPage.page) {
      const existing = await ctx.db
        .query("executionTeardownTasks")
        .withIndex("by_root_run", (q) =>
          q.eq("rootRunId", root._id).eq("runId", child._id),
        )
        .unique();
      if (!existing) {
        await ctx.db.insert("executionTeardownTasks", {
          rootRunId: root._id,
          runId: child._id,
          userId: child.userId,
          chatId: child.chatId,
          requestedBy,
          reason: reason.slice(0, 2_000),
          status: "pending",
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    if (!childPage.isDone) {
      await ctx.db.patch(task._id, {
        status: "expanding",
        childCursor: childPage.continueCursor,
        updatedAt: now,
      });
      continue;
    }
    if (!["completed", "failed", "cancelled", "cancelling"].includes(run.state)) {
      await ctx.db.patch(run._id, {
        state: "cancelling",
        cancelRequestedAt: run.cancelRequestedAt ?? now,
        cancelRequestedBy: run.cancelRequestedBy ?? requestedBy,
        terminalSummary: reason.slice(0, 2_000),
        updatedAt: now,
      });
    }
    // All children are now durably represented. A separate bounded phase
    // waits for those descendants before touching parent-owned components.
    await ctx.db.patch(task._id, {
      status: "waiting_for_children",
      childCursor: undefined,
      updatedAt: now,
    });
  }
  const remaining = await Promise.all(
    (["pending", "expanding", "waiting_for_children", "cancelling"] as const).map((status) =>
      ctx.db
        .query("executionTeardownTasks")
        .withIndex("by_root_status", (q) =>
          q.eq("rootRunId", root._id).eq("status", status),
        )
        .first(),
    ),
  );
  return { components, done: remaining.every((task) => task == null) };
}

export async function requestRunTreeTeardown(
  ctx: MutationCtx,
  runId: Id<"executionRuns">,
  requestedBy: string,
  reason: string,
): Promise<OwnedComponent[]> {
  const run = await closeRunWriterForCancellation(
    ctx,
    runId,
    requestedBy,
    reason,
  );
  if (!run) return [];
  return (await advanceRunTreeTeardown(ctx, run, requestedBy, reason)).components;
}

export async function closeChatExecutionWriters(
  ctx: MutationCtx,
  chatId: Id<"chats">,
  requestedBy: string,
): Promise<void> {
  const activeStates = [
    "queued",
    "running",
    "waiting",
    "waiting_for_input",
    "waiting_for_permission",
    "interrupted",
  ] as const;
  const runs = (await Promise.all(activeStates.map((state) => ctx.db
    .query("executionRuns")
    .withIndex("by_chat_state", (q) => q.eq("chatId", chatId).eq("state", state))
    .take(25)))).flat().slice(0, 25);
  const now = Date.now();
  for (const run of runs) {
    await ctx.db.patch(run._id, {
      state: "cancelling",
      cancelRequestedAt: run.cancelRequestedAt ?? now,
      cancelRequestedBy: run.cancelRequestedBy ?? requestedBy,
      updatedAt: now,
    });
  }
}
