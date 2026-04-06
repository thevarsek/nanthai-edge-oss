// convex/models/guidance_matching.ts
// =============================================================================
// 5-phase family-based matching: links OpenRouter models to Artificial Analysis
// benchmark entries. Algorithm per temp/provider_matching.md.
//
// Phases:
//   1. Provider mapping (static crosswalk, hard gate)
//   2. OR normalization (raw slug, canonical slug, display name)
//   3. AA normalization + indexing (per-provider slug/name/family indexes)
//   4. Family extraction (family key, profile tokens, mode tokens)
//   5. Matching order (exact → canonical → display → family → variant resolution)
// =============================================================================

import { getManualOverride } from "./guidance_manual_overrides";

// -- Types --------------------------------------------------------------------

export type MatchStatus = "matched" | "unmatched" | "ambiguous";

export type MatchRule =
  | "manual"
  | "exact_slug"
  | "canonical_slug_minus_date"
  | "display_name_exact"
  | "family_plus_variant_resolution"
  | "canonical_family";

export type MatchConfidence = "high" | "medium";

export interface MatchResult {
  orId: string;
  aaSlug?: string;
  status: MatchStatus;
  confidence?: MatchConfidence;
  rule?: MatchRule;
  provider?: string;
  aaProvider?: string;
  familyKey?: string;
  orProfileHint?: string | null;
  aaProfile?: string | null;
  notes?: string[];
}

/** Legacy compatibility — used by applyBenchmarks to write guidanceMatch. */
export interface GuidanceMatchResult {
  source: "artificial_analysis";
  strategy: MatchRule;
  confidence: number;
  aaLlmSlug?: string;
  aaImageSlug?: string;
}

export interface AaLlmEntry {
  slug: string;
  name?: string;
  creatorSlug?: string;
}

export interface AaImageEntry {
  slug: string;
  name?: string;
}

/** OR model fields needed for matching. */
export interface OrModelInput {
  id: string;
  name: string;
  canonicalSlug?: string;
}

// -- Phase 1: Provider mapping ------------------------------------------------

const PROVIDER_MAP: Record<string, string> = {
  openai: "openai",
  anthropic: "anthropic",
  google: "google",
  qwen: "alibaba",
  "z-ai": "zai",
  "x-ai": "xai",
  deepseek: "deepseek",
  mistralai: "mistral",
  allenai: "ai2",
  liquid: "liquidai",
  moonshotai: "kimi",
  "meta-llama": "meta",
  "ibm-granite": "ibm",
  kwaipilot: "kwaikat",
  microsoft: "azure",
  cohere: "cohere",
  minimax: "minimax",
  perplexity: "perplexity",
  stepfun: "stepfun",
  baidu: "baidu",
  xiaomi: "xiaomi",
  inception: "inception",
  "prime-intellect": "prime-intellect",
};

export function resolveAaProvider(orProvider: string): string | undefined {
  return PROVIDER_MAP[orProvider];
}

// -- Phase 2: OR normalization ------------------------------------------------

/**
 * Normalize a string for cross-source comparison:
 *  1. lowercase
 *  2. Unicode normalize (NFC)
 *  3. replace & with "and"
 *  4. replace all non-alphanumeric runs with -
 *  5. collapse repeated -
 *  6. trim leading/trailing -
 */
export function normalize(s: string): string {
  let n = s.toLowerCase().normalize("NFC");
  n = n.replace(/&/g, "and");
  n = n.replace(/[^a-z0-9]+/g, "-");
  n = n.replace(/-+/g, "-");
  n = n.replace(/^-|-$/g, "");
  return n;
}

/** Extract provider and raw slug from OR id. */
export function extractOrParts(orId: string): {
  provider: string;
  rawSlug: string;
} {
  const slashIdx = orId.indexOf("/");
  const provider = slashIdx > 0 ? orId.substring(0, slashIdx) : "unknown";
  let rawSlug = slashIdx >= 0 ? orId.substring(slashIdx + 1) : orId;
  // Strip trailing :free, :thinking, :exacto, :extended, etc.
  const colonIdx = rawSlug.indexOf(":");
  if (colonIdx >= 0) rawSlug = rawSlug.substring(0, colonIdx);
  return { provider, rawSlug };
}

