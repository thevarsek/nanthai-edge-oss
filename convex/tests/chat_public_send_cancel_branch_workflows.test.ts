import assert from "node:assert/strict";
import test from "node:test";

import {
  cancelGenerationHandler,
  createChatHandler,
  createUploadUrlHandler,
  sendMessageHandler,
} from "../chat/mutations_public_handlers";

type Row = Record<string, any>;

function buildCtx(options?: {
  records?: Record<string, Row>;
  tableRows?: Record<string, Row[]>;
  storageUrl?: string | null;
  cancelThrows?: boolean;
}) {
  const records = new Map(Object.entries(options?.records ?? {}));
  const tableRows = new Map(Object.entries(options?.tableRows ?? {}));
  const inserts: Array<{ table: string; value: Row; id: string }> = [];
  const patches: Array<{ id: string; value: Row }> = [];
  const deletes: string[] = [];
  const scheduled: Array<{ delay: number; args: Row }> = [];
  const cancelled: string[] = [];

  const rowsFor = (table: string) => tableRows.get(table) ?? [];
  const chainFor = (table: string) => {
    const chain = {
      withIndex: (_index: string, apply?: (q: any) => unknown) => {
        const q = { eq: () => q, gt: () => q, field: (name: string) => name };
        apply?.(q);
        return chain;
      },
      order: () => chain,
      first: async () => rowsFor(table)[0] ?? null,
      unique: async () => rowsFor(table)[0] ?? null,
      collect: async () => rowsFor(table),
      take: async (count: number) => rowsFor(table).slice(0, count),
    };
    return chain;
  };

  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    db: {
      get: async (id: string) => records.get(id) ?? null,
      query: (table: string) => chainFor(table),
      insert: async (table: string, value: Row) => {
        const id = `${table}_${inserts.length + 1}`;
        const row = { _id: id, ...value };
        inserts.push({ table, value, id });
        records.set(id, row);
        tableRows.set(table, [...rowsFor(table), row]);
        return id;
      },
      patch: async (id: string, value: Row) => {
        patches.push({ id, value });
        records.set(id, { ...(records.get(id) ?? { _id: id }), ...value });
      },
      delete: async (id: string) => {
        deletes.push(id);
        records.delete(id);
      },
    },
    scheduler: {
      runAfter: async (delay: number, _fn: unknown, args: Row) => {
        scheduled.push({ delay, args });
        return `scheduled_${scheduled.length}`;
      },
      cancel: async (id: string) => {
        cancelled.push(id);
        if (options?.cancelThrows) throw new Error("already settled");
      },
    },
    storage: {
      getUrl: async () => options?.storageUrl ?? "https://files.example/report.pdf",
      getMetadata: async () => ({ size: 1024, contentType: null }),
      generateUploadUrl: async () => "https://uploads.example/new",
    },
  } as any;

  return { ctx, inserts, patches, deletes, scheduled, cancelled };
}

function proTableRows(): Record<string, Row[]> {
  return {
    // Historical usage must not become a NanthAI send quota. The removed
    // application gate rejected this fixture before the message was written.
    usageRecords: Array.from({ length: 31 }, (_, index) => ({
      _id: `usage_${index}`,
      userId: "user_1",
      createdAt: Date.now(),
    })),
    purchaseEntitlements: [{ _id: "ent_1", userId: "user_1", status: "active" }],
    messages: [],
    cachedModels: [{ _id: "model_1", modelId: "model_tools", supportsTools: true }],
    userPreferences: [{ _id: "prefs_1", userId: "user_1", titleModelId: "   " }],
    fileAttachments: [{ _id: "file_1", userId: "user_1", storageId: "storage_report" }],
  };
}

test("createChatHandler persists optional web participants and createUploadUrl requires auth", async () => {
  const { ctx, inserts } = buildCtx();

  const chatId = await createChatHandler(ctx, {
    title: "Architecture review",
    mode: "chat",
    folderId: "folder_1",
    participants: [
      { modelId: "model_a", personaId: "persona_1" as any, personaName: "Planner", personaEmoji: "P" },
      { modelId: "model_b", personaAvatarImageUrl: "https://avatar.example/p.png" },
      { modelId: "model_c", personaName: null },
      { modelId: "model_d" },
    ],
  });
  const uploadUrl = await createUploadUrlHandler(ctx);

  assert.equal(chatId, "chats_1");
  assert.equal(uploadUrl, "https://uploads.example/new");
  assert.equal(inserts.find((entry) => entry.table === "chats")?.value.folderId, "folder_1");
  const participants = inserts.filter((entry) => entry.table === "chatParticipants");
  assert.equal(participants.length, 3);
  assert.deepEqual(participants.map((entry) => entry.value.sortOrder), [0, 1, 2]);
  assert.equal(participants[0].value.personaId, "persona_1");
  assert.equal(participants[1].value.personaAvatarImageUrl, "https://avatar.example/p.png");
  assert.equal(participants[2].value.personaName, undefined);

  const legacy = buildCtx();
  await createChatHandler(legacy.ctx, { mode: "ideascape" });
  assert.equal(legacy.inserts.filter((entry) => entry.table === "chatParticipants").length, 0);
  assert.equal(legacy.inserts.find((entry) => entry.table === "chats")?.value.title, "New conversation");
});

