import { createHash } from "node:crypto";
import { BRIDGE_TOOLS } from "./protocol.ts";
import { readFile } from "node:fs/promises";
import type {
  CodexInputModality,
  CodexInputPart,
  CodexTransportCapabilities,
} from "./codex_transport.ts";
import {
  nativeSessionContext,
  speakerText,
  type NativeSessionContext,
} from "./codex_context_projection.ts";
import {
  LocalRuntimeTurnPacketSchema,
  type LocalRuntimeTurnPacket,
  type RuntimeContentPart,
  type RuntimeInputModality,
} from "./protocol.ts";

export type ResolvedRuntimePart =
  | { source: "local"; path: string; sha256: string }
  | { source: "remote"; url: string; sha256: string };

export interface RuntimePartResolver {
  resolve(part: Exclude<RuntimeContentPart, { type: "text" }>): Promise<ResolvedRuntimePart>;
}

export type TranslatedCodexTurn = {
  packet: LocalRuntimeTurnPacket;
  input: CodexInputPart[];
  modalities: RuntimeInputModality[];
  fidelity: "app_server_native_context";
  sessionContext: NativeSessionContext;
};

export class PacketTranslationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly partId: string | null = null,
  ) {
    super(message);
    this.name = "PacketTranslationError";
  }
}

export async function translateRuntimeTurnPacket(
  value: unknown,
  capabilities: CodexTransportCapabilities,
  resolver?: RuntimePartResolver,
): Promise<TranslatedCodexTurn> {
  const parsed = LocalRuntimeTurnPacketSchema.parse(value);
  if (parsed.placement.placement !== "local" || parsed.personaId === null) {
    throw new PacketTranslationError(
      "invalid_local_packet",
      "Runtime Host turns require local placement and a Persona",
    );
  }
  const packet: LocalRuntimeTurnPacket = {
    ...parsed,
    personaId: parsed.personaId,
    placement: parsed.placement,
  };
  rejectUnboundCapabilities(packet);
  if (packet.capabilities.webSearch && !capabilities.operations.includes("web_search")) {
    throw new PacketTranslationError("native_web_search_unavailable", "This Codex transport does not bind native web search");
  }
  const parts = packet.messages.flatMap((message) => message.content);
  const modalities = [...new Set(parts.map((part) => part.type))];
  preflightModalities(parts, capabilities, resolver);

  const source = packet.messages.find((message) => message.messageId === packet.sourceMessageId);
  if (source === undefined || source.role !== "user") {
    throw new PacketTranslationError(
      "invalid_source_message",
      "App Server projection requires the source message to have user role",
    );
  }
  const prior = packet.messages.filter((message) => message.messageId !== source.messageId);
  const input = source.content
    .filter((part): part is Extract<RuntimeContentPart, { type: "text" }> => part.type === "text")
    .map((part) => ({
      type: "text" as const,
      text: speakerText(source.name, source.participantId, part.text),
    }));
  if (input.length === 0 && (source.name !== null || source.participantId !== null)) {
    input.push({ type: "text", text: speakerText(source.name, source.participantId, "") });
  }
  await appendResolvedAttachments(input, source.content, resolver, capabilities);
  const sessionContext = nativeSessionContext(packet, prior);
  for (let index = 0; index < prior.length; index += 1) {
    for (const part of prior[index]!.content) {
      if (part.type === "text") continue;
      if (part.type !== "image") throw new PacketTranslationError("unsupported_prior_attachment", `Prior ${part.type} is unsupported`, part.partId);
      const resolved = await requireResolver(resolver).resolve(part);
      if (resolved.sha256 !== part.fetch.sha256) throw new PacketTranslationError("attachment_hash_mismatch", "Prior image integrity mismatch", part.partId);
      const imageUrl = resolved.source === "remote" ? resolved.url
        : `data:${part.mimeType};base64,${(await readFile(resolved.path)).toString("base64")}`;
      const item = sessionContext.injectedHistory![index] as { content: unknown[] };
      item.content.push({ type: "input_image", image_url: imageUrl });
    }
  }
  return { packet, input, modalities, fidelity: "app_server_native_context", sessionContext };
}

