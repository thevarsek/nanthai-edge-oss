import { v } from "convex/values";
import type { StructuredInput } from "./protocol_common";

// Zero is the persisted “Never” choice; resolve the default in Convex only.
export const questionTimeoutMinutes = v.union(v.literal(0), v.literal(5), v.literal(10), v.literal(15));
export function resolveQuestionTimeout(value?: 0 | 5 | 10 | 15): 0 | 5 | 10 | 15 { return value ?? 15; }

export function automaticQuestionContent(raw: string): StructuredInput | null {
  const input = JSON.parse(raw) as {
    source?: string;
    sensitiveFieldPaths?: string[];
    requestSchema?: { isBlocking?: boolean; questions?: Array<{ id: string; isSecret?: boolean }> };
  };
  const questions = input.requestSchema?.questions;
  if (input.source !== "request_user_input" || input.requestSchema?.isBlocking !== false
    || !questions?.length || input.sensitiveFieldPaths?.length || questions.some(question => question.isSecret)) return null;
  return Object.fromEntries(questions.map(question => [question.id,
    "No human answer was received. Continue using your own judgment and recommendation under the user's unanswered-question setting. This is an automatic continuation, not a human answer or permission grant.",
  ]));
}
