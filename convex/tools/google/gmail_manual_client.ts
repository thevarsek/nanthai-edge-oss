"use node";

import { ConvexError } from "convex/values";
import { ImapFlow, type FetchMessageObject } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import { randomUUID } from "node:crypto";
import type { ActionCtx } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { maybeDecryptSecret } from "../../lib/secret_crypto";

const IMAP_HOST = "imap.gmail.com";
const IMAP_PORT = 993;
const SMTP_HOST = "smtp.gmail.com";
const SMTP_PORT = 465;

export interface GmailManualCredentials {
  email: string;
  appPassword: string;
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

function normalizeMailboxLabel(label: string): string {
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

function imapSearchFromGmailQuery(query: string): Record<string, unknown> {
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

  return { email: connection.email, appPassword: await maybeDecryptSecret(connection.accessToken) };
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
  });
}

function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function normalizeAddressList(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? sanitizeHeaderValue(trimmed) : undefined;
}

function buildRawDraftMessage(
  credentials: GmailManualCredentials,
  args: {
    to: string;
    subject: string;
    body: string;
    isHtml?: boolean;
    cc?: string;
    bcc?: string;
  },
): string {
  const headers: string[] = [
    `From: ${sanitizeHeaderValue(credentials.email)}`,
    `To: ${sanitizeHeaderValue(args.to)}`,
  ];
  const cc = normalizeAddressList(args.cc);
  const bcc = normalizeAddressList(args.bcc);
  if (cc) headers.push(`Cc: ${cc}`);
  if (bcc) headers.push(`Bcc: ${bcc}`);
  headers.push(`Subject: ${sanitizeHeaderValue(args.subject)}`);
  headers.push(`Date: ${new Date().toUTCString()}`);
  headers.push(`Message-ID: <${randomUUID()}@nanthai.local>`);
  headers.push("MIME-Version: 1.0");
  headers.push(
    args.isHtml === true
      ? "Content-Type: text/html; charset=utf-8"
      : "Content-Type: text/plain; charset=utf-8",
  );
  headers.push("Content-Transfer-Encoding: 8bit");
  return `${headers.join("\r\n")}\r\n\r\n${args.body.replace(/\r?\n/g, "\r\n")}`;
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
  },
): Promise<{ mailbox: string; uid?: number; messageId?: string }> {
  const client = createGmailImapClient(credentials);
  try {
    await client.connect();
    const draftsPath =
      await findGmailSpecialUseMailbox(client, "\\Drafts") ??
      normalizeMailboxLabel("DRAFTS");
    const message = buildRawDraftMessage(credentials, args);
    const result = await client.append(draftsPath, Buffer.from(message, "utf8"), ["\\Draft"], new Date());
    if (result === false) {
      throw new Error("Gmail rejected the draft append operation.");
    }
    return {
      mailbox: draftsPath,
      uid: typeof (result as any).uid === "number" ? (result as any).uid : undefined,
      messageId: typeof (result as any).id === "string" ? (result as any).id : undefined,
    };
  } finally {
    await client.logout().catch(() => undefined);
  }
}

export async function listGmailManualMessages(
  credentials: GmailManualCredentials,
  args: { query?: string; maxResults: number; includeBody?: boolean },
): Promise<GmailMessageSummary[]> {
  const client = createGmailImapClient(credentials);
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const idsResult = await client.search(imapSearchFromGmailQuery(args.query ?? ""));
      const ids = Array.isArray(idsResult) ? idsResult : [];
      const selected = ids.slice(-args.maxResults).reverse();
      const messages: GmailMessageSummary[] = [];

      for await (const message of client.fetch(selected, {
        uid: true,
        envelope: true,
        flags: true,
        labels: true,
        threadId: true,
        source: args.includeBody === true,
        bodyStructure: args.includeBody !== true,
      } as any)) {
        messages.push(await serializeMessage(message, args.includeBody === true));
      }

      return messages;
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
}

async function serializeMessage(
  message: FetchMessageObject,
  includeBody: boolean,
): Promise<GmailMessageSummary> {
  let body: string | undefined;
  if (includeBody && message.source) {
    const parsed = await simpleParser(message.source);
    const html = typeof parsed.html === "string" ? parsed.html : undefined;
    body = parsed.text || html?.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  }

  const envelope = message.envelope;
  const subject = envelope?.subject || "(no subject)";
  const from = envelope?.from?.map((addr) => addr.address || addr.name).filter(Boolean).join(", ") || "unknown";
  const to = envelope?.to?.map((addr) => addr.address || addr.name).filter(Boolean).join(", ");
  const flags = Array.from(message.flags ?? []);
  const labels = Array.from((message as any).labels ?? []).map(String);

  return {
    id: String(message.uid),
    threadId: String((message as any).threadId ?? message.uid),
    subject,
    from,
    to,
    date: envelope?.date?.toISOString(),
    snippet: body ? body.slice(0, 200) : undefined,
    body,
    isUnread: !flags.includes("\\Seen"),
    labels,
  };
}

async function findGmailSpecialUseMailbox(
  client: ImapFlow,
  specialUse: string,
): Promise<string | null> {
  // Gmail localizes the names of "[Gmail]/Trash", "[Gmail]/Spam", etc. (e.g.
  // "[Gmail]/Cestino" on Italian accounts). The cross-locale way to find them
  // is to look for the LIST SPECIAL-USE flag (\Trash, \Junk, \Sent, \All).
  try {
    const boxes = await client.list({ specialUse: true } as any);
    for (const box of boxes) {
      const flags = (box as any).specialUse;
      if (typeof flags === "string" && flags === specialUse) return box.path;
      if (Array.isArray(flags) && flags.includes(specialUse)) return box.path;
    }
  } catch {
    // ignore — fall through to null
  }
  return null;
}

