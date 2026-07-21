import { render, screen } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AudioGenerationPage } from "./features/AudioGenerationPage";
import { AnalysisCodePage } from "./features/AnalysisCodePage";
import { AutomatedTasksPage } from "./features/AutomatedTasksPage";
import { BYOKPage } from "./features/BYOKPage";
import { BranchingPage } from "./features/BranchingPage";
import { ChatDefaultsPage } from "./features/ChatDefaultsPage";
import { DocumentWorkflowsPage } from "./features/DocumentWorkflowsPage";
import { FeaturesIndexPage } from "./features/FeaturesIndexPage";
import { FoldersPage } from "./features/FoldersPage";
import { IdeascapesPage } from "./features/IdeascapesPage";
import { ImageGenerationPage } from "./features/ImageGenerationPage";
import { IntegrationsPage } from "./features/IntegrationsPage";
import { KnowledgeBasePage } from "./features/KnowledgeBasePage";
import { MemoriesPage } from "./features/MemoriesPage";
import { MultiModelChatPage } from "./features/MultiModelChatPage";
import { ParticipantOptionsPage } from "./features/ParticipantOptionsPage";
import { PersonasPage } from "./features/PersonasPage";
import { PriceTransparencyPage } from "./features/PriceTransparencyPage";
import { ProVsFreePage } from "./features/ProVsFreePage";
import { SearchPage } from "./features/SearchPage";
import { SkillsHelpersPage } from "./features/SkillsHelpersPage";
import { ThemesPage } from "./features/ThemesPage";
import { VideoGenerationPage } from "./features/VideoGenerationPage";
import { getFeature } from "./features/featureData";

let authState = { isLoaded: true, isSignedIn: false };

vi.mock("@clerk/react", () => ({
  useAuth: () => authState,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (typeof options?.defaultValue === "string") return options.defaultValue;
      return key;
    },
    i18n: {
      language: "en",
      resolvedLanguage: "en",
      changeLanguage: vi.fn(),
    },
  }),
}));

class TestIntersectionObserver {
  private callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }

  observe(element: Element) {
    this.callback([{ isIntersecting: true, target: element } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }

  disconnect() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
}

beforeEach(() => {
  authState = { isLoaded: true, isSignedIn: false };
  document.head.innerHTML = "";
  vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
});

function renderPublicPage(page: React.ReactNode) {
  return render(
    <HelmetProvider>
      <MemoryRouter>{page}</MemoryRouter>
    </HelmetProvider>,
  );
}

function canonicalHref() {
  return document.querySelector('link[rel="canonical"]')?.getAttribute("href");
}

function featureLink(href: string) {
  const link = screen.getAllByRole("link").find((element) => element.getAttribute("href") === href);
  expect(link).toBeDefined();
  return link!;
}

const featurePages = [
  { slug: "analysis-code", Page: AnalysisCodePage },
  { slug: "audio-generation", Page: AudioGenerationPage },
  { slug: "automated-tasks", Page: AutomatedTasksPage },
  { slug: "byok", Page: BYOKPage },
  { slug: "branching", Page: BranchingPage },
  { slug: "chat-defaults", Page: ChatDefaultsPage },
  { slug: "documents", Page: DocumentWorkflowsPage },
  { slug: "folders", Page: FoldersPage },
  { slug: "ideascapes", Page: IdeascapesPage },
  { slug: "image-generation", Page: ImageGenerationPage },
  { slug: "integrations", Page: IntegrationsPage },
  { slug: "knowledge-base", Page: KnowledgeBasePage },
  { slug: "memories", Page: MemoriesPage },
  { slug: "multi-model-chat", Page: MultiModelChatPage },
  { slug: "participant-options", Page: ParticipantOptionsPage },
  { slug: "personas", Page: PersonasPage },
  { slug: "price-transparency", Page: PriceTransparencyPage },
  { slug: "pro-vs-free", Page: ProVsFreePage },
  { slug: "search", Page: SearchPage },
  { slug: "skills-helpers", Page: SkillsHelpersPage },
  { slug: "themes", Page: ThemesPage },
  { slug: "video-generation", Page: VideoGenerationPage },
] as const;

describe("public feature pages", () => {
  it("renders the feature index with links to shipped feature routes", () => {
    renderPublicPage(<FeaturesIndexPage />);

    expect(screen.getByRole("heading", { name: "fi_hero_title" })).toBeInTheDocument();
    expect(featureLink("/features/multi-model-chat")).toHaveTextContent("Multi-Model Chat");
    expect(featureLink("/features/documents")).toHaveTextContent(
      "Documents, spreadsheets & presentations",
    );
    expect(featureLink("/features/skills-helpers")).toHaveTextContent(
      "AI Skills & focused helpers",
    );
    expect(featureLink("/features/analysis-code")).toHaveTextContent(
      "Analysis, code & charts",
    );
    expect(featureLink("/features/video-generation")).toHaveTextContent("Video Generation");
    expect(canonicalHref()).toBe("https://nanthai.tech/features");
  });

  it.each(featurePages)("renders the $slug feature page with SEO and CTAs", ({ slug, Page }) => {
    const meta = getFeature(slug)!;

    renderPublicPage(<Page />);

    expect(screen.getByRole("heading", { name: meta.title })).toBeInTheDocument();
    expect(screen.getAllByRole("link").some((link) => link.getAttribute("href") === "/sign-in")).toBe(
      true,
    );
    expect(screen.getByRole("link", { name: /edge_see_all_features/i })).toHaveAttribute(
      "href",
      "/features",
    );
    expect(canonicalHref()).toBe(`https://nanthai.tech/features/${slug}`);
  });
});
