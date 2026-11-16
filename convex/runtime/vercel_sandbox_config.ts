// convex/runtime/vercel_sandbox_config.ts
// =============================================================================
// Vercel Sandbox configuration checks.
//
// Kept free of the @vercel/sandbox SDK so tool entry points can fail closed
// before queueing work. Model-supplied code only ever runs inside the isolated
// sandbox; there is no in-process fallback when it is not configured.
// =============================================================================

export const VERCEL_SANDBOX_ENV_KEYS = [
  "VERCEL_SANDBOX_TOKEN",
  "VERCEL_SANDBOX_PROJECT_ID",
  "VERCEL_SANDBOX_TEAM_ID",
] as const;

export const PYTHON_SANDBOX_UNAVAILABLE_ERROR =
  "Python execution is unavailable: the isolated Python sandbox is not configured for this deployment.";

export function missingVercelSandboxEnv(
  env: Record<string, string | undefined> = process.env,
): string[] {
  return VERCEL_SANDBOX_ENV_KEYS.filter((key) => !env[key]?.trim());
}

export function isVercelSandboxConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return missingVercelSandboxEnv(env).length === 0;
}
