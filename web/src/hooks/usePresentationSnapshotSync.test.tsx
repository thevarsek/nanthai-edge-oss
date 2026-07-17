import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePresentationSnapshotSync } from "./usePresentationSnapshotSync";

const mocks = vi.hoisted(() => ({
  cleanup: vi.fn(),
  createUploadUrl: vi.fn(),
  exportPresentation: vi.fn(),
  fetch: vi.fn(),
  persistSnapshot: vi.fn(),
  renderSlidesForExport: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useMutation: () => mocks.createUploadUrl,
  useAction: () => mocks.persistSnapshot,
}));

vi.mock("@/lib/presentations", () => ({
  presentationExporter: { exportPresentation: mocks.exportPresentation },
}));

vi.mock("@/lib/presentations/renderExportSlides", () => ({
  renderSlidesForExport: mocks.renderSlidesForExport,
}));

const slides = [{
  _id: "row_1",
  userId: "user_1",
  projectId: "project_1",
  slideId: "slide_1",
  position: 0,
  title: "Opening",
  html: '<section class="slide-root" style="position:relative;width:1280px;height:720px"><h1 data-element-id="title">Opening</h1></section>',
  revision: 2,
  createdAt: 1,
  updatedAt: 2,
}];

describe("usePresentationSnapshotSync", () => {
  beforeEach(() => {
    mocks.cleanup.mockReset();
    mocks.createUploadUrl.mockReset().mockResolvedValue("https://uploads.example/snapshot");
    mocks.exportPresentation.mockReset().mockResolvedValue({
      blob: new Blob(["pptx-bytes"]),
      fileName: "Deck.pptx",
    });
    mocks.fetch.mockReset().mockResolvedValue({
      ok: true,
      json: async () => ({ storageId: "storage_snapshot_1" }),
    });
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.persistSnapshot.mockReset().mockResolvedValue({
      projectId: "project_1",
      snapshotRevision: 7,
      storageId: "storage_snapshot_1",
    });
    mocks.renderSlidesForExport.mockReset().mockResolvedValue({
      roots: [document.createElement("section")],
      cleanup: mocks.cleanup,
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("persists a browser-fidelity snapshot when the stored snapshot is stale", async () => {
    const onError = vi.fn();
    renderHook(() => usePresentationSnapshotSync({
      projectId: "project_1",
      projectRevision: 7,
      snapshotRevision: 6,
      snapshotKind: "fallback",
      slides,
      assetUrls: {},
      filename: "Deck.pptx",
      enabled: true,
      onError,
    }));

    await waitFor(() => expect(mocks.persistSnapshot).toHaveBeenCalledWith({
      projectId: "project_1",
      expectedRevision: 7,
      storageId: "storage_snapshot_1",
      sizeBytes: 10,
    }));
    expect(mocks.renderSlidesForExport).toHaveBeenCalledWith(slides, document, {});
    expect(mocks.cleanup).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  it("does not regenerate a current browser HTML snapshot", async () => {
    renderHook(() => usePresentationSnapshotSync({
      projectId: "project_1",
      projectRevision: 7,
      snapshotRevision: 7,
      snapshotKind: "browser_html",
      slides,
      assetUrls: {},
      filename: "Deck.pptx",
      enabled: true,
      onError: vi.fn(),
    }));

    await new Promise((resolve) => window.setTimeout(resolve, 300));
    expect(mocks.renderSlidesForExport).not.toHaveBeenCalled();
  });
});
