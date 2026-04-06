import { useMemo, type ReactNode } from "react";
import { SharedDataContext, type ShellData, useShellSubscriptions } from "@/hooks/useSharedData";

export function SharedDataProvider({ children }: { children: ReactNode }) {
  const { prefs, modelSettings, proStatus, accountCapabilities, personas, favorites } = useShellSubscriptions();
  const value = useMemo<ShellData>(
    () => ({ prefs, modelSettings, proStatus, accountCapabilities, personas, favorites }),
    [prefs, modelSettings, proStatus, accountCapabilities, personas, favorites],
  );
  return <SharedDataContext.Provider value={value}>{children}</SharedDataContext.Provider>;
}
