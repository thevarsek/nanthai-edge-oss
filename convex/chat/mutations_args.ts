import { v, type PropertyValidators } from "convex/values";
import { Id } from "../_generated/dataModel";
import {
  memoryCategory,
  memoryRetrievalMode,
  memoryScopeType,
  memorySourceType,
} from "../schema_validators";
import { participantConfigValidator, videoConfigValidator } from "./actions_args";

export const attachmentValidator = v.object({
  type: v.string(),
  url: v.optional(v.string()),
  storageId: v.optional(v.id("_storage")),
  name: v.optional(v.string()),
  mimeType: v.optional(v.string()),
  sizeBytes: v.optional(v.number()),
  // M29 — Video generation: role of image when used with a video model.
  // "first_frame" / "last_frame" → frame_images (image-to-video)
  // "reference" → input_references (style guidance)
  videoRole: v.optional(
    v.union(
      v.literal("first_frame"),
      v.literal("last_frame"),
      v.literal("reference"),
    ),
  ),
});

export const recordedAudioValidator = v.object({
  storageId: v.id("_storage"),
  transcript: v.string(),
  durationMs: v.optional(v.number()),
  mimeType: v.optional(v.string()),
});

export const participantValidator = v.object({
  modelId: v.string(),
  personaId: v.optional(v.union(v.id("personas"), v.null())),
  personaName: v.optional(v.union(v.string(), v.null())),
  personaEmoji: v.optional(v.union(v.string(), v.null())),
  personaAvatarImageUrl: v.optional(v.union(v.string(), v.null())),
  systemPrompt: v.optional(v.union(v.string(), v.null())),
  temperature: v.optional(v.number()),
  maxTokens: v.optional(v.number()),
  includeReasoning: v.optional(v.boolean()),
  reasoningEffort: v.optional(v.union(v.string(), v.null())),
});

const generationParticipantValidator = participantConfigValidator;

export const createChatArgs = {
  title: v.optional(v.string()),
  mode: v.union(v.literal("chat"), v.literal("ideascape")),
  folderId: v.optional(v.string()),
  participants: v.optional(v.array(participantValidator)),
} satisfies PropertyValidators;

export const sendMessageArgs = {
  chatId: v.id("chats"),
  text: v.string(),
  recordedAudio: v.optional(recordedAudioValidator),
  attachments: v.optional(v.array(attachmentValidator)),
  participants: v.array(participantValidator),
  explicitParentIds: v.optional(v.array(v.id("messages"))),
  expandMultiModelGroups: v.optional(v.boolean()),
  webSearchEnabled: v.optional(v.boolean()),
  // M9 — Internet Search
  searchMode: v.optional(v.union(v.literal("normal"), v.literal("web"))),
  complexity: v.optional(v.number()),
  // M10 Phase B — integration toggles (e.g. ["gmail", "drive", "calendar"])
  enabledIntegrations: v.optional(v.array(v.string())),
  subagentsEnabled: v.optional(v.boolean()),
  // M29 — Video generation config
  videoConfig: v.optional(videoConfigValidator),
} satisfies PropertyValidators;

export const cancelGenerationArgs = {
  jobId: v.id("generationJobs"),
} satisfies PropertyValidators;

export const cancelActiveGenerationArgs = {
  chatId: v.id("chats"),
} satisfies PropertyValidators;

export const retryMessageArgs = {
  messageId: v.id("messages"),
  participants: v.optional(v.array(participantValidator)),
  expandMultiModelGroups: v.optional(v.boolean()),
  webSearchEnabled: v.optional(v.boolean()),
  // M9 — Internet Search
  searchMode: v.optional(v.union(v.literal("normal"), v.literal("web"))),
  complexity: v.optional(v.number()),
  // M10 Phase B — integration toggles
  enabledIntegrations: v.optional(v.array(v.string())),
  subagentsEnabled: v.optional(v.boolean()),
  // M29 — Video generation config
  videoConfig: v.optional(videoConfigValidator),
} satisfies PropertyValidators;

export const updateMessageContentArgs = {
  messageId: v.id("messages"),
  content: v.string(),
  status: v.union(
    v.literal("pending"),
    v.literal("streaming"),
    v.literal("completed"),
    v.literal("failed"),
    v.literal("cancelled"),
  ),
} satisfies PropertyValidators;

export const updateMessageReasoningArgs = {
  messageId: v.id("messages"),
  reasoning: v.string(),
} satisfies PropertyValidators;

export const markChatCompletionNotifiedArgs = {
  messageId: v.id("messages"),
} satisfies PropertyValidators;

export const markPostProcessScheduledArgs = {
  messageId: v.id("messages"),
} satisfies PropertyValidators;

