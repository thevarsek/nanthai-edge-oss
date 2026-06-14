import {
  createTool,
  type RegisteredTool,
  type ToolParameterSchema,
} from "../registry";

const openParameters: ToolParameterSchema = {
  type: "object",
  properties: {},
  additionalProperties: true,
};

function unavailableGmailTool(name: string, description: string): RegisteredTool {
  return createTool({
    name,
    description,
    parameters: openParameters,
    execute: async () => ({
      success: false,
      data: null,
      error:
        "Manual Gmail tools are temporarily unavailable while NanthAI isolates IMAP/SMTP packages behind a Convex action boundary.",
    }),
  });
}

export const gmailSend = unavailableGmailTool(
  "gmail_send",
  "Send an email through the user's connected Gmail account.",
);

export const gmailCreateDraft = unavailableGmailTool(
  "gmail_create_draft",
  "Create a draft email in the user's connected Gmail account.",
);

export const gmailRead = unavailableGmailTool(
  "gmail_read",
  "Read messages from the user's connected Gmail account.",
);

export const gmailSearch = unavailableGmailTool(
  "gmail_search",
  "Search messages in the user's connected Gmail account.",
);

export const gmailDelete = unavailableGmailTool(
  "gmail_delete",
  "Move Gmail messages to Trash.",
);

export const gmailModifyLabels = unavailableGmailTool(
  "gmail_modify_labels",
  "Add or remove labels on Gmail messages.",
);

export const gmailListLabels = unavailableGmailTool(
  "gmail_list_labels",
  "List labels in the user's connected Gmail account.",
);
