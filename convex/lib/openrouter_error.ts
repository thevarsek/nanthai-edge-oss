export function extractErrorMessage(data: unknown): string {
  if (typeof data === "string") {
    try {
      const parsed = JSON.parse(data);
      return extractErrorMessage(parsed);
    } catch {
      return data || "Unknown OpenRouter error.";
    }
  }

  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;

    // Standard: { error: { message: "..." } }
    if (obj.error && typeof obj.error === "object") {
      const err = obj.error as Record<string, unknown>;
      const parts: string[] = [];

      if (typeof err.message === "string") parts.push(err.message);

      // Extract context from metadata
      if (err.metadata && typeof err.metadata === "object") {
        const meta = err.metadata as Record<string, unknown>;
        const context: string[] = [];
        if (meta.provider_name) context.push(`provider: ${meta.provider_name}`);
        if (meta.provider) context.push(`provider: ${meta.provider}`);
        if (meta.code) context.push(`code: ${meta.code}`);
        if (meta.type) context.push(`type: ${meta.type}`);
        if (context.length > 0) parts.push(`(${context.join("; ")})`);

        if (typeof meta.raw === "string") {
          const nestedRaw = extractErrorMessage(meta.raw);
          if (
            nestedRaw &&
            nestedRaw !== "Unknown OpenRouter error." &&
            !parts.includes(nestedRaw)
          ) {
            parts.push(nestedRaw);
          }
        }
      }

      if (parts.length > 0) return parts.join(" ");
    }

    // Simple: { error: "string" }
    if (typeof obj.error === "string") return obj.error;

    // Message at root
    if (typeof obj.message === "string") return obj.message;
  }

  return "Unknown OpenRouter error.";
}
