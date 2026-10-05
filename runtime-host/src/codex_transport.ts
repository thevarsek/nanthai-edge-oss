export type CodexTransportName = "app_server_stdio";

export type CodexInputModality =
  | "text"
  | "local_image"
  | "remote_image"
  | "local_audio"
  | "remote_audio"
  | "document"
  | "video";

export type CodexInputPart =
  | { type: "text"; text: string }
  | { type: "local_image"; path: string }
  | { type: "remote_image"; url: string }
  | { type: "local_audio"; path: string }
  | { type: "remote_audio"; url: string };

export type CodexEventFeature =
  | "item_lifecycle"
  | "text_delta"
  | "reasoning_delta"
  | "tool_progress"
  | "command_output_delta"
  | "diff_delta"
  | "approval_request"
  | "usage"
  | "model_reroute"
  | "native_agent_activity";

export type CodexOperation =
  | "cancel"
  | "resume"
  | "respond_to_approval"
  | "respond_to_structured_input"
  | "respond_to_mcp_elicitation"
  | "list_models"
  | "account_usage"
  | "mcp"
  | "plugins"
  | "web_search";

export type CodexTransportCapabilities = {
  transport: CodexTransportName;
  inputModalities: readonly CodexInputModality[];
  events: readonly CodexEventFeature[];
  operations: readonly CodexOperation[];
};

export type CodexTransportEvent =
  | { type: "notification"; method: string; params?: unknown }
  | { type: "server_request"; requestId: number | string; method: string; params?: unknown };

export type CodexTransportSession = {
  transport: CodexTransportName;
  nativeSessionId: string | null;
  model: string | null;
  provider: string | null;
  workingDirectory: string | null;
};

export type StartCodexSessionInput = {
  workingDirectory?: string;
  model?: string;
  approvalPolicy?: "never" | "on-request" | "on-failure" | "untrusted";
  sandboxMode?: "read-only" | "workspace-write" | "danger-full-access";
  baseInstructions?: string;
  developerInstructions?: string;
  injectedHistory?: readonly Record<string, unknown>[];
  dynamicTools?: readonly Record<string, unknown>[];
  webSearch?: "live";
};

export type CodexModel = {
  id: string;
  model: string;
  displayName: string;
  inputModalities: string[];
  hidden: boolean;
  isDefault: boolean;
};

export interface CodexTransport {
  readonly name: CodexTransportName;
  readonly capabilities: CodexTransportCapabilities;
  probe(): Promise<CodexTransportCapabilities>;
  listModels(): Promise<CodexModel[]>;
  startSession(input: StartCodexSessionInput): Promise<CodexTransportSession>;
  resumeSession(
    nativeSessionId: string,
    input: StartCodexSessionInput,
  ): Promise<CodexTransportSession>;
  sendTurn(
    session: CodexTransportSession,
    input: readonly CodexInputPart[],
  ): AsyncIterable<CodexTransportEvent>;
  cancel(session: CodexTransportSession): Promise<void>;
  respondToApproval(
    session: CodexTransportSession,
    requestId: string | number,
    response: unknown,
  ): Promise<void>;
  respondToInput(
    session: CodexTransportSession,
    requestId: string | number,
    response: unknown,
  ): Promise<void>;
  close(session: CodexTransportSession): Promise<void>;
}