test("sendMessageHandler ignores historical usage volume and creates web-search turns", async () => {
  const { ctx, inserts, patches, scheduled } = buildCtx({
    records: {
      chat_1: {
        _id: "chat_1",
        userId: "user_1",
        title: "New conversation",
        messageCount: 0,
      },
    },
    tableRows: proTableRows(),
  });

  const result = await sendMessageHandler(ctx, {
    chatId: "chat_1" as any,
    text: "  Find launch risks  ",
    participants: [{ modelId: "model_tools", includeReasoning: true }],
    searchMode: "web",
    complexity: 1.2,
    enabledIntegrations: ["gmail"],
    attachments: [{
      type: "document",
      storageId: "storage_report",
      name: "",
      mimeType: "application/pdf",
      driveFileId: "drive_1",
      lastRefreshedAt: 123,
    }],
  } as any);

  assert.equal(result.assistantMessageIds.length, 1);
  const userMessage = inserts.find((entry) => entry.table === "messages" && entry.value.role === "user");
  assert.equal(userMessage?.value.content, "Find launch risks");
  assert.equal(userMessage?.value.attachments[0].name, "attachment");

  const fileAttachment = inserts.find((entry) => entry.table === "fileAttachments");
  assert.equal(fileAttachment?.value.filename, "attachment");
  assert.equal(fileAttachment?.value.driveFileId, "drive_1");

  const chatPatch = patches.find((entry) => entry.id === "chat_1")?.value;
  assert.equal(chatPatch?.title, "Find launch risks");

  const searchSession = inserts.find((entry) => entry.table === "searchSessions");
  assert.equal(searchSession?.value.status, "searching");
  assert.equal(searchSession?.value.complexity, 1);

  assert.equal(scheduled.filter((entry) => entry.args.queryText === "Find launch risks").length, 2);
  assert.ok(scheduled.some((entry) => entry.args.seedTitle === "Find launch risks"));
  assert.ok(scheduled.some((entry) => entry.args.sessionId === searchSession?.id));
});

test("sendMessageHandler creates jobs only for explicitly mentioned participants", async () => {
  const { ctx, inserts, scheduled } = buildCtx({
    records: {
      chat_1: {
        _id: "chat_1",
        userId: "user_1",
        title: "Existing conversation",
        messageCount: 2,
      },
    },
    tableRows: {
      ...proTableRows(),
      messages: [],
    },
  });

  const result = await sendMessageHandler(ctx, {
    chatId: "chat_1" as any,
    text: "@Reviewer check this",
    participants: [
      { participantKey: "participant_1", modelId: "model_tools", personaName: "Planner" },
      { participantKey: "participant_2", modelId: "model_tools", personaName: "Reviewer" },
    ],
    mentionedParticipantKeys: ["participant_2"],
  });

  assert.equal(result.assistantMessageIds.length, 1);
  const assistantMessages = inserts.filter(
    (entry) => entry.table === "messages" && entry.value.role === "assistant",
  );
  assert.deepEqual(assistantMessages.map((entry) => entry.value.participantName), ["Reviewer"]);
  const generationDispatch = scheduled.find((entry) => Array.isArray(entry.args.assistantMessageIds));
  assert.equal(generationDispatch?.args.participants.length, 1);
  assert.equal(generationDispatch?.args.participants[0].participantKey, undefined);
});

test("Collaboration snapshots backstage Advisors instead of rejecting the send", async () => {
  const { ctx, inserts, scheduled } = buildCtx({
    records: {
      chat_1: {
        _id: "chat_1",
        userId: "user_1",
        title: "Existing conversation",
        messageCount: 2,
        groupBehavior: "collaboration",
      },
    },
    tableRows: {
      ...proTableRows(),
      messages: [],
      collaborationExchanges: [],
      autonomousSessions: [],
      chatParticipants: [
        {
          _id: "participant_1",
          chatId: "chat_1",
          userId: "user_1",
          modelId: "model_tools",
          sortOrder: 0,
        },
        {
          _id: "participant_2",
          chatId: "chat_1",
          userId: "user_1",
          modelId: "model_tools",
          sortOrder: 1,
        },
      ],
    },
  });
  const selections = [{
    personaId: "advisor_1",
    keepAvailable: true,
    allowWebSearch: false,
  }];

  const result = await sendMessageHandler(ctx, {
    chatId: "chat_1" as any,
    text: "Review this together",
    participants: [
      { participantKey: "participant_1", modelId: "model_tools" },
      { participantKey: "participant_2", modelId: "model_tools" },
    ],
    advisorSelections: selections,
    advisorBrief: "Challenge the implementation plan",
  } as any);

  assert.deepEqual(result.assistantMessageIds, []);
  const exchange = inserts.find((entry) =>
    entry.table === "collaborationExchanges"
  );
  assert.deepEqual(exchange?.value.generationSnapshot.advisorSelections, selections);
  assert.equal(
    exchange?.value.generationSnapshot.advisorBrief,
    "Challenge the implementation plan",
  );
  assert.ok(scheduled.some((entry) => entry.args.exchangeId === exchange?.id));
});

