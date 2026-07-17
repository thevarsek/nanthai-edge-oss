export interface GeneratedTextBounds {
  elementId: string;
  parentKey: string;
  isTopLevel: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  containerWidth: number;
  containerHeight: number;
}

export type GeneratedSlideLayoutIssue =
  | { code: "missing_size"; elementId: string; message: string }
  | { code: "missing_anchor"; elementId: string; message: string }
  | {
      code: "out_of_bounds";
      elementId: string;
      bounds: GeneratedTextBounds;
      message: string;
    }
  | {
      code: "wrapped_overflow";
      elementId: string;
      bounds: GeneratedTextBounds;
      requiredHeight: number;
      availableHeight: number;
      lineCount: number;
      fontSize: number;
      lineHeight: number;
      message: string;
    }
  | {
      code: "overlap";
      elementIds: [string, string];
      bounds: [GeneratedTextBounds, GeneratedTextBounds];
      message: string;
    };

export class GeneratedSlideLayoutError extends Error {
  readonly issue: GeneratedSlideLayoutIssue;
  readonly issues: readonly GeneratedSlideLayoutIssue[];

  constructor(issueOrIssues: GeneratedSlideLayoutIssue | readonly GeneratedSlideLayoutIssue[]) {
    const issues = Array.isArray(issueOrIssues) ? issueOrIssues : [issueOrIssues];
    const first = issues[0];
    if (!first) throw new Error("Generated layout error requires at least one issue.");
    const suffix = issues.length > 1 ? ` (${issues.length} layout issues found in one pass.)` : "";
    super(`${first.message}${suffix}`);
    this.name = "GeneratedSlideLayoutError";
    this.issue = first;
    this.issues = issues;
  }
}
