import { Id } from "../_generated/dataModel";
import { ModeratorConfig, ParticipantConfig } from "./actions_helpers";

export interface RunCycleArgs extends Record<string, unknown> {
  sessionId: Id<"autonomousSessions">;
  cycle: number;
  startParticipantIndex?: number;
  userId: string;
  participantConfigs: Array<{
    participantId: string;
    modelId: string;
    personaId?: Id<"personas"> | null;
    displayName: string;
    systemPrompt?: string | null;
    temperature?: number;
    maxTokens?: number;
    includeReasoning?: boolean;
    reasoningEffort?: string | null;
  }>;
  moderatorConfig?: {
    modelId: string;
    personaId?: Id<"personas"> | null;
    displayName: string;
  };
  webSearchEnabled: boolean;
}

export interface NormalizedRunCycleArgs extends Record<string, unknown> {
  participants: ParticipantConfig[];
  moderator?: ModeratorConfig;
}

export interface ModelCapabilities {
  provider?: string;
  supportedParameters?: string[];
  hasVideoInput?: boolean;
  hasImageGeneration?: boolean;
  hasReasoning?: boolean;
  contextLength?: number;
}

export type TurnOutcome =
  | { kind: "completed"; messageId: Id<"messages"> }
  | { kind: "skipped" }
  | { kind: "cancelled" }
  | { kind: "failed"; reason: string };
