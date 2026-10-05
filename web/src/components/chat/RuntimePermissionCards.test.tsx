import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RuntimePermissionCards } from "./RuntimePermissionCards";

const testState = vi.hoisted(() => ({
  pending: [] as Array<Record<string, unknown>>,
  respond: vi.fn(async () => ({
    requestId: "permission_1",
    status: "responding",
    commandRecordId: "command_1",
  })),
}));

vi.mock("@convex/_generated/api", () => ({
  api: {
    runtime_host: {
      input_requests: { respond: "respondToRuntimeInput" },
      permissions: {
        listMyPending: "listMyPendingPermissions",
        respond: "respondToRuntimePermission",
      },
    },
  },
}));

vi.mock("convex/react", () => ({
  useQuery: () => testState.pending,
  useMutation: () => testState.respond,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === "runtime_permission_allow_session_help") {
        return "Applies within this active Codex session, but Codex may still ask about other actions. Future turns may ask again.";
      }
      if (typeof options?.name === "string") return `${key}:${options.name}`;
      if (typeof options?.decision === "string") return `${key}:${options.decision}`;
      return key;
    },
  }),
}));

function permission(overrides: Record<string, unknown> = {}) {
  return {
    requestId: "permission_1",
    chatId: "chat_1",
    messageId: "message_1",
    generationJobId: "job_1",
    runId: "run_1",
    attemptId: "attempt_1",
    chatParticipantId: "participant_1",
    permissionRequestId: "native_permission_1",
    permissionKind: "command_execution",
    prompt: "Run npm test in this repository?",
    choices: ["allow_once", "allow_session", "deny", "cancel"],
    status: "pending",
    createdAt: Date.now(),
    canRespond: true,
    ...overrides,
  };
}

const participants = [{
  id: "participant_1",
  modelId: "openai/gpt-5.6",
  personaName: "Developer",
}];

