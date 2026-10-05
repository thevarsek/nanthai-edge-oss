import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  mockMutationEndpoint,
  mockQueryEndpoint,
} from "@/test/criticalRoutesCoverage";
import { PersonaRuntimeModelPicker } from "./PersonaRuntimeModelPicker";
import type { PersonaRuntimeDevice, PersonaRuntimeRoute } from "./PersonaRuntimeRoute";

const route: PersonaRuntimeRoute = {
  deviceId: "device_mac",
  adapterId: "codex",
  modelSelectionMode: "adapter_default",
};

function device(overrides: Partial<PersonaRuntimeDevice> = {}): PersonaRuntimeDevice {
  return {
    deviceId: "device_mac",
    displayName: "Dino’s MacBook",
    isOnline: true,
    adapters: [{
      adapterId: "codex",
      authState: "ready",
      operations: { listModels: true },
    }],
    ...overrides,
  };
}

function completedDiscovery(overrides: Record<string, unknown> = {}) {
  return {
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
    }, {
      provider: "openai",
      modelId: "hidden-model",
      displayName: "Hidden model",
      availability: "unavailable",
      unavailableReason: "Not enabled for this account",
      inputModalities: ["text"],
      supportsTools: true,
      supportsReasoning: true,
    }],
    error: null,
    expiresAt: Date.now() + 120_000,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe("PersonaRuntimeModelPicker", () => {
  it("discovers models only after the user asks and applies an available result", async () => {
    const requestModels = mockMutationEndpoint(
      "runtime_host/model_discovery:requestModels",
      async () => ({ requestId: "request_1", expiresAt: Date.now() + 120_000 }),
    );
    const onChange = vi.fn();
    const { rerender } = render(
      <PersonaRuntimeModelPicker route={route} device={device()} onChange={onChange} />,
    );

    expect(requestModels).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "persona_runtime_choose_model" }));
    await waitFor(() => expect(requestModels).toHaveBeenCalledWith({
      deviceId: "device_mac",
      adapterId: "codex",
    }));

    mockQueryEndpoint(
      "runtime_host/model_discovery:getMyRequest",
      completedDiscovery(),
    );
    rerender(<PersonaRuntimeModelPicker route={route} device={device()} onChange={onChange} />);

    expect(screen.getByRole("option", { name: "GPT-5.6 openai" })).toBeEnabled();
    expect(screen.getByRole("option", {
      name: "Hidden model openai Not enabled for this account",
    })).toBeDisabled();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "hidden-model" } });
    expect(screen.queryByRole("option", { name: "GPT-5.6 openai" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Hidden model openai Not enabled for this account" })).toBeDisabled();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "OPENAI" } });
    expect(screen.getByRole("option", { name: "GPT-5.6 openai" })).toBeEnabled();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("option", { name: "GPT-5.6 openai" }));
    expect(onChange).toHaveBeenCalledWith({
      deviceId: "device_mac",
      adapterId: "codex",
      modelSelectionMode: "explicit",
      provider: "openai",
      modelId: "gpt-5.6",
    });

    rerender(
      <PersonaRuntimeModelPicker
        route={{
          ...route,
          modelSelectionMode: "explicit",
          provider: "openai",
          modelId: "gpt-5.6",
        }}
        device={device()}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole("combobox")).toHaveTextContent("GPT-5.6");
    fireEvent.click(screen.getByRole("button", {
      name: "persona_runtime_use_adapter_default",
    }));
    const adapterDefaultRoute = onChange.mock.calls.at(-1)?.[0] as PersonaRuntimeRoute;
    rerender(
      <PersonaRuntimeModelPicker
        route={adapterDefaultRoute}
        device={device()}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole("combobox")).toHaveTextContent("persona_runtime_choose_discovered_model");
  });

  it("preserves an offline explicit route while requiring reconnect for replacement", () => {
    const onChange = vi.fn();
    render(
      <PersonaRuntimeModelPicker
        route={{ ...route, modelSelectionMode: "explicit", modelId: "gpt-5.6" }}
        device={device({ isOnline: false, adapters: [] })}
        onChange={onChange}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("persona_runtime_model_reconnect");
    expect(screen.queryByRole("button", { name: "persona_runtime_change_model" }))
      .not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "persona_runtime_use_adapter_default" }));
    expect(onChange).toHaveBeenCalledWith(route);
  });

  it("explains when the selected adapter cannot discover models", () => {
    render(
      <PersonaRuntimeModelPicker
        route={route}
        device={device({
          adapters: [{
            adapterId: "codex",
            authState: "ready",
            operations: { listModels: false },
          }],
        })}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "persona_runtime_discovery_unsupported",
    );
    expect(screen.queryByRole("button", { name: "persona_runtime_choose_model" }))
      .not.toBeInTheDocument();
  });

  it("keeps a failed request retryable and ignores results from another route", async () => {
    const requestModels = mockMutationEndpoint(
      "runtime_host/model_discovery:requestModels",
      async () => ({ requestId: "request_1", expiresAt: Date.now() + 120_000 }),
    );
    const { rerender } = render(
      <PersonaRuntimeModelPicker route={route} device={device()} onChange={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "persona_runtime_choose_model" }));
    await waitFor(() => expect(requestModels).toHaveBeenCalledTimes(1));

    mockQueryEndpoint("runtime_host/model_discovery:getMyRequest", completedDiscovery({
      status: "failed",
      models: [],
      error: { code: "RUNTIME_UNAVAILABLE", message: "Runtime Host disconnected" },
    }));
    rerender(<PersonaRuntimeModelPicker route={route} device={device()} onChange={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Runtime Host disconnected");
    fireEvent.click(screen.getByRole("button", { name: "retry" }));
    await waitFor(() => expect(requestModels).toHaveBeenCalledTimes(2));

    const otherRoute = { ...route, deviceId: "device_other" };
    rerender(
      <PersonaRuntimeModelPicker
        route={otherRoute}
        device={device({ deviceId: "device_other" })}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByText("Runtime Host disconnected")).not.toBeInTheDocument();
  });
});
