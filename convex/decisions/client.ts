import { z } from "zod";
import { MODEL_IDS } from "../lib/model_constants";
import type { OpenRouterUsage } from "../lib/openrouter_types";

const probability = z.number().finite().min(0).max(1);
const numericUsage = z.number().finite().nonnegative();
const questionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("choice"), instructions: z.string().min(1), criteria: z.record(z.string(), z.string()) }),
  z.object({ type: z.literal("noul"), instructions: z.string().min(1), criteria: z.object({ true: z.string(), false: z.string() }) }),
  z.object({ type: z.literal("score"), instructions: z.string().min(1), criteria: z.array(z.string()).min(2) }),
]);
const answerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("choice"), choice: z.string(), confidence: probability.optional(), probabilities: z.record(z.string(), probability).optional() }),
  z.object({ type: z.literal("noul"), noul: probability }),
  z.object({ type: z.literal("score"), score: z.number().finite(), confidence: probability.optional(), probabilities: z.record(z.string(), probability).optional() }),
]);
const responseSchema = z.object({
  answers: z.record(z.string(), answerSchema),
  model: z.string().min(1),
  id: z.string().optional(),
  provider: z.string().optional(),
  usage: z.object({ input_tokens: numericUsage, output_tokens: numericUsage, cost: numericUsage.optional() }).optional(),
});

export type DecisionQuestion = z.infer<typeof questionSchema>;
export type DecisionAnswer = z.infer<typeof answerSchema>;
export interface DecisionRequest {
  state: unknown;
  questions: Record<string, DecisionQuestion>;
}
export interface DecisionResult {
  answers: Record<string, DecisionAnswer>;
  modelId: string;
  requestId?: string;
  provider?: string;
  usage?: OpenRouterUsage;
  durationMs: number;
}

export class DecisionError extends Error {
  readonly category: string;
  readonly metadata?: Omit<DecisionResult, "answers">;
  constructor(category: string, metadata?: Omit<DecisionResult, "answers">) {
    super(category); this.category = category; this.metadata = metadata; this.name = "DecisionError";
  }
}

export function choiceQuestion(instructions: string, criteria: Record<string, string>): DecisionQuestion {
  return { type: "choice", instructions, criteria };
}

export function choiceAnswer(result: DecisionResult, key: string): string {
  const answer = result.answers[key];
  if (answer?.type !== "choice") throw new DecisionError("invalid_choice");
  return answer.choice;
}

export function parseDecisionResponse(payload: unknown, questions: DecisionRequest["questions"]): Omit<DecisionResult, "durationMs"> {
  const parsed = responseSchema.parse(payload);
  if (!(parsed.model === MODEL_IDS.jevDecision || parsed.model.startsWith(`${MODEL_IDS.jevDecision}-`))) throw new DecisionError("unexpected_model");
  const keys = Object.keys(questions);
  if (Object.keys(parsed.answers).length !== keys.length) throw new DecisionError("answer_count_mismatch");
  for (const key of keys) {
    const question = questionSchema.parse(questions[key]);
    const answer = parsed.answers[key];
    if (!answer || answer.type !== question.type) throw new DecisionError("answer_type_mismatch");
    if (answer.type === "choice" && question.type === "choice" && !Object.hasOwn(question.criteria, answer.choice)) {
      throw new DecisionError("unknown_choice");
    }
    if (answer.type === "score" && question.type === "score" && (answer.score < 0 || answer.score > question.criteria.length - 1)) {
      throw new DecisionError("score_out_of_range");
    }
  }
  return {
    answers: parsed.answers, modelId: parsed.model, requestId: parsed.id, provider: parsed.provider,
    usage: parsed.usage ? {
      promptTokens: parsed.usage.input_tokens, completionTokens: parsed.usage.output_tokens,
      totalTokens: parsed.usage.input_tokens + parsed.usage.output_tokens, cost: parsed.usage.cost,
    } : undefined,
  };
}

export async function callJevDecisions(apiKey: string, request: DecisionRequest, options: { requireZdr?: boolean; timeoutMs?: number } = {}): Promise<DecisionResult> {
  const questions = z.record(z.string(), questionSchema).parse(request.questions);
  if (Object.keys(questions).length === 0) throw new DecisionError("empty_questions");
  const body = JSON.stringify({
    model: MODEL_IDS.jevDecision, state: request.state, questions,
    ...(options.requireZdr ? { provider: { zdr: true } } : {}),
  });
  // Bounded helper input; oversized context uses the existing domain helper.
  if (body.length > 100_000) throw new DecisionError("context_too_large");
  const startedAt = Date.now();
  try {
    const response = await fetch("https://openrouter.ai/api/alpha/decisions", {
      method: "POST", headers: {
        Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json",
        "HTTP-Referer": "https://nanthai.tech", "X-Title": "NanthAI Edge",
      }, body, signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
    });
    if (!response.ok) throw new DecisionError(`http_${response.status}`);
    const text = await response.text();
    if (text.length > 200_000) throw new DecisionError("response_too_large");
    const payload: unknown = JSON.parse(text);
    const metadata = responseSchema.omit({ answers: true }).safeParse(payload);
    try {
      const parsed = parseDecisionResponse(payload, questions);
      return { ...parsed, durationMs: Date.now() - startedAt };
    } catch {
      const data = metadata.success ? metadata.data : null;
      throw new DecisionError("invalid_response", data ? {
        modelId: data.model, requestId: data.id, provider: data.provider, durationMs: Date.now() - startedAt,
        usage: data.usage ? { promptTokens: data.usage.input_tokens, completionTokens: data.usage.output_tokens,
          totalTokens: data.usage.input_tokens + data.usage.output_tokens, cost: data.usage.cost } : undefined,
      } : undefined);
    }
  } catch (error) {
    if (error instanceof DecisionError) throw error;
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) throw new DecisionError("timeout");
    throw new DecisionError(error instanceof z.ZodError || error instanceof SyntaxError ? "invalid_response" : "transport_failure");
  }
}
