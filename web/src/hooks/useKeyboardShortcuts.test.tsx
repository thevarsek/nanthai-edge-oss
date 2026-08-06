import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";

const navigate = vi.hoisted(() => vi.fn());

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useNavigate: () => navigate,
  };
});

function wrapper({ children }: { children: React.ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

function keydown(key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  window.dispatchEvent(event);
  return event;
}

describe("useKeyboardShortcuts", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("routes command shortcuts to shell actions and settings navigation", () => {
    const actions = {
      onNewChat: vi.fn(),
      onNewFolder: vi.fn(),
      onOpenModelPicker: vi.fn(),
      onDeleteChat: vi.fn(),
      onToggleSidebar: vi.fn(),
      onEscape: vi.fn(),
    };
    renderHook(() => useKeyboardShortcuts(actions), { wrapper });

    expect(keydown("n", { metaKey: true }).defaultPrevented).toBe(true);
    expect(keydown("N", { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    expect(keydown("k", { metaKey: true }).defaultPrevented).toBe(true);
    expect(keydown(",", { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(keydown("f", { metaKey: true }).defaultPrevented).toBe(false);
    expect(keydown("b", { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(keydown("Backspace", { metaKey: true }).defaultPrevented).toBe(true);
    keydown("Escape");

    expect(actions.onNewChat).toHaveBeenCalledTimes(1);
    expect(actions.onNewFolder).toHaveBeenCalledTimes(1);
    expect(actions.onOpenModelPicker).toHaveBeenCalledTimes(1);
    expect(actions.onToggleSidebar).toHaveBeenCalledTimes(1);
    expect(actions.onDeleteChat).toHaveBeenCalledTimes(1);
    expect(actions.onEscape).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/app/settings");
  });

  it("ignores modifier shortcuts while editing and falls back to chat-list close navigation", () => {
    const onNewChat = vi.fn();
    const input = document.createElement("input");
    document.body.append(input);
    renderHook(() => useKeyboardShortcuts({ onNewChat }), { wrapper });

    input.dispatchEvent(new KeyboardEvent("keydown", {
      key: "n",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    }));
    keydown("w", { metaKey: true });

    expect(onNewChat).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/app/chat");
    input.remove();
  });

  it("uses an explicit close handler when supplied", () => {
    const onCloseChat = vi.fn();
    renderHook(() => useKeyboardShortcuts({ onCloseChat }), { wrapper });

    keydown("w", { ctrlKey: true });

    expect(onCloseChat).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalledWith("/app/chat");
  });
});
