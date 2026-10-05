export function runtimeThreadName(
  chatTitle: string | undefined,
  chatId: string,
): string {
  const chatLabel = chatTitle?.trim() || `Chat ${chatId.slice(-8)}`;
  return `NanthAI · ${chatLabel}`.slice(0, 512);
}
