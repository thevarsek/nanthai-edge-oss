export const MAX_ADVISORS_PER_CHAT = 3;
export const MAX_ADVISOR_BRIEF_CHARS = 2_000;
export const MAX_ADVISOR_OUTPUT_TOKENS = 2_048;
export const MAX_ADVISOR_PARTIAL_CHARS = 24_000;
export const MAX_ADVISOR_NOTE_CHARS = 24_000;
export const MAX_ADVISOR_HISTORY_ITEMS = 6;
export const MAX_ADVISOR_HISTORY_BYTES = 48_000;
export const MAX_ADVISOR_CONTEXT_MESSAGES = 40;
export const ADVISOR_IDLE_TIMEOUT_MS = 90_000;
export const ADVISOR_ABSOLUTE_TIMEOUT_MS = 7 * 60_000;
export const ADVISOR_WATCHDOG_DELAY_MS = 7 * 60_000 + 30_000;
export const ADVISOR_RUN_LEASE_MS = ADVISOR_WATCHDOG_DELAY_MS;

export const DEFAULT_ADVISOR_BRIEF =
  "Review the user's latest request and advise the primary assistant on the best response.\n" +
  "Identify important assumptions, risks, corrections, or opportunities the primary assistant may miss.";

export const ADVISOR_DISPATCHER_INSTRUCTIONS =
  "Invoke the provided Advisor exactly once. Do not answer the user independently. " +
  "After the Advisor returns, emit no additional substantive prose.";
