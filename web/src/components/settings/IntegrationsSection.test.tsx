import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IntegrationDefaultsCard } from "./IntegrationsSection";

let prefs: unknown;
const setIntegrationDefault = vi.fn();
const removeIntegrationDefault = vi.fn();

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

vi.mock("convex/react", () => ({
  useQuery: () => prefs,
  useMutation: (() => {
    let index = 0;
    return () => (index++ % 2 === 0 ? setIntegrationDefault : removeIntegrationDefault);
  })(),
}));

vi.mock("@/components/shared/Toast.context", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

describe("IntegrationDefaultsCard", () => {
  beforeEach(() => {
    prefs = null;
    setIntegrationDefault.mockReset();
    removeIntegrationDefault.mockReset();
    setIntegrationDefault.mockResolvedValue(undefined);
    removeIntegrationDefault.mockResolvedValue(undefined);
  });

  it("does not write defaults while preferences are still loading", () => {
    prefs = undefined;

    render(<IntegrationDefaultsCard />);

    const gmailButton = screen.getByRole("button", { name: /gmail/i });
    expect(gmailButton).toBeDisabled();
    fireEvent.click(gmailButton);

    expect(setIntegrationDefault).not.toHaveBeenCalled();
    expect(removeIntegrationDefault).not.toHaveBeenCalled();
  });

  it("cycles from a loaded disabled default to inherited", async () => {
    prefs = { integrationDefaults: [{ integrationId: "gmail", enabled: false }] };

    render(<IntegrationDefaultsCard />);
    fireEvent.click(screen.getByRole("button", { name: /gmail/i }));

    await waitFor(() => {
      expect(removeIntegrationDefault).toHaveBeenCalledWith({ integrationId: "gmail" });
    });
  });

  it("ignores an older failed integration default request after a newer success", async () => {
    const firstRequest = deferred();
    const secondRequest = deferred();
    setIntegrationDefault
      .mockImplementationOnce(() => firstRequest.promise)
      .mockImplementationOnce(() => secondRequest.promise);
    prefs = { integrationDefaults: [] };

    const { rerender } = render(<IntegrationDefaultsCard />);
    fireEvent.click(screen.getByRole("button", { name: /gmail/i }));
    fireEvent.click(screen.getByRole("button", { name: /gmail/i }));

    expect(setIntegrationDefault).toHaveBeenNthCalledWith(1, { integrationId: "gmail", enabled: true });
    expect(setIntegrationDefault).toHaveBeenNthCalledWith(2, { integrationId: "gmail", enabled: false });

    await act(async () => {
      secondRequest.resolve();
      await secondRequest.promise;
    });
    prefs = { integrationDefaults: [{ integrationId: "gmail", enabled: false }] };
    rerender(<IntegrationDefaultsCard />);

    await act(async () => {
      firstRequest.reject(new Error("first request failed"));
      await firstRequest.promise.catch(() => undefined);
    });

    const gmailButton = screen.getByRole("button", { name: /gmail/i });
    expect(gmailButton).toHaveTextContent("Disabled");
    expect(gmailButton).not.toHaveTextContent("Disabled (default)");
  });

  it("rolls back one failed integration without masking another server echo", async () => {
    const gmailRequest = deferred();
    const driveRequest = deferred();
    setIntegrationDefault
      .mockImplementationOnce(() => gmailRequest.promise)
      .mockImplementationOnce(() => driveRequest.promise);
    prefs = { integrationDefaults: [] };

    const { rerender } = render(<IntegrationDefaultsCard />);
    fireEvent.click(screen.getByRole("button", { name: /gmail/i }));
    fireEvent.click(screen.getByRole("button", { name: /google drive/i }));

    expect(setIntegrationDefault).toHaveBeenNthCalledWith(1, { integrationId: "gmail", enabled: true });
    expect(setIntegrationDefault).toHaveBeenNthCalledWith(2, { integrationId: "drive", enabled: true });

    await act(async () => {
      driveRequest.resolve();
      await driveRequest.promise;
    });
    prefs = { integrationDefaults: [{ integrationId: "drive", enabled: true }] };
    rerender(<IntegrationDefaultsCard />);

    await act(async () => {
      gmailRequest.reject(new Error("gmail request failed"));
      await gmailRequest.promise.catch(() => undefined);
    });

    expect(screen.getByRole("button", { name: /google drive/i })).toHaveTextContent("Enabled");
    expect(screen.getByRole("button", { name: /gmail/i })).toHaveTextContent("Disabled (default)");
  });
});
