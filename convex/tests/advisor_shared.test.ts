import assert from "node:assert/strict";
import test from "node:test";
import { injectAdvisorNotes } from "../advisors/notes";
import { advisorResponsesInput } from "../advisors/responses_input";
import {
  advisorInstanceName,
  advisorMaxTokens,
  advisorTemperature,
  buildAdvisorInstructions,
  resolveAdvisorModel,
  sanitizeAdvisorBrief,
  successfulAdvisorNotes,
} from "../advisors/shared";
import { MAX_ADVISOR_BRIEF_CHARS, MAX_ADVISOR_OUTPUT_TOKENS } from "../advisors/constants";

test("Persona Advisor prompt and model resolution use safe runtime fallbacks", () => {
  assert.deepEqual(resolveAdvisorModel("anthropic/claude:online", "openai/default"), {
    modelId: "anthropic/claude",
    legacyOnline: true,
  });
  assert.equal(resolveAdvisorModel("", "openai/default").modelId, "openai/default");
  assert.match(buildAdvisorInstructions({
    displayName: "Maya",
    systemPrompt: "Challenge architecture assumptions.",
  }), /You are Maya, acting as a private advisor/);
  assert.match(buildAdvisorInstructions({ displayName: "", systemPrompt: "" }), /Offer clear/);
  assert.equal(advisorMaxTokens(99_999), MAX_ADVISOR_OUTPUT_TOKENS);
  assert.equal(advisorTemperature(8), 2);
  assert.equal(sanitizeAdvisorBrief(`  ${"x".repeat(MAX_ADVISOR_BRIEF_CHARS + 5)}  `)?.length, MAX_ADVISOR_BRIEF_CHARS);
});

test("Advisor notes are ordered, bounded, escaped, and injected once", () => {
  const notes = successfulAdvisorNotes([
    {
      sortOrder: 1,
      advice: "Second",
      requestedModelId: "model-2",
      personaSnapshot: { displayName: "B" },
    },
    {
      sortOrder: 0,
      advice: "First",
      requestedModelId: "model-1",
      actualModelId: "actual-1",
      personaSnapshot: { displayName: "A & \"Reviewer\"" },
    },
  ] as Parameters<typeof successfulAdvisorNotes>[0]);
  assert.ok(notes);
  assert.ok((notes?.indexOf("First") ?? -1) < (notes?.indexOf("Second") ?? -1));
  assert.match(notes ?? "", /A &amp; &quot;Reviewer&quot;/);
  const once = injectAdvisorNotes([{ role: "user", content: "Question" }], notes);
  const twice = injectAdvisorNotes(once, notes);
  assert.equal(once.length, 2);
  assert.deepEqual(twice, once);
});

test("Responses input preserves replay items unchanged before the latest user turn", () => {
  const replay = {
    type: "openrouter:advisor",
    id: "advisor_old",
    instance_name: "persona_1",
    advice: "Earlier advice",
  };
  const input = advisorResponsesInput([
    { role: "user", content: "Earlier question" },
    { role: "assistant", content: "Earlier answer" },
    { role: "user", content: "Latest question" },
  ], [replay], "Focus on risk", { forwardTranscript: false });
  assert.strictEqual(input[2], replay);
  assert.deepEqual(input[1], {
    type: "message",
    role: "assistant",
    id: "msg_nanthai_context_1",
    status: "completed",
    content: [{ type: "output_text", text: "Earlier answer" }],
  });
  assert.deepEqual(input[3], {
    type: "message",
    role: "user",
    content: [{ type: "input_text", text: "Latest question" }],
  });
  assert.deepEqual(input.at(-1), {
    type: "message",
    role: "user",
    content: [{ type: "input_text", text: "[Private Advisor brief]\nFocus on risk" }],
  });
});

test("Responses input preserves Advisor memory as safe text without replaying raw tool items", () => {
  const input = advisorResponsesInput([
    { role: "user", content: "Follow-up question" },
  ], [{
    type: "openrouter:advisor",
    id: "advisor_old",
    instance_name: "persona_1",
    advice: "Earlier advice",
  }], "Focus", { forwardTranscript: true });

  assert.equal(input.some((item) => item.type === "openrouter:advisor"), false);
  const history = input.find((item) =>
    item.type === "message" && item.role === "user" &&
    Array.isArray(item.content) &&
    item.content.some((part) =>
      typeof part.text === "string" &&
      part.text.includes("Prior private Advisor consultation history")
    )
  );
  assert.ok(history);
  assert.match(JSON.stringify(history), /Earlier advice/);
  assert.doesNotMatch(JSON.stringify(history), /advisor_old|instance_name|openrouter:advisor/);
});

test("Responses input drops multimodal parts unsupported by the Advisor model", () => {
  const input = advisorResponsesInput([{
    role: "user",
    content: [
      { type: "text", text: "Review" },
      { type: "image_url", image_url: { url: "https://example.com/image.png" } },
      { type: "file", file: { file_data: "data:text/plain;base64,QQ==", filename: "a.txt" } },
    ],
  }], [], "Focus", { allowImages: false, allowFiles: false });
  assert.deepEqual(input[0]?.content as Array<Record<string, unknown>>, [
    { type: "input_text", text: "Review" },
  ]);
});

test("Advisor instance names remain stable and transport-safe", () => {
  const name = advisorInstanceName("persona / with spaces + punctuation");
  assert.match(name, /^persona_[A-Za-z0-9_-]+$/);
  assert.ok(name.length <= 64);
});
