import type { Id } from "../_generated/dataModel";
import type {
  CollaborationParticipantSnapshot,
  CollaborationSelection,
} from "./validators";

export interface SchedulerMessage {
  id: Id<"messages">;
  role: "user" | "assistant" | "system";
  participantId?: Id<"chatParticipants">;
  speaker: string;
  content: string;
}

export interface SchedulerPolicyInput {
  wave: number;
  frontierMessageIds: Id<"messages">[];
  participants: Array<CollaborationParticipantSnapshot & { roleSummary?: string }>;
  mentionedParticipantIds: Id<"chatParticipants">[];
  failedParticipantIds: Id<"chatParticipants">[];
  previousSpeakerIds: Id<"chatParticipants">[];
  recentMessages: SchedulerMessage[];
  remainingMessageBudget: number;
  deadlineReached: boolean;
}

export interface SchedulerDecision {
  selections: CollaborationSelection[];
  excludedParticipantIds: Id<"chatParticipants">[];
  diagnosticCategory: string;
}

function uniqueIds<T extends string>(ids: T[]): T[] {
  return [...new Set(ids)];
}

export function humanOpenedFloor(input: SchedulerPolicyInput): boolean {
  const frontier = new Set(input.frontierMessageIds.map(String));
  return input.recentMessages.some((message) =>
    message.role === "user" && frontier.has(String(message.id))
  );
}

export function deterministicSchedulerDecision(
  input: SchedulerPolicyInput,
): SchedulerDecision | null {
  const failed = new Set(input.failedParticipantIds.map(String));
  const eligible = input.participants.filter((participant) =>
    !failed.has(String(participant.participantId))
  );
  if (input.deadlineReached || input.remainingMessageBudget <= 0) {
    return {
      selections: [],
      excludedParticipantIds: input.participants.map((participant) =>
        participant.participantId
      ),
      diagnosticCategory: "bound_reached",
    };
  }
  if (eligible.length === 0) {
    return {
      selections: [],
      excludedParticipantIds: input.participants.map((participant) =>
        participant.participantId
      ),
      diagnosticCategory: "no_eligible_participant",
    };
  }
  if (input.mentionedParticipantIds.length > 0) {
    const mentioned = new Set(input.mentionedParticipantIds.map(String));
    const selected = eligible
      .filter((participant) => mentioned.has(String(participant.participantId)))
      .slice(0, input.remainingMessageBudget);
    return {
      selections: selected.map((participant) => ({
        participantId: participant.participantId,
        replyToMessageIds: input.frontierMessageIds,
        reasonCode: "direct_mention",
      })),
      excludedParticipantIds: input.participants
        .filter((participant) => !selected.some((candidate) =>
          candidate.participantId === participant.participantId
        ))
        .map((participant) => participant.participantId),
      diagnosticCategory: selected.length > 0
        ? "direct_mention"
        : "mentioned_participant_unavailable",
    };
  }
  return null;
}

interface RawSchedulerSelection {
  participantId?: unknown;
  replyToMessageIds?: unknown;
  reasonCode?: unknown;
}

function parseJsonObject(content: string): Record<string, unknown> {
  const trimmed = content.trim();
  const unfenced = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
    : trimmed;
  const parsed: unknown = JSON.parse(unfenced);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("COLLABORATION_SCHEDULER_INVALID_RESPONSE");
  }
  return parsed as Record<string, unknown>;
}

export function parseSchedulerDecision(
  content: string,
  input: SchedulerPolicyInput,
): SchedulerDecision {
  const parsed = parseJsonObject(content);
  if (!Array.isArray(parsed.selections)) {
    throw new Error("COLLABORATION_SCHEDULER_INVALID_SELECTIONS");
  }
  const available = new Map(input.participants.map((participant) => [
    String(participant.participantId),
    participant.participantId,
  ]));
  const failed = new Set(input.failedParticipantIds.map(String));
  const frontier = new Map(input.frontierMessageIds.map((id) => [String(id), id]));
  const recentMessages = new Map(input.recentMessages.map((message) => [
    String(message.id),
    message,
  ]));
  const previousSpeakers = new Set(input.previousSpeakerIds.map(String));
  const seen = new Set<string>();
  const selections: CollaborationSelection[] = [];
  let suppressedSelfContinuation = false;
  for (const raw of parsed.selections as RawSchedulerSelection[]) {
    if (!raw || typeof raw !== "object") {
      throw new Error("COLLABORATION_SCHEDULER_INVALID_SELECTION");
    }
    const participantKey = typeof raw.participantId === "string"
      ? raw.participantId
      : "";
    const participantId = available.get(participantKey);
    if (!participantId || failed.has(participantKey) || seen.has(participantKey)) {
      throw new Error("COLLABORATION_SCHEDULER_INELIGIBLE_SELECTION");
    }
    const rawReplies = Array.isArray(raw.replyToMessageIds)
      ? raw.replyToMessageIds.filter((id): id is string => typeof id === "string")
      : [];
    const replyToMessageIds = uniqueIds(rawReplies)
      .map((id) => frontier.get(id))
      .filter((id): id is Id<"messages"> => id !== undefined);
    if (replyToMessageIds.length !== uniqueIds(rawReplies).length) {
      throw new Error("COLLABORATION_SCHEDULER_INVALID_REPLY_TARGET");
    }
    const effectiveReplyToMessageIds = replyToMessageIds.length > 0
      ? replyToMessageIds
      : input.frontierMessageIds;
    const replyTargets = effectiveReplyToMessageIds
      .map((messageId) => recentMessages.get(String(messageId)))
      .filter((message): message is SchedulerMessage => message !== undefined);
    const onlyRepliesToOwnPreviousMessages =
      previousSpeakers.has(participantKey) &&
      replyTargets.length === effectiveReplyToMessageIds.length &&
      replyTargets.length > 0 &&
      replyTargets.every((message) =>
        String(message.participantId ?? "") === participantKey
      );
    if (onlyRepliesToOwnPreviousMessages) {
      suppressedSelfContinuation = true;
      continue;
    }
    seen.add(participantKey);
    selections.push({
      participantId,
      replyToMessageIds: effectiveReplyToMessageIds,
      reasonCode: typeof raw.reasonCode === "string"
        ? raw.reasonCode.slice(0, 80)
        : "substantive_contribution",
    });
  }
  if (selections.length > input.remainingMessageBudget) {
    throw new Error("COLLABORATION_SCHEDULER_MESSAGE_BOUND_EXCEEDED");
  }
  if (selections.length === 0 && humanOpenedFloor(input)) {
    throw new Error("COLLABORATION_SCHEDULER_HUMAN_FLOOR_UNANSWERED");
  }
  const diagnosticCategory = suppressedSelfContinuation && selections.length === 0
    ? "repetitive_self_continuation_suppressed"
    : typeof parsed.diagnosticCategory === "string"
      ? parsed.diagnosticCategory.slice(0, 120)
      : selections.length > 0
        ? "substantive_contribution"
        : "nothing_substantive";
  return {
    selections,
    excludedParticipantIds: input.participants
      .filter((participant) => !seen.has(String(participant.participantId)))
      .map((participant) => participant.participantId),
    diagnosticCategory,
  };
}

