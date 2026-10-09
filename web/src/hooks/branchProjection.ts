import type { Id } from "@convex/_generated/dataModel";
import type { Message } from "./useChat";

export function directParentIds(message: Message): Set<Id<"messages">> {
  return new Set((message.parentMessageIds ?? []).filter((parentId) => parentId !== message._id));
}

function sharesAnyDirectParent(left: Message, right: Message): boolean {
  const leftParents = directParentIds(left);
  const rightParents = directParentIds(right);
  if (leftParents.size === 0 || rightParents.size === 0) return false;
  for (const parentId of leftParents) {
    if (rightParents.has(parentId)) return true;
  }
  return false;
}

function siblingCandidates(message: Message, messages: Message[]): Message[] {
  const byId = new Map(messages.map(candidate => [candidate._id, candidate]));
  const ancestors = ancestryIds(message._id, byId);
  const rawCandidates = messages
    .filter((candidate) => candidate._id !== message._id && sharesAnyDirectParent(message, candidate)
      && !ancestors.has(candidate._id) && !ancestryIds(candidate._id, byId).has(message._id))
    .sort((a, b) => a.createdAt - b.createdAt);

  const seenMultiGroups = new Set<string>();
  return rawCandidates.filter((candidate) => {
    const groupId = candidate.multiModelGroupId;
    if (!groupId) return true;
    if (groupId === message.multiModelGroupId) return false;
    if (seenMultiGroups.has(groupId)) return false;
    seenMultiGroups.add(groupId);
    return true;
  });
}

export function allSiblings(message: Message, messages: Message[]): Message[] {
  return [message, ...siblingCandidates(message, messages)].sort((a, b) => a.createdAt - b.createdAt);
}

export function ancestryIds(leafId: Id<"messages">, messagesById: Map<Id<"messages">, Message>): Set<Id<"messages">> {
  const ids = new Set<Id<"messages">>();
  const stack: Id<"messages">[] = [leafId];

  while (stack.length > 0) {
    const currentId = stack.pop();
    if (!currentId || ids.has(currentId)) continue;
    ids.add(currentId);

    const current = messagesById.get(currentId);
    if (!current) continue;
    for (const parentId of directParentIds(current)) {
      stack.push(parentId);
    }
  }

  return ids;
}

