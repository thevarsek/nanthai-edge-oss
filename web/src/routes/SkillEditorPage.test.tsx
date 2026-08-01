import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { SkillEditorPage } from "./SkillEditorPage";

const mockState = vi.hoisted(() => ({
  params: {} as Record<string, string>,
  existingSkill: undefined as unknown,
  remoteMcpConnections: [] as Array<{
    connectionId: string;
    integrationId: string;
    displayName: string;
    endpointHost: string;
    allowedItemCount: number;
  }>,
  createSkill: vi.fn(async () => ({ validationWarnings: [] as string[] })),
  updateSkill: vi.fn(async () => ({ validationWarnings: [] as string[] })),
  mutationIndex: 0,
  navigate: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useParams: () => mockState.params,
    useNavigate: () => mockState.navigate,
  };
});

vi.mock("convex/react", () => ({
  useQuery: (_query: unknown, args: unknown) => {
    if (args === "skip") return undefined;
    if (args && typeof args === "object" && "skillId" in args) return mockState.existingSkill;
    return mockState.remoteMcpConnections;
  },
  useMutation: () => {
    const next = mockState.mutationIndex % 2;
    mockState.mutationIndex += 1;
    return next === 0 ? mockState.createSkill : mockState.updateSkill;
  },
}));

vi.mock("@/hooks/useProGate", () => ({
  ProGateWrapper: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/shared/Toast.context", () => ({
  useToast: () => ({ toast: mockState.toast }),
}));

function renderEditor() {
  return render(
    <MemoryRouter initialEntries={["/app/settings/skills/new"]}>
      <SkillEditorPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockState.params = {};
  mockState.existingSkill = undefined;
  mockState.remoteMcpConnections = [];
  mockState.mutationIndex = 0;
  mockState.createSkill.mockReset();
  mockState.createSkill.mockResolvedValue({ validationWarnings: [] });
  mockState.updateSkill.mockReset();
  mockState.updateSkill.mockResolvedValue({ validationWarnings: [] });
  mockState.navigate.mockReset();
  mockState.toast.mockReset();
});

