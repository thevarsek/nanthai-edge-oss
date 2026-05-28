import { render } from "@testing-library/react";
import type React from "react";
import { beforeEach, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const mockState = vi.hoisted(() => ({
  page: "",
  queryData: {} as Record<string, unknown>,
  sharedData: {} as Record<string, unknown>,
  modelSummaries: undefined as unknown,
  visibleSkills: undefined as unknown,
  connectedAccounts: {} as Record<string, unknown>,
  mutation: vi.fn(async (): Promise<unknown> => null),
  action: vi.fn(async (): Promise<unknown> => ({ accessToken: "drive-token" })),
  navigate: vi.fn(),
  user: { id: "user_1" },
  connectProviderWithPopup: vi.fn(async (...args: unknown[]): Promise<unknown> => {
    void args;
    return null;
  }),
  pickGoogleDriveFiles: vi.fn(async (...args: unknown[]): Promise<unknown> => {
    void args;
    return [];
  }),
  toast: vi.fn(),
}));

export { mockState };

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (typeof options?.defaultValue === "string") return options.defaultValue;
      if (typeof options?.name === "string") return `${key}:${options.name}`;
      if (typeof options?.count === "number") return `${key}:${options.count}`;
      if (typeof options?.var1 === "string" || typeof options?.var1 === "number") return `${key}:${options.var1}`;
      return key;
    },
  }),
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useNavigate: () => mockState.navigate,
  };
});

vi.mock("@clerk/react", () => ({
  useAuth: () => ({ isSignedIn: true }),
  useConvexAuth: () => ({ isAuthenticated: true }),
  useUser: () => ({ user: mockState.user }),
}));

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: true }),
  useQuery: (_query: unknown, args?: unknown) => {
    switch (mockState.page) {
      case "memory":
        return mockState.queryData.memories;
      case "kb":
        return args === undefined ? mockState.queryData.folders : mockState.queryData.files;
      case "scheduled":
        if (args && typeof args === "object" && "limit" in args) return mockState.queryData.runs;
        if (args && typeof args === "object" && "jobId" in args) return mockState.queryData.triggerTokens;
        return mockState.queryData.jobs;
      case "skills":
        return mockState.queryData.prefs;
      case "skillDetail":
        return args === "skip" ? undefined : mockState.queryData.skillDetail;
      case "persona":
        return args === "skip" ? undefined : mockState.queryData.persona;
      default:
        return undefined;
    }
  },
  useMutation: () => mockState.mutation,
  useAction: () => mockState.action,
}));

vi.mock("@/hooks/useSharedData", () => ({
  useSharedData: () => mockState.sharedData,
  useModelSummaries: () => mockState.modelSummaries,
  useVisibleSkills: () => mockState.visibleSkills,
  useConnectedAccounts: () => mockState.connectedAccounts,
}));

vi.mock("@/hooks/usePreferenceBuffer", () => ({
  usePreferenceBuffer: () => ({
    updatePreference: mockState.mutation,
    updatePreferenceImmediate: mockState.mutation,
  }),
}));

vi.mock("@/hooks/useProGate.hook", () => ({
  useProGate: () => ({ isPro: true }),
}));

vi.mock("@/components/shared/Toast.context", () => ({
  useToast: () => ({ toast: mockState.toast }),
}));

vi.mock("@/lib/providerOAuth", () => ({
  connectProviderWithPopup: (provider: unknown, options?: unknown) => mockState.connectProviderWithPopup(provider, options),
}));

vi.mock("@/lib/googleDrivePicker", () => ({
  pickGoogleDriveFiles: (options: unknown) => mockState.pickGoogleDriveFiles(options),
}));

export function renderRoute(element: React.ReactElement, path = "/app/settings/test") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      {element}
    </MemoryRouter>,
  );
}

export function skill(overrides: Record<string, unknown> = {}) {
  return {
    _id: "skill_1",
    slug: "research",
    name: "Research Skill",
    summary: "Finds sources",
    instructionsRaw: "Use citations.",
    compilationStatus: "compiled",
    scope: "system",
    origin: "nanthaiBuiltin",
    visibility: "public",
    lockState: "locked",
    status: "active",
    runtimeMode: "toolAugmented",
    requiredToolIds: ["web_search"],
    requiredToolProfiles: ["search"],
    requiredIntegrationIds: ["drive"],
    requiredCapabilities: [],
    unsupportedCapabilityCodes: [],
    validationWarnings: ["Needs search access"],
    version: 2,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_010_000,
    ...overrides,
  };
}

beforeEach(() => {
  mockState.page = "";
  mockState.queryData = {};
  mockState.sharedData = {
    prefs: { isMemoryEnabled: true },
    favorites: [],
    personas: [],
  };
  mockState.modelSummaries = [];
  mockState.visibleSkills = [];
  mockState.connectedAccounts = {
    googleConnection: { hasDrive: true, hasCalendar: true },
    gmailManualConnection: { status: "active" },
    microsoftConnection: null,
    notionConnection: null,
    slackConnection: null,
    appleCalendarConnection: null,
    clozeConnection: null,
  };
  mockState.mutation.mockReset();
  mockState.mutation.mockResolvedValue(null);
  mockState.action.mockReset();
  mockState.action.mockResolvedValue({ accessToken: "drive-token" });
  mockState.navigate.mockReset();
  mockState.connectProviderWithPopup.mockReset();
  mockState.pickGoogleDriveFiles.mockReset();
  mockState.pickGoogleDriveFiles.mockResolvedValue([]);
  mockState.toast.mockReset();
});
