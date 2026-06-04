import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AttachmentPreviews } from "./MessageInput.attachments";
import type { AttachmentPreview } from "./MessageInput.attachments.types";
import { useAttachments } from "./MessageInput.attachments.hook";

const attachments: AttachmentPreview[] = [
  { name: "first.png", type: "image", mimeType: "image/png" },
  { name: "second.png", type: "image", mimeType: "image/png" },
];

describe("AttachmentPreviews", () => {
  it("closes the role dropdown before removing an attachment", () => {
    const onRemove = vi.fn();
    render(
      <AttachmentPreviews
        attachments={attachments}
        onRemove={onRemove}
        isVideoMode
        onChangeRole={vi.fn()}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: /Role/i })[1]);
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Remove attachment" })[0]);

    expect(onRemove).toHaveBeenCalledWith(0);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("does not show video role controls without a change handler", () => {
    render(
      <AttachmentPreviews
        attachments={attachments}
        onRemove={vi.fn()}
        isVideoMode
      />,
    );

    expect(screen.queryByRole("button", { name: /Role/i })).not.toBeInTheDocument();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

describe("useAttachments", () => {
  it("keeps uploading true until overlapping upload batches finish", async () => {
    const uploadUrls = ["https://uploads.example/first", "https://uploads.example/second"];
    const onCreateUploadUrl = vi.fn(async () => uploadUrls.shift() ?? "https://uploads.example/fallback");
    const responses: Array<ReturnType<typeof deferred<Response>>> = [];
    vi.stubGlobal("fetch", vi.fn(() => {
      const response = deferred<Response>();
      responses.push(response);
      return response.promise;
    }));

    const { result } = renderHook(() => useAttachments(onCreateUploadUrl));
    const first = new File(["first"], "first.png", { type: "image/png" });
    const second = new File(["second"], "second.png", { type: "image/png" });

    let firstUpload!: Promise<void>;
    let secondUpload!: Promise<void>;
    act(() => {
      firstUpload = result.current.handlePasteFiles([first]);
      secondUpload = result.current.handlePasteFiles([second]);
    });

    await waitFor(() => expect(responses).toHaveLength(2));
    expect(result.current.isUploading).toBe(true);

    await act(async () => {
      responses[0].resolve(new Response(JSON.stringify({ storageId: "storage_first" }), { status: 200 }));
      await firstUpload;
    });

    expect(result.current.isUploading).toBe(true);

    await act(async () => {
      responses[1].resolve(new Response(JSON.stringify({ storageId: "storage_second" }), { status: 200 }));
      await secondUpload;
    });

    expect(result.current.isUploading).toBe(false);
    expect(result.current.attachments.map((attachment) => attachment.name).sort()).toEqual(["first.png", "second.png"]);
  });
});
