import assert from "node:assert/strict";
import test from "node:test";
import { advisorRunView, chatAdvisorView } from "../advisors/view";

type ViewAssignment = Parameters<typeof chatAdvisorView>[1];
type IndexQuery = { eq: (field: string, value: unknown) => IndexQuery };

test("kept Advisor views expose canonical per-Persona unavailability", async () => {
  const personas: Record<string, Record<string, unknown>> = {
    persona_image: {
      _id: "persona_image",
      userId: "user_1",
      displayName: "Illustrator",
      modelId: "image_model",
    },
    persona_conflict: {
      _id: "persona_conflict",
      userId: "user_1",
      displayName: "Current speaker",
      modelId: "text_model",
    },
  };
  const models = [
    { modelId: "image_model", architecture: { modality: "text->image" } },
    { modelId: "text_model", architecture: { modality: "text->text" } },
  ];
  const ctx = {
    db: {
      get: async (id: string) => personas[id] ?? null,
      query: () => ({
        withIndex: (_index: string, apply: (query: IndexQuery) => void) => {
          let modelId = "";
          const query: IndexQuery = {
            eq: (_field, value) => {
              modelId = String(value);
              return query;
            },
          };
          apply(query);
          return { first: async () => models.find((model) => model.modelId === modelId) ?? null };
        },
      }),
    },
    storage: { getUrl: async () => null },
  } as unknown as Parameters<typeof chatAdvisorView>[0];
  const assignment = (personaId: string): ViewAssignment => ({
    _id: `assignment_${personaId}`,
    userId: "user_1",
    chatId: "chat_1",
    personaId,
    instanceName: `persona_${personaId}`,
    sortOrder: 0,
    allowWebSearch: false,
    createdAt: 1,
    updatedAt: 1,
  }) as ViewAssignment;

  const media = await chatAdvisorView(ctx, assignment("persona_image"));
  assert.equal(media?.isAvailable, false);
  assert.equal(media?.unavailableReasonCode, "media_output_model");

  const conflict = await chatAdvisorView(ctx, assignment("persona_conflict"), {
    participantPersonaIds: new Set(["persona_conflict"]),
  });
  assert.equal(conflict?.isAvailable, false);
  assert.equal(conflict?.unavailableReasonCode, "participant_conflict");
});

test("Advisor run views hide legacy SDK request dumps from every client", () => {
  const run = {
    _id: "run_legacy",
    personaId: "persona_1",
    personaSnapshot: { displayName: "Reviewer" },
    instanceName: "persona_1",
    sortOrder: 0,
    status: "failed",
    stage: "failed",
    allowWebSearch: false,
    requestedModelId: "model_1",
    errorCode: "INTERNAL_ERROR",
    errorMessage: "ChatSend failed: " + JSON.stringify({
      name: "SDKValidationError",
      rawValue: {
        chatRequest: { messages: [{ content: "PRIVATE_PROMPT_SENTINEL" }] },
      },
    }),
    createdAt: 1,
    updatedAt: 2,
  } as Parameters<typeof advisorRunView>[0];

  const view = advisorRunView(run);

  assert.equal(view.errorMessage, undefined);
  assert.equal(view.errorCode, "INTERNAL_ERROR");
});
