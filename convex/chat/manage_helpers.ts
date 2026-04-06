import { Doc, Id } from "../_generated/dataModel";

export type CopiedMessageSummary = {
  messageId: Id<"messages">;
  createdAt: number;
  content: string;
};

type BranchMessage = Pick<
  Doc<"messages">,
  "_id" | "createdAt" | "parentMessageIds" | "multiModelGroupId"
>;

type CopiedMessageInsert = Omit<Doc<"messages">, "_id" | "_creationTime">;

export function normalizeCopiedStatus(
  status: Doc<"messages">["status"],
): Doc<"messages">["status"] {
  return status === "streaming" || status === "pending"
    ? "completed"
    : status;
}

export function buildCopiedMessageInsert(
  message: Doc<"messages">,
  chatId: Id<"chats">,
  parentMessageIds: Id<"messages">[],
): CopiedMessageInsert {
  return {
    chatId,
    role: message.role,
    content: message.content,
    modelId: message.modelId,
    participantId: message.participantId,
    participantName: message.participantName,
    participantEmoji: message.participantEmoji,
    participantAvatarImageUrl: message.participantAvatarImageUrl,
    autonomousParticipantId: message.autonomousParticipantId,
    parentMessageIds,
    multiModelGroupId: message.multiModelGroupId,
    isMultiModelResponse: message.isMultiModelResponse,
    status: normalizeCopiedStatus(message.status),
    reasoning: message.reasoning,
    usage: message.usage,
    imageUrls: message.imageUrls,
    audioStorageId: message.audioStorageId,
    audioTranscript: message.audioTranscript,
    audioDurationMs: message.audioDurationMs,
    audioVoice: message.audioVoice,
    audioGeneratedAt: message.audioGeneratedAt,
    attachments: message.attachments,
    createdAt: message.createdAt,
  };
}

export function deriveCopiedChatMetadata(
  copiedMessages: CopiedMessageSummary[],
  preferredLeafId?: Id<"messages">,
) {
  const fallbackLeafId = copiedMessages[copiedMessages.length - 1]?.messageId;
  const activeBranchLeafId = preferredLeafId ?? fallbackLeafId;

  const latestWithContent = copiedMessages
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .find((message) => message.content.trim().length > 0);

  return {
    messageCount: copiedMessages.length,
    activeBranchLeafId,
    lastMessageDate: latestWithContent?.createdAt,
    lastMessagePreview:
      latestWithContent?.content.trim().slice(0, 200) || undefined,
  };
}

function directParentIds(message: BranchMessage): Set<string> {
  return new Set(message.parentMessageIds.filter((parentId) => parentId !== message._id));
}

function sharesAnyDirectParent(left: BranchMessage, right: BranchMessage): boolean {
  const leftParents = directParentIds(left);
  const rightParents = directParentIds(right);
  if (leftParents.size === 0 || rightParents.size === 0) {
    return false;
  }

  for (const parentId of leftParents) {
    if (rightParents.has(parentId)) {
      return true;
    }
  }
  return false;
}

function childrenByAnyParent(messages: BranchMessage[]): Map<string, BranchMessage[]> {
  const result = new Map<string, BranchMessage[]>();

  for (const message of messages) {
    for (const parentId of directParentIds(message)) {
      const children = result.get(parentId) ?? [];
      children.push(message);
      result.set(parentId, children);
    }
  }

  for (const [parentId, children] of result.entries()) {
    const uniqueChildren = new Map(children.map((child) => [child._id as string, child]));
    result.set(
      parentId,
      [...uniqueChildren.values()].sort((left, right) => left.createdAt - right.createdAt),
    );
  }

  return result;
}

function ancestryIds(
  leafId: string,
  messagesById: Map<string, BranchMessage>,
): Set<string> {
  const ids = new Set<string>();
  const stack: string[] = [leafId];

  while (stack.length > 0) {
    const currentId = stack.pop();
    if (!currentId || ids.has(currentId)) {
      continue;
    }
    ids.add(currentId);

    const current = messagesById.get(currentId);
    if (!current) {
      continue;
    }

    for (const parentId of directParentIds(current)) {
      stack.push(parentId);
    }
  }

  return ids;
}

function latestLeafId(messages: BranchMessage[]): string | undefined {
  const childrenMap = childrenByAnyParent(messages);
  const leaves = messages.filter((message) => !childrenMap.has(message._id as string));
  return leaves[leaves.length - 1]?._id as string | undefined;
}

function dedupeBranchChildren(children: BranchMessage[]): BranchMessage[] {
  const seenMultiGroups = new Set<string>();
  const deduped: BranchMessage[] = [];

  for (const child of children) {
    const groupId = child.multiModelGroupId;
    if (!groupId) {
      deduped.push(child);
      continue;
    }
    if (seenMultiGroups.has(groupId)) {
      continue;
    }
    seenMultiGroups.add(groupId);
    deduped.push(child);
  }

  return deduped;
}

