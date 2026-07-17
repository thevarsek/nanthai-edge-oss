import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PresentationArtifactPanel } from "./PresentationArtifactPanel";
import type { PresentationProjectPayload } from "@/lib/presentations/types";

const mocks = vi.hoisted(() => ({
  saveSlide: vi.fn(),
  exportPresentation: vi.fn(),
  downloadPresentation: vi.fn(),
  printPresentation: vi.fn(),
  renderSlidesForExport: vi.fn(),
  cleanup: vi.fn(),
}));

const payload: PresentationProjectPayload = {
  project: {
    _id: "presentation_1",
    userId: "user_1",
    title: "Launch plan",
    status: "ready",
    sourceKind: "scratch",
    prompt: "A launch plan",
    direction: "editorial",
    imageMode: "none",
    aspectRatio: "16:9",
    revision: 7,
    createdAt: 1,
    updatedAt: 2,
  },
  slides: [
    {
      _id: "row_1",
      userId: "user_1",
      projectId: "presentation_1",
      slideId: "slide-1",
      position: 0,
      title: "Opening",
      html: "<section class=\"slide-root\"><h1 data-element-id=\"headline\">Opening</h1></section>",
      revision: 2,
      createdAt: 1,
      updatedAt: 2,
    },
    {
      _id: "row_2",
      userId: "user_1",
      projectId: "presentation_1",
      slideId: "slide-2",
      position: 1,
      title: "Evidence",
      html: "<section class=\"slide-root\"><p data-element-id=\"proof\">Evidence</p></section>",
      revision: 4,
      createdAt: 1,
      updatedAt: 2,
    },
  ],
  assets: [],
};

vi.mock("convex/react", () => ({
  useQuery: () => payload,
  useMutation: () => mocks.saveSlide,
}));

vi.mock("@/components/presentations/SlideFrame", () => ({
  SlideFrame: ({
    slide,
    interactionMode = "view",
    onSelect,
    onChange,
  }: {
    slide: { slideId: string; html: string };
    interactionMode?: string;
    onSelect?: (elementId: string) => void;
    onChange?: (html: string) => void;
  }) => (
    <div data-testid={`slide-frame-${slide.slideId}`} data-mode={interactionMode}>
      {onSelect && <button type="button" onClick={() => onSelect("headline")}>Select headline</button>}
      {onChange && <button type="button" onClick={() => onChange(`${slide.html}-edited`)}>Change slide</button>}
    </div>
  ),
}));

vi.mock("@/hooks/usePresentationSnapshotSync", () => ({
  usePresentationSnapshotSync: () => ({ isSyncing: false, syncNow: vi.fn() }),
}));

vi.mock("@/lib/presentations", () => ({
  presentationExporter: { exportPresentation: mocks.exportPresentation },
  downloadPresentation: mocks.downloadPresentation,
}));

vi.mock("@/lib/presentations/printPresentation", () => ({
  printPresentation: mocks.printPresentation,
}));

vi.mock("@/lib/presentations/renderExportSlides", () => ({
  renderSlidesForExport: mocks.renderSlidesForExport,
}));

