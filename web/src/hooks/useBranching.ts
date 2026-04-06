// hooks/useBranching.ts
// DAG branch resolution — mirrors iOS ChatViewModel+Branching.swift.
// Given the flat message list, computes the active branch path and
// sibling navigation state for each divergence point.
// Multi-model responses (same multiModelGroupId) are NOT treated as branches.

import { useMemo, useCallback, useState } from "react";
import type { Id } from "@convex/_generated/dataModel";
import type { Message } from "./useChat";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BranchNode {
  messageId: Id<"messages">;
  /** All sibling messages at this branch point (same parentMessageIds set). */
  siblings: Id<"messages">[];
  /** Index of the currently-selected sibling. */
  activeIndex: number;
  /** True when all siblings are on the active path (branches merged back). */
  allOnPath: boolean;
}

export interface BranchState {
  /** IDs of messages on the currently-active path, in chronological order. */
  activePath: Id<"messages">[];
  /** Map from message ID to its branch node info (only divergence points). */
  branchNodes: Map<Id<"messages">, BranchNode>;
  /** Resolve prev/next sibling at a divergence point. */
  navigate: (messageId: Id<"messages">, direction: "prev" | "next") => {
    currentSiblingId: Id<"messages">;
    targetSiblingId: Id<"messages">;
    optimisticLeafId: Id<"messages">;
  } | undefined;
  optimisticLeafId?: Id<"messages">;
  setOptimisticLeafId: (leafId?: Id<"messages">) => void;
}

