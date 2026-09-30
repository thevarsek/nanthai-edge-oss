import type { AutonomousState } from "@/hooks/useAutonomous";
import type { Participant } from "@/hooks/useChat";
import { participantKey } from "./autonomousParticipants";

export interface AutonomousSessionSnapshot {
  status: string;
  currentCycle: number;
  maxCycles: number;
  currentParticipantIndex?: number;
  turnOrder: string[];
  stopReason?: string;
  error?: string;
}

export function projectAutonomousSession(session: AutonomousSessionSnapshot, participants: Participant[]): AutonomousState | null {
  if (session.status === "running") {
    const index = session.currentParticipantIndex;
    const id = index == null ? undefined : session.turnOrder[index];
    const participant = id == null ? undefined : participants.find((entry, idx) =>
      participantKey(entry, idx) === id || entry.modelId === id || entry.personaName === id,
    );
    return { status: "active", cycle: session.currentCycle, maxCycles: session.maxCycles,
      currentParticipant: id == null ? "..." : participant?.personaName ?? participant?.modelId.split("/").pop() ?? `Participant ${(index ?? 0) + 1}` };
  }
  if (session.status === "paused") return { status: "paused", cycle: session.currentCycle, maxCycles: session.maxCycles };
  switch (session.status) {
    case "stopped": case "stopped_user_intervened": return { status: "ended", reason: session.stopReason ?? "Stopped" };
    case "completed_max_cycles": return { status: "ended", reason: "Completed all cycles" };
    case "completed_consensus": return { status: "ended", reason: "Consensus reached" };
    case "completed_stalled": return { status: "ended", reason: "Discussion stalled without progress" };
    case "failed": return { status: "ended", reason: session.error ?? session.stopReason ?? "Failed" };
    default: return null;
  }
}
