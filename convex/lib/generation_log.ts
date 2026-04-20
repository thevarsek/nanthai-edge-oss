/**
 * Generation telemetry logger.
 *
 * The generation pipeline emits ~15 structured `console.info` calls per
 * request for TTFT debugging (preflight timing, cache hits, first-delta
 * latency, etc.). These are invaluable on dev but noisy and contain
 * metadata (chatId, userId, messageId) we don't want emitted by default
 * in production.
 *
 * Behavior:
 *   - `ttftLog(...)` is `console.info` when `TTFT_DEBUG === "1"`, else a
 *     no-op. Set `TTFT_DEBUG=1` via `npx convex env set TTFT_DEBUG 1` on
 *     the deployment you want verbose logging on (typically dev).
 *   - `console.warn` / `console.error` at call sites are left untouched;
 *     always-on operational logging should continue to use those directly.
 *
 * The flag is read once at module load. Re-deploy to toggle.
 */
const ttftDebugEnabled = process.env.TTFT_DEBUG === "1";

type LogFn = (message: string, ...args: unknown[]) => void;

const noop: LogFn = () => {};

export const ttftLog: LogFn = ttftDebugEnabled ? console.info.bind(console) : noop;

/** True when TTFT_DEBUG is enabled on this deployment. */
export const isTtftDebugEnabled = ttftDebugEnabled;
