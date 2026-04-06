// components/ideascape/treeLayout.ts
// Port of iOS IdeascapeLayoutEngine.swift — 5-phase tree layout algorithm.
// Generates (x, y) positions for message nodes arranged as a tree.

import type { Message } from "@/hooks/useChat";

// ─── Constants (matching iOS) ──────────────────────────────────────────────

export const TREE_NODE_W = 220;
export const TREE_NODE_H = 120;
export const TREE_V_SPACING = 40;
export const TREE_H_SPACING = 30;
export const TREE_ROW_H = TREE_NODE_H + TREE_V_SPACING; // 160
export const TREE_COL_W = TREE_NODE_W + TREE_H_SPACING; // 250

// ─── Internal tree node ────────────────────────────────────────────────────

interface TreeNode {
  messageId: string;
  children: TreeNode[];
  depth: number;
  subtreeWidth: number; // in column units
}

// ─── Public API ────────────────────────────────────────────────────────────

export interface LayoutPosition {
  messageId: string;
  x: number;
  y: number;
}

/**
 * Generate tree-based layout positions for messages.
 * Matches iOS IdeascapeLayoutEngine: root at center, depth layering,
 * sibling spreading, collision avoidance for multi-model siblings.
 *
 * @param messages All messages in the chat
 * @param existingPositionIds Set of message IDs that already have stored positions
 *   (those are skipped in the output — caller preserves them)
 * @returns Map from message ID to { x, y } for ALL messages (including existing,
 *   so the caller can use this as a complete fallback map)
 */
