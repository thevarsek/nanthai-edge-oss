import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignOutCacheBridge } from "./SignOutCacheBridge";

const useAuth = vi.fn();
const clearAuthenticatedCaches = vi.fn().mockResolvedValue(undefined);

vi.mock("@clerk/react", () => ({ useAuth: () => useAuth() }));
vi.mock("@/lib/clearAuthenticatedCaches", () => ({
  clearAuthenticatedCaches: () => clearAuthenticatedCaches(),
}));

describe("SignOutCacheBridge", () => {
  beforeEach(() => {
    clearAuthenticatedCaches.mockClear();
  });

  it("clears caches once auth has loaded and the user is signed out", () => {
    useAuth.mockReturnValue({ isLoaded: true, isSignedIn: false });
    render(<SignOutCacheBridge />);
    expect(clearAuthenticatedCaches).toHaveBeenCalledTimes(1);
  });

  it("keeps caches while signed in or while auth is loading", () => {
    useAuth.mockReturnValue({ isLoaded: true, isSignedIn: true });
    render(<SignOutCacheBridge />);
    useAuth.mockReturnValue({ isLoaded: false, isSignedIn: undefined });
    render(<SignOutCacheBridge />);
    expect(clearAuthenticatedCaches).not.toHaveBeenCalled();
  });
});
