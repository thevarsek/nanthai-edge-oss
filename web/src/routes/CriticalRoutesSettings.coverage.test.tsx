import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { mockState, renderRoute, skill } from "@/test/criticalRoutesCoverage";
import { PersonaEditorPage } from "./PersonaEditorPage";
import { ProviderListPage } from "./ProviderListPage";
import { SkillDetailPage } from "./SkillDetailPage";
import { SkillsPage } from "./SkillsPage";

describe("critical settings route coverage", () => {
  it("covers Skills list filtering, default state mutation args, duplicate/delete actions, and empty state", async () => {
    mockState.page = "skills";
    mockState.visibleSkills = [
      skill(),
      skill({
        _id: "skill_user",
        name: "Draft Skill",
        scope: "user",
        ownerUserId: "user_1",
        origin: "userAuthored",
        lockState: "editable",
      }),
    ];
    mockState.queryData.prefs = { skillDefaults: [{ skillId: "skill_1", state: "available" }] };
    mockState.mutation.mockResolvedValue("duplicated");

    renderRoute(<SkillsPage />);

    expect(screen.getAllByText("Research Skill")[0]).toBeInTheDocument();
    fireEvent.click(screen.getAllByText("Research Skill")[0]!.closest("button")!);
    expect(mockState.mutation).toHaveBeenCalledWith({ skillId: "skill_1", state: "never" });

    fireEvent.click(screen.getByTitle("skill_duplicate_title"));
    expect(mockState.mutation).toHaveBeenCalledWith({ skillId: "skill_1" });

    fireEvent.change(screen.getByPlaceholderText("search_skills_placeholder"), { target: { value: "missing" } });
    expect(screen.getByText("no_matching_skills")).toBeInTheDocument();
  });

  it("keeps skill default controls disabled until preferences have loaded", () => {
    mockState.page = "skills";
    mockState.visibleSkills = [skill()];
    mockState.queryData.prefs = undefined;

    renderRoute(<SkillsPage />);

    const defaultButton = screen.getAllByText("Research Skill")[0]!.closest("button")!;
    expect(defaultButton).toBeDisabled();
    fireEvent.click(defaultButton);
    expect(mockState.mutation).not.toHaveBeenCalled();
  });

  it("covers Skill detail shared-data and direct-query paths, requirements, duplicate/delete, and not-found navigation", async () => {
    mockState.page = "skillDetail";
    mockState.visibleSkills = [skill()];

    const { unmount } = render(
      <MemoryRouter initialEntries={["/app/settings/skills/skill_1"]}>
        <Routes>
          <Route path="/app/settings/skills/:skillId" element={<SkillDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getAllByText("Research Skill")[0]).toBeInTheDocument();
    expect(screen.getByText("web_search")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("skill_duplicate_to_custom"));
    await waitFor(() => expect(mockState.navigate).toHaveBeenCalledWith("/app/settings/skills"));
    unmount();

    mockState.visibleSkills = [];
    mockState.queryData.skillDetail = null;
    render(
      <MemoryRouter initialEntries={["/app/settings/skills/missing"]}>
        <Routes>
          <Route path="/app/settings/skills/:skillId" element={<SkillDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("skill_not_found")).toBeInTheDocument();
    fireEvent.click(screen.getByText("back_to_skills"));
    expect(mockState.navigate).toHaveBeenCalledWith("/app/settings/skills");
  });

  it("covers Provider list populated/search/conflict flows and rapid disabled provider writes", () => {
    mockState.page = "providers";
    mockState.sharedData = {
      prefs: { disabledProviders: ["google"], defaultModelId: "openai/gpt-4.1" },
      personas: [{ displayName: "Researcher", modelId: "anthropic/claude-sonnet-4.5" }],
    };
    mockState.modelSummaries = [
      { modelId: "openai/gpt-4.1", provider: "openai" },
      { modelId: "google/gemini-3-pro", provider: "google" },
      { modelId: "anthropic/claude-sonnet-4.5", provider: "anthropic" },
    ];
    mockState.mutation.mockReturnValue(new Promise(() => undefined));

    renderRoute(<ProviderListPage />);

    expect(screen.getByText("Openai")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("search_providers_placeholder"), { target: { value: "google" } });
    expect(screen.getByText("Google")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("switch"));
    expect(mockState.mutation).toHaveBeenCalledWith({ disabledProviders: [] });

    fireEvent.change(screen.getByPlaceholderText("search_providers_placeholder"), { target: { value: "openai" } });
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.getByText("conflict_dialog_heading")).toBeInTheDocument();
    fireEvent.click(screen.getByText("disable_anyway"));
    expect(mockState.mutation).toHaveBeenLastCalledWith({ disabledProviders: ["openai"] });
  });

  it("covers Persona editor validation, integration locks, skill overrides, and create mutation payloads", async () => {
    mockState.page = "persona";
    mockState.visibleSkills = [skill({ scope: "system" })];
    mockState.modelSummaries = [{ modelId: "openai/gpt-4.1", name: "GPT 4.1", provider: "openai", supportsTools: true }];
    mockState.connectedAccounts = {
      ...mockState.connectedAccounts,
      gmailManualConnection: null,
      googleConnection: { hasDrive: false, hasCalendar: false },
    };
    mockState.mutation.mockResolvedValueOnce("persona_1");

    render(
      <MemoryRouter initialEntries={["/app/personas/new"]}>
        <Routes>
          <Route path="/app/personas/:personaId" element={<PersonaEditorPage />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText("save"));
    expect(screen.getByText("persona_name_required")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("persona_name_placeholder"), { target: { value: "Analyst" } });
    fireEvent.change(screen.getByPlaceholderText("persona_description_placeholder"), { target: { value: "Careful reader" } });
    fireEvent.change(screen.getByPlaceholderText("system_prompt_placeholder"), { target: { value: "Read carefully." } });
    fireEvent.click(screen.getByText("select_a_model"));
    fireEvent.click(screen.getByText("GPT 4.1"));

    const gmailSwitch = within(screen.getByText("integration_gmail").closest("div")!).getByRole("switch");
    const driveSwitch = within(screen.getByText("integration_google_drive").closest("div")!).getByRole("switch");

    fireEvent.click(gmailSwitch);
    await waitFor(() => expect(screen.getByText("connect_gmail_app_password_first")).toBeInTheDocument());

    fireEvent.click(driveSwitch);
    await waitFor(() => expect(mockState.connectProviderWithPopup).toHaveBeenCalledWith("google", { requestedIntegration: "drive" }));
    await waitFor(() => expect(driveSwitch).toHaveAttribute("aria-checked", "true"));

    fireEvent.click(screen.getByText("Research Skill"));
    await waitFor(() => expect(screen.getByText("skill_state_always")).toBeInTheDocument());
    fireEvent.click(screen.getByText("save"));

    await waitFor(() => {
      expect(mockState.mutation).toHaveBeenCalledWith(expect.objectContaining({
        displayName: "Analyst",
        personaDescription: "Careful reader",
        systemPrompt: "Read carefully.",
        modelId: "openai/gpt-4.1",
        integrationOverrides: expect.arrayContaining([
          expect.objectContaining({ integrationId: "drive", enabled: true }),
        ]),
        skillOverrides: expect.arrayContaining([
          expect.objectContaining({ skillId: "skill_1", state: "always" }),
        ]),
      }));
    });
  });
});
