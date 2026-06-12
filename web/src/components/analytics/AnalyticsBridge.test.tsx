import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnalyticsBridge } from "@/components/analytics/AnalyticsBridge";

type ClerkUser = {
  id: string;
  fullName?: string | null;
  username?: string | null;
  primaryEmailAddress?: { emailAddress: string } | null;
};

const analytics = vi.hoisted(() => ({
  captureAnalytics: vi.fn(),
  identifyAnalyticsUser: vi.fn(),
  initAnalytics: vi.fn(),
  isAnalyticsUserIdentified: vi.fn(),
  resetAnalyticsUser: vi.fn(),
}));

const authState = vi.hoisted(() => ({
  clerk: {
    isLoaded: true,
    isSignedIn: false,
    user: null as ClerkUser | null,
  },
  convex: {
    isAuthenticated: false,
    isLoading: false,
  },
  analyticsIdentity: undefined as { analyticsId: string } | null | undefined,
}));

vi.mock("@/lib/analytics", () => analytics);
vi.mock("@clerk/react", () => ({
  useUser: () => authState.clerk,
}));
vi.mock("convex/react", () => ({
  useConvexAuth: () => authState.convex,
  useQuery: () => authState.analyticsIdentity,
}));

function renderBridge(path = "/app") {
  return render(bridgeElement(path));
}

function bridgeElement(path = "/app") {
  return (
    <MemoryRouter initialEntries={[path]}>
      <AnalyticsBridge />
    </MemoryRouter>
  );
}

