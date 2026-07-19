import type { WorkflowId } from "@convex-dev/workflow";
import type { WorkId } from "@convex-dev/workpool";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import {
  backgroundWorkpool,
  durableWorkflow,
  interactiveWorkpool,
  maintenanceWorkpool,
} from "./components";

export type OwnedComponentCancellation = {
  componentRefId?: Id<"executionComponentRefs">;
  operationId: string;
  adapterId: string;
  cancelSafeAfter?: number;
};

export type SandboxSessionRef = {
  sessionId: Id<"sandboxSessions">;
  providerSandboxId?: string;
};

function isSettledWorkflowError(error: unknown): boolean {
  return error instanceof Error
    && /Workflow(?: .*?)? (?:not found|not running)/i.test(error.message);
}

export async function stopSandboxSessions(
  ctx: ActionCtx,
  sessions: SandboxSessionRef[],
  reason: string,
): Promise<boolean> {
  let allConfirmed = true;
  for (const session of sessions) {
    const stopped = session.providerSandboxId
      ? await ctx.runAction(internal.runtime.cleanup.stopSandboxById, {
          providerSandboxId: session.providerSandboxId,
        })
      : true;
    if (stopped) {
      await ctx.runMutation(internal.runtime.mutations.confirmSessionDeletedInternal, {
        sessionId: session.sessionId,
        reason,
      });
    } else {
      allConfirmed = false;
    }
  }
  return allConfirmed;
}

export async function cancelComponent(
  ctx: Parameters<typeof durableWorkflow.cancel>[0],
  adapterId: string,
  operationId: string,
): Promise<boolean> {
  try {
    if (adapterId === "convex-workflow") {
      const status = await durableWorkflow.status(ctx, operationId as WorkflowId);
      if (status.type !== "inProgress") return true;
      await durableWorkflow.cancel(ctx, operationId as WorkflowId);
    } else if (adapterId === "interactive-workpool") {
      await interactiveWorkpool.cancel(ctx, operationId as WorkId);
      return (await interactiveWorkpool.status(ctx, operationId as WorkId)).state === "finished";
    } else if (adapterId === "background-workpool") {
      await backgroundWorkpool.cancel(ctx, operationId as WorkId);
      return (await backgroundWorkpool.status(ctx, operationId as WorkId)).state === "finished";
    } else if (adapterId === "maintenance-workpool") {
      await maintenanceWorkpool.cancel(ctx, operationId as WorkId);
      return (await maintenanceWorkpool.status(ctx, operationId as WorkId)).state === "finished";
    } else {
      return false;
    }
    return true;
  } catch (error) {
    return adapterId === "convex-workflow" && isSettledWorkflowError(error);
  }
}

export async function cancelOwnedComponents(
  ctx: ActionCtx,
  components: OwnedComponentCancellation[],
): Promise<boolean> {
  let allConfirmed = true;
  for (const component of components) {
    const videoJobId = component.adapterId === "external-cloud"
      && component.operationId.startsWith("openrouter-video:")
      ? component.operationId.slice("openrouter-video:".length)
      : null;
    const cancelled = videoJobId
      ? await ctx.runAction(internal.chat.video_reconciliation.reconcileCancelledProvider, {
          videoJobId: videoJobId as Id<"videoJobs">,
        })
      : await cancelComponent(ctx, component.adapterId, component.operationId);
    allConfirmed = cancelled && allConfirmed;
    if (component.componentRefId) {
      await ctx.runMutation(internal.execution.teardown.finishComponentCancellation, {
        componentRefId: component.componentRefId,
        cancelled,
      });
    }
  }
  return allConfirmed;
}
