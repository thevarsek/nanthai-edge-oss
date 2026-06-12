import { Id } from "../_generated/dataModel";
import { OpenRouterMessage, OpenRouterUsage } from "../lib/openrouter";
import { RecordedToolCall, RecordedToolResult } from "../tools/execute_loop";
import type { SkillToolProfileId } from "../skills/tool_profiles";
import type { LoadedSkillState } from "../tools/progressive_registry_shared";
import type { AnalyticsClientMetadata } from "../analytics/client_metadata";
import type {
  GenerationAnalyticsSource,
  ParticipantConfig,
  VideoConfig,
} from "./actions_run_generation_types";

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
  requireZdrOverride?: boolean;
  effectiveIntegrations: string[];
  directToolNames?: string[];
  isPro: boolean;
  allowSubagents: boolean;
  disableTools?: boolean;
  searchSessionId?: Id<"searchSessions">;
  subagentBatchId?: Id<"subagentBatches">;
  drivePickerBatchId?: Id<"drivePickerBatches">;
  resumeExpected?: boolean;
  // M29 — Video generation config
  videoConfig?: VideoConfig;
  // Pre-resolved overrides from coordinator (eliminates duplicate queries)
  chatSkillOverrides?: Array<{ skillId: Id<"skills">; state: "always" | "available" | "never" }>;
  chatIntegrationOverrides?: Array<{ integrationId: string; enabled: boolean }>;
  personaSkillOverrides?: Array<{ skillId: Id<"skills">; state: "always" | "available" | "never" }>;
  skillDefaults?: Array<{ skillId: Id<"skills">; state: "always" | "available" | "never" }>;
  integrationDefaults?: Array<{ integrationId: string; enabled: boolean }>;
  // Phase 1 TTFT instrumentation: scheduler hop #2 measurement (refreshed on each continuation)
  enqueuedAt?: number;
  analytics?: AnalyticsClientMetadata;
  analyticsSource?: GenerationAnalyticsSource;
}

export interface GenerationContinuationGroupSnapshot {
  assistantMessageIds: Id<"messages">[];
  generationJobIds: Id<"generationJobs">[];
  userMessageId: Id<"messages">;
  userId: string;
  expandMultiModelGroups: boolean;
  webSearchEnabled: boolean;
  requireZdrOverride?: boolean;
  effectiveIntegrations: string[];
  directToolNames: string[];
  isPro: boolean;
  allowSubagents: boolean;
  disableTools?: boolean;
  searchSessionId?: Id<"searchSessions">;
  subagentBatchId?: Id<"subagentBatches">;
  drivePickerBatchId?: Id<"drivePickerBatches">;
  // Pre-resolved overrides preserved across continuations
  chatSkillOverrides?: Array<{ skillId: Id<"skills">; state: "always" | "available" | "never" }>;
  chatIntegrationOverrides?: Array<{ integrationId: string; enabled: boolean }>;
  personaSkillOverrides?: Array<{ skillId: Id<"skills">; state: "always" | "available" | "never" }>;
  skillDefaults?: Array<{ skillId: Id<"skills">; state: "always" | "available" | "never" }>;
  integrationDefaults?: Array<{ integrationId: string; enabled: boolean }>;
  analytics?: AnalyticsClientMetadata;
  analyticsSource?: GenerationAnalyticsSource;
}

export interface GenerationContinuationCheckpoint {
  participant: ParticipantConfig;
  group: GenerationContinuationGroupSnapshot;
  checkpointVersion?: "v1" | "v2";
  assembledCheckpoint?: {
    policyVersion: string;
    assemblerVersion: string;
    artifactRefs: string[];
    memoryRefs: string[];
    rehydrationDirectives: Array<Record<string, unknown>>;
    activeProfiles: SkillToolProfileId[];
    loadedSkills: LoadedSkillState[];
    mode?: "read_path" | "autonomous_discussion" | "subagent_child" | "subagent_parent_resume";
    runtimeKind?: "chat_generation" | "autonomous_discussion" | "subagent_child" | "subagent_parent_resume" | "scheduled_job";
    subagentBatchId?: Id<"subagentBatches">;
    subagentRunId?: Id<"subagentRuns">;
    parentMessageId?: Id<"messages">;
    parentJobId?: Id<"generationJobs">;
    parentToolCallId?: string;
    promotionDecision?: "child_private" | "parent_resume" | "parent_visible" | "audit_only";
    decisionSummary?: string;
  };
  messages: OpenRouterMessage[];
  usage?: OpenRouterUsage;
  toolCalls: RecordedToolCall[];
  toolResults: RecordedToolResult[];
  activeProfiles: SkillToolProfileId[];
  loadedSkills: LoadedSkillState[];
  compactionCount: number;
  continuationCount: number;
  partialContent?: string;
  partialReasoning?: string;
}

export interface GenerationContinuationState {
  participant: ParticipantConfig;
  group: GenerationContinuationGroupSnapshot;
  checkpointVersion: "v1" | "v2";
  assembledCheckpoint?: GenerationContinuationCheckpoint["assembledCheckpoint"];
  messages: OpenRouterMessage[];
  usage: OpenRouterUsage | null;
  toolCalls: RecordedToolCall[];
  toolResults: RecordedToolResult[];
  activeProfiles: SkillToolProfileId[];
  loadedSkills: LoadedSkillState[];
  compactionCount: number;
  continuationCount: number;
  partialContent?: string;
  partialReasoning?: string;
}
