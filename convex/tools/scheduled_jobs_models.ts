/** Normalize a model identifier authored by a tool-calling model. */
export function normalizeScheduledJobToolModelId(
  value: unknown,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

/**
 * Conversational scheduling inherits the invoking turn's model unless the
 * tool call carries a user-requested override.
 */
export function resolveScheduledJobToolModelId(
  requestedModelId: unknown,
  invokingModelId: unknown,
  userDefaultModelId?: unknown,
): string | undefined {
  return normalizeScheduledJobToolModelId(requestedModelId)
    ?? normalizeScheduledJobToolModelId(invokingModelId)
    ?? normalizeScheduledJobToolModelId(userDefaultModelId);
}