/** Extract second path segment from canonical_slug. */
export function extractCanonicalSlugPart(
  canonicalSlug: string | undefined,
): string | undefined {
  if (!canonicalSlug) return undefined;
  const slashIdx = canonicalSlug.indexOf("/");
  return slashIdx >= 0
    ? canonicalSlug.substring(slashIdx + 1)
    : canonicalSlug;
}

/**
 * Strip trailing date/build suffixes from a slug.
 * Patterns (end of string only):
 *  - -YYYYMMDD
 *  - -YYYY-MM-DD
 *  - -MM-DD (2-digit month, 2-digit day)
 *  - -YYMM
 */
export function stripDateSuffix(slug: string): string {
  // Order: most specific first
  return slug
    .replace(/-\d{4}-\d{2}-\d{2}$/, "")   // -YYYY-MM-DD
    .replace(/-\d{8}$/, "")                 // -YYYYMMDD
    .replace(/-\d{2}-\d{2}$/, "")           // -MM-DD (e.g. -07-09)
    .replace(/-\d{4}$/, "")                 // -YYMM (e.g. -2407)
    ;
}

/**
 * Clean a display name: remove "Provider: " prefix and trailing " (free)".
 */
export function cleanDisplayName(name: string, _orProvider: string): string {
  let n = name;
  // Remove "ProviderName: " prefix (case-insensitive first word before colon)
  const colonIdx = n.indexOf(":");
  if (colonIdx > 0 && colonIdx < 40) {
    n = n.substring(colonIdx + 1).trim();
  }
  // Remove trailing " (free)"
  n = n.replace(/\s*\(free\)\s*$/i, "");
  // Remove other parenthesized annotations
  n = n.replace(/\s*\([^)]*\)\s*/g, " ").trim();
  return n;
}

// -- Phase 3: AA normalization + indexing -------------------------------------

interface AaIndexEntry {
  slug: string;
  normalizedSlug: string;
  normalizedName: string;
  name?: string;
}

interface ProviderIndex {
  byNormalizedSlug: Map<string, AaIndexEntry[]>;
  byNormalizedName: Map<string, AaIndexEntry[]>;
  allEntries: AaIndexEntry[];
}

/**
 * Build per-provider indexes from AA LLM entries.
 */
export function buildAaIndex(
  entries: AaLlmEntry[],
): Map<string, ProviderIndex> {
  const index = new Map<string, ProviderIndex>();

  for (const entry of entries) {
    const provider = entry.creatorSlug ?? "unknown";
    if (!index.has(provider)) {
      index.set(provider, {
        byNormalizedSlug: new Map(),
        byNormalizedName: new Map(),
        allEntries: [],
      });
    }
    const pi = index.get(provider)!;

    const normalizedSlug = normalize(entry.slug);
    const normalizedName = entry.name ? normalize(entry.name) : normalizedSlug;
    const ie: AaIndexEntry = {
      slug: entry.slug,
      normalizedSlug,
      normalizedName,
      name: entry.name,
    };

    pi.allEntries.push(ie);

    // Index by normalized slug
    if (!pi.byNormalizedSlug.has(normalizedSlug)) {
      pi.byNormalizedSlug.set(normalizedSlug, []);
    }
    pi.byNormalizedSlug.get(normalizedSlug)!.push(ie);

    // Index by normalized name
    if (!pi.byNormalizedName.has(normalizedName)) {
      pi.byNormalizedName.set(normalizedName, []);
    }
    pi.byNormalizedName.get(normalizedName)!.push(ie);
  }

  return index;
}

// -- Phase 4: Family extraction tokens ----------------------------------------

const PROFILE_TOKENS = new Set([
  "low",
  "medium",
  "high",
  "xhigh",
  "minimal",
  "chatgpt",
  "low-effort",
]);

