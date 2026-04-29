export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends (...args: never[]) => unknown
    ? T[K]
    : T[K] extends readonly unknown[]
      ? T[K]
      : T[K] extends object
        ? DeepPartial<T[K]>
        : T[K];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function mergeTestDeps<T extends Record<string, unknown>>(
  defaults: T,
  overrides: DeepPartial<T> = {},
): T {
  const merged: Record<string, unknown> = { ...defaults };

  for (const [key, overrideValue] of Object.entries(overrides)) {
    if (overrideValue === undefined) continue;

    const defaultValue = merged[key];
    if (isPlainObject(defaultValue) && isPlainObject(overrideValue)) {
      merged[key] = mergeTestDeps(
        defaultValue as Record<string, unknown>,
        overrideValue as DeepPartial<Record<string, unknown>>,
      );
      continue;
    }

    merged[key] = overrideValue;
  }

  return merged as T;
}
