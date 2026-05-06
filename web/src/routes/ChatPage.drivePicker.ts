import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Id } from "@convex/_generated/dataModel";
import type { Message } from "@/hooks/useChat";
import { convexErrorMessage } from "@/lib/convexErrors";
import { pickGoogleDriveFiles } from "@/lib/googleDrivePicker";
import { latestDrivePickerRequest, type DrivePickerRequest } from "@/routes/ChatPage.flow";

export function shouldOpenDrivePickerRequest(args: {
  request: DrivePickerRequest | null;
  handledRequestKey: string | null;
  isOpening: boolean;
}): boolean {
  return !!args.request && args.handledRequestKey !== args.request.key && !args.isOpening;
}

export function shouldRetryDrivePickerRequest(wasHandled: boolean): boolean {
  return !wasHandled;
}

export function useDrivePickerContinuation(args: {
  visibleMessages: Message[];
  hasGoogleDriveConnection: boolean;
  getDrivePickerAccessToken: (args: Record<string, never>) => Promise<{ accessToken: string }>;
  attachPickedDriveFiles: (args: { batchId: Id<"drivePickerBatches">; fileIds: string[] }) => Promise<unknown>;
  toast: (args: { message: string; variant: "error" }) => void;
  t: (key: string) => string;
}) {
  const {
    visibleMessages,
    hasGoogleDriveConnection,
    getDrivePickerAccessToken,
    attachPickedDriveFiles,
    toast,
    t,
  } = args;
  const drivePickerRequest = useMemo(
    () => latestDrivePickerRequest(visibleMessages),
    [visibleMessages],
  );
  const handledRequestKeyRef = useRef<string | null>(null);
  const [isOpening, setIsOpening] = useState(false);

  const openDrivePickerForContinuation = useCallback(async (): Promise<boolean> => {
    if (!drivePickerRequest || isOpening) return true;
    if (!hasGoogleDriveConnection) {
      toast({ message: t("connect_google_drive_before_choosing_files"), variant: "error" });
      return false;
    }

    const developerKey = import.meta.env.VITE_GOOGLE_PICKER_API_KEY ?? import.meta.env.VITE_GOOGLE_API_KEY;
    const appId = import.meta.env.VITE_GOOGLE_PICKER_APP_ID ?? import.meta.env.VITE_GOOGLE_PROJECT_NUMBER;
    if (!developerKey || !appId) {
      toast({ message: t("google_drive_picker_not_configured"), variant: "error" });
      return false;
    }

    setIsOpening(true);
    try {
      const token = await getDrivePickerAccessToken({});
      const picked = await pickGoogleDriveFiles({
        accessToken: token.accessToken,
        appId,
        developerKey,
        multiselect: true,
      });
      await attachPickedDriveFiles({
        batchId: drivePickerRequest.batchId,
        fileIds: picked.map((file) => file.id),
      });
      return true;
    } catch (error) {
      toast({ message: convexErrorMessage(error, t("google_drive_picker_failed")), variant: "error" });
      return false;
    } finally {
      setIsOpening(false);
    }
  }, [
    attachPickedDriveFiles,
    drivePickerRequest,
    getDrivePickerAccessToken,
    hasGoogleDriveConnection,
    isOpening,
    t,
    toast,
  ]);

  useEffect(() => {
    if (!shouldOpenDrivePickerRequest({
      request: drivePickerRequest,
      handledRequestKey: handledRequestKeyRef.current,
      isOpening,
    })) {
      return;
    }
    handledRequestKeyRef.current = drivePickerRequest?.key ?? null;
    void openDrivePickerForContinuation().then((handled) => {
      if (shouldRetryDrivePickerRequest(handled)) {
        handledRequestKeyRef.current = null;
      }
    });
  }, [drivePickerRequest, isOpening, openDrivePickerForContinuation]);

  return { drivePickerRequest, isDrivePickerOpening: isOpening };
}