export function parseSchedulerDecisionOrSilence(
  content: string,
  input: SchedulerPolicyInput,
  finishReason: string | null,
): SchedulerDecision {
  try {
    return parseSchedulerDecision(content, input);
  } catch {
    return {
      selections: [],
      excludedParticipantIds: input.participants.map((participant) =>
        participant.participantId
      ),
      diagnosticCategory: finishReason === "length"
        ? "scheduler_output_truncated"
        : "scheduler_invalid_response",
    };
  }
}

export function buildSchedulerPrompt(input: SchedulerPolicyInput): string {
  const requiresReply = humanOpenedFloor(input);
  const participants = input.participants.map((participant) => ({
    participantId: String(participant.participantId),
    name: participant.displayName,
    modelId: participant.modelId,
    roleSummary: participant.roleSummary ?? null,
    hasAssignedRole: Boolean(participant.roleSummary?.trim()),
    spokeInPreviousWave: input.previousSpeakerIds.includes(participant.participantId),
    unavailable: input.failedParticipantIds.includes(participant.participantId),
  }));
  const messages = input.recentMessages.map((message) => ({
    messageId: String(message.id),
    role: message.role,
    participantId: message.participantId
      ? String(message.participantId)
      : undefined,
    speaker: message.speaker,
    content: message.content,
    onFrontier: input.frontierMessageIds.includes(message.id),
  }));
  return `You are NanthAI's quiet-by-default floor scheduler. Choose only public chat participants who have a substantive reason to speak next.

Silence is the normal successful result after the human has received an adequate answer. Before selecting anyone, compare the proposed contribution with every committed message. More reassurance, examples, advice, caveats, elaboration, rephrasing, or a second independent answer to the same human request are not materially new. A different model or provider is not a distinct role. Participants with no assigned roleSummary are generalists; never invent a specialty for them.

After wave 1, select a participant only to correct a concrete consequential error, answer an explicit request or handoff, perform the next owned task, or review materially changed work that needs its assigned role. The reasonCode must name that unresolved gap or handoff. If you cannot identify one, return no selections. Never select a previous-wave speaker merely to reply to that participant's own frontier message. A previous-wave speaker stays quiet unless directly addressed by the human, handed new work by another participant, or reacting to materially changed output.

${requiresReply
    ? "A human message is on the current causal frontier. The human has explicitly opened the floor, so select at least one available participant to respond. Choose the participant or participants best suited to that message; do not return silence."
    : "No unanswered human message is on the current causal frontier. Return no selections when no participant has a materially useful reason to continue."}

Examples: after one participant has already answered a casual wellbeing message with basic self-care and urgent warning signs, stop; do not summon others for relaxation tips, more warning signs, or reassurance. For a feature task, Architect and UI may advise, Implementer may act on their committed plans, and a reviewer re-enters only for a concrete issue in changed work.

Participants:
${JSON.stringify(participants)}

Committed discussion (the entries marked onFrontier are the exact causal frontier):
${JSON.stringify(messages)}

Return JSON only:
{"selections":[{"participantId":"exact id","replyToMessageIds":["frontier message id"],"reasonCode":"short stable code"}],"diagnosticCategory":"short category"}

${requiresReply ? "You must return at least one selection." : "You may return an empty selections array."} Select at most ${input.remainingMessageBudget} participant(s). Every reply target must be one of: ${input.frontierMessageIds.map(String).join(", ")}.`;
}