const MODE_TOKENS = new Set([
  "reasoning",
  "non-reasoning",
  "thinking",
  "adaptive",
]);

const IDENTITY_TOKENS = new Set([
  "mini",
  "nano",
  "flash",
  "lite",
  "turbo",
  "pro",
  "max",
  "vl",
  "vision",
  "coder",
  "codex",
  "air",
]);

/**
 * Extract mode tokens present in a normalized slug.
 * Returns the set of mode tokens found.
 */
function extractModeTokens(normalizedSlug: string): Set<string> {
  const found = new Set<string>();

  // Check compound tokens first
  for (const mode of MODE_TOKENS) {
    if (normalizedSlug.includes(mode)) {
      found.add(mode);
    }
  }
  return found;
}

/**
 * Check if an AA slug differs from a base only by trailing profile/mode/date tokens.
 * Returns true if they share the same family.
 */
function isSameFamily(
  baseNormalized: string,
  candidateNormalized: string,
): boolean {
  if (candidateNormalized === baseNormalized) return true;
  if (!candidateNormalized.startsWith(baseNormalized)) return false;

  // The suffix after the base must be only mode tokens, profile tokens, or date tokens
  const suffix = candidateNormalized.substring(baseNormalized.length);
  if (!suffix.startsWith("-")) return false;

  const suffixParts = suffix.substring(1).split("-");
  for (const part of suffixParts) {
    if (!part) continue;
    if (MODE_TOKENS.has(part)) continue;
    if (PROFILE_TOKENS.has(part)) continue;
    // Date-like tokens (all digits)
    if (/^\d+$/.test(part)) continue;
    // Compound tokens like "non-reasoning" already handled
    if (part === "non") continue;
    // "speciale" and similar — not a known token, candidate diverges
    // Check if it's an identity token (means different family)
    if (IDENTITY_TOKENS.has(part)) return false;
    // Unknown suffix — could be a variant like "speciale"
    // Be conservative: still consider same family, let variant resolution handle it
  }
  return true;
}


// -- Phase 5: Matching --------------------------------------------------------

/**
 * Variant resolution: given a set of same-family AA siblings, pick the best.
 */
function resolveVariant(
  orNormalizedRawSlug: string,
  orModes: Set<string>,
  orProfileHint: string | null,
  siblings: AaIndexEntry[],
): { chosen: AaIndexEntry | null; reason: string } {
  if (siblings.length === 0) {
    return { chosen: null, reason: "no siblings" };
  }
  if (siblings.length === 1) {
    return { chosen: siblings[0], reason: "single candidate" };
  }

  let candidates = [...siblings];

  // Step 1: If OR raw slug exactly matches one sibling, prefer it
  const exactRaw = candidates.find(
    (s) => s.normalizedSlug === orNormalizedRawSlug,
  );
  if (exactRaw) {
    return { chosen: exactRaw, reason: "exact raw match in family" };
  }

  // Step 2: Mode token filtering
  if (orModes.size > 0) {
    // OR explicitly mentions mode tokens — require AA candidate to have them
    const withModes = candidates.filter((s) => {
      const aaModes = extractModeTokens(s.normalizedSlug);
      for (const mode of orModes) {
        if (!aaModes.has(mode)) return false;
      }
      return true;
    });
    if (withModes.length > 0) {
      candidates = withModes;
    }
  } else {
    // OR has no explicit mode — prefer candidates WITHOUT extra mode tokens
    const withoutModes = candidates.filter((s) => {
      const aaModes = extractModeTokens(s.normalizedSlug);
      return aaModes.size === 0;
    });
    if (withoutModes.length > 0) {
      candidates = withoutModes;
    }
  }

  if (candidates.length === 1) {
    return { chosen: candidates[0], reason: "mode token resolution" };
  }

  // Step 3: Profile token tie-break
  if (orProfileHint && PROFILE_TOKENS.has(orProfileHint)) {
    const withProfile = candidates.filter((s) =>
      s.normalizedSlug.includes(orProfileHint!),
    );
    if (withProfile.length === 1) {
      return { chosen: withProfile[0], reason: "profile token match" };
    }
  }

  // When OR gives no profile, prefer least-specialized (base) candidate
  // Base = shortest slug (fewest suffix tokens)
  const withoutProfile = candidates.filter((s) => {
    const parts = s.normalizedSlug.split("-");
    return !parts.some((p) => PROFILE_TOKENS.has(p));
  });
  if (withoutProfile.length > 0) {
    candidates = withoutProfile;
  }

  if (candidates.length === 1) {
    return { chosen: candidates[0], reason: "profile preference (base)" };
  }

  // Step 4: Drop dated/build variants — prefer undated base
  const undated = candidates.filter((s) => {
    const slug = s.normalizedSlug;
    // Check if slug ends with numeric-only segments
    const parts = slug.split("-");
    const lastPart = parts[parts.length - 1];
    return !/^\d{3,8}$/.test(lastPart);
  });
  if (undated.length > 0 && undated.length < candidates.length) {
    candidates = undated;
  }

  if (candidates.length === 1) {
    return { chosen: candidates[0], reason: "undated variant preferred" };
  }

  // Step 5: Final tie-break — shortest slug (most generic)
  candidates.sort((a, b) => a.slug.length - b.slug.length);
  if (candidates.length >= 2 && candidates[0].slug.length < candidates[1].slug.length) {
    return { chosen: candidates[0], reason: "shortest slug tie-break" };
  }

  // Still ambiguous
  return { chosen: null, reason: "ambiguous after all filters" };
}

