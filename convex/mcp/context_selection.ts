import type { Id } from "../_generated/dataModel";

type MessageWithMcpContext = {
  _id: Id<"messages">;
  mcpInvocationIds?: Id<"mcpInvocations">[];
};

export function selectRecentMcpInvocationIds(
  messages: MessageWithMcpContext[],
  reachableMessageIds: Set<string>,
  limit = 32,
): Id<"mcpInvocations">[] {
  const selectedNewestFirst: Id<"mcpInvocations">[] = [];
  const seen = new Set<string>();

  for (const message of messages.toReversed()) {
    if (!reachableMessageIds.has(String(message._id))) continue;
    for (const invocationId of (message.mcpInvocationIds ?? []).toReversed()) {
      const key = String(invocationId);
      if (seen.has(key)) continue;
      seen.add(key);
      selectedNewestFirst.push(invocationId);
      if (selectedNewestFirst.length === limit) {
        return selectedNewestFirst.reverse();
      }
    }
  }

  return selectedNewestFirst.reverse();
}
