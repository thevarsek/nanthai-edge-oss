import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import { RuntimeDeviceCard, type RuntimeDevice } from "./LocalRuntimeDeviceCard";

const { personas, addPersona, createChat, navigate, onError } = vi.hoisted(() => ({
  personas: [
    { _id: "edited", displayName: "My edited assistant", systemPrompt: "Keep my instructions." },
    { _id: "retained", displayName: "Retained Pi", systemPrompt: "Keep this too." },
    { _id: "stale", displayName: "Old starter" },
  ],
  addPersona: vi.fn(), createChat: vi.fn(async () => "chat_1"), navigate: vi.fn(), onError: vi.fn(),
}));
vi.mock("@/hooks/useSharedData", () => ({ useSharedData: () => ({ proStatus: { isPro: true }, personas }) }));
vi.mock("@convex/_generated/api", () => ({ api: { chat: { mutations: { createChat: "chat" } }, runtime_host: { basic_persona: { addBasicPersona: "persona" } } } }));
vi.mock("convex/react", () => ({ useMutation: (name: string) => name === "chat" ? createChat : addPersona }));
vi.mock("react-router-dom", async original => ({ ...await original<typeof import("react-router-dom")>(), useNavigate: () => navigate }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string, args?: { name: string }) => args?.name ? `${key}:${args.name}` : key }) }));
beforeEach(() => { vi.clearAllMocks(); addPersona.mockResolvedValue("another"); });

const device: RuntimeDevice = {
  runtimeDeviceId: "row" as Id<"runtimeDevices">, deviceId: "mac", displayName: "My Mac", status: "active", isOnline: true,
  operatingSystem: "macos", architecture: "arm64", platformRelease: "26", hostVersion: "1",
  adapters: [{ adapterId: "codex", displayName: "Codex", adapterVersion: "1", authState: "ready" }, { adapterId: "pi", displayName: "Pi", adapterVersion: "1", authState: "ready" }],
  starterPersonaId: "stale" as Id<"personas">,
  runtimePersonas: [{ adapterId: "codex", personaId: "edited" as Id<"personas">, needsReconnect: false }, { adapterId: "pi", personaId: "retained" as Id<"personas">, needsReconnect: true }],
};
function page(overrides: Partial<RuntimeDevice> = {}) {
  render(<MemoryRouter><RuntimeDeviceCard device={{ ...device, ...overrides }} isRevoking={false} onRevoke={vi.fn()} onHide={vi.fn()} onError={onError} /></MemoryRouter>);
}

it("uses current runtime bindings rather than stale starter receipts to launch the edited Persona", async () => {
  page();
  expect(screen.queryByRole("button", { name: "runtime_preview_start_chat:Old starter" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "runtime_preview_start_chat:Retained Pi" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "runtime_preview_start_chat:My edited assistant" }));
  await waitFor(() => expect(createChat).toHaveBeenCalledWith({ mode: "chat", participants: [expect.objectContaining({ personaId: "edited" })] }));
  expect(addPersona).not.toHaveBeenCalled();
});

it("reconnects the selected retained Persona without sending replacements for its edited settings", async () => {
  addPersona.mockResolvedValue("retained");
  page();
  fireEvent.click(screen.getByRole("button", { name: "runtime_reconnect_persona:Retained Pi" }));
  await waitFor(() => expect(addPersona).toHaveBeenCalledWith({ deviceId: "mac", adapterId: "pi", personaId: "retained" }));
  expect(navigate).toHaveBeenCalledWith("/app/personas/retained/edit");
  expect(createChat).not.toHaveBeenCalled();
});

it("opens the existing Persona editor without creating another Persona", () => {
  page();
  fireEvent.click(screen.getByRole("button", { name: "runtime_edit_persona:My edited assistant" }));
  expect(navigate).toHaveBeenCalledWith("/app/personas/edited/edit");
  expect(addPersona).not.toHaveBeenCalled();
});

it("makes additional Persona creation explicit for both current and recovery candidates", async () => {
  page();
  expect(screen.queryByRole("button", { name: "runtime_add_basic_persona_for_adapter:Codex" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "runtime_create_another_persona_for_adapter:Pi" }));
  await waitFor(() => expect(addPersona).toHaveBeenCalledWith({ deviceId: "mac", adapterId: "pi", createAnother: true }));
  expect(navigate).toHaveBeenCalledWith("/app/personas/another/edit");
});

it("offers ordinary basic recovery when the authoritative projection has no candidates", async () => {
  page({ runtimePersonas: [] });
  expect(screen.queryByRole("button", { name: "runtime_preview_start_chat:Old starter" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "runtime_add_basic_persona_for_adapter:Codex" }));
  await waitFor(() => expect(addPersona).toHaveBeenCalledWith({ deviceId: "mac", adapterId: "codex" }));
});

it("keeps legacy starter projections usable until the additive field arrives", () => {
  page({ runtimePersonas: undefined });
  expect(screen.getByRole("button", { name: "runtime_preview_start_chat:Old starter" })).toBeInTheDocument();
});