/**
 * Extract profile hint from an OR raw slug.
 * Returns the profile token if found at the end of the slug.
 */
function extractProfileHint(rawSlug: string): string | null {
  const normalized = normalize(rawSlug);
  const parts = normalized.split("-");
  const lastPart = parts[parts.length - 1];
  if (PROFILE_TOKENS.has(lastPart)) return lastPart;

  // Check compound: "low-effort"
  if (parts.length >= 2) {
    const lastTwo = parts.slice(-2).join("-");
    if (PROFILE_TOKENS.has(lastTwo)) return lastTwo;
  }
  return null;
}

/**
 * Extract mode tokens from OR model fields (id, canonical_slug, name).
 */
function extractOrModeTokens(or: OrModelInput): Set<string> {
  const combined = `${or.id} ${or.canonicalSlug ?? ""} ${or.name}`.toLowerCase();
  const modes = new Set<string>();
  for (const mode of MODE_TOKENS) {
    if (combined.includes(mode)) {
      modes.add(mode);
    }
  }
  return modes;
}

/**
 * Match a single OR model to an AA LLM entry using the 5-phase algorithm.
 *
 * Image matching is handled separately (simpler slug-only matching).
 */
export function matchModelLlm(
  or: OrModelInput,
  aaIndex: Map<string, ProviderIndex>,
): MatchResult {
  const { provider: orProvider, rawSlug } = extractOrParts(or.id);

  // Phase 1: Provider gate
  const aaProviderSlug = resolveAaProvider(orProvider);
  if (!aaProviderSlug) {
    return {
      orId: or.id,
      status: "unmatched",
      provider: orProvider,
      notes: ["provider not in crosswalk"],
    };
  }

  const providerIdx = aaIndex.get(aaProviderSlug);
  if (!providerIdx || providerIdx.allEntries.length === 0) {
    return {
      orId: or.id,
      status: "unmatched",
      provider: orProvider,
      aaProvider: aaProviderSlug,
      notes: ["no AA entries for this provider"],
    };
  }

  // Phase 2: Normalize OR fields
  const normalizedRawSlug = normalize(rawSlug);
  const canonicalPart = extractCanonicalSlugPart(or.canonicalSlug);
  const canonicalStripped = canonicalPart
    ? stripDateSuffix(canonicalPart)
    : undefined;
  const normalizedCanonical = canonicalStripped
    ? normalize(canonicalStripped)
    : undefined;
  const cleanedName = cleanDisplayName(or.name, orProvider);
  const normalizedDisplayName = normalize(cleanedName);

  // Extract hints
  const orModes = extractOrModeTokens(or);
  const orProfileHint = extractProfileHint(rawSlug);

  // Phase 5 Step 1: Exact normalized raw slug match
  const exactSlugCandidates = providerIdx.byNormalizedSlug.get(normalizedRawSlug);
  if (exactSlugCandidates && exactSlugCandidates.length === 1) {
    return {
      orId: or.id,
      aaSlug: exactSlugCandidates[0].slug,
      status: "matched",
      confidence: "high",
      rule: "exact_slug",
      provider: orProvider,
      aaProvider: aaProviderSlug,
      familyKey: normalizedRawSlug,
      orProfileHint,
    };
  }

  // Phase 5 Step 2: Canonical slug after date stripping
  if (normalizedCanonical && normalizedCanonical !== normalizedRawSlug) {
    const canonicalCandidates =
      providerIdx.byNormalizedSlug.get(normalizedCanonical);
    if (canonicalCandidates && canonicalCandidates.length === 1) {
      return {
        orId: or.id,
        aaSlug: canonicalCandidates[0].slug,
        status: "matched",
        confidence: "high",
        rule: "canonical_slug_minus_date",
        provider: orProvider,
        aaProvider: aaProviderSlug,
        familyKey: normalizedCanonical,
        orProfileHint,
      };
    }
  }

  // Phase 5 Step 3: Exact normalized display name match
  if (normalizedDisplayName !== normalizedRawSlug &&
      normalizedDisplayName !== normalizedCanonical) {
    const nameCandidates =
      providerIdx.byNormalizedName.get(normalizedDisplayName);
    if (nameCandidates && nameCandidates.length === 1) {
      return {
        orId: or.id,
        aaSlug: nameCandidates[0].slug,
        status: "matched",
        confidence: "high",
        rule: "display_name_exact",
        provider: orProvider,
        aaProvider: aaProviderSlug,
        familyKey: normalizedDisplayName,
        orProfileHint,
      };
    }
    // Also try matching display name against AA slugs (not just AA names)
    const nameAsSlugCandidates =
      providerIdx.byNormalizedSlug.get(normalizedDisplayName);
    if (nameAsSlugCandidates && nameAsSlugCandidates.length === 1) {
      return {
        orId: or.id,
        aaSlug: nameAsSlugCandidates[0].slug,
        status: "matched",
        confidence: "high",
        rule: "display_name_exact",
        provider: orProvider,
        aaProvider: aaProviderSlug,
        familyKey: normalizedDisplayName,
        orProfileHint,
      };
    }
  }

  // Phase 5 Step 4: Family-level candidate generation
  // Try each stem (raw slug, canonical, display name) as family key
  const stems = new Set<string>();
  stems.add(normalizedRawSlug);
  if (normalizedCanonical) stems.add(normalizedCanonical);
  if (normalizedDisplayName) stems.add(normalizedDisplayName);

  for (const stem of stems) {
    // Find AA entries where stem is a prefix, or AA entry is a prefix of stem
    const familySiblings = providerIdx.allEntries.filter((entry) => {
      return isSameFamily(stem, entry.normalizedSlug);
    });

    if (familySiblings.length === 0) continue;

    // Also try: AA slug (after stripping mode/profile) is a prefix match to stem
    const reverseSiblings = providerIdx.allEntries.filter((entry) => {
      // Strip mode and profile tokens from AA entry to get its core
      return isSameFamily(entry.normalizedSlug, stem);
    });

    // Merge and deduplicate
    const allSiblings = new Map<string, AaIndexEntry>();
    for (const s of [...familySiblings, ...reverseSiblings]) {
      allSiblings.set(s.slug, s);
    }
    const siblings = Array.from(allSiblings.values());

    if (siblings.length === 0) continue;

    // Run variant resolution
    const { chosen, reason } = resolveVariant(
      normalizedRawSlug,
      orModes,
      orProfileHint,
      siblings,
    );

    if (chosen) {
      return {
        orId: or.id,
        aaSlug: chosen.slug,
        status: "matched",
        confidence: "medium",
        rule: siblings.some((s) => s.normalizedSlug === normalizedDisplayName)
          ? "canonical_family"
          : "family_plus_variant_resolution",
        provider: orProvider,
        aaProvider: aaProviderSlug,
        familyKey: stem,
        orProfileHint,
        aaProfile: null,
        notes: [`variant resolution: ${reason}`],
      };
    }

    // Ambiguous
    if (siblings.length > 1) {
      return {
        orId: or.id,
        status: "ambiguous",
        provider: orProvider,
        aaProvider: aaProviderSlug,
        familyKey: stem,
        notes: [
          `${siblings.length} candidates: ${siblings.map((s) => s.slug).join(", ")}`,
          `resolution failed: ${reason}`,
        ],
      };
    }
  }

  // Unmatched
  return {
    orId: or.id,
    status: "unmatched",
    provider: orProvider,
    aaProvider: aaProviderSlug,
    notes: ["no slug, canonical, name, or family match found"],
  };
}

