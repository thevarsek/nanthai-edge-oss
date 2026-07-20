/**
 * Provider calls are not replay-safe unless the caller owns a durable
 * pre-dispatch idempotency claim. A Workflow may retry coordination around
 * them, but it must not automatically repeat an ambiguous paid side effect.
 */
export const failClosedProviderActionOptions = {
  retry: false,
} as const;
