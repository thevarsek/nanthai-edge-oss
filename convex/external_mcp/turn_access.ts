// convex/external_mcp/turn_access.ts
// What an external MCP turn may do, derived from the grant's access scopes.
// chat:write alone is a cloud text turn with tools off; chat:tools enables
// tools and connected apps; runtime:local (with chat:tools) allows a Persona
// routed to the user's paired computer.

import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { resolveEffectiveParticipantRoute } from "../runtime_host/route_resolution";

export type TurnAccess = { tools: boolean; local: boolean };

export function turnAccess(scopes: readonly string[]): TurnAccess {
  const tools = scopes.includes("chat:tools");
  return { tools, local: tools && scopes.includes("runtime:local") };
}

export async function assertTurnRoutesAllowed(
  ctx: QueryCtx,
  userId: string,
  participants: Doc<"chatParticipants">[],
  access: TurnAccess,
): Promise<void> {
  if (access.local) return;
  for (const participant of participants) {
    const route = await resolveEffectiveParticipantRoute(ctx, { userId, chatParticipantId: participant._id });
    if (route?.placement === "local") {
      throw new ConvexError({
        code: "SCOPE_REQUIRED",
        message: "This chat runs on your paired computer. Reconnect this AI client and allow “Run on your paired computer” to use it.",
      });
    }
  }
}