describe("AnalyticsBridge", () => {
  beforeEach(() => {
    analytics.captureAnalytics.mockReset();
    analytics.identifyAnalyticsUser.mockReset();
    analytics.initAnalytics.mockReset();
    analytics.isAnalyticsUserIdentified.mockReset();
    analytics.resetAnalyticsUser.mockReset();
    authState.clerk = {
      isLoaded: true,
      isSignedIn: false,
      user: null,
    };
    authState.convex = {
      isAuthenticated: false,
      isLoading: false,
    };
    authState.analyticsIdentity = undefined;
  });

  it("resets a persisted PostHog identity before capture events when Clerk is signed out", async () => {
    analytics.isAnalyticsUserIdentified.mockReturnValue(true);

    renderBridge("/app");

    await waitFor(() => {
      expect(analytics.resetAnalyticsUser).toHaveBeenCalledTimes(1);
      expect(analytics.captureAnalytics).toHaveBeenCalledWith(
        "page_viewed",
        expect.objectContaining({ path: "/app" }),
      );
    });

    const events = analytics.captureAnalytics.mock.calls.map(([event]) => event);
    expect(events.indexOf("sign_out")).toBeLessThan(events.indexOf("app_opened"));
    expect(events.indexOf("app_opened")).toBeLessThan(events.indexOf("page_viewed"));
  });

  it("identifies restored signed-in users with a Convex analytics ID before capture events", async () => {
    analytics.isAnalyticsUserIdentified.mockReturnValue(false);
    authState.clerk = {
      isLoaded: true,
      isSignedIn: true,
      user: {
        id: "user_1",
        fullName: "Ada Lovelace",
        username: "ada",
        primaryEmailAddress: { emailAddress: "ada@example.com" },
      },
    };
    authState.convex = {
      isAuthenticated: true,
      isLoading: false,
    };
    authState.analyticsIdentity = { analyticsId: "aid_test_123" };

    renderBridge("/chat/abc");

    await waitFor(() => {
      expect(analytics.identifyAnalyticsUser).toHaveBeenCalledWith("aid_test_123");
      expect(analytics.captureAnalytics).toHaveBeenCalledWith(
        "page_viewed",
        expect.objectContaining({ path: "/chat/abc" }),
      );
    });

    expect(JSON.stringify(analytics.identifyAnalyticsUser.mock.calls)).not.toContain("user_1");
    expect(JSON.stringify(analytics.identifyAnalyticsUser.mock.calls)).not.toContain("ada@example.com");
    expect(JSON.stringify(analytics.identifyAnalyticsUser.mock.calls)).not.toContain("Ada Lovelace");

    const events = analytics.captureAnalytics.mock.calls.map(([event]) => event);
    expect(events).not.toContain("sign_in_completed");
    expect(events.indexOf("app_opened")).toBeLessThan(events.indexOf("page_viewed"));
  });

  it("captures sign-in analytics once after a signed-out to signed-in transition", async () => {
    analytics.isAnalyticsUserIdentified.mockReturnValue(false);

    const view = renderBridge("/chat/abc");

    await waitFor(() => {
      expect(analytics.captureAnalytics).toHaveBeenCalledWith(
        "page_viewed",
        expect.objectContaining({ path: "/chat/abc" }),
      );
    });

    authState.clerk = {
      isLoaded: true,
      isSignedIn: true,
      user: {
        id: "user_1",
        fullName: "Ada Lovelace",
        username: "ada",
        primaryEmailAddress: { emailAddress: "ada@example.com" },
      },
    };
    authState.convex = {
      isAuthenticated: true,
      isLoading: false,
    };
    authState.analyticsIdentity = { analyticsId: "aid_test_123" };
    view.rerender(bridgeElement("/chat/abc"));

    await waitFor(() => {
      expect(analytics.identifyAnalyticsUser).toHaveBeenCalledTimes(1);
      expect(analytics.captureAnalytics.mock.calls.filter(([event]) => event === "sign_in_completed")).toHaveLength(1);
    });

    view.rerender(bridgeElement("/chat/abc"));
    expect(analytics.identifyAnalyticsUser).toHaveBeenCalledTimes(1);
    expect(analytics.captureAnalytics.mock.calls.filter(([event]) => event === "sign_in_completed")).toHaveLength(1);
  });

  it("resets stale identity and waits when Convex analytics ID is unavailable for a signed-in user", async () => {
    analytics.isAnalyticsUserIdentified.mockReturnValue(true);
    authState.clerk = {
      isLoaded: true,
      isSignedIn: true,
      user: {
        id: "user_1",
        fullName: "Ada Lovelace",
        username: "ada",
        primaryEmailAddress: { emailAddress: "ada@example.com" },
      },
    };
    authState.convex = {
      isAuthenticated: true,
      isLoading: false,
    };
    authState.analyticsIdentity = null;

    renderBridge("/chat/abc");

    await waitFor(() => {
      expect(analytics.resetAnalyticsUser).toHaveBeenCalledTimes(1);
    });

    expect(analytics.identifyAnalyticsUser).not.toHaveBeenCalled();
    expect(analytics.captureAnalytics).not.toHaveBeenCalledWith(
      "page_viewed",
      expect.anything(),
    );
    expect(analytics.captureAnalytics).not.toHaveBeenCalledWith(
      "app_ready",
      expect.anything(),
    );
    expect(JSON.stringify(analytics.captureAnalytics.mock.calls)).not.toContain("user_1");
    expect(JSON.stringify(analytics.captureAnalytics.mock.calls)).not.toContain("ada@example.com");
    expect(JSON.stringify(analytics.captureAnalytics.mock.calls)).not.toContain("Ada Lovelace");
  });

  it("waits for restored-session identity before signed-in lifecycle analytics", async () => {
    analytics.isAnalyticsUserIdentified.mockReturnValue(false);
    authState.clerk = {
      isLoaded: true,
      isSignedIn: true,
      user: {
        id: "user_1",
        fullName: "Ada Lovelace",
        username: "ada",
        primaryEmailAddress: { emailAddress: "ada@example.com" },
      },
    };
    authState.convex = {
      isAuthenticated: true,
      isLoading: false,
    };
    authState.analyticsIdentity = undefined;

    const view = renderBridge("/chat/abc");

    expect(analytics.identifyAnalyticsUser).not.toHaveBeenCalled();
    expect(analytics.captureAnalytics).not.toHaveBeenCalledWith(
      "app_ready",
      expect.anything(),
    );
    expect(analytics.captureAnalytics).not.toHaveBeenCalledWith(
      "page_viewed",
      expect.anything(),
    );

    authState.analyticsIdentity = { analyticsId: "aid_web_123" };
    view.rerender(bridgeElement("/chat/abc"));
    await waitFor(() => {
      expect(analytics.identifyAnalyticsUser).toHaveBeenCalledWith("aid_web_123");
      expect(analytics.captureAnalytics).toHaveBeenCalledWith(
        "app_ready",
        expect.objectContaining({
          signed_in: true,
          convex_authenticated: true,
        }),
      );
      expect(analytics.captureAnalytics).toHaveBeenCalledWith(
        "page_viewed",
        expect.objectContaining({ path: "/chat/abc" }),
      );
    });
  });

  it("does not reuse a cached analytics ID across a direct signed-in user switch", async () => {
    analytics.isAnalyticsUserIdentified.mockReturnValue(false);
    authState.clerk = {
      isLoaded: true,
      isSignedIn: true,
      user: {
        id: "user_1",
        fullName: "Ada Lovelace",
        username: "ada",
        primaryEmailAddress: { emailAddress: "ada@example.com" },
      },
    };
    authState.convex = {
      isAuthenticated: true,
      isLoading: false,
    };
    authState.analyticsIdentity = { analyticsId: "aid_user_1" };

    const view = renderBridge("/chat/abc");
    await waitFor(() => {
      expect(analytics.identifyAnalyticsUser).toHaveBeenCalledWith("aid_user_1");
    });

    authState.clerk = {
      isLoaded: true,
      isSignedIn: true,
      user: {
        id: "user_2",
        fullName: "Grace Hopper",
        username: "grace",
        primaryEmailAddress: { emailAddress: "grace@example.com" },
      },
    };
    authState.analyticsIdentity = undefined;
    view.rerender(bridgeElement("/chat/abc"));

    expect(analytics.identifyAnalyticsUser).toHaveBeenCalledTimes(1);
    expect(analytics.captureAnalytics.mock.calls.filter(([event]) => event === "page_viewed")).toHaveLength(1);

    authState.analyticsIdentity = { analyticsId: "aid_user_2" };
    view.rerender(bridgeElement("/chat/abc"));

    await waitFor(() => {
      expect(analytics.resetAnalyticsUser).toHaveBeenCalledTimes(1);
      expect(analytics.identifyAnalyticsUser).toHaveBeenCalledWith("aid_user_2");
    });
  });

  it("does not include query-string secrets in route analytics", async () => {
    analytics.isAnalyticsUserIdentified.mockReturnValue(false);

    renderBridge("/openrouter/callback?code=secret_code&state=secret_state");

    await waitFor(() => {
      expect(analytics.captureAnalytics).toHaveBeenCalledWith(
        "page_viewed",
        expect.objectContaining({
          path: "/openrouter/callback",
          pathname: "/openrouter/callback",
          search_present: true,
        }),
      );
    });

    const payloads = analytics.captureAnalytics.mock.calls.map(([, properties]) => properties);
    expect(JSON.stringify(payloads)).not.toContain("secret_code");
    expect(JSON.stringify(payloads)).not.toContain("secret_state");
  });
});
