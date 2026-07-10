import type { Id } from "@convex/_generated/dataModel";

export interface AdvisorSelection {
  personaId: Id<"personas">;
  keepAvailable: boolean;
  allowWebSearch: boolean;
}

export interface QueuedAdvisorSnapshot {
  advisorSelections: AdvisorSelection[];
  advisorBrief?: string;
}

export interface ChatAdvisorView {
  _id: Id<"chatAdvisors">;
  personaId: Id<"personas">;
  instanceName: string;
  sortOrder: number;
  allowWebSearch: boolean;
  displayName: string;
  avatarEmoji?: string;
  avatarImageUrl?: string;
  avatarSFSymbol?: string;
  avatarColor?: string;
  createdAt: number;
  updatedAt: number;
  isAvailable: boolean;
  unavailableReasonCode?: "participant_conflict" | "model_unavailable" | "media_output_model";
}

export type AdvisorEligibilityReason =
  | "not_pro"
  | "zdr_enabled"
  | "google_protected"
  | "media_output_turn"
  | "participant_conflict"
  | "unsupported_turn"
  | "no_capacity";

export interface AdvisorEligibility {
  isAvailable: boolean;
  reasonCode?: AdvisorEligibilityReason;
  maxAdvisors: number;
  keptCount: number;
  remainingCapacity: number;
  conflictingPersonaIds?: string[];
}

export interface ChatAdvisorsResult {
  advisors: ChatAdvisorView[];
  eligibility: AdvisorEligibility;
}

export type AdvisorBatchStatus =
  | "queued"
  | "running"
  | "synthesizing"
  | "completed"
  | "failed"
  | "cancelled";

export type AdvisorRunStatus =
  | "queued"
  | "preparing_context"
  | "consulting"
  | "streaming"
  | "completed"
  | "failed"
  | "timedOut"
  | "cancelled";

export interface AdvisorRunView {
  _id: Id<"advisorRuns">;
  personaId: Id<"personas">;
  personaSnapshot: {
    displayName: string;
    avatarEmoji?: string;
    avatarImageUrl?: string;
    avatarSFSymbol?: string;
    avatarColor?: string;
  };
  instanceName: string;
  sortOrder: number;
  status: AdvisorRunStatus;
  stage: string;
  allowWebSearch: boolean;
  requestedModelId: string;
  actualModelId?: string;
  partialAdvice?: string;
  advice?: string;
  errorCode?: string;
  errorMessage?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost?: number;
    isByok?: boolean;
    upstreamInferenceCost?: number;
  };
  cost?: number;
  durationMs?: number;
  startedAt?: number;
  lastActivityAt?: number;
  completedAt?: number;
}

export interface AdvisorBatchView {
  _id: Id<"advisorBatches">;
  chatId: Id<"chats">;
  userMessageId: Id<"messages">;
  assistantMessageIds: Id<"messages">[];
  status: AdvisorBatchStatus;
  brief?: string;
  expectedRunCount: number;
  completedRunCount: number;
  failedRunCount: number;
  createdAt: number;
  updatedAt: number;
  runs: AdvisorRunView[];
}
