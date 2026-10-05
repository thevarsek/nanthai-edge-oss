import { z } from "zod";

export const PublishResultSchema = z.strictObject({
  filename: z.string().min(1).max(180).refine((value) => !value.includes("/") && !value.includes("\\") && [...value].every((character) => character.charCodeAt(0) >= 32)),
  mimeType: z.enum(["text/plain", "text/markdown", "text/csv", "application/json"]),
  content: z.string().min(1).max(128_000),
});
export const BridgeRequestSchema = z.strictObject({
  callId: z.string().min(1).max(256),
  tool: z.enum(["nanthai_read_context", "nanthai_publish_result"]),
  arguments: z.unknown(),
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
];
