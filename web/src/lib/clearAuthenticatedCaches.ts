// Cache Storage names that hold responses fetched on behalf of a signed-in
// user (see `runtimeCaching` in vite.config.ts).
export const AUTHENTICATED_CACHE_NAMES = ["convex-api"] as const;

/** Deletes caches that may hold a signed-in user's files. Safe to call when Cache Storage is unavailable. */
export async function clearAuthenticatedCaches(
  cacheStorage: Pick<CacheStorage, "delete"> | undefined = typeof caches === "undefined" ? undefined : caches,
): Promise<void> {
  if (!cacheStorage) return;
  await Promise.allSettled(AUTHENTICATED_CACHE_NAMES.map((name) => cacheStorage.delete(name)));
}
