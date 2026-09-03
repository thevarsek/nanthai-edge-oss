"use node";

import { createTool } from "../registry";
import {
  resolveStorageAttachments,
  STORAGE_ATTACHMENTS_PARAMETER,
} from "../storage_attachments";
import {
  createGmailManualDraft,
  getGmailManualCredentials,
  sendGmailManualMail,
} from "./gmail_manual_client";

function gmailManualToolError(error: unknown) {
  return {
    success: false,
    data: null,
    error: error instanceof Error ? error.message : String(error),
  };
}

export const gmailSend = createTool({
  name: "gmail_send",
  description:
    "Send an email via the user's manually connected Gmail account. " +
    "Use when the user asks you to send an email, reply to someone, or draft and send a message. " +
    "The email is sent immediately from the user's Gmail address. Supports plain text and HTML bodies and owned file or media attachments.",
  parameters: {
    type: "object",
    properties: {
      to: { type: "string", description: "Recipient email address." },
      subject: { type: "string", description: "Email subject line." },
      body: { type: "string", description: "Email body content." },
      is_html: { type: "boolean", description: "Whether the body is HTML." },
      cc: { type: "string", description: "Optional CC recipients, comma-separated." },
      bcc: { type: "string", description: "Optional BCC recipients, comma-separated." },
      attachments: STORAGE_ATTACHMENTS_PARAMETER,
    },
    required: ["to", "subject", "body"],
  },
  execute: async (toolCtx, args) => {
    const to = args.to as string;
    const subject = args.subject as string;
    const body = args.body as string;
    if (!to || !subject || !body) {
      return { success: false, data: null, error: "Missing 'to', 'subject', or 'body'." };
    }

    let attachments;
    let credentials;
    try {
      attachments = await resolveStorageAttachments(toolCtx, args.attachments);
      credentials = await getGmailManualCredentials(toolCtx.ctx, toolCtx.userId);
    } catch (error) {
      return gmailManualToolError(error);
    }

    // Once SMTP dispatch starts, a transport failure can be ambiguous. Let the
    // tool journal record outcome_unknown instead of treating it as safely failed.
    const result = await sendGmailManualMail(credentials, {
      to,
      subject,
      body,
      isHtml: (args.is_html as boolean) ?? false,
      cc: args.cc as string | undefined,
      bcc: args.bcc as string | undefined,
      attachments: attachments.map((attachment) => ({
        filename: attachment.filename,
        contentType: attachment.contentType,
        content: attachment.content,
      })),
    });
    return {
      success: true,
      data: {
        messageId: result.messageId,
        threadId: null,
        attachmentCount: attachments.length,
        message: `Email sent successfully to ${to} with subject "${subject}".`,
      },
    };
  },
});

export const gmailCreateDraft = createTool({
  name: "gmail_create_draft",
  description:
    "Create a draft email in the user's manually connected Gmail Drafts folder using IMAP append. " +
    "Use when the user asks to draft an email without sending it. The draft is saved for review and may include owned file or generated-media attachments.",
  parameters: {
    type: "object",
    properties: {
      to: { type: "string", description: "Recipient email address." },
      subject: { type: "string", description: "Email subject line." },
      body: { type: "string", description: "Email body content." },
      is_html: { type: "boolean", description: "Whether the body is HTML." },
      cc: { type: "string", description: "Optional CC recipients, comma-separated." },
      bcc: { type: "string", description: "Optional BCC recipients, comma-separated." },
      attachments: STORAGE_ATTACHMENTS_PARAMETER,
    },
    required: ["to", "subject", "body"],
  },
  execute: async (toolCtx, args) => {
    const to = args.to as string;
    const subject = args.subject as string;
    const body = args.body as string;
    if (!to || !subject || !body) {
      return { success: false, data: null, error: "Missing 'to', 'subject', or 'body'." };
    }

    let attachments;
    let credentials;
    try {
      attachments = await resolveStorageAttachments(toolCtx, args.attachments);
      credentials = await getGmailManualCredentials(toolCtx.ctx, toolCtx.userId);
    } catch (error) {
      return gmailManualToolError(error);
    }

    // IMAP APPEND can succeed before the connection reports an error, so the
    // operation journal must retain an ambiguous outcome rather than replay it.
    const result = await createGmailManualDraft(credentials, {
      to,
      subject,
      body,
      isHtml: (args.is_html as boolean) ?? false,
      cc: args.cc as string | undefined,
      bcc: args.bcc as string | undefined,
      attachments: attachments.map((attachment) => ({
        filename: attachment.filename,
        contentType: attachment.contentType,
        content: attachment.content,
      })),
    });
    return {
      success: true,
      data: {
        draftId: result.uid ? String(result.uid) : null,
        mailbox: result.mailbox,
        attachmentCount: attachments.length,
        message: `Draft saved in Gmail for ${to} with subject "${subject}".`,
      },
    };
  },
});
