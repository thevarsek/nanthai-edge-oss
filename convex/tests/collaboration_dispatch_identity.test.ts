import assert from "node:assert/strict";
import test from "node:test";
import type { Id } from "../_generated/dataModel";
import { projectCollaborationParticipant } from "../collaboration/dispatch_mutation";

const participantId = "participant_1" as Id<"chatParticipants">;

test("Collaboration preserves provider identity for a bare model", () => {
  const projected = projectCollaborationParticipant({
    participantId,
    modelId: "openai/gpt-5.4",
    displayName: "gpt 5.4",
  });

  assert.equal(projected.modelId, "openai/gpt-5.4");
  assert.equal(projected.personaId, undefined);
  assert.equal(projected.personaName, undefined);
  assert.equal(projected.personaEmoji, undefined);
  assert.equal(projected.personaAvatarImageUrl, undefined);
});

test("Collaboration preserves the configured identity for a Persona", () => {
  const personaId = "persona_1" as Id<"personas">;
  const projected = projectCollaborationParticipant({
    participantId,
    modelId: "openai/gpt-5.4",
    personaId,
    displayName: "Architect",
    personaEmoji: "A",
    personaAvatarImageUrl: "https://example.com/architect.png",
  });

  assert.equal(projected.personaId, personaId);
  assert.equal(projected.personaName, "Architect");
  assert.equal(projected.personaEmoji, "A");
  assert.equal(
    projected.personaAvatarImageUrl,
    "https://example.com/architect.png",
  );
});
