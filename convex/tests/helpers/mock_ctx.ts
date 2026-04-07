import type { ActionCtx } from "../../_generated/server";

type AsyncFn = (...args: any[]) => Promise<unknown>;

function unexpected(name: string): AsyncFn {
  return async (...args: unknown[]) => {
    let serializedArgs = "[unserializable]";
    try {
      serializedArgs = JSON.stringify(args);
    } catch {
      // Best-effort debug output only.
    }
    throw new Error(`Unexpected ${name} call with args: ${serializedArgs}`);
  };
}

export function createMockCtx<T extends object>(
  overrides: T,
): ActionCtx & T {
  return {
    runQuery: unexpected("runQuery"),
    runMutation: unexpected("runMutation"),
    runAction: unexpected("runAction"),
    vectorSearch: unexpected("vectorSearch"),
    auth: {
      getUserIdentity: unexpected("auth.getUserIdentity"),
    },
    scheduler: {
      runAfter: unexpected("scheduler.runAfter"),
      runAt: unexpected("scheduler.runAt"),
    },
    storage: {
      get: unexpected("storage.get"),
      getUrl: unexpected("storage.getUrl"),
      store: unexpected("storage.store"),
    },
    ...overrides,
  } as ActionCtx & T;
}
