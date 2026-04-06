import { Id } from "../_generated/dataModel";

export interface ParticipantConfig {
  modelId: string;
  personaId?: Id<"personas"> | null;
  personaName?: string | null;
  personaEmoji?: string | null;
  personaAvatarImageUrl?: string | null;
  systemPrompt?: string | null;
  temperature?: number;
  maxTokens?: number;
  includeReasoning?: boolean;
  reasoningEffort?: string | null;
  messageId: Id<"messages">;
  jobId: Id<"generationJobs">;
}

export interface RunGenerationArgs extends Record<string, unknown> {
  chatId: Id<"chats">;
  userMessageId: Id<"messages">;
  assistantMessageIds: Id<"messages">[];
  generationJobIds: Id<"generationJobs">[];
  participants: ParticipantConfig[];
  userId: string;
  expandMultiModelGroups: boolean;
  webSearchEnabled: boolean;
  // M10 Phase B — integration toggles (e.g. ["gmail", "drive", "calendar"])
  enabledIntegrations?: string[];
  subagentsEnabled?: boolean;
  // Optional: when called from a search path (C/D/regen), pass the session ID
  // so generation can mark the session completed/failed on finish.
  searchSessionId?: Id<"searchSessions">;
}

export interface ModelCapabilities {
  provider?: string;
  supportedParameters?: string[];
  hasAudioInput?: boolean;
  hasAudioOutput?: boolean;
  hasVideoInput?: boolean;
  hasImageGeneration?: boolean;
  hasReasoning?: boolean;
  contextLength?: number;
}
