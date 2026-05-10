export function buildResearchPlanningPrompt(userQuery: string, breadth: number): string {
  return [
    "You are an academic research strategist for an autonomous Research Paper pipeline.",
    `Infer a rigorous research brief and generate exactly ${breadth} diverse, specific search queries.`,
    "Do not make unsupported factual claims yet; this phase defines the research strategy only.",
    "",
    "Return only JSON with this shape:",
    JSON.stringify({
      paperType: "imrad | literature_review | theoretical | case_study | policy_brief | conference | unknown",
      discipline: "inferred field or null",
      audience: "intended reader",
      citationStyle: "apa7 | chicago | mla | ieee | vancouver | markdown_links",
      researchQuestion: "answerable research question",
      scope: {
        inScope: ["boundary"],
        outOfScope: ["boundary"],
        assumptions: ["assumption"],
      },
      keyConcepts: [{ concept: "concept", synonyms: ["synonym"] }],
      inclusionCriteria: ["criterion"],
      exclusionCriteria: ["criterion"],
      plan: "brief staged research plan",
      queries: [{ query: "search query", rationale: "why this query matters", targetConcepts: ["concept"] }],
    }),
    "",
    "Planning requirements:",
    "- infer paper type, discipline, audience, and citation intent from the user prompt",
    "- formulate one answerable research question plus scope boundaries",
    "- identify key concepts, synonyms, inclusion criteria, and exclusion criteria",
    "- prefer primary, peer-reviewed, official, or high-quality sources where available",
    "- each query must include a rationale and target concepts",
    "",
    `Topic: ${userQuery}`,
  ].join("\n");
}

export function buildResearchAnalysisPrompt(priorResults: string, breadth: number): string {
  return [
    "You are an academic gap analyst and source-verification assistant.",
    `Generate exactly ${breadth} follow-up search queries targeted to evidence gaps, contradictions, methods, or missing contexts.`,
    "Do not repeat earlier queries unless the rationale explains why repetition is needed.",
    "",
    "Return only JSON with this shape:",
    JSON.stringify({
      coverageSummary: "what the current results cover",
      evidenceGaps: ["missing evidence category"],
      contradictionGaps: ["possible disagreement or counter-evidence to search"],
      methodologyGaps: ["missing method or evidence design"],
      populationOrContextGaps: ["missing population, geography, industry, or timeframe"],
      followUpQueries: [{ query: "search query", rationale: "why this fills a gap", gapAddressed: "gap name" }],
    }),
    "",
    "Analysis requirements:",
    "- explicitly look for counter-evidence, disagreements, and weak evidence categories",
    "- target follow-up queries to gaps rather than general background",
    "- preserve citation URLs from the current results when discussing gaps",
    "- avoid claiming any URL, DOI, or peer-review status was independently verified",
    "",
    "Current research results:",
    priorResults,
  ].join("\n");
}

export function buildResearchSynthesisPrompt(allResults: string): string {
  return [
    "You are an academic literature synthesizer. Build a structured source-grounded synthesis from all results.",
    "Classify source quality cautiously: use phrases like 'appears to be' and 'limited metadata available' when uncertain.",
    "",
    "Return only JSON with this shape:",
    JSON.stringify({
      findings: "structured synthesis of supported findings",
      sourceNotes: [{
        titleOrUrl: "title or URL",
        url: "https://example.com",
        evidenceType: "peer_reviewed | preprint | report | news_or_web | unknown",
        relevance: "high | medium | low",
        confidence: "high | medium | low",
        limitations: ["limitation"],
        usefulForSections: ["section"],
      }],
      literatureMatrix: [{
        source: "source title or URL",
        themes: ["theme"],
        methodOrEvidence: "method or evidence type",
        keyFinding: "source-backed finding",
        qualityNote: "source quality note",
      }],
      claimBank: [{
        claim: "draftable claim",
        supportingSources: ["source URL or title"],
        confidence: "high | medium | low",
        caveat: "hedge or limitation",
      }],
      contradictions: [{ issue: "topic", sideA: "view", sideB: "view", interpretation: "how to handle" }],
      limitations: ["overall limitation"],
      researchGaps: ["remaining gap"],
    }),
    "",
    "Synthesis requirements:",
    "- preserve source URLs in every source-backed artifact",
    "- distinguish supported findings from weak, mixed, or contested findings",
    "- include source notes, a Source x Theme literature matrix, claim bank, contradictions, and limitations",
    "- never present preserved URLs as formally verified citations unless a real verifier result is present",
    "",
    "All research results:",
    allResults,
  ].join("\n");
}

