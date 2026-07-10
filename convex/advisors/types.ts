import type { Doc, Id } from "../_generated/dataModel";
import type { RunGenerationArgs } from "../chat/actions_run_generation_types";
import type { WebSearchActionArgs } from "../search/actions_web_search_shared";
import type { PipelineArgs } from "../search/workflow_shared";

export type AdvisorSelectionInput = {
  personaId: Id<"personas">;
  keepAvailable: boolean;
  allowWebSearch: boolean;
};

export type AdvisorPersonaSnapshot = Doc<"advisorRuns">["personaSnapshot"];

export type DeferredGenerationSnapshot =
  | {
      kind: "generation";
      args: RunGenerationArgs;
    }
  | {
      kind: "advanced_search";
      requests: WebSearchActionArgs[];
    }
  | {
      kind: "research_paper";
      request: PipelineArgs;
    };

export type AdvisorEligibilityReason =
  | "not_pro"
  | "zdr_enabled"
  | "google_protected"
  | "media_output_turn"
  | "participant_conflict"
  | "unsupported_turn"
  | "no_capacity";

export type AdvisorPersonaUnavailableReason =
  | "participant_conflict"
  | "model_unavailable"
  | "media_output_model";

export type AdvisorBatchView = {
  _id: Id<"advisorBatches">;
  chatId: Id<"chats">;
  userMessageId: Id<"messages">;
  assistantMessageIds: Id<"messages">[];
  status: Doc<"advisorBatches">["status"];
  brief?: string;
  expectedRunCount: number;
  completedRunCount: number;
  failedRunCount: number;
  createdAt: number;
  updatedAt: number;
  runs: AdvisorRunView[];
};

export type AdvisorRunView = {
  _id: Id<"advisorRuns">;
  personaId: Id<"personas">;
  personaSnapshot: Omit<AdvisorPersonaSnapshot, "modelId" | "temperature" | "maxTokens" | "includeReasoning" | "reasoningEffort">;
  instanceName: string;
  sortOrder: number;
  status: Doc<"advisorRuns">["status"];
  stage: Doc<"advisorRuns">["stage"];
  allowWebSearch: boolean;
  requestedModelId: string;
  actualModelId?: string;
  partialAdvice?: string;
  advice?: string;
  errorCode?: string;
  errorMessage?: string;
  usage?: Doc<"advisorRuns">["usage"];
  cost?: number;
  durationMs?: number;
  startedAt?: number;
  lastActivityAt?: number;
  completedAt?: number;
};