/**
 * Simple image model matching — slug-based only.
 */
export function matchModelImage(
  orId: string,
  aaImageEntries: AaImageEntry[],
): string | undefined {
  const { rawSlug } = extractOrParts(orId);
  const normalizedRaw = normalize(rawSlug);

  // Exact slug match
  const exact = aaImageEntries.find((e) => normalize(e.slug) === normalizedRaw);
  if (exact) return exact.slug;

  // Canonical slug match (strip date suffixes)
  const stripped = stripDateSuffix(normalizedRaw);
  if (stripped !== normalizedRaw) {
    const canonical = aaImageEntries.find(
      (e) => normalize(e.slug) === stripped,
    );
    if (canonical) return canonical.slug;
  }

  return undefined;
}

// -- Batch matching (used by applyBenchmarks) ---------------------------------

/**
 * Match an OR model against AA data. Returns legacy GuidanceMatchResult
 * for backward compatibility with applyBenchmarks.
 *
 * @param or - OR model fields
 * @param aaLlmEntries - All AA LLM entries
 * @param aaImageEntries - All AA image entries
 * @param aaLlmIndex - Pre-built per-provider AA LLM index (optional, built if not provided)
 */
export function matchModel(
  or: OrModelInput,
  aaLlmEntries: AaLlmEntry[],
  aaImageEntries: AaImageEntry[],
  aaLlmIndex?: Map<string, ProviderIndex>,
): GuidanceMatchResult | null {
  // Check manual override first
  const override = getManualOverride(or.id);
  if (override) {
    return {
      source: "artificial_analysis",
      strategy: "manual",
      confidence: 1.0,
      aaLlmSlug: override.aaLlmSlug,
      aaImageSlug: override.aaImageSlug,
    };
  }

  // Build index if not provided
  const index = aaLlmIndex ?? buildAaIndex(aaLlmEntries);

  // Try LLM match
  const llmResult = matchModelLlm(or, index);

  // Try image match
  const imageSlug = matchModelImage(or.id, aaImageEntries);

  if (llmResult.status === "matched" && llmResult.aaSlug) {
    const confidenceNum = llmResult.confidence === "high" ? 0.95 : 0.85;
    return {
      source: "artificial_analysis",
      strategy: llmResult.rule!,
      confidence: confidenceNum,
      aaLlmSlug: llmResult.aaSlug,
      aaImageSlug: imageSlug,
    };
  }

  if (imageSlug) {
    return {
      source: "artificial_analysis",
      strategy: "exact_slug",
      confidence: 0.90,
      aaImageSlug: imageSlug,
    };
  }

  return null;
}

/**
 * Build a slug index for quick lookups during batch matching.
 */
export function buildSlugIndex<T extends { slug: string }>(
  entries: T[],
): Map<string, T> {
  return new Map(entries.map((e) => [e.slug, e]));
}
