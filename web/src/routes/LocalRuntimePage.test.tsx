import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LocalRuntimePage } from "./LocalRuntimePage";

const { state } = vi.hoisted(() => ({
  state: {
    proStatus: { isPro: true },
    prefs: { runtimeOnboardingState: "setup" as "setup" | "ready" },
    devices: [] as Array<Record<string, unknown>> | undefined,
    summary: { downloadUrl: null as string | null, questionTimeoutMinutes: 15 },
    saveQuestions: vi.fn(),
    beginPairing: vi.fn(),
    beginSetup: vi.fn(),
    revokeDevice: vi.fn(),
    hideDevice: vi.fn(),
    createChat: vi.fn(),
    addBasicPersona: vi.fn(),
    navigate: vi.fn(),
    personas: [] as Array<{ _id: string; displayName: string }>,
  },
}));

vi.mock("@convex/_generated/api", () => ({
  api: {
    preferences: { mutations: { upsertPreferences: "saveQuestions" } },
    chat: { mutations: { createChat: "createChat" } },
    runtime_host: {
      activation: { begin: "beginSetup" },
      connection_summary: { getMySummary: "getMySummary" },
      basic_persona: { addBasicPersona: "addBasicPersona" },
      devices: { listMyDevices: "listMyDevices", hideRemovedDevice: "hideDevice" },
      pairing: {
        beginPairing: "beginPairing",
        revokeDevice: "revokeDevice",
      },
    },
  },
}));

vi.mock("@/hooks/useSharedData", () => ({ useSharedData: () => ({ prefs: state.prefs, personas: state.personas, proStatus: state.proStatus }) }));
vi.mock("@/components/shared/PaywallModal", () => ({ PaywallModal: ({ onClose }: { onClose: () => void }) => <div role="dialog"><button onClick={onClose}>Close paywall</button></div> }));

vi.mock("@/lib/analytics", () => ({ captureAnalytics: vi.fn() }));
vi.mock("react-router-dom", async (importOriginal) => ({
  ...await importOriginal<typeof import("react-router-dom")>(),
  useNavigate: () => state.navigate,
}));

vi.mock("convex/react", () => ({
  useQuery: (endpoint: string) => endpoint === "getMySummary" ? state.summary : state.devices,
  useMutation: (endpoint: string) => endpoint === "beginSetup" ? state.beginSetup : endpoint === "saveQuestions" ? state.saveQuestions : endpoint === "beginPairing"
    ? state.beginPairing
    : endpoint === "hideDevice" ? state.hideDevice : endpoint === "createChat" ? state.createChat : endpoint === "addBasicPersona" ? state.addBasicPersona : state.revokeDevice,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.time ? `${key}:${String(options.time)}` : options?.name ? `${key}:${String(options.name)}` : key,
  }),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <LocalRuntimePage />
    </MemoryRouter>,
  );
}

