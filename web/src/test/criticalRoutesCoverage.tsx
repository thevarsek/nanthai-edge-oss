import { render } from "@testing-library/react";
import type React from "react";
import { beforeEach, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { getFunctionName } from "convex/server";

type MockFn = ReturnType<typeof vi.fn>;

const mockState = vi.hoisted(() => ({
  page: "",
  queryData: {} as Record<string, unknown>,
  sharedData: {} as Record<string, unknown>,
  modelSummaries: undefined as unknown,
  visibleSkills: undefined as unknown,
  connectedAccounts: {} as Record<string, unknown>,
  mutation: vi.fn(async (): Promise<unknown> => null),
  action: vi.fn(async (): Promise<unknown> => ({ accessToken: "drive-token" })),
  mutationMocks: new Map<string, MockFn>(),
  actionMocks: new Map<string, MockFn>(),
  queryResults: new Map<string, unknown>(),
  strictEndpoints: false,
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

function endpointName(endpoint: unknown): string {
  try {
    return getFunctionName(endpoint as Parameters<typeof getFunctionName>[0]);
  } catch {
    return typeof endpoint === "string" ? endpoint : String(endpoint);
  }
}

function endpointMock(
  type: "mutation" | "action",
  endpoint: unknown,
  mocks: Map<string, MockFn>,
  fallback: MockFn,
) {
  const name = endpointName(endpoint);
  const mock = mocks.get(name);
  if (mock) return mock;
  if (mockState.strictEndpoints) throw new Error(`Unconfigured Convex ${type}: ${name}`);
  return fallback;
}

export function mockMutationEndpoint(name: string, implementation?: (...args: unknown[]) => unknown) {
  const mock = vi.fn(implementation ?? (async () => null));
  mockState.mutationMocks.set(name, mock);
  return mock;
}

export function mockActionEndpoint(name: string, implementation?: (...args: unknown[]) => unknown) {
  const mock = vi.fn(implementation ?? (async () => ({ accessToken: "drive-token" })));
  mockState.actionMocks.set(name, mock);
  return mock;
}

export function mockQueryEndpoint(name: string, value: unknown) {
  mockState.queryResults.set(name, value);
}

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "en" },
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
  useQuery: (query: unknown, args?: unknown) => {
    const name = endpointName(query);
    if (mockState.queryResults.has(name)) return mockState.queryResults.get(name);
    if (mockState.strictEndpoints) throw new Error(`Unconfigured Convex query: ${name}`);
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
  useMutation: (mutation: unknown) => endpointMock("mutation", mutation, mockState.mutationMocks, mockState.mutation),
  useAction: (action: unknown) => endpointMock("action", action, mockState.actionMocks, mockState.action),
}));

vi.mock("@/hooks/useSharedData", () => ({
  useSharedData: () => mockState.sharedData,
  useModelSummaries: () => mockState.modelSummaries,
  useVisibleSkills: () => mockState.visibleSkills,
  useConnectedAccounts: () => mockState.connectedAccounts,
}));

vi.mock("@/hooks/usePreferenceBuffer", () => ({
  usePreferenceBuffer: () => ({
    updatePreference: endpointMock(
      "mutation",
      "preferences/mutations:upsertPreferences",
      mockState.mutationMocks,
      mockState.mutation,
    ),
    updatePreferenceImmediate: endpointMock(
      "mutation",
      "preferences/mutations:upsertPreferences",
      mockState.mutationMocks,
      mockState.mutation,
    ),
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
  mockState.mutationMocks.clear();
  mockState.actionMocks.clear();
  mockState.queryResults.clear();
  mockState.strictEndpoints = false;
  mockState.navigate.mockReset();
  mockState.connectProviderWithPopup.mockReset();
  mockState.pickGoogleDriveFiles.mockReset();
  mockState.pickGoogleDriveFiles.mockResolvedValue([]);
  mockState.toast.mockReset();
});
