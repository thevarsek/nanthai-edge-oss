import { makeFunctionReference, type FunctionReference } from "convex/server";
import { createActionProxyTool, type ExecuteProxyToolArgs } from "./action_proxy";
import type { ToolResult } from "./registry";

type PresentationToolName = "create_presentation" | "edit_presentation";

const executePresentationToolRef = makeFunctionReference<
  "action",
  ExecuteProxyToolArgs<PresentationToolName>,
  ToolResult
>("tools/presentation_actions:executePresentationTool") as unknown as FunctionReference<
  "action",
  "internal",
  ExecuteProxyToolArgs<PresentationToolName>,
  ToolResult
>;

export const createPresentation = createActionProxyTool(
  executePresentationToolRef,
  "create_presentation",
  {
    name: "create_presentation",
    description:
      "Create a revisioned editable presentation in this chat and return a real PPTX file. " +
      "Do not call until you have asked about and resolved the audience, tone/technicality, purpose, length, examples/reference deck, reusable assets, and any final ambiguity.",
    parameters: {
      type: "object",
      properties: {
        brief: { type: "string", description: "Resolved presentation brief." },
        audience: { type: "string", description: "Resolved target audience." },
        tone: { type: "string", description: "Resolved tone and technical depth." },
        title: { type: "string" },
        objective: { type: "string" },
        slideCount: { type: "number" },
        direction: { type: "string", description: "editorial, minimal, or data_led." },
        imageMode: { type: "string", description: "generated, references, mixed, or none." },
        referenceNotes: { type: "string", description: "Guidance extracted from examples or references." },
        assetStorageIds: { type: "array", items: { type: "string" } },
        sourceStorageId: { type: "string", description: "Attached source PPTX storage ID for an interpreted rebuild. A value duplicated in assetStorageIds is treated as a reusable image instead." },
      },
      required: ["brief", "audience", "tone"],
    },
  },
);

export const editPresentation = createActionProxyTool(
  executePresentationToolRef,
  "edit_presentation",
  {
    name: "edit_presentation",
    description:
      "Surgically edit one slide or stable HTML element in a NanthAI presentation and return an updated real PPTX. " +
      "Use IDs and revisions from hidden presentation context or read_presentation; preserve everything outside the requested scope.",
    parameters: {
      type: "object",
      properties: {
        instruction: { type: "string" },
        projectId: { type: "string" },
        projectRevision: { type: "number" },
        slideId: { type: "string" },
        slideNumber: { type: "number" },
        slideRevision: { type: "number" },
        elementId: { type: "string" },
      },
      required: ["instruction"],
    },
  },
);