export const finalizeGenerationArgs = {
  messageId: v.id("messages"),
  jobId: v.id("generationJobs"),
  chatId: v.id("chats"),
  content: v.string(),
  status: v.union(
    v.literal("completed"),
    v.literal("failed"),
    v.literal("cancelled"),
  ),
  error: v.optional(v.string()),
  usage: v.optional(
    v.object({
      promptTokens: v.number(),
      completionTokens: v.number(),
      totalTokens: v.number(),
      cost: v.optional(v.number()),
      isByok: v.optional(v.boolean()),
      cachedTokens: v.optional(v.number()),
      cacheWriteTokens: v.optional(v.number()),
      audioPromptTokens: v.optional(v.number()),
      videoTokens: v.optional(v.number()),
      reasoningTokens: v.optional(v.number()),
      imageCompletionTokens: v.optional(v.number()),
      audioCompletionTokens: v.optional(v.number()),
      upstreamInferenceCost: v.optional(v.number()),
      upstreamInferencePromptCost: v.optional(v.number()),
      upstreamInferenceCompletionsCost: v.optional(v.number()),
      webSearchRequests: v.optional(v.number()),
    }),
  ),
  reasoning: v.optional(v.string()),
  imageUrls: v.optional(v.array(v.string())),
  videoUrls: v.optional(v.array(v.string())),
  userId: v.string(),
  // M10 — Tool execution metadata
  toolCalls: v.optional(v.array(v.object({
    id: v.string(),
    name: v.string(),
    arguments: v.string(),
  }))),
  toolResults: v.optional(v.array(v.object({
    toolCallId: v.string(),
    toolName: v.string(),
    result: v.string(),
    isError: v.optional(v.boolean()),
  }))),
  generatedFileIds: v.optional(v.array(v.id("generatedFiles"))),
  generatedChartIds: v.optional(v.array(v.id("generatedCharts"))),
  generatedFiles: v.optional(v.array(v.object({
    storageId: v.id("_storage"),
    filename: v.string(),
    mimeType: v.string(),
    sizeBytes: v.optional(v.number()),
    toolName: v.string(),
  }))),
  generatedCharts: v.optional(v.array(v.object({
    toolName: v.string(),
    chartType: v.union(
      v.literal("line"),
      v.literal("bar"),
      v.literal("scatter"),
      v.literal("pie"),
      v.literal("box"),
      v.literal("png_image"),
    ),
    title: v.optional(v.string()),
    xLabel: v.optional(v.string()),
    yLabel: v.optional(v.string()),
    xUnit: v.optional(v.string()),
    yUnit: v.optional(v.string()),
    elements: v.any(),
    pngBase64: v.optional(v.string()),
  }))),
  // Perplexity citation annotations (structured for rich UI rendering)
  citations: v.optional(v.array(v.object({
    url: v.string(),
    title: v.string(),
  }))),
  // M26 — Lyria music generation: inline audio attached during generation
  audioStorageId: v.optional(v.id("_storage")),
  audioDurationMs: v.optional(v.number()),
  audioGeneratedAt: v.optional(v.number()),
  triggerUserMessageId: v.optional(v.id("messages")),
  /** OpenRouter generation ID — used post-finalization to fetch authoritative usage. */
  openrouterGenerationId: v.optional(v.string()),
} satisfies PropertyValidators;

export const requestAudioGenerationArgs = {
  messageId: v.id("messages"),
} satisfies PropertyValidators;

export const touchMessageAudioPlaybackArgs = {
  messageId: v.id("messages"),
} satisfies PropertyValidators;

export const patchMessageAudioArgs = {
  messageId: v.id("messages"),
  audioStorageId: v.id("_storage"),
  audioDurationMs: v.optional(v.number()),
  audioVoice: v.optional(v.string()),
  audioTranscript: v.optional(v.string()),
  audioGeneratedAt: v.optional(v.number()),
} satisfies PropertyValidators;

export const updateJobStatusArgs = {
  jobId: v.id("generationJobs"),
  status: v.union(
    v.literal("queued"),
    v.literal("streaming"),
    v.literal("completed"),
    v.literal("failed"),
    v.literal("cancelled"),
    v.literal("timedOut"),
  ),
  startedAt: v.optional(v.number()),
  error: v.optional(v.string()),
} satisfies PropertyValidators;