test("sendMessageHandler keeps chat-wide subagents on for every tool-capable participant", async () => {
  const { ctx, inserts, scheduled } = buildCtx({
    records: {
      chat_1: {
        _id: "chat_1",
        userId: "user_1",
        title: "Existing conversation",
        messageCount: 2,
      },
    },
    tableRows: {
      ...proTableRows(),
      messages: [],
    },
  });

  const result = await sendMessageHandler(ctx, {
    chatId: "chat_1" as any,
    text: "Review and implement this together",
    participants: [
      { participantKey: "participant_1", modelId: "model_tools", personaName: "Architect" },
      { participantKey: "participant_2", modelId: "model_tools", personaName: "Implementer" },
    ],
    subagentsEnabled: true,
  });

  assert.equal(result.assistantMessageIds.length, 2);
  const assistantMessages = inserts.filter(
    (entry) => entry.table === "messages" && entry.value.role === "assistant",
  );
  assert.equal(assistantMessages.length, 2);
  assert.ok(assistantMessages.every((entry) => entry.value.subagentsEnabled === true));
  const generationDispatch = scheduled.find((entry) =>
    Array.isArray(entry.args.assistantMessageIds)
  );
  assert.equal(generationDispatch?.args.subagentsEnabled, true);
});

test("sendMessageHandler accepts uploaded audio as the only source without text priming", async () => {
  const { ctx, inserts, scheduled } = buildCtx({
    records: {
      chat_1: {
        _id: "chat_1",
        userId: "user_1",
        title: "Existing",
        messageCount: 4,
      },
    },
    tableRows: {
      usageRecords: [],
      messages: [],
      cachedModels: [],
      userPreferences: [],
      fileAttachments: [{ _id: "file_audio", userId: "user_1", storageId: "storage_audio" }],
    },
    storageUrl: "https://files.example/audio.m4a",
  });

  await sendMessageHandler(ctx, {
    chatId: "chat_1" as any,
    text: "   ",
    participants: [{ modelId: "model_text" }],
    attachments: [{
      type: "audio",
      storageId: "storage_audio",
      mimeType: "audio/mp4",
      sizeBytes: 2048,
    }],
  } as any);

  const userMessage = inserts.find((entry) => entry.table === "messages" && entry.value.role === "user");
  assert.equal(userMessage?.value.content, "");
  assert.equal(userMessage?.value.audioTranscript, "");
  assert.equal(inserts.some((entry) => entry.table === "fileAttachments"), true);
  assert.equal(scheduled.some((entry) => "queryText" in entry.args), false);
  assert.ok(scheduled.some((entry) => Array.isArray(entry.args.assistantMessageIds)));
});

test("cancelGenerationHandler cancels continuations, subagents, streaming records, and linked search", async () => {
  const active = buildCtx({
    records: {
      job_1: {
        _id: "job_1",
        userId: "user_1",
        messageId: "msg_1",
        status: "streaming",
      },
      msg_1: {
        _id: "msg_1",
        chatId: "chat_1",
        status: "streaming",
        searchSessionId: "session_1",
      },
      session_1: { _id: "session_1", status: "searching" },
    },
    tableRows: {
      generationContinuations: [{ _id: "cont_1", jobId: "job_1" }],
      streamingMessages: [
        { _id: "stream_old", messageId: "msg_1", chatId: "chat_1", content: "old", status: "streaming", updatedAt: 1 },
        { _id: "stream_new", messageId: "msg_1", chatId: "chat_1", content: "latest", status: "streaming", updatedAt: 2 },
      ],
      subagentBatches: [{ _id: "batch_1", parentMessageId: "msg_1", status: "running" }],
      subagentRuns: [
        { _id: "run_active", batchId: "batch_1", status: "running" },
        { _id: "run_done", batchId: "batch_1", status: "completed" },
      ],
    },
    cancelThrows: true,
  });

  await cancelGenerationHandler(active.ctx, { jobId: "job_1" as any });
  assert.deepEqual(active.cancelled, []);
  assert.ok(active.deletes.includes("cont_1"));
  assert.ok(active.deletes.includes("stream_old"));
  assert.ok(active.patches.some((entry) => entry.id === "run_active" && entry.value.status === "cancelled"));
  assert.equal(active.patches.some((entry) => entry.id === "run_done"), false);
  assert.ok(active.patches.some((entry) => entry.id === "session_1" && entry.value.status === "cancelled"));

  const terminal = buildCtx({
    records: {
      job_done: { _id: "job_done", userId: "user_1", status: "completed", messageId: "msg_done" },
    },
  });
  await cancelGenerationHandler(terminal.ctx, { jobId: "job_done" as any });
  assert.equal(terminal.patches.length, 0);
});
