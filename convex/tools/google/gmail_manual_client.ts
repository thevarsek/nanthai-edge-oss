"use node";

import { ConvexError } from "convex/values";
import {
  ImapFlow,
  type AppendResponseObject,
  type ListOptions,
} from "imapflow";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import { randomUUID } from "node:crypto";
import type { ActionCtx } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { decryptSecret, oauthSecretContext } from "../../lib/secret_crypto";

const IMAP_HOST = "imap.gmail.com";
const IMAP_PORT = 993;
const SMTP_HOST = "smtp.gmail.com";
const SMTP_PORT = 465;

export interface GmailManualCredentials {
  email: string;
  appPassword: string;
}

export interface GmailMailAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

export interface GmailMessageSummary {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to?: string;
  date?: string;
  snippet?: string;
  body?: string;
  isUnread: boolean;
  labels: string[];
}

type GmailAppendResponse = AppendResponseObject & {
  id?: string;
};

type GmailSpecialUseListOptions = ListOptions & {
  specialUse: true;
};

export function normalizeMailboxLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return "INBOX";
  const upper = trimmed.toUpperCase();
  switch (upper) {
    case "INBOX":
      return "INBOX";
    case "TRASH":
      return "[Gmail]/Trash";
    case "SPAM":
      return "[Gmail]/Spam";
    case "SENT":
      return "[Gmail]/Sent Mail";
    case "DRAFT":
    case "DRAFTS":
      return "[Gmail]/Drafts";
    case "STARRED":
      return "[Gmail]/Starred";
    case "IMPORTANT":
      return "[Gmail]/Important";
    case "ALL_MAIL":
      return "[Gmail]/All Mail";
    default:
      return trimmed;
  }
}