async function appendResolvedAttachments(
  input: CodexInputPart[],
  parts: readonly RuntimeContentPart[],
  resolver: RuntimePartResolver | undefined,
  capabilities: Pick<CodexTransportCapabilities, "inputModalities"> & { transport: string },
): Promise<void> {
  for (const part of parts) {
    if (part.type === "text") continue;
    const resolved = await requireResolver(resolver).resolve(part);
    if (resolved.sha256 !== part.fetch.sha256) {
      throw new PacketTranslationError(
        "attachment_hash_mismatch",
        `Resolved ${part.type} does not match its canonical SHA-256`,
        part.partId,
      );
    }
    const attachment = toCodexAttachment(part, resolved);
    if (!capabilities.inputModalities.includes(attachment.type)) {
      throw new PacketTranslationError(
        "unsupported_resolved_attachment_source",
        `${capabilities.transport} cannot consume resolved ${attachment.type}`,
        part.partId,
      );
    }
    input.push(attachment);
  }
}

function preflightModalities(
  parts: readonly RuntimeContentPart[],
  capabilities: Pick<CodexTransportCapabilities, "inputModalities"> & { transport: string },
  resolver: RuntimePartResolver | undefined,
): void {
  for (const part of parts) {
    if (part.type === "text") continue;
    if (resolver === undefined) {
      throw new PacketTranslationError(
        "attachment_resolver_unavailable",
        `No authorized resolver is available for ${part.type}`,
        part.partId,
      );
    }
    preflightRuntimePartModalities([part], capabilities);
  }
}

export function preflightRuntimePartModalities(
  parts: readonly RuntimeContentPart[],
  capabilities: Pick<CodexTransportCapabilities, "inputModalities"> & { transport: string },
): void {
  for (const part of parts) {
    if (part.type === "text") continue;
    const candidates = modalityCandidates(part.type);
    if (candidates.some((candidate) => capabilities.inputModalities.includes(candidate))) continue;
    throw new PacketTranslationError(
      "unsupported_input_modality",
      `${capabilities.transport} cannot consume canonical ${part.type}`,
      part.partId,
    );
  }
}

function modalityCandidates(type: RuntimeInputModality): CodexInputModality[] {
  switch (type) {
    case "text": return ["text"];
    case "image": return ["local_image", "remote_image"];
    case "audio": return ["local_audio", "remote_audio"];
    case "video": return ["video"];
    case "document":
    case "file":
    case "tool_evidence": return ["document"];
  }
}

function toCodexAttachment(
  part: Exclude<RuntimeContentPart, { type: "text" }>,
  resolved: ResolvedRuntimePart,
): CodexInputPart {
  if (part.type === "image") {
    return resolved.source === "local"
      ? { type: "local_image", path: resolved.path }
      : { type: "remote_image", url: resolved.url };
  }
  if (part.type === "audio") {
    return resolved.source === "local"
      ? { type: "local_audio", path: resolved.path }
      : { type: "remote_audio", url: resolved.url };
  }
  throw new PacketTranslationError(
    "unsupported_input_modality",
    `Codex translation for canonical ${part.type} is not implemented`,
    part.partId,
  );
}

export function rejectUnboundCapabilities(packet: LocalRuntimeTurnPacket): void {
  const requested = [
    ...packet.capabilities.nanthaiTools.filter((item) => !BRIDGE_TOOLS.some((tool) => tool.name === item.id && item.version === "1"
      && item.effect === (tool.name === "nanthai_read_context" ? "read" : "write")
      && item.inputSchemaHash === createHash("sha256").update(JSON.stringify(tool.inputSchema)).digest("hex"))).map((item) => `tool:${item.id}`),
    ...packet.capabilities.skills.map((item) => `skill:${item.id}`),
    ...packet.capabilities.integrations.map((item) => `integration:${item.id}`),
  ];
  if (requested.length > 0) {
    throw new PacketTranslationError(
      "canonical_capability_binding_unimplemented",
      `Runtime Host has no capability binding for ${requested.join(", ")}`,
    );
  }
}

function requireResolver(resolver: RuntimePartResolver | undefined): RuntimePartResolver {
  if (resolver === undefined) {
    throw new PacketTranslationError(
      "attachment_resolver_unavailable",
      "No authorized attachment resolver is available",
    );
  }
  return resolver;
}
