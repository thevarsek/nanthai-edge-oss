import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SourceEvidencePills } from "./SourceEvidencePills";
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
describe("recorded source pills", () => {
  it("opens the supporting passage for the selected claim", () => {
    render(<SourceEvidencePills sourceCitations={[{ sourceId: "memory:1", kind: "memory", label: "Memory", quote: "Platform funded embeddings", claim: "NanthAI pays for embeddings." }]} />);
    fireEvent.click(screen.getByRole("button", { name: "source_shared_memory" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Platform funded embeddings");
    expect(screen.getByRole("dialog")).toHaveTextContent("NanthAI pays for embeddings.");
    fireEvent.click(screen.getByRole("button", { name: "done" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("does not imply sources when absent, and distinguishes review results", () => {
    render(<SourceEvidencePills offlineResult={{ localResultId: "result", originRunId: "run", disposition: "review" }} />);
    expect(screen.getByText("local_result_separate")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
