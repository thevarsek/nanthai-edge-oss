import type { OpenRouterUsage } from "./openrouter_types";

export type AdvisorOutputItem = {
  type: "openrouter:advisor";
  id?: string;
  prompt?: string;
  model?: string;
  advice?: string;
  error?: string;
  instance_name?: string;
  [key: string]: unknown;
};

export type AdvisorResponsesContentPart = Record<string, unknown>;

export type AdvisorResponsesInputItem =
  | AdvisorOutputItem
  | {
      type: "message";
      role: "assistant";
      id: string;
      status: "completed";
      content: AdvisorResponsesContentPart[];
    }
  | {
      type: "message";
      role: "system" | "user" | "tool";
      content: AdvisorResponsesContentPart[];
    };

export type AdvisorResponsesOptions = {
  dispatcherModel: string;
  input: AdvisorResponsesInputItem[];
  instanceName: string;
  advisorModel: string;
  advisorInstructions: string;
  allowWebSearch: boolean;
  maxCompletionTokens: number;
  temperature?: number;
  reasoningEffort?: string;
  idleTimeoutMs: number;
  absoluteTimeoutMs: number;
  isCancelled?: () => Promise<boolean>;
  cancellationPollIntervalMs?: number;
};

export type AdvisorResponsesResult = {
  advice: string;
  actualModelId?: string;
  responseId?: string;
  outputItemId?: string;
  replayItems: AdvisorOutputItem[];
  usage: OpenRouterUsage | null;
};

export type AdvisorResponsesCallbacks = {
  onAdviceDelta?: (delta: string) => Promise<void>;
  onActivity?: () => void;
};

export type AdvisorSSEState = {
  advisorItemIds: Set<string>;
  advice: string;
  responseId?: string;
  completedItem?: AdvisorOutputItem;
  usage: OpenRouterUsage | null;
  terminal: boolean;
  error?: string;
};