describe("SkillEditorPage", () => {
  it("validates required fields before calling Convex", () => {
    renderEditor();

    fireEvent.click(screen.getByText("save"));

    expect(screen.getByText("skill_name_required")).toBeInTheDocument();
    expect(mockState.createSkill).not.toHaveBeenCalled();
  });

  it("creates skills with inferred metadata and shows validation warnings", async () => {
    mockState.createSkill.mockResolvedValue({ validationWarnings: ["Needs Gmail connection"] });
    renderEditor();

    fireEvent.change(screen.getByPlaceholderText("skill_name_placeholder"), { target: { value: "Research Pack" } });
    fireEvent.change(screen.getByPlaceholderText("skill_summary_placeholder"), { target: { value: "Analyze CSV from Gmail" } });
    fireEvent.change(screen.getByPlaceholderText("skill_instructions_placeholder"), {
      target: { value: "Use pandas on the spreadsheet and create a DOCX summary." },
    });
    fireEvent.click(screen.getByText("save"));

    await waitFor(() => {
      expect(mockState.createSkill).toHaveBeenCalledWith(expect.objectContaining({
        name: "Research Pack",
        summary: "Analyze CSV from Gmail",
        instructionsRaw: "Use pandas on the spreadsheet and create a DOCX summary.",
        runtimeMode: "toolAugmented",
        requiredToolProfiles: ["analytics", "docs", "google"],
        requiredCapabilities: [],
        requiredIntegrationIds: ["gmail"],
      }));
    });
    expect(mockState.toast).toHaveBeenCalledWith({ message: "Needs Gmail connection", variant: "default" });
    expect(mockState.navigate).toHaveBeenCalledWith("/app/settings/skills");
  });

  it("hydrates existing skills and updates explicit metadata selections", async () => {
    mockState.params = { skillId: "skill_1" };
    mockState.existingSkill = {
      _id: "skill_1",
      name: "Existing Skill",
      summary: "Existing summary",
      instructionsRaw: "Existing instructions",
      runtimeMode: "textOnly",
      requiredToolProfiles: ["docs"],
      requiredIntegrationIds: ["drive"],
      requiredCapabilities: ["future_capability"],
    };
    renderEditor();

    expect(screen.getByDisplayValue("Existing Skill")).toBeInTheDocument();
    fireEvent.click(screen.getByText("skill_runtime_workspace_label"));
    fireEvent.click(screen.getByRole("switch", { name: "skill_uses_coding_workspace" }));
    fireEvent.click(screen.getByRole("switch", { name: "Google Drive" }));
    fireEvent.click(screen.getByRole("switch", { name: "Slack" }));
    fireEvent.click(screen.getByText("save"));

    await waitFor(() => {
      expect(mockState.updateSkill).toHaveBeenCalledWith(expect.objectContaining({
        skillId: "skill_1",
        name: "Existing Skill",
        runtimeMode: "sandboxAugmented",
        requiredToolProfiles: ["docs", "slack", "workspace"],
        requiredCapabilities: ["future_capability"],
        requiredIntegrationIds: ["slack"],
      }));
    });
    expect(mockState.navigate).toHaveBeenCalledWith("/app/settings/skills");
  });

  it("adds an active Remote MCP server as a skill integration target", async () => {
    mockState.remoteMcpConnections = [{
      connectionId: "connection-1",
      integrationId: "mcp:connection-1",
      displayName: "Cloudflare Docs",
      endpointHost: "docs.mcp.cloudflare.com",
      allowedItemCount: 2,
    }];
    renderEditor();

    fireEvent.change(screen.getByPlaceholderText("skill_name_placeholder"), { target: { value: "Cloudflare Research" } });
    fireEvent.change(screen.getByPlaceholderText("skill_instructions_placeholder"), {
      target: { value: "Use the connected Cloudflare Remote MCP tools to find relevant documentation." },
    });
    fireEvent.click(screen.getByRole("switch", { name: "Cloudflare Docs" }));
    fireEvent.click(screen.getByText("save"));

    await waitFor(() => {
      expect(mockState.createSkill).toHaveBeenCalledWith(expect.objectContaining({
        requiredIntegrationIds: ["mcp:connection-1"],
      }));
    });
  });

  it("presents skill routing as end-user switches without internal metadata", () => {
    renderEditor();

    expect(screen.getByRole("switch", { name: "skill_uses_documents" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Google Drive" })).toBeInTheDocument();
    expect(screen.queryByText("Metadata preview")).not.toBeInTheDocument();
    expect(screen.queryByText(/backend revalidates/i)).not.toBeInTheDocument();
  });

  it("renders a not-found state instead of a blank edit form when the skill lookup returns null", () => {
    mockState.params = { skillId: "missing_skill" };
    mockState.existingSkill = null;

    renderEditor();

    expect(screen.getByText("skill_not_found")).toBeInTheDocument();
    expect(screen.queryByText("save")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("skill_name_placeholder")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("back_to_skills"));
    expect(mockState.navigate).toHaveBeenCalledWith("/app/settings/skills");
    expect(mockState.updateSkill).not.toHaveBeenCalled();
  });

  it("preserves unrepresented required tool profiles when editing a skill", async () => {
    mockState.params = { skillId: "skill_1" };
    mockState.existingSkill = {
      _id: "skill_1",
      name: "Existing Skill",
      summary: "Existing summary",
      instructionsRaw: "Existing instructions",
      runtimeMode: "toolAugmented",
      requiredToolProfiles: ["docs", "subagents", "scheduledJobs"],
      requiredIntegrationIds: [],
      requiredCapabilities: [],
    };
    renderEditor();

    fireEvent.change(screen.getByPlaceholderText("skill_summary_placeholder"), { target: { value: "Updated summary" } });
    fireEvent.click(screen.getByText("save"));

    await waitFor(() => {
      expect(mockState.updateSkill).toHaveBeenCalledWith(expect.objectContaining({
        skillId: "skill_1",
        summary: "Updated summary",
        requiredToolProfiles: ["docs", "scheduledJobs", "subagents"],
      }));
    });
  });
});
