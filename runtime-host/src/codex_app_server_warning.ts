import { asRecord } from "./codex_event_items.ts";

const MAX_WARNING_CODE_UNITS = 2_000;

export type CodexAppServerWarning = {
  message: string;
  threadId: string | null;
};

export class CodexAppServerWarningHandler {
  private readonly seenMessages = new Set<string>();

  constructor(
    private readonly expectedThreadId: string | null,
    private readonly sink?: (message: string) => void,
    private readonly isRelatedThread: (threadId: string) => boolean = () => false,
  ) {}

  consume(params: unknown): [] {
    const warning = parseCodexAppServerWarning(params);
    if (warning.threadId !== null && warning.threadId !== this.expectedThreadId
      && !this.isRelatedThread(warning.threadId)) {
      throw new Error("Codex App Server warning belongs to a different thread");
    }
    if (!this.seenMessages.has(warning.message)) {
      this.seenMessages.add(warning.message);
      try {
        this.sink?.(boundedWarningMessage(warning.message));
      } catch {
        // A local diagnostic sink cannot change the canonical turn outcome.
      }
    }
    return [];
  }
}

export function parseCodexAppServerWarning(params: unknown): CodexAppServerWarning {
  const record = asRecord(params);
  if (record === null || typeof record.message !== "string") {
    throw new Error("Codex App Server warning omitted params.message");
  }
  if (record.threadId !== undefined && record.threadId !== null
    && typeof record.threadId !== "string") {
    throw new Error("Codex App Server warning has an invalid params.threadId");
  }
  return {
    message: record.message,
    threadId: typeof record.threadId === "string" ? record.threadId : null,
  };
}

function boundedWarningMessage(message: string): string {
  let bounded = "";
  for (const character of message) {
    if (bounded.length + character.length > MAX_WARNING_CODE_UNITS) break;
    bounded += character;
  }
  return bounded;
}
