import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { deletePresentationProjectData } from
  "../presentations/project_cleanup";

/** Delete at most one presentation graph so chat deletion stays bounded. */
export async function deleteChatPresentationDataBatch(
  ctx: MutationCtx,
  chatId: Id<"chats">,
): Promise<boolean> {
  const [project] = await ctx.db
    .query("presentationProjects")
    .withIndex("by_chat", (query) => query.eq("chatId", chatId))
    .take(1);
  if (!project) return false;

  await deletePresentationProjectData(ctx, project);
  return true;
}
