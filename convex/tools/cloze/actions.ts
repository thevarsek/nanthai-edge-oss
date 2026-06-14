"use node";

import { ConvexError, v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { serializableToolContextValidator } from "../proxy_context";
import type { RegisteredTool, ToolExecutionContext, ToolResult } from "../registry";

const clozeToolNames = new Set<string>([
  "cloze_person_find",
  "cloze_person_count",
  "cloze_person_add",
  "cloze_person_change",
  "cloze_add_note",
  "cloze_add_todo",
  "cloze_timeline",
  "cloze_save_draft",
  "cloze_about_me",
  "cloze_project_find",
  "cloze_project_change",
]);

async function clozeTools(): Promise<Map<string, RegisteredTool>> {
  const [people, timeline, projects] = await Promise.all([
    import("./people"),
    import("./timeline"),
    import("./projects"),
  ]);
  return new Map<string, RegisteredTool>([
    people.clozePersonFind,
    people.clozePersonCount,
    people.clozePersonAdd,
    people.clozePersonChange,
    timeline.clozeAddNote,
    timeline.clozeAddTodo,
    timeline.clozeTimeline,
    timeline.clozeSaveDraft,
    timeline.clozeAboutMe,
    projects.clozeProjectFind,
    projects.clozeProjectChange,
  ].map((tool) => [tool.name, tool]));
}

export const executeClozeTool = internalAction({
  args: {
    toolName: v.string(),
    toolArgs: v.any(),
    toolContext: serializableToolContextValidator,
  },
  handler: async (ctx, args): Promise<ToolResult> => {
    if (!clozeToolNames.has(args.toolName)) {
      throw new ConvexError({
        code: "UNKNOWN_CLOZE_TOOL" as const,
        message: `Unknown Cloze tool: ${args.toolName}`,
      });
    }
    const tools = await clozeTools();
    const tool = tools.get(args.toolName);
    if (!tool) {
      throw new ConvexError({
        code: "UNKNOWN_CLOZE_TOOL" as const,
        message: `Unknown Cloze tool: ${args.toolName}`,
      });
    }
    const toolCtx: ToolExecutionContext = {
      ctx,
      ...args.toolContext,
    };
    return await tool.execute(toolCtx, args.toolArgs as Record<string, unknown>);
  },
});
