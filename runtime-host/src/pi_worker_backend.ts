import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { AsyncEventQueue } from "./async_event_queue.ts";
import { asRecord } from "./codex_event_items.ts";
import { undeliveredPacket, type NativeReuse } from "./native_context_reuse.ts";
import { PiBridgeServer } from "./pi_bridge_server.ts";
import { PiEventNormalizer } from "./pi_event_normalizer.ts";
import { piModels, PiModelSchema } from "./pi_models.ts";
import { translatePiPacket } from "./pi_packet_translation.ts";
import { piDialogEvent, piInputResponse, piPermissionResponse } from "./pi_request_mapping.ts";
import { PiRpcClient, type PiRecord } from "./pi_rpc_client.ts";
import { AdapterCapabilitiesSchema, type AdapterEvent, type LocalRuntimeTurnPacket, type PermissionDecision } from "./protocol.ts";
import type { InputResponse, WorkerBackend } from "./worker_backend.ts";

export const PI_PART_CAPABILITIES = { transport: "pi_rpc", inputModalities: ["text", "local_image", "document"] as const };
export const PI_CAPABILITIES = AdapterCapabilitiesSchema.parse({
  protocolVersion: "nanthai.runtime.v1", adapterId: "pi", adapterVersion: "1.0.0", transport: "stdio_jsonl",
  inputModalities: ["text", "image", "document", "file", "tool_evidence"],
  eventTypes: ["session_started", "text_delta", "reasoning_delta", "tool_started", "tool_progress", "tool_completed",
    "permission_requested", "permission_resolved", "input_requested", "input_resolved", "usage_reported", "model_observed", "terminal"],
  operations: { listModels: true, cancel: true, resume: true, permissionResponse: true, inputResponse: true },
  adapterNative: { tools: true, plugins: true, mcpServers: true, skills: true, webSearch: false },
});

export type PiWorkerConfig = {
  command: string; args?: string[] | undefined; environment?: NodeJS.ProcessEnv | undefined;
  sessionDirectory: string; workingDirectory?: string | undefined; attachmentDirectory?: string | undefined; threadName?: string | undefined;
};
export type PiSession = {
  client: PiRpcClient; bridge: PiBridgeServer; nativeId: string; normalizer: PiEventNormalizer;
  translated: Awaited<ReturnType<typeof translatePiPacket>>; queue: AsyncEventQueue<PiRecord>;
  dialogs: Map<string, PiRecord>; cancelled: boolean;
  resumed: boolean;
};

export class PiWorkerBackend implements WorkerBackend<PiSession> {
  readonly capabilities;
  private session: PiSession | null = null;
  private toolHandler: (request: unknown) => Promise<unknown> = async () => { throw new Error("Pi bridge is not bound"); };
  constructor(private readonly config: PiWorkerConfig & { cliVersion?: string }) {
    this.capabilities = { ...PI_CAPABILITIES, adapterVersion: config.cliVersion ?? PI_CAPABILITIES.adapterVersion };
  }

  bindTools(handler: (request: unknown) => Promise<unknown>): void { this.toolHandler = handler; }
  async probe() {
    const models = await this.canonicalModels();
    return { healthy: models.some(model => model.availability === "available"), summary: "Pi configured-provider model discovery" };
  }
  async canonicalModels() {
    const client = this.spawn(["--no-session"]);
    try { return await piModels(client); } finally { await client.close(); }
  }

  async open(packet: LocalRuntimeTurnPacket, sessionId: string, nativeId: string | null, reuse?: NativeReuse) {
    if (this.session) throw new Error("Pi session already claimed");
    await mkdir(this.config.sessionDirectory, { recursive: true, mode: 0o700 });
    if (nativeId && !/^[a-f\d-]{36}$/i.test(nativeId)) throw new Error("Invalid Pi native session ID");
    let replacementReason: "native_frontier_changed" | undefined;
    if (nativeId) {
      const check = this.spawn(["--session-id", nativeId, "--session-dir", this.config.sessionDirectory]);
      try {
        const frontier = asRecord(await check.request("get_entries"));
        if (!reuse?.expectedNativeTurnId || frontier?.leafId !== reuse.expectedNativeTurnId) {
          nativeId = null; replacementReason = "native_frontier_changed";
        } else packet = undeliveredPacket(packet, reuse.deliveredMessageIds ?? []);
      } finally { await check.close(); }
    }
    const translated = await translatePiPacket(packet, this.config.attachmentDirectory);
    const bridge = await PiBridgeServer.start(packet, translated, this.toolHandler);
    const client = this.spawn(["--session-id", nativeId ?? randomUUID(), "--session-dir", this.config.sessionDirectory,
      "--extension", join(bridge.directory, "extension.mjs")], { NANTHAI_PI_BRIDGE_CONFIG: join(bridge.directory, "config.json") });
    const queue = new AsyncEventQueue<PiRecord>({ maxItems: 2000, maxBytes: 16 * 1024 * 1024 });
    client.onEvent(event => queue.push(event));
    client.onFailure(error => queue.fail(error));
    try {
      const selected = packet.placement.selectedModel;
      if (selected.mode === "explicit") {
        const models = await piModels(client);
        const matches = models.filter(model => model.modelId === selected.modelId && (!selected.provider || model.provider === selected.provider)
          && model.availability === "available");
        if (matches.length !== 1) throw new Error("Selected Pi model is unavailable or requires a provider");
        await client.request("set_model", { provider: matches[0]!.provider, modelId: selected.modelId });
      }
      const state = z.object({ model: PiModelSchema, sessionId: z.string() }).parse(await client.request("get_state"));
      if (!state.model.input.includes("image") && packet.messages.some(message => message.content.some(part => part.type === "image"))) {
        throw new Error("The selected Pi model does not support images");
      }
      const models = await piModels(client);
      if (!models.some(model => model.provider === state.model.provider && model.modelId === state.model.id && model.availability === "available")) {
        throw new Error("Configure an available model in Pi");
      }
      const session: PiSession = { client, bridge, nativeId: state.sessionId, normalizer: new PiEventNormalizer(packet, sessionId),
        translated, queue, dialogs: new Map(), cancelled: false, resumed: nativeId !== null };
      this.session = session;
      let diagnostic: string | null = null;
      if (this.config.threadName) {
        try { await client.request("set_session_name", { name: this.config.threadName }); }
        catch { diagnostic = "Pi session name could not be updated"; }
      }
      return { session, resumed: nativeId !== null, threadNameDiagnostic: diagnostic, ...(replacementReason ? { replacementReason } : {}) };
    } catch (error) { await client.close(); await bridge.close(); throw error; }
  }

