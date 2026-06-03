export interface ConnectionRowState {
  isLoading: boolean;
  isConnected: boolean;
}

type StatusConnection = {
  status?: string | null;
} | null | undefined;

type GoogleWorkspaceConnection = {
  status?: string | null;
  hasDrive?: boolean | null;
  hasCalendar?: boolean | null;
} | null | undefined;

export function statusConnectionState(connection: StatusConnection): ConnectionRowState {
  return {
    isLoading: connection === undefined,
    isConnected: connection?.status === "active",
  };
}

export function googleWorkspaceConnectionState(
  connection: GoogleWorkspaceConnection,
): ConnectionRowState {
  return {
    isLoading: connection === undefined,
    isConnected: connection?.status === "active" &&
      connection.hasDrive === true &&
      connection.hasCalendar === true,
  };
}
