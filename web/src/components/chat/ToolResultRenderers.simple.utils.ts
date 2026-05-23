export function safeHttpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value, window.location.origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.href;
  } catch {
    return null;
  }
}
