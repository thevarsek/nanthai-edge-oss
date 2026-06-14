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
    "Propose precise edits to a scoped Microsoft Word .docx as Word tracked changes.",
  parameters: openParameters,
  execute: async () => ({
    success: false,
    data: null,
    error:
      "DOCX tracked-change proposals are temporarily unavailable while NanthAI isolates XML editing packages behind a Convex action boundary.",
  }),
});
