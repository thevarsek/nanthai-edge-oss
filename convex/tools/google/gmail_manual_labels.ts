"use node";

import { ImapFlow, type CopyResponseObject } from "imapflow";
import {
  createGmailImapClient,
  findGmailSpecialUseMailbox,
  normalizeMailboxLabel,
  type GmailManualCredentials,
} from "./gmail_manual_client";

type GmailLabelClient = ImapFlow & {
  messageLabelsAdd?: (
    range: number,
    labels: string[],
    options?: { uid?: boolean },
  ) => Promise<unknown>;
  messageLabelsRemove?: (
    range: number,
    labels: string[],
    options?: { uid?: boolean },
  ) => Promise<unknown>;
};

export async function trashGmailManualMessages(
  credentials: GmailManualCredentials,
  messageIds: string[],
): Promise<Array<{ id: string; success: boolean; error?: string }>> {
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
          const moveResult = await client.messageMove(Number(id), trashPath, { uid: true }) as CopyResponseObject | false | null | undefined;
          const uidMap = moveResult ? moveResult.uidMap : undefined;
          const movedCount = typeof uidMap?.size === "number"
            ? uidMap.size
            : Array.isArray(uidMap)
              ? uidMap.length
              : null;
          if (movedCount === 0 || movedCount === null) {
            // ImapFlow does not expose a stronger portable result here.
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
    const trashPath = await findGmailSpecialUseMailbox(client, "\\Trash");
    const allMailPath = await findGmailSpecialUseMailbox(client, "\\All");
    const lock = await client.getMailboxLock("INBOX");
    try {
      const results: Array<{ id: string; success: boolean; error?: string }> = [];
      for (const id of messageIds) {
        try {
          for (const label of addLabels) {
            const upper = label.toUpperCase();
            if (upper === "UNREAD") {
              await client.messageFlagsRemove(Number(id), ["\\Seen"], { uid: true });
            } else if (upper === "STARRED") {
              await client.messageFlagsAdd(Number(id), ["\\Flagged"], { uid: true });
            } else if (upper === "TRASH") {
              if (!trashPath) throw new Error("Gmail Trash mailbox not found via SPECIAL-USE.");
              await client.messageMove(Number(id), trashPath, { uid: true });
            } else if (upper !== "INBOX") {
              await (client as GmailLabelClient).messageLabelsAdd?.(Number(id), [label], { uid: true });
            }
          }
          for (const label of removeLabels) {
            const upper = label.toUpperCase();
            if (upper === "UNREAD") {
              await client.messageFlagsAdd(Number(id), ["\\Seen"], { uid: true });
            } else if (upper === "STARRED") {
              await client.messageFlagsRemove(Number(id), ["\\Flagged"], { uid: true });
            } else if (upper === "INBOX") {
              if (!allMailPath) throw new Error("Gmail All Mail mailbox not found via SPECIAL-USE.");
              await client.messageMove(Number(id), allMailPath, { uid: true });
            } else {
              await (client as GmailLabelClient).messageLabelsRemove?.(Number(id), [label], { uid: true });
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