function branchFamilyIndexForChild(
  child: BranchMessage,
  family: BranchMessage[],
): number | undefined {
  const exactIndex = family.findIndex((candidate) => candidate._id === child._id);
  if (exactIndex >= 0) {
    return exactIndex;
  }
  if (!child.multiModelGroupId) {
    return undefined;
  }
  const groupIndex = family.findIndex(
    (candidate) => candidate.multiModelGroupId === child.multiModelGroupId,
  );
  return groupIndex >= 0 ? groupIndex : undefined;
}

function findPathFromAncestorToLeaf(
  sourceId: string,
  leafId: string,
  childrenMap: Map<string, BranchMessage[]>,
  leafAncestryIds: Set<string>,
): string[] | undefined {
  const visited = new Set<string>();

  function dfs(currentId: string): string[] | undefined {
    if (currentId === leafId) {
      return [currentId];
    }
    if (!visited.add(currentId)) {
      return undefined;
    }

    const children = childrenMap.get(currentId) ?? [];
    for (const child of children) {
      const childId = child._id as string;
      if (!leafAncestryIds.has(childId)) {
        continue;
      }
      const childPath = dfs(childId);
      if (childPath) {
        return [currentId, ...childPath];
      }
    }

    return undefined;
  }

  return dfs(sourceId);
}

function descendPreferredLeaf(
  startId: string,
  childrenMap: Map<string, BranchMessage[]>,
): string {
  let currentId = startId;
  const visited = new Set<string>([startId]);

  while (true) {
    const children = dedupeBranchChildren(childrenMap.get(currentId) ?? []);
    const next = children[0];
    if (!next) {
      return currentId;
    }

    const nextId = next._id as string;
    if (visited.has(nextId)) {
      return currentId;
    }
    visited.add(nextId);
    currentId = nextId;
  }
}

export function areSiblingMessages(
  current: BranchMessage,
  target: BranchMessage,
): boolean {
  if (current._id === target._id) {
    return false;
  }
  if (current.multiModelGroupId && current.multiModelGroupId === target.multiModelGroupId) {
    return false;
  }
  return sharesAnyDirectParent(current, target);
}

export function resolveSwitchedBranchLeaf(args: {
  messages: BranchMessage[];
  activeBranchLeafId?: string;
  currentSiblingMessageId: string;
  targetSiblingMessageId: string;
}): string | undefined {
  const sortedMessages = [...args.messages].sort((left, right) => left.createdAt - right.createdAt);
  if (sortedMessages.length === 0) {
    return undefined;
  }

  const messagesById = new Map(sortedMessages.map((message) => [message._id as string, message]));
  const currentSibling = messagesById.get(args.currentSiblingMessageId);
  const targetSibling = messagesById.get(args.targetSiblingMessageId);
  if (!currentSibling || !targetSibling) {
    return undefined;
  }

  const resolvedLeafId =
    (args.activeBranchLeafId && messagesById.has(args.activeBranchLeafId)
      ? args.activeBranchLeafId
      : latestLeafId(sortedMessages)) ?? currentSibling._id;
  const leafAncestryIds = ancestryIds(resolvedLeafId, messagesById);
  const childrenMap = childrenByAnyParent(sortedMessages);
  const sourcePath = leafAncestryIds.has(currentSibling._id as string)
    ? findPathFromAncestorToLeaf(
        currentSibling._id as string,
        resolvedLeafId,
        childrenMap,
        leafAncestryIds,
      )
    : undefined;

  if (!sourcePath || sourcePath.length <= 1) {
    return descendPreferredLeaf(targetSibling._id as string, childrenMap);
  }

  let currentTargetId = targetSibling._id as string;

  for (let index = 0; index < sourcePath.length - 1; index += 1) {
    const sourceNode = messagesById.get(sourcePath[index]);
    const nextSourceChild = messagesById.get(sourcePath[index + 1]);
    if (!sourceNode || !nextSourceChild) {
      break;
    }

    const sourceFamily = dedupeBranchChildren(childrenMap.get(sourceNode._id as string) ?? []);
    const targetFamily = dedupeBranchChildren(childrenMap.get(currentTargetId) ?? []);
    if (targetFamily.length === 0) {
      return currentTargetId;
    }

    const nextTarget = sourceFamily.length <= 1
      ? targetFamily[0]
      : targetFamily[branchFamilyIndexForChild(nextSourceChild, sourceFamily) ?? 0] ?? targetFamily[0];
    const nextTargetId = nextTarget?._id as string | undefined;
    if (!nextTargetId || nextTargetId === currentTargetId) {
      return currentTargetId;
    }
    currentTargetId = nextTargetId;
  }

  return descendPreferredLeaf(currentTargetId, childrenMap);
}
