/** The generic Persona fallback; a nonempty custom prompt is kept verbatim. */
export const DEFAULT_PERSONA_SYSTEM_PROMPT = "You are a helpful assistant. Answer clearly and accurately, and ask for clarification when needed.";

export function personaSystemPrompt(prompt: string | null | undefined): string {
  return prompt?.trim() ? prompt : DEFAULT_PERSONA_SYSTEM_PROMPT;
}
