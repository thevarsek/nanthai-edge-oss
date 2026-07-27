import type { ActionCtx } from "../_generated/server";
import {
  getPresentationCuratorContextRef,
  getPresentationCuratorTaskContextRef,
  type CuratorActionArgs,
  type CuratorTaskActionArgs,
  type PresentationCuratorContext,
} from "./generation_fanout_refs";

export async function presentationCuratorActionContext(
  ctx: ActionCtx,
  args: CuratorActionArgs,
): Promise<PresentationCuratorContext | null> {
  return await ctx.runQuery(getPresentationCuratorContextRef, args);
}

export async function presentationCuratorTaskActionContext(
  ctx: ActionCtx,
  args: CuratorTaskActionArgs,
): Promise<(PresentationCuratorContext & {
  task: PresentationCuratorContext["tasks"][number];
}) | null> {
  return await ctx.runQuery(getPresentationCuratorTaskContextRef, args);
}
