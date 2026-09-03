import {
  makeFunctionReference,
  type FunctionReference,
} from "convex/server";
import type { Id } from "../_generated/dataModel";

export interface MessageAudioExecutionMutationArgs
  extends Record<string, unknown> {
  messageId: Id<"messages">;
  executionRunId: Id<"executionRuns">;
  executionAttemptId: Id<"executionAttempts">;
  executionFence: number;
}

export interface PatchMessageAudioMutationArgs
  extends MessageAudioExecutionMutationArgs {
  audioStorageId: Id<"_storage">;
  audioMimeType?: string;
  audioDurationMs?: number;
  audioVoice?: string;
  audioTranscript?: string;
  audioGeneratedAt?: number;
}

export const clearAudioGeneratingRef = makeFunctionReference<
  "mutation",
  MessageAudioExecutionMutationArgs,
  null
>("chat/mutations:clearAudioGenerating") as unknown as FunctionReference<
  "mutation",
  "internal",
  MessageAudioExecutionMutationArgs,
  null
>;

export const patchMessageAudioRef = makeFunctionReference<
  "mutation",
  PatchMessageAudioMutationArgs,
  null
>("chat/mutations:patchMessageAudio") as unknown as FunctionReference<
  "mutation",
  "internal",
  PatchMessageAudioMutationArgs,
  null
>;
