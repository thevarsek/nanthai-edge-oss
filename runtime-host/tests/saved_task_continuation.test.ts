import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BRIDGE_TOOLS } from "../src/protocol.ts";
import { randomUUID } from "node:crypto";
import { SavedTaskStore, digest, type SavedTask, type LocalResult } from "../src/saved_task_store.ts";
import { continueSavedTask, continuationCommand } from "../src/saved_task_continuation.ts";
import { syncSavedResults } from "../src/saved_task_sync.ts";
import { atomicTurnPlan } from "../src/runtime_command_translation.ts";
import { runtimePacket } from "./fixtures/runtime_packet.ts";
import { HttpJsonClient } from "../src/http_json_client.ts";
const fake = fileURLToPath(new URL("./fixtures/fake_json_rpc_child.mjs", import.meta.url));
function task(): SavedTask {
  return { version: 1, id: "run-1", deviceId: "device-1", server: "https://controller.example", title: "Saved task",
    packet: runtimePacket(), output: "The original answer", outcome: "completed", nativeSessionId: "native-1", nativeTurnId: "turn-1",
    updatedAt: 1, files: [] };
}

test("fresh local branch keeps provided context and native settings, and never reuses a cloud fence", () => {
  const source = task();
  const result: LocalResult = { version: 1, id: randomUUID(), taskId: source.id, prompt: "Add an example", output: "",
    outcome: null, files: [], usage: [], baseOutputHash: digest(source.output), previousResultId: null, ownerPid: process.pid,
    createdAt: 1, synced: false, disposition: null };
  const command = continuationCommand(source, result, []);
  const plan = atomicTurnPlan(command);
  assert.notEqual(plan.packet.runId, source.packet.runId);
  assert.equal(plan.opening.kind, "start_session_request");
  assert.deepEqual(plan.packet.placement.selectedModel, source.packet.placement.selectedModel);
  assert.equal(plan.packet.messages.some(message => message.content.some(part => part.type === "text" && part.text === source.output)), true);
  assert.equal(plan.packet.messages.at(-1)?.content[0]?.type, "text");
  assert.equal(source.packet.messages.length, 1);
});

