import {
  CodexCapabilityPreflightError,
  selectCodexTransport,
  type CodexRequirements,
} from "./codex_capabilities.ts";
import type {
  CodexInputModality,
  CodexInputPart,
  CodexModel,
  CodexTransport,
  CodexTransportCapabilities,
  CodexTransportEvent,
  CodexTransportName,
  CodexTransportSession,
  StartCodexSessionInput,
} from "./codex_transport.ts";

export type CodexAdapterSession = {
  readonly transport: CodexTransportName;
  readonly native: CodexTransportSession;
};

export type CodexAdapterStart = StartCodexSessionInput & {
  requirements?: CodexRequirements;
};

export type CodexProbeResult = {
  transport: CodexTransportName;
  available: boolean;
  capabilities: CodexTransportCapabilities;
  error: string | null;
};

export class CodexAdapter {
  private readonly transports: Map<CodexTransportName, CodexTransport>;

  constructor(transports: readonly CodexTransport[]) {
    this.transports = new Map(transports.map((transport) => [transport.name, transport]));
    if (this.transports.size !== transports.length) {
      throw new Error("Codex transport names must be unique");
    }
  }

  async probe(): Promise<CodexProbeResult[]> {
    return Promise.all([...this.transports.values()].map(async (transport) => {
      try {
        const capabilities = await transport.probe();
        return {
          transport: transport.name,
          available: true,
          capabilities,
          error: null,
        };
      } catch (error) {
        return {
          transport: transport.name,
          available: false,
          capabilities: transport.capabilities,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }));
  }

  async listModels(requirements: CodexRequirements): Promise<CodexModel[]> {
    const transport = this.select({
      ...requirements,
      operations: [...(requirements.operations ?? []), "list_models"],
    });
    return transport.listModels();
  }

  async startSession(input: CodexAdapterStart): Promise<CodexAdapterSession> {
    const transport = this.select(input.requirements ?? {});
    return {
      transport: transport.name,
      native: await transport.startSession(input),
    };
  }

  async resumeSession(
    nativeSessionId: string,
    input: CodexAdapterStart,
  ): Promise<CodexAdapterSession> {
    const transport = this.select({
      ...(input.requirements ?? {}),
      operations: [...(input.requirements?.operations ?? []), "resume"],
    });
    return {
      transport: transport.name,
      native: await transport.resumeSession(nativeSessionId, input),
    };
  }

  sendTurn(
    session: CodexAdapterSession,
    input: readonly CodexInputPart[],
  ): AsyncIterable<CodexTransportEvent> {
    const transport = this.forSession(session);
    const missing = input
      .map(inputModality)
      .filter((modality) => !transport.capabilities.inputModalities.includes(modality));
    if (missing.length > 0) {
      throw new CodexCapabilityPreflightError(
        [...new Set(missing)].map((modality) => `${transport.name} lacks input:${modality}`),
      );
    }
    return transport.sendTurn(session.native, input);
  }

  async cancel(session: CodexAdapterSession): Promise<void> {
    await this.forSession(session).cancel(session.native);
  }

  async respondToApproval(
    session: CodexAdapterSession,
    requestId: string | number,
    response: unknown,
  ): Promise<void> {
    await this.forSession(session).respondToApproval(session.native, requestId, response);
  }

  async respondToInput(
    session: CodexAdapterSession,
    requestId: string | number,
    response: unknown,
  ): Promise<void> {
    await this.forSession(session).respondToInput(session.native, requestId, response);
  }

  async close(session: CodexAdapterSession): Promise<void> {
    await this.forSession(session).close(session.native);
  }

  private select(requirements: CodexRequirements): CodexTransport {
    const available = [...this.transports.values()].map((entry) => entry.capabilities);
    const name = selectCodexTransport(requirements, available);
    const transport = this.transports.get(name);
    if (transport === undefined) {
      throw new Error(`Selected Codex transport is unavailable: ${name}`);
    }
    return transport;
  }

  private forSession(session: CodexAdapterSession): CodexTransport {
    const transport = this.transports.get(session.transport);
    if (transport === undefined || session.native.transport !== session.transport) {
      throw new Error("Codex session transport provenance is invalid");
    }
    return transport;
  }
}

function inputModality(input: CodexInputPart): CodexInputModality {
  return input.type;
}
