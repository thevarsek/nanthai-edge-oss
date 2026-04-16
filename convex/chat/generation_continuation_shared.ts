import { Id } from "../_generated/dataModel";
import { OpenRouterMessage, OpenRouterUsage } from "../lib/openrouter";
import { RecordedToolCall, RecordedToolResult } from "../tools/execute_loop";
import type { SkillToolProfileId } from "../skills/tool_profiles";
import { ParticipantConfig, VideoConfig } from "./actions_run_generation_types";

export const GENERATION_CONTINUATION_LEASE_MS = 12 * 60 * 1000;

export const TERMINAL_GENERATION_JOB_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "timedOut",
]);

export interface RunGenerationParticipantArgs extends Record<string, unknown> {
  chatId: Id<"chats">;
  userMessageId: Id<"messages">;
  assistantMessageIds: Id<"messages">[];
  generationJobIds: Id<"generationJobs">[];
  participant: ParticipantConfig;
  userId: string;
  expandMultiModelGroups: boolean;
  webSearchEnabled: boolean;
  effectiveIntegrations: string[];
  directToolNames?: string[];
  isPro: boolean;
  allowSubagents: boolean;
  searchSessionId?: Id<"searchSessions">;
  subagentBatchId?: Id<"subagentBatches">;
  resumeExpected?: boolean;
  // M29 — Video generation config
  videoConfig?: VideoConfig;
}

export interface GenerationContinuationGroupSnapshot {
  assistantMessageIds: Id<"messages">[];
  generationJobIds: Id<"generationJobs">[];
  userMessageId: Id<"messages">;
  userId: string;
  expandMultiModelGroups: boolean;
  webSearchEnabled: boolean;
  effectiveIntegrations: string[];
  directToolNames: string[];
  isPro: boolean;
  allowSubagents: boolean;
  searchSessionId?: Id<"searchSessions">;
  subagentBatchId?: Id<"subagentBatches">;
}

export interface GenerationContinuationCheckpoint {
  participant: ParticipantConfig;
  group: GenerationContinuationGroupSnapshot;
  messages: OpenRouterMessage[];
  usage?: OpenRouterUsage;
  toolCalls: RecordedToolCall[];
  toolResults: RecordedToolResult[];
  activeProfiles: SkillToolProfileId[];
  compactionCount: number;
  continuationCount: number;
  partialContent?: string;
  partialReasoning?: string;
}

export interface GenerationContinuationState {
  participant: ParticipantConfig;
  group: GenerationContinuationGroupSnapshot;
  messages: OpenRouterMessage[];
  usage: OpenRouterUsage | null;
  toolCalls: RecordedToolCall[];
  toolResults: RecordedToolResult[];
  activeProfiles: SkillToolProfileId[];
  compactionCount: number;
  continuationCount: number;
  partialContent?: string;
  partialReasoning?: string;
}
