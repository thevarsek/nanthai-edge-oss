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
});
