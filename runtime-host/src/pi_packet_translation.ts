import { readFile } from "node:fs/promises";
import { speakerText } from "./codex_context_projection.ts";
import { LocalRuntimePartResolver } from "./local_runtime_part_resolver.ts";
import { rejectUnboundCapabilities } from "./packet_translation.ts";
import type { LocalRuntimeTurnPacket } from "./protocol.ts";

export async function translatePiPacket(packet: LocalRuntimeTurnPacket, directory?: string) {
  rejectUnboundCapabilities(packet);
  if (packet.capabilities.webSearch) throw new Error("Pi has no certified native web-search binding");
  const resolver = directory ? new LocalRuntimePartResolver(directory) : null;
  const messages: Record<string, unknown>[] = [];
  for (const message of packet.messages) {
    const content: Record<string, unknown>[] = [];
    for (const part of message.content) {
      if (part.type === "text") {
        content.push({ type: "text", text: speakerText(message.name, message.participantId, part.text) });
      } else {
        if (!resolver) throw new Error("Pi attachment resolver is unavailable");
        const local = await resolver.resolve(part);
        if (local.source !== "local") throw new Error("Pi requires materialized attachments");
        if (part.type === "image") {
          content.push({ type: "image", mimeType: part.mimeType, data: (await readFile(local.path)).toString("base64") });
        } else if (["file", "document", "tool_evidence"].includes(part.type)) {
          content.push({ type: "text", text: `[NanthAI attachment ${JSON.stringify(part.name)}]\nUse the native read tool for ${JSON.stringify(local.path)}${part.type === "document" && part.extractedText ? `\n${part.extractedText}` : ""}` });
        } else throw new Error(`Pi cannot consume canonical ${part.type}`);
      }
    }
    if (message.messageId === packet.sourceMessageId) {
      if (message.role !== "user") throw new Error("Pi source must be a user message");
    }
    messages.push(message.role === "assistant" ? {
      role: "assistant", content, timestamp: Date.now(), api: "openai-completions",
      provider: "nanthai", model: "canonical-history", stopReason: "stop",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    } : { role: "user", content, timestamp: Date.now() });
  }
  const sourceIndex = packet.messages.findIndex(message => message.messageId === packet.sourceMessageId);
  if (sourceIndex < 0) throw new Error("Pi source is missing");
  const source = messages[sourceIndex]!;
  const parts = source.content as Array<Record<string, unknown>>;
  return {
    history: messages.filter((_, index) => index !== sourceIndex),
    message: parts.filter(part => part.type === "text").map(part => String(part.text)).join("\n"),
    images: parts.filter(part => part.type === "image"),
    instructions: [...packet.instructions.system, ...packet.instructions.persona]
      .map(item => `## ${item.name}\n${item.text}`).join("\n\n"),
  };
}
