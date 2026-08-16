import type { ReactNode } from "react";

interface ChatPageViewProps {
  header: ReactNode;
  messageArea: ReactNode;
  sidePanel?: ReactNode;
  autonomousToolbar: ReactNode;
  collaborationControl: ReactNode;
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
  sidePanel,
  autonomousToolbar,
  collaborationControl,
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
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="relative min-w-0 flex-1">
          {messageArea}
        </div>
        {sidePanel}
      </div>
      {autonomousToolbar}
      {collaborationControl}
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
