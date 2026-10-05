import { setTimeout } from "node:timers/promises";

export async function abortableDelay(milliseconds: number, signal: AbortSignal, ref = true): Promise<void> {
  try { await setTimeout(milliseconds, undefined, { signal, ref }); }
  catch (error) { if (!signal.aborted) throw error; }
}
