export interface PresentationCandidateForCuration {
  slideId: string;
  title: string;
  notes?: string;
  html: string;
}

export interface PresentationCuratorTaskSpec {
  taskKey: string;
  kind: "recompose" | "consolidate";
  slideIds: string[];
}

const STOP_WORDS = new Set([
  "and", "are", "but", "for", "from", "has", "have", "into", "not", "that",
  "the", "their", "then", "this", "was", "were", "with", "you", "your",
]);

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, digits: string) => {
      const codePoint = Number.parseInt(digits, 10);
      return codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : " ";
    });
}

export function presentationVisibleText(candidate: PresentationCandidateForCuration): string {
  const htmlText = candidate.html.replace(/<[^>]+>/g, " ");
  return decodeEntities(`${candidate.title} ${candidate.notes ?? ""} ${htmlText}`)
    .replace(/\s+/g, " ")
    .trim();
}

export function presentationContentTokens(
  candidate: PresentationCandidateForCuration,
): Set<string> {
  const tokens = presentationVisibleText(candidate)
    .toLowerCase()
    .match(/[\p{L}\p{N}][\p{L}\p{N}._%+/-]*/gu) ?? [];
  return new Set(tokens.filter((token) =>
    (/\d/.test(token) || token.length >= 3) && !STOP_WORDS.has(token)
  ));
}

function presentationRetentionTokens(
  candidate: PresentationCandidateForCuration,
): Set<string> {
  const tokens = presentationVisibleText(candidate)
    .toLowerCase()
    .match(/[\p{L}\p{N}\p{Sc}\p{Sm}][\p{L}\p{N}\p{Sc}\p{Sm}._%+/-]*/gu) ?? [];
  return new Set(tokens);
}

function contentSimilarity(
  left: PresentationCandidateForCuration,
  right: PresentationCandidateForCuration,
): number {
  const a = presentationContentTokens(left);
  const b = presentationContentTokens(right);
  if (Math.min(a.size, b.size) < 6) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / Math.max(a.size, b.size);
}

export function presentationCompositionFingerprint(html: string): string {
  return html
    .toLowerCase()
    .replace(/data-element-id=("[^"]*"|'[^']*')/g, "data-element-id=\"#\"")
    .replace(/asset:[a-z0-9_-]+/g, "asset:#")
    .replace(/>[^<]+</g, "><")
    .replace(/\s+/g, " ")
    .trim();
}

function duplicateContentGroups(
  candidates: readonly PresentationCandidateForCuration[],
): string[][] {
  const parent = candidates.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root] ?? root;
    while (parent[index] !== index) {
      const next = parent[index] ?? index;
      parent[index] = root;
      index = next;
    }
    return root;
  };
  const union = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };
  for (let left = 0; left < candidates.length; left += 1) {
    for (let right = left + 1; right < candidates.length; right += 1) {
      const leftCandidate = candidates[left];
      const rightCandidate = candidates[right];
      if (leftCandidate && rightCandidate && contentSimilarity(leftCandidate, rightCandidate) >= 0.92) {
        union(left, right);
      }
    }
  }
  const groups = new Map<number, string[]>();
  candidates.forEach((candidate, index) => {
    const root = find(index);
    groups.set(root, [...(groups.get(root) ?? []), candidate.slideId]);
  });
  return [...groups.values()].filter((group) => group.length > 1);
}

export function analyzePresentationCandidates(
  candidates: readonly PresentationCandidateForCuration[],
): PresentationCuratorTaskSpec[] {
  const contentGroups = duplicateContentGroups(candidates);
  const contentOwned = new Set(contentGroups.flat());
  const tasks: PresentationCuratorTaskSpec[] = contentGroups.map((slideIds, index) => ({
    taskKey: `consolidate-${index + 1}`,
    kind: "consolidate",
    slideIds,
  }));
  const byFingerprint = new Map<string, string[]>();
  for (const candidate of candidates) {
    const fingerprint = presentationCompositionFingerprint(candidate.html);
    byFingerprint.set(fingerprint, [...(byFingerprint.get(fingerprint) ?? []), candidate.slideId]);
  }
  let recomposeIndex = 0;
  for (const slideIds of byFingerprint.values()) {
    const independentlyOwned = slideIds.filter((slideId) => !contentOwned.has(slideId));
    for (const slideId of independentlyOwned.slice(1)) {
      recomposeIndex += 1;
      tasks.push({
        taskKey: `recompose-${recomposeIndex}`,
        kind: "recompose",
        slideIds: [slideId],
      });
    }
  }
  return tasks;
}

export function consolidationPreservesContent(
  sources: readonly PresentationCandidateForCuration[],
  survivor: PresentationCandidateForCuration,
): boolean {
  const survivorTokens = presentationRetentionTokens(survivor);
  return sources.every((source) =>
    [...presentationRetentionTokens(source)].every((token) => survivorTokens.has(token))
  );
}
