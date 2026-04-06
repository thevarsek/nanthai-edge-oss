// hooks/useAutonomous.ts — Manages autonomous group chat session lifecycle + reactive state.
// Mirrors iOS ChatViewModel+Autonomous and ChatViewModel+AutonomousSession.

import { useCallback, useEffect, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { Participant } from "@/hooks/useChat";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AutonomousSettings {
  maxCycles: number;        // 1-20, default 5
  pauseBetweenTurns: number; // 0.5-5.0s, default 1.0
  autoStopOnConsensus: boolean;
  moderatorParticipantId: string | null;
}

export const DEFAULT_AUTONOMOUS_SETTINGS: AutonomousSettings = {
  maxCycles: 5,
  pauseBetweenTurns: 1.0,
  autoStopOnConsensus: false,
  moderatorParticipantId: null,
};

export type AutonomousState =
  | { status: "inactive" }
  | { status: "configuring" }
  | { status: "active"; cycle: number; maxCycles: number; currentParticipant: string }
  | { status: "paused"; cycle: number; maxCycles: number }
  | { status: "ended"; reason: string };

export type CostWarningLevel = "low" | "medium" | "high";

// ─── Cost estimation ────────────────────────────────────────────────────────

const COST_PER_TURN = 0.003;

export function estimateAutonomousCost(
  settings: AutonomousSettings,
  participantCount: number,
): { cost: number; warning: CostWarningLevel } {
  const active = settings.moderatorParticipantId
    ? Math.max(participantCount - 1, 1)
    : participantCount;
  const totalTurns = settings.maxCycles * active;
  const cost = totalTurns * COST_PER_TURN;
  const warning: CostWarningLevel = cost > 0.50 ? "high" : cost > 0.15 ? "medium" : "low";
  return { cost, warning };
}

// ─── Session type from Convex ───────────────────────────────────────────────
interface ConvexSession {
  _id: Id<"autonomousSessions">;
  status: string;
  currentCycle: number;
  maxCycles: number;
  currentParticipantIndex?: number;
  turnOrder: string[];
  moderatorParticipantId?: string;
  stopReason?: string;
  error?: string;
}
interface ActiveSessionSummary {
  _id: Id<"autonomousSessions">;
  status: string;
  currentCycle: number;
  maxCycles: number;
  currentParticipantIndex?: number;
  createdAt: number;
}

// ─── Hook ───────────────────────────────────────────────────────────────────
interface UseAutonomousArgs {
  chatId: Id<"chats"> | undefined;
  participants: Participant[];
  hasMessages: boolean;
  isPro: boolean;
}

export interface UseAutonomousReturn {
  state: AutonomousState;
  settings: AutonomousSettings;
  setSettings: (s: AutonomousSettings) => void;
  showSettings: () => void;
  start: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  stop: () => Promise<void>;
  intervene: (text: string) => Promise<void>;
  dismissEnded: () => void;
  canConfigure: boolean;
}

export function useAutonomous({
  chatId, participants, hasMessages, isPro,
}: UseAutonomousArgs): UseAutonomousReturn {
  const [settings, setSettings] = useState<AutonomousSettings>(DEFAULT_AUTONOMOUS_SETTINGS);
  const [state, setState] = useState<AutonomousState>({ status: "inactive" });
  const [sessionId, setSessionId] = useState<Id<"autonomousSessions"> | null>(null);

  // ── Subscriptions ──────────────────────────────────────────────────────────
  const activeSessions = useQuery(
    api.autonomous.queries.listActiveSessions,
    chatId ? { chatId } : "skip",
  ) as ActiveSessionSummary[] | undefined;

  const session = useQuery(
    api.autonomous.queries.watchSession,
    sessionId ? { sessionId } : "skip",
  ) as ConvexSession | null | undefined;

  // ── Mutations ──────────────────────────────────────────────────────────────
  const startMut = useMutation(api.autonomous.mutations.startSession);
  const pauseMut = useMutation(api.autonomous.mutations.pauseSession);
  const resumeMut = useMutation(api.autonomous.mutations.resumeSession);
  const stopMut = useMutation(api.autonomous.mutations.stopSession);
  const interventionMut = useMutation(api.autonomous.mutations.handleUserIntervention);

  // ── Reattach to existing active session ────────────────────────────────────
  useEffect(() => {
    if (sessionId) return; // already tracking
    if (!activeSessions?.length) return;
    const active = activeSessions
      .filter((s) => s.status === "running" || s.status === "paused")
      .sort((a, b) => b.createdAt - a.createdAt);
    if (active[0]) {
      const timer = window.setTimeout(() => setSessionId(active[0]._id), 0);
      return () => window.clearTimeout(timer);
    }
  }, [activeSessions, sessionId]);

  // ── Map session state to UI state ──────────────────────────────────────────
  useEffect(() => {
    if (!session) return;
    const resolveParticipantName = (idx?: number): string => {
      if (idx == null || idx < 0 || idx >= session.turnOrder.length) return "...";
      const pid = session.turnOrder[idx];
      const p = participants.find((pp) =>
        (pp as Participant & { participantId?: string }).participantId === pid
        || pp.modelId === pid
        || pp.personaName === pid,
      );
      return p?.personaName ?? p?.modelId.split("/").pop() ?? `Participant ${idx + 1}`;
    };

    switch (session.status) {
      case "running":
        window.setTimeout(() => {
          setState({
            status: "active",
            cycle: session.currentCycle,
            maxCycles: session.maxCycles,
            currentParticipant: resolveParticipantName(session.currentParticipantIndex),
          });
        }, 0);
        break;
      case "paused":
        window.setTimeout(() => {
          setState({ status: "paused", cycle: session.currentCycle, maxCycles: session.maxCycles });
        }, 0);
        break;
      case "stopped": case "stopped_user_intervened":
        window.setTimeout(() => {
          setState({ status: "ended", reason: session.stopReason ?? "Stopped" });
          setSessionId(null);
        }, 0);
        break;
      case "completed_max_cycles":
        window.setTimeout(() => {
          setState({ status: "ended", reason: "Completed all cycles" });
          setSessionId(null);
        }, 0);
        break;
      case "completed_consensus":
        window.setTimeout(() => {
          setState({ status: "ended", reason: "Consensus reached" });
          setSessionId(null);
        }, 0);
        break;
      case "failed":
        window.setTimeout(() => {
          setState({ status: "ended", reason: session.error ?? session.stopReason ?? "Failed" });
          setSessionId(null);
        }, 0);
        break;
    }
  }, [session, participants]);

  // ── Can configure? ─────────────────────────────────────────────────────────
  const canConfigure = isPro && participants.length >= 2 && hasMessages;

  // ── Actions ────────────────────────────────────────────────────────────────
  const showSettings = useCallback(() => {
    if (!canConfigure) return;
    setState({ status: "configuring" });
  }, [canConfigure]);

  const start = useCallback(async () => {
    if (!chatId || !canConfigure) return;
    const turnOrder = participants
      .map((_, i) => String(i))
      .filter((id) => id !== settings.moderatorParticipantId);
    if (turnOrder.length < 2) return;

    const participantConfigs = turnOrder.map((id) => {
      const idx = parseInt(id, 10);
      const p = participants[idx];
      return {
        participantId: id,
        modelId: p.modelId,
        displayName: p.personaName ?? p.modelId.split("/").pop() ?? p.modelId,
        ...(p.personaId ? { personaId: p.personaId } : {}),
        ...(p.systemPrompt ? { systemPrompt: p.systemPrompt } : {}),
        ...(p.temperature != null ? { temperature: p.temperature } : {}),
        ...(p.maxTokens != null ? { maxTokens: p.maxTokens } : {}),
        ...(p.includeReasoning != null ? { includeReasoning: p.includeReasoning } : {}),
        ...(p.reasoningEffort ? { reasoningEffort: p.reasoningEffort } : {}),
      };
    });

    let moderatorConfig;
    if (settings.moderatorParticipantId) {
      const idx = parseInt(settings.moderatorParticipantId, 10);
      const p = participants[idx];
      if (p) {
        moderatorConfig = {
          modelId: p.modelId,
          displayName: p.personaName ?? p.modelId.split("/").pop() ?? p.modelId,
          ...(p.personaId ? { personaId: p.personaId } : {}),
        };
      }
    }

    setState({ status: "active", cycle: 0, maxCycles: settings.maxCycles, currentParticipant: "Starting..." });

    try {
      const newSessionId = await startMut({
        chatId,
        turnOrder,
        maxCycles: settings.maxCycles,
        pauseBetweenTurns: settings.pauseBetweenTurns,
        autoStopOnConsensus: settings.autoStopOnConsensus,
        participantConfigs: participantConfigs as Parameters<typeof startMut>[0]["participantConfigs"],
        ...(settings.moderatorParticipantId ? { moderatorParticipantId: settings.moderatorParticipantId } : {}),
        ...(moderatorConfig ? { moderatorConfig } : {}),
      });
      setSessionId(newSessionId as Id<"autonomousSessions">);
    } catch (err) {
      setState({ status: "ended", reason: `Failed to start: ${err instanceof Error ? err.message : String(err)}` });
    }
  }, [chatId, canConfigure, participants, settings, startMut]);

  const pause = useCallback(async () => {
    if (!sessionId) return;
    try { await pauseMut({ sessionId }); }
    catch (err) { console.error("Failed to pause:", err); }
  }, [sessionId, pauseMut]);

  const resume = useCallback(async () => {
    if (!sessionId) return;
    const turnOrder = session?.turnOrder ?? [];
    const participantConfigs = turnOrder.map((id) => {
      const idx = parseInt(id, 10);
      const p = participants[idx];
      return {
        participantId: id,
        modelId: p?.modelId ?? "unknown",
        displayName: p?.personaName ?? p?.modelId.split("/").pop() ?? "Unknown",
        ...(p?.personaId ? { personaId: p.personaId } : {}),
        ...(p?.temperature != null ? { temperature: p.temperature } : {}),
        ...(p?.maxTokens != null ? { maxTokens: p.maxTokens } : {}),
        ...(p?.includeReasoning != null ? { includeReasoning: p.includeReasoning } : {}),
        ...(p?.reasoningEffort ? { reasoningEffort: p.reasoningEffort } : {}),
      };
    });
    try {
      await resumeMut({
        sessionId,
        participantConfigs: participantConfigs as Parameters<typeof resumeMut>[0]["participantConfigs"],
      });
    } catch (err) { console.error("Failed to resume:", err); }
  }, [sessionId, session?.turnOrder, participants, resumeMut]);

  const stop = useCallback(async () => {
    if (!sessionId) return;
    try {
      await stopMut({ sessionId });
      setState({ status: "ended", reason: "Stopped by user" });
      setSessionId(null);
    } catch (err) { console.error("Failed to stop:", err); }
  }, [sessionId, stopMut]);

  const intervene = useCallback(async (text: string) => {
    if (!sessionId) return;
    try {
      await interventionMut({ sessionId, forceSendNow: true });
      const detail = text.trim();
      setState({ status: "ended", reason: detail ? `User intervened: ${detail}` : "User intervened" });
      setSessionId(null);
    } catch (err) { console.error("Failed to intervene:", err); }
  }, [sessionId, interventionMut]);

  const dismissEnded = useCallback(() => {
    setState({ status: "inactive" });
    setSettings(DEFAULT_AUTONOMOUS_SETTINGS);
    setSessionId(null);
  }, []);

  return {
    state, settings, setSettings,
    showSettings, start, pause, resume, stop, intervene, dismissEnded, canConfigure,
  };
}
