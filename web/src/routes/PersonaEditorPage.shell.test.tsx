import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import {
  mockMutationEndpoint,
  mockQueryEndpoint,
  mockState,
  skill,
} from "@/test/criticalRoutesCoverage";
import { PersonaEditorPage } from "./PersonaEditorPage";

function personaEditorRoute(path: string) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/app/personas/:personaId" element={<PersonaEditorPage />} />
      </Routes>
    </MemoryRouter>
  );
}

function renderPersonaEditor(path: string) {
  return render(personaEditorRoute(path));
}

describe("PersonaEditorPage shell behavior", () => {
  it("shows loading for unresolved personas and returns to the list when a persona is missing", async () => {
    mockState.page = "persona";
    mockState.queryData.persona = undefined;

    const { rerender } = renderPersonaEditor("/app/personas/persona_missing");
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();

    mockState.queryData.persona = null;
    rerender(personaEditorRoute("/app/personas/persona_missing"));

    await waitFor(() => expect(mockState.navigate).toHaveBeenCalledWith("/app/personas"));
  });

  it("hydrates an existing persona, blocks unsupported tool models, and saves recovered update payloads", async () => {
    mockState.page = "persona";
    mockQueryEndpoint("runtime_host/devices:listMyDevices", [{
      deviceId: "device_mac", displayName: "Mac", isOnline: true,
      adapters: [{ adapterId: "pi", authState: "ready", operations: { listModels: true } }],
    }]);
    mockState.modelSummaries = [
      { modelId: "local/text-only", name: "Text Only", provider: "local", supportsTools: false },
      { modelId: "openai/gpt-4.1", name: "GPT 4.1", provider: "openai", supportsTools: true },
    ];
    mockState.visibleSkills = [
      skill({ _id: "skill_drive", name: "Drive Skill", scope: "system", requiredIntegrationIds: ["drive"] }),
      skill({ _id: "skill_user", name: "User Skill", scope: "user", requiredIntegrationIds: [] }),
    ];
    mockState.queryData.persona = {
      _id: "persona_1",
      displayName: "Research Lead",
      personaDescription: "Checks source material",
      systemPrompt: "Verify every claim.",
      modelId: "local/text-only",
      temperature: 0.3,
      maxTokens: 1200,
      includeReasoning: true,
      reasoningEffort: "high",
      avatarEmoji: "🧠",
      avatarColor: "#0f766e",
      avatarImageUrl: "https://example.com/avatar.png",
      isDefault: true,
      skillOverrides: [
        { skillId: "skill_drive", state: "always" },
        { skillId: "skill_user", state: "available" },
      ],
      integrationOverrides: [
        { integrationId: "drive", enabled: true },
        { integrationId: "gmail", enabled: true },
      ],
    };

    renderPersonaEditor("/app/personas/persona_1");

    await waitFor(() => expect(screen.getByDisplayValue("Research Lead")).toBeInTheDocument());
    expect(screen.getByText("persona_model_no_tools")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "save" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "persona_runtime_local" }));
    expect(screen.getByRole("button", { name: "save" })).toBeEnabled();
    expect(screen.queryByText("persona_model_no_tools")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "persona_runtime_cloud" }));
    expect(screen.getByRole("button", { name: "save" })).toBeDisabled();

    fireEvent.click(screen.getByText("text-only"));
    fireEvent.click(await screen.findByText("GPT 4.1"));
    expect(screen.queryByText("persona_model_no_tools")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("switch", { name: "integration_google_drive" }));
    fireEvent.click(screen.getByRole("button", { name: "remove_avatar" }));
    fireEvent.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => {
      expect(mockState.mutation).toHaveBeenCalledWith(expect.objectContaining({
        personaId: "persona_1",
        displayName: "Research Lead",
        personaDescription: "Checks source material",
        systemPrompt: "Verify every claim.",
        modelId: "openai/gpt-4.1",
        temperature: 0.3,
        maxTokens: 1200,
        includeReasoning: true,
        reasoningEffort: "high",
        avatarImageStorageId: null,
        integrationOverrides: expect.arrayContaining([
          { integrationId: "drive", enabled: false },
          { integrationId: "gmail", enabled: true },
        ]),
        skillOverrides: expect.arrayContaining([
          { skillId: "skill_drive", state: "always" },
          { skillId: "skill_user", state: "available" },
        ]),
      }));
    });
    expect(mockState.navigate).toHaveBeenCalledWith("/app/personas");
  });

  it("shows manual Gmail personas when Google Workspace is disconnected", async () => {
    mockState.page = "persona";
    mockState.connectedAccounts = {
      ...mockState.connectedAccounts,
      googleConnection: null,
      gmailManualConnection: { status: "active" },
    };
    mockState.modelSummaries = [
      { modelId: "openai/gpt-4.1", name: "GPT 4.1", provider: "openai", supportsTools: true },
    ];
    mockState.mutation.mockResolvedValueOnce("persona_1");

    renderPersonaEditor("/app/personas/new");

    fireEvent.change(screen.getByPlaceholderText("persona_name_placeholder"), { target: { value: "Gmail Assistant" } });
    fireEvent.change(screen.getByPlaceholderText("system_prompt_placeholder"), { target: { value: "Use Gmail when needed." } });
    fireEvent.click(screen.getByText("select_a_model"));
    fireEvent.click(screen.getByText("GPT 4.1"));

    expect(screen.queryByRole("switch", { name: "integration_google_drive" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "integration_gmail" }));
    fireEvent.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => {
      expect(mockState.mutation).toHaveBeenCalledWith(expect.objectContaining({
        displayName: "Gmail Assistant",
        modelId: "openai/gpt-4.1",
        integrationOverrides: expect.arrayContaining([
          { integrationId: "gmail", enabled: true },
        ]),
      }));
    });
  });

  it("atomically saves an online Codex Runtime Host route with a new Persona", async () => {
    mockState.page = "persona";
    mockState.modelSummaries = [
      { modelId: "openai/gpt-4.1", name: "GPT 4.1", provider: "openai", supportsTools: true },
    ];
    mockQueryEndpoint("runtime_host/devices:listMyDevices", [{
      deviceId: "device_mac",
      displayName: "Dino’s MacBook",
      isOnline: true,
      adapters: [{
        adapterId: "codex",
        authState: "ready",
        operations: { listModels: true },
      }],
    }]);
    mockState.mutation.mockResolvedValueOnce("persona_1");

    renderPersonaEditor("/app/personas/new");

    fireEvent.change(screen.getByPlaceholderText("persona_name_placeholder"), { target: { value: "Local Reviewer" } });
    fireEvent.change(screen.getByPlaceholderText("system_prompt_placeholder"), { target: { value: "Review the repository." } });
    fireEvent.click(screen.getByText("select_a_model"));
    fireEvent.click(screen.getByText("GPT 4.1"));
    fireEvent.click(screen.getByRole("button", { name: "persona_runtime_local" }));
    expect(screen.queryByText("locked_model_section")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "persona_runtime_cloud" }));
    expect(screen.getByText("locked_model_section")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "persona_runtime_local" }));
    fireEvent.click(screen.getByRole("switch", { name: "integration_gmail" }));
    expect(screen.getByRole("button", { name: "save" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => expect(mockState.mutation).toHaveBeenCalledWith(expect.objectContaining({
      displayName: "Local Reviewer",
      runtimeRoute: {
        deviceId: "device_mac",
        adapterId: "codex",
        modelSelectionMode: "adapter_default",
      },
    })));
  });

  it("preserves an unchanged explicit runtime route without revalidating an offline host", async () => {
    const updatePersona = mockMutationEndpoint("personas/mutations:update");
    mockState.page = "persona";
    mockState.modelSummaries = [
      { modelId: "openai/gpt-4.1", name: "GPT 4.1", provider: "openai", supportsTools: true },
    ];
    mockState.queryData.persona = {
      _id: "persona_1",
      displayName: "Runtime Reviewer",
      systemPrompt: "Review code.",
      modelId: "openai/gpt-4.1",
    };
    mockQueryEndpoint("runtime_host/route_queries:getPersonaRuntime", {
      bindingId: "binding_1",
      deviceId: "device_mac",
      deviceName: "Dino’s MacBook",
      adapterId: "codex",
      modelSelectionMode: "explicit",
      modelId: "gpt-5.6",
      isOnline: false,
    });
    mockQueryEndpoint("runtime_host/devices:listMyDevices", [{
      deviceId: "device_mac",
      displayName: "Dino’s MacBook",
      isOnline: false,
      adapters: [],
    }]);

    renderPersonaEditor("/app/personas/persona_1");
    await waitFor(() => expect(screen.getByText("persona_runtime_explicit_model")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => expect(updatePersona).toHaveBeenCalled());
    const updateArgs = updatePersona.mock.calls.at(-1)?.[0];
    expect(updateArgs).not.toHaveProperty("runtimeRoute");
  });

  it("adds an active Remote MCP server as a Persona integration target", async () => {
    mockState.page = "persona";
    mockState.modelSummaries = [
      { modelId: "openai/gpt-4.1", name: "GPT 4.1", provider: "openai", supportsTools: true },
    ];
    mockQueryEndpoint("mcp/queries:listActiveConnectionOptions", [{
      connectionId: "connection-1",
      integrationId: "mcp:connection-1",
      displayName: "Cloudflare Docs",
      endpointHost: "docs.mcp.cloudflare.com",
      allowedItemCount: 2,
    }]);
    mockState.mutation.mockResolvedValueOnce("persona_1");

    renderPersonaEditor("/app/personas/new");

    fireEvent.change(screen.getByPlaceholderText("persona_name_placeholder"), { target: { value: "MCP Researcher" } });
    fireEvent.change(screen.getByPlaceholderText("system_prompt_placeholder"), { target: { value: "Use connected documentation tools." } });
    fireEvent.click(screen.getByText("select_a_model"));
    fireEvent.click(screen.getByText("GPT 4.1"));
    fireEvent.click(screen.getByRole("switch", { name: "Cloudflare Docs" }));
    fireEvent.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => {
      expect(mockState.mutation).toHaveBeenCalledWith(expect.objectContaining({
        integrationOverrides: expect.arrayContaining([
          { integrationId: "mcp:connection-1", enabled: true },
        ]),
      }));
    });
  });

  it("blocks saving enabled invalid max token overrides", async () => {
    mockState.page = "persona";
    mockState.modelSummaries = [
      { modelId: "openai/gpt-4.1", name: "GPT 4.1", provider: "openai", supportsTools: true },
    ];

    renderPersonaEditor("/app/personas/new");

    fireEvent.change(screen.getByPlaceholderText("persona_name_placeholder"), { target: { value: "Invalid Tokens" } });
    fireEvent.change(screen.getByPlaceholderText("system_prompt_placeholder"), { target: { value: "Be careful." } });
    fireEvent.click(screen.getByText("select_a_model"));
    fireEvent.click(screen.getByText("GPT 4.1"));
    fireEvent.click(within(screen.getByText("override_max_tokens").closest("div")!).getByRole("switch"));
    fireEvent.change(screen.getByPlaceholderText("max_tokens_placeholder"), { target: { value: "12abc" } });
    fireEvent.click(screen.getByRole("button", { name: "save" }));

    expect(screen.getByText("persona_max_tokens_invalid")).toBeInTheDocument();
    expect(mockState.mutation).not.toHaveBeenCalled();
  });

  it("revokes local avatar preview object URLs on replace, remove, and unmount", () => {
    mockState.page = "persona";
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const createObjectURL = vi.fn()
      .mockReturnValueOnce("blob:first")
      .mockReturnValueOnce("blob:second");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });

    try {
      const { unmount } = renderPersonaEditor("/app/personas/new");
      const input = document.querySelector("input[type='file']") as HTMLInputElement;

      fireEvent.change(input, { target: { files: [new File(["first"], "first.png", { type: "image/png" })] } });
      fireEvent.change(input, { target: { files: [new File(["second"], "second.png", { type: "image/png" })] } });
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:first");

      fireEvent.click(screen.getByRole("button", { name: "remove_avatar" }));
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:second");

      unmount();
      expect(revokeObjectURL).toHaveBeenCalledTimes(2);
    } finally {
      Object.defineProperty(URL, "createObjectURL", { configurable: true, value: originalCreateObjectURL });
      Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: originalRevokeObjectURL });
    }
  });
});
