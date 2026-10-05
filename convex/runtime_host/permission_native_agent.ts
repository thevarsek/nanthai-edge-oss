import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

export type PermissionNativeAgentIdentity = {
  origin: "codex_native_agent";
  nativeThreadId: string;
  label: string;
  nickname?: string;
  role?: string;
};

const MAX_IDENTITY_LABEL_CODE_UNITS = 512;

export async function projectPermissionNativeAgent(
  ctx: QueryCtx,
  request: Doc<"runtimePermissionRequests">,
): Promise<PermissionNativeAgentIdentity | undefined> {
  const nativeThreadId = request.nativeAgentThreadId;
  if (!nativeThreadId) return undefined;
  const fallback = identity(nativeThreadId);
  const group = await ctx.db.query("runtimeNativeAgentGroups")
    .withIndex("by_attempt", (index) => index.eq("attemptId", request.attemptId))
    .unique();
  if (
    !group
    || group.userId !== request.userId
    || group.chatId !== request.chatId
    || group.runId !== request.runId
    || group.fence !== request.fence
  ) return fallback;
  const agent = await ctx.db.query("runtimeNativeAgents")
    .withIndex("by_group_thread", (index) =>
      index.eq("groupId", group._id).eq("nativeThreadId", nativeThreadId)
    )
    .unique();
  if (!agent || agent.userId !== request.userId) return fallback;
  return identity(nativeThreadId, agent.nickname, agent.role);
}

function identity(
  nativeThreadId: string,
  nickname?: string,
  role?: string,
): PermissionNativeAgentIdentity {
  const normalizedNickname = nickname?.trim() || undefined;
  const normalizedRole = role?.trim() || undefined;
  const combined = normalizedNickname && normalizedRole
    ? normalizedNickname.localeCompare(normalizedRole, undefined, { sensitivity: "accent" }) === 0
      ? normalizedNickname
      : `${normalizedNickname} · ${normalizedRole}`
    : normalizedNickname ?? normalizedRole ?? nativeThreadId;
  return {
    origin: "codex_native_agent",
    nativeThreadId,
    label: truncateUnicodeSafe(combined, MAX_IDENTITY_LABEL_CODE_UNITS),
    ...(normalizedNickname ? { nickname: normalizedNickname } : {}),
    ...(normalizedRole ? { role: normalizedRole } : {}),
  };
}

function truncateUnicodeSafe(value: string, maximumCodeUnits: number): string {
  let codeUnits = 0;
  let result = "";
  for (const character of value) {
    if (codeUnits + character.length > maximumCodeUnits) break;
    result += character;
    codeUnits += character.length;
  }
  return result;
}
