"use node";

import {
  makeFunctionReference,
  type FunctionReference,
} from "convex/server";
import {
  createTool,
  type ToolConfig,
  type ToolExecutionContext,
  type ToolResult,
} from "../registry";

type AppleCalendarToolName =
  | "apple_calendar_list"
  | "apple_calendar_create"
  | "apple_calendar_update"
  | "apple_calendar_delete";

type AppleCalendarToolContext = {
  userId: string;
  chatId?: string;
  messageId?: string;
  jobId?: string;
  generationKey?: string;
  modelId?: string;
  requireZdr?: boolean;
};

type ExecuteAppleCalendarToolArgs = {
  toolName: AppleCalendarToolName;
  toolArgs: Record<string, unknown>;
  toolContext: AppleCalendarToolContext;
};

const executeAppleCalendarToolRef = makeFunctionReference<
  "action",
  ExecuteAppleCalendarToolArgs,
  ToolResult
>(
  "tools/apple/actions:executeAppleCalendarTool",
) as unknown as FunctionReference<
  "action",
  "internal",
  ExecuteAppleCalendarToolArgs,
  ToolResult
>;

function toolContextForAction(
  toolCtx: ToolExecutionContext,
): AppleCalendarToolContext {
  const context: AppleCalendarToolContext = {
    userId: toolCtx.userId,
  };
  if (toolCtx.chatId !== undefined) context.chatId = toolCtx.chatId;
  if (toolCtx.messageId !== undefined) context.messageId = toolCtx.messageId;
  if (toolCtx.jobId !== undefined) context.jobId = toolCtx.jobId;
  if (toolCtx.generationKey !== undefined) {
    context.generationKey = toolCtx.generationKey;
  }
  if (toolCtx.modelId !== undefined) context.modelId = toolCtx.modelId;
  if (toolCtx.requireZdr !== undefined) context.requireZdr = toolCtx.requireZdr;
  return context;
}

function createAppleCalendarProxyTool(
  toolName: AppleCalendarToolName,
  config: Omit<ToolConfig, "execute">,
) {
  return createTool({
    ...config,
    execute: async (toolCtx, args) =>
      await toolCtx.ctx.runAction(executeAppleCalendarToolRef, {
        toolName,
        toolArgs: args,
        toolContext: toolContextForAction(toolCtx),
      }),
  });
}

export const appleCalendarList = createAppleCalendarProxyTool(
  "apple_calendar_list",
  {
    name: "apple_calendar_list",
    description:
      "List events from the user's Apple Calendar / iCloud Calendar. " +
      "Use when the user asks about their Apple schedule, iCloud calendar events, " +
      "or needs event IDs/URLs for later updates or deletion.",
    parameters: {
      type: "object",
      properties: {
        calendar_id: {
          type: "string",
          description:
            "Optional Apple calendar ID / URL. Omit to search across all calendars.",
        },
        max_results: {
          type: "number",
          description: "Maximum number of events to return (default 10, max 50).",
        },
        time_min: {
          type: "string",
          description: "Optional ISO 8601 start time. Defaults to now.",
        },
        time_max: {
          type: "string",
          description:
            "Optional ISO 8601 end time. Defaults to 30 days after time_min.",
        },
        query: {
          type: "string",
          description:
            "Optional case-insensitive text filter applied to event title, description, and location.",
        },
      },
      required: [],
    },
  },
);

export const appleCalendarCreate = createAppleCalendarProxyTool(
  "apple_calendar_create",
  {
    name: "apple_calendar_create",
    description:
      "Create a new event on the user's Apple Calendar / iCloud Calendar. " +
      "Requires a title plus start and end times. Date-only values create all-day events.",
    parameters: {
      type: "object",
      properties: {
        calendar_id: {
          type: "string",
          description:
            "Optional Apple calendar ID / URL. Defaults to the first available calendar.",
        },
        summary: {
          type: "string",
          description: "Event title / summary.",
        },
        start_time: {
          type: "string",
          description:
            "Event start as ISO 8601 or YYYY-MM-DD for all-day events.",
        },
        end_time: {
          type: "string",
          description:
            "Event end as ISO 8601 or YYYY-MM-DD for all-day events.",
        },
        description: {
          type: "string",
          description: "Optional event notes.",
        },
        location: {
          type: "string",
          description: "Optional event location.",
        },
        timezone: {
          type: "string",
          description:
            "Optional IANA timezone. Use when start_time/end_time omit an ISO offset.",
        },
      },
      required: ["summary", "start_time", "end_time"],
    },
  },
);

export const appleCalendarUpdate = createAppleCalendarProxyTool(
  "apple_calendar_update",
  {
    name: "apple_calendar_update",
    description:
      "Update an existing Apple Calendar / iCloud Calendar event. " +
      "Requires the event_url from apple_calendar_list.",
    parameters: {
      type: "object",
      properties: {
        event_url: {
          type: "string",
          description:
            "Apple Calendar event URL from apple_calendar_list results.",
        },
        summary: {
          type: "string",
          description: "Optional updated title / summary.",
        },
        start_time: {
          type: "string",
          description: "Optional updated start as ISO 8601 or YYYY-MM-DD.",
        },
        end_time: {
          type: "string",
          description: "Optional updated end as ISO 8601 or YYYY-MM-DD.",
        },
        description: {
          type: "string",
          description: "Optional updated event notes.",
        },
        location: {
          type: "string",
          description: "Optional updated location.",
        },
        timezone: {
          type: "string",
          description:
            "Optional IANA timezone to use when updated times omit ISO offsets.",
        },
      },
      required: ["event_url"],
    },
  },
);

export const appleCalendarDelete = createAppleCalendarProxyTool(
  "apple_calendar_delete",
  {
    name: "apple_calendar_delete",
    description:
      "Delete an event from the user's Apple Calendar / iCloud Calendar. " +
      "Requires the event_url from apple_calendar_list.",
    parameters: {
      type: "object",
      properties: {
        event_url: {
          type: "string",
          description:
            "Apple Calendar event URL from apple_calendar_list results.",
        },
      },
      required: ["event_url"],
    },
  },
);
