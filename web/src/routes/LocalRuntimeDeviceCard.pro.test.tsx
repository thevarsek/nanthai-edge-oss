import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import { RuntimeDeviceCard, type RuntimeDevice } from "./LocalRuntimeDeviceCard";

const { state, createChat, addPersona, navigate, remove } = vi.hoisted(() => ({
  state: { proStatus: { isPro: false }, personas: [{ _id: "persona_1", displayName: "Local Assistant" }] },
  createChat: vi.fn(async () => "chat_1"), addPersona: vi.fn(async () => "persona_2"), navigate: vi.fn(), remove: vi.fn(),
}));
vi.mock("@/hooks/useSharedData", () => ({ useSharedData: () => state }));
vi.mock("@/components/shared/PaywallModal", () => ({ PaywallModal: ({ onClose }: { onClose: () => void }) => <div role="dialog"><button onClick={onClose}>Close paywall</button></div> }));
vi.mock("@convex/_generated/api", () => ({ api: { chat: { mutations: { createChat: "chat" } }, runtime_host: { basic_persona: { addBasicPersona: "persona" } } } }));
vi.mock("convex/react", () => ({ useMutation: (name: string) => name === "chat" ? createChat : addPersona }));
vi.mock("react-router-dom", async original => ({ ...await original<typeof import("react-router-dom")>(), useNavigate: () => navigate }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
beforeEach(() => { state.proStatus.isPro = false; vi.clearAllMocks(); });
const device: RuntimeDevice = {
  runtimeDeviceId: "row" as Id<"runtimeDevices">, deviceId: "mac", displayName: "My Mac", status: "active", isOnline: true,
  operatingSystem: "macos", architecture: "arm64", platformRelease: "26", hostVersion: "1", adapters: [], starterPersonaId: "persona_1" as Id<"personas">,
};
function Page() {
  return <MemoryRouter><RuntimeDeviceCard device={device} isRevoking={false} onRevoke={remove} onHide={vi.fn()} onError={vi.fn()} /></MemoryRouter>;
}

it("prompts before local Persona creation or chat launch and leaves removal available", () => {
  render(<Page />);
  fireEvent.click(screen.getByRole("button", { name: "runtime_preview_start_chat" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(createChat).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Close paywall" }));
  fireEvent.click(screen.getByRole("button", { name: "runtime_create_another_persona_for_adapter" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(addPersona).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Close paywall" }));
  fireEvent.click(screen.getByRole("button", { name: "runtime_edit_persona" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(navigate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Close paywall" }));
  fireEvent.click(screen.getByRole("button", { name: "runtime_remove_pairing" }));
  expect(remove).toHaveBeenCalledOnce();
});

it("resumes Persona creation after the account becomes Pro", async () => {
  const view = render(<Page />);
  fireEvent.click(screen.getByRole("button", { name: "runtime_create_another_persona_for_adapter" }));
  state.proStatus.isPro = true; view.rerender(<Page />);
  await waitFor(() => expect(addPersona).toHaveBeenCalledOnce());
  expect(addPersona).toHaveBeenCalledWith({ deviceId: "mac", adapterId: "codex", createAnother: true });
  expect(navigate).toHaveBeenCalledWith("/app/personas/persona_2/edit");
});
