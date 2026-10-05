import { undeliveredPacket, type NativeReuse } from "./native_context_reuse.ts";

import { canonicalCodexCapabilities } from "./canonical_capabilities.ts";
import {
  CanonicalCodexAdapter,
  type CanonicalCodexSession,
} from "./canonical_codex_adapter.ts";
import { CodexAdapter } from "./codex_adapter.ts";
import {
  APP_SERVER_CAPABILITIES,
  type CodexRequirements,
} from "./codex_capabilities.ts";
import type { CodexModel, CodexTransportName } from "./codex_transport.ts";
import { LocalRuntimePartResolver } from "./local_runtime_part_resolver.ts";
import type {
  AdapterCapabilities,
  AdapterEvent,
  AdapterModelDescriptor,
  LocalRuntimeTurnPacket,
  PermissionDecision,
  StructuredInput,
} from "./protocol.ts";
import { CodexAppServerTransport } from "./transports/codex_app_server_transport.ts";

export type CodexWorkerConfig = {
  cliVersion?: string;
  transport: CodexTransportName;
  codexCommand?: string;
  codexArgs?: string[];
  threadName?: string;
  attachmentDirectory?: string;
  sandboxMode?: "read-only" | "workspace-write" | "danger-full-access";
  workingDirectory?: string;
};

export type CodexWorkerOpenResult = {
  session: CanonicalCodexSession;
  threadNameDiagnostic: string | null;
  resumed: boolean;
  replacementReason?: "native_frontier_changed";
};

export class CodexWorkerBackend {
  readonly capabilities: AdapterCapabilities;
  private readonly raw: CodexAdapter;
  private readonly canonical: CanonicalCodexAdapter;
  private readonly requirements: CodexRequirements;
  private readonly appServer: CodexAppServerTransport;
  private readonly threadName: string | undefined;
  private readonly attachmentDirectory: string | undefined;
  private readonly sandboxMode: CodexWorkerConfig["sandboxMode"];
  private readonly workingDirectory: string | undefined;

  constructor(config: CodexWorkerConfig) {
    if (config.threadName !== undefined
      && (config.threadName.length === 0 || config.threadName.length > 512)) {
      throw new Error("Codex thread name must contain 1 to 512 characters");
    }
    if (config.transport !== "app_server_stdio") throw new Error("The supported worker requires Codex App Server");
    const capability = APP_SERVER_CAPABILITIES;
    this.capabilities = { ...canonicalCodexCapabilities(capability), ...(config.cliVersion ? { adapterVersion: config.cliVersion } : {}) };
    this.sandboxMode = config.sandboxMode;
    this.workingDirectory = config.workingDirectory;
    this.threadName = config.threadName;
    this.attachmentDirectory = config.attachmentDirectory;
    this.appServer = CodexAppServerTransport.spawn({
        command: config.codexCommand ?? "codex",
        args: config.codexArgs ?? [],
      });
    this.raw = new CodexAdapter([this.appServer]);
    this.canonical = new CanonicalCodexAdapter(this.raw, {
      onLocalDiagnostic: writeLocalDiagnostic,
      onLocalWarning: writeLocalWarning,
    });
    this.requirements = {
      preferredTransport: config.transport,
    };
  }

  bindTools(handler: (request: unknown) => Promise<unknown>): void {
    this.appServer.toolHandler = handler;
  }

  async probe(): Promise<{ healthy: boolean; summary: string }> {
    const result = (await this.raw.probe())[0];
    if (result === undefined) return { healthy: false, summary: "Codex transport is unavailable" };
    return {
      healthy: result.available,
      summary: result.available
        ? "Transport process is reachable; authentication was not exercised"
        : "Transport process probe failed",
    };
  }

  async listModels(): Promise<CodexModel[]> {
    return this.raw.listModels(this.requirements);
  }

  async canonicalModels(): Promise<AdapterModelDescriptor[]> {
    return (await this.listModels()).map((model) => ({
      provider: "openai", modelId: model.model, displayName: model.displayName,
      availability: model.hidden ? "unavailable" : "available",
      unavailableReason: model.hidden ? "Model is hidden by the adapter" : null,
      inputModalities: model.inputModalities.includes("image") ? ["text", "image"] : ["text"],
      supportsTools: true, supportsReasoning: true,
    }));
  }

  async open(
    packet: LocalRuntimeTurnPacket,
    sessionId: string,
    nativeSessionId: string | null,
    reuse?: NativeReuse,
  ): Promise<CodexWorkerOpenResult> {
    let replacementReason: "native_frontier_changed" | undefined;
    if (nativeSessionId && reuse) {
      if (!reuse.expectedNativeTurnId || !await this.appServer.matchesNativeFrontier(nativeSessionId, reuse.expectedNativeTurnId)) {
        nativeSessionId = null;
        replacementReason = "native_frontier_changed";
      } else {
        packet = undeliveredPacket(packet, reuse.deliveredMessageIds ?? []);
      }
    }
    const input = {
      packet,
      sessionId,
      requirements: this.requirements,
      ...(this.attachmentDirectory === undefined
        ? {} : { resolver: new LocalRuntimePartResolver(this.attachmentDirectory) }),
      ...(this.sandboxMode === undefined ? {} : { sandboxMode: this.sandboxMode }),
      ...(this.workingDirectory === undefined
        ? {} : { workingDirectory: this.workingDirectory }),
    };
    const session = nativeSessionId === null
      ? this.canonical.startSession(input)
      : this.canonical.resumeSession(nativeSessionId, input);
    const canonical = await session;
    return {
      session: canonical,
      resumed: nativeSessionId !== null,
      ...(replacementReason ? { replacementReason } : {}),
      threadNameDiagnostic: await this.applyThreadName(canonical),
    };
  }

  nativeSessionId(session: CanonicalCodexSession): string | null {
    return this.canonical.nativeSessionId(session);
  }

  sendTurn(session: CanonicalCodexSession): AsyncIterable<AdapterEvent> {
    return this.canonical.sendTurn(session);
  }

  cancel(session: CanonicalCodexSession): Promise<void> {
    return this.canonical.cancel(session);
  }

  respondToPermission(
    session: CanonicalCodexSession,
    requestId: string,
    decision: PermissionDecision,
  ): Promise<AdapterEvent> {
    return this.canonical.respondToPermission(session, requestId, decision);
  }

  respondToInput(
    session: CanonicalCodexSession,
    requestId: string,
    response: { outcome: "submitted"; content: StructuredInput }
      | { outcome: "cancelled"; content: null },
  ): Promise<AdapterEvent> {
    return this.canonical.respondToInput(session, requestId, response);
  }

  async close(session: CanonicalCodexSession): Promise<void> {
    await this.canonical.close(session);
  }

  async shutdown(): Promise<void> {
    await this.appServer.closeProcess();
  }

  private async applyThreadName(session: CanonicalCodexSession): Promise<string | null> {
    if (this.threadName === undefined) return null;
    const threadId = this.canonical.nativeSessionId(session);
    if (threadId === null) return "Native Codex thread ID was unavailable for naming";
    try {
      await this.appServer.setThreadName(threadId, this.threadName);
      return null;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return `Native Codex thread name could not be updated: ${detail.slice(0, 1_000)}`;
    }
  }
}

function writeLocalWarning(message: string): void {
  process.stderr.write(`[Codex App Server warning] ${JSON.stringify(message)}\n`);
}

function writeLocalDiagnostic(error: Error): void {
  process.stderr.write(`[Codex App Server error] ${JSON.stringify(error.message)}\n`);
}
