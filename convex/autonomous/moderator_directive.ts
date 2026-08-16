const MAX_DIRECTIVE_WORDS = 35;
const MAX_DIRECTIVE_CHARACTERS = 280;
const MIN_DIRECTIVE_WORDS = 4;
const MIN_DIRECTIVE_CHARACTERS = 16;

export function fallbackModeratorDirective(): string {
  return "Address the strongest unresolved point so far. Take a clear position, add one concrete tradeoff, and avoid repeating earlier arguments.";
}

function unfenceJson(content: string): string {
  const trimmed = content.trim();
  return trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
    : trimmed;
}

function directiveFromResponse(content: string): string | undefined {
  const unfenced = unfenceJson(content);
  if (!unfenced) return undefined;
  try {
    const parsed: unknown = JSON.parse(unfenced);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    const directive = (parsed as Record<string, unknown>).directive;
    return typeof directive === "string" ? directive.trim() : undefined;
  } catch {
    return /^[{[]/u.test(unfenced) ? undefined : unfenced;
  }
}

export function normalizeModeratorDirective(
  content: string | undefined,
  finishReason?: string | null,
): string | undefined {
  if (!content || finishReason === "length") return undefined;
  const directive = directiveFromResponse(content)?.trim();
  if (!directive) return undefined;

  const words = directive.split(/\s+/u).filter(Boolean);
  if (
    directive.length < MIN_DIRECTIVE_CHARACTERS ||
    directive.length > MAX_DIRECTIVE_CHARACTERS ||
    words.length < MIN_DIRECTIVE_WORDS ||
    words.length > MAX_DIRECTIVE_WORDS ||
    !/\p{L}/u.test(directive) ||
    /^[:/<>]/u.test(directive) ||
    /^(?:user|assistant|system|model)\b/iu.test(directive)
  ) {
    return undefined;
  }
  return directive;
}

export const moderatorDirectiveResponseFormat = {
  type: "json_schema" as const,
  json_schema: {
    name: "nanthai_autonomous_moderator_directive",
    strict: true,
    schema: {
      type: "object",
      properties: {
        directive: { type: "string" },
      },
      required: ["directive"],
      additionalProperties: false,
    },
  },
};
