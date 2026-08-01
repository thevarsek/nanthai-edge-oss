const encodedObjectMarker = "objectEntriesV1";
const encodedObjectKeys = new Set(["mcpJsonEncoding", "mcpJsonEntries"]);

function isConvexSafeObjectKey(key: string): boolean {
  if (key.length > 1024 || key.startsWith("$") || encodedObjectKeys.has(key)) return false;
  for (let index = 0; index < key.length; index += 1) {
    const code = key.charCodeAt(index);
    if (code < 32 || code >= 127) return false;
  }
  return true;
}

function encodeMcpJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(encodeMcpJson);
  if (value === null || typeof value !== "object") return value;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.every(([key]) => isConvexSafeObjectKey(key))) {
    return Object.fromEntries(entries.map(([key, entry]) => [key, encodeMcpJson(entry)]));
  }
  return {
    mcpJsonEncoding: encodedObjectMarker,
    mcpJsonEntries: entries.map(([key, entry]) => ({ key, value: encodeMcpJson(entry) })),
  };
}

export function jsonForMcpStorage(value: unknown): unknown {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return undefined;
  return encodeMcpJson(JSON.parse(serialized) as unknown);
}

export function mcpJsonFromStorage(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(mcpJsonFromStorage);
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if (record.mcpJsonEncoding === encodedObjectMarker && Array.isArray(record.mcpJsonEntries)) {
    return Object.fromEntries(record.mcpJsonEntries.map((entry) => {
      const pair = entry as { key: string; value: unknown };
      return [pair.key, mcpJsonFromStorage(pair.value)];
    }));
  }
  return Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, mcpJsonFromStorage(entry)]));
}
