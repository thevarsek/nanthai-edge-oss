import type { ContextMessage } from "./helpers_types";
import { branchPathIds } from "./helpers_utils";

export const CONVERSATION_CONTEXT_POLICY = "summary-tail.v1";
export const SUMMARY_CHUNK_CHARACTERS = 24_000;
function omitsTerminalContent(message: ContextMessage) {
  return message.status === "failed" || message.status === "cancelled";
}
export function eligibleConversationMessages(messages: ContextMessage[], assistantId: string, expand = true) {
  const path = branchPathIds(assistantId, new Map(messages.map(m => [String(m._id), m])));
  path.delete(assistantId);
  const groups = new Set(messages.filter(m => path.has(String(m._id))).map(m => m.multiModelGroupId).filter(Boolean));
  return messages.filter(m => path.has(String(m._id)) || (expand && m.multiModelGroupId && groups.has(m.multiModelGroupId)))
    .sort((a, b) => a.createdAt - b.createdAt);
}
export function sourceProjection(message: ContextMessage) {
  return { id: String(message._id), role: message.role, content: message.content,
    parents: message.parentMessageIds, attachments: (message.attachments ?? []).map(a => ({type:a.type,storageId:a.storageId,url:a.storageId?undefined:a.url,name:a.name,mimeType:a.mimeType})),
    imageUrls: message.imageUrls, documentEvents: message.documentEvents, presentationContext: message.presentationContext,
    toolCalls: message.toolCalls, toolResults: message.toolResults, mcpInvocationIds: message.mcpInvocationIds,
    status: message.status, participantId: message.participantId ?? message.chatParticipantId ?? null };
}
export async function conversationSourceDigest(messages: ContextMessage[]): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(messages.map(sourceProjection))));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
}
export function contextPrefixPlan(messages: ContextMessage[], previousCoverage: number, window: number, summaryText = "", maxRawMessages = Infinity) {
  // Reserve instructions, tools, retrieved context, multimodal transport and output.
  const reserve = Math.min(24_000, Math.floor(window * 0.35));
  const available = window - reserve;
  const costs = messages.map(m => omitsTerminalContent(m) ? 0 : Math.ceil((m.content.length + JSON.stringify(m.toolCalls ?? []).length + JSON.stringify(m.toolResults ?? []).length) / 3) + 32 + (m.attachments?.length ?? 0) * 2048);
  const summaryCost = Math.ceil(summaryText.length / 3) + 32;
  const total = costs.slice(previousCoverage).reduce((a, b) => a + b, summaryCost);
  if (total < available * 0.8 && messages.length - previousCoverage <= maxRawMessages) return previousCoverage;
  const resultIds = new Set(messages.filter(message => !omitsTerminalContent(message)).flatMap(message => (message.toolResults ?? []).map(result => result.toolCallId)));
  const unresolved = messages.findIndex((message, index) => index >= previousCoverage && !omitsTerminalContent(message) && message.toolCalls?.some(call => !resultIds.has(call.id)));
  const protectFrom = Math.min(Math.max(previousCoverage, messages.length - 12), unresolved < 0 ? messages.length : unresolved);
  let coverage = previousCoverage;
  let remaining = total;
  while (coverage < protectFrom && (remaining > available * 0.45 || messages.length - coverage > Math.min(maxRawMessages, 128)) && (messages[coverage].status === "completed" || omitsTerminalContent(messages[coverage]))) {
    remaining -= costs[coverage++];
  }
  if (coverage === previousCoverage) {
    if (total > available) throw new Error("The complete protected conversation context is too large. Shorten the current input or start a new branch.");
    return previousCoverage;
  }
  return coverage;
}
export function summaryChunks(messages: ContextMessage[]) {
  const chunks: Array<{ content: string; messageIds: string[] }> = [];
  let content = ""; let ids: string[] = [];
  const flush = () => { if (content) chunks.push({ content, messageIds: ids }); content = ""; ids = []; };
  for (const message of messages) {
    // Match ordinary request assembly: cancelled/failed payloads are not evidence,
    // but their canonical IDs still belong to the immutable coverage manifest.
    const source = omitsTerminalContent(message)
      ? `[${message.role.toUpperCase()} ${String(message._id)}: ${message.status}; content omitted]\n`
      : `[${message.role.toUpperCase()} ${String(message._id)}]: ${message.content}\n`
      + (message.toolCalls?.length || message.toolResults?.length ? `[Published tool calls/results: ${JSON.stringify({calls: message.toolCalls, results: message.toolResults})}]\n` : "")
      + (message.imageUrls?.length || message.documentEvents?.length || message.presentationContext ? `[Referenced artifacts; inspect canonical sources for exact media: ${JSON.stringify({images: message.imageUrls, documents: message.documentEvents, presentation: message.presentationContext})}]\n` : "")
      + (message.attachments?.length ? `[Referenced media; inspect the canonical source for exact content: ${JSON.stringify(message.attachments.map(a => ({type:a.type,storageId:a.storageId,name:a.name})))}]\n` : "");
    for (let offset = 0; offset < source.length; offset += SUMMARY_CHUNK_CHARACTERS) {
      const part = source.slice(offset, offset + SUMMARY_CHUNK_CHARACTERS);
      if (content.length + part.length > SUMMARY_CHUNK_CHARACTERS || ids.length >= 128) flush();
      content += part; if (!ids.includes(String(message._id))) ids.push(String(message._id));
    }
  }
  flush(); return chunks;
}
