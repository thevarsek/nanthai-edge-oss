import type { NativeReuse } from "./native_context_reuse.ts";
import type {
  AdapterCapabilities, AdapterEvent, AdapterModelDescriptor, LocalRuntimeTurnPacket,
  PermissionDecision, StructuredInput,
} from "./protocol.ts";

export type InputResponse = { outcome: "submitted"; content: StructuredInput }
  | { outcome: "cancelled"; content: null };

export interface WorkerBackend<Session> {
  readonly capabilities: AdapterCapabilities;
  bindTools(handler: (request: unknown) => Promise<unknown>): void;
  probe(): Promise<{ healthy: boolean; summary: string }>;
  canonicalModels(): Promise<AdapterModelDescriptor[]>;
  open(packet: LocalRuntimeTurnPacket, sessionId: string, nativeSessionId: string | null,
    reuse?: NativeReuse): Promise<{
      session: Session; resumed: boolean; threadNameDiagnostic: string | null;
      replacementReason?: "native_frontier_changed";
    }>;
  nativeSessionId(session: Session): string | null;
  sendTurn(session: Session): AsyncIterable<AdapterEvent>;
  cancel(session: Session): Promise<void>;
  respondToPermission(session: Session, requestId: string, decision: PermissionDecision): Promise<AdapterEvent>;
  respondToInput(session: Session, requestId: string, response: InputResponse): Promise<AdapterEvent>;
  close(session: Session): Promise<void>;
  shutdown(): Promise<void>;
}
