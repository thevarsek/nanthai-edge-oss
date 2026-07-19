import type { ActionCtx } from "../_generated/server";
import {
  getPresentationCuratorContextRef,
  getPresentationCuratorTaskContextRef,
  type CuratorActionArgs,
  type CuratorTaskActionArgs,
  type PresentationCuratorContext,
} from "./generation_fanout_refs";
import { resolvePresentationActionContext } from "./legacy_action_identity";

export async function presentationCuratorActionContext(
  ctx: ActionCtx,
  args: CuratorActionArgs,
): Promise<PresentationCuratorContext | null> {
  return await resolvePresentationActionContext(
    ctx,
    args,
    async () => await ctx.runQuery(getPresentationCuratorContextRef, args),
  );
}

export async function presentationCuratorTaskActionContext(
  ctx: ActionCtx,
  args: CuratorTaskActionArgs,
): Promise<(PresentationCuratorContext & {
  task: PresentationCuratorContext["tasks"][number];
}) | null> {
  return await resolvePresentationActionContext(
    ctx,
    args,
    async () => await ctx.runQuery(getPresentationCuratorTaskContextRef, args),
  );
}
