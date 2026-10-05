import type { AsyncEventQueue } from "../async_event_queue.ts";
import type { CodexTransportEvent } from "../codex_transport.ts";

export type AppServerOptions = {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

export type ActiveAppServerTurn = {
  queue: AsyncEventQueue<CodexTransportEvent>;
  turnId: string | null;
  cancelPending: boolean;
  terminalReceived: boolean;
};

export type AppServerSessionState = {
  activeTurn: ActiveAppServerTurn | null;
  turnStarted: boolean;
  cancelBeforeStart: boolean;
};
