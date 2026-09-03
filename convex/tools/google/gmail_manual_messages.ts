"use node";

import type { FetchMessageObject } from "imapflow";
import { simpleParser } from "mailparser";
import {
  createGmailImapClient,
  imapSearchFromGmailQuery,
  type GmailManualCredentials,
  type GmailMessageSummary,
} from "./gmail_manual_client";

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
      })) {
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
  const labels = Array.from(message.labels ?? []).map(String);

  return {
    id: String(message.uid),
    threadId: String(message.threadId ?? message.uid),
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
