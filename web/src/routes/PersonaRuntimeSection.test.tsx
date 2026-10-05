import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  PersonaRuntimeSection,
} from "./PersonaRuntimeSection";
import {
  personaRuntimeRouteIsValid,
  personaRuntimeRoutesEqual,
  type PersonaRuntimeRoute,
} from "./PersonaRuntimeRoute";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.model ? `${key}:${String(options.model)}` : key,
  }),
}));

vi.mock("./PersonaRuntimeModelPicker", () => ({
  PersonaRuntimeModelPicker: () => <div data-testid="runtime-model-picker" />,
}));

const localRoute: PersonaRuntimeRoute = {
  deviceId: "device_mac",
  adapterId: "codex",
  modelSelectionMode: "adapter_default",
};

describe("PersonaRuntimeSection", () => {
  it("selects a ready Codex machine and can return to cloud", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <PersonaRuntimeSection
        route={null}
        devices={[{
          deviceId: "device_mac",
          displayName: "Dino’s MacBook",
          isOnline: true,
          adapters: [{
            adapterId: "codex",
            authState: "ready",
            operations: { listModels: true },
          }],
        }]}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "persona_runtime_local" }));
    expect(onChange).toHaveBeenCalledWith(localRoute);

    rerender(<PersonaRuntimeSection route={localRoute} devices={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "persona_runtime_cloud" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("keeps an existing explicit model visible without offering a free-form replacement", () => {
    render(
      <PersonaRuntimeSection
        route={{ ...localRoute, modelSelectionMode: "explicit", modelId: "gpt-5.6" }}
        devices={[]}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText("persona_runtime_explicit_model:gpt-5.6")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("does not visually assign a machine that reconnects after Local was selected", () => {
    const onChange = vi.fn();
    render(
      <PersonaRuntimeSection
        route={{ ...localRoute, deviceId: "" }}
        devices={[{
          deviceId: "device_mac",
          displayName: "Dino’s MacBook",
          isOnline: true,
          adapters: [{
            adapterId: "codex",
            authState: "ready",
            operations: { listModels: true },
          }],
        }]}
        onChange={onChange}
      />,
    );

    const machine = screen.getByRole("combobox", { name: "persona_runtime_machine" });
    expect(machine).toHaveValue("");
    expect(screen.getByRole("option", { name: "persona_runtime_choose_machine" })).toBeDisabled();

    fireEvent.change(machine, { target: { value: "device_mac" } });
    expect(onChange).toHaveBeenCalledWith(localRoute);
  });

  it("selects Pi-only machines and changes harness without changing the machine", () => {
    const onChange = vi.fn();
    const devices = [{ deviceId: "pi_mac", displayName: "Pi Mac", isOnline: true,
      adapters: [{ adapterId: "pi", displayName: "Pi", isAvailable: true, authState: "ready", operations: { listModels: true } }] }];
    const { rerender } = render(<PersonaRuntimeSection route={null} devices={devices} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "persona_runtime_local" }));
    expect(onChange).toHaveBeenCalledWith({ deviceId: "pi_mac", adapterId: "pi", modelSelectionMode: "adapter_default" });
    devices[0].adapters.push({ adapterId: "codex", displayName: "OpenAI Codex", isAvailable: true, authState: "ready", operations: { listModels: true } });
    rerender(<PersonaRuntimeSection route={{ deviceId: "pi_mac", adapterId: "pi", modelSelectionMode: "explicit", provider: "ollama", modelId: "qa-model" }} devices={devices} onChange={onChange} />);
    fireEvent.change(screen.getByRole("combobox", { name: "persona_runtime_adapter" }), { target: { value: "codex" } });
    expect(onChange).toHaveBeenLastCalledWith({ deviceId: "pi_mac", adapterId: "codex", modelSelectionMode: "adapter_default" });
  });

  it("validates and compares route patches exactly", () => {
    expect(personaRuntimeRouteIsValid(localRoute)).toBe(true);
    expect(personaRuntimeRouteIsValid({ ...localRoute, deviceId: "" })).toBe(false);
    expect(personaRuntimeRouteIsValid({
      ...localRoute,
      modelSelectionMode: "explicit",
      modelId: undefined,
    })).toBe(false);
    expect(personaRuntimeRoutesEqual(localRoute, { ...localRoute })).toBe(true);
    expect(personaRuntimeRoutesEqual(localRoute, { ...localRoute, deviceId: "other" })).toBe(false);
  });
});
