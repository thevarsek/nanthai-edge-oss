import { describe, expect, it } from "vitest";
import {
  createPresentationEditorState,
  presentationEditorReducer,
} from "./presentationReducer";
import type { PresentationSlideRecord } from "./types";

function slide(slideId: string, position: number, html = `<div>${slideId}</div>`): PresentationSlideRecord {
  return {
    _id: `row-${slideId}`,
    userId: "user-1",
    projectId: "project-1",
    slideId,
    position,
    title: `Slide ${position + 1}`,
    html,
    revision: 0,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("presentationEditorReducer", () => {
  it("keeps the active slide when a reactive payload hydrates", () => {
    let state = createPresentationEditorState([slide("one", 0), slide("two", 1)]);
    expect(state.saveStatus).toBe("saved");
    state = presentationEditorReducer(state, { type: "select_slide", slideId: "two" });
    state = presentationEditorReducer(state, {
      type: "hydrate",
      slides: [slide("one", 0), { ...slide("two", 1), revision: 1 }],
    });

    expect(state.activeSlideId).toBe("two");
  });

  it("records local HTML changes and supports undo and redo", () => {
    let state = createPresentationEditorState([slide("one", 0, "before")]);
    state = presentationEditorReducer(state, {
      type: "replace_html",
      slideId: "one",
      html: "after",
    });
    expect(state.history).toHaveLength(1);
    expect(state.slides[0]?.html).toBe("after");

    state = presentationEditorReducer(state, { type: "undo" });
    expect(state.slides[0]?.html).toBe("before");
    expect(state.future).toHaveLength(1);

    state = presentationEditorReducer(state, { type: "redo" });
    expect(state.slides[0]?.html).toBe("after");
  });

  it("clamps canvas zoom to the supported range", () => {
    let state = createPresentationEditorState();
    state = presentationEditorReducer(state, { type: "set_zoom", zoom: 9 });
    expect(state.zoom).toBe(1.25);
    state = presentationEditorReducer(state, { type: "set_zoom", zoom: 0.1 });
    expect(state.zoom).toBe(0.4);
  });

  it("keeps an optimistic speaker-note edit in local slide state", () => {
    let state = createPresentationEditorState([slide("one", 0)]);
    state = presentationEditorReducer(state, {
      type: "replace_notes",
      slideId: "one",
      notes: "Keep this context",
    });

    expect(state.slides[0]?.notes).toBe("Keep this context");
    expect(state.saveStatus).toBe("saving");
  });
});
