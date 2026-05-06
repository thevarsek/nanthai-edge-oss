import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { Message } from "@/hooks/useChat";
import {
  shouldOpenDrivePickerRequest,
  shouldRetryDrivePickerRequest,
  useDrivePickerContinuation,
} from "./ChatPage.drivePicker";

const request = {
  key: "msg_1:batch_1",
  batchId: "batch_1" as Id<"drivePickerBatches">,
};

function message(overrides: Partial<Message> = {}): Message {
  return {
    _id: "msg_1" as Id<"messages">,
    _creationTime: 1,
    chatId: "chat_1" as Id<"chats">,
    role: "assistant",
    content: "",
    status: "streaming",
    createdAt: 1,
    ...overrides,
  };
}

describe("ChatPage Drive picker continuation", () => {
  it("opens only unhandled requests while no picker is already opening", () => {
    expect(shouldOpenDrivePickerRequest({
      request,
      handledRequestKey: null,
      isOpening: false,
    })).toBe(true);
    expect(shouldOpenDrivePickerRequest({
      request,
      handledRequestKey: request.key,
      isOpening: false,
    })).toBe(false);
    expect(shouldOpenDrivePickerRequest({
      request,
      handledRequestKey: null,
      isOpening: true,
    })).toBe(false);
  });

  it("allows retry after failed picker handling", () => {
    expect(shouldRetryDrivePickerRequest(false)).toBe(true);
    expect(shouldRetryDrivePickerRequest(true)).toBe(false);
  });

  it("does not retry the same failed request on unrelated rerenders", async () => {
    const visibleMessages = [message({ drivePickerBatchId: request.batchId })];
    const getDrivePickerAccessToken = async () => ({ accessToken: "token" });
    const attachPickedDriveFiles = async () => null;
    const toast = vi.fn();
    const t = (key: string) => key;

    const { rerender } = renderHook((props: Parameters<typeof useDrivePickerContinuation>[0]) => (
      useDrivePickerContinuation(props)
    ), {
      initialProps: {
        visibleMessages,
        hasGoogleDriveConnection: false,
        getDrivePickerAccessToken,
        attachPickedDriveFiles,
        toast,
        t,
      },
    });

    await waitFor(() => {
      expect(toast).toHaveBeenCalledTimes(1);
    });

    rerender({
      visibleMessages,
      hasGoogleDriveConnection: false,
      getDrivePickerAccessToken,
      attachPickedDriveFiles,
      toast,
      t,
    });
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(toast).toHaveBeenCalledTimes(1);
  });
});