describe("RuntimePermissionCards", () => {
  beforeEach(() => {
    testState.pending = [];
    testState.respond.mockReset();
    testState.respond.mockResolvedValue({
      requestId: "permission_1",
      status: "responding",
      commandRecordId: "command_1",
    });
  });

  it("renders and answers a private helper request without a public generation job", async () => {
    const helper = permission({ messageId: "user_message_1" });
    delete (helper as Record<string, unknown>).generationJobId;
    testState.pending = [helper];
    render(<RuntimePermissionCards chatId={"chat_1" as never} participants={participants} />);
    expect(screen.getByText("Run npm test in this repository?")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "runtime_permission_allow_once" }));
    await waitFor(() => expect(testState.respond).toHaveBeenCalledWith({ requestId: "permission_1", decision: "allow_once" }));
  });

  it("shows only supported backend-returned choices and identifies the participant", () => {
    testState.pending = [permission({ choices: ["allow_once", "deny", "cancel"] })];
    render(<RuntimePermissionCards chatId={"chat_1" as never} participants={participants} />);

    expect(screen.getByText("runtime_permission_named_title:Developer")).toBeVisible();
    expect(screen.getByText("Run npm test in this repository?")).toBeVisible();
    expect(screen.getByRole("button", { name: "runtime_permission_allow_once" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "runtime_permission_deny" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "runtime_permission_allow_session" }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "runtime_permission_cancel_request" }))
      .toBeEnabled();
  });

  it("attributes a child permission beneath the public participant without adding controls", () => {
    testState.pending = [permission({
      nativeAgentThreadId: "native_thread_reviewer_1",
      nativeAgent: {
        origin: "codex_native_agent",
        nativeThreadId: "native_thread_reviewer_1",
        label: "Scout · Reviewer",
        nickname: "Scout",
        role: "Reviewer",
      },
    })];

    render(<RuntimePermissionCards chatId={"chat_1" as never} participants={participants} />);

    expect(screen.getByText("runtime_permission_named_title:Developer")).toBeVisible();
    expect(screen.getByTestId("runtime-permission-native-agent"))
      .toHaveTextContent("runtime_permission_native_agent_origin");
    expect(screen.getByTestId("runtime-permission-native-agent"))
      .toHaveTextContent("Scout · Reviewer");
    expect(screen.getByTestId("runtime-permission-native-agent"))
      .toHaveAttribute("title", "native_thread_reviewer_1");
    expect(screen.getAllByRole("button")).toHaveLength(4);
    expect(screen.queryByRole("button", { name: /stop|steer/i })).not.toBeInTheDocument();
  });

  it("sends the exact decision and keeps a failed response visible and retryable", async () => {
    let rejectResponse: ((reason: Error) => void) | undefined;
    testState.respond.mockImplementationOnce(() => new Promise((_, reject) => {
      rejectResponse = reject;
    }));
    testState.pending = [permission()];
    render(<RuntimePermissionCards chatId={"chat_1" as never} participants={participants} />);

    fireEvent.click(screen.getByRole("button", { name: "runtime_permission_cancel_request" }));
    expect(screen.getByRole("button", { name: "runtime_permission_sending" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "runtime_permission_allow_once" })).toBeDisabled();
    await act(async () => rejectResponse?.(new Error("Runtime Host disconnected")));
    expect(await screen.findByRole("alert")).toHaveTextContent("Runtime Host disconnected");
    expect(screen.getByRole("button", { name: "runtime_permission_cancel_request" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "runtime_permission_cancel_request" }));

    await waitFor(() => expect(testState.respond).toHaveBeenLastCalledWith({
      requestId: "permission_1",
      decision: "cancel",
    }));
    expect(testState.respond).toHaveBeenCalledTimes(2);
  });

  it("describes session scope narrowly while a decision is being delivered", () => {
    testState.pending = [permission({
      status: "responding",
      requestedDecision: "allow_session",
      canRespond: false,
      unavailableReason: "response_pending",
    })];
    render(<RuntimePermissionCards chatId={"chat_1" as never} participants={participants} />);

    expect(screen.getByText(
      "Applies within this active Codex session, but Codex may still ask about other actions. Future turns may ask again.",
    )).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "runtime_permission_response_pending:runtime_permission_allow_session",
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows backend-derived unavailability without offering a response", () => {
    testState.pending = [permission({
      canRespond: false,
      unavailableReason: "runtime_host_offline",
    })];
    render(<RuntimePermissionCards chatId={"chat_1" as never} participants={participants} />);

    expect(screen.getByText("runtime_permission_unavailable_runtime_host_offline"))
      .toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("answers a native structured request with the existing fenced controller API", async () => {
    testState.pending = [permission({ choices: [], inputForm: { source: "request_user_input", fields: [{ id: "destination", label: "Where?", type: "string", required: true, secret: true, options: ["A"] }] } })];
    render(<RuntimePermissionCards chatId={"chat_1" as never} participants={participants} />);
    const field = screen.getByLabelText("Where?");
    expect(field).toHaveAttribute("type", "password");
    fireEvent.change(field, { target: { value: "Lake Silverpine" } });
    fireEvent.click(screen.getByRole("button", { name: "accept" }));
    await waitFor(() => expect(testState.respond).toHaveBeenCalledWith({ requestId: "permission_1", outcome: "submitted", content: JSON.stringify({ destination: "Lake Silverpine" }) }));
  });

  it.each(["number", "integer"])("omits a cleared optional %s while preserving zero and false", async type => {
    testState.pending = [permission({
      choices: [],
      inputForm: {
        source: "mcp_elicitation",
        fields: [
          { id: "amount", label: "Amount", type, required: false, secret: false, options: [] },
          { id: "count", label: "Count", type: "integer", required: false, secret: false, options: [] },
          { id: "ready", label: "Ready", type: "boolean", required: false, secret: false, options: [] },
        ],
      },
    })];
    render(<RuntimePermissionCards chatId={"chat_1" as never} participants={participants} />);
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "12" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Count"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "accept" }));
    await waitFor(() => expect(testState.respond).toHaveBeenCalledWith({
      requestId: "permission_1", outcome: "submitted",
      content: JSON.stringify({ count: 0, ready: false }),
    }));
  });

});
