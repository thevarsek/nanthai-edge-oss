import {
  createTool,
  type ToolParameterSchema,
} from "./registry";

const openParameters: ToolParameterSchema = {
  type: "object",
  properties: {},
  additionalProperties: true,
};

export const proposeDocxEdits = createTool({
  name: "propose_docx_edits",
  description:
    "Default tool for localized edits to a scoped Microsoft Word .docx. Propose precise Word tracked changes for per-edit Accept or Reject review.",
  parameters: openParameters,
  execute: async () => ({
    success: false,
    data: null,
    error:
      "DOCX tracked-change proposals are temporarily unavailable while NanthAI isolates XML editing packages behind a Convex action boundary.",
  }),
});
