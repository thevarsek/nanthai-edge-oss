import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { MAX_PRESENTATION_SLIDES, MAX_PROMPT_CHARS } from "../presentations/limits";
import type { ToolExecutionContext } from "./registry";

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizedForDedupe(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function isContainedIn(value: string, container: string | undefined): boolean {
  if (!container) return false;
  const normalized = normalizedForDedupe(value);
  return normalized.length > 0 && normalizedForDedupe(container).includes(normalized);
}

async function triggeringUserContent(
  toolCtx: ToolExecutionContext,
): Promise<string | undefined> {
  if (!toolCtx.userMessageId) return undefined;
  const message = await toolCtx.ctx.runQuery(internal.chat.queries.getMessageInternal, {
    messageId: toolCtx.userMessageId as Id<"messages">,
  });
  if (
    !message ||
    message.role !== "user" ||
    message.chatId !== toolCtx.chatId ||
    typeof message.content !== "string"
  ) return undefined;
  return optionalText(message.content);
}

export async function buildResolvedPresentationBrief(
  toolCtx: ToolExecutionContext,
  args: Record<string, unknown>,
  brief: string,
  audience: string,
  tone: string,
): Promise<string> {
  const triggeringSource = await triggeringUserContent(toolCtx);
  const lines = [
    `Audience: ${audience}`,
    `Tone and technicality: ${tone}`,
  ];
  if (!isContainedIn(brief, triggeringSource)) {
    lines.unshift(`Creative brief: ${brief}`);
  }
  const objective = optionalText(args.objective);
  if (objective) lines.push(`Purpose/outcome: ${objective}`);
  if (typeof args.slideCount === "number") {
    if (!Number.isSafeInteger(args.slideCount) || args.slideCount < 1 ||
        args.slideCount > MAX_PRESENTATION_SLIDES) {
      throw new Error(`Requested slide count must be between 1 and ${MAX_PRESENTATION_SLIDES}.`);
    }
    lines.push(`Requested length: ${args.slideCount} slides.`);
  }
  if (Array.isArray(args.approvedOutline) && args.approvedOutline.length > 0) {
    lines.push(
      "User-approved outline (preserve this exact slide count, order, and topic intent): " +
        JSON.stringify(args.approvedOutline),
    );
  }
  const referenceNotes = optionalText(args.referenceNotes);
  if (referenceNotes) lines.push(`Reference/example guidance: ${referenceNotes}`);
  if (Array.isArray(args.assetStorageIds) && args.assetStorageIds.length > 0) {
    lines.push(`User-provided reusable asset storage IDs: ${args.assetStorageIds.join(", ")}`);
  }

  const suppliedSource = optionalText(args.sourceContent);
  const earlierTurnSource = suppliedSource && !isContainedIn(suppliedSource, triggeringSource)
    ? suppliedSource
    : undefined;
  const sourceParts = [triggeringSource, earlierTurnSource]
    .filter((value): value is string => Boolean(value))
    .filter((value, index, values) =>
      !values.some((other, otherIndex) => otherIndex < index && other.includes(value))
    );
  const base = lines.join("\n");
  if (sourceParts.length === 0) return base;
  const prefix = "\nSource material from the user (preserve its facts and labels):\n";
  const available = Math.max(0, MAX_PROMPT_CHARS - base.length - prefix.length);
  return `${base}${prefix}${sourceParts.join("\n\n").slice(0, available)}`;
}
