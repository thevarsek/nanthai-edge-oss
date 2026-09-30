import type { DecisionRequest, DecisionResult } from "./client";
import { discussionDecisionRequest, projectDiscussionDecision, moderatorDecisionRequest } from "../autonomous/decision_policy";
import { memoryDecisionRequest, projectMemoryDecision } from "../memory/decision_policy";
import { speakerDecisionRequest, projectSpeakerDecision } from "../collaboration/scheduler_jev";
import { choiceAnswer } from "./client";
import type { SchedulerPolicyInput } from "../collaboration/scheduler_policy";
import type { Id } from "../_generated/dataModel";
import type { MemoryRecordLike } from "../memory/shared";

export interface EvaluationCase {
  id: string;
  useCase: "discussion" | "memory" | "moderator" | "speakers";
  expected: string;
  request: DecisionRequest;
  project: (result: DecisionResult) => string;
  baselineState: unknown;
}

function discussion(id: string, question: string, turns: string[], expected: string): EvaluationCase {
  const state = { question, messages: turns.map((content, index) => ({ role: "assistant", speaker: index % 2 ? "B" : "A", content })) };
  return { id, useCase: "discussion", expected, request: discussionDecisionRequest(state), project: (result) => projectDiscussionDecision(result) ?? "fallback", baselineState: state };
}
function memory(id: string, old: string[], candidate: string, evidence: string, expected: string): EvaluationCase {
  const candidates: MemoryRecordLike[] = old.map((content, index) => ({ _id: `memory_${index}`, content, updatedAt: 1, scopeType: "allPersonas" }));
  return { id, useCase: "memory", expected, request: memoryDecisionRequest(candidate, evidence, candidates),
    project: (result) => { const decision = projectMemoryDecision(result, candidates); return decision ? `${decision.action}${decision.target ? `:${decision.target._id}` : ""}` : "fallback"; },
    baselineState: { candidate, evidence, memories: candidates } };
}
function moderator(id: string, question: string, turns: string[], expected: string): EvaluationCase {
  const state = { question, messages: turns.map((content, index) => ({ speaker: index % 2 ? "B" : "A", content })), moderator: { name: "Moderator", role: "Help the discussion answer the question with evidence." }, nextParticipant: { name: "A", role: "Researcher" } };
  return { id, useCase: "moderator", expected, request: moderatorDecisionRequest(state), project: (result) => choiceAnswer(result, "intervention"), baselineState: state };
}
function speaker(id: string, content: string, role: "user" | "assistant", expected: string, handoff = false): EvaluationCase {
  const messageId = "frontier" as Id<"messages">;
  const input: SchedulerPolicyInput = { wave: role === "user" ? 1 : 2, frontierMessageIds: [messageId], participants: [
    { participantId: "writer" as Id<"chatParticipants">, displayName: "Writer", roleSummary: "Write and implement requested text.", modelId: "openai/gpt-5.6-luna" },
    { participantId: "reviewer" as Id<"chatParticipants">, displayName: "Reviewer", roleSummary: "Review changed work and identify concrete errors.", modelId: "openai/gpt-5.6-luna" },
  ], mentionedParticipantIds: [], failedParticipantIds: [], previousSpeakerIds: role === "assistant" ? ["writer" as Id<"chatParticipants">] : [],
    recentMessages: [{ id: messageId, role, speaker: role === "user" ? "User" : "Writer", ...(role === "assistant" ? { participantId: "writer" as Id<"chatParticipants"> } : {}), content }], remainingMessageBudget: 1, deadlineReached: false };
  if (handoff) input.participants[1].roleSummary = "Review the writer's changed text when explicitly handed work.";
  return { id, useCase: "speakers", expected, request: speakerDecisionRequest(input), project: (result) => projectSpeakerDecision(input, result).selections.map((selection) => String(selection.participantId)).sort().join(",") || "quiet", baselineState: input };
}

// Synthetic labels approved by the user on 2026-09-30; see docs/m60-evaluation.md.
export const evaluationCases: EvaluationCase[] = [
  discussion("d1", "Choose the simplest database for a local prototype.", ["Use SQLite: one local file, no service to operate.", "Agreed: SQLite meets the local prototype requirements and avoids server setup."], "consensus"),
  discussion("d2", "Choose A or B based on the measured failure rate.", ["I favor A but we have no failure-rate measurements.", "I favor B. We still lack the measurements.", "A is my preference.", "B is my preference."], "stalled"),
  discussion("d3", "Calculate 17 + 25 and show the arithmetic.", ["I agree that arithmetic is useful.", "Yes, arithmetic is useful."], "continue"),
  discussion("d4", "Pick the cheaper measured option: A $3, B $8.", ["A costs $3, B costs $8, so A is cheaper.", "Agreed: A saves $5 and is the cheaper option."], "consensus"),
  discussion("d5", "Does A or B have lower latency?", ["A looked faster in yesterday's test.", "Today's benchmark measured A at 40ms and B at 25ms; B is faster."], "continue"),
  discussion("d6", "Scegli il database per un prototipo locale.", ["SQLite basta: un file locale, nessun server.", "Concordo su SQLite perché soddisfa il requisito locale senza server."], "consensus"),
  discussion("d7", "Can we ship after the failing test is resolved?", ["I favor shipping now, although the test still fails.", "We cannot resolve that decision until the failing test is understood."], "continue"),
  memory("m1", ["User prefers short answers"], "User prefers concise explanations", "Keep explanations brief; I prefer concise answers.", "reinforce:memory_0"),
  memory("m2", ["User works at Acme"], "User now works at Beta", "I left Acme; I now work at Beta.", "supersede:memory_0"),
  memory("m3", ["User prefers brief answers"], "User prefers detailed legal research answers", "For legal research, give me detail.", "add"),
  memory("m4", ["User lives in Rome"], "User is visiting Milan this weekend", "I live in Rome and am visiting Milan this weekend.", "ignore"),
  memory("m5", ["User uses Python"], "User no longer uses Python", "I no longer use Python.", "supersede:memory_0"),
  memory("m6", ["User lives in Rome"], "User lives in Milan", "Could I move to Milan?", "ignore"),
  memory("m7", ["User prefers short answers"], "User prefers concise explanations", "Preferisco risposte brevi e concise.", "reinforce:memory_0"),
  memory("m8", ["User prefers short answers", "User prefers concise answers"], "User prefers brief answers", "I prefer brief answers.", "fallback"),
  memory("m9", ["User uses Python"], "Forget Python preference", "Forget that I use Python.", "forget"),
  moderator("c1", "Which database should we use based on throughput?", ["Database A is better.", "No throughput evidence has been supplied."], "request_evidence"),
  moderator("c2", "Balance privacy and the cost of hosting.", ["Local hosting improves privacy but costs more.", "Remote hosting is cheaper; the privacy tradeoff remains unresolved."], "clarify_tradeoff"),
  moderator("c3", "How can we estimate demand?", ["Our plan assumes every visitor buys. That assumption drives the forecast.", "We have no reason to assume a 100% conversion rate."], "challenge_assumption"),
  moderator("c4", "What remains to do on the prototype?", ["The first test passed; now I'm implementing the requested second test.", "I have fresh results from the second test and will report them next."], "no_intervention"),
  speaker("s1", "Please write a concise summary of this design.", "user", "writer"),
  speaker("s2", "The requested summary is finished and the task is complete. No questions remain.", "assistant", "quiet"),
  speaker("s3", "I revised the draft. Reviewer, please check this changed text for errors.", "assistant", "reviewer", true),
];