export function imapSearchFromGmailQuery(query: string): Record<string, unknown> {
  const trimmed = query.trim();
  if (!trimmed) return {};

  const criteria: Record<string, unknown> = {};
  const from = trimmed.match(/\bfrom:([^\s]+)/i)?.[1];
  const to = trimmed.match(/\bto:([^\s]+)/i)?.[1];
  const subject = trimmed.match(/\bsubject:("[^"]+"|[^\s]+)/i)?.[1]?.replace(/^"|"$/g, "");
  const after = trimmed.match(/\bafter:(\d{4}[/-]\d{1,2}[/-]\d{1,2})/i)?.[1];
  const before = trimmed.match(/\bbefore:(\d{4}[/-]\d{1,2}[/-]\d{1,2})/i)?.[1];

  if (from) criteria.from = from;
  if (to) criteria.to = to;
  if (subject) criteria.subject = subject;
  if (after) criteria.since = new Date(after.replace(/\//g, "-"));
  if (before) criteria.before = new Date(before.replace(/\//g, "-"));
  if (/\bis:unread\b/i.test(trimmed)) criteria.seen = false;
  if (/\bis:read\b/i.test(trimmed)) criteria.seen = true;
  if (/\bis:starred\b/i.test(trimmed)) criteria.flagged = true;

  const freeText = trimmed
    .replace(/\b(from|to|subject|after|before):("[^"]+"|[^\s]+)/gi, "")
    .replace(/\bis:(unread|read|starred)\b/gi, "")
    .trim();
  if (freeText) criteria.body = freeText;

  return criteria;
}

export async function getGmailManualCredentials(
  ctx: Pick<ActionCtx, "runQuery">,
  userId: string,
): Promise<GmailManualCredentials> {
  const connection = await ctx.runQuery(
    internal.oauth.gmail_manual.getConnectionInternal,
    { userId },
  ) as { email?: string; accessToken?: string; status?: string } | null;

  if (!connection || connection.status !== "active") {
    throw new ConvexError({
      code: "INTEGRATION_NOT_CONNECTED" as const,
      message: "No Manual Gmail connection found. Ask the user to connect Gmail with an app password in Settings.",
    });
  }

  if (!connection.email || !connection.accessToken) {
    throw new ConvexError({
      code: "INTEGRATION_NOT_CONNECTED" as const,
      message: "Manual Gmail credentials are incomplete. Ask the user to reconnect Gmail.",
    });
  }

  const appPassword = await decryptSecret(
    connection.accessToken,
    oauthSecretContext(userId, "gmail_manual", "accessToken"),
  );
  return { email: connection.email, appPassword };
}

export function createGmailImapClient(credentials: GmailManualCredentials): ImapFlow {
  return new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: {
      user: credentials.email,
      pass: credentials.appPassword,
    },
    logger: false,
  });
}

export function createGmailSmtpTransport(credentials: GmailManualCredentials) {
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: true,
    auth: {
      user: credentials.email,
      pass: credentials.appPassword,
    },
  });
}

export async function validateGmailManualCredentials(
  credentials: GmailManualCredentials,
): Promise<void> {
  const client = createGmailImapClient(credentials);
  try {
    await client.connect();
    await client.mailboxOpen("INBOX", { readOnly: true });
  } finally {
    await client.logout().catch(() => undefined);
  }

  const transport = createGmailSmtpTransport(credentials);
  await transport.verify();
}

export async function sendGmailManualMail(
  credentials: GmailManualCredentials,
  args: {
    to: string;
    subject: string;
    body: string;
    isHtml?: boolean;
    cc?: string;
    bcc?: string;
    attachments?: GmailMailAttachment[];
  },
) {
  const transport = createGmailSmtpTransport(credentials);
  return await transport.sendMail({
    from: credentials.email,
    to: args.to,
    cc: args.cc,
    bcc: args.bcc,
    subject: args.subject,
    text: args.isHtml ? undefined : args.body,
    html: args.isHtml ? args.body : undefined,
    attachments: args.attachments,
  });
}

async function buildRawDraftMessage(
  credentials: GmailManualCredentials,
  args: {
    to: string;
    subject: string;
    body: string;
    isHtml?: boolean;
    cc?: string;
    bcc?: string;
    attachments?: GmailMailAttachment[];
  },
): Promise<Buffer> {
  const message = new MailComposer({
    from: credentials.email,
    to: args.to,
    cc: args.cc,
    bcc: args.bcc,
    subject: args.subject,
    text: args.isHtml ? undefined : args.body,
    html: args.isHtml ? args.body : undefined,
    date: new Date(),
    messageId: `<${randomUUID()}@nanthai.local>`,
    headers: { "X-Mailer": "NanthAI" },
    attachments: args.attachments,
  }).compile();
  // SMTP strips Bcc from the wire by design, but an IMAP-appended draft must
  // retain it so Gmail can show and send the user's configured recipients.
  message.keepBcc = true;
  return await message.build();
}

export async function createGmailManualDraft(
  credentials: GmailManualCredentials,
  args: {
    to: string;
    subject: string;
    body: string;
    isHtml?: boolean;
    cc?: string;
    bcc?: string;
    attachments?: GmailMailAttachment[];
  },
): Promise<{ mailbox: string; uid?: number; messageId?: string }> {
  const client = createGmailImapClient(credentials);
  try {
    await client.connect();
    const draftsPath =
      await findGmailSpecialUseMailbox(client, "\\Drafts") ??
      normalizeMailboxLabel("DRAFTS");
    const message = await buildRawDraftMessage(credentials, args);
    const result = await client.append(draftsPath, message, ["\\Draft"], new Date()) as GmailAppendResponse | false;
    if (result === false) {
      throw new Error("Gmail rejected the draft append operation.");
    }
    return {
      mailbox: draftsPath,
      uid: typeof result.uid === "number" ? result.uid : undefined,
      messageId: typeof result.id === "string" ? result.id : undefined,
    };
  } finally {
    await client.logout().catch(() => undefined);
  }
}

export async function findGmailSpecialUseMailbox(
  client: ImapFlow,
  specialUse: string,
): Promise<string | null> {
  // Gmail localizes the names of "[Gmail]/Trash", "[Gmail]/Spam", etc. (e.g.
  // "[Gmail]/Cestino" on Italian accounts). The cross-locale way to find them
  // is to look for the LIST SPECIAL-USE flag (\Trash, \Junk, \Sent, \All).
  try {
    const boxes = await client.list({ specialUse: true } as GmailSpecialUseListOptions);
    for (const box of boxes) {
      const flags = box.specialUse;
      if (typeof flags === "string" && flags === specialUse) return box.path;
      if (Array.isArray(flags) && flags.includes(specialUse)) return box.path;
    }
  } catch {
    // ignore — fall through to null
  }
  return null;
}

export {
  listGmailManualLabels,
  modifyGmailManualLabels,
  moveGmailManualMessages,
  trashGmailManualMessages,
} from "./gmail_manual_labels";
export { listGmailManualMessages } from "./gmail_manual_messages";
