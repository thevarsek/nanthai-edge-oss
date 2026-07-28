import { z } from "zod";
import { presentationError } from "./limits";

const MAX_MODEL_RESPONSE_CHARS = 1_400_000;

export const stableModelId = z.string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/);

export function invalidModelResponse(message: string): never {
  throw presentationError("MODEL_RESPONSE_INVALID", message);
}

export function parseModelJson(content: string): unknown {
  const trimmed = content.replace(/^\uFEFF/, "").trim();
  if (!trimmed || trimmed.length > MAX_MODEL_RESPONSE_CHARS) {
    invalidModelResponse("The AI returned an empty or oversized response.");
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced ?? (() => {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    return start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
  })();
  try {
    return JSON.parse(candidate);
  } catch {
    invalidModelResponse("The AI returned malformed JSON. Please try again.");
  }
}

export function parseModelWithSchema<T>(
  schema: z.ZodType<T>,
  content: string,
  label: string,
  normalize: (value: unknown) => unknown = (value) => value,
): T {
  const result = schema.safeParse(normalize(parseModelJson(content)));
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.join(".");
    const reason = issue?.message ? `: ${issue.message}` : "";
    invalidModelResponse(
      `The AI ${label} response did not match the required contract${path ? ` at ${path}` : ""}${reason}.`,
    );
  }
  return result.data;
}

export function assertUniqueModelIds(items: Array<{ id: string }>): void {
  const ids = new Set(items.map((item) => item.id));
  if (ids.size !== items.length) {
    invalidModelResponse("The AI returned duplicate slide IDs.");
  }
}
