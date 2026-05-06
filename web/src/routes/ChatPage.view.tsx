import type { ReactNode } from "react";

interface ChatPageViewProps {
  header: ReactNode;
  messageArea: ReactNode;
  autonomousToolbar: ReactNode;
  balanceIndicator: ReactNode;
  turnOverrideChips: ReactNode;
  composerPalette: ReactNode;
  composer: ReactNode;
  modalPanels: ReactNode;
  renameDialog: ReactNode;
  retryPicker: ReactNode;
}

export function ChatPageView({
  header,
  messageArea,
  autonomousToolbar,
  balanceIndicator,
  turnOverrideChips,
  composerPalette,
  composer,
  modalPanels,
  renameDialog,
  retryPicker,
}: ChatPageViewProps) {
  return (
    <div className="flex-1 flex flex-col h-full min-h-0">
      {header}
      <div className="flex-1 relative min-h-0">
        {messageArea}
      </div>
      {autonomousToolbar}
      {balanceIndicator}
      {turnOverrideChips}
      <div className="relative">
        {composerPalette}
        {composer}
      </div>
      {modalPanels}
      {renameDialog}
      {retryPicker}
    </div>
  );
}
