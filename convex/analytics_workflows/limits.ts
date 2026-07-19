export const PYODIDE_ACTION_TIMEOUT_MS = 2 * 60 * 1_000;
export const SANDBOX_ACTION_TIMEOUT_MS = 8 * 60 * 1_000;
export const ANALYTICS_STDOUT_MAX_CHARS = 64_000;
export const ANALYTICS_STDERR_MAX_CHARS = 16_000;
export const ANALYTICS_ERROR_MAX_CHARS = 4_000;
export const ANALYTICS_WARNING_MAX_COUNT = 20;
export const ANALYTICS_WARNING_MAX_CHARS = 2_000;
export const ANALYTICS_IMPORTED_FILE_MAX_COUNT = 20;
export const ANALYTICS_IMPORTED_FILE_MAX_CHARS = 2_000;
export const ANALYTICS_ARTIFACT_MAX_BYTES = 5 * 1024 * 1024;
export const ANALYTICS_ARTIFACT_TOTAL_MAX_BYTES = 12 * 1024 * 1024;
export const ANALYTICS_PARENT_RESULT_MAX_BYTES = 192_000;

export function boundedAnalyticsTimeout(
  toolName: "data_python_exec" | "data_python_sandbox",
  requested: number | undefined,
): number | undefined {
  if (requested === undefined) return undefined;
  const maximum = toolName === "data_python_exec"
    ? PYODIDE_ACTION_TIMEOUT_MS
    : SANDBOX_ACTION_TIMEOUT_MS;
  return Math.max(1, Math.min(Math.floor(requested), maximum));
}
