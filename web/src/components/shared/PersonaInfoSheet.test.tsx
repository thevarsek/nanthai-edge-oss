import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PersonaInfoSheet } from "./PersonaInfoSheet";
import type { PersonaItem } from "@/components/chat/ChatParticipantPicker.helpers";

type TestModelSummary = {
  modelId: string;
  name: string;
  provider: string;
  isFree?: boolean;
  inputPricePer1M?: number;
  outputPricePer1M?: number;
};

const { modelSummaryState } = vi.hoisted(() => ({
  modelSummaryState: {
    summaries: [
      {
        modelId: "openai/gpt-free",
        name: "GPT Free",
        provider: "openai",
        isFree: true,
        inputPricePer1M: 2,
        outputPricePer1M: 4,
      },
      {
        modelId: "anthropic/claude:free",
        name: "Claude Free",
        provider: "anthropic",
      },
      {
        modelId: "image/provider-zero",
        name: "Image Zero",
        provider: "image",
        inputPricePer1M: 0,
        outputPricePer1M: 0,
      },
    ] as TestModelSummary[] | undefined,
  },
}));

vi.mock("@/hooks/useSharedData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useSharedData")>();
  return {
    ...actual,
    useModelSummaries: () => modelSummaryState.summaries,
  };
});

function personaFor(modelId: string): PersonaItem {
  return {
    _id: "persona_1" as never,
    displayName: "Helper",
    modelId,
  };
}

describe("PersonaInfoSheet", () => {
  beforeEach(() => {
    modelSummaryState.summaries = [
      {
        modelId: "openai/gpt-free",
        name: "GPT Free",
        provider: "openai",
        isFree: true,
        inputPricePer1M: 2,
        outputPricePer1M: 4,
      },
      {
        modelId: "anthropic/claude:free",
        name: "Claude Free",
        provider: "anthropic",
      },
      {
        modelId: "image/provider-zero",
        name: "Image Zero",
        provider: "image",
        inputPricePer1M: 0,
        outputPricePer1M: 0,
      },
    ];
  });

  it("uses the canonical free model flag instead of token prices", () => {
    render(<PersonaInfoSheet persona={personaFor("openai/gpt-free")} onClose={vi.fn()} />);

    expect(screen.getByText("Free")).toBeInTheDocument();
  });

  it("falls back to the free route suffix when the backend flag is absent", () => {
    render(<PersonaInfoSheet persona={personaFor("anthropic/claude:free")} onClose={vi.fn()} />);

    expect(screen.getByText("Free")).toBeInTheDocument();
  });

  it("does not infer free status from zero token prices", () => {
    render(<PersonaInfoSheet persona={personaFor("image/provider-zero")} onClose={vi.fn()} />);

    expect(screen.queryByText("Free")).not.toBeInTheDocument();
  });

  it("falls back to the persona model id while summaries are unavailable", () => {
    modelSummaryState.summaries = undefined;

    render(<PersonaInfoSheet persona={personaFor("anthropic/claude:free")} onClose={vi.fn()} />);

    expect(screen.getByText("Free")).toBeInTheDocument();
  });
});