export function computeTreeLayout(
  messages: Message[],
): Map<string, { x: number; y: number }> {
  const result = new Map<string, { x: number; y: number }>();
  if (messages.length === 0) return result;

  // Build parent → children lookup (using first parentMessageId as the tree parent)
  const childrenByParent = new Map<string, Message[]>();
  for (const msg of messages) {
    const parentId = msg.parentMessageIds?.[0] as string | undefined;
    if (parentId && parentId !== (msg._id as string)) {
      const list = childrenByParent.get(parentId) ?? [];
      list.push(msg);
      childrenByParent.set(parentId, list);
    }
  }

  // Sort children by creation time
  for (const [key, children] of childrenByParent) {
    childrenByParent.set(key, children.sort((a, b) => a.createdAt - b.createdAt));
  }

  // Identify multi-model first IDs
  const multiModelFirstIDs = computeMultiModelFirstIDs(messages);

  // Find root messages (no parent, or self-referencing)
  const messageIdSet = new Set(messages.map((m) => m._id as string));
  let roots = messages
    .filter((m) => {
      const parentId = m.parentMessageIds?.[0] as string | undefined;
      return !parentId || parentId === (m._id as string);
    })
    .sort((a, b) => a.createdAt - b.createdAt);

  // Fallback: orphans whose parent doesn't exist in the message set
  if (roots.length === 0) {
    roots = messages
      .filter((m) => {
        const parentId = m.parentMessageIds?.[0] as string | undefined;
        if (!parentId) return true;
        return parentId === (m._id as string) || !messageIdSet.has(parentId);
      })
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  // Last resort: earliest message
  if (roots.length === 0) {
    const sorted = [...messages].sort((a, b) => a.createdAt - b.createdAt);
    if (sorted.length > 0) roots = [sorted[0]];
  }

  if (roots.length === 0) return result;

  // Phase 1-2: Build trees and calculate subtree widths
  const trees = roots.map((r) =>
    buildTree(r, childrenByParent, multiModelFirstIDs, 0),
  );
  for (const tree of trees) {
    calculateSubtreeWidth(tree);
  }

  // Phase 3: Assign positions — roots placed side by side
  const positions: LayoutPosition[] = [];
  let currentX = 0;
  for (const tree of trees) {
    assignPositions(tree, currentX, positions);
    currentX += tree.subtreeWidth * TREE_COL_W;
  }

  // Phase 4: Center layout around x=0
  const allX = positions.map((p) => p.x);
  const minX = Math.min(...allX);
  const maxX = Math.max(...allX);
  const midX = (minX + maxX) / 2;

  for (const pos of positions) {
    result.set(pos.messageId, { x: pos.x - midX, y: pos.y });
  }

  // Phase 5: Position multi-model siblings not in the tree
  positionMultiModelSiblings(
    messages,
    multiModelFirstIDs,
    result,
    childrenByParent,
  );

  return result;
}

// ─── Tree building ─────────────────────────────────────────────────────────

function buildTree(
  message: Message,
  childrenByParent: Map<string, Message[]>,
  multiModelFirstIDs: Set<string>,
  depth: number,
): TreeNode {
  const rawChildren = childrenByParent.get(message._id as string) ?? [];

  // Filter: skip multi-model non-first members unless they have descendants
  const filteredChildren = rawChildren.filter((child) => {
    if (!child.multiModelGroupId) return true;
    if (multiModelFirstIDs.has(child._id as string)) return true;
    // Promote non-first siblings that have children (user branched from them)
    return childrenByParent.has(child._id as string);
  });

  const children = filteredChildren.map((c) =>
    buildTree(c, childrenByParent, multiModelFirstIDs, depth + 1),
  );

  return { messageId: message._id as string, children, depth, subtreeWidth: 1 };
}

function calculateSubtreeWidth(node: TreeNode): void {
  if (node.children.length === 0) {
    node.subtreeWidth = 1;
    return;
  }
  for (const child of node.children) {
    calculateSubtreeWidth(child);
  }
  node.subtreeWidth = node.children.reduce((sum, c) => sum + c.subtreeWidth, 0);
}

function assignPositions(
  node: TreeNode,
  startX: number,
  positions: LayoutPosition[],
): void {
  const y = node.depth * TREE_ROW_H;
  const centerX = startX + (node.subtreeWidth * TREE_COL_W) / 2 - TREE_NODE_W / 2;

  positions.push({ messageId: node.messageId, x: centerX, y });

  let childStartX = startX;
  for (const child of node.children) {
    assignPositions(child, childStartX, positions);
    childStartX += child.subtreeWidth * TREE_COL_W;
  }
}

// ─── Multi-model siblings ──────────────────────────────────────────────────

function computeMultiModelFirstIDs(messages: Message[]): Set<string> {
  const firstByGroup = new Map<string, string>();
  const sorted = [...messages].sort((a, b) => a.createdAt - b.createdAt);

  for (const msg of sorted) {
    if (!msg.multiModelGroupId) continue;
    if (!firstByGroup.has(msg.multiModelGroupId)) {
      firstByGroup.set(msg.multiModelGroupId, msg._id as string);
    }
  }

  return new Set(firstByGroup.values());
}

function positionMultiModelSiblings(
  messages: Message[],
  multiModelFirstIDs: Set<string>,
  posMap: Map<string, { x: number; y: number }>,
  childrenByParent: Map<string, Message[]>,
): void {
  const positionedIds = new Set(posMap.keys());

  const multiModelSiblings = messages.filter(
    (m) =>
      m.multiModelGroupId &&
      !multiModelFirstIDs.has(m._id as string) &&
      !positionedIds.has(m._id as string),
  );

  // Group by multiModelGroupId
  const siblingsByGroup = new Map<string, Message[]>();
  for (const m of multiModelSiblings) {
    const gid = m.multiModelGroupId!;
    const list = siblingsByGroup.get(gid) ?? [];
    list.push(m);
    siblingsByGroup.set(gid, list);
  }

  // Build occupied x-ranges per y-level
  const occupiedByY = new Map<number, number[]>();
  for (const [, pos] of posMap) {
    const list = occupiedByY.get(pos.y) ?? [];
    list.push(pos.x);
    occupiedByY.set(pos.y, list);
  }

  for (const [groupId, siblings] of siblingsByGroup) {
    // Find the first member of this group
    const firstMember = messages.find(
      (m) => m.multiModelGroupId === groupId && multiModelFirstIDs.has(m._id as string),
    );
    if (!firstMember) continue;

    const firstPos = posMap.get(firstMember._id as string);
    if (!firstPos) continue;

    const sorted = siblings.sort((a, b) => a.createdAt - b.createdAt);
    const totalCount = sorted.length + 1; // +1 for first member already placed

    for (let i = 0; i < sorted.length; i++) {
      const sibling = sorted[i];
      // Skip siblings that were promoted to tree (have descendants)
      if (childrenByParent.has(sibling._id as string)) continue;

      const memberIndex = i + 1; // 0 is first member
      const centerOffset = (totalCount - 1) / 2;
      let candidateX = firstPos.x + (memberIndex - centerOffset) * TREE_COL_W;

      // Collision avoidance
      const occupied = occupiedByY.get(firstPos.y) ?? [];
      let maxAttempts = 20;
      while (
        maxAttempts > 0 &&
        occupied.some(
          (ox) => Math.abs(ox - candidateX) < TREE_NODE_W + TREE_H_SPACING / 2,
        )
      ) {
        candidateX += TREE_COL_W;
        maxAttempts--;
      }

      posMap.set(sibling._id as string, { x: candidateX, y: firstPos.y });
      const yList = occupiedByY.get(firstPos.y) ?? [];
      yList.push(candidateX);
      occupiedByY.set(firstPos.y, yList);
    }
  }
}
