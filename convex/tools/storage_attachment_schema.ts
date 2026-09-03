export const STORAGE_ATTACHMENTS_PARAMETER = {
  type: "array",
  description: "Optional user-owned attachments from prior file or media tool results.",
  items: {
    type: "object",
    properties: {
      storage_id: { type: "string", description: "Owned Convex storage ID returned by a prior tool." },
      filename: { type: "string", description: "Optional attachment filename override." },
      content_type: { type: "string", description: "Optional MIME type override." },
    },
    required: ["storage_id"],
    additionalProperties: false,
  },
} as const;
