import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModelSettingsEditor } from "./ModelSettingsEditor";

let modelSettings: Array<{
  openRouterId: string;
  temperature?: number;
  maxTokens?: number;
  includeReasoning?: boolean;
  reasoningEffort?: string;
}> = [];
const upsertModelSettings = vi.fn();
const deleteModelSettings = vi.fn();

vi.mock("@/hooks/useSharedData", () => ({
  useSharedData: () => ({ modelSettings }),
}));

vi.mock("@convex/_generated/api", () => ({
  api: {
    preferences: {
      mutations: {
        upsertModelSettings: "upsertModelSettings",
        deleteModelSettings: "deleteModelSettings",
      },
    },
  },
}));

vi.mock("convex/react", () => ({
  useMutation: (mutation: string) => {
    if (mutation === "upsertModelSettings") return upsertModelSettings;
    return deleteModelSettings;
  },
}));

describe("ModelSettingsEditor", () => {
  beforeEach(() => {
    upsertModelSettings.mockResolvedValue(undefined);
    deleteModelSettings.mockResolvedValue(undefined);
    modelSettings = [];
  });

  it("preserves dirty draft values across realtime setting refreshes", () => {
    modelSettings = [{
      openRouterId: "openai/model",
      temperature: 0.7,
      maxTokens: 1024,
      includeReasoning: true,
      reasoningEffort: "medium",
    }];
    const { rerender } = render(<ModelSettingsEditor modelId="openai/model" />);

    const maxTokens = screen.getByLabelText("Max Tokens");
    fireEvent.change(maxTokens, { target: { value: "2048" } });
    expect(maxTokens).toHaveValue("2048");

    modelSettings = [{
      openRouterId: "openai/model",
      temperature: 0.2,
      maxTokens: 4096,
      includeReasoning: false,
      reasoningEffort: "low",
    }];
    rerender(<ModelSettingsEditor modelId="openai/model" />);

    expect(screen.getByLabelText("Max Tokens")).toHaveValue("2048");
  });

  it("keeps saved draft values while realtime settings still contain the old baseline", async () => {
    modelSettings = [{
      openRouterId: "openai/model",
      temperature: 0.7,
      maxTokens: 1024,
      includeReasoning: true,
      reasoningEffort: "medium",
    }];
    const { rerender } = render(<ModelSettingsEditor modelId="openai/model" />);

    const maxTokens = screen.getByLabelText("Max Tokens");
    fireEvent.change(maxTokens, { target: { value: "2048" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(upsertModelSettings).toHaveBeenCalledWith(expect.objectContaining({ maxTokens: 2048 }));
    });

    rerender(<ModelSettingsEditor modelId="openai/model" />);

    expect(screen.getByLabelText("Max Tokens")).toHaveValue("2048");
  });

  it("keeps newer dirty edits when realtime acknowledges an older save", async () => {
    modelSettings = [{
      openRouterId: "openai/model",
      temperature: 0.7,
      maxTokens: 1024,
      includeReasoning: true,
      reasoningEffort: "medium",
    }];
    const { rerender } = render(<ModelSettingsEditor modelId="openai/model" />);

    fireEvent.change(screen.getByLabelText("Max Tokens"), { target: { value: "2048" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(upsertModelSettings).toHaveBeenCalledWith(expect.objectContaining({ maxTokens: 2048 }));
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();
    });

    fireEvent.change(screen.getByLabelText("Max Tokens"), { target: { value: "3072" } });
    modelSettings = [{
      openRouterId: "openai/model",
      temperature: 0.7,
      maxTokens: 2048,
      includeReasoning: true,
      reasoningEffort: "medium",
    }];
    rerender(<ModelSettingsEditor modelId="openai/model" />);

    expect(screen.getByLabelText("Max Tokens")).toHaveValue("3072");
  });

  it("does not pin an in-flight save draft after switching models", async () => {
    let resolveSave: () => void = () => {};
    upsertModelSettings.mockReturnValueOnce(new Promise<void>((resolve) => {
      resolveSave = resolve;
    }));
    modelSettings = [{
      openRouterId: "openai/model",
      temperature: 0.7,
      maxTokens: 1024,
      includeReasoning: true,
      reasoningEffort: "medium",
    }, {
      openRouterId: "anthropic/model",
      temperature: 0.4,
      maxTokens: 4096,
      includeReasoning: false,
      reasoningEffort: "low",
    }];
    const { rerender } = render(<ModelSettingsEditor modelId="openai/model" />);

    fireEvent.change(screen.getByLabelText("Max Tokens"), { target: { value: "2048" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    rerender(<ModelSettingsEditor modelId="anthropic/model" />);

    resolveSave();
    await waitFor(() => expect(upsertModelSettings).toHaveBeenCalled());
    rerender(<ModelSettingsEditor modelId="anthropic/model" />);

    expect(screen.getByLabelText("Max Tokens")).toHaveValue("4096");
  });
});
