import { Id } from "../_generated/dataModel";

export interface ResolvedParticipant {
  modelId: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  personaId?: Id<"personas">;
  personaName?: string;
  personaEmoji?: string;
  personaAvatarImageUrl?: string;
  includeReasoning?: boolean;
  reasoningEffort?: string;
}
