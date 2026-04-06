import { Id } from "../_generated/dataModel";
import { QueryCtx } from "../_generated/server";
import { optionalAuth } from "../lib/auth";
import { getAuthorizedMessage } from "./query_helpers";

export async function getMessageAudioUrlHandler(
  ctx: QueryCtx,
  args: { messageId: Id<"messages"> },
): Promise<string | null> {
  const auth = await optionalAuth(ctx);
  if (!auth) return null;

  const message = await getAuthorizedMessage(ctx, args.messageId, auth.userId);
  if (!message?.audioStorageId) return null;
  return await ctx.storage.getUrl(message.audioStorageId);
}
