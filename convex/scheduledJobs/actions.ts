import { v } from "convex/values";
import { action, internalAction } from "../_generated/server";
import { fetchAccountCredits } from "../openrouter/account";
import {
  continueScheduledJobExecutionHandler,
  executeScheduledJobHandler,
  failScheduledJobExecutionHandler,
} from "./actions_handlers";

export const executeScheduledJob = internalAction({
  args: {
    jobId: v.id("scheduledJobs"),
    invocationSource: v.optional(v.union(v.literal("scheduled"), v.literal("manual"), v.literal("api"))),
    templateVariables: v.optional(v.record(v.string(), v.string())),
    occurrenceId: v.optional(v.string()),
  },
  handler: executeScheduledJobHandler,
});

export const continueScheduledJobExecution = internalAction({
  args: {
    jobId: v.id("scheduledJobs"),
    chatId: v.id("chats"),
    executionId: v.string(),
    completedStepIndex: v.number(),
    assistantMessageId: v.id("messages"),
  },
  handler: continueScheduledJobExecutionHandler,
});

export const failScheduledJobExecution = internalAction({
  args: {
    jobId: v.id("scheduledJobs"),
    executionId: v.string(),
    error: v.string(),
  },
  handler: failScheduledJobExecutionHandler,
});

/**
 * Fetch the user's OpenRouter credit balance server-side.
 * The API key is stored in Convex (userSecrets) and cannot be accessed
 * from the browser, so this action proxies the OpenRouter credits API.
 */
export const fetchOpenRouterCredits = action({
  args: {},
  handler: fetchAccountCredits,
});
