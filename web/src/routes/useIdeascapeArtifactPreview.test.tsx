import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { Message } from "@/hooks/useChat";
import { useIdeascapeArtifactPreview } from "./useIdeascapeArtifactPreview";

const useQuery = vi.fn();

vi.mock("convex/react", () => ({ useQuery: (...args: unknown[]) => useQuery(...args) }));
vi.mock("@convex/_generated/api", () => ({
  api: { chat: { queries: { getGeneratedFilesByIds: "getGeneratedFilesByIds" } } },
}));
vi.mock("@/components/chat/PresentationArtifactPanel", () => ({
  PresentationArtifactPanel: ({ filename, readOnly }: { filename: string; readOnly?: boolean }) => (
    <div data-testid="presentation-preview">{filename}-{String(readOnly)}</div>
  ),
}));
vi.mock("@/components/chat/DocumentPreviewPanel", () => ({
  DocumentPreviewPanel: () => <div data-testid="document-preview" />,
}));

const message = {
  _id: "message_1" as Id<"messages">,
  role: "assistant",
  content: "Created the deck",
  status: "completed",
  generatedFileIds: ["file_1" as Id<"generatedFiles">],
  createdAt: 1,
} as Message;

function Probe() {
  const preview = useIdeascapeArtifactPreview([message]);
  const artifact = preview.artifactsByMessageId.get("message_1")?.[0];
  return (
    <div>
      <span data-testid="artifact-count">{preview.artifactsByMessageId.get("message_1")?.length ?? 0}</span>
      {artifact && <button onClick={() => preview.openArtifact(message, artifact)}>Open artifact</button>}
      {preview.panel}
    </div>
  );
}

describe("useIdeascapeArtifactPreview", () => {
  it("loads visible artifact IDs in one query and opens the existing read-only panel", async () => {
    useQuery.mockReturnValue([{
      _id: "file_1",
      messageId: "message_1",
      filename: "Launch plan.pptx",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      presentationProjectId: "project_1",
    }]);
    const user = userEvent.setup();
    render(<Probe />);

    expect(useQuery).toHaveBeenCalledWith("getGeneratedFilesByIds", {
      fileIds: ["file_1"],
    });
    expect(screen.getByTestId("artifact-count")).toHaveTextContent("1");
    await user.click(screen.getByRole("button", { name: "Open artifact" }));
    expect(screen.getByTestId("presentation-preview")).toHaveTextContent("Launch plan.pptx-true");
  });
});
