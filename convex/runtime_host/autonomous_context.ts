import { buildAutonomousTranscriptMessages } from "../autonomous/actions_run_cycle_transcript";
import { recordMessageSource } from "../chat/message_provenance";
import type { PreparedParticipantTurn } from "../chat/prepared_participant_turn";

/** Match the cloud discussion handoff, retaining the canonical user source ID. */
export function autonomousRuntimeContext(
  prepared: PreparedParticipantTurn, sourceMessageId: string, participantName: string,
): PreparedParticipantTurn {
  const providerMessages = buildAutonomousTranscriptMessages(prepared.providerMessages, participantName);
  const prompt = providerMessages.at(-1);
  if (prompt) recordMessageSource(prompt, sourceMessageId, null);
  return { ...prepared, providerMessages };
}
