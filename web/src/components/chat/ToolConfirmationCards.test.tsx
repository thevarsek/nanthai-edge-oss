import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ExecutionProjection } from "@/hooks/useChat";
import { ToolConfirmationCards } from "./ToolConfirmationCards";
import { formatConfirmationCountdown, pendingToolConfirmations } from "./toolConfirmationProjection";

const testState = vi.hoisted(() => ({
  respond: vi.fn<(args: unknown) => Promise<unknown>>(async () => ({ status: "approved" })),
}));

vi.mock("@convex/_generated/api", () => ({
  api: { tool_confirmations: { mutations: { respond: "respondToToolConfirmation" } } },
}));

vi.mock("convex/react", () => ({
  useMutation: () => testState.respond,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      typeof options?.time === "string" ? `${key}:${options.time}` : key,
  }),
}));

// Live-shaped projection: Convex numbers arrive as doubles and optional
// future fields may be present.
function run(overrides: Partial<ExecutionProjection> = {}): ExecutionProjection {
  return JSON.parse(JSON.stringify({
    runId: "run_1",
    state: "running",
    placement: "cloud",
    updatedAt: 1800000000000.0,
    cancelAvailable: true,
    cancelRequested: false,
    needsInput: false,
    needsPermission: true,
    futureField: { nested: 1.0 },
    pendingConfirmation: {
      confirmationId: "confirmation_1",
      kind: "external_send",
      toolName: "gmail_send",
      summary: "Q3 numbers",
      detail: "Attached are the Q3 numbers.",
      recipients: ["mallory@example.com"],
      integrations: [],
      expiresAt: Date.now() + 90_000.0,
      createdAt: 1800000000000.0,
    },
    ...overrides,
  })) as ExecutionProjection;
}

describe("ToolConfirmationCards", () => {
  beforeEach(() => {
    testState.respond.mockClear();
    testState.respond.mockImplementation(async () => ({ status: "approved" }));
  });

  it("renders nothing without pending confirmations", () => {
    const { container } = render(<ToolConfirmationCards runs={[run({ pendingConfirmation: undefined })]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the action, recipients and countdown and approves", async () => {
    render(<ToolConfirmationCards runs={[run()]} />);
    expect(screen.getByText("tool_confirmation_title_external_send")).toBeInTheDocument();
    expect(screen.getByText("Q3 numbers")).toBeInTheDocument();
    expect(screen.getByText("mallory@example.com")).toBeInTheDocument();
    expect(screen.getByText(/^tool_confirmation_countdown:1:(29|30)$/)).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "tool_confirmation_approve" })); });
    expect(testState.respond).toHaveBeenCalledWith({ confirmationId: "confirmation_1", decision: "approve" });
  });

  it("denies and surfaces a failed response", async () => {
    testState.respond.mockImplementation(async () => { throw new Error("offline"); });
    render(<ToolConfirmationCards runs={[run({
      pendingConfirmation: { ...run().pendingConfirmation!, kind: "scheduled_job", recipients: [], integrations: ["gmail", "web_search"] },
    })]} />);
    expect(screen.getByText("tool_confirmation_title_scheduled_job")).toBeInTheDocument();
    expect(screen.getByText("tool_confirmation_web_search")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "tool_confirmation_deny" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(testState.respond).toHaveBeenCalledWith({ confirmationId: "confirmation_1", decision: "deny" });
  });
});

describe("tool confirmation helpers", () => {
  it("orders confirmations oldest first across runs", () => {
    const newer = run({ runId: "run_2", pendingConfirmation: { ...run().pendingConfirmation!, confirmationId: "c2", createdAt: 2.0e12 } });
    expect(pendingToolConfirmations([newer, run()]).map((item) => item.confirmationId)).toEqual(["confirmation_1", "c2"]);
  });

  it("formats the countdown and clamps at zero", () => {
    expect(formatConfirmationCountdown(125_000, 0)).toBe("2:05");
    expect(formatConfirmationCountdown(0, 5_000)).toBe("0:00");
  });
});
