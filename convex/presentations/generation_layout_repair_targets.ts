function collectIds(value: unknown, ids: Set<string>, depth: number): void {
  if (depth > 3 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const entry of value) collectIds(entry, ids, depth + 1);
    return;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.elementId === "string") ids.add(record.elementId);
  if (Array.isArray(record.elementIds)) {
    for (const id of record.elementIds) {
      if (typeof id === "string") ids.add(id);
    }
  }
  for (const entry of Object.values(record)) collectIds(entry, ids, depth + 1);
}

export function layoutRepairElementIds(validationDetails?: string): string[] {
  if (!validationDetails) return [];
  try {
    const ids = new Set<string>();
    collectIds(JSON.parse(validationDetails), ids, 0);
    return [...ids];
  } catch {
    return [];
  }
}
