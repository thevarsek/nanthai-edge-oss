import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Id } from "@convex/_generated/dataModel";

import { ChatKBPicker } from "./ChatKBPicker";
import { pickGoogleDriveFiles } from "@/lib/googleDrivePicker";

const toast = vi.fn();
const useActionMock = vi.fn();
let googleConnection: { hasDrive: boolean } | undefined = { hasDrive: true };
let queryFiles: Array<{
  storageId: Id<"_storage">;
  filename: string;
  source: "upload" | "generated" | "drive";
  sizeBytes?: number;
  downloadUrl?: string | null;
  mimeType?: string;
}> | undefined = [
  {
    storageId: "storage_local" as Id<"_storage">,
    filename: "notes.pdf",
    source: "upload",
    sizeBytes: 2048,
    mimeType: "application/pdf",
  },
];

vi.mock("@/components/shared/Toast.context", () => ({
  useToast: () => ({ toast }),
}));

vi.mock("@/hooks/useSharedData", () => ({
  useConnectedAccounts: () => ({ googleConnection }),
}));

vi.mock("convex/react", () => ({
  useQuery: () => queryFiles,
  useAction: (name: unknown) => useActionMock(name),
}));

vi.mock("@/lib/googleDrivePicker", () => ({
  pickGoogleDriveFiles: vi.fn(),
}));

describe("ChatKBPicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("VITE_GOOGLE_PICKER_API_KEY", "dev-key");
    vi.stubEnv("VITE_GOOGLE_PICKER_APP_ID", "dev-app");
    googleConnection = { hasDrive: true };
    queryFiles = [
      {
        storageId: "storage_local" as Id<"_storage">,
        filename: "notes.pdf",
        source: "upload",
        sizeBytes: 2048,
        mimeType: "application/pdf",
      },
    ];
  });

  it("toggles listed knowledge base files", () => {
    const onToggle = vi.fn();

    render(<ChatKBPicker selectedFileIds={new Set()} onToggle={onToggle} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /notes.pdf/i }));

    expect(onToggle).toHaveBeenCalledWith("storage_local");
  });

  it("imports picked Drive files and selects imported storage IDs", async () => {
    const onToggle = vi.fn();
    const getToken = vi.fn().mockResolvedValue({ accessToken: "token" });
    const importFile = vi.fn().mockResolvedValue({ storageId: "storage_drive" });
    useActionMock
      .mockReturnValueOnce(getToken)
      .mockReturnValueOnce(importFile);
    vi.mocked(pickGoogleDriveFiles).mockResolvedValue([
      { id: "drive_1", name: "Drive Doc", mimeType: "application/pdf" },
    ]);

    render(<ChatKBPicker selectedFileIds={new Set()} onToggle={onToggle} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Import from Drive/i }));

    await waitFor(() => expect(onToggle).toHaveBeenCalledWith("storage_drive"));
    expect(getToken).toHaveBeenCalledWith({});
    expect(importFile).toHaveBeenCalledWith({ fileId: "drive_1" });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
  });

  it("renders selected media rows and shows the search-empty state", () => {
    queryFiles = [
      {
        storageId: "storage_image" as Id<"_storage">,
        filename: "diagram.png",
        source: "drive",
        sizeBytes: 1_500_000,
        downloadUrl: "https://example.com/diagram.png",
        mimeType: "image/png",
      },
      {
        storageId: "storage_video" as Id<"_storage">,
        filename: "demo.mp4",
        source: "generated",
        downloadUrl: "https://example.com/demo.mp4",
        mimeType: "video/mp4",
      },
    ];

    const { container } = render(
      <ChatKBPicker
        selectedFileIds={new Set(["storage_image"])}
        onToggle={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("img", { name: "diagram.png" })).toHaveAttribute(
      "src",
      "https://example.com/diagram.png",
    );
    expect(container.querySelector('video[src="https://example.com/demo.mp4"]')).toBeInTheDocument();
    expect(screen.getByText("Drive")).toBeInTheDocument();
    expect(screen.getByText("Generated")).toBeInTheDocument();
    expect(screen.getByText("1.4 MB")).toBeInTheDocument();
    expect(screen.getByText("1 file will be included as context for this message.")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "missing" } });

    expect(screen.getByText("No files found")).toBeInTheDocument();
    expect(screen.getByText("Try a different search term.")).toBeInTheDocument();
  });

  it("reports partial Drive import failures while keeping successful imports selected", async () => {
    const onToggle = vi.fn();
    const getToken = vi.fn().mockResolvedValue({ accessToken: "token" });
    const importFile = vi
      .fn()
      .mockResolvedValueOnce({ storageId: "storage_drive" })
      .mockRejectedValueOnce(new Error("quota exceeded"));
    useActionMock
      .mockReturnValueOnce(getToken)
      .mockReturnValueOnce(importFile);
    vi.mocked(pickGoogleDriveFiles).mockResolvedValue([
      { id: "drive_1", name: "Drive Doc", mimeType: "application/pdf" },
      { id: "drive_2", name: "Drive Sheet", mimeType: "application/vnd.google-apps.spreadsheet" },
    ]);

    render(<ChatKBPicker selectedFileIds={new Set()} onToggle={onToggle} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Import from Drive/i }));

    await waitFor(() => expect(onToggle).toHaveBeenCalledWith("storage_drive"));
    expect(importFile).toHaveBeenNthCalledWith(1, { fileId: "drive_1" });
    expect(importFile).toHaveBeenNthCalledWith(2, { fileId: "drive_2" });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
  });

  it("reports missing Drive connection before opening picker", () => {
    googleConnection = { hasDrive: false };

    render(<ChatKBPicker selectedFileIds={new Set()} onToggle={vi.fn()} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Import from Drive/i }));

    expect(pickGoogleDriveFiles).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
  });
});
