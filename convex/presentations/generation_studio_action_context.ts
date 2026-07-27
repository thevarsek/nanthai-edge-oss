import type { ActionCtx } from "../_generated/server";
import {
  getPresentationStudioContextRef,
  type PresentationStudioContext,
  type StudioActionArgs,
} from "./generation_fanout_refs";

export async function presentationStudioActionContext(
  ctx: ActionCtx,
  args: StudioActionArgs,
): Promise<PresentationStudioContext | null> {
  return await ctx.runQuery(getPresentationStudioContextRef, args);
}
