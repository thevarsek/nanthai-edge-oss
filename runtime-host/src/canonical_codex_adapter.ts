import { BRIDGE_TOOLS } from "./protocol.ts";
import { CodexAdapter, type CodexAdapterSession } from "./codex_adapter.ts";
import {
  APP_SERVER_CAPABILITIES,
  selectCodexTransport,
  type CodexRequirements,
} from "./codex_capabilities.ts";
import { canonicalCodexCapabilities } from "./canonical_capabilities.ts";
import { CodexEventNormalizer } from "./codex_event_normalizer.ts";
import type {
  CodexTransportName,
} from "./codex_transport.ts";
import {
  translateRuntimeTurnPacket,
  type RuntimePartResolver,
  type TranslatedCodexTurn,
} from "./packet_translation.ts";
import type {
  AdapterCapabilities,
  AdapterEvent,
  PermissionDecision,
  StructuredInput,
} from "./protocol.ts";

export type CanonicalCodexStart = {
  sessionId: string;
  packet: unknown;
  requirements?: CodexRequirements;
  resolver?: RuntimePartResolver;
  sandboxMode?: "read-only" | "workspace-write" | "danger-full-access";
  workingDirectory?: string;
};

export type CanonicalCodexSession = {
  readonly sessionId: string;
  readonly transport: CodexTransportName;
  readonly fidelity: TranslatedCodexTurn["fidelity"];
  readonly capabilities: AdapterCapabilities;
};

type SessionState = {
  raw: CodexAdapterSession;
  turn: TranslatedCodexTurn;
  normalizer: CodexEventNormalizer;
  resumed: boolean;
};

export type CanonicalCodexAdapterOptions = {
  onLocalDiagnostic?: (error: Error) => void;
  onLocalWarning?: (message: string) => void;
};

export class CanonicalCodexAdapter {
  private readonly states = new WeakMap<CanonicalCodexSession, SessionState>();

  constructor(
    private readonly adapter: CodexAdapter,
    private readonly options: CanonicalCodexAdapterOptions = {},
  ) {}

  async startSession(input: CanonicalCodexStart): Promise<CanonicalCodexSession> {
    return this.open(input, null);
  }

  async resumeSession(
    nativeSessionId: string,
    input: CanonicalCodexStart,
  ): Promise<CanonicalCodexSession> {
    return this.open(input, nativeSessionId);
  }

  async *sendTurn(session: CanonicalCodexSession): AsyncIterable<AdapterEvent> {
    const state = this.state(session);
    for (const event of state.normalizer.initialEvents(state.resumed)) yield event;
    const iterator = this.adapter.sendTurn(state.raw, state.turn.input)[Symbol.asyncIterator]();
    try {
      for (;;) {
        const next = await iterator.next();
        if (next.done) break;
        for (const event of state.normalizer.normalize(next.value)) yield event;
      }
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      this.options.onLocalDiagnostic?.(failure);
      try {
        await this.adapter.cancel(state.raw);
      } catch (cancelError) {
        this.options.onLocalDiagnostic?.(
          cancelError instanceof Error ? cancelError : new Error(String(cancelError)),
        );
      }
      await iterator.return?.();
      for (const event of state.normalizer.interrupted()) yield event;
    }
  }

  async cancel(session: CanonicalCodexSession): Promise<void> {
    const state = this.state(session);
    state.normalizer.markCancelRequested();
    await this.adapter.cancel(state.raw);
  }

  async respondToPermission(
    session: CanonicalCodexSession,
    requestId: string | number,
    decision: PermissionDecision,
  ): Promise<AdapterEvent> {
    const state = this.state(session);
    const response = state.normalizer.nativePermissionResponse(requestId, decision);
    const nativeRequestId = state.normalizer.nativeRequestId(requestId);
    await this.adapter.respondToApproval(state.raw, nativeRequestId, response);
    return state.normalizer.permissionResolved(requestId, decision);
  }

  async respondToInput(
    session: CanonicalCodexSession,
    requestId: string | number,
    response: { outcome: "submitted"; content: StructuredInput }
      | { outcome: "cancelled"; content: null },
  ): Promise<AdapterEvent> {
    const state = this.state(session);
    const native = state.normalizer.nativeInputResponse(requestId, response);
    const nativeRequestId = state.normalizer.nativeRequestId(requestId);
    await this.adapter.respondToInput(state.raw, nativeRequestId, native);
    return state.normalizer.inputResolved(requestId, response.outcome);
  }

  async close(session: CanonicalCodexSession): Promise<void> {
    const state = this.state(session);
    await this.adapter.close(state.raw);
    this.states.delete(session);
  }

  nativeSessionId(session: CanonicalCodexSession): string | null {
    return this.state(session).raw.native.nativeSessionId;
  }

  private async open(
    input: CanonicalCodexStart,
    nativeSessionId: string | null,
  ): Promise<CanonicalCodexSession> {
    const requirements = input.requirements ?? {};
    const transport = selectCodexTransport(requirements);
    const rawCapabilities = APP_SERVER_CAPABILITIES;
    const turn = await translateRuntimeTurnPacket(input.packet, rawCapabilities, input.resolver);
    const selectedModel = turn.packet.placement.selectedModel;
    const enrichedRequirements: CodexRequirements = {
      ...requirements,
      preferredTransport: transport,
      ...(transport === "app_server_stdio"
        ? { operations: [...(requirements.operations ?? []), "respond_to_approval"] as const }
        : {}),
      inputModalities: [
        ...(requirements.inputModalities ?? []),
        ...turn.input.map((part) => part.type),
      ],
    };
    const startInput = {
      requirements: enrichedRequirements,
      approvalPolicy: "on-request" as const,
      ...(input.sandboxMode === undefined ? {} : { sandboxMode: input.sandboxMode }),
      ...(input.workingDirectory === undefined
        ? {} : { workingDirectory: input.workingDirectory }),
      ...(selectedModel.mode === "explicit" && selectedModel.modelId !== null
        ? { model: selectedModel.modelId } : {}),
      ...turn.sessionContext,
      dynamicTools: BRIDGE_TOOLS.filter((tool) => turn.packet.capabilities.nanthaiTools.some((item) => item.id === tool.name)),
    };
    const raw = nativeSessionId === null
      ? await this.adapter.startSession(startInput)
      : await this.adapter.resumeSession(nativeSessionId, startInput);
    const session: CanonicalCodexSession = {
      sessionId: input.sessionId,
      transport,
      fidelity: turn.fidelity,
      capabilities: canonicalCodexCapabilities(rawCapabilities),
    };
    this.states.set(session, {
      raw,
      turn,
      normalizer: new CodexEventNormalizer(
        turn.packet, input.sessionId, raw.native, Date.now, this.options.onLocalWarning,
      ),
      resumed: nativeSessionId !== null,
    });
    return session;
  }

  private state(session: CanonicalCodexSession): SessionState {
    const state = this.states.get(session);
    if (state === undefined) throw new Error("Unknown canonical Codex session");
    return state;
  }
}