describe("PresentationArtifactPanel", () => {
  beforeEach(() => {
    mocks.saveSlide.mockReset().mockImplementation(async (input) => ({
      projectId: "presentation_1",
      projectRevision: 8,
      slideId: input.slideId,
      slideRevision: input.expectedRevision + 1,
    }));
    mocks.exportPresentation.mockReset().mockResolvedValue({
      blob: new Blob(["pptx"]),
      fileName: "Launch plan.pptx",
    });
    mocks.downloadPresentation.mockReset();
    mocks.printPresentation.mockReset();
    mocks.cleanup.mockReset();
    mocks.renderSlidesForExport.mockReset().mockResolvedValue({
      roots: [document.createElement("section")],
      cleanup: mocks.cleanup,
    });
  });

  it("opens from Ideascape as a review-only presentation panel", () => {
    render(
      <PresentationArtifactPanel
        projectId="presentation_1"
        filename="Launch plan.pptx"
        onClose={vi.fn()}
        readOnly
      />,
    );

    expect(screen.getByText("Review only in Ideascape")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Select" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ask in chat" })).not.toBeInTheDocument();
    expect(screen.getAllByTestId("slide-frame-slide-1").at(-1)).toHaveAttribute("data-mode", "view");
  });

  it("navigates slides and stages slide context without leaving the side panel", async () => {
    const user = userEvent.setup();
    const onStageContext = vi.fn();
    render(
      <PresentationArtifactPanel
        projectId="presentation_1"
        filename="Launch plan.pptx"
        onClose={vi.fn()}
        onStageContext={onStageContext}
      />,
    );

    expect(screen.getAllByTestId("slide-frame-slide-1").at(-1)).toHaveAttribute("data-mode", "view");
    await user.click(screen.getByRole("button", { name: "Open slide 2: Evidence" }));
    await user.click(screen.getByRole("button", { name: "Ask in chat" }));

    expect(onStageContext).toHaveBeenCalledWith({
      context: {
        projectId: "presentation_1",
        projectRevision: 7,
        slideId: "slide-2",
        slideRevision: 4,
      },
      label: "Launch plan.pptx · Slide 2",
    });
  });

  it("collapses slide navigation and resizes the panel from the keyboard", async () => {
    const user = userEvent.setup();
    render(
      <PresentationArtifactPanel
        projectId="presentation_1"
        filename="Launch plan.pptx"
        onClose={vi.fn()}
        onStageContext={vi.fn()}
      />,
    );

    const panel = screen.getByTestId("presentation-panel");
    const resizeHandle = screen.getByRole("separator", { name: "Resize presentation panel" });
    expect(panel).toHaveStyle({ "--presentation-panel-width": "640px" });
    fireEvent.keyDown(resizeHandle, { key: "ArrowLeft" });
    expect(panel).toHaveStyle({ "--presentation-panel-width": "664px" });

    await user.click(screen.getByRole("button", { name: "Collapse slide navigation" }));
    expect(screen.queryByRole("button", { name: "Open slide 2: Evidence" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Expand slide navigation" }));
    expect(screen.getByRole("button", { name: "Open slide 2: Evidence" })).toBeInTheDocument();
  });

  it("keeps Select non-mutating and scopes Ask in chat to the chosen element", async () => {
    const user = userEvent.setup();
    const onStageContext = vi.fn();
    render(
      <PresentationArtifactPanel
        projectId="presentation_1"
        filename="Launch plan.pptx"
        onClose={vi.fn()}
        onStageContext={onStageContext}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Select" }));
    expect(screen.queryByRole("button", { name: "Change slide" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Select headline" }));
    await user.click(screen.getByRole("button", { name: "Ask in chat" }));

    expect(mocks.saveSlide).not.toHaveBeenCalled();
    expect(onStageContext).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({ elementId: "headline", slideId: "slide-1" }),
    }));
  });

  it("only enables direct mutation in Edit and saves the changed HTML", async () => {
    const user = userEvent.setup();
    render(
      <PresentationArtifactPanel
        projectId="presentation_1"
        filename="Launch plan.pptx"
        onClose={vi.fn()}
        onStageContext={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Change slide" }));

    await waitFor(() => expect(mocks.saveSlide).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "presentation_1",
      slideId: "slide-1",
      expectedRevision: 2,
      html: expect.stringContaining("-edited"),
    })));
  });

  it("clears an earlier save error after a later direct save succeeds", async () => {
    const user = userEvent.setup();
    mocks.saveSlide
      .mockRejectedValueOnce(new Error("First save failed"))
      .mockImplementation(async (input) => ({
        projectId: "presentation_1",
        projectRevision: 8,
        slideId: input.slideId,
        slideRevision: input.expectedRevision + 1,
      }));
    render(
      <PresentationArtifactPanel
        projectId="presentation_1"
        filename="Launch plan.pptx"
        onClose={vi.fn()}
        onStageContext={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Change slide" }));
    expect(await screen.findByText("First save failed")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Change slide" }));
    await waitFor(() => expect(screen.queryByText("First save failed")).not.toBeInTheDocument());
  });

  it("exports current HTML to PowerPoint and exposes PDF printing", async () => {
    const user = userEvent.setup();
    render(
      <PresentationArtifactPanel
        projectId="presentation_1"
        filename="Launch plan.pptx"
        onClose={vi.fn()}
        onStageContext={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Download PowerPoint" }));
    await waitFor(() => expect(mocks.downloadPresentation).toHaveBeenCalled());
    expect(mocks.renderSlidesForExport).toHaveBeenCalledWith(payload.slides, document, {});
    expect(mocks.cleanup).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Print or save as PDF" }));
    expect(mocks.printPresentation).toHaveBeenCalledWith(payload.slides, "Launch plan", {});
    expect(screen.queryByRole("link", { name: "Download generated file" })).not.toBeInTheDocument();
  });
});