export const saveGenerationContinuationArgs = {
  chatId: v.id("chats"),
  messageId: v.id("messages"),
  jobId: v.id("generationJobs"),
  userId: v.string(),
  checkpoint: v.object({
    participant: generationParticipantValidator,
    group: v.object({
      assistantMessageIds: v.array(v.id("messages")),
      generationJobIds: v.array(v.id("generationJobs")),
      userMessageId: v.id("messages"),
      userId: v.string(),
      expandMultiModelGroups: v.boolean(),
      webSearchEnabled: v.boolean(),
      effectiveIntegrations: v.array(v.string()),
      directToolNames: v.array(v.string()),
      isPro: v.boolean(),
      allowSubagents: v.boolean(),
      searchSessionId: v.optional(v.id("searchSessions")),
      subagentBatchId: v.optional(v.id("subagentBatches")),
    }),
    messages: v.any(),
    usage: v.optional(
      v.object({
        promptTokens: v.number(),
        completionTokens: v.number(),
        totalTokens: v.number(),
        cost: v.optional(v.number()),
        isByok: v.optional(v.boolean()),
        cachedTokens: v.optional(v.number()),
        cacheWriteTokens: v.optional(v.number()),
        audioPromptTokens: v.optional(v.number()),
        videoTokens: v.optional(v.number()),
        reasoningTokens: v.optional(v.number()),
        imageCompletionTokens: v.optional(v.number()),
        audioCompletionTokens: v.optional(v.number()),
        upstreamInferenceCost: v.optional(v.number()),
        upstreamInferencePromptCost: v.optional(v.number()),
        upstreamInferenceCompletionsCost: v.optional(v.number()),
      }),
    ),
    toolCalls: v.array(v.object({
      id: v.string(),
      name: v.string(),
      arguments: v.string(),
    })),
    toolResults: v.array(v.object({
      toolCallId: v.string(),
      toolName: v.string(),
      result: v.string(),
      isError: v.optional(v.boolean()),
    })),
    activeProfiles: v.array(v.string()),
    compactionCount: v.number(),
    continuationCount: v.number(),
    partialContent: v.optional(v.string()),
    partialReasoning: v.optional(v.string()),
  }),
} satisfies PropertyValidators;

export const claimGenerationContinuationArgs = {
  jobId: v.id("generationJobs"),
} satisfies PropertyValidators;

export const setGenerationContinuationScheduledArgs = {
  jobId: v.id("generationJobs"),
  scheduledFunctionId: v.id("_scheduled_functions"),
  updateContinuation: v.optional(v.boolean()),
} satisfies PropertyValidators;

export const clearGenerationContinuationArgs = {
  jobId: v.id("generationJobs"),
} satisfies PropertyValidators;

export const cancelGenerationContinuationArgs = {
  jobId: v.id("generationJobs"),
} satisfies PropertyValidators;

export const isJobCancelledArgs = {
  jobId: v.id("generationJobs"),
} satisfies PropertyValidators;

export const updateChatTitleArgs = {
  chatId: v.id("chats"),
  title: v.string(),
} satisfies PropertyValidators;

export const createMemoryArgs = {
  userId: v.string(),
  content: v.string(),
  category: v.optional(memoryCategory),
  memoryType: v.optional(
    v.union(
      v.literal("profile"),
      v.literal("responsePreference"),
      v.literal("workContext"),
      v.literal("transient"),
    ),
  ),
  importanceScore: v.optional(v.number()),
  confidenceScore: v.optional(v.number()),
  reinforcementCount: v.optional(v.number()),
  lastReinforcedAt: v.optional(v.number()),
  expiresAt: v.optional(v.number()),
  supersedesMemoryId: v.optional(v.id("memories")),
  sourceMessageId: v.optional(v.id("messages")),
  sourceChatId: v.optional(v.id("chats")),
  retrievalMode: v.optional(memoryRetrievalMode),
  scopeType: v.optional(memoryScopeType),
  personaIds: v.optional(v.array(v.string())),
  sourceType: v.optional(memorySourceType),
  sourceFileName: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
  isPending: v.optional(v.boolean()),
  createdAt: v.number(),
} satisfies PropertyValidators;

export const reinforceMemoryArgs = {
  memoryId: v.id("memories"),
  reinforcedAt: v.number(),
  candidateMemoryType: v.optional(
    v.union(
      v.literal("profile"),
      v.literal("responsePreference"),
      v.literal("workContext"),
      v.literal("transient"),
    ),
  ),
  candidateImportanceScore: v.optional(v.number()),
  candidateConfidenceScore: v.optional(v.number()),
  candidateExpiresAt: v.optional(v.number()),
} satisfies PropertyValidators;

export const supersedeMemoryArgs = {
  memoryId: v.id("memories"),
  supersededAt: v.number(),
  supersededByMemoryId: v.optional(v.id("memories")),
} satisfies PropertyValidators;

// M10 — Live tool-call streaming: progressively patch toolCalls onto a message.
export const updateMessageToolCallsArgs = {
  messageId: v.id("messages"),
  toolCalls: v.array(v.object({
    id: v.string(),
    name: v.string(),
    arguments: v.string(),
  })),
} satisfies PropertyValidators;

