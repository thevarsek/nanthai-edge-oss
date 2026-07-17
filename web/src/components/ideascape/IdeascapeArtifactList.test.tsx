import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { IdeascapeArtifactList } from "./IdeascapeArtifactList";

describe("IdeascapeArtifactList", () => {
  it("shows compact presentation and tracked-change previews without selecting the node", () => {
    const onOpen = vi.fn();
    const parentClick = vi.fn();
    render(
      <div onClick={parentClick}>
        <IdeascapeArtifactList
          artifacts={[
            {
              annotationCount: 0,
              file: {
                _id: "file_pptx",
                filename: "Launch plan.pptx",
                mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                presentationProjectId: "project_1",
              },
            },
            {
              annotationCount: 3,
              file: {
                _id: "file_docx",
                filename: "Contract.docx",
                mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              },
            },
          ]}
          onOpen={onOpen}
        />
      </div>,
    );

    expect(screen.getByText("Presentation · Open preview")).toBeInTheDocument();
    expect(screen.getByText("Word document · 3 tracked changes · Open preview")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Open Launch plan.pptx"));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({
      file: expect.objectContaining({ _id: "file_pptx" }),
    }));
    expect(parentClick).not.toHaveBeenCalled();
  });
});
