import assert from "node:assert/strict";
import test, { mock } from "node:test";

import { generateForParticipant } from "../chat/actions_run_generation_participant";
import { createTool, ToolRegistry } from "../tools/registry";

function streamResponse(events: unknown[]) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => [
      ...events.map((event) => `data: ${JSON.stringify(event)}`),
      "data: [DONE]",
      "",
    ].join("\n\n"),
  } as any;
}

function makeRegistry() {
  const registry = new ToolRegistry();
  registry.register(createTool({
    name: "noop_tool",
    effectPolicy: { effect: "read", retry: "safe" },
    description: "No-op test tool",
    parameters: { type: "object", properties: {} },
    execute: async () => ({ success: true, data: { ok: true } }),
  }));
  return registry;
}

function makeCtx(options: {
  scopedDocuments?: unknown[];
  extractedText?: string | null;
  userPrefs?: Record<string, unknown> | null;
  cancelled?: boolean;
  throwScopedDocuments?: boolean;
} = {}) {
  const mutations: Array<Record<string, unknown>> = [];
  const scopedDocuments = options.scopedDocuments ?? [];
  return {
    mutations,
    ctx: {
      runQuery: async (_ref: unknown, queryArgs: Record<string, unknown>) => {
        if ("jobId" in queryArgs) return options.cancelled ?? false;
        if ("userId" in queryArgs && !("chatId" in queryArgs)) {
          return options.userPrefs ?? null;
        }
        if ("versionId" in queryArgs) {
          return { extractionTextStorageId: "version_text_storage" };
        }
        return Array.isArray(queryArgs) ? [] : null;
      },
      runMutation: async (_ref: unknown, mutationArgs: Record<string, unknown>) => {
        mutations.push(mutationArgs);
        if (
          mutationArgs.userId === "user_1"
          && mutationArgs.chatId === "chat_1"
          && !("jobId" in mutationArgs)
          && !("messageId" in mutationArgs)
        ) {
          if (options.throwScopedDocuments) {
            throw new Error("document index offline");
          }
          return scopedDocuments;
        }
        return null;
      },
      scheduler: { runAfter: async () => "scheduled_1" },
      storage: {
        get: async () => ({
          text: async () => options.extractedText ?? "exact clause appears in the source text",
        }),
        store: async () => "storage_1",
        getUrl: async () => "https://files.example/storage_1.png",
      },
    } as any,
  };
}

async function runParticipant(overrides: Record<string, unknown> = {}) {
  const state = makeCtx(overrides.ctxOptions as any);
  const result = await generateForParticipant({
    ctx: state.ctx,
    args: {
      chatId: "chat_1",
      userId: "user_1",
      userMessageId: "msg_user",
      assistantMessageIds: ["msg_assistant"],
      generationJobIds: ["job_1"],
      expandMultiModelGroups: false,
      webSearchEnabled: false,
      enabledIntegrations: [],
      ...(overrides.args as Record<string, unknown> | undefined),
    },
    participant: {
      messageId: "msg_assistant",
      jobId: "job_1",
      modelId: "model_1",
      temperature: null,
      maxTokens: null,
      includeReasoning: null,
      reasoningEffort: null,
      personaId: null,
      systemPrompt: null,
    },
    allMessages: [{ _id: "msg_user", role: "user", content: "Summarize the attached contract." }],
    memoryContext: undefined,
    modelCapabilities: new Map([["model_1", {
      provider: overrides.provider ?? "openai",
      supportedParameters: overrides.supportedParameters ?? ["tools"],
      contextLength: 128_000,
      hasZdrEndpoint: overrides.hasZdrEndpoint ?? true,
    } as any]]),
    isPro: true,
    runtimeProfile: "mobileBasic",
    apiKey: "key",
    actionStartTime: Date.now(),
    requestMessagesOverride: overrides.requestMessagesOverride ?? [
      { role: "user", content: "Summarize the attached contract." },
    ],
    toolRegistry: overrides.toolRegistry,
    progressiveTools: overrides.progressiveTools,
    onDocumentToolsScoped: overrides.onDocumentToolsScoped,
  } as any);
  return { result, mutations: state.mutations };
}

test("generateForParticipant validates document citations and preserves separate web citations", async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(globalThis, "fetch", async () => streamResponse([
    {
      id: "gen_citations",
      choices: [{
        delta: {
          content: "Contract says exact clause [1] and public guidance [2].\n<CITATIONS>[{\"ref\":1,\"doc_id\":\"doc_1\",\"page\":3,\"quote\":\"exact clause\"}]</CITATIONS>",
          annotations: [
            { type: "url_citation", url_citation: { url: "https://wrong.example/doc", title: "Doc mirror" } },
            { type: "url_citation", url_citation: { url: "https://source.example/web", title: "Web source" } },
          ],
        },
      }],
    },
    { choices: [{ finish_reason: "stop" }] },
  ])) as any;

  let scopedTools: Record<string, unknown> | undefined;
  const { result, mutations } = await runParticipant({
    toolRegistry: makeRegistry(),
    progressiveTools: { directToolNames: [], enabledIntegrations: [], allowSubagents: false },
    onDocumentToolsScoped: async (args: Record<string, unknown>) => {
      scopedTools = args;
      return makeRegistry();
    },
    ctxOptions: {
      scopedDocuments: [{
        ref: 1,
        documentId: "doc_1",
        versionId: "version_1",
        filename: "contract.pdf",
        extractionTextStorageId: "text_storage_1",
      }],
    },
  });

  assert.equal(result.failed, false);
  assert.deepEqual(scopedTools?.directToolNames, ["list_documents", "read_document", "find_in_document"]);
  const finalize = mutations.find((entry) => entry.status === "completed");
  assert.match(String(finalize?.content), /exact clause \[1\]/);
  assert.match(String(finalize?.content), /\[2\. Web source\]\(https:\/\/source\.example\/web\)/);
  assert.deepEqual(finalize?.documentCitations, [{
    ref: 1,
    documentId: "doc_1",
    versionId: "version_1",
    filename: "contract.pdf",
    quote: "exact clause",
    page: 3,
    locator: undefined,
  }]);
  assert.equal((finalize?.citations as unknown[]).length, 2);
});