export const touchMemoriesArgs = {
  memoryIds: v.array(v.id("memories")),
  touchedAt: v.number(),
} satisfies PropertyValidators;

// MARK: - Knowledge Base (Phase KB)

export const deleteKnowledgeBaseFileArgs = {
  storageId: v.id("_storage"),
  source: v.union(v.literal("upload"), v.literal("generated")),
} satisfies PropertyValidators;

export const storeGenerationUsageArgs = {
  messageId: v.id("messages"),
  chatId: v.id("chats"),
  userId: v.string(),
  promptTokens: v.number(),
  completionTokens: v.number(),
  totalTokens: v.number(),
  cost: v.optional(v.number()),
  isByok: v.optional(v.boolean()),
  cachedTokens: v.optional(v.number()),
  cacheWriteTokens: v.optional(v.number()),
  audioPromptTokens: v.optional(v.number()),
  videoTokens: v.optional(v.number()),
  reasoningTokens: v.optional(v.number()),
  imageCompletionTokens: v.optional(v.number()),
  audioCompletionTokens: v.optional(v.number()),
  upstreamInferenceCost: v.optional(v.number()),
  upstreamInferencePromptCost: v.optional(v.number()),
  upstreamInferenceCompletionsCost: v.optional(v.number()),
  webSearchRequests: v.optional(v.number()),
} satisfies PropertyValidators;

// M23: Ancillary (non-generation) cost tracking args.
export type StoreAncillaryCostArgs = {
  messageId: string;
  chatId: string;
  userId: string;
  modelId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost?: number;
  source: string;
  generationId?: string;
};

export const storeAncillaryCostArgs = {
  messageId: v.id("messages"),
  chatId: v.id("chats"),
  userId: v.string(),
  modelId: v.string(),
  promptTokens: v.number(),
  completionTokens: v.number(),
  totalTokens: v.number(),
  cost: v.optional(v.number()),
  source: v.string(),
  generationId: v.optional(v.string()),
} satisfies PropertyValidators;

// ── M29: Video Generation ─────────────────────────────────────────────

export const createVideoJobArgs = {
  messageId: v.id("messages"),
  chatId: v.id("chats"),
  userId: v.string(),
  openRouterJobId: v.string(),
  pollingUrl: v.string(),
  model: v.string(),
  prompt: v.string(),
  videoConfig: v.optional(v.object({
    resolution: v.optional(v.string()),
    aspectRatio: v.optional(v.string()),
    duration: v.optional(v.number()),
    generateAudio: v.optional(v.boolean()),
  })),
} satisfies PropertyValidators;

export type CreateVideoJobArgs = {
  messageId: Id<"messages">;
  chatId: Id<"chats">;
  userId: string;
  openRouterJobId: string;
  pollingUrl: string;
  model: string;
  prompt: string;
  videoConfig?: {
    resolution?: string;
    aspectRatio?: string;
    duration?: number;
    generateAudio?: boolean;
  };
};

export const updateVideoJobStatusArgs = {
  videoJobId: v.id("videoJobs"),
  status: v.union(
    v.literal("pending"),
    v.literal("in_progress"),
    v.literal("completed"),
    v.literal("failed"),
  ),
  error: v.optional(v.string()),
} satisfies PropertyValidators;

export type UpdateVideoJobStatusArgs = {
  videoJobId: Id<"videoJobs">;
  status: "pending" | "in_progress" | "completed" | "failed";
  error?: string;
};

export const updateVideoJobPollArgs = {
  videoJobId: v.id("videoJobs"),
  status: v.union(
    v.literal("pending"),
    v.literal("in_progress"),
    v.literal("completed"),
    v.literal("failed"),
  ),
  pollCount: v.number(),
  error: v.optional(v.string()),
} satisfies PropertyValidators;

export type UpdateVideoJobPollArgs = {
  videoJobId: Id<"videoJobs">;
  status: "pending" | "in_progress" | "completed" | "failed";
  pollCount: number;
  error?: string;
};

export const insertGeneratedMediaArgs = {
  userId: v.string(),
  chatId: v.id("chats"),
  messageId: v.id("messages"),
  storageId: v.id("_storage"),
  type: v.union(v.literal("image"), v.literal("video")),
  mimeType: v.string(),
  sizeBytes: v.optional(v.number()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  durationSeconds: v.optional(v.number()),
  model: v.optional(v.string()),
  prompt: v.optional(v.string()),
} satisfies PropertyValidators;

export type InsertGeneratedMediaArgs = {
  userId: string;
  chatId: Id<"chats">;
  messageId: Id<"messages">;
  storageId: Id<"_storage">;
  type: "image" | "video";
  mimeType: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  model?: string;
  prompt?: string;
};
