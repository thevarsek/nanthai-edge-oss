"use node";

import { ConvexError, v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { serializableToolContextValidator } from "../proxy_context";
import type { RegisteredTool, ToolExecutionContext, ToolResult } from "../registry";

const gmailToolNames = new Set<string>([
  "gmail_send",
  "gmail_create_draft",
  "gmail_read",
  "gmail_search",
  "gmail_delete",
  "gmail_modify_labels",
  "gmail_list_labels",
]);

async function gmailTools(): Promise<Map<string, RegisteredTool>> {
  const {
    gmailSend,
    gmailCreateDraft,
    gmailRead,
    gmailSearch,
    gmailDelete,
    gmailModifyLabels,
    gmailListLabels,
  } = await import("./gmail");
  return new Map<string, RegisteredTool>([
    gmailSend,
    gmailCreateDraft,
    gmailRead,
    gmailSearch,
    gmailDelete,
    gmailModifyLabels,
    gmailListLabels,
  ].map((tool) => [tool.name, tool]));
}

export type GmailToolName =
  | "gmail_send"
  | "gmail_create_draft"
  | "gmail_read"
  | "gmail_search"
  | "gmail_delete"
  | "gmail_modify_labels"
  | "gmail_list_labels";

export type GmailToolContext = {
  userId: string;
  chatId?: string;
  messageId?: string;
  jobId?: string;
  generationKey?: string;
  modelId?: string;
  requireZdr?: boolean;
};

export type ExecuteGmailToolArgs = {
  toolName: GmailToolName;
  toolArgs: Record<string, unknown>;
  toolContext: GmailToolContext;
};

export const executeGmailTool = internalAction({
  args: {
    toolName: v.string(),
    toolArgs: v.any(),
    toolContext: serializableToolContextValidator,
  },
  handler: async (ctx, args): Promise<ToolResult> => {
    if (!gmailToolNames.has(args.toolName)) {
      throw new ConvexError({
        code: "UNKNOWN_GMAIL_TOOL" as const,
        message: `Unknown Gmail tool: ${args.toolName}`,
      });
    }
    const tools = await gmailTools();
    const tool = tools.get(args.toolName);
    if (!tool) {
      throw new ConvexError({
        code: "UNKNOWN_GMAIL_TOOL" as const,
        message: `Unknown Gmail tool: ${args.toolName}`,
      });
    }

    const toolCtx: ToolExecutionContext = {
      ctx,
      ...args.toolContext,
    };
    return await tool.execute(
      toolCtx,
      args.toolArgs as Record<string, unknown>,
    );
  },
});
