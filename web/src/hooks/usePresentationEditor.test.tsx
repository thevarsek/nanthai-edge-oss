import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { usePresentationEditor } from "./usePresentationEditor";
import type { PresentationSlideRecord } from "@/lib/presentations/types";

const slide: PresentationSlideRecord = {
  _id: "row-1",
  userId: "user-1",
  projectId: "project-1",
  slideId: "slide-1",
  position: 0,
  title: "Opening",
  html: "<section>Before</section>",
  notes: "Old note",
  revision: 0,
  createdAt: 1,
  updatedAt: 1,
};

const secondSlide: PresentationSlideRecord = {
  ...slide,
  _id: "row-2",
  slideId: "slide-2",
  position: 1,
  title: "Closing",
};

function savedSlide(
  input: { html: string; notes?: string },
  revision: number,
): PresentationSlideRecord {
  return { ...slide, ...input, revision, updatedAt: revision + 1 };
}

describe("usePresentationEditor", () => {
  it("merges same-tick notes and HTML edits across the serialized save queue", async () => {
    let releaseFirstSave: (() => void) | undefined;
    const firstSaveGate = new Promise<void>((resolve) => {
      releaseFirstSave = resolve;
    });
    const saveSlide = vi.fn()
      .mockImplementationOnce(async (input) => {
        await firstSaveGate;
        return savedSlide(input, 1);
      })
      .mockImplementationOnce(async (input) => savedSlide(input, 2));
    const { result } = renderHook(() => usePresentationEditor({
      slides: [slide],
      saveSlide,
      onError: vi.fn(),
    }));

    act(() => {
      result.current.saveActiveNotes("New note");
      result.current.replaceActiveHtml("<section>After</section>");
    });

    expect(result.current.activeSlide?.notes).toBe("New note");
    expect(result.current.activeSlide?.html).toBe("<section>After</section>");
    await waitFor(() => expect(saveSlide).toHaveBeenCalledTimes(1));
    releaseFirstSave?.();
    await waitFor(() => expect(saveSlide).toHaveBeenCalledTimes(2));

    expect(saveSlide.mock.calls[1]?.[0]).toEqual({
      slideId: "slide-1",
      expectedRevision: 1,
      title: "Opening",
      html: "<section>After</section>",
      notes: "New note",
    });
    await waitFor(() => expect(result.current.state.saveStatus).toBe("saved"));
    expect(result.current.activeSlide).toEqual(expect.objectContaining({
      html: "<section>After</section>",
      notes: "New note",
      revision: 2,
    }));
  });

  it("does not rebase a failed local draft onto a newer remote revision", async () => {
    const saveSlide = vi.fn().mockRejectedValue(new Error("Revision conflict"));
    const { result, rerender } = renderHook(
      ({ slides }) => usePresentationEditor({
        slides,
        saveSlide,
        onError: vi.fn(),
      }),
      { initialProps: { slides: [slide] } },
    );

    act(() => result.current.replaceActiveHtml("<section>Local draft</section>"));
    await waitFor(() => expect(result.current.state.saveStatus).toBe("error"));
    rerender({
      slides: [{
        ...slide,
        html: "<section>Remote winner</section>",
        revision: 1,
        updatedAt: 2,
      }],
    });
    expect(result.current.activeSlide?.html).toBe("<section>Local draft</section>");

    act(() => result.current.replaceActiveHtml("<section>Local retry</section>"));
    await waitFor(() => expect(saveSlide).toHaveBeenCalledTimes(2));
    expect(saveSlide.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      expectedRevision: 0,
      html: "<section>Local retry</section>",
    }));
  });

  it("does not report saved while another slide is pending or failed", async () => {
    let releaseFirst: (() => void) | undefined;
    let rejectSecond: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const secondGate = new Promise<void>((_resolve, reject) => {
      rejectSecond = () => reject(new Error("Second slide failed"));
    });
    const onError = vi.fn();
    const saveSlide = vi.fn(async (input) => {
      const source = input.slideId === slide.slideId ? slide : secondSlide;
      if (input.slideId === slide.slideId) await firstGate;
      else await secondGate;
      return { ...source, ...input, revision: 1 };
    });
    const slides = [slide, secondSlide];
    const { result } = renderHook(() => usePresentationEditor({
      slides,
      saveSlide,
      onError,
    }));

    act(() => result.current.replaceActiveHtml("<section>First edit</section>"));
    act(() => result.current.selectSlide(secondSlide.slideId));
    act(() => result.current.replaceActiveHtml("<section>Second edit</section>"));
    await waitFor(() => expect(saveSlide).toHaveBeenCalledTimes(2));
    expect(result.current.hasPendingSaves).toBe(true);

    rejectSecond?.();
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      message: "Second slide failed",
    })));
    expect(result.current.state.saveStatus).toBe("saving");

    releaseFirst?.();
    await waitFor(() => expect(result.current.hasPendingSaves).toBe(false));
    expect(result.current.state.saveStatus).toBe("error");
  });
});
