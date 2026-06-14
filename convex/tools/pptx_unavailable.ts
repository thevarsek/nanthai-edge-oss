import {
  createTool,
  type RegisteredTool,
  type ToolParameterSchema,
} from "./registry";

const openParameters: ToolParameterSchema = {
  type: "object",
  properties: {},
  additionalProperties: true,
};

function unavailablePptxTool(name: string, description: string): RegisteredTool {
  return createTool({
    name,
    description,
    parameters: openParameters,
    execute: async () => ({
      success: false,
      data: null,
      error:
        "PowerPoint generation/editing is temporarily unavailable while NanthAI isolates presentation packages behind a Convex action boundary.",
    }),
  });
}

export const generatePptx = unavailablePptxTool(
  "generate_pptx",
  "Generate a PowerPoint presentation.",
);

export const editPptx = unavailablePptxTool(
  "edit_pptx",
  "Edit an existing PowerPoint presentation.",
);
