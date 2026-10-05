import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { StepParticipantSection } from "./ScheduledJobStepParticipant";
import { createDraftStep } from "./ScheduledJobEditor.model";

const state = vi.hoisted(() => ({
  personas: [
    { _id: "cloud", displayName: "Cloud QA", modelId: "openai/gpt-6.1-sol", runtimePlacement: "cloud" },
    { _id: "local", displayName: "Local QA", modelId: "gpt-6.1-sol", runtimePlacement: "local" },
  ],
  query: vi.fn(),
}));

vi.mock("@/hooks/useSharedData", () => ({
  useSharedData: () => ({ personas: state.personas, prefs: { zdrEnabled: false } }),
  useModelSummaries: () => [{ modelId: "openai/gpt-6.1-sol", name: "GPT 6.1 Sol" }],
}));
vi.mock("convex/react", () => ({ useQuery: (...args: unknown[]) => state.query(...args) }));

beforeEach(() => {
  state.query.mockReset().mockImplementation((_query: unknown, args: "skip" | { runtimePlacement: string }) =>
    args === "skip" ? undefined : state.personas.filter(persona => persona.runtimePlacement === args.runtimePlacement));
});

it("uses the shared source query and preserves explicit local Persona selection", () => {
  const onChange = vi.fn();
  render(<StepParticipantSection step={createDraftStep()} onChange={onChange} />);
  fireEvent.click(screen.getByText("Model & Persona"));
  expect(screen.getByText("Cloud QA")).toBeInTheDocument();
  expect(screen.getByText("Local QA")).toBeInTheDocument();
  expect(screen.getByText("GPT 6.1 Sol")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Local" }));
  expect(state.query).toHaveBeenLastCalledWith(expect.anything(), { runtimePlacement: "local" });
  expect(screen.queryByText("Cloud QA")).not.toBeInTheDocument();
  expect(screen.queryByText("GPT 6.1 Sol")).not.toBeInTheDocument();
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Local QA"));
  expect(onChange).toHaveBeenCalledExactlyOnceWith({ selectedPersonaId: "local", modelId: "gpt-6.1-sol" });
});

it("shows only cloud Personas and models for the OpenRouter filter, then restores All", () => {
  render(<StepParticipantSection step={createDraftStep()} onChange={vi.fn()} />);
  fireEvent.click(screen.getByText("Model & Persona"));
  fireEvent.click(screen.getByRole("button", { name: "OpenRouter" }));
  expect(state.query).toHaveBeenLastCalledWith(expect.anything(), { runtimePlacement: "cloud" });
  expect(screen.queryByText("Local QA")).not.toBeInTheDocument();
  expect(screen.getByText("Cloud QA")).toBeInTheDocument();
  expect(screen.getByText("GPT 6.1 Sol")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "All" }));
  expect(screen.getByText("Local QA")).toBeInTheDocument();
});
