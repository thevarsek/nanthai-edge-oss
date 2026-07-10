import { useState } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { ChatAdvisorsResult } from "@/advisors/types";
import { useAdvisorComposer } from "@/hooks/useAdvisorComposer";

const testState = vi.hoisted(() => ({
  results: new Map<string, ChatAdvisorsResult | undefined>(),
  setChatAdvisors: vi.fn(async () => ({ advisors: [] })),
  removeChatAdvisor: vi.fn(async () => ({ removed: true })),
}));

vi.mock("@convex/_generated/api", () => ({
  api: {
    advisors: {
      queries: { listChatAdvisors: "listChatAdvisors" },
      mutations: { setChatAdvisors: "setChatAdvisors", removeChatAdvisor: "removeChatAdvisor" },
    },
  },
}));

vi.mock("convex/react", () => ({
  useQuery: (_query: string, args: { chatId?: string } | "skip") => (
    args === "skip" || !args.chatId ? undefined : testState.results.get(String(args.chatId))
  ),
  useMutation: (mutation: string) => (
    mutation === "setChatAdvisors" ? testState.setChatAdvisors : testState.removeChatAdvisor
  ),
}));

vi.mock("@/lib/analytics", () => ({ captureAnalytics: vi.fn() }));

const personas = ["persisted", "local", "other"].map((id) => ({
  _id: id as Id<"personas">,
  displayName: id,
  modelId: "openai/gpt-4.1-mini",
}));
const modelSummaries = [{
  modelId: "openai/gpt-4.1-mini",
  name: "GPT 4.1 mini",
  architecture: { modality: "text->text" },
}];

function result(personaId: string, isAvailable = true): ChatAdvisorsResult {
  return {
    advisors: [{
      _id: `assignment_${personaId}` as Id<"chatAdvisors">,
      personaId: personaId as Id<"personas">,
      instanceName: "Advisor 1",
      sortOrder: 0,
      allowWebSearch: false,
      displayName: personaId,
      createdAt: 1,
      updatedAt: 1,
      isAvailable,
    }],
    eligibility: { isAvailable: true, maxAdvisors: 3, keptCount: 1, remainingCapacity: 2 },
  };
}

function Harness({ chatId }: { chatId: string }) {
  const [capturedSnapshot, setCapturedSnapshot] = useState("not-captured");
  const owner = useAdvisorComposer({
    chatId: chatId as Id<"chats">,
    participants: [{ id: "participant", modelId: "openai/gpt-4.1-mini" }],
    personas,
    isPro: true,
    effectiveWebSearch: false,
    modelSummaries,
    defaultModelId: "openai/gpt-4.1-mini",
  });
  return (
    <div>
      <span data-testid="selection-ids">
        {owner.state.selections.map((selection) => selection.personaId).join(",")}
      </span>
      <span data-testid="hydrated">{String(owner.isHydrated)}</span>
      <span data-testid="can-send">{String(owner.canSendCurrentSelection)}</span>
      <span data-testid="can-capture">{String(owner.canCaptureQueuedSnapshot)}</span>
      <span data-testid="captured-snapshot">{capturedSnapshot}</span>
      <span data-testid="projection">
        {owner.advisorSelections === undefined
          ? "undefined"
          : `[${owner.advisorSelections.map((selection) => selection.personaId).join(",")}]`}
      </span>
      <button type="button" onClick={owner.open}>open</button>
      <button type="button" onClick={() => owner.togglePersona("local" as Id<"personas">)}>local</button>
      <button
        type="button"
        onClick={() => setCapturedSnapshot(JSON.stringify(owner.captureQueuedSnapshot()))}
      >
        capture
      </button>
      <button type="button" onClick={() => void owner.save()}>save</button>
    </div>
  );
}

