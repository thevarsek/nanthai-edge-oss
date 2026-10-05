import { z } from "zod";
import type { LocalRuntimeTurnPacket } from "./protocol_packet";

const ReceiptSchema = z.object({
  version: z.literal(1),
  policyHash: z.string(),
  entries: z.array(z.object({ id: z.string(), hash: z.string() })).max(512),
});
export type ContextReceipt = z.infer<typeof ReceiptSchema>;

export async function contextDigest(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function packetContextReceipt(packet: LocalRuntimeTurnPacket, policyVersion: unknown): Promise<ContextReceipt> {
  return {
    version: 1,
    policyHash: await contextDigest({
      policyVersion,
      assembler: packet.context.assemblerVersion,
      // Source inventories grow with each turn; prior source text remains fenced
      // by message hashes and the actual memory/tool context instructions.
      instructions: [
        packet.instructions.system.filter(item => item.instructionId !== "sources"),
        packet.instructions.persona,
      ].map(items => items.map(item => item.text)),
      capabilities: packet.capabilities,
    }),
    entries: await Promise.all(packet.messages.map(async (message) => ({
      id: message.messageId,
      hash: await contextDigest(message.content.map((part) => part.type === "text"
        ? { type: "text", text: part.text.trim() }
        : { type: part.type, sha256: part.fetch.sha256 })),
    }))),
  };
}

export function readContextReceipt(value: string | undefined): ContextReceipt | null {
  try { return ReceiptSchema.parse(JSON.parse(value ?? "null")); } catch { return null; }
}

export function reusableContext(previous: ContextReceipt | null, current: ContextReceipt): boolean {
  if (!previous || previous.policyHash !== current.policyHash) return false;
  // ponytail: at most 512 entries; keep the ordered scan until that packet limit changes.
  // A removal, edit, reordering, or budget omission cannot erase native history.
  let lastIndex = -1;
  for (const entry of previous.entries) {
    const index = current.entries.findIndex((candidate) => candidate.id === entry.id && candidate.hash === entry.hash);
    if (index <= lastIndex) return false;
    lastIndex = index;
  }
  return true;
}

export async function receiptWithAssistant(value: string | undefined, messageId: string, text: string): Promise<string | undefined> {
  const receipt = readContextReceipt(value);
  if (!receipt) return undefined;
  receipt.entries.push({ id: messageId, hash: await contextDigest([{ type: "text", text: text.trim() }]) });
  return JSON.stringify(receipt);
}