describe("LocalRuntimePage", () => {
  beforeEach(() => {
    state.devices = [];
    state.proStatus = { isPro: true };
    state.summary = { downloadUrl: null, questionTimeoutMinutes: 15 };
    state.saveQuestions.mockReset();
    state.prefs = { runtimeOnboardingState: "setup" };
    state.beginPairing.mockReset();
    state.beginSetup.mockReset();
    state.revokeDevice.mockReset();
    state.hideDevice.mockReset();
    state.createChat.mockReset();
    state.addBasicPersona.mockReset();
    state.navigate.mockReset();
    state.personas = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(async () => undefined) },
    });
  });

  it("prompts free users before pairing while preserving existing device removal", async () => {
    state.proStatus = { isPro: false };
    state.devices = [{ runtimeDeviceId: "row", deviceId: "mac", displayName: "Old Mac", status: "active", adapters: [], isOnline: false }];
    renderPage();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(state.beginPairing).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close paywall" }));
    expect(screen.getByText("Old Mac")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "runtime_remove_pairing" }));
    await waitFor(() => expect(state.revokeDevice).toHaveBeenCalledWith({ runtimeDeviceId: "row", reason: "Removed from NanthAI settings" }));
    fireEvent.click(screen.getByRole("button", { name: "runtime_pair_code_create" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(state.beginPairing).not.toHaveBeenCalled();
  });

  it("resumes the requested pairing when the existing account becomes Pro", async () => {
    state.proStatus = { isPro: false };
    state.beginPairing.mockResolvedValue({ pairingId: "pair", oneTimeCode: "code", expiresAt: 1000 });
    const view = renderPage();
    expect(state.beginPairing).not.toHaveBeenCalled();
    state.proStatus = { isPro: true };
    view.rerender(<MemoryRouter><LocalRuntimePage /></MemoryRouter>);
    await waitFor(() => expect(state.beginPairing).toHaveBeenCalledTimes(1));
    expect(state.beginSetup).toHaveBeenCalledWith({});
    expect(state.beginPairing).toHaveBeenCalledWith({ shortCode: true });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not issue a pairing grant merely by opening Settings as Pro", () => {
    renderPage();
    expect(state.beginPairing).not.toHaveBeenCalled();
  });

  it("saves Never and timed question choices through the canonical preference mutation", async () => {
    renderPage();
    const picker = screen.getByRole("combobox", { name: "runtime_question_setting" });
    expect(picker).toHaveValue("15");
    fireEvent.change(picker, { target: { value: "0" } });
    await waitFor(() => expect(state.saveQuestions).toHaveBeenCalledWith({ localQuestionTimeoutMinutes: 0 }));
    await waitFor(() => expect(picker).not.toBeDisabled());
    state.saveQuestions.mockRejectedValueOnce(new Error("Save failed"));
    fireEvent.change(picker, { target: { value: "5" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Save failed");
    expect(picker).toHaveValue("15");
  });

  it("creates a short code and retains the exact command under Advanced", async () => {
    state.beginPairing.mockResolvedValue({
      pairingId: "pairing_123",
      oneTimeCode: "nrp_0123456789abcdef",
      pairingCode: "0123-4567-89AB-CDEF",
      expiresAt: new Date("2026-08-16T12:30:00Z").getTime(),
    });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "runtime_pair_code_create" }));

    const command = await screen.findByText("0123-4567-89AB-CDEF");
    expect(state.beginPairing).toHaveBeenCalledWith({ shortCode: true });
    expect(command).toBeInTheDocument();
    expect(screen.getByText("nanthai runtime start")).toBeInTheDocument();
    const copyCode = screen.getAllByRole("button", { name: "copy" })[0];
    fireEvent.click(copyCode);
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "0123-4567-89AB-CDEF",
      );
      expect(copyCode).toHaveAttribute("title", "copied");
    });
  });

  it("copies the server command with its deployment and exposes download and switch-route handoffs", async () => {
    state.summary.downloadUrl = "https://example.com/NanthAI.zip";
    const command = "nanthai pair qa 123456 --server https://runtime-test.convex.site";
    state.beginPairing.mockResolvedValue({ pairingId: "qa", oneTimeCode: "123456", expiresAt: 2000, pairingCommand: command });
    renderPage();
    expect(screen.getByRole("link", { name: "runtime_download_mac" })).toHaveAttribute("href", state.summary.downloadUrl);
    expect(screen.getByRole("link", { name: "runtime_choose_connection" })).toHaveAttribute("href", "/onboarding?mode=connections");
    fireEvent.click(screen.getByRole("button", { name: "runtime_pair_code_create" }));
    await screen.findAllByText(command);
    fireEvent.click(screen.getAllByRole("button", { name: "copy" })[0]);
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(command));
  });

  it("does not offer an unconfigured download", () => {
    renderPage();
    expect(screen.queryByRole("link", { name: "runtime_download_mac" })).not.toBeInTheDocument();
    expect(screen.getByRole("list")).toBeInTheDocument();
  });

  it("shows presence and adapter state and revokes the selected machine", async () => {
    state.devices = [{
      runtimeDeviceId: "runtime_device_1",
      deviceId: "device_1",
      displayName: "Dino’s MacBook",
      status: "active",
      operatingSystem: "macos",
      architecture: "arm64",
      platformRelease: "15.6",
      hostVersion: "0.1.0",
      isOnline: true,
      lastSeenAt: 1_776_000_000_000,
      adapters: [{ adapterId: "codex", displayName: "OpenAI Codex CLI", adapterVersion: "0.147.0", authState: "ready" }],
    }];
    state.revokeDevice.mockResolvedValue(true);
    renderPage();

    expect(screen.getByText("Dino’s MacBook")).toBeInTheDocument();
    expect(screen.getByText("runtime_status_online")).toBeInTheDocument();
    expect(screen.getByText("OpenAI Codex CLI 0.147.0 · ready")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "runtime_remove_pairing" }));

    await waitFor(() => expect(state.revokeDevice).toHaveBeenCalledWith({
      runtimeDeviceId: "runtime_device_1",
      reason: "Removed from NanthAI settings",
    }));
  });

  it("deletes only a removed machine from the list through the shared API and surfaces errors", async () => {
    state.devices = [{ runtimeDeviceId: "removed-row", deviceId: "old-mac", displayName: "Old Mac", status: "revoked", adapters: [], isOnline: false }];
    state.hideDevice.mockRejectedValueOnce(new Error("Unable to hide machine")).mockResolvedValueOnce(true);
    renderPage();
    expect(screen.queryByRole("button", { name: "runtime_remove_pairing" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "runtime_delete_from_list" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to hide machine");
    fireEvent.click(screen.getByRole("button", { name: "runtime_delete_from_list" }));
    await waitFor(() => expect(state.hideDevice).toHaveBeenLastCalledWith({ runtimeDeviceId: "removed-row" }));
    expect(state.revokeDevice).not.toHaveBeenCalled();
  });

  it("starts a chat with the server-provisioned Persona without opening an editor", async () => {
    state.personas = [{ _id: "persona_1", displayName: "OpenAI Codex · My Mac" }];
    state.devices = [{
      runtimeDeviceId: "runtime_device_1", deviceId: "device_1", displayName: "My Mac",
      status: "active", operatingSystem: "macos", architecture: "arm64", platformRelease: "26.0",
      hostVersion: "0.2.0", isOnline: true, starterPersonaId: "persona_1",
      adapters: [{ adapterId: "codex", displayName: "OpenAI Codex CLI", adapterVersion: "0.153.4", authState: "ready" }],
    }];
    state.createChat.mockRejectedValueOnce(new Error("Chat unavailable")).mockResolvedValueOnce("chat_1");
    renderPage();
    expect(screen.queryByRole("link", { name: "runtime_preview_create_persona" })).not.toBeInTheDocument();
    expect(screen.getByText("runtime_preview_auto_persona")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "runtime_preview_start_chat:OpenAI Codex · My Mac" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Chat unavailable");
    expect(state.navigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "runtime_preview_start_chat:OpenAI Codex · My Mac" }));
    await waitFor(() => expect(state.navigate).toHaveBeenCalledWith("/app/chat/chat_1"));
    expect(state.createChat).toHaveBeenLastCalledWith({
      mode: "chat", participants: [expect.objectContaining({ personaId: "persona_1" })],
    });
  });

  it("shows activation proof only after Convex records a completed local turn", () => {
    state.prefs = { runtimeOnboardingState: "ready" };
    renderPage();
    expect(screen.getByText("runtime_preview_activation_complete")).toBeInTheDocument();
    expect(screen.queryByText("runtime_preview_activation_proof")).not.toBeInTheDocument();
  });

  it("recovers a basic Persona into the existing editor route", async () => {
    state.devices = [{
      runtimeDeviceId: "runtime_device_1", deviceId: "device_1", displayName: "My Mac",
      status: "active", operatingSystem: "macos", architecture: "arm64", platformRelease: "26.0",
      hostVersion: "0.2.0", isOnline: true, adapters: [],
    }];
    state.addBasicPersona.mockResolvedValue("persona_recovered");
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "runtime_add_basic_persona_for_adapter:Codex" }));
    await waitFor(() => expect(state.navigate).toHaveBeenCalledWith("/app/personas/persona_recovered/edit"));
    expect(state.addBasicPersona).toHaveBeenCalledWith({ deviceId: "device_1", adapterId: "codex" });
  });

  it("shows both runtime starters and explicitly creates another Pi Persona", async () => {
    state.personas = [{ _id: "persona_pi", displayName: "Pi · My Mac" }, { _id: "persona_codex", displayName: "Codex · My Mac" }];
    state.devices = [{ runtimeDeviceId: "row", deviceId: "device_1", displayName: "My Mac", status: "active", isOnline: true,
      starterPersonas: [{ adapterId: "pi", personaId: "persona_pi" }, { adapterId: "codex", personaId: "persona_codex" }],
      adapters: [{ adapterId: "pi", displayName: "Pi", adapterVersion: "1.0.0", authState: "ready" }, { adapterId: "codex", displayName: "OpenAI Codex", adapterVersion: "0.159.2", authState: "ready" }],
    }];
    state.createChat.mockResolvedValue("pi_chat");
    state.addBasicPersona.mockResolvedValue("recovered_pi");
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "runtime_preview_start_chat:Pi · My Mac" }));
    await waitFor(() => expect(state.createChat).toHaveBeenCalledWith({ mode: "chat", participants: [expect.objectContaining({ personaId: "persona_pi" })] }));
    fireEvent.click(screen.getByRole("button", { name: "runtime_create_another_persona_for_adapter:Pi" }));
    await waitFor(() => expect(state.addBasicPersona).toHaveBeenCalledWith({ deviceId: "device_1", adapterId: "pi", createAnother: true }));
  });

  it("surfaces pairing failures without replacing the device list", async () => {
    state.beginPairing.mockRejectedValue(new Error("Pairing service unavailable"));
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "runtime_pair_code_create" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Pairing service unavailable");
    expect(screen.getByText("local_runtime_no_machines")).toBeInTheDocument();
  });
});
