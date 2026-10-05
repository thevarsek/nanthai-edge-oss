import { nestedString } from "./app_server_protocol_mapping.ts";

export function notificationThreadId(
  method: string,
  params: unknown,
): string | null {
  return method === "thread/started"
    ? nestedString(params, "thread", "id")
    : nestedString(params, "threadId");
}

export function startedThreadParent(
  method: string,
  params: unknown,
): string | null {
  return method === "thread/started"
    ? nestedString(params, "thread", "parentThreadId")
    : null;
}

export function observedChildThreadId(
  method: string,
  params: unknown,
): string | null {
  if (method !== "item/started" && method !== "item/completed") return null;
  return nestedString(params, "item", "type") === "subAgentActivity"
    ? nestedString(params, "item", "agentThreadId") : null;
}

export function removeThreadTree(
  roots: Map<string, string>,
  rootThreadId: string,
): void {
  for (const [threadId, root] of roots) {
    if (root === rootThreadId) roots.delete(threadId);
  }
}