test("normal Codex worker continuation survives store restart without contacting NanthAI", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nanthai-saved-"));
  const store = new SavedTaskStore(directory);
  try {
    await store.saveTask(task());
    const result = await continueSavedTask(store, "run-1", "REPORT_THREAD_NAME", {
      codexCommand: process.execPath, codexArgs: [fake], sandboxMode: "read-only",
    }, new AbortController().signal);
    assert.equal(result.outcome, "completed");
    assert.ok(result.output.includes("Saved task"));
    const restarted = new SavedTaskStore(directory);
    assert.deepEqual((await restarted.results())[0], result);
    assert.equal((await restarted.tasks())[0]?.nativeSessionId, "native-1");
    const bytes = await readFile(join(store.taskDirectory("run-1"), "task.json"), "utf8");
    assert.equal(bytes.includes("credential"), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("lost import acknowledgement retries the identical saved identity, not the native turn", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nanthai-sync-"));
  const store = new SavedTaskStore(directory);
  let calls = 0;
  const bodies: string[] = [];
  try {
    await store.saveTask(task());
    const result = await continueSavedTask(store, "run-1", "REPORT_THREAD_NAME", {
      codexCommand: process.execPath, codexArgs: [fake], sandboxMode: "read-only",
    }, new AbortController().signal);
    const client = new HttpJsonClient("https://controller.example", { fetch: async (_url, init) => {
      bodies.push(String(init?.body)); calls++;
      if (calls === 1) throw new Error("Lost acknowledgement after commit");
      return Response.json({ disposition: "review", assistantMessageId: "message-saved" });
    } });
    const credential = { deviceId: "device-1", credentialId: "key-1", credential: "private-secret", controlPlaneUrl: "https://controller.example" };
    await assert.rejects(syncSavedResults(store, credential, undefined, client));
    assert.equal((await store.results())[0]?.synced, false);
    assert.equal(await syncSavedResults(store, credential, undefined, client), 1);
    assert.equal(await syncSavedResults(store, credential, undefined, client), 0);
    assert.deepEqual(bodies[0], bodies[1]);
    assert.equal((await store.results())[0]?.id, result.id);
    assert.equal((await store.results())[0]?.disposition, "review");
    assert.equal(bodies[0]?.includes("private-secret"), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("normal Pi bridge publishes a local artifact with no NanthAI or provider HTTP request", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nanthai-saved-pi-"));
  const store = new SavedTaskStore(directory);
  try {
    const source = task();
    source.packet.placement.adapter = { adapterId: "pi", adapterVersion: "1.0.0" };
    source.packet.placement.selectedModel = { mode: "adapter_default", provider: null, modelId: null };
    const tool = BRIDGE_TOOLS.find(item => item.name === "nanthai_publish_result")!;
    source.packet.capabilities.nanthaiTools = [{ id: tool.name, name: tool.name, version: "1", effect: "write", inputSchemaHash: digest(JSON.stringify(tool.inputSchema)) }];
    await store.saveTask(source);
    const result = await continueSavedTask(store, source.id, "BRIDGE", {
      pi: { command: process.execPath, args: [fileURLToPath(new URL("./fixtures/fake_pi.mjs", import.meta.url))], sessionDirectory: join(directory, "sessions") },
    }, new AbortController().signal);
    assert.equal(result.outcome, "completed");
    assert.equal(result.files[0]?.content, "Pi artifact");
    assert.ok(result.output.includes("savedLocally"));
    const paths = await store.artifactPaths(result.id, result.files, true);
    assert.equal(await readFile(paths[0]!.path, "utf8"), "Pi artifact");
    assert.equal(result.synced, false);
    assert.equal(result.usage.length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("saved Pi native questions retain original choices, accept a response, and Stop cancels the same turn", async () => {
  const { callSavedControl, pendingSavedControls } = await import("../src/saved_task_controls.ts");
  const directory = await mkdtemp(join(tmpdir(), "nanthai-saved-input-"));
  const store = new SavedTaskStore(directory);
  try {
    const source = task();
    source.packet.placement.adapter = { adapterId: "pi", adapterVersion: "1.0.0" };
    source.packet.placement.selectedModel = { mode: "adapter_default", provider: null, modelId: null };
    await store.saveTask(source);
    const options = { pi: { command: process.execPath, args: [fileURLToPath(new URL("./fixtures/fake_pi.mjs", import.meta.url))], sessionDirectory: join(directory, "sessions") } };
    async function waiting() {
      for (let count = 0; count < 200; count++) {
        const requests = await pendingSavedControls(directory, source.id);
        if (requests[0]) return requests[0];
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error("Native question did not arrive");
    }
    const run = continueSavedTask(store, source.id, "ASK", options, new AbortController().signal);
    const request = await waiting();
    assert.deepEqual(request.form?.fields[0]?.options, ["Blue", "Green"]);
    await assert.rejects(callSavedControl(directory, source.id, { action: "input", resultId: "old-turn", requestId: request.id, cancelled: false, content: { value: "Blue" } }), /already changed/);
    await assert.rejects(callSavedControl(directory, source.id, { action: "input", resultId: request.resultId, requestId: request.id, cancelled: false, content: { value: "Red" } }), /Choose a value/);
    await callSavedControl(directory, source.id, { action: "input", resultId: request.resultId, requestId: request.id, cancelled: false, content: { value: "Green" } });
    const result = await run;
    assert.equal(result.outcome, "completed");
    assert.equal(result.output, "Green");
    assert.deepEqual(await pendingSavedControls(directory, source.id), []);
    const stopped = continueSavedTask(store, source.id, "ASK", options, new AbortController().signal);
    const next = await waiting();
    await callSavedControl(directory, source.id, { action: "stop", resultId: next.resultId });
    const cancelled = await stopped;
    assert.equal(cancelled.outcome, "cancelled");
    assert.equal(cancelled.id, next.resultId);
    assert.equal(cancelled.synced, false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("saved Codex permissions use offered decisions and do not persist response commands", async () => {
  const { callSavedControl, pendingSavedControls } = await import("../src/saved_task_controls.ts");
  const directory = await mkdtemp(join(tmpdir(), "nanthai-saved-permission-"));
  const store = new SavedTaskStore(directory);
  try {
    await store.saveTask(task());
    const run = continueSavedTask(store, "run-1", "APPROVAL", { codexCommand: process.execPath, codexArgs: [fake] }, new AbortController().signal);
    let request: Awaited<ReturnType<typeof pendingSavedControls>>[number] | undefined;
    for (let count = 0; count < 200; count++) {
      request = (await pendingSavedControls(directory, "run-1"))[0];
      if (request) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.ok(request);
    assert.equal(request.type, "permission");
    assert.ok(request.choices.includes("allow_once"));
    await callSavedControl(directory, "run-1", { action: "permission", resultId: request.resultId, requestId: request.id, decision: "allow_once" });
    const result = await run;
    assert.equal(result.outcome, "completed");
    const saved = await readFile(join(store.resultDirectory(result.id), "result.json"), "utf8");
    assert.equal(saved.includes("permissionRequestId"), false);
    assert.equal(saved.includes("allow_once"), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
