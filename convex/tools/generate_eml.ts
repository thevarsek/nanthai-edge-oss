// convex/tools/generate_eml.ts
// =============================================================================
// Tool: generate_eml — creates an RFC 5322 email (.eml) file and stores it
// in Convex file storage. Returns a download URL.
//
// Produces a valid .eml that can be opened in Apple Mail, Outlook, Thunderbird,
// or imported into any email client.
// =============================================================================

import { createTool } from "./registry";

function escapeHeaderValue(value: string): string {
  // Remove any newlines that could cause header injection
  return value.replace(/[\r\n]+/g, " ").trim();
}

function formatEmailAddress(name: string | undefined, email: string): string {
  if (name) {
    // RFC 5322: "Display Name" <email@example.com>
    const safeName = name.replace(/"/g, '\\"');
    return `"${safeName}" <${email}>`;
  }
  return email;
}

function formatDate(dateStr?: string): string {
  // RFC 5322 date format: Thu, 01 Jan 2026 12:00:00 +0000
  const date = dateStr ? new Date(dateStr) : new Date();
  return date.toUTCString();
}

function generateMessageId(): string {
  const random = Math.random().toString(36).substring(2, 14);
  const timestamp = Date.now().toString(36);
  return `<${timestamp}.${random}@nanthai.app>`;
}

export const generateEml = createTool({
  name: "generate_eml",
  description:
    "Generate an email file (.eml) with structured headers and body content. " +
    "Use when the user wants to draft an email as a downloadable .eml file " +
    "that can be opened in Apple Mail, Outlook, Thunderbird, or any email client. " +
    "Supports plain text and HTML body content.",
  parameters: {
    type: "object",
    properties: {
      from_name: {
        type: "string",
        description: "Sender display name (optional).",
      },
      from_email: {
        type: "string",
        description: "Sender email address (e.g. 'user@example.com').",
      },
      to: {
        type: "array",
        description: "List of recipient objects with name (optional) and email.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Recipient display name (optional)" },
            email: { type: "string", description: "Recipient email address" },
          },
          required: ["email"],
        },
      },
      cc: {
        type: "array",
        description: "CC recipients (optional). Same format as 'to'.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "CC recipient display name (optional)" },
            email: { type: "string", description: "CC recipient email address" },
          },
          required: ["email"],
        },
      },
      subject: {
        type: "string",
        description: "Email subject line.",
      },
      body_text: {
        type: "string",
        description: "Plain text email body.",
      },
      body_html: {
        type: "string",
        description:
          "HTML email body (optional). If provided alongside body_text, " +
          "the .eml will be multipart/alternative with both versions.",
      },
      date: {
        type: "string",
        description:
          "Email date in ISO 8601 format (optional, defaults to now). " +
          "Example: '2026-01-15T10:30:00Z'.",
      },
    },
    required: ["from_email", "to", "subject", "body_text"],
  },

  execute: async (toolCtx, args) => {
    const fromName = args.from_name as string | undefined;
    const fromEmail = args.from_email as string;
    const to = args.to as Array<{ name?: string; email: string }>;
    const cc = args.cc as Array<{ name?: string; email: string }> | undefined;
    const subject = args.subject as string;
    const bodyText = args.body_text as string;
    const bodyHtml = args.body_html as string | undefined;
    const dateStr = args.date as string | undefined;

    if (!fromEmail) {
      return { success: false, data: null, error: "Missing 'from_email'" };
    }
    if (!Array.isArray(to) || to.length === 0) {
      return { success: false, data: null, error: "'to' must be a non-empty array" };
    }
    if (!subject || typeof subject !== "string") {
      return { success: false, data: null, error: "Missing or invalid 'subject'" };
    }
    if (!bodyText || typeof bodyText !== "string") {
      return { success: false, data: null, error: "Missing or invalid 'body_text'" };
    }

    const lines: string[] = [];

    // Headers
    lines.push(`From: ${escapeHeaderValue(formatEmailAddress(fromName, fromEmail))}`);
    lines.push(`To: ${to.map((r) => escapeHeaderValue(formatEmailAddress(r.name, r.email))).join(", ")}`);
    if (cc && cc.length > 0) {
      lines.push(`Cc: ${cc.map((r) => escapeHeaderValue(formatEmailAddress(r.name, r.email))).join(", ")}`);
    }
    lines.push(`Subject: ${escapeHeaderValue(subject)}`);
    lines.push(`Date: ${formatDate(dateStr)}`);
    lines.push(`Message-ID: ${generateMessageId()}`);
    lines.push(`MIME-Version: 1.0`);
    lines.push(`X-Mailer: NanthAI`);

    if (bodyHtml) {
      // Multipart/alternative: plain text + HTML
      const boundary = `----=_NanthAI_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 10)}`;
      lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
      lines.push(""); // End of headers
      lines.push(`--${boundary}`);
      lines.push("Content-Type: text/plain; charset=UTF-8");
      lines.push("Content-Transfer-Encoding: 8bit");
      lines.push("");
      lines.push(bodyText);
      lines.push(`--${boundary}`);
      lines.push("Content-Type: text/html; charset=UTF-8");
      lines.push("Content-Transfer-Encoding: 8bit");
      lines.push("");
      lines.push(bodyHtml);
      lines.push(`--${boundary}--`);
    } else {
      // Plain text only
      lines.push("Content-Type: text/plain; charset=UTF-8");
      lines.push("Content-Transfer-Encoding: 8bit");
      lines.push(""); // End of headers
      lines.push(bodyText);
    }

    const emlContent = lines.join("\r\n");

    // Store in Convex file storage
    const blob = new Blob([emlContent], { type: "message/rfc822" });
    const storageId = await toolCtx.ctx.storage.store(blob);

    const safeSubject =
      subject.replace(/[^a-zA-Z0-9 _-]/g, "").trim().substring(0, 60) || "email";
    const filename = `${safeSubject}.eml`;

    const siteUrl = process.env.CONVEX_SITE_URL;
    const downloadUrl = siteUrl
      ? `${siteUrl}/download?storageId=${encodeURIComponent(storageId)}&filename=${encodeURIComponent(filename)}`
      : await toolCtx.ctx.storage.getUrl(storageId);

    return {
      success: true,
      data: {
        storageId,
        downloadUrl,
        filename,
        markdownLink: `[${filename}](${downloadUrl})`,
        message: `Email file generated. Present the download link to the user using markdown: [${filename}](${downloadUrl})`,
      },
    };
  },
});