describe("useAdvisorComposer hydration", () => {
  beforeEach(() => {
    testState.results.clear();
    testState.setChatAdvisors.mockClear();
    testState.removeChatAdvisor.mockClear();
  });

  it("blocks replacement saves until kept Advisors hydrate", async () => {
    const view = render(<Harness chatId="chat_a" />);
    expect(screen.getByTestId("hydrated")).toHaveTextContent("false");
    act(() => screen.getByRole("button", { name: "save" }).click());
    expect(testState.setChatAdvisors).not.toHaveBeenCalled();

    testState.results.set("chat_a", result("persisted"));
    view.rerender(<Harness chatId="chat_a" />);
    await waitFor(() => expect(screen.getByTestId("selection-ids")).toHaveTextContent("persisted"));
    expect(testState.setChatAdvisors).not.toHaveBeenCalled();
  });

  it("merges a local selection made before delayed hydration", async () => {
    const view = render(<Harness chatId="chat_a" />);
    act(() => screen.getByRole("button", { name: "local" }).click());
    expect(screen.getByTestId("selection-ids")).toHaveTextContent("local");
    expect(screen.getByTestId("can-send")).toHaveTextContent("false");
    expect(screen.getByTestId("can-capture")).toHaveTextContent("false");
    expect(screen.getByTestId("projection")).toHaveTextContent("undefined");
    act(() => screen.getByRole("button", { name: "capture" }).click());
    expect(screen.getByTestId("captured-snapshot")).toHaveTextContent("null");
    expect(screen.getByTestId("selection-ids")).toHaveTextContent("local");

    testState.results.set("chat_a", result("persisted"));
    view.rerender(<Harness chatId="chat_a" />);
    await waitFor(() => expect(screen.getByTestId("selection-ids")).toHaveTextContent("persisted,local"));
    expect(screen.getByTestId("can-send")).toHaveTextContent("true");
    expect(screen.getByTestId("can-capture")).toHaveTextContent("true");
    expect(screen.getByTestId("projection")).toHaveTextContent("[persisted,local]");
  });

  it("hydrates a picker opened before assignments arrive before allowing replacement save", async () => {
    const view = render(<Harness chatId="chat_a" />);
    act(() => screen.getByRole("button", { name: "open" }).click());
    act(() => screen.getByRole("button", { name: "save" }).click());
    expect(testState.setChatAdvisors).not.toHaveBeenCalled();

    testState.results.set("chat_a", result("persisted"));
    view.rerender(<Harness chatId="chat_a" />);
    await waitFor(() => expect(screen.getByTestId("selection-ids")).toHaveTextContent("persisted"));

    act(() => screen.getByRole("button", { name: "save" }).click());
    await waitFor(() => expect(testState.setChatAdvisors).toHaveBeenCalledWith({
      chatId: "chat_a",
      advisors: [{ personaId: "persisted", allowWebSearch: false }],
    }));
  });

  it("clears the previous chat projection before the next query resolves", async () => {
    testState.results.set("chat_a", result("persisted"));
    const view = render(<Harness chatId="chat_a" />);
    await waitFor(() => expect(screen.getByTestId("selection-ids")).toHaveTextContent("persisted"));

    view.rerender(<Harness chatId="chat_b" />);
    expect(screen.getByTestId("selection-ids")).toHaveTextContent("");
    expect(screen.getByTestId("projection")).toHaveTextContent("undefined");

    testState.results.set("chat_b", result("other"));
    view.rerender(<Harness chatId="chat_b" />);
    await waitFor(() => expect(screen.getByTestId("selection-ids")).toHaveTextContent("other"));
  });

  it("skips an unavailable kept Advisor for the turn but preserves it on save", async () => {
    testState.results.set("chat_a", result("persisted", false));
    render(<Harness chatId="chat_a" />);

    await waitFor(() => expect(screen.getByTestId("selection-ids")).toHaveTextContent("persisted"));
    expect(screen.getByTestId("projection")).toHaveTextContent("[]");

    act(() => screen.getByRole("button", { name: "save" }).click());
    await waitFor(() => expect(testState.setChatAdvisors).toHaveBeenCalledWith({
      chatId: "chat_a",
      advisors: [{ personaId: "persisted", allowWebSearch: false }],
    }));
  });

  it("reconciles kept Advisors changed on another client without losing a local one-shot", async () => {
    testState.results.set("chat_a", result("persisted"));
    const view = render(<Harness chatId="chat_a" />);
    await waitFor(() => expect(screen.getByTestId("selection-ids")).toHaveTextContent("persisted"));

    act(() => screen.getByRole("button", { name: "local" }).click());
    expect(screen.getByTestId("selection-ids")).toHaveTextContent("persisted,local");

    testState.results.set("chat_a", result("other"));
    view.rerender(<Harness chatId="chat_a" />);
    await waitFor(() => expect(screen.getByTestId("selection-ids")).toHaveTextContent("other,local"));
    expect(screen.getByTestId("projection")).toHaveTextContent("[other,local]");
  });

  it("does not let a stale subscription overwrite a just-saved picker draft", async () => {
    testState.results.set("chat_a", result("persisted"));
    const view = render(<Harness chatId="chat_a" />);
    await waitFor(() => expect(screen.getByTestId("selection-ids")).toHaveTextContent("persisted"));

    act(() => screen.getByRole("button", { name: "open" }).click());
    act(() => screen.getByRole("button", { name: "local" }).click());
    testState.results.set("chat_a", result("other"));
    view.rerender(<Harness chatId="chat_a" />);
    expect(screen.getByTestId("selection-ids")).toHaveTextContent("persisted,local");

    act(() => screen.getByRole("button", { name: "save" }).click());
    await waitFor(() => expect(testState.setChatAdvisors).toHaveBeenCalled());
    expect(screen.getByTestId("selection-ids")).toHaveTextContent("persisted,local");

    testState.results.set("chat_a", result("persisted"));
    view.rerender(<Harness chatId="chat_a" />);
    await waitFor(() => expect(screen.getByTestId("selection-ids")).toHaveTextContent("persisted,local"));
  });
});