interface UseBranchingOptions {
  activeLeafId?: Id<"messages">;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function directParentIds(message: Message): Set<Id<"messages">> {
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
  const rawCandidates = messages
    .filter((candidate) => candidate._id !== message._id && sharesAnyDirectParent(message, candidate))
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

function allSiblings(message: Message, messages: Message[]): Message[] {
  return [message, ...siblingCandidates(message, messages)].sort((a, b) => a.createdAt - b.createdAt);
}

function childrenByAnyParent(messages: Message[]): Map<Id<"messages">, Message[]> {
  const result = new Map<Id<"messages">, Message[]>();

  for (const message of messages) {
    for (const parentId of directParentIds(message)) {
      const list = result.get(parentId) ?? [];
      list.push(message);
      result.set(parentId, list);
    }
  }

  for (const [parentId, children] of result) {
    const uniqueChildren = new Map(children.map((child) => [child._id, child]));
    result.set(parentId, [...uniqueChildren.values()].sort((a, b) => a.createdAt - b.createdAt));
  }

  return result;
}

function ancestryIds(leafId: Id<"messages">, messagesById: Map<Id<"messages">, Message>): Set<Id<"messages">> {
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

function latestLeafId(messages: Message[]): Id<"messages"> | undefined {
  const childrenByParent = childrenByAnyParent(messages);
  const leaves = messages.filter((message) => !childrenByParent.has(message._id));
  // Prefer non-failed, non-cancelled leaves so a stale message from an old
  // branch doesn't get picked over the successful retry branch.
  const nonStalLeaves = leaves.filter(
    (message) => message.status !== "failed" && message.status !== "cancelled",
  );
  const preferred = nonStalLeaves.length > 0 ? nonStalLeaves : leaves;
  return preferred[preferred.length - 1]?._id;
}

function representativeMessageId(message: Message, activePathMessages: Message[]): Id<"messages"> {
  if (!(message.isMultiModelResponse && message.multiModelGroupId)) {
    return message._id;
  }

  const firstInGroup = activePathMessages.find(
    (candidate) => candidate.multiModelGroupId === message.multiModelGroupId,
  );
  return firstInGroup?._id ?? message._id;
}

function dedupeBranchChildren(children: Message[]): Message[] {
  const seenMultiGroups = new Set<string>();
  return children.filter((candidate) => {
    const groupId = candidate.multiModelGroupId;
    if (!groupId) return true;
    if (seenMultiGroups.has(groupId)) return false;
    seenMultiGroups.add(groupId);
    return true;
  });
}

function findPathFromAncestorToLeaf(
  ancestorId: Id<"messages">,
  leafId: Id<"messages">,
  childrenMap: Map<Id<"messages">, Message[]>,
  allowedNodeIds: Set<Id<"messages">>,
): Id<"messages">[] | undefined {
  if (ancestorId === leafId) return [ancestorId];
  const queue: Id<"messages">[][] = [[ancestorId]];

  while (queue.length > 0) {
    const path = queue.shift();
    const currentId = path?.[path.length - 1];
    if (!path || !currentId) continue;

    for (const child of childrenMap.get(currentId) ?? []) {
      if (!allowedNodeIds.has(child._id)) continue;
      const nextPath = [...path, child._id];
      if (child._id === leafId) return nextPath;
      queue.push(nextPath);
    }
  }

  return undefined;
}

function branchFamilyIndexForChild(child: Message, family: Message[]): number | undefined {
  if (child.multiModelGroupId) {
    const groupIndex = family.findIndex((candidate) => candidate.multiModelGroupId === child.multiModelGroupId);
    if (groupIndex >= 0) return groupIndex;
  }
  const idIndex = family.findIndex((candidate) => candidate._id === child._id);
  return idIndex >= 0 ? idIndex : undefined;
}

function descendPreferredLeaf(startId: Id<"messages">, childrenMap: Map<Id<"messages">, Message[]>): Id<"messages"> {
  let currentId = startId;
  while (true) {
    const next = dedupeBranchChildren(childrenMap.get(currentId) ?? [])[0];
    if (!next) return currentId;
    currentId = next._id;
  }
}

function resolveOptimisticLeafId(
  messages: Message[],
  currentSiblingId: Id<"messages">,
  targetSiblingId: Id<"messages">,
  activeLeafId?: Id<"messages">,
): Id<"messages"> {
  const sortedMessages = [...messages].sort((a, b) => a.createdAt - b.createdAt);
  const messagesById = new Map(sortedMessages.map((message) => [message._id, message] as const));
  const currentSibling = messagesById.get(currentSiblingId);
  const targetSibling = messagesById.get(targetSiblingId);
  if (!currentSibling || !targetSibling) {
    return targetSiblingId;
  }

  const resolvedLeafId =
    (activeLeafId && messagesById.has(activeLeafId) ? activeLeafId : latestLeafId(sortedMessages)) ?? currentSibling._id;
  const leafAncestryIds = ancestryIds(resolvedLeafId, messagesById);
  const childrenMap = childrenByAnyParent(sortedMessages);
  const sourcePath = leafAncestryIds.has(currentSibling._id)
    ? findPathFromAncestorToLeaf(currentSibling._id, resolvedLeafId, childrenMap, leafAncestryIds)
    : undefined;

  if (!sourcePath || sourcePath.length <= 1) {
    return descendPreferredLeaf(targetSibling._id, childrenMap);
  }

  let currentTargetId = targetSibling._id;
  for (let index = 0; index < sourcePath.length - 1; index += 1) {
    const sourceNode = messagesById.get(sourcePath[index]);
    const nextSourceChild = messagesById.get(sourcePath[index + 1]);
    if (!sourceNode || !nextSourceChild) break;

    const sourceFamily = dedupeBranchChildren(childrenMap.get(sourceNode._id) ?? []);
    const targetFamily = dedupeBranchChildren(childrenMap.get(currentTargetId) ?? []);
    if (targetFamily.length === 0) return currentTargetId;

    const nextTarget = sourceFamily.length <= 1
      ? targetFamily[0]
      : targetFamily[branchFamilyIndexForChild(nextSourceChild, sourceFamily) ?? 0] ?? targetFamily[0];
    if (!nextTarget || nextTarget._id === currentTargetId) {
      return currentTargetId;
    }
    currentTargetId = nextTarget._id;
  }

  return descendPreferredLeaf(currentTargetId, childrenMap);
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useBranching(messages: Message[], options?: UseBranchingOptions): BranchState {
  const [optimisticLeafId, setOptimisticLeafIdState] = useState<Id<"messages"> | undefined>(undefined);
  const effectiveLeafId = optimisticLeafId ?? options?.activeLeafId;

  const setOptimisticLeafId = useCallback((leafId?: Id<"messages">) => {
    setOptimisticLeafIdState(leafId);
  }, []);

  const activePath = useMemo<Id<"messages">[]>(() => {
    if (messages.length === 0) return [];

    const byId = new Map(messages.map((message) => [message._id, message] as const));
    const leafId = effectiveLeafId && byId.has(effectiveLeafId)
      ? effectiveLeafId
      : latestLeafId(messages);

    if (!leafId) {
      return messages.map((message) => message._id);
    }

    const pathIds = ancestryIds(leafId, byId);
    const touchedGroupIds = new Set(
      messages
        .filter((message) => pathIds.has(message._id))
        .flatMap((message) => (message.multiModelGroupId ? [message.multiModelGroupId] : [])),
    );

    if (touchedGroupIds.size > 0) {
      for (const message of messages) {
        if (message.multiModelGroupId && touchedGroupIds.has(message.multiModelGroupId)) {
          pathIds.add(message._id);
        }
      }
    }

    return messages
      .filter((message) => pathIds.has(message._id))
      .map((message) => message._id);
  }, [effectiveLeafId, messages]);

  const branchNodes = useMemo<Map<Id<"messages">, BranchNode>>(() => {
    const result = new Map<Id<"messages">, BranchNode>();
    const activePathSet = new Set(activePath);
    const activePathMessages = activePath
      .map((messageId) => messages.find((message) => message._id === messageId))
      .filter(Boolean) as Message[];

    for (const message of activePathMessages) {
      const siblings = allSiblings(message, messages);
      if (siblings.length <= 1) continue;

      const representativeId = representativeMessageId(message, activePathMessages);
      if (result.has(representativeId)) continue;

      const activeIndex = siblings.findIndex((candidate) => candidate._id === message._id);
      const allOnPath = siblings.every((sibling) => activePathSet.has(sibling._id));
      result.set(representativeId, {
        messageId: representativeId,
        siblings: siblings.map((candidate) => candidate._id),
        activeIndex: activeIndex >= 0 ? activeIndex : 0,
        allOnPath,
      });
    }

    return result;
  }, [activePath, messages]);

  const navigate = useCallback(
    (messageId: Id<"messages">, direction: "prev" | "next") => {
      // The BranchIndicator passes the representative ID (which may differ
      // from the actual active-path message for multi-model groups).
      // Look up the pre-computed BranchNode to get the canonical sibling
      // list and active index rather than recomputing from scratch — this
      // guarantees consistency with what the UI is showing.
      const node = branchNodes.get(messageId);
      if (!node || node.siblings.length <= 1) return undefined;

      const nextIndex =
        direction === "prev"
          ? node.activeIndex - 1
          : node.activeIndex + 1;

      if (nextIndex < 0 || nextIndex >= node.siblings.length) return undefined;

      return {
        currentSiblingId: node.siblings[node.activeIndex],
        targetSiblingId: node.siblings[nextIndex],
        optimisticLeafId: resolveOptimisticLeafId(
          messages,
          node.siblings[node.activeIndex],
          node.siblings[nextIndex],
          effectiveLeafId,
        ),
      };
    },
    [branchNodes, effectiveLeafId, messages],
  );

  return { activePath, branchNodes, navigate, optimisticLeafId, setOptimisticLeafId };
}
