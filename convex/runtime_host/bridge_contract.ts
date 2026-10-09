import { z } from "zod";

export const PublishResultSchema = z.strictObject({
  filename: z.string().min(1).max(180).refine((value) => !value.includes("/") && !value.includes("\\") && [...value].every((character) => character.charCodeAt(0) >= 32)),
  mimeType: z.enum(["text/plain", "text/markdown", "text/csv", "application/json"]),
  content: z.string().min(1).max(128_000),
});
export const BridgeRequestSchema = z.strictObject({
  callId: z.string().min(1).max(256),
  tool: z.enum(["nanthai_read_context", "nanthai_publish_result", "nanthai_update_collaboration_work"]),
  arguments: z.unknown(),
});
export const WorkResultSchema = z.strictObject({
  workId: z.string(), action: z.enum(["publish", "block", "accept", "rework"]),
  description: z.string(), sourceRevision: z.string(),
  requirementRevision: z.number().int().positive(), evidenceRevision: z.number().int().nonnegative(),
});
export const BRIDGE_TOOLS = [
  {
    name: "nanthai_read_context",
    description: "Read the current NanthAI context references and omissions. This is the authorized context for this turn, not private native history.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "nanthai_publish_result",
    description: "Deliberately publish a text, Markdown, CSV or JSON result to this NanthAI conversation for other signed-in clients and participants. Only publish material intended for the shared conversation. Maximum 128000 characters. A local path is not a published result.",
    inputSchema: {
      type: "object", properties: {
        filename: { type: "string" },
        mimeType: { type: "string", enum: ["text/plain", "text/markdown", "text/csv", "application/json"] },
        content: { type: "string", maxLength: 128_000 },
      }, required: ["filename", "mimeType", "content"], additionalProperties: false,
    },
  },
  {
    name: "nanthai_update_collaboration_work",
    description: "Publish assigned Collaboration work, report a blocker, or review exact evidence. Use the work ID and requirement/evidence revisions in the committed work context. This grants no external permission. Publication commits when this reply finishes.",
    inputSchema: { type: "object", properties: {
      workId: { type: "string" }, action: { type: "string", enum: ["publish", "block", "accept", "rework"] },
      description: { type: "string" }, sourceRevision: { type: "string" },
      requirementRevision: { type: "number" }, evidenceRevision: { type: "number" },
    }, required: ["workId", "action", "description", "sourceRevision", "requirementRevision", "evidenceRevision"], additionalProperties: false },
  },
];