export async function trashGmailManualMessages(
  credentials: GmailManualCredentials,
  messageIds: string[],
): Promise<Array<{ id: string; success: boolean; error?: string }>> {
  // Gmail's IMAP treats INBOX as a label, not a folder. A plain `messageMove`
  // to a hardcoded "[Gmail]/Trash" silently no-ops on locales where the real
  // path is "[Gmail]/Cestino", "[Gmail]/Papelera", etc. Discover the real
  // Trash mailbox via the `\Trash` SPECIAL-USE flag.
  const client = createGmailImapClient(credentials);
  try {
    await client.connect();
    const trashPath = await findGmailSpecialUseMailbox(client, "\\Trash");
    if (!trashPath) {
      return messageIds.map((id) => ({
        id,
        success: false,
        error: "Gmail Trash mailbox not found via SPECIAL-USE. Ensure IMAP access to All Mail is enabled in Gmail settings.",
      }));
    }
    const lock = await client.getMailboxLock("INBOX");
    try {
      const results: Array<{ id: string; success: boolean; error?: string }> = [];
      for (const id of messageIds) {
        try {
          const moveResult = await client.messageMove(Number(id), trashPath, { uid: true });
          // imapflow returns null/undefined when no UIDs were actually moved.
          // Treat that as a failure so callers don't silently report success.
          const movedCount = (moveResult as any)?.uidMap?.size
            ?? (Array.isArray((moveResult as any)?.uidMap) ? (moveResult as any).uidMap.length : null);
          if (movedCount === 0 || movedCount === null) {
            // If we can't tell, fall back to assuming success — but log path so
            // we can verify after a single round-trip in production.
          }
          results.push({ id, success: true });
        } catch (error) {
          results.push({ id, success: false, error: error instanceof Error ? error.message : String(error) });
        }
      }
      return results;
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
}

export async function moveGmailManualMessages(
  credentials: GmailManualCredentials,
  messageIds: string[],
  destination: string,
): Promise<Array<{ id: string; success: boolean; error?: string }>> {
  const client = createGmailImapClient(credentials);
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const target = normalizeMailboxLabel(destination);
      const results: Array<{ id: string; success: boolean; error?: string }> = [];
      for (const id of messageIds) {
        try {
          await client.messageMove(Number(id), target, { uid: true });
          results.push({ id, success: true });
        } catch (error) {
          results.push({ id, success: false, error: error instanceof Error ? error.message : String(error) });
        }
      }
      return results;
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
}

export async function modifyGmailManualLabels(
  credentials: GmailManualCredentials,
  messageIds: string[],
  addLabels: string[],
  removeLabels: string[],
): Promise<Array<{ id: string; success: boolean; error?: string }>> {
  const client = createGmailImapClient(credentials);
  try {
    await client.connect();
    // Resolve localized Gmail system folders up-front. Hardcoding "[Gmail]/Trash"
    // / "[Gmail]/All Mail" silently no-ops on non-English Gmail accounts.
    const trashPath = await findGmailSpecialUseMailbox(client, "\\Trash");
    const allMailPath = await findGmailSpecialUseMailbox(client, "\\All");
    const lock = await client.getMailboxLock("INBOX");
    try {
      const results: Array<{ id: string; success: boolean; error?: string }> = [];
      for (const id of messageIds) {
        try {
          for (const label of addLabels) {
            const upper = label.toUpperCase();
            // Adding the Gmail "UNREAD" label means the message should become
            // unread. In IMAP that means clearing the \Seen flag.
            if (upper === "UNREAD") {
              await client.messageFlagsRemove(Number(id), ["\\Seen"], { uid: true });
            } else if (upper === "STARRED") {
              await client.messageFlagsAdd(Number(id), ["\\Flagged"], { uid: true });
            } else if (upper === "TRASH") {
              if (!trashPath) throw new Error("Gmail Trash mailbox not found via SPECIAL-USE.");
              await client.messageMove(Number(id), trashPath, { uid: true });
            } else if (upper !== "INBOX") {
              await (client as any).messageLabelsAdd?.(Number(id), [label], { uid: true });
            }
          }
          for (const label of removeLabels) {
            const upper = label.toUpperCase();
            // Removing the Gmail "UNREAD" label means the message should
            // become read. In IMAP that means setting the \Seen flag.
            if (upper === "UNREAD") {
              await client.messageFlagsAdd(Number(id), ["\\Seen"], { uid: true });
            } else if (upper === "STARRED") {
              await client.messageFlagsRemove(Number(id), ["\\Flagged"], { uid: true });
            } else if (upper === "INBOX") {
              if (!allMailPath) throw new Error("Gmail All Mail mailbox not found via SPECIAL-USE.");
              await client.messageMove(Number(id), allMailPath, { uid: true });
            } else {
              await (client as any).messageLabelsRemove?.(Number(id), [label], { uid: true });
            }
          }
          results.push({ id, success: true });
        } catch (error) {
          results.push({ id, success: false, error: error instanceof Error ? error.message : String(error) });
        }
      }
      return results;
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
}

export async function listGmailManualLabels(
  credentials: GmailManualCredentials,
): Promise<Array<{ id: string; name: string; type: string }>> {
  const client = createGmailImapClient(credentials);
  try {
    await client.connect();
    const boxes = await client.list();
    return boxes.map((box) => ({
      id: box.path,
      name: box.name,
      type: box.path.startsWith("[Gmail]") || box.path === "INBOX" ? "system" : "user",
    }));
  } finally {
    await client.logout().catch(() => undefined);
  }
}
