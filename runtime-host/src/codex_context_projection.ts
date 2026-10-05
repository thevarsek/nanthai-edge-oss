import type { StartCodexSessionInput } from "./codex_transport.ts";
import type {
  LocalRuntimeTurnPacket,
  RuntimeContentPart,
} from "./protocol.ts";

export type NativeSessionContext = Pick<
  StartCodexSessionInput,
  "baseInstructions" | "developerInstructions" | "injectedHistory" | "webSearch"
>;

export function nativeSessionContext(
  packet: LocalRuntimeTurnPacket,
  prior: LocalRuntimeTurnPacket["messages"],
): NativeSessionContext {
  // baseInstructions replaces Codex's model-specific agent prompt. Add canonical
  // context alongside it, preserving the user's native harness configuration.
  const developerInstructions = joinInstructions([
    ...packet.instructions.system,
    ...packet.instructions.persona,
  ]);
  return {
    ...(packet.capabilities.webSearch === undefined ? {} : { webSearch: packet.capabilities.webSearch }),
    ...(developerInstructions === undefined ? {} : { developerInstructions }),
    injectedHistory: prior.map(historyItem),
  };
}

export function speakerText(
  name: string | null,
  participantId: string | null,
  text: string,
): string {
  if (name === null && participantId === null) return text;
  const label = [
    name === null ? null : `name=${JSON.stringify(name)}`,
    participantId === null ? null : `participantId=${JSON.stringify(participantId)}`,
  ].filter((value): value is string => value !== null).join(" ");
  return `[NanthAI speaker ${label}]${text.length === 0 ? "" : `\n${text}`}`;
}

function historyItem(message: LocalRuntimeTurnPacket["messages"][number]) {
  const text = message.content
    .filter((part): part is Extract<RuntimeContentPart, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n");
  const labelled = speakerText(message.name, message.participantId, text);
  if (message.role === "assistant") {
    return {
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: labelled, annotations: [] }],
    };
  }
  const role = message.role === "user" ? "user" : "developer";
  const prefix = message.role === "tool" ? "[NanthAI tool evidence]\n" : "";
  return {
    type: "message",
    role,
    content: [{ type: "input_text", text: `${prefix}${labelled}` }],
  };
}

function joinInstructions(
  instructions: LocalRuntimeTurnPacket["instructions"]["system"],
): string | undefined {
  if (instructions.length === 0) return undefined;
  return instructions.map((item) => `## ${item.name}\n${item.text}`).join("\n\n");
}
