import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import {
  mockMutationEndpoint,
  mockQueryEndpoint,
  mockState,
} from "@/test/criticalRoutesCoverage";
import { PersonaEditorPage } from "./PersonaEditorPage";

function renderNewPersona() {
  return render(
    <MemoryRouter initialEntries={["/app/personas/new"]}>
      <Routes>
        <Route path="/app/personas/:personaId" element={<PersonaEditorPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("PersonaEditorPage local model selection", () => {
  it("persists only a model returned by the selected Runtime Host request", async () => {
    mockState.page = "persona";
    mockState.modelSummaries = [{
      modelId: "openai/gpt-4.1",
      name: "GPT 4.1",
      provider: "openai",
      supportsTools: true,
    }];
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
    const requestModels = mockMutationEndpoint(
      "runtime_host/model_discovery:requestModels",
      async () => ({ requestId: "request_1", expiresAt: Date.now() + 120_000 }),
    );
    const createPersona = mockMutationEndpoint(
      "personas/mutations:create",
      async () => "persona_1",
    );
    const view = renderNewPersona();

    fireEvent.change(screen.getByPlaceholderText("persona_name_placeholder"), {
      target: { value: "Local Reviewer" },
    });
    fireEvent.change(screen.getByPlaceholderText("system_prompt_placeholder"), {
      target: { value: "Review this repository." },
    });
    fireEvent.click(screen.getByRole("button", { name: "persona_runtime_local" }));
    fireEvent.click(screen.getByRole("button", { name: "persona_runtime_choose_model" }));
    await waitFor(() => expect(requestModels).toHaveBeenCalledTimes(1));

    mockQueryEndpoint("runtime_host/model_discovery:getMyRequest", {
      requestId: "request_1",
      deviceId: "device_mac",
      adapterId: "codex",
      status: "completed",
      models: [{
        provider: "openai",
        modelId: "gpt-5.6",
        displayName: "GPT-5.6",
        availability: "available",
        unavailableReason: null,
        inputModalities: ["text", "image"],
        supportsTools: true,
        supportsReasoning: true,
      }],
      error: null,
      expiresAt: Date.now() + 120_000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    view.rerender(
      <MemoryRouter initialEntries={["/app/personas/new"]}>
        <Routes>
          <Route path="/app/personas/:personaId" element={<PersonaEditorPage />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("option", { name: "GPT-5.6 openai" }));
    expect(screen.getByRole("combobox", { name: "persona_runtime_available_models" }))
      .toHaveTextContent("GPT-5.6");
    fireEvent.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => expect(createPersona).toHaveBeenCalledWith(expect.objectContaining({
      modelId: undefined,
      runtimeRoute: {
        deviceId: "device_mac",
        adapterId: "codex",
        modelSelectionMode: "explicit",
        provider: "openai",
        modelId: "gpt-5.6",
      },
    })));
  });
  it("saves an adapter-default Persona without a cloud model, but requires one for cloud", async () => {
    mockState.page = "persona";
    mockQueryEndpoint("runtime_host/devices:listMyDevices", [{
      deviceId: "device_mac", displayName: "Mac", isOnline: true,
      adapters: [{ adapterId: "codex", authState: "ready", operations: { listModels: true } }],
    }]);
    const createPersona = mockMutationEndpoint("personas/mutations:create", async () => "persona_1");
    renderNewPersona();
    fireEvent.change(screen.getByPlaceholderText("persona_name_placeholder"), {
      target: { value: "Local Reviewer" },
    });
    fireEvent.change(screen.getByPlaceholderText("system_prompt_placeholder"), {
      target: { value: "Review this repository." },
    });
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    expect(screen.getByText("persona_model_required")).toBeInTheDocument();
    expect(createPersona).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "persona_runtime_local" }));
    expect(screen.queryByText("locked_model_section")).not.toBeInTheDocument();
    expect(screen.getByText("persona_runtime_adapter_default")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(createPersona).toHaveBeenCalledWith(expect.objectContaining({
      modelId: undefined,
      runtimeRoute: { deviceId: "device_mac", adapterId: "codex", modelSelectionMode: "adapter_default" },
    })));
  });

  it("keeps a local Persona prompt editable while rejecting a blank definition", async () => {
    mockState.page = "persona";
    mockQueryEndpoint("runtime_host/devices:listMyDevices", [{
      deviceId: "device_mac", displayName: "Mac", isOnline: true,
      adapters: [{ adapterId: "codex", authState: "ready", operations: { listModels: true } }],
    }]);
    const createPersona = mockMutationEndpoint("personas/mutations:create", async () => "persona_1");
    renderNewPersona();
    fireEvent.change(screen.getByPlaceholderText("persona_name_placeholder"), { target: { value: "Local Assistant" } });
    fireEvent.click(screen.getByRole("button", { name: "persona_runtime_local" }));
    fireEvent.change(screen.getByPlaceholderText("system_prompt_placeholder"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    expect(screen.getByText("persona_definition_required")).toBeInTheDocument();
    expect(createPersona).not.toHaveBeenCalled();
    fireEvent.change(screen.getByPlaceholderText("system_prompt_placeholder"), { target: { value: "Answer concisely." } });
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(createPersona).toHaveBeenCalledWith(expect.objectContaining({ systemPrompt: "Answer concisely." })));
  });

});
