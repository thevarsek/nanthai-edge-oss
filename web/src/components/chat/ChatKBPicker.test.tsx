import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Id } from "@convex/_generated/dataModel";

import { ChatKBPicker } from "./ChatKBPicker";
import { pickGoogleDriveFiles } from "@/lib/googleDrivePicker";

const toast = vi.fn();
const useActionMock = vi.fn();
let googleConnection: { hasDrive: boolean } | undefined = { hasDrive: true };

vi.mock("@/components/shared/Toast.context", () => ({
  useToast: () => ({ toast }),
}));

vi.mock("@/hooks/useSharedData", () => ({
  useConnectedAccounts: () => ({ googleConnection }),
}));

vi.mock("convex/react", () => ({
  useQuery: () => [
    {
      storageId: "storage_local" as Id<"_storage">,
      filename: "notes.pdf",
      source: "upload",
      sizeBytes: 2048,
      mimeType: "application/pdf",
    },
  ],
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

  it("reports missing Drive connection before opening picker", () => {
    googleConnection = { hasDrive: false };

    render(<ChatKBPicker selectedFileIds={new Set()} onToggle={vi.fn()} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Import from Drive/i }));

    expect(pickGoogleDriveFiles).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
  });
});
