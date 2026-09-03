"use node";

import { createTool } from "../registry";
import {
  resolveStorageAttachments,
  STORAGE_ATTACHMENTS_PARAMETER,
  type ResolvedStorageAttachment,
} from "../storage_attachments";
import { getMicrosoftAccessToken } from "./auth";

const GRAPH_API = "https://graph.microsoft.com/v1.0/me";
const SIMPLE_ATTACHMENT_LIMIT = 3 * 1024 * 1024;
const UPLOAD_CHUNK_BYTES = 12 * 320 * 1024;

function recipients(value: string | undefined) {
  return (value ?? "").split(",").map((email) => email.trim()).filter(Boolean)
    .map((address) => ({ emailAddress: { address } }));
}

async function addSimpleAttachment(
  accessToken: string,
  messageId: string,
  attachment: ResolvedStorageAttachment,
): Promise<void> {
  const response = await fetch(
    `${GRAPH_API}/messages/${encodeURIComponent(messageId)}/attachments`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: attachment.filename,
        contentType: attachment.contentType,
        contentBytes: attachment.contentBase64,
      }),
    },
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Outlook attachment upload failed (HTTP ${response.status}).`);
  }
  await response.body?.cancel();
}

function assertMicrosoftUploadUrl(value: string): URL {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  const allowed = url.protocol === "https:" && (
    hostname === "outlook.office.com" || hostname.endsWith(".office.com") ||
    hostname.endsWith(".office365.com") || hostname.endsWith(".microsoft.com")
  );
  if (!allowed || url.username || url.password || url.hash) {
    throw new Error("Microsoft returned an invalid attachment upload URL.");
  }
  return url;
}

async function addLargeAttachment(
  accessToken: string,
  messageId: string,
  attachment: ResolvedStorageAttachment,
): Promise<void> {
  const sessionResponse = await fetch(
    `${GRAPH_API}/messages/${encodeURIComponent(messageId)}/attachments/createUploadSession`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        AttachmentItem: {
          attachmentType: "file",
          name: attachment.filename,
          size: attachment.sizeBytes,
          contentType: attachment.contentType,
        },
      }),
    },
  );
  if (!sessionResponse.ok) {
    await sessionResponse.body?.cancel();
    throw new Error(`Outlook upload session creation failed (HTTP ${sessionResponse.status}).`);
  }
  const payload = await sessionResponse.json() as { uploadUrl?: string };
  if (!payload.uploadUrl) throw new Error("Outlook returned no attachment upload URL.");
  const uploadUrl = assertMicrosoftUploadUrl(payload.uploadUrl);
  let offset = 0;
  while (offset < attachment.content.length) {
    const endExclusive = Math.min(offset + UPLOAD_CHUNK_BYTES, attachment.content.length);
    const chunk = attachment.content.subarray(offset, endExclusive);
    const response = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(chunk.length),
        "Content-Range": `bytes ${offset}-${endExclusive - 1}/${attachment.content.length}`,
      },
      body: new Uint8Array(chunk),
      redirect: "error",
    });
    const isFinal = endExclusive === attachment.content.length;
    if (isFinal) {
      if (response.status !== 201) {
        await response.body?.cancel();
        throw new Error(`Outlook chunk upload failed (HTTP ${response.status}).`);
      }
      const location = response.headers.get("Location");
      if (!location || !/\/attachments(?:\(|\/)/i.test(assertMicrosoftUploadUrl(location).pathname)) {
        await response.body?.cancel();
        throw new Error("Outlook completed an upload without an attachment identifier.");
      }
      await response.body?.cancel();
      return;
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new Error(`Outlook chunk upload failed (HTTP ${response.status}).`);
    }
    const progress = await response.json() as { nextExpectedRanges?: string[] };
    const nextOffset = Number.parseInt(progress.nextExpectedRanges?.[0] ?? "", 10);
    if (!Number.isSafeInteger(nextOffset) || nextOffset !== endExclusive) {
      throw new Error("Outlook returned an invalid next upload range.");
    }
    offset = nextOffset;
  }
  throw new Error("Outlook upload ended before the attachment was completed.");
}

export const outlookCreateDraft = createTool({
  name: "outlook_create_draft",
  description: "Create an Outlook draft for review without sending it. May include user-owned files or generated-media attachments.",
  parameters: {
    type: "object",
    properties: {
      to: { type: "string", description: "Recipient email addresses, comma-separated." },
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
    const to = typeof args.to === "string" ? args.to.trim() : "";
    const subject = typeof args.subject === "string" ? args.subject.trim() : "";
    const body = typeof args.body === "string" ? args.body : "";
    if (!to || !subject || !body) {
      return { success: false, data: null, error: "Missing 'to', 'subject', or 'body'." };
    }
    const attachments = await resolveStorageAttachments(toolCtx, args.attachments);
    const { accessToken, connection } = await getMicrosoftAccessToken(toolCtx.ctx, toolCtx.userId);
    if (!connection.scopes.includes("Mail.ReadWrite")) {
      return { success: false, data: null, error: "Reconnect Microsoft to grant Mail.ReadWrite for Outlook drafts." };
    }
    const message: Record<string, unknown> = {
      subject,
      body: { contentType: args.is_html === true ? "HTML" : "Text", content: body },
      toRecipients: recipients(to),
    };
    const cc = recipients(typeof args.cc === "string" ? args.cc : undefined);
    const bcc = recipients(typeof args.bcc === "string" ? args.bcc : undefined);
    if (cc.length > 0) message.ccRecipients = cc;
    if (bcc.length > 0) message.bccRecipients = bcc;
    const response = await fetch(`${GRAPH_API}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return { success: false, data: null, error: `Outlook draft creation failed (HTTP ${response.status}).` };
    }
    const created = await response.json() as { id?: string; webLink?: string };
    if (!created.id) throw new Error("Outlook returned no draft message ID.");
    let attachmentCount = 0;
    let currentAttachmentName: string | undefined;
    try {
      for (const attachment of attachments) {
        currentAttachmentName = attachment.filename;
        if (attachment.sizeBytes < SIMPLE_ATTACHMENT_LIMIT) {
          await addSimpleAttachment(accessToken, created.id, attachment);
        } else {
          await addLargeAttachment(accessToken, created.id, attachment);
        }
        attachmentCount += 1;
      }
    } catch (error) {
      return {
        success: false,
        data: {
          draftId: created.id,
          draftCreated: true,
          attachmentCount,
          failedAttachment: currentAttachmentName,
        },
        error: `Draft was created with ${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"}, but '${currentAttachmentName ?? "an attachment"}' failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    return {
      success: true,
      data: {
        draftId: created.id,
        webLink: created.webLink,
        attachmentCount: attachments.length,
        message: `Draft saved in Outlook for ${to} with subject "${subject}".`,
      },
    };
  },
});
