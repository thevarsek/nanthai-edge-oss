export function nextActiveBranchFocusOrder(localFocusOrder: number, serverFocusOrder?: number | null): number {
  return Math.max(localFocusOrder + 1, Math.floor(serverFocusOrder ?? 0) + 1);
}

export interface BranchFocusMessage {
  _id: string;
  createdAt: number;
  parentMessageIds?: string[];
  multiModelGroupId?: string;
}

export function resolveIdeascapeBranchLeafId(
  messages: BranchFocusMessage[],
  focusedMessageId: string,
  preferredLeafId?: string | null,
): string {
  const sorted = [...messages].sort((a, b) => a.createdAt - b.createdAt);
  const byId = new Map(sorted.map((message) => [message._id, message]));
  const childrenByParent = new Map<string, BranchFocusMessage[]>();
  for (const message of sorted) {
    for (const parentId of message.parentMessageIds ?? []) {
      if (parentId === message._id) continue;
      const children = childrenByParent.get(parentId) ?? [];
      children.push(message);
      childrenByParent.set(parentId, children);
    }
  }

  const preferredPath = preferredLeafId && byId.has(preferredLeafId)
    ? collectAncestryIds(preferredLeafId, byId)
    : null;
  if (!preferredPath) {
    return newestDescendantLeafId(focusedMessageId, byId, childrenByParent);
  }
  let currentId = focusedMessageId;
  const visited = new Set<string>();
  while (true) {
    if (visited.has(currentId)) return currentId;
    visited.add(currentId);
    const children = childrenByParent.get(currentId) ?? [];
    if (children.length === 0) return currentId;
    const preferredChild = preferredPath
      ? children.find((child) => preferredPath.has(child._id))
      : undefined;
    currentId = (preferredChild ?? children[children.length - 1])._id;
  }
}

function newestDescendantLeafId(
  focusedMessageId: string,
  byId: Map<string, BranchFocusMessage>,
  childrenByParent: Map<string, BranchFocusMessage[]>,
): string {
  const visited = new Set<string>();
  const stack = [focusedMessageId];
  let newestLeaf: BranchFocusMessage | undefined;
  while (stack.length > 0) {
    const currentId = stack.pop()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);
    const children = childrenByParent.get(currentId) ?? [];
    if (children.length === 0) {
      const current = byId.get(currentId);
      if (current && (!newestLeaf || current.createdAt >= newestLeaf.createdAt)) {
        newestLeaf = current;
      }
    } else {
      stack.push(...children.map((child) => child._id));
    }
  }
  return newestLeaf?._id ?? focusedMessageId;
}

export function collectIdeascapeBranchIds(
  messages: BranchFocusMessage[],
  rootIds: string[],
): Set<string> {
  const byId = new Map(messages.map((message) => [message._id, message]));
  const branch = new Set<string>();
  const stack = [...rootIds];
  while (stack.length > 0) {
    const currentId = stack.pop()!;
    if (branch.has(currentId)) continue;
    branch.add(currentId);
    const message = byId.get(currentId);
    for (const parentId of message?.parentMessageIds ?? []) {
      if (parentId !== currentId && !branch.has(parentId)) stack.push(parentId);
    }
  }
  const touchedGroups = new Set<string>();
  for (const message of messages) {
    if (branch.has(message._id) && message.multiModelGroupId) {
      touchedGroups.add(message.multiModelGroupId);
    }
  }
  if (touchedGroups.size > 0) {
    for (const message of messages) {
      if (message.multiModelGroupId && touchedGroups.has(message.multiModelGroupId)) {
        branch.add(message._id);
      }
    }
  }
  return branch;
}

function collectAncestryIds(leafId: string, byId: Map<string, BranchFocusMessage>): Set<string> {
  const visited = new Set<string>();
  const stack = [leafId];
  while (stack.length > 0) {
    const currentId = stack.pop()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);
    const message = byId.get(currentId);
    for (const parentId of message?.parentMessageIds ?? []) {
      if (parentId !== currentId) stack.push(parentId);
    }
  }
  return visited;
}
