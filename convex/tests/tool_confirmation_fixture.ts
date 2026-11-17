// In-memory Convex context for tool-confirmation handler tests. Index
// queries filter by the `eq` fields supplied, which is enough for the narrow
// indexes these handlers use.

type Row = Record<string, unknown> & { _id: string };

export type ConfirmationFixture = ReturnType<typeof createConfirmationFixture>;

export function createConfirmationFixture(options: {
  now?: number;
  userMessages?: string[];
  userMessageOrigin?: "telegram" | "external_mcp";
  userMessageSource?: "user" | "scheduled_step";
  questionTimeoutMinutes?: 0 | 5 | 10 | 15;
} = {}) {
  const now = options.now ?? 1_800_000_000_000;
  const rows: Record<string, Row[]> = {
    generationJobs: [{
      _id: "job_1", userId: "user_1", chatId: "chat_1", status: "streaming",
      executionRunId: "run_1", executionAttemptId: "attempt_1", executionFence: 4,
    }],
    executionRuns: [{ _id: "run_1", userId: "user_1", chatId: "chat_1", state: "running" }],
    messages: [
      ...(options.userMessages ?? ["Please email alice@example.com about the launch"]).map((content, index) => ({
        _id: index === 0 ? "user_message_1" : `user_message_${index + 1}`,
        chatId: "chat_1", userId: "user_1", role: "user", content,
        ...(options.userMessageOrigin ? { turnOrigin: options.userMessageOrigin } : {}),
        ...(options.userMessageSource ? { source: options.userMessageSource } : {}),
      })),
      { _id: "assistant_1", chatId: "chat_1", userId: "user_1", role: "assistant",
        content: "I will also contact mallory@evil.example" },
    ],
    userPreferences: options.questionTimeoutMinutes === undefined ? [] : [{
      _id: "prefs_1", userId: "user_1", localQuestionTimeoutMinutes: options.questionTimeoutMinutes,
    }],
    toolConfirmationRequests: [],
    generationContinuations: [],
    generationRoundJournal: [],
  };
  const scheduled: Array<{ at: number; args: unknown }> = [];
  let nextId = 0;
  const table = (id: string) => Object.keys(rows).find((name) => rows[name].some((row) => row._id === id));
  const find = (id: string) => {
    const name = table(id);
    return name ? rows[name].find((row) => row._id === id) ?? null : null;
  };
  const indexQuery = (name: string) => {
    const filters: Array<[string, unknown]> = [];
    let descending = false;
    const matches = () => {
      const result = (rows[name] ?? []).filter((row) => filters.every(([field, value]) => row[field] === value));
      return descending ? [...result].reverse() : result;
    };
    const chain = {
      order: (direction: "asc" | "desc") => { descending = direction === "desc"; return chain; },
      take: async (limit: number) => matches().slice(0, limit),
      first: async () => matches()[0] ?? null,
      unique: async () => matches()[0] ?? null,
      collect: async () => matches(),
    };
    return {
      withIndex: (_index: string, apply?: (q: { eq: (field: string, value: unknown) => unknown }) => unknown) => {
        const q = { eq: (field: string, value: unknown) => { filters.push([field, value]); return q; } };
        apply?.(q);
        return chain;
      },
    };
  };
  const ctx = {
    db: {
      get: async (id: string) => find(id),
      query: (name: string) => indexQuery(name),
      insert: async (name: string, value: Record<string, unknown>) => {
        nextId += 1;
        const id = `${name}_${nextId}`;
        (rows[name] ??= []).push({ _id: id, ...value });
        return id;
      },
      patch: async (id: string, value: Record<string, unknown>) => {
        const row = find(id);
        if (!row) throw new Error(`missing ${id}`);
        for (const [key, entry] of Object.entries(value)) {
          if (entry === undefined) delete row[key];
          else row[key] = entry;
        }
      },
    },
    scheduler: {
      runAt: async (at: number, _ref: unknown, args: unknown) => { scheduled.push({ at, args }); return "scheduled"; },
      runAfter: async (delay: number, _ref: unknown, args: unknown) => {
        scheduled.push({ at: now + delay, args });
        return "scheduled";
      },
    },
  };
  return { ctx, rows, scheduled, now };
}

export function evaluateArgsFor(overrides: Record<string, unknown> = {}) {
  return {
    userId: "user_1",
    chatId: "chat_1",
    messageId: "assistant_1",
    userMessageId: "user_message_1",
    jobId: "job_1",
    attemptId: "attempt_1",
    fence: 4,
    toolCallId: "call_1",
    toolName: "gmail_send",
    inputHash: "hash_1",
    configuredAutomation: false,
    confirmationAvailable: true,
    candidate: {
      kind: "external_send",
      summary: "Launch",
      recipients: ["mallory@evil.example"],
      integrations: [],
    },
    ...overrides,
  } as never;
}

/** Install the bound checkpoint the participant writes after deferring. */
export function bindContinuation(fixture: ConfirmationFixture, confirmationId: string, eventId = "event_1") {
  fixture.rows.generationContinuations.push({
    _id: "continuation_1",
    jobId: "job_1",
    userId: "user_1",
    status: "waiting",
    deferredResumeEventId: eventId,
    deferredOwnership: { kind: "tool_confirmation", confirmationId, toolCallId: "call_1" },
    executionAttemptId: "attempt_1",
    executionFence: 4,
    toolCalls: [{ id: "call_1", name: "gmail_send", arguments: "{}" }],
    toolResults: [],
    requestMessages: [
      { role: "assistant", content: null, tool_calls: [{ id: "call_1" }] },
      { role: "tool", tool_call_id: "call_1", content: "{\"status\":\"awaiting_user_confirmation\"}" },
    ],
  });
  const request = fixture.rows.toolConfirmationRequests.find((row) => row._id === confirmationId);
  if (request) request.checkpointBound = true;
}
