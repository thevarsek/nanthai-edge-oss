import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { SkillEditorPage } from "./SkillEditorPage";

const mockState = vi.hoisted(() => ({
  params: {} as Record<string, string>,
  existingSkill: undefined as unknown,
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
  useQuery: (_query: unknown, args: unknown) => (args === "skip" ? undefined : mockState.existingSkill),
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
    fireEvent.click(screen.getByText("Uses Coding Workspace"));
    fireEvent.click(screen.getByText("Google Drive"));
    fireEvent.click(screen.getByText("Slack"));
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
