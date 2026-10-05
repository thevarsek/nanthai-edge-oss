import { v, ConvexError } from "convex/values";
import { StructuredInputSchema, type StructuredInput } from "./protocol_common";

export const runtimeInputForm = v.object({
  source: v.string(), url: v.optional(v.string()),
  fields: v.array(v.object({ id: v.string(), label: v.string(), type: v.string(), required: v.boolean(), secret: v.boolean(), options: v.array(v.string()) })),
});
export type RuntimeInputForm = {
  source: string; url?: string;
  fields: Array<{ id: string; label: string; type: string; required: boolean; secret: boolean; options: string[] }>;
};
function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function projectRuntimeInputForm(raw: string): RuntimeInputForm {
  const input = record(JSON.parse(raw));
  const schema = record(input.requestSchema);
  const questions = Array.isArray(schema.questions) ? schema.questions : [];
  if (input.source === "request_user_input") return {
    source: "request_user_input", fields: questions.map(record).map(question => ({
      id: String(question.id), label: String(question.question ?? question.header ?? question.id), type: "string", required: true, secret: question.isSecret === true,
      options: Array.isArray(question.options) ? question.options.map(record).map(option => String(option.label)) : [],
    })),
  };
  const requestedSchema = record(schema.requestedSchema);
  const properties = record(requestedSchema.properties);
  return {
    source: String(input.source),
    ...(typeof schema.url === "string" ? { url: schema.url } : {}),
    fields: Object.entries(properties).map(([id, value]) => {
      const field = record(value);
      return { id, label: String(field.title ?? field.description ?? id), type: String(field.type ?? "string"),
        required: Array.isArray(requestedSchema.required) && requestedSchema.required.includes(id),
        secret: field.format === "password" || (Array.isArray(input.sensitiveFieldPaths) && input.sensitiveFieldPaths.includes(id)),
        options: Array.isArray(field.enum) ? field.enum.filter((item): item is string => typeof item === "string") : [] };
    }),
  };
}
export function validateRuntimeInput(raw: string, value: unknown): StructuredInput {
  const content = StructuredInputSchema.parse(value);
  const form = projectRuntimeInputForm(raw);
  const answers = form.source === "request_user_input" ? record(content.answers ?? content) : content;
  for (const field of form.fields) {
    const value = answers[field.id];
    if (value === undefined && !field.required) continue;
    if (field.type === "boolean" ? typeof value !== "boolean"
      : field.type === "number" || field.type === "integer" ? typeof value !== "number" || !Number.isFinite(value) || (field.type === "integer" && !Number.isInteger(value))
      : typeof value !== "string" || (field.required && !value.trim())) {
      throw new ConvexError({ code: "VALIDATION_ERROR", message: `Enter a valid value for ${field.label}` });
    }
    // Codex offers custom text alongside its suggestions; MCP enums are constraints.
    if (form.source !== "request_user_input" && field.options.length && !field.options.includes(String(value))) throw new ConvexError({ code: "VALIDATION_ERROR", message: `Choose a value for ${field.label}` });
  }
  return content;
}
