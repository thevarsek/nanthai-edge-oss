import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SharedDataProvider } from "./SharedDataProvider";
import { useSharedData } from "./useSharedData";

const shellState = vi.hoisted(() => ({
  value: {
    prefs: { defaultModelId: "openai/gpt-5.2" },
    modelSettings: [{ modelId: "openai/gpt-5.2" }],
    proStatus: { isPro: true },
    accountCapabilities: { canUseMemory: true },
    personas: [{ _id: "persona_1", displayName: "Planner" }],
    favorites: [{ _id: "favorite_1", name: "Default" }],
  },
}));

vi.mock("@/hooks/useSharedData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./useSharedData")>();
  return {
    ...actual,
    useShellSubscriptions: () => shellState.value,
  };
});

function Consumer() {
  const data = useSharedData();
  return (
    <div>
      <span>{data.prefs?.defaultModelId}</span>
      <span>{data.proStatus?.isPro ? "pro" : "free"}</span>
      <span>{data.personas?.[0]?.displayName}</span>
    </div>
  );
}

describe("SharedDataProvider", () => {
  beforeEach(() => {
    shellState.value = {
      prefs: { defaultModelId: "openai/gpt-5.2" },
      modelSettings: [{ modelId: "openai/gpt-5.2" }],
      proStatus: { isPro: true },
      accountCapabilities: { canUseMemory: true },
      personas: [{ _id: "persona_1", displayName: "Planner" }],
      favorites: [{ _id: "favorite_1", name: "Default" }],
    };
  });

  it("publishes shell subscription data through shared context", () => {
    render(
      <SharedDataProvider>
        <Consumer />
      </SharedDataProvider>,
    );

    expect(screen.getByText("openai/gpt-5.2")).toBeInTheDocument();
    expect(screen.getByText("pro")).toBeInTheDocument();
    expect(screen.getByText("Planner")).toBeInTheDocument();
  });
});