test("generateForParticipant rejects Google Workspace turns on models without required data protection", async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(globalThis, "fetch", async () => streamResponse([
    { choices: [{ delta: { content: "Should not stream." } }] },
  ])) as any;

  const { result, mutations } = await runParticipant({
    hasZdrEndpoint: false,
    progressiveTools: { directToolNames: [], enabledIntegrations: ["gmail"], allowSubagents: false },
  });

  assert.equal(result.failed, true);
  const finalize = mutations.find((entry) => entry.status === "failed");
  assert.match(String(finalize?.content), /Google Workspace data/);
  assert.equal(mutations.some((entry) => entry.openrouterGenerationId), false);
});

test("generateForParticipant exits before streaming when the job was already cancelled", async (t) => {
  t.after(() => mock.restoreAll());
  let fetchCount = 0;
  mock.method(globalThis, "fetch", async () => {
    fetchCount += 1;
    return streamResponse([{ choices: [{ delta: { content: "late" } }] }]);
  }) as any;

  const { result, mutations } = await runParticipant({
    ctxOptions: { cancelled: true },
  });

  assert.deepEqual(result, {
    deferredForSubagents: false,
    cancelled: true,
    failed: false,
    continued: false,
  });
  assert.equal(fetchCount, 0);
  assert.equal(mutations.some((entry) => entry.status === "completed"), false);
});

test("generateForParticipant rejects user-required ZDR models without Google context", async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(globalThis, "fetch", async () => streamResponse([
    { choices: [{ delta: { content: "Should not stream." } }] },
  ])) as any;

  const { result, mutations } = await runParticipant({
    hasZdrEndpoint: false,
    ctxOptions: { userPrefs: { zdrEnabled: true } },
  });

  assert.equal(result.failed, true);
  const finalize = mutations.find((entry) => entry.status === "failed");
  assert.match(String(finalize?.content), /Zero Data Retention/);
});

test("generateForParticipant rejects Google Workspace turns on disallowed providers", async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(globalThis, "fetch", async () => streamResponse([
    { choices: [{ delta: { content: "Should not stream." } }] },
  ])) as any;

  const { result, mutations } = await runParticipant({
    provider: "x-ai",
    hasZdrEndpoint: true,
    progressiveTools: { directToolNames: [], enabledIntegrations: ["gmail"], allowSubagents: false },
  });

  assert.equal(result.failed, true);
  const finalize = mutations.find((entry) => entry.status === "failed");
  assert.match(String(finalize?.content), /Google Workspace data/);
});

test("generateForParticipant continues when scoped document resolution fails", async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(globalThis, "fetch", async () => streamResponse([
    {
      id: "gen_doc_scope_failed",
      choices: [{ delta: { content: "Plain answer without scoped documents." } }],
    },
    { choices: [{ finish_reason: "stop" }] },
  ])) as any;

  const scopedCalls: Record<string, unknown>[] = [];
  const { result, mutations } = await runParticipant({
    toolRegistry: makeRegistry(),
    progressiveTools: { directToolNames: [], enabledIntegrations: [], allowSubagents: false },
    onDocumentToolsScoped: async (args: Record<string, unknown>) => {
      scopedCalls.push(args);
      return makeRegistry();
    },
    ctxOptions: { throwScopedDocuments: true },
  });

  assert.equal(result.failed, false);
  assert.deepEqual(scopedCalls, []);
  const finalize = mutations.find((entry) => entry.status === "completed");
  assert.equal(finalize?.content, "Plain answer without scoped documents.");
  assert.equal(finalize?.documentCitations, undefined);
});

test("generateForParticipant drops document citations outside scope or missing quoted text", async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(globalThis, "fetch", async () => streamResponse([
    {
      id: "gen_bad_citations",
      choices: [{
        delta: {
          content: "The report makes two claims.\n<CITATIONS>[{\"ref\":1,\"doc_id\":\"missing_doc\",\"quote\":\"unscoped\"},{\"ref\":2,\"doc_id\":\"doc_1\",\"quote\":\"absent quote\"}]</CITATIONS>",
        },
      }],
    },
    { choices: [{ finish_reason: "stop" }] },
  ])) as any;

  const { result, mutations } = await runParticipant({
    toolRegistry: makeRegistry(),
    progressiveTools: { directToolNames: [], enabledIntegrations: [], allowSubagents: false },
    ctxOptions: {
      extractedText: "source text does not include the requested phrase",
      scopedDocuments: [{
        ref: 2,
        documentId: "doc_1",
        versionId: "version_1",
        filename: "report.pdf",
        extractionTextStorageId: "text_storage_1",
      }],
    },
  });

  assert.equal(result.failed, false);
  const finalize = mutations.find((entry) => entry.status === "completed");
  assert.equal(finalize?.documentCitations, undefined);
  assert.doesNotMatch(String(finalize?.content), /<CITATIONS>/);
});
