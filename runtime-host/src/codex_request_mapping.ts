import { asRecord, stringAt } from "./codex_event_items.ts";
import type {
  AdapterEvent,
  PermissionDecision,
  StructuredInput,
} from "./protocol.ts";

export type PendingNativeRequest = {
  method: string;
  params: unknown;
};

type EventCreator = (fields: Record<string, unknown>) => AdapterEvent;

export function normalizeNativeRequest(
  id: string | number,
  method: string,
  params: unknown,
  create: EventCreator,
  nativeAgentThreadId: string | null = null,
): AdapterEvent {
  const record = asRecord(params);
  if (method === "item/tool/requestUserInput") {
    const questions = Array.isArray(record?.questions) ? record.questions : [];
    return create({
      type: "input_requested",
      inputRequestId: String(id),
      nativeAgentThreadId,
      source: "request_user_input",
      prompt: "Codex requested structured user input",
      requestSchema: { questions, ...(typeof record?.isBlocking === "boolean" ? { isBlocking: record.isBlocking } : {}) },
      sensitiveFieldPaths: secretQuestionPaths(questions),
    });
  }
  if (method === "mcpServer/elicitation/request") {
    const serverName = stringAt(record, "serverName") ?? "unknown";
    const mode = stringAt(record, "mode") ?? "unknown";
    const message = stringAt(record, "message") ?? `MCP server ${serverName} requested input`;
    return create({
      type: "input_requested",
      inputRequestId: String(id),
      nativeAgentThreadId,
      source: "mcp_elicitation",
      prompt: message.slice(0, 4_000),
      requestSchema: mcpRequestSchema(record, serverName, mode),
      sensitiveFieldPaths: [],
    });
  }
  if (!APPROVAL_METHODS.has(method)) throw new Error(`Unsupported server request: ${method}`);
  const prompt = stringAt(record, "reason") ?? stringAt(record, "command")
    ?? "Codex requested permission";
  return create({
    type: "permission_requested",
    permissionRequestId: String(id),
    nativeAgentThreadId,
    toolCallId: stringAt(record, "itemId"),
    permissionKind: permissionKind(method),
    prompt: prompt.slice(0, 4_000),
    choices: ["allow_once", "allow_session", "deny", "cancel"],
    expiresAt: null,
  });
}

export function mapNativePermissionResponse(
  pending: PendingNativeRequest,
  decision: PermissionDecision,
): unknown {
  if (pending.method === "item/permissions/requestApproval") {
    if (decision === "deny" || decision === "cancel") {
      return { permissions: {}, scope: "turn" };
    }
    const permissions = asRecord(pending.params)?.permissions ?? {};
    return { permissions, scope: decision === "allow_session" ? "session" : "turn" };
  }
  return { decision: approvalDecision(decision) };
}

export function mapNativeInputResponse(
  pending: PendingNativeRequest,
  response: { outcome: "submitted"; content: StructuredInput }
    | { outcome: "cancelled"; content: null },
): unknown {
  if (pending.method === "item/tool/requestUserInput") {
    return response.outcome === "cancelled"
      ? { answers: {} }
      : { answers: requestUserInputAnswers(response.content) };
  }
  if (pending.method === "mcpServer/elicitation/request") {
    const mode = stringAt(asRecord(pending.params), "mode");
    const content = response.outcome === "submitted" && mode !== "url"
      ? response.content : null;
    return {
      action: response.outcome === "cancelled" ? "cancel" : "accept",
      content,
      _meta: null,
    };
  }
  throw new Error(`Request method ${pending.method} is not structured input`);
}

const APPROVAL_METHODS = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
]);

function permissionKind(method: string): string {
  if (method.includes("commandExecution")) return "command_execution";
  if (method.includes("fileChange")) return "file_change";
  return "permissions";
}

function approvalDecision(decision: PermissionDecision): string {
  if (decision === "allow_once") return "accept";
  if (decision === "allow_session") return "acceptForSession";
  if (decision === "deny") return "decline";
  return "cancel";
}

function secretQuestionPaths(questions: unknown[]): string[] {
  return questions.flatMap((question) => {
    const record = asRecord(question);
    const id = stringAt(record, "id");
    return record?.isSecret === true && id !== null ? [`answers.${id}`] : [];
  });
}

function requestUserInputAnswers(content: StructuredInput): Record<string, { answers: string[] }> {
  const source = asRecord(content.answers) ?? content;
  const answers: Record<string, { answers: string[] }> = {};
  for (const [id, value] of Object.entries(source)) {
    const raw = asRecord(value)?.answers ?? value;
    const values = Array.isArray(raw) ? raw : [raw];
    answers[id] = {
      answers: values.filter((item): item is string => typeof item === "string"),
    };
  }
  return answers;
}

function mcpRequestSchema(
  record: Record<string, unknown> | null,
  serverName: string,
  mode: string,
): Record<string, unknown> {
  if (mode === "url") {
    return {
      mode,
      serverName,
      url: stringAt(record, "url") ?? "",
      elicitationId: stringAt(record, "elicitationId") ?? "",
      metadata: record?._meta ?? null,
    };
  }
  return {
    mode,
    serverName,
    requestedSchema: record?.requestedSchema ?? {},
    metadata: record?._meta ?? null,
  };
}
