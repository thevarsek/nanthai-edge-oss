import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ContentPage } from "./ContentPage";
import { RelatedGuides } from "./RelatedGuides";
import { articles } from "./articleData";

vi.mock("@clerk/react", () => ({ useAuth: () => ({ isLoaded: true, isSignedIn: false }) }));
vi.mock("@/components/edge-site/EdgeSiteLayout", () => ({ EdgeSiteLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

function page(route: string) {
  return render(<MemoryRouter initialEntries={[route]}><Routes><Route path="/guides/:slug?" element={<ContentPage />} /><Route path="/research/:slug?" element={<ContentPage />} /></Routes></MemoryRouter>);
}

describe("public article pages", () => {
  it("groups the guide index by topic", () => {
    page("/guides");
    expect(screen.getByRole("heading", { level: 1, name: "Guides" })).toBeInTheDocument();
    for (const topic of new Set(articles.filter(article => article.collection === "guides").map(article => article.topic))) {
      expect(screen.getByRole("heading", { name: topic })).toBeInTheDocument();
    }
    expect(screen.getAllByRole("link", { name: /ChatGPT, Claude and Gemini/i }).length).toBeGreaterThan(0);
  });
  it("opens a guide through client-side index navigation", async () => {
    page("/guides");
    fireEvent.click(screen.getByRole("link", { name: /Use ChatGPT, Claude and Gemini in one app/i }));
    expect(await screen.findByRole("heading", { level: 1, name: "Use ChatGPT, Claude and Gemini in one app" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Table of contents" })).toBeInTheDocument();
  });
  it("renders a complete guide with working contents links and more guides", () => {
    const { container } = page("/guides/ai-chat-memory");
    const body = container.querySelector("article")!;
    expect(body.textContent!.split(/\s+/).length).toBeGreaterThan(600);
    const toc = screen.getByRole("navigation", { name: "Table of contents" });
    for (const link of within(toc).getAllByRole("link")) {
      expect(container.querySelector(link.getAttribute("href")!)).toBeInTheDocument();
    }
    expect(screen.getByRole("region", { name: "More guides" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download on the App Store" })).toBeInTheDocument();
  });
  it("renders all research diagrams as labelled figures and tables", () => {
    const { container } = page("/research/skills-as-tool-gates");
    expect(container.querySelectorAll("figure")).toHaveLength(5);
    expect(container.querySelectorAll("table")).toHaveLength(4);
    expect(container.querySelector("p figure")).toBeNull();
    expect(screen.getByText("~67,044 tokens")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "LinkedIn" })).toHaveAttribute("href", "https://www.linkedin.com/pulse/skills-tool-gates-better-way-scale-ai-agent-context-nanthai-pngwe/");
  });
  it("automatically links every guide related to a feature", () => {
    render(<MemoryRouter><RelatedGuides feature="byok" /></MemoryRouter>);
    const expected = articles.filter(article => article.collection === "guides" && article.related.includes("byok"));
    expect(screen.getAllByRole("link")).toHaveLength(expected.length);
  });
  it("handles an unknown article without displaying another article", () => {
    page("/guides/missing");
    expect(screen.getByRole("heading", { name: "Article not found" })).toBeInTheDocument();
  });
});
