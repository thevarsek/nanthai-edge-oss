import type { OpenRouterMessage, ContentPart } from "../lib/openrouter";
import {
  extractLoadedSkillsFromConversation,
  type LoadedSkillState,
} from "../tools/progressive_registry_shared";

const LOADED_SKILLS_SYSTEM_MARKER = "<loaded_skills_prompt>";
const LOADED_SKILLS_SYSTEM_CLOSER = "</loaded_skills_prompt>";
const LOADED_SKILL_TAG_REGEX = /<loaded_skill\b([^>]*)>\n?([\s\S]*?)\n?<\/loaded_skill>/g;
// This parser only needs to handle the attributes emitted by
// buildLoadedSkillsSystemMessage below. If another producer starts emitting
// synthesized skill blocks with richer attribute syntax, replace this with a
// structured format instead of extending the regex.
const ATTRIBUTE_REGEX = /(\w+)="([^"]*)"/g;

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function textContent(message: OpenRouterMessage): string {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

function isLoadedSkillsSystemMessage(message: OpenRouterMessage): boolean {
  return message.role === "system" && textContent(message).includes(LOADED_SKILLS_SYSTEM_MARKER);
}

function hasMeaningfulContent(content: OpenRouterMessage["content"]): boolean {
  if (content == null) return false;
  if (typeof content === "string") return content.trim().length > 0;
  if (!Array.isArray(content)) return false;

  return content.some((part) => {
    if (part.type !== "text") return true;
    return typeof part.text === "string" && part.text.trim().length > 0;
  });
}

function unescapeAttribute(value: string): string {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function extractLoadedSkillsFromSynthesizedBlock(
  messages: OpenRouterMessage[],
): LoadedSkillState[] {
  const block = messages.find(isLoadedSkillsSystemMessage);
  if (!block) return [];

  const content = textContent(block);
  const loadedSkills: LoadedSkillState[] = [];
  for (const match of content.matchAll(LOADED_SKILL_TAG_REGEX)) {
    const attrs = match[1] ?? "";
    const instructions = (match[2] ?? "").trim();
    if (!instructions) continue;

    const parsedAttrs = new Map<string, string>();
    for (const attrMatch of attrs.matchAll(ATTRIBUTE_REGEX)) {
      parsedAttrs.set(attrMatch[1], unescapeAttribute(attrMatch[2]));
    }

    const skill = parsedAttrs.get("name");
    if (!skill) continue;
    loadedSkills.push({
      skill,
      name: parsedAttrs.get("display_name"),
      runtimeMode: parsedAttrs.get("runtime_mode"),
      instructions,
      requiredToolProfiles: [],
      requiredToolIds: [],
      requiredIntegrationIds: [],
      requiredCapabilities: [],
    });
  }

  return loadedSkills;
}

function stripLoadSkillMessages(messages: OpenRouterMessage[]): OpenRouterMessage[] {
  const loadSkillCallIds = new Set<string>();

  for (const message of messages) {
    if (message.role !== "assistant" || !message.tool_calls) continue;
    for (const toolCall of message.tool_calls) {
      if (toolCall.function.name === "load_skill") {
        loadSkillCallIds.add(toolCall.id);
      }
    }
  }

  const cleaned: OpenRouterMessage[] = [];
  for (const message of messages) {
    if (isLoadedSkillsSystemMessage(message)) continue;

    if (
      message.role === "tool" &&
      message.tool_call_id &&
      loadSkillCallIds.has(message.tool_call_id)
    ) {
      continue;
    }

    if (message.role === "assistant" && message.tool_calls?.length) {
      // Strip only the load_skill calls from mixed assistant turns so any
      // sibling tool calls survive with their original ids and results.
      const remainingToolCalls = message.tool_calls.filter(
        (toolCall) => !loadSkillCallIds.has(toolCall.id),
      );
      if (remainingToolCalls.length === 0 && !hasMeaningfulContent(message.content)) {
        continue;
      }
      cleaned.push({
        ...message,
        tool_calls: remainingToolCalls.length > 0 ? remainingToolCalls : undefined,
      });
      continue;
    }

    cleaned.push(message);
  }

  return cleaned;
}

export function buildLoadedSkillsSystemMessage(
  loadedSkills: LoadedSkillState[],
): OpenRouterMessage | null {
  if (loadedSkills.length === 0) return null;

  const parts: ContentPart[] = [
    {
      type: "text",
      text:
        `${LOADED_SKILLS_SYSTEM_MARKER}\n` +
        "The following skill instructions are already loaded for this conversation.\n" +
        "Use them directly. Do not call load_skill again for these skills unless the user asks to refresh or replace them.\n\n",
      // Keep the single explicit breakpoint on a stable prefix so adding new
      // skills extends the cached block instead of moving the breakpoint.
      cache_control: { type: "ephemeral" },
    },
  ];

  for (const skill of loadedSkills) {
    parts.push({
      type: "text",
      text: [
        `<loaded_skill name="${escapeAttribute(skill.skill)}"`,
        skill.name ? ` display_name="${escapeAttribute(skill.name)}"` : "",
        skill.runtimeMode
          ? ` runtime_mode="${escapeAttribute(skill.runtimeMode)}"`
          : "",
        ">\n",
        `${skill.instructions}\n`,
        "</loaded_skill>\n\n",
      ].join(""),
    });
  }
  parts.push({
    type: "text",
    text: `${LOADED_SKILLS_SYSTEM_CLOSER}\n`,
  });

  return {
    role: "system",
    content: parts,
  };
}

export function normalizeMessagesForLoadedSkills(
  messages: OpenRouterMessage[],
  loadedSkills: LoadedSkillState[],
): OpenRouterMessage[] {
  const effectiveLoadedSkills = loadedSkills.length > 0
    ? loadedSkills
    : extractLoadedSkillsFromConversation(messages);
  const recoveredLoadedSkills = effectiveLoadedSkills.length > 0
    ? effectiveLoadedSkills
    : extractLoadedSkillsFromSynthesizedBlock(messages);
  if (recoveredLoadedSkills.length === 0 && messages.some(isLoadedSkillsSystemMessage)) {
    console.warn(
      "[loadedSkills] normalizeMessagesForLoadedSkills received a synthesized loaded-skills block without recoverable loadedSkills state; stripping synthesized blocks and raw load_skill transcript",
    );
    return stripLoadSkillMessages(messages);
  }

  const cleaned = stripLoadSkillMessages(messages);
  const loadedSkillsMessage = buildLoadedSkillsSystemMessage(recoveredLoadedSkills);
  if (!loadedSkillsMessage) return cleaned;

  const firstSystemIndex = cleaned.findIndex((message) => message.role === "system");
  if (firstSystemIndex === -1) {
    return [loadedSkillsMessage, ...cleaned];
  }

  const insertionIndex = firstSystemIndex + 1;
  return [
    ...cleaned.slice(0, insertionIndex),
    loadedSkillsMessage,
    ...cleaned.slice(insertionIndex),
  ];
}