export function buildPaperArchitecturePrompt(input: string, complexity: number): string {
  return [
    "You are an academic structure architect and argument builder.",
    "Create an internal paper architecture artifact from the planning and synthesis context.",
    "",
    "Return only JSON with this shape:",
    JSON.stringify({
      title: "working academic title",
      structurePattern: "chosen structure and why",
      thesis: "central thesis or answer",
      outline: [{
        heading: "section heading",
        purpose: "section purpose",
        targetWords: 500,
        keyClaims: ["claim"],
        sourceRefs: ["source URL or title"],
        transitionToNext: "transition",
      }],
      evidenceMap: [{ section: "section", sources: ["source"], evidenceRole: "how evidence is used" }],
      argumentBlueprint: [{
        claim: "claim",
        evidence: ["source-backed evidence"],
        reasoning: "claim-evidence-reasoning chain",
        counterargument: "strongest counterargument",
        rebuttal: "rebuttal strategy",
        strength: "strong | moderate | weak",
      }],
      draftingNotes: ["citation, hedging, limitation, or transition instruction"],
    }),
    "",
    "Architecture requirements:",
    "- choose a structure that fits the inferred paper type",
    "- map section purposes, transitions, evidence, and source refs",
    "- include claim-evidence-reasoning chains plus counterarguments and rebuttals",
    "- mark weak claims so drafting can hedge them",
    complexity >= 3
      ? "- include self-review and revision guidance for a comprehensive final draft"
      : "- keep drafting guidance proportional to the selected complexity",
    "",
    "Planning and synthesis context:",
    input,
  ].join("\n");
}

export function buildPaperGenerationSystemPrompt(
  synthesisData: string,
  options: { planningData?: string; architectureData?: string; complexity?: number } = {},
): string {
  const complexity = Math.max(1, Math.min(3, Math.round(options.complexity ?? 2)));
  const complexityGuidance = complexity === 1
    ? "Quick: write a concise paper with compact sections and only the strongest supported claims."
    : complexity === 2
      ? "Thorough: write a full structured paper with explicit source limitations, contradictions, and evidence mapping."
      : "Comprehensive: before finalizing, internally self-review for unsupported claims, missing limitations, citation discipline, and argument gaps; expose only the revised final paper.";

  return [
    "You are a research paper writer. Use the artifacts below to write one final academic-quality paper.",
    "",
    "Drafting rules:",
    "- write section by section from the architecture artifact when present",
    "- include an executive summary, clear section headers, limitations, and a conclusion",
    "- integrate citations naturally as clickable markdown links near supported claims",
    "- prefer references already present in the search context and artifacts",
    "- do not fabricate sources, orphan references, bibliography entries, DOIs, or verification claims",
    "- hedge low-confidence claims and disclose contradictions where relevant",
    "- include a concise research basis or source limitations section when source quality is mixed",
    `- ${complexityGuidance}`,
    "",
    "Citation honesty:",
    "- citation URLs are preserved from search results unless a verifier result explicitly says otherwise",
    "- use 'source quality note' or 'appears to be' for uncertain source types",
    "- do not say Semantic Scholar verified, DOI verified, peer-review confirmed, retraction checked, or predatory-journal screened",
    "",
    options.planningData ? `Planning artifact:\n${options.planningData}\n` : "",
    `Synthesis artifact:\n${synthesisData}`,
    options.architectureData ? `\nPaper architecture artifact:\n${options.architectureData}` : "",
  ].filter(Boolean).join("\n");
}