  nativeSessionId(session: PiSession): string { return session.nativeId; }

  async *sendTurn(session: PiSession): AsyncIterable<AdapterEvent> {
    const create = session.normalizer.events.create.bind(session.normalizer.events);
    const state = z.object({ model: PiModelSchema }).parse(await session.client.request("get_state"));
    yield create({ type: "session_started", nativeSessionId: session.nativeId, resumed: session.resumed,
      workingDirectory: this.config.workingDirectory ?? process.cwd(), repository: null });
    yield create({ type: "model_observed", actualModel: { provider: state.model.provider, modelId: state.model.id, reportedByAdapter: true }, reason: "initial" });
    // An extension may ask a question before Pi acknowledges the prompt. Keep draining stdout.
    const accepted = session.client.request("prompt", { message: session.translated.message, images: session.translated.images });
    void accepted.then(result => session.queue.push({ type: "nanthai_prompt_response", data: result }))
      .catch(() => session.queue.fail(new Error("Pi could not accept the prompt")));
    for await (const record of session.queue) {
      if (record.type === "agent_settled" || record.type === "nanthai_prompt_response" && asRecord(record.data)?.disposition === "handled") break;
      if (record.type === "extension_ui_request") {
        const event = piDialogEvent(record, session.normalizer.events);
        if (event && typeof record.id === "string") { session.dialogs.set(record.id, record); yield event; }
      }
      for (const event of session.normalizer.normalize(record)) yield event;
    }
    const frontier = asRecord(await session.client.request("get_entries"));
    yield create({ type: "terminal", outcome: session.cancelled ? "cancelled" : session.normalizer.outcome,
      summary: "Pi turn settled", errorCode: session.normalizer.outcome === "failed" ? "pi_inference_failed" : null,
      checkpointRef: null, nativeTurnId: typeof frontier?.leafId === "string" ? frontier.leafId : null });
  }

  async cancel(session: PiSession): Promise<void> {
    session.cancelled = true;
    for (const id of session.dialogs.keys()) session.client.write({ type: "extension_ui_response", id, cancelled: true });
    session.dialogs.clear();
    await session.client.request("clear_queue");
    await session.client.request("abort");
  }
  async respondToPermission(session: PiSession, id: string, decision: PermissionDecision): Promise<AdapterEvent> {
    const request = this.dialog(session, id);
    if (request.method !== "confirm") throw new Error("Pi request is not a confirmation");
    session.client.write(piPermissionResponse(id, decision)); session.dialogs.delete(id);
    return session.normalizer.events.create({ type: "permission_resolved", permissionRequestId: id, decision });
  }
  async respondToInput(session: PiSession, id: string, response: InputResponse): Promise<AdapterEvent> {
    const request = this.dialog(session, id);
    if (request.method === "confirm") throw new Error("Pi request is not structured input");
    session.client.write(piInputResponse(id, response, request)); session.dialogs.delete(id);
    return session.normalizer.events.create({ type: "input_resolved", inputRequestId: id, outcome: response.outcome });
  }
  async close(session: PiSession): Promise<void> {
    await session.client.close(); session.queue.end(); await session.bridge.close(); this.session = null;
  }
  async shutdown(): Promise<void> { if (this.session) await this.close(this.session); }
  private dialog(session: PiSession, id: string): PiRecord {
    const request = session.dialogs.get(id);
    if (!request) throw new Error("Pi dialog is no longer pending");
    return request;
  }
  private spawn(args: string[], environment: NodeJS.ProcessEnv = {}): PiRpcClient {
    return PiRpcClient.spawn({ command: this.config.command, args: [...(this.config.args ?? []), "--mode", "rpc", ...args],
      ...(this.config.workingDirectory ? { cwd: this.config.workingDirectory } : {}),
      env: { ...process.env, ...this.config.environment, ...environment }, processGroup: "inherit" });
  }
}
